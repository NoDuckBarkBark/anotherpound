#!/usr/bin/env python3
"""Builds public/data/off-starter.json: the most scanned products from Germany.

Source: Open Food Facts (https://openfoodfacts.org), Open Database License (ODbL).
It reads the Parquet dump of the product database on Hugging Face
(openfoodfacts/product-database, file food.parquet, about 8 GB). Only this dump
contains the German product name in addition to the main name.

Usage (from the project folder):

    python -I scripts/build_off_starter.py

The dump goes to .cache/off/food.parquet and is reused on the next run
(--refresh downloads it again).

Needs duckdb (pip install duckdb), otherwise only the standard library.
"""

from __future__ import annotations

import argparse
import datetime
import gzip
import html
import json
import math
import re
import sys
import urllib.request
from collections import Counter
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PARQUET = ROOT / ".cache" / "off" / "food.parquet"
DEFAULT_OUT = ROOT / "public" / "data" / "off-starter.json"

PARQUET_URL = "https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet"
USER_AGENT = "AnotherPound-build/0.1"
COUNTRY_TAG = "en:germany"

FIELDS = [
    "code", "name", "brand", "quantity", "unit",
    "kcal", "protein", "carbs", "sugar", "fat", "satFat", "fiber", "salt",
    "servingLabel", "servingAmount",
]

# Column name in the query -> name of the nutrient in Open Food Facts (value per 100 g/ml)
NUTRIENTS = {
    "kcal": "energy-kcal",
    "kj": "energy-kj",
    "protein": "proteins",
    "carbs": "carbohydrates",
    "sugar": "sugars",
    "fat": "fat",
    "satFat": "saturated-fat",
    "fiber": "fiber",
    "salt": "salt",
    "sodium": "sodium",
}
GRAM_FIELDS = ("protein", "carbs", "sugar", "fat", "satFat", "fiber", "salt")

NAME_MAX = 80        # like text() in src/lib/off.ts
QUANTITY_MAX = 20
SERVING_LABEL_MAX = 24
# Like LIQUID in src/lib/off.ts, plus the spelled-out forms ("1 Liter").
LIQUID_RE = re.compile(r"\d\s*(ml|cl|l|liter|litre|litres|milliliter|millilitre)\b", re.IGNORECASE | re.ASCII)
INVISIBLE_RE = re.compile(r"[\x00-\x1f\x7f\u200b\ufeff]")


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- Download

def download_parquet(target: Path) -> None:
    """Downloads the Parquet dump in full (the dump changes daily, so no resuming)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    log(f"Loading {PARQUET_URL}")
    request = urllib.request.Request(PARQUET_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response, open(partial, "wb") as handle:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        next_report = 0
        while chunk := response.read(1 << 22):
            handle.write(chunk)
            done += len(chunk)
            if done >= next_report:
                log(f"  {done / 1e9:5.2f} GB" + (f" of {total / 1e9:.2f} GB" if total else ""))
                next_report = done + 1_000_000_000
    with open(partial, "rb") as handle:
        handle.seek(-4, 2)
        complete = handle.read(4) == b"PAR1" and (not total or done == total)
    if not complete:
        raise SystemExit(f"The download is incomplete or not a Parquet file: {partial}")
    partial.replace(target)
    log(f"Saved: {target} ({target.stat().st_size:,} bytes)")


# ---------------------------------------------------------------- Query

def query_candidates(parquet: Path, rank: str):
    """All products with country Germany and scans, ordered by popularity."""
    import duckdb

    con = duckdb.connect()
    con.execute(
        """
        CREATE TEMP TABLE src AS
        SELECT code, product_name, brands, quantity, serving_size, serving_quantity,
               unique_scans_n, scans_n, popularity_tags, nutriments
        FROM read_parquet(?)
        WHERE list_contains(countries_tags, ?) AND unique_scans_n > 0
        """,
        [str(parquet), COUNTRY_TAG],
    )

    # unique_scans_n counts scans worldwide. How often a product was scanned in Germany
    # is only given in tiers in the tags ("top-5000-de-scans-2026", latest year).
    # --rank scans: unique_scans_n, ties broken by the German tier.
    # --rank de:    German tier first, then unique_scans_n.
    # After that, scans_n and the code in each case, so the order is unambiguous.
    tier_re = r"^top-(\d+)-de-scans-(\d{4})$"
    year = con.execute(
        "SELECT max(CAST(regexp_extract(t, ?, 2) AS INTEGER)) "
        "FROM (SELECT unnest(popularity_tags) AS t FROM src) WHERE regexp_matches(t, ?)",
        [tier_re, tier_re],
    ).fetchone()[0]
    year_re = rf"^top-(\d+)-de-scans-{year}$" if year else r"^$"

    order_sql = {
        "scans": "unique_scans_n DESC, de_tier ASC NULLS LAST",
        "de": "de_tier ASC NULLS LAST, unique_scans_n DESC",
    }[rank]
    nutrient_sql = ",\n               ".join(
        f"""CAST([x."100g" for x in nutriments if x.name = '{off_name}'][1] AS VARCHAR) AS "{column}\""""
        for column, off_name in NUTRIENTS.items()
    )
    # CAST(... AS VARCHAR) gives the shortest notation of the 32-bit number ("0.45" instead of 0.449999988).
    cursor = con.execute(
        f"""
        SELECT code,
               [x.text for x in product_name if x.lang = 'de' AND trim(x.text) <> ''][1] AS name_de,
               [x.text for x in product_name if x.lang = 'main' AND trim(x.text) <> ''][1] AS name_main,
               [x.text for x in product_name if x.lang = 'en' AND trim(x.text) <> ''][1] AS name_en,
               [x.text for x in product_name if trim(x.text) <> ''][1] AS name_any,
               brands, quantity, serving_size, serving_quantity, unique_scans_n,
               {nutrient_sql}
        FROM (
            SELECT *, list_min([CAST(regexp_extract(t, ?, 1) AS INTEGER)
                                for t in popularity_tags if regexp_matches(t, ?)]) AS de_tier
            FROM src
        )
        ORDER BY {order_sql}, scans_n DESC NULLS LAST, code ASC
        """,
        [year_re, year_re],
    )
    columns = [d[0] for d in cursor.description]
    return cursor, columns, year


