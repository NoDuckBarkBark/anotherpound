#!/usr/bin/env python3
"""Builds public/data/off/<country>.json: the most scanned products of each country.

Source: Open Food Facts (https://openfoodfacts.org), Open Database License (ODbL).
It reads the Parquet dump of the product database on Hugging Face
(openfoodfacts/product-database, file food.parquet, about 8 GB). Only this dump
contains the product names in every language.

Usage (from the project folder):

    python -I scripts/build_off_packs.py            # all countries
    python -I scripts/build_off_packs.py DE AT CH   # only these

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
DEFAULT_OUT = ROOT / "public" / "data" / "off"

PARQUET_URL = "https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet"
USER_AGENT = "AnotherPound-build/0.1"

# Country code -> (country tag in Open Food Facts, code in the scan tags, languages of the product
# names in order of preference). The same codes are listed in src/lib/regions.ts.
COUNTRIES: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "AT": ("en:austria", "at", ("de",)),
    "BE": ("en:belgium", "be", ("nl", "fr")),
    "BG": ("en:bulgaria", "bg", ("bg",)),
    "CH": ("en:switzerland", "ch", ("de", "fr", "it")),
    "CY": ("en:cyprus", "cy", ("el",)),
    "CZ": ("en:czech-republic", "cz", ("cs",)),
    "DE": ("en:germany", "de", ("de",)),
    "DK": ("en:denmark", "dk", ("da",)),
    "EE": ("en:estonia", "ee", ("et",)),
    "ES": ("en:spain", "es", ("es",)),
    "FI": ("en:finland", "fi", ("fi",)),
    "FR": ("en:france", "fr", ("fr",)),
    "GB": ("en:united-kingdom", "gb", ("en",)),
    "GR": ("en:greece", "gr", ("el",)),
    "HR": ("en:croatia", "hr", ("hr",)),
    "HU": ("en:hungary", "hu", ("hu",)),
    "IE": ("en:ireland", "ie", ("en",)),
    "IT": ("en:italy", "it", ("it",)),
    "LT": ("en:lithuania", "lt", ("lt",)),
    "LU": ("en:luxembourg", "lu", ("fr", "de")),
    "LV": ("en:latvia", "lv", ("lv",)),
    "MT": ("en:malta", "mt", ("en",)),
    "NL": ("en:netherlands", "nl", ("nl",)),
    "NO": ("en:norway", "no", ("nb", "no")),
    "PL": ("en:poland", "pl", ("pl",)),
    "PT": ("en:portugal", "pt", ("pt",)),
    "RO": ("en:romania", "ro", ("ro",)),
    "SE": ("en:sweden", "se", ("sv",)),
    "SI": ("en:slovenia", "si", ("sl",)),
    "SK": ("en:slovakia", "sk", ("sk",)),
}

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

def load_source(parquet: Path, codes: list[str]):
    """One pass over the dump: every scanned product sold in one of the countries."""
    import duckdb

    con = duckdb.connect()
    tags = [COUNTRIES[code][0] for code in codes]
    nutrient_sql = ",\n               ".join(
        f"""CAST([x."100g" for x in nutriments if x.name = '{off_name}'][1] AS VARCHAR) AS "{column}\""""
        for column, off_name in NUTRIENTS.items()
    )
    # CAST(... AS VARCHAR) gives the shortest notation of the 32-bit number ("0.45" instead of 0.449999988).
    con.execute(
        f"""
        CREATE TEMP TABLE src AS
        SELECT code, product_name, brands, quantity, serving_size, serving_quantity,
               unique_scans_n, scans_n, popularity_tags, countries_tags,
               {nutrient_sql}
        FROM read_parquet(?)
        WHERE list_has_any(countries_tags, ?) AND unique_scans_n > 0
        """,
        [str(parquet), tags],
    )
    return con


