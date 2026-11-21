import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Choice } from '../src/lib/catalog';
import { AppDB, fresh, type Dish, type Food } from '../src/lib/db';
import { logDish, logFood, mealEntries, savePortions, updateEntry } from '../src/lib/diary';
import { countable, countablePortions, formatCount, startFor } from '../src/lib/portions';

let counter = 0;
const openDb = () => new AppDB(`portions-${++counter}`);

function ownFood(name: string, extra: Partial<Food> = {}): Food {
  return { ...fresh(), source: 'own', name, unit: 'g', per100: { kcal: 380, protein: 0, carbs: 94, fat: 1 }, portions: [], useCount: 0, ...extra };
}

/** Loads the module the way a German device would. */
async function loadGerman() {
  vi.resetModules();
  vi.stubGlobal('navigator', { userAgent: 'node', language: 'de-DE', languages: ['de-DE'] });
  return import('../src/lib/portions');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('countable servings', () => {
  /** In the language of the interface, which is English in the tests. */
  const one = (label: string, amount: number) => countable({ label, amount }, 'Serving');
  const german = (label: string, amount: number) => countable({ label, amount }, 'Portion', 'de');
  const english = (label: string, amount: number) => countable({ label, amount }, 'Serving', 'en');

  it('reads the word and the weight of one piece from free text', () => {
    expect(german('1 pastille (0.9 g)', 0.9)).toEqual({ label: 'Pastille', amount: 0.9 });
    expect(german('2 Stück (30g)', 30)).toEqual({ label: 'Stück', amount: 15 });
    expect(german('1 Riegel = 25 g', 25)).toEqual({ label: 'Riegel', amount: 25 });
    expect(german('1 Stück ca. 30 g', 30)).toEqual({ label: 'Stück', amount: 30 });
    expect(german('30 g (2 Scheiben)', 30)).toEqual({ label: 'Scheiben', amount: 15 });
    expect(german('0,5 Tafel (50 g)', 50)).toEqual({ label: 'Tafel', amount: 100 });
    expect(german('3 x Keks', 36)).toEqual({ label: 'Keks', amount: 12 });
    expect(german('Becher', 150)).toEqual({ label: 'Becher', amount: 150 });
    expect(german('1 Tablette, 6,0 g', 6)).toEqual({ label: 'Tablette', amount: 6 });
    expect(german('1 Glas 250 ml (250 ml)', 250)).toEqual({ label: 'Glas', amount: 250 });
    expect(german('1 spring roll (100 g)', 100)).toEqual({ label: 'Spring roll', amount: 100 });
  });

  it('maps common English words to German', () => {
    expect(german('4 pieces (15.8 g)', 15.8)).toEqual({ label: 'Stück', amount: 3.95 });
    expect(german('1 bar (28.5 g)', 28.5)).toEqual({ label: 'Riegel', amount: 28.5 });
    expect(german('1 Slice (23 g)', 23)).toEqual({ label: 'Scheibe', amount: 23 });
    expect(german('75 g (1 bun)', 75)).toEqual({ label: 'Brötchen', amount: 75 });
  });

  it('maps common German words to English', () => {
    expect(english('1 pastille (0.9 g)', 0.9)).toEqual({ label: 'Pastille', amount: 0.9 });
    expect(english('2 Stück (30g)', 30)).toEqual({ label: 'Piece', amount: 15 });
    expect(english('1 Riegel = 25 g', 25)).toEqual({ label: 'Bar', amount: 25 });
    expect(english('1 Stück ca. 30 g', 30)).toEqual({ label: 'Piece', amount: 30 });
    expect(english('30 g (2 Scheiben)', 30)).toEqual({ label: 'Slices', amount: 15 });
    expect(english('1 Scheibe (23 g)', 23)).toEqual({ label: 'Slice', amount: 23 });
    expect(english('3 x Keks', 36)).toEqual({ label: 'Cookie', amount: 12 });
    expect(english('Becher', 150)).toEqual({ label: 'Cup', amount: 150 });
    expect(english('1 Tablette, 6,0 g', 6)).toEqual({ label: 'Tablet', amount: 6 });
    expect(english('1 Glas 250 ml (250 ml)', 250)).toEqual({ label: 'Glass', amount: 250 });
    expect(english('75 g (1 Brötchen)', 75)).toEqual({ label: 'Bun', amount: 75 });
    expect(english('2 EL (30 g)', 30)).toEqual({ label: 'tbsp', amount: 15 });
    expect(english('1 tbsp (15 g)', 15)).toEqual({ label: 'tbsp', amount: 15 });
    expect(english('1 Tsp (5 g)', 5)).toEqual({ label: 'tsp', amount: 5 });
  });

  it('capitalises words it does not know', () => {
    expect(english('4 pieces (15.8 g)', 15.8)).toEqual({ label: 'Pieces', amount: 3.95 });
    expect(english('1 bar (28.5 g)', 28.5)).toEqual({ label: 'Bar', amount: 28.5 });
    expect(english('1 spring roll (100 g)', 100)).toEqual({ label: 'Spring roll', amount: 100 });
    expect(english('0,5 Tafel (50 g)', 50)).toEqual({ label: 'Tafel', amount: 100 });
    expect(german('1 wrap (60 g)', 60)).toEqual({ label: 'Wrap', amount: 60 });
  });

  it('follows the interface language by default', async () => {
    expect(countable({ label: '2 Stück (30g)', amount: 30 }, 'Serving')).toEqual({ label: 'Piece', amount: 15 });
    expect(countablePortions([{ label: '1 Riegel (25 g)', amount: 25 }], 'Serving')).toEqual([{ label: 'Bar', amount: 25 }]);

    const inGerman = await loadGerman();
    expect(inGerman.countable({ label: '1 bar (28.5 g)', amount: 28.5 }, 'Portion')).toEqual({ label: 'Riegel', amount: 28.5 });
    expect(inGerman.countablePortions([{ label: '1 slice (23 g)', amount: 23 }], 'Portion')).toEqual([{ label: 'Scheibe', amount: 23 }]);
  });

  it('calls bare amounts, nameless servings and anything unreadable "Serving"', () => {
    expect(one('15 g', 15)).toEqual({ label: 'Serving', amount: 15 });
    expect(one('250 ml', 250)).toEqual({ label: 'Serving', amount: 250 });
    expect(one('100.0g', 100)).toEqual({ label: 'Serving', amount: 100 });
    expect(one('1/2 Packung (200 g)', 200)).toEqual({ label: 'Serving', amount: 200 });
    expect(one('2 x 15 g', 30)).toEqual({ label: 'Serving', amount: 30 });
    expect(one('1 serving (30 g)', 30)).toEqual({ label: 'Serving', amount: 30 });
    expect(one('1 portion (30 g', 30)).toEqual({ label: 'Serving', amount: 30 });
    expect(one('5 portions (100 g)', 100)).toEqual({ label: 'Serving', amount: 20 });
    expect(one('1 portion mixed with 237', 12.5)).toEqual({ label: 'Serving', amount: 12.5 });
    expect(one('Füllmenge 530 g / Abtrop', 300)).toEqual({ label: 'Serving', amount: 300 });
  });

  it('is not fooled by brackets, asterisks and broken characters', () => {
    expect(one('115 g (115 g (Pro Becher', 115)).toEqual({ label: 'Serving', amount: 115 });
    expect(one('250 ml (250 ml pro Porti', 250)).toEqual({ label: 'Serving', amount: 250 });
    expect(one('250 ml (zubereitet) = 15', 250)).toEqual({ label: 'Serving', amount: 250 });
    expect(one('12.5 g (KINDER CHOCOLAT)', 12.5)).toEqual({ label: 'Serving', amount: 12.5 });
    expect(one('100 g* (100 g)', 100)).toEqual({ label: 'Serving', amount: 100 });
    expect(one('500г,', 500)).toEqual({ label: 'Serving', amount: 500 });
    expect(one('1 br�tchen (90 g)', 90)).toEqual({ label: 'Serving', amount: 90 });
  });

  it('lists every label once and leaves out "Serving · 100 g"', () => {
    const units = countablePortions(
      [
        { label: '100 g', amount: 100 },
        { label: 'Slice', amount: 50 },
        { label: '1 Scheibe (45 g)', amount: 45 },
        { label: '30 g', amount: 30 },
        { label: 'Empty', amount: 0 },
      ],
      'Serving',
    );
    expect(units).toEqual([
      { label: 'Slice', amount: 50 },
      { label: 'Serving', amount: 30 },
    ]);

    const germanUnits = countablePortions(
      [
        { label: '100 g', amount: 100 },
        { label: 'Scheibe', amount: 50 },
        { label: '1 slice (45 g)', amount: 45 },
        { label: '30 g', amount: 30 },
        { label: 'Leer', amount: 0 },
      ],
      'Portion',
      'de',
    );
    expect(germanUnits).toEqual([
      { label: 'Scheibe', amount: 50 },
      { label: 'Portion', amount: 30 },
    ]);
  });

  it('writes counts with a multiplication sign, numbers the way the language does', async () => {
    expect(formatCount(3, 'Pastille')).toBe('3 × Pastille');
    expect(formatCount(1.5, 'Slice')).toBe('1.5 × Slice');
    expect((await loadGerman()).formatCount(1.5, 'Scheibe')).toBe('1,5 × Scheibe');
  });
});

describe('start of the amount entry', () => {
  const food = (extra: Partial<Food>): Choice => ({ kind: 'food', food: ownFood('Test', extra) });
  const dish = (extra: Partial<Dish>): Choice => ({
    kind: 'dish',
    dish: { ...fresh(), name: 'Stew', ingredients: [{ foodId: 'x', amount: 1000 }], useCount: 0, ...extra },
  });

  it('opens the way it was last time', () => {
    const pieces = food({ portions: [{ label: 'Piece', amount: 60 }], lastPortion: 'Piece', lastCount: 2, lastAmount: 120 });
    expect(startFor(pieces, 'Serving')).toEqual({ portion: { label: 'Piece', amount: 60 }, value: 2, amount: 120 });
    const grams = food({ portions: [{ label: 'Piece', amount: 60 }], lastAmount: 75 });
    expect(startFor(grams, 'Serving')).toEqual({ value: 75, amount: 75 });
  });

  it("uses today's weight per piece when the serving was changed", () => {
    const changed = food({ portions: [{ label: 'Piece', amount: 55 }], lastPortion: 'Piece', lastCount: 2, lastAmount: 120 });
    expect(startFor(changed, 'Serving').amount).toBe(110);
  });

  it('recognises the remembered unit by its size after a change of language', () => {
    const portions = [
      { label: '100 g', amount: 100 },
      { label: '2 Stück (30 g)', amount: 30 },
    ];
    const remembered = food({ portions, lastPortion: 'Stück', lastCount: 3, lastAmount: 45 });
    expect(startFor(remembered, 'Serving')).toEqual({ portion: { label: 'Piece', amount: 15 }, value: 3, amount: 45 });
  });

  it('falls back to grams when the remembered unit no longer exists', () => {
    const gone = food({ portions: [], lastPortion: 'Piece', lastCount: 2, lastAmount: 120 });
    expect(startFor(gone, 'Serving')).toEqual({ value: 120, amount: 120 });
  });

  it('takes one piece the first time, the serving size for bare gram amounts, otherwise 100', () => {
    expect(startFor(food({ portions: [{ label: '1 bar (25 g)', amount: 25 }] }), 'Serving')).toEqual({
      portion: { label: 'Bar', amount: 25 },
      value: 1,
      amount: 25,
    });
    expect(startFor(food({ portions: [{ label: '15 g', amount: 15 }] }), 'Serving')).toEqual({ value: 15, amount: 15 });
    expect(startFor(food({}), 'Serving')).toEqual({ value: 100, amount: 100 });
  });

  it('opens a dish with servings at one serving', () => {
    expect(startFor(dish({ portions: 4 }), 'Serving')).toEqual({ portion: { label: 'Serving', amount: 250 }, value: 1, amount: 250 });
    expect(startFor(dish({}), 'Serving')).toEqual({ value: 100, amount: 100 });
  });
});

describe('logging in pieces', () => {
  it('records count and grams and remembers the unit', async () => {
    const database = openDb();
    const drops = ownFood('Mint drops', { portions: [{ label: 'Pastille', amount: 1.2 }] });
    const entry = await logFood(drops, 3.6, 3, '2026-11-21', database, { label: 'Pastille', count: 3 });
    expect(entry).toMatchObject({ amount: 3.6, portion: 'Pastille', count: 3 });
    expect(entry.nutrients.kcal).toBeCloseTo(13.68);
    expect(await database.foods.get(drops.id)).toMatchObject({ lastAmount: 3.6, lastPortion: 'Pastille', lastCount: 3 });

    // Without one (from a template, for example) the remembered unit stays.
    await logFood((await database.foods.get(drops.id))!, 10, 3, '2026-11-21', database);
    expect(await database.foods.get(drops.id)).toMatchObject({ lastAmount: 10, lastPortion: 'Pastille', lastCount: 3 });

    // Logged in grams on purpose: back to grams.
    const plain = await logFood((await database.foods.get(drops.id))!, 10, 3, '2026-11-21', database, null);
    expect(plain.count).toBeUndefined();
    const stored = await database.foods.get(drops.id);
    expect(stored!.lastPortion).toBeUndefined();
    expect(stored!.lastCount).toBeUndefined();
  });

  it('recalculates the count when the entry is changed', async () => {
    const database = openDb();
    const drops = ownFood('Mint drops', { portions: [{ label: 'Pastille', amount: 1.2 }] });
    const entry = await logFood(drops, 3.6, 3, '2026-11-21', database, { label: 'Pastille', count: 3 });
    await updateEntry(entry, { amount: 6 }, database);
    const [changed] = await mealEntries('2026-11-21', 3, database);
    expect(changed).toMatchObject({ amount: 6, count: 5, portion: 'Pastille' });
    expect(changed!.nutrients.kcal).toBeCloseTo(22.8);
  });

  it('remembers servings of a dish', async () => {
    const database = openDb();
    const lentils = ownFood('Lentils');
    await database.foods.add(lentils);
    const stew: Dish = { ...fresh(), name: 'Stew', ingredients: [{ foodId: lentils.id, amount: 200 }], cookedWeight: 1000, portions: 4, useCount: 0 };
    await database.dishes.add(stew);
    const entry = await logDish(stew, 500, 1, '2026-11-21', database, { label: 'Serving', count: 2 });
    expect(entry).toMatchObject({ amount: 500, portion: 'Serving', count: 2 });
    expect(await database.dishes.get(stew.id)).toMatchObject({ lastPortion: 'Serving', lastCount: 2 });
    await logDish((await database.dishes.get(stew.id))!, 300, 1, '2026-11-21', database, null);
    expect((await database.dishes.get(stew.id))!.lastPortion).toBeUndefined();
  });

  it('saves a new serving on a food from the base catalog too', async () => {
    const database = openDb();
    const apple: Food = { ...ownFood('Apfel roh'), id: 'bls:F1', source: 'bls' };
    expect(await database.foods.count()).toBe(0);
    await savePortions(apple, [{ label: 'Piece', amount: 150 }], database);
    expect((await database.foods.get('bls:F1'))!.portions).toEqual([{ label: 'Piece', amount: 150 }]);
  });
});
