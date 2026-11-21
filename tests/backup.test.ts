import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BackupError,
  FORMAT_VERSION,
  backupFileName,
  exportData,
  importData,
  parseBackup,
} from '../src/lib/backup';
import { AppDB, TABLES, fresh, type Dish, type Entry, type Food, type Goal, type Weight } from '../src/lib/db';

let counter = 0;
function openDb(): AppDB {
  return new AppDB(`test-${++counter}`);
}

async function seed(database: AppDB) {
  const oats: Food = {
    ...fresh(),
    source: 'bls',
    sourceId: 'C133000',
    name: 'Haferflocken',
    unit: 'g',
    per100: { kcal: 370, protein: 13.5, carbs: 58.7, fat: 7, fiber: 10, sugar: 0.7, satFat: 1.3, salt: 0.02 },
    portions: [{ label: 'Tablespoon', amount: 10 }],
    lastAmount: 60,
    useCount: 3,
    lastUsedAt: 1_700_000_000_000,
  };
  const skyr: Food = {
    ...fresh(),
    source: 'own',
    barcode: '4008400402222',
    name: 'Plain skyr',
    brand: 'Brand',
    unit: 'g',
    per100: { kcal: 64, protein: 11, carbs: 4, fat: 0.2 },
    portions: [],
    useCount: 0,
  };
  const dish: Dish = {
    ...fresh(),
    name: 'Lentil bolognese',
    ingredients: [{ foodId: oats.id, amount: 200 }],
    cookedWeight: 1450,
    portions: 4,
    useCount: 1,
  };
  const entry: Entry = {
    ...fresh(),
    date: '2026-11-21',
    meal: 0,
    kind: 'food',
    refId: oats.id,
    name: 'Haferflocken',
    amount: 60,
    unit: 'g',
    nutrients: { kcal: 222, protein: 8.1, carbs: 35.2, fat: 4.2 },
    source: 'bls',
    createdAt: 1_700_000_000_000,
  };
  const removed: Entry = { ...entry, ...fresh(), deleted: 1, name: 'Deleted entry' };
  const weight: Weight = { ...fresh(), date: '2026-11-21', kg: 81.4 };
  const goal: Goal = { ...fresh(), validFrom: '2026-11-01', kcal: 2200, protein: 140, carbs: 250, fat: 70 };

  await database.foods.bulkAdd([oats, skyr]);
  await database.dishes.add(dish);
  await database.templates.add({ ...fresh(), name: 'Breakfast', items: [{ kind: 'food', refId: oats.id, amount: 60 }] });
  await database.entries.bulkAdd([entry, removed]);
  await database.weights.add(weight);
  await database.goals.add(goal);
  await database.settings.bulkAdd([
    { key: 'mealNames', value: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'], updatedAt: 1 },
    { key: 'profile', value: { heightCm: 180, birthYear: 1995, sex: 'm', pal: 1.6 }, updatedAt: 2 },
  ]);
}

function sortRows<T extends { id?: string; key?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)));
}

describe('backup', () => {
  let source: AppDB;

  beforeEach(async () => {
    source = openDb();
    await seed(source);
  });

  it('contains the app id, the version and all tables', async () => {
    const file = await exportData(source);
    expect(file.app).toBe('anotherpound');
    expect(file.formatVersion).toBe(FORMAT_VERSION);
    expect(Object.keys(file.tables).sort()).toEqual([...TABLES].sort());
    expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false);
    expect(file.tables.entries).toHaveLength(2);
  });

  it('comes back without loss after export, file and import', async () => {
    const exported = await exportData(source);
    const target = openDb();
    await importData(parseBackup(JSON.stringify(exported)), target);
    const again = await exportData(target);
    for (const name of TABLES) {
      expect(sortRows(again.tables[name]), name).toEqual(sortRows(exported.tables[name]));
    }
  });

  it('keeps deleted records with their deletion mark', async () => {
    const target = openDb();
    await importData(parseBackup(JSON.stringify(await exportData(source))), target);
    const removed = await target.entries.filter((entry) => entry.deleted === 1).toArray();
    expect(removed.map((entry) => entry.name)).toEqual(['Deleted entry']);
  });

  it('replaces the existing data completely', async () => {
    const target = openDb();
    await target.weights.add({ ...fresh(), date: '2020-01-01', kg: 99 });
    await target.settings.put({ key: 'old', value: true, updatedAt: 1 });
    await importData(parseBackup(JSON.stringify(await exportData(source))), target);
    expect(await target.weights.count()).toBe(1);
    expect((await target.weights.toArray())[0]?.kg).toBe(81.4);
    expect(await target.settings.get('old')).toBeUndefined();
  });

  it('leaves the data untouched when the import fails', async () => {
    const target = openDb();
    await target.weights.add({ ...fresh(), date: '2020-01-01', kg: 99 });
    const file = parseBackup(JSON.stringify(await exportData(source)));
    const first = file.tables.foods[0]!;
    file.tables.foods.push({ ...first }); // duplicate id
    await expect(importData(file, target)).rejects.toThrow();
    expect(await target.weights.count()).toBe(1);
    expect((await target.weights.toArray())[0]?.kg).toBe(99);
    expect(await target.foods.count()).toBe(0);
  });
});

describe('parseBackup', () => {
  const valid = () => ({
    app: 'anotherpound',
    formatVersion: FORMAT_VERSION,
    exportedAt: '2026-11-21T10:00:00.000Z',
    tables: Object.fromEntries(TABLES.map((name) => [name, []])),
  });

  function codeOf(text: string): string {
    try {
      parseBackup(text);
    } catch (error) {
      if (error instanceof BackupError) return error.code;
      throw error;
    }
    return 'ok';
  }

  it('accepts an empty, valid backup', () => {
    expect(codeOf(JSON.stringify(valid()))).toBe('ok');
  });

  it('reports unreadable files', () => {
    expect(codeOf('not json')).toBe('not-json');
  });

  it('reports files from elsewhere', () => {
    expect(codeOf('{"foo":1}')).toBe('not-a-backup');
    expect(codeOf('[]')).toBe('not-a-backup');
    expect(codeOf(JSON.stringify({ ...valid(), app: 'another-app' }))).toBe('not-a-backup');
  });

  it('reports backups from newer versions', () => {
    expect(codeOf(JSON.stringify({ ...valid(), formatVersion: FORMAT_VERSION + 1 }))).toBe('too-new');
  });

  it('reports damaged backups', () => {
    const missingTable = valid();
    delete (missingTable.tables as Record<string, unknown>).entries;
    expect(codeOf(JSON.stringify(missingTable))).toBe('damaged');

    const badRow = valid();
    (badRow.tables as Record<string, unknown[]>).foods = [{ name: 'no id' }];
    expect(codeOf(JSON.stringify(badRow))).toBe('damaged');

    const badSetting = valid();
    (badSetting.tables as Record<string, unknown[]>).settings = [{ id: 'x', value: 1 }];
    expect(codeOf(JSON.stringify(badSetting))).toBe('damaged');

    expect(codeOf(JSON.stringify({ ...valid(), formatVersion: 0 }))).toBe('damaged');
    expect(codeOf(JSON.stringify({ ...valid(), tables: [] }))).toBe('damaged');
  });
});

describe('file name', () => {
  it('carries the local date', () => {
    expect(backupFileName(new Date(2026, 10, 21, 23, 30))).toBe('anotherpound-2026-11-21.json');
    expect(backupFileName(new Date(2027, 0, 5))).toBe('anotherpound-2027-01-05.json');
  });
});
