# Data scripts

The two scripts build the bundled food data in `public/data/`.
Raw data goes to `.cache/` (listed in `.gitignore`), never to `public/` or `scripts/`.

Requirements: Python 3.11 or newer with `openpyxl` and `duckdb` (`pip install openpyxl duckdb`).
Run from the project folder, with `-I`, because the scripts read downloaded files:

```
python -I scripts/build_bls.py
python -I scripts/build_off_packs.py
```

## build_bls.py → public/data/bls.json

Downloads the Bundeslebensmittelschlüssel 4.0 from https://blsdb.de (ZIP, 14 MB) to `.cache/bls/`
and writes all foods with their German and English names, energy, protein, carbs and fat, sorted by BLS code.

- blsdb.de only hands out the file with a session cookie and token. The script therefore opens
  the search page first and follows the link "Download BLS-Daten". If that stops working: download the ZIP by hand
  and pass it with `--zip path\BLS_4_0_2025_DE.zip`.
- `--refresh` downloads again, even if the ZIP file is already in the cache.
- "-" in the table means "no value" and becomes `null`. "TR", "<LOD" and "<LOQ" (traces, below the
  limit of detection) are counted as 0.

## build_off_packs.py → public/data/off/<country>.json

Downloads the Parquet dump of Open Food Facts from Hugging Face (`openfoodfacts/product-database`,
about 8 GB) to `.cache/off/food.parquet` and writes one file per country: up to 10,000 of the most
scanned products sold there that have complete and plausible nutrients.

- Without arguments it builds all countries. `build_off_packs.py DE AT CH` builds only these.
  The countries are listed in `COUNTRIES` in the script and in `src/lib/regions.ts`.
- Products are ordered by the scan tier of the country (tags like `top-5000-de-scans-2025`),
  then by `unique_scans_n`. `--year` picks the year of the tags; the default is last year,
  because the tags of the running year are provisional.
- The name is taken in a language of the country, otherwise the main name.
- `--refresh` downloads the dump again (it is updated daily).
- `--limit 10000` changes the number of products, `--date YYYY-MM-DD` the value of `generatedAt`.

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
