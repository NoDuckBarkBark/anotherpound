import {
  db,
  fresh,
  type AppDB,
  type Dish,
  type Entry,
  type Food,
  type Meal,
  type Portion,
  type Template,
  type TemplateItem,
} from './db';
import { dishPer100, forAmount, scale } from './nutrition';
import { notify } from './webhook';
import { keepStorage } from './storage';

/** Meal that fits the time of day. */
export function mealForTime(now = new Date()): Meal {
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour >= 4 && hour < 11) return 0;
  if (hour >= 11 && hour < 15) return 1;
  if (hour >= 17 && hour < 22) return 2;
  return 3;
}

/**
 * Timestamp for the order in the diary. Also increases when several entries are created in
 * the same millisecond (template, copied meal); otherwise their order would be random.
 */
let lastStamp = 0;
function nextStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

/** Asks the browser once not to delete the data on its own. */
let persistAsked = false;
function askToPersist(): void {
  if (persistAsked) return;
  persistAsked = true;
  void keepStorage();
}

export async function foodsById(ids: string[], database: AppDB = db): Promise<Map<string, Food>> {
  const rows = await database.foods.bulkGet([...new Set(ids)]);
  return new Map(rows.filter((row): row is Food => row !== undefined).map((row) => [row.id, row]));
}

/** Stores a food from the bundled catalog in the database, if it is not there yet. */
export async function ensureFood(food: Food, database: AppDB = db): Promise<Food> {
  const existing = await database.foods.get(food.id);
  if (existing && !existing.deleted) return existing;
  const stored: Food = { ...food, deleted: 0, updatedAt: Date.now() };
  await database.foods.put(stored);
  return stored;
}

/** Entered in pieces: label of the unit and count. */
export interface Counted {
  label: string;
  count: number;
}

/** Saves the servings of a food; one from the base catalog is adopted in the process. */
export async function savePortions(food: Food, portions: Portion[], database: AppDB = db): Promise<void> {
  const stored = await ensureFood(food, database);
  await database.foods.update(stored.id, { portions, updatedAt: Date.now() });
}

/**
 * `via` records whether the entry was made in pieces: a value remembers the unit for next time,
 * `null` resets to grams, and if omitted the remembered unit stays as it is.
 */
export async function logFood(
  food: Food,
  amount: number,
  meal: Meal,
  date: string,
  database: AppDB = db,
  via?: Counted | null,
): Promise<Entry> {
  askToPersist();
  const now = nextStamp();
  const entry: Entry = {
    ...fresh(),
    date,
    meal,
    kind: 'food',
    refId: food.id,
    name: food.name,
    amount,
    unit: food.unit,
    ...(via ? { portion: via.label, count: via.count } : {}),
    nutrients: forAmount(food.per100, amount),
    source: food.source,
    createdAt: now,
  };
  await database.transaction('rw', database.foods, database.entries, async () => {
    const existing = await database.foods.get(food.id);
    await database.foods.put({
      ...food,
      deleted: 0,
      lastAmount: amount,
      ...(via === undefined ? {} : { lastPortion: via?.label, lastCount: via?.count }),
      useCount: (existing?.useCount ?? food.useCount ?? 0) + 1,
      lastUsedAt: now,
      updatedAt: now,
    });
    await database.entries.add(entry);
  });
  notify({ event: 'entry.created', entry }, database);
  return entry;
}

export async function logDish(
  dish: Dish,
  amount: number,
  meal: Meal,
  date: string,
  database: AppDB = db,
  via?: Counted | null,
): Promise<Entry> {
  askToPersist();
  const now = nextStamp();
  const foods = await foodsById(
    dish.ingredients.map((ingredient) => ingredient.foodId),
    database,
  );
  const entry: Entry = {
    ...fresh(),
    date,
    meal,
    kind: 'dish',
    refId: dish.id,
    name: dish.name,
    amount,
    unit: 'g',
    ...(via ? { portion: via.label, count: via.count } : {}),
    nutrients: forAmount(dishPer100(dish, foods), amount),
    createdAt: now,
  };
  await database.transaction('rw', database.dishes, database.entries, async () => {
    await database.dishes.update(dish.id, {
      lastAmount: amount,
      ...(via === undefined ? {} : { lastPortion: via?.label, lastCount: via?.count }),
      useCount: (dish.useCount ?? 0) + 1,
      lastUsedAt: now,
      updatedAt: now,
    });
    await database.entries.add(entry);
  });
  notify({ event: 'entry.created', entry }, database);
  return entry;
}