def query_candidates(con, code: str, year: int):
    """All scanned products of one country, ordered by popularity there."""
    tag, scan_code, _languages = COUNTRIES[code]
    # unique_scans_n counts scans worldwide. How often a product was scanned in a country
    # is only given in tiers in the tags ("top-5000-de-scans-2025"). The order is the tier of
    # the country first, then unique_scans_n, then scans_n and the code, so it is unambiguous.
    tier_re = rf"^top-(\d+)-{scan_code}-scans-{year}$"
    cursor = con.execute(
        f"""
        SELECT code, product_name, brands, quantity, serving_size, serving_quantity, unique_scans_n,
               {", ".join(f'"{column}"' for column in NUTRIENTS)}
        FROM (
            SELECT *, list_min([CAST(regexp_extract(t, ?, 1) AS INTEGER)
                                for t in popularity_tags if regexp_matches(t, ?)]) AS tier
            FROM src
            WHERE list_contains(countries_tags, ?)
        )
        ORDER BY tier ASC NULLS LAST, unique_scans_n DESC, scans_n DESC NULLS LAST, code ASC
        """,
        [tier_re, tier_re, tag],
    )
    columns = [d[0] for d in cursor.description]
    return cursor, columns


def pick_name(names: object, languages: tuple[str, ...]) -> str | None:
    """Name in a language of the country, otherwise the main name, the English one or any."""
    by_lang: dict[str, str] = {}
    first = None
    for item in names or []:
        text = clean_text(item.get("text"), NAME_MAX)
        if text is None:
            continue
        first = first or text
        by_lang.setdefault(item.get("lang") or "", text)
    for lang in (*languages, "main", "en"):
        if lang in by_lang:
            return by_lang[lang]
    return first


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


def convert(record: dict, languages: tuple[str, ...]) -> tuple[list | None, str | None]:
    """One row for the file of a country, or (None, reason) if the product is dropped."""
    code = normalize_code(record["code"])
    if code is None:
        return None, "invalid code (length or check digit)"

    name = pick_name(record["product_name"], languages)
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


def build_country(con, code: str, year: int, limit: int, date: str, out_dir: Path) -> dict:
    cursor, columns = query_candidates(con, code, year)
    languages = COUNTRIES[code][2]

    rows: list[list] = []
    seen: set[str] = set()
    dropped: Counter = Counter()
    examined = 0
    while len(rows) < limit:
        batch = cursor.fetchmany(2000)
        if not batch:
            break
        for values in batch:
            if len(rows) >= limit:
                break
            examined += 1
            row, reason = convert(dict(zip(columns, values)), languages)
            if row is not None and row[0] in seen:
                row, reason = None, "duplicate code"
            if row is None:
                dropped[reason] += 1
                continue
            seen.add(row[0])
            rows.append(row)

    payload = {
        "source": "off",
        "license": "ODbL",
        "attribution": "Open Food Facts",
        "country": code,
        "generatedAt": date,
        "fields": FIELDS,
        "rows": rows,
    }
    data = write_json(out_dir / f"{code.lower()}.json", payload)
    return {"code": code, "rows": len(rows), "examined": examined, "dropped": dropped, "bytes": len(data)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Open Food Facts -> public/data/off/<country>.json")
    parser.add_argument("countries", nargs="*", help="country codes, for example DE AT CH (default: all)")
    parser.add_argument("--parquet", type=Path, default=DEFAULT_PARQUET, help="path to food.parquet")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="target folder")
    parser.add_argument("--limit", type=int, default=10_000, help="number of products per country")
    parser.add_argument(
        "--year", type=int, default=datetime.date.today().year - 1,
        help="year of the scan tags (default: last year, the tags of the running year are provisional)",
    )
    parser.add_argument("--date", default=datetime.date.today().isoformat(), help="value for generatedAt")
    parser.add_argument("--refresh", action="store_true", help="download the dump again")
    args = parser.parse_args()
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(errors="replace")

    codes = [code.upper() for code in args.countries] or list(COUNTRIES)
    unknown = [code for code in codes if code not in COUNTRIES]
    if unknown:
        raise SystemExit(f"Unknown country codes: {', '.join(unknown)}")

    if args.refresh and args.parquet.exists():
        args.parquet.unlink()
    if not args.parquet.exists():
        download_parquet(args.parquet)

    log(f"Reading {args.parquet}")
    con = load_source(args.parquet, codes)
    log(f"Ranking: scan tier of the country in {args.year}, within it unique_scans_n descending")
    log("")
    for code in codes:
        result = build_country(con, code, args.year, args.limit, args.date, args.out)
        reasons = ", ".join(f"{reason} {count}" for reason, count in result["dropped"].most_common(3))
        log(f"{code}: {result['rows']:>6} products, {result['bytes']:>9,} bytes, "
            f"examined {result['examined']}" + (f" (removed: {reasons})" if reasons else ""))


if __name__ == "__main__":
    main()
