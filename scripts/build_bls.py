#!/usr/bin/env python3
"""Builds public/data/bls.json from the Bundeslebensmittelschlüssel (BLS) 4.0.

Source: Max Rubner-Institut, https://blsdb.de, license CC BY 4.0.
The table is reduced to the nutrients that AnotherPound shows
(a change from the original, hence "modified": true).

Usage (from the project folder):

    python -I scripts/build_bls.py

The download goes to .cache/bls/ and is reused on the next run.
blsdb.de only hands out the file with a session cookie and token; the script
therefore loads the search page first, follows "Download BLS-Daten" and takes the link from there.
If that stops working, download the ZIP file by hand and pass it with --zip.

Needs openpyxl, otherwise only the standard library.
"""

from __future__ import annotations

import argparse
import gzip
import html
import http.cookiejar
import io
import json
import math
import re
import sys
import urllib.request
import zipfile
from collections import Counter
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = ROOT / ".cache" / "bls"
DEFAULT_OUT = ROOT / "public" / "data" / "bls.json"

BASE = "https://blsdb.de/"
START_PAGE = BASE + "search"
USER_AGENT = "AnotherPound-build/0.1"
ZIP_NAME = "BLS_4_0_2025_DE.zip"
DATA_SUFFIX = "_Daten_2025_DE.xlsx"

FIELDS = ["id", "name", "kcal", "protein", "carbs", "sugar", "fat", "satFat", "fiber", "salt", "alcohol"]

# field -> (component code in the BLS, expected unit, decimal places)
COMPONENTS = {
    "kcal": ("ENERCC", "kcal", 0),
    "protein": ("PROT625", "g", 1),
    "carbs": ("CHO", "g", 1),
    "sugar": ("SUGAR", "g", 1),
    "fat": ("FAT", "g", 1),
    "satFat": ("FASAT", "g", 1),
    "fiber": ("FIBT", "g", 1),
    "salt": ("NACL", "g", 2),
    "alcohol": ("ALC", "g", 1),
}
SODIUM = ("NA", "mg")
REQUIRED = ("kcal", "protein", "carbs", "fat")

# Header of the nutrient columns: "CODE name [unit/100g]"
HEADER_RE = re.compile(r"^(\S+)\s.*\[\s*([^\]/]+?)\s*/\s*100\s*g\s*\]\s*$")

# According to the BLS documentation (chapter 4.4): "-" means "no value" and is not a zero.
# "TR" (traces) and "<LOD"/"<LOQ" (below the limit of detection or quantification) are
# amounts that come out as 0 at one decimal place; the BLS energy formula treats them the same way.
MISSING = {"", "-"}
TRACE_RE = re.compile(r"^(TR|<\s*LO[DQ].*)$", re.IGNORECASE)


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- Download

def download_zip(target: Path) -> None:
    """Fetches the BLS ZIP file from blsdb.de with a session cookie and token."""
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    opener.addheaders = [("User-Agent", USER_AGENT)]

    def page(url: str) -> str:
        with opener.open(url, timeout=60) as response:
            return html.unescape(response.read().decode("utf-8", "replace"))

    log(f"Loading {START_PAGE}")
    start = page(START_PAGE)
    link = re.search(r'href="([^"]*download\?token=[^"]+)"', start)
    if not link:
        raise SystemExit("The link 'Download BLS-Daten' was not found on blsdb.de/search.")
    download_page_url = urljoin(BASE, link.group(1))

    log("Loading the download page")
    download_page = page(download_page_url)
    link = re.search(r'href="([^"]+\.zip[^"]*)"', download_page, re.IGNORECASE)
    if not link:
        raise SystemExit("No ZIP file was found on the download page of blsdb.de.")
    zip_url = urljoin(BASE, link.group(1))

    log(f"Loading {zip_url.split('?')[0]}")
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    request = urllib.request.Request(zip_url, headers={"Referer": download_page_url})
    with opener.open(request, timeout=300) as response, open(partial, "wb") as handle:
        while chunk := response.read(1 << 20):
            handle.write(chunk)
    if not zipfile.is_zipfile(partial):
        raise SystemExit(f"The response from blsdb.de is not a ZIP file (see {partial}).")
    partial.replace(target)
    log(f"Saved: {target} ({target.stat().st_size:,} bytes)")


def read_workbook_bytes(zip_path: Path) -> bytes:
    """Reads the data table from the ZIP file without unpacking it to disk."""
    with zipfile.ZipFile(zip_path) as archive:
        names = [n for n in archive.namelist() if n.endswith(DATA_SUFFIX)]
        if not names:
            names = [
                n for n in archive.namelist()
                if n.lower().endswith(".xlsx") and "components" not in n.lower()
            ]
        if len(names) != 1:
            raise SystemExit(f"Data table in {zip_path} is ambiguous: {names}")
        log(f"Reading {names[0]}")
        return archive.read(names[0])


# ---------------------------------------------------------------- Conversion

def parse_value(cell: object, markers: Counter) -> float | None:
    """Number from a BLS cell. None means: no value."""
    if cell is None or isinstance(cell, bool):
        return None
    if isinstance(cell, (int, float)):
        return float(cell) if math.isfinite(cell) else None
    text = str(cell).strip()
    if text in MISSING:
        return None
    if TRACE_RE.match(text):
        markers[text] += 1
        return 0.0
    try:
        value = float(text.replace(",", "."))
    except ValueError:
        markers[f"unknown: {text}"] += 1
        return None
    return value if math.isfinite(value) else None


