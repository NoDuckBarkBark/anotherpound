# Data scripts

The two scripts build the bundled food data in `public/data/`.
Raw data goes to `.cache/` (listed in `.gitignore`), never to `public/` or `scripts/`.

Requirements: Python 3.11 or newer with `openpyxl` and `duckdb` (`pip install openpyxl duckdb`).
Run from the project folder, with `-I`, because the scripts read downloaded files:

```
python -I scripts/build_bls.py
python -I scripts/build_off_starter.py
```

## build_bls.py → public/data/bls.json

Downloads the Bundeslebensmittelschlüssel 4.0 from https://blsdb.de (ZIP, 14 MB) to `.cache/bls/`
and writes all foods with energy, protein, carbs and fat, sorted by BLS code.

- blsdb.de only hands out the file with a session cookie and token. The script therefore opens
  the search page first and follows the link "Download BLS-Daten". If that stops working: download the ZIP by hand
  and pass it with `--zip path\BLS_4_0_2025_DE.zip`.
- `--refresh` downloads again, even if the ZIP file is already in the cache.
- "-" in the table means "no value" and becomes `null`. "TR", "<LOD" and "<LOQ" (traces, below the
  limit of detection) are counted as 0.

## build_off_starter.py → public/data/off-starter.json

Downloads the Parquet dump of Open Food Facts from Hugging Face (`openfoodfacts/product-database`,
about 8 GB) to `.cache/off/food.parquet` and writes the 10,000 most scanned products
with country Germany that have complete and plausible nutrients.

- `--refresh` downloads the dump again (it is updated daily).
- `--limit 10000` changes the number of products, `--date YYYY-MM-DD` the value of `generatedAt`.
- `--rank scans` orders by `unique_scans_n`, that is by scans worldwide.
  `--rank de` (default) orders first by the tier of scans from Germany (tags like
  `top-5000-de-scans-2026`) and only then by `unique_scans_n`.

Both scripts print at the end which columns were used and how many rows were removed and why.
The licenses of the data are in `public/data/LICENSE-DATA.md`.

## icons/

Sources of the app icon. The PNG files in `public/icons/` and `public/favicon.svg` are made from them with Inkscape:

```sh
cp scripts/icons/icon.svg public/favicon.svg
inkscape scripts/icons/icon.svg -o public/icons/icon-192.png -w 192 -h 192
inkscape scripts/icons/icon.svg -o public/icons/icon-512.png -w 512 -h 512
inkscape scripts/icons/icon-maskable.svg -o public/icons/maskable-512.png -w 512 -h 512
inkscape scripts/icons/icon-maskable.svg -o public/icons/apple-touch-icon.png -w 180 -h 180
```