export interface QuickInput {
  name: string;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export async function logQuick(input: QuickInput, meal: Meal, date: string, database: AppDB = db): Promise<Entry> {
  askToPersist();
  const entry: Entry = {
    ...fresh(),
    date,
    meal,
    kind: 'quick',
    name: input.name,
    nutrients: {
      kcal: input.kcal,
      protein: input.protein ?? 0,
      carbs: input.carbs ?? 0,
      fat: input.fat ?? 0,
    },
    createdAt: nextStamp(),
  };
  await database.entries.add(entry);
  notify({ event: 'entry.created', entry }, database);
  return entry;
}

/** Adds several items as individual entries, for example from a template. */
export async function logItems(
  items: TemplateItem[],
  meal: Meal,
  date: string,
  database: AppDB = db,
): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const item of items) {
    if (!(item.amount > 0)) continue;
    if (item.kind === 'food') {
      const food = await database.foods.get(item.refId);
      if (!food) continue;
      entries.push(await logFood(food, item.amount, meal, date, database));
    } else {
      const dish = await database.dishes.get(item.refId);
      if (!dish) continue;
      entries.push(await logDish(dish, item.amount, meal, date, database));
    }
  }
  return entries;
}

/** Changes amount and meal of an entry. The frozen values are recalculated with the amount. */
export async function updateEntry(
  entry: Entry,
  changes: { amount?: number; meal?: Meal; quick?: QuickInput },
  database: AppDB = db,
): Promise<void> {
  const patch: Partial<Entry> = { updatedAt: Date.now() };
  if (changes.meal !== undefined) patch.meal = changes.meal;
  if (changes.quick && entry.kind === 'quick') {
    patch.name = changes.quick.name;
    patch.nutrients = {
      kcal: changes.quick.kcal,
      protein: changes.quick.protein ?? 0,
      carbs: changes.quick.carbs ?? 0,
      fat: changes.quick.fat ?? 0,
    };
  }
  if (changes.amount !== undefined && entry.amount && entry.amount > 0 && changes.amount > 0) {
    patch.amount = changes.amount;
    patch.nutrients = scale(entry.nutrients, changes.amount / entry.amount);
    if (entry.count) patch.count = Math.round(((entry.count * changes.amount) / entry.amount) * 100) / 100;
  }
  await database.entries.update(entry.id, patch);
  notify({ event: 'entry.updated', entry: { ...entry, ...patch } }, database);
}

export async function removeEntry(id: string, database: AppDB = db): Promise<void> {
  await database.entries.update(id, { deleted: 1, updatedAt: Date.now() });
  notifyEntry('entry.deleted', id, database);
}

export async function restoreEntry(id: string, database: AppDB = db): Promise<void> {
  await database.entries.update(id, { deleted: 0, updatedAt: Date.now() });
  notifyEntry('entry.created', id, database);
}

/** Reports an entry that exists only as an ID; it is read in the background. */
function notifyEntry(event: 'entry.created' | 'entry.deleted', id: string, database: AppDB): void {
  notify(async () => {
    const entry = await database.entries.get(id);
    return entry ? { event, entry } : undefined;
  }, database);
}

export async function mealEntries(date: string, meal: Meal, database: AppDB = db): Promise<Entry[]> {
  const rows = await database.entries.where('[date+meal]').equals([date, meal]).toArray();
  return rows.filter((row) => !row.deleted).sort((a, b) => a.createdAt - b.createdAt);
}

/** Copies the entries of a meal to another day. Returns the new entries. */
export async function copyMeal(
  fromDate: string,
  toDate: string,
  meal: Meal,
  database: AppDB = db,
): Promise<Entry[]> {
  const source = await mealEntries(fromDate, meal, database);
  const copies: Entry[] = source.map((entry) => ({
    ...entry,
    ...fresh(),
    date: toDate,
    createdAt: nextStamp(),
  }));
  await database.entries.bulkAdd(copies);
  for (const entry of copies) notify({ event: 'entry.created', entry }, database);
  return copies;
}

/** Saves the entries of a meal as a template. Quick entries have no food and are dropped. */
export async function saveMealAsTemplate(
  date: string,
  meal: Meal,
  name: string,
  database: AppDB = db,
): Promise<Template | undefined> {
  const items: TemplateItem[] = (await mealEntries(date, meal, database)).flatMap((entry) =>
    entry.kind !== 'quick' && entry.refId && entry.amount
      ? [{ kind: entry.kind, refId: entry.refId, amount: entry.amount }]
      : [],
  );
  if (!items.length) return undefined;
  const template: Template = { ...fresh(), name, items };
  await database.templates.add(template);
  return template;
}
