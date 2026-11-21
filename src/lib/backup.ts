import { db, TABLES, type AppDB, type TableName } from './db';

/**
 * Backup file.
 *
 * The format is at once a backup, a way to move to a later app and the basis
 * of a later sync. Every change to the structure raises FORMAT_VERSION and
 * gets a step in MIGRATIONS, so old files stay readable.
 */
export const APP_ID = 'anotherpound';
export const FORMAT_VERSION = 1;

export interface BackupFile {
  app: typeof APP_ID;
  formatVersion: number;
  exportedAt: string;
  tables: Record<TableName, Record<string, unknown>[]>;
}

export type BackupErrorCode = 'not-json' | 'not-a-backup' | 'too-new' | 'damaged';

export class BackupError extends Error {
  constructor(public code: BackupErrorCode) {
    super(code);
    this.name = 'BackupError';
  }
}

/** Step n lifts a file from version n to n + 1. */
const MIGRATIONS: Record<number, (file: BackupFile) => BackupFile> = {};

export async function exportData(database: AppDB = db): Promise<BackupFile> {
  const tables = {} as BackupFile['tables'];
  await database.transaction('r', database.tables, async () => {
    for (const name of TABLES) {
      tables[name] = (await database.table(name).toArray()) as Record<string, unknown>[];
    }
  });
  return { app: APP_ID, formatVersion: FORMAT_VERSION, exportedAt: new Date().toISOString(), tables };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads and checks a backup file and lifts it to the current format. */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('not-json');
  }
  if (!isRecord(raw) || raw.app !== APP_ID || typeof raw.formatVersion !== 'number') {
    throw new BackupError('not-a-backup');
  }
  if (raw.formatVersion > FORMAT_VERSION) throw new BackupError('too-new');
  if (!Number.isInteger(raw.formatVersion) || raw.formatVersion < 1 || !isRecord(raw.tables)) {
    throw new BackupError('damaged');
  }

  let file = raw as unknown as BackupFile;
  for (let v = file.formatVersion; v < FORMAT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new BackupError('damaged');
    file = step(file);
  }

  for (const name of TABLES) {
    const rows = file.tables[name];
    if (!Array.isArray(rows)) throw new BackupError('damaged');
    const key = name === 'settings' ? 'key' : 'id';
    for (const row of rows) {
      if (!isRecord(row) || typeof row[key] !== 'string' || row[key] === '') throw new BackupError('damaged');
    }
  }
  return { ...file, formatVersion: FORMAT_VERSION };
}

/** Replaces all data with the backup. All or nothing. */
export async function importData(file: BackupFile, database: AppDB = db): Promise<void> {
  await database.transaction('rw', database.tables, async () => {
    for (const name of TABLES) {
      const table = database.table(name);
      await table.clear();
      await table.bulkAdd(file.tables[name]);
    }
  });
}

export function backupFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `anotherpound-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.json`;
}

export type SaveResult = 'shared' | 'downloaded' | 'cancelled';

/** Hands over the file: through the share sheet on a phone, otherwise as a download. */
export async function saveBackup(file: BackupFile): Promise<SaveResult> {
  const name = backupFileName();
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });

  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch && typeof navigator.canShare === 'function') {
    const shareFile = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare({ files: [shareFile] })) {
      try {
        await navigator.share({ files: [shareFile], title: name });
        return 'shared';
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
        // Sharing failed: offer it as a download below.
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