# ---------------------------------------------------------------- Conversion

def valid_gs1(code: str) -> bool:
    """Check digit per GS1 (like hasValidCheckDigit in src/lib/ean.ts)."""
    total = 0
    weight = 3
    for char in reversed(code[:-1]):
        total += int(char) * weight
        weight = 1 if weight == 3 else 3
    return (10 - total % 10) % 10 == int(code[-1])


def normalize_code(raw: object) -> str | None:
    """8 or 13 digits with a valid check digit; 12 digits (UPC-A) get a leading 0."""
    code = str(raw or "").strip()
    if not code.isascii() or not code.isdigit() or len(code) not in (8, 12, 13):
        return None
    if not valid_gs1(code):
        return None
    return "0" + code if len(code) == 12 else code


def clean_text(value: object, limit: int | None = None) -> str | None:
    """Remove invisible characters, collapse whitespace, truncate. Empty becomes None."""
    if not isinstance(value, str):
        return None
    text = " ".join(INVISIBLE_RE.sub(" ", html.unescape(value)).split())
    if limit is not None:
        text = text[:limit].rstrip()
    return text or None


def parse_number(value: object) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def round_half_up(value: float, digits: int) -> int | float:
    """Round half up; whole values as an integer (saves space in the JSON file)."""
    quantum = Decimal(1).scaleb(-digits)
    rounded = Decimal(repr(value)).quantize(quantum, rounding=ROUND_HALF_UP)
    if rounded == rounded.to_integral_value():
        return int(rounded)
    return float(rounded)