def round_half_up(value: float, digits: int) -> int | float:
    """Round half up; whole values as an integer (saves space in the JSON file)."""
    quantum = Decimal(1).scaleb(-digits)
    rounded = Decimal(repr(value)).quantize(quantum, rounding=ROUND_HALF_UP)
    if rounded == rounded.to_integral_value():
        return int(rounded)
    return float(rounded)


def locate_columns(header: tuple) -> dict[str, tuple[int, str]]:
    """Component code -> (column index, unit), read from the header row."""
    columns: dict[str, tuple[int, str]] = {}
    for index, cell in enumerate(header):
        match = HEADER_RE.match(str(cell or "").strip())
        if match:
            columns.setdefault(match.group(1), (index, match.group(2)))
    return columns


def build_rows(workbook_bytes: bytes) -> tuple[list[list], dict]:
    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(workbook_bytes), read_only=True, data_only=True)
    sheet = workbook.worksheets[0]
    rows_iter = sheet.iter_rows(values_only=True)
    header = next(rows_iter)

    labels = [str(c or "").strip() for c in header[:3]]
    if labels[0] != "BLS Code" or labels[1] != "Lebensmittelbezeichnung":
        raise SystemExit(f"Unexpected header row: {labels}")

    columns = locate_columns(header)
    used: dict[str, str] = {"id": labels[0], "name": labels[1]}
    index_of: dict[str, int] = {}
    for field, (code, unit, _digits) in COMPONENTS.items():
        if code not in columns:
            if field == "salt":
                continue  # then from sodium
            raise SystemExit(f"Column {code} is missing in the BLS table.")
        index, found_unit = columns[code]
        if found_unit != unit:
            raise SystemExit(f"Column {code}: unit {found_unit!r} instead of {unit!r}.")
        index_of[field] = index
        used[field] = str(header[index]).strip()

    sodium_index = None
    if SODIUM[0] in columns:
        sodium_index, sodium_unit = columns[SODIUM[0]]
        if sodium_unit != SODIUM[1]:
            raise SystemExit(f"Column NA: unit {sodium_unit!r} instead of 'mg'.")
        used["sodium"] = str(header[sodium_index]).strip()
    if "salt" not in index_of and sodium_index is None:
        raise SystemExit("Neither NACL nor NA found in the BLS table.")

    markers: Counter = Counter()
    dropped: Counter = Counter()
    nulls: Counter = Counter()
    seen: set[str] = set()
    rows: list[list] = []
    total = 0

    for raw in rows_iter:
        if raw is None or all(cell is None for cell in raw[:3]):
            continue
        total += 1
        code = str(raw[0] or "").strip()
        name = " ".join(str(raw[1] or "").split())
        if not code or not name:
            dropped["without code or name"] += 1
            continue
        if code in seen:
            dropped["duplicate code"] += 1
            continue

        values: dict[str, float | None] = {}
        for field in COMPONENTS:
            if field in index_of:
                values[field] = parse_value(raw[index_of[field]], markers)

        # Salt: the NACL column in the BLS is always calculated from sodium (NA x 2.5).
        # If sodium is missing, it still holds 0 there - that would be a false zero.
        if sodium_index is not None:
            sodium = parse_value(raw[sodium_index], markers)
            if sodium is None:
                values["salt"] = None
            elif values.get("salt") is None:
                values["salt"] = sodium * 2.5 / 1000

        missing = [field for field in REQUIRED if values.get(field) is None]
        if missing:
            dropped["without " + "/".join(missing)] += 1
            continue

        row: list = [code, name]
        for field in FIELDS[2:]:
            value = values.get(field)
            if value is None:
                nulls[field] += 1
                row.append(None)
            else:
                row.append(round_half_up(value, COMPONENTS[field][2]))
        seen.add(code)
        rows.append(row)

    rows.sort(key=lambda r: r[0])
    stats = {"total": total, "dropped": dropped, "nulls": nulls, "markers": markers, "columns": used}
    return rows, stats


def write_json(path: Path, payload: dict) -> bytes:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description="BLS 4.0 -> public/data/bls.json")
    parser.add_argument("--zip", type=Path, help="use an already downloaded BLS ZIP file")
    parser.add_argument("--xlsx", type=Path, help="use an already unpacked data table")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="folder for the download")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="target file")
    parser.add_argument("--refresh", action="store_true", help="download again even if a download exists")
    args = parser.parse_args()
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(errors="replace")

    if args.xlsx:
        workbook_bytes = args.xlsx.read_bytes()
    else:
        zip_path = args.zip or (args.cache / ZIP_NAME)
        if not args.zip and (args.refresh or not zip_path.exists()):
            download_zip(zip_path)
        workbook_bytes = read_workbook_bytes(zip_path)

    rows, stats = build_rows(workbook_bytes)
    payload = {
        "source": "bls",
        "version": "4.0",
        "license": "CC BY 4.0",
        "attribution": "Bundeslebensmittelschlüssel 4.0, Max Rubner-Institut",
        "modified": True,
        "fields": FIELDS,
        "rows": rows,
    }
    data = write_json(args.out, payload)

    log("")
    log("Columns used:")
    for field, column in stats["columns"].items():
        log(f"  {field:8} <- {column}")
    log(f"Rows in the table: {stats['total']}")
    for reason, count in stats["dropped"].most_common():
        log(f"  removed ({reason}): {count}")
    log(f"Rows in {args.out.name}: {len(rows)}")
    log("Missing values (null): " + (", ".join(f"{k} {v}" for k, v in sorted(stats["nulls"].items())) or "none"))
    log("Counted as 0: " + (", ".join(f"{k!r} {v}x" for k, v in stats["markers"].most_common()) or "nothing"))
    log(f"{args.out}: {len(data):,} bytes, gzip {len(gzip.compress(data, 9)):,} bytes")


if __name__ == "__main__":
    main()
