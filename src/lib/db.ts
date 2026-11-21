import Dexie, { type Table } from 'dexie';

/**
 * Data model of AnotherPound.
 *
 * Every record carries a unique ID, a change timestamp and
 * a deletion flag. This makes a later sync between devices possible
 * without breaking the format. Records are therefore deleted by flag, not removed.
 */
export interface Base {
  id: string;
  updatedAt: number;
  deleted: 0 | 1;
}

/** Nutrients. In `per100` per 100 g or 100 ml, absolute in diary entries. */
export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar?: number;
  satFat?: number;
  fiber?: number;
  salt?: number;
  /** Only for the value check, not shown. */
  alcohol?: number;
}

export type Unit = 'g' | 'ml';

/** bls = Bundeslebensmittelschlüssel, off = Open Food Facts, own = created by the user. */
export type FoodSource = 'bls' | 'off' | 'own';

export interface Portion {
  label: string;
  /** Amount in the food's base unit. */
  amount: number;
}

export interface Food extends Base {
  source: FoodSource;
  /** BLS key or ID in the source. */
  sourceId?: string;
  /** A food of your own with a barcode takes precedence over the database entry with the same barcode. */
  barcode?: string;
  name: string;
  brand?: string;
  /** Package size as text, for example "500 g". */
  quantity?: string;
  unit: Unit;
  per100: Nutrients;
  portions: Portion[];
  lastAmount?: number;
  /** Last entered in pieces: label of the unit and count. If both are missing, grams were used. */
  lastPortion?: string;
  lastCount?: number;
  useCount: number;
  lastUsedAt?: number;
  /** Time of retrieval from the source. */
  fetchedAt?: number;
}

export interface Ingredient {
  foodId: string;
  /** Raw weight in the food's base unit. */
  amount: number;
}

export interface Dish extends Base {
  name: string;
  ingredients: Ingredient[];
  /** Weight of the finished dish in g. If missing, the sum of the raw weights applies. */
  cookedWeight?: number;
  portions?: number;
  lastAmount?: number;
  lastPortion?: string;
  lastCount?: number;
  useCount: number;
  lastUsedAt?: number;
}

export interface TemplateItem {
  kind: 'food' | 'dish';
  refId: string;
  amount: number;
}

export interface Template extends Base {
  name: string;
  items: TemplateItem[];
}

export type Meal = 0 | 1 | 2 | 3;

export interface Entry extends Base {
  /** Local date as YYYY-MM-DD. */
  date: string;
  meal: Meal;
  kind: 'food' | 'dish' | 'quick';
  refId?: string;
  /** Frozen at the time of the entry, like the nutrients. */
  name: string;
  amount?: number;
  unit?: Unit;
  /** Entered in pieces: label and count. `amount` stays the amount in grams or milliliters. */
  portion?: string;
  count?: number;
  nutrients: Nutrients;
  source?: FoodSource;
  createdAt: number;
}

export interface Weight extends Base {
  date: string;
  kg: number;
}

export interface Goal extends Base {
  /** Applies from this date until a newer goal begins. */
  validFrom: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface Setting {
  key: string;
  value: unknown;
  updatedAt: number;
}

/** Queued webhook message, in the order it was created. */
export interface OutboxItem {
  seq?: number;
  createdAt: number;
  attempts: number;
  /** Finished message as JSON text. */
  body: string;
}

/** Setting or state that belongs to this device. */
export interface DeviceValue {
  key: string;
  value: unknown;
}

/** Tables of the backup file. `outbox` and `device` are deliberately not part of it. */
export const TABLES = ['foods', 'dishes', 'templates', 'entries', 'weights', 'goals', 'settings'] as const;
export type TableName = (typeof TABLES)[number];

export class AppDB extends Dexie {
  foods!: Table<Food, string>;
  dishes!: Table<Dish, string>;
  templates!: Table<Template, string>;
  entries!: Table<Entry, string>;
  weights!: Table<Weight, string>;
  goals!: Table<Goal, string>;
  settings!: Table<Setting, string>;
  /** Only on this device, never in the backup: webhook queue. */
  outbox!: Table<OutboxItem, number>;
  /** Only on this device, never in the backup: webhook address, secret and send state. */
  device!: Table<DeviceValue, string>;

  constructor(name = 'anotherpound') {
    super(name);
    this.version(1).stores({
      foods: 'id, barcode, source, lastUsedAt, useCount',
      dishes: 'id, lastUsedAt',
      templates: 'id',
      entries: 'id, date, [date+meal]',
      weights: 'id, date',
      goals: 'id, validFrom',
      settings: 'key',
    });
    this.version(2).stores({
      outbox: '++seq',
      device: 'key',
    });
  }
}

export const db = new AppDB();

export function newId(): string {
  return crypto.randomUUID();
}

/** Base fields for a new record. */
export function fresh(): Base {
  return { id: newId(), updatedAt: Date.now(), deleted: 0 };
}

export async function getSetting<T>(key: string, database: AppDB = db): Promise<T | undefined> {
  const row = await database.settings.get(key);
  return row?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown, database: AppDB = db): Promise<void> {
  await database.settings.put({ key, value, updatedAt: Date.now() });
}
