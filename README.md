# AnotherPound

Calorie and macro tracker. A web app (PWA) that can be installed and works offline.

App: https://noduckbarkbark.github.io/anotherpound/

- Food diary with search and barcode scanner
- Basic foods in English and German, products for 30 European countries
- Dishes and templates
- Goals, weight, history
- Backup file, outgoing webhook
- English and German

## Data

Data is stored in the browser on the device (IndexedDB). Clearing the browser's site data deletes it. Backup and restore are under More → Backup.

## Develop

Requires Node 24 or newer and pnpm.

```sh
pnpm install
pnpm dev        # dev server
pnpm check      # type check
pnpm test       # unit tests
pnpm e2e        # flows at phone size (Playwright, Chromium)
pnpm build      # site into dist/
```

- `src/views/` – screens
- `src/lib/` – logic and components
- `src/lib/texts/` – all visible texts, one file per language
- `public/data/` – food data, built by the scripts in `scripts/`

## Webhook

Under More you can enter an address. The app then reports every change to it as JSON via `POST`. Address and header are stored on the device only and are not part of the backup file.

| `event` | Trigger | Record |
|---|---|---|
| `entry.created`, `entry.updated`, `entry.deleted` | Entry added (also copied or restored), changed, deleted | `entry` |
| `weight.set`, `weight.deleted` | Weight entered or deleted | `weight` |
| `goal.changed` | Goal saved | `goal` |
| `test` | "Test" button | – |

```json
{
  "app": "anotherpound",
  "format": 1,
  "appVersion": "0.6.0",
  "id": "3f0c6f0e-8f5b-4a51-9a35-0c1f6a2f7b11",
  "event": "entry.created",
  "time": "2026-11-21T12:30:00.000Z",
  "entry": {
    "id": "b0a4c1de-6f0a-4c58-8a57-0d6f2a9c1e22",
    "date": "2026-11-21",
    "meal": 0,
    "mealName": "Breakfast",
    "kind": "food",
    "name": "Mint drops",
    "amount": 3.6,
    "unit": "g",
    "portion": "Pastille",
    "count": 3,
    "nutrients": { "kcal": 13.7, "protein": 0.4, "carbs": 1.8, "fat": 0.2 }
  },
  "day": {
    "date": "2026-11-21",
    "total": { "kcal": 235.7, "protein": 6.4, "carbs": 31.8, "fat": 3.2 },
    "goal": { "kcal": 2200, "protein": 140, "carbs": 250, "fat": 70 }
  },
  "text": "Added: Mint drops, 3 × Pastille, 14 kcal (Breakfast). Day: 236 of 2,200 kcal.",
  "content": "Added: Mint drops, 3 × Pastille, 14 kcal (Breakfast). Day: 236 of 2,200 kcal."
}
```

- `format` goes up when fields change or disappear. New fields can be added without a new number.
- `id` is unique per message, so a message that arrives twice can be recognised.
- `time` is the moment of the change in UTC, `date` the day in the diary.
- `entry.kind` is `food`, `dish` or `quick`. Quick entries have no `amount` and `unit`; `portion` and `count` exist only for counted entries. `nutrients` can also contain `sugar`, `satFat`, `fiber` and `salt`.
- `weight` has `id`, `date`, `kg`. `goal` has `id`, `validFrom`, `kcal`, `protein`, `carbs`, `fat`.
- `day` is the total of the affected day at the time of the change. `day.goal` is `null` as long as no goal is set.
- `text` and `content` are the same readable line in the language of the interface, for services that only show text.

Delivery: right after the change, while the app is open. Whatever does not get out waits on the device and is sent later in the order of the changes (at start, when the connection returns, every minute). A message is dropped after 12 failed attempts or 7 days.

The target must be reachable over `https://`. If it allows calls from the browser (CORS, including the header if one is set), the message arrives as `application/json`. Otherwise the app sends the same JSON text as `text/plain`, provided no header is set; the target's answer is then not readable and the status shows "unconfirmed".

## Data sources

- [Open Food Facts](https://openfoodfacts.org), Open Database License (ODbL)
- [Bundeslebensmittelschlüssel 4.0](https://blsdb.de), Max Rubner-Institut, CC BY 4.0

## License

The code is under the [MIT License](LICENSE). Bundled food data keeps its own licenses.
