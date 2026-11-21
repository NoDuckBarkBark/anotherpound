# Licenses of the food data

The files in this folder are third-party data and are not covered by the license of the program code.

## bls.json

Contains data from the Bundeslebensmittelschlüssel (BLS) 4.0.
Publisher: Max Rubner-Institut, Karlsruhe (https://blsdb.de).
License: Creative Commons Attribution 4.0 International (CC BY 4.0),
https://creativecommons.org/licenses/by/4.0/

Changes: the data was converted to JSON and reduced to the German and English names and part of the nutrients
(energy, protein, carbohydrates, sugars, fat, saturated fatty acids, fibre, salt, alcohol).
The values are rounded. Entries without a value for energy, protein, carbohydrates or fat are left out.

Citation asked for by the publisher: Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS),
Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0

## off/<country>.json

Extracts from the Open Food Facts database (https://openfoodfacts.org), one file per country.
The database is under the Open Database License (ODbL) 1.0,
https://opendatacommons.org/licenses/odbl/1-0/
Individual contents are under the Database Contents License (DbCL) 1.0,
https://opendatacommons.org/licenses/dbcl/1-0/

These extracts are offered under the ODbL 1.0 as well.
Each contains a selection of products sold in that country, with shortened and rounded values.
They are built with scripts/build_off_packs.py.