def convert(record: dict) -> tuple[list | None, str | None]:
    """One row for the starter file, or (None, reason) if the product is dropped."""
    code = normalize_code(record["code"])
    if code is None:
        return None, "invalid code (length or check digit)"

    # German name, otherwise the main name. If both fields are missing, the English or any name.
    name = next(
        (text for key in ("name_de", "name_main", "name_en", "name_any")
         if (text := clean_text(record[key], NAME_MAX))),
        None,
    )
    if name is None:
        return None, "without name"

    values = {column: parse_number(record[column]) for column in NUTRIENTS}
    # Only explicit kcal or kJ values; the unspecified "energy" is not read.
    kcal = values["kcal"]
    if kcal is None and values["kj"] is not None:
        kcal = values["kj"] / 4.184
    salt = values["salt"]
    if salt is None and values["sodium"] is not None:
        salt = values["sodium"] * 2.5
    grams = {field: values[field] for field in GRAM_FIELDS}
    grams["salt"] = salt

    if kcal is None or any(grams[field] is None for field in ("protein", "carbs", "fat")):
        return None, "without kcal, protein, carbs or fat"
    if not 0 <= kcal <= 900:
        return None, "kcal outside 0-900"
    if any(v is not None and not 0 <= v <= 100 for v in grams.values()):
        return None, "gram value outside 0-100"
    if grams["protein"] + grams["carbs"] + grams["fat"] > 105:
        return None, "protein + carbs + fat above 105"
    if grams["sugar"] is not None and grams["sugar"] > grams["carbs"] + 1:
        return None, "sugar above carbs + 1"
    if grams["satFat"] is not None and grams["satFat"] > grams["fat"] + 1:
        return None, "saturated fat above fat + 1"

    brand = clean_text((record["brands"] or "").split(",")[0], NAME_MAX)
    quantity_full = clean_text(record["quantity"])
    serving_full = clean_text(record["serving_size"])
    unit = "ml" if LIQUID_RE.search(quantity_full or "") or LIQUID_RE.search(serving_full or "") else "g"

    serving_amount = parse_number(record["serving_quantity"])
    if serving_amount is not None and 1 <= serving_amount <= 1000:
        serving_amount = round_half_up(serving_amount, 1)
        # Without a serving text, the same fallback label as in src/lib/off.ts.
        serving_label = clean_text(serving_full, SERVING_LABEL_MAX) or f"{serving_amount} {unit}"
    else:
        serving_amount = None
        serving_label = None

    def gram(field: str, digits: int = 1) -> int | float | None:
        value = grams[field]
        return None if value is None else round_half_up(value, digits)

    row = [
        code, name, brand, clean_text(quantity_full, QUANTITY_MAX), unit,
        round_half_up(kcal, 0), gram("protein"), gram("carbs"), gram("sugar"),
        gram("fat"), gram("satFat"), gram("fiber"), gram("salt", 2),
        serving_label, serving_amount,
    ]
    return row, None


def write_json(path: Path, payload: dict) -> bytes:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description="Open Food Facts -> public/data/off-starter.json")
    parser.add_argument("--parquet", type=Path, default=DEFAULT_PARQUET, help="path to food.parquet")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="target file")
    parser.add_argument("--limit", type=int, default=10_000, help="number of products")
    parser.add_argument(
        "--rank", choices=("scans", "de"), default="de",
        help="scans: by unique_scans_n (worldwide); de: first by the tier of German scans",
    )
    parser.add_argument("--date", default=datetime.date.today().isoformat(), help="value for generatedAt")
    parser.add_argument("--refresh", action="store_true", help="download the dump again")
    args = parser.parse_args()
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(errors="replace")

    if args.refresh and args.parquet.exists():
        args.parquet.unlink()
    if not args.parquet.exists():
        download_parquet(args.parquet)

    log(f"Reading {args.parquet}")
    cursor, columns, year = query_candidates(args.parquet, args.rank)

    rows: list[list] = []
    seen: set[str] = set()
    dropped: Counter = Counter()
    examined = 0
    last_scans = None
    while len(rows) < args.limit:
        batch = cursor.fetchmany(2000)
        if not batch:
            break
        for values in batch:
            if len(rows) >= args.limit:
                break
            examined += 1
            record = dict(zip(columns, values))
            row, reason = convert(record)
            if row is not None and row[0] in seen:
                row, reason = None, "duplicate code"
            if row is None:
                dropped[reason] += 1
                continue
            seen.add(row[0])
            rows.append(row)
            last_scans = record["unique_scans_n"]

    payload = {
        "source": "off",
        "license": "ODbL",
        "attribution": "Open Food Facts",
        "generatedAt": args.date,
        "fields": FIELDS,
        "rows": rows,
    }
    data = write_json(args.out, payload)

    log("")
    if args.rank == "scans":
        log(f"Ranking: unique_scans_n descending, ties broken by German scan tier {year}")
    else:
        log(f"Ranking: German scan tier {year}, within it unique_scans_n descending")
    log(f"Products examined up to the limit: {examined}")
    for reason, count in dropped.most_common():
        log(f"  removed ({reason}): {count} ({count / examined:.1%})")
    log(f"Products in {args.out.name}: {len(rows)} (last one with unique_scans_n = {last_scans})")
    log(f"{args.out}: {len(data):,} bytes, gzip {len(gzip.compress(data, 9)):,} bytes")
    if len(rows) < args.limit:
        log(f"Warning: found only {len(rows)} products instead of {args.limit}.")


if __name__ == "__main__":
    main()
