import { dayKey } from './dates';
import { db, getSetting, type AppDB } from './db';

/** A backup counts as due after this many days, once there are entries it does not contain. */
export const BACKUP_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Asks the browser to keep the data. This protects against the browser clearing it on its
 * own. It does not protect against the user clearing the browser's site data; only a backup
 * file does. Browsers decide by themselves and favour installed apps, so the app asks at
 * every start until the answer is yes.
 */
export async function keepStorage(): Promise<boolean | undefined> {
  try {
    const storage = globalThis.navigator?.storage;
    if (!storage?.persist) return undefined;
    return ((await storage.persisted?.()) ?? false) || (await storage.persist());
  } catch {
    return undefined;
  }
}

/**
 * True when the diary has entries that the last backup file does not contain and that
 * backup is at least a week old. Without any backup, the first diary day counts.
 */
export async function backupDue(now = Date.now(), database: AppDB = db): Promise<boolean> {
  const last = await getSetting<number>('lastExportAt', database);
  if (last === undefined) {
    const first = await database.entries.orderBy('date').first();
    return first !== undefined && now - first.createdAt >= BACKUP_DAYS * DAY;
  }
  if (now - last < BACKUP_DAYS * DAY) return false;
  const newer = await database.entries
    .where('date')
    .aboveOrEqual(dayKey(new Date(last)))
    .filter((entry) => entry.createdAt > last)
    .first();
  return newer !== undefined;
}
