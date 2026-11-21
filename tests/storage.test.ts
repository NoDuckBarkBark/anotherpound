import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayKey } from '../src/lib/dates';
import { AppDB, setSetting, type Entry } from '../src/lib/db';
import { backupDue, keepStorage } from '../src/lib/storage';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 21, 12).getTime();

let counter = 0;
function openDb(): AppDB {
  return new AppDB(`storage-test-${++counter}`);
}

async function addEntry(database: AppDB, createdAt: number): Promise<void> {
  const entry = {
    id: `entry-${++counter}`,
    updatedAt: createdAt,
    deleted: 0,
    date: dayKey(new Date(createdAt)),
    meal: 0,
    kind: 'quick',
    name: 'Soup',
    nutrients: { kcal: 100, protein: 0, carbs: 0, fat: 0 },
    createdAt,
  } as unknown as Entry;
  await database.entries.add(entry);
}

describe('backup due', () => {
  it('is not due in an empty app', async () => {
    expect(await backupDue(NOW, openDb())).toBe(false);
  });

  it('without any backup, is due a week after the first entry', async () => {
    const database = openDb();
    await addEntry(database, NOW - 6 * DAY);
    expect(await backupDue(NOW, database)).toBe(false);
    expect(await backupDue(NOW + DAY, database)).toBe(true);
  });

  it('is not due within a week of the last backup', async () => {
    const database = openDb();
    await setSetting('lastExportAt', NOW - 6 * DAY, database);
    await addEntry(database, NOW - DAY);
    expect(await backupDue(NOW, database)).toBe(false);
  });

  it('is due after a week only if entries were added since the backup', async () => {
    const database = openDb();
    await addEntry(database, NOW - 9 * DAY);
    await setSetting('lastExportAt', NOW - 8 * DAY, database);
    expect(await backupDue(NOW, database)).toBe(false);

    await addEntry(database, NOW - DAY);
    expect(await backupDue(NOW, database)).toBe(true);
  });

  it('ignores entries made earlier on the day of the backup', async () => {
    const database = openDb();
    const backup = NOW - 8 * DAY;
    await addEntry(database, backup - 60_000);
    await setSetting('lastExportAt', backup, database);
    expect(await backupDue(NOW, database)).toBe(false);

    await addEntry(database, backup + 60_000);
    expect(await backupDue(NOW, database)).toBe(true);
  });
});

describe('persistent storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the browser to keep the data and reports the answer', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } });
    expect(await keepStorage()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('does not ask again once the storage is persistent', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => true, persist } });
    expect(await keepStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('copes with browsers that do not know the request or refuse it', async () => {
    vi.stubGlobal('navigator', {});
    expect(await keepStorage()).toBeUndefined();

    vi.stubGlobal('navigator', {
      storage: {
        persist: async () => {
          throw new Error('blocked');
        },
      },
    });
    expect(await keepStorage()).toBeUndefined();
  });
});
