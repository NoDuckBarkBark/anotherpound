import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blsFoods,
  indexCatalog as indexIn,
  normalize,
  offFoods,
  search as searchIn,
  type Choice,
} from '../src/lib/catalog';
import { AppDB, fresh, type Dish, type Food } from '../src/lib/db';
import {
  copyMeal,
  ensureFood,
  logDish,
  logFood,
  logItems,
  logQuick,
  mealEntries,
  mealForTime,
  removeEntry,
  saveMealAsTemplate,
  updateEntry,
} from '../src/lib/diary';
import { fetchProduct, foodFromOff, searchProducts } from '../src/lib/off';

// The catalog in these tests is German, so the German search rules apply.
const indexCatalog = (bls: Food[], off: Food[]) => indexIn(bls, off, 'de');
const search = (query: string, local: Choice[], catalog: ReturnType<typeof indexIn>) =>
  searchIn(query, local, catalog, 40, 'de');

let counter = 0;
const openDb = () => new AppDB(`data-${++counter}`);

function ownFood(name: string, per100: Food['per100'], extra: Partial<Food> = {}): Food {
  return { ...fresh(), source: 'own', name, unit: 'g', per100, portions: [], useCount: 0, ...extra };
}

describe('diary', () => {
  it('freezes name and values and remembers the last amount', async () => {
    const database = openDb();
    const oats = ownFood('Oats', { kcal: 370, protein: 13.5, carbs: 58.7, fat: 7 });
    const entry = await logFood(oats, 60, 0, '2026-11-21', database);
    expect(entry.nutrients.kcal).toBeCloseTo(222);

    const stored = await database.foods.get(oats.id);
    expect(stored).toMatchObject({ lastAmount: 60, useCount: 1 });

    await database.foods.update(oats.id, { name: 'Renamed', per100: { kcal: 1, protein: 1, carbs: 1, fat: 1 } });
    const [kept] = await mealEntries('2026-11-21', 0, database);
    expect(kept!.name).toBe('Oats');
    expect(kept!.nutrients.kcal).toBeCloseTo(222);

    await logFood((await database.foods.get(oats.id))!, 40, 0, '2026-11-21', database);
    expect((await database.foods.get(oats.id))!.useCount).toBe(2);
  });

  it('saves a food from the base catalog on first use', async () => {
    const database = openDb();
    const [apple] = blsFoods({ fields: ['id', 'name', 'kcal', 'protein', 'carbs', 'fat'], rows: [['F110100', 'Apfel roh', 55, 0.3, 11.4, 0.4]] });
    expect(await database.foods.count()).toBe(0);
    await logFood(apple!, 150, 3, '2026-11-21', database);
    expect((await database.foods.get('bls:F110100'))?.source).toBe('bls');
    await ensureFood(apple!, database);
    expect(await database.foods.count()).toBe(1);
  });

  it('recalculates a changed amount and moves the meal', async () => {
    const database = openDb();
    const entry = await logFood(ownFood('Skyr', { kcal: 64, protein: 11, carbs: 4, fat: 0.2 }), 150, 0, '2026-11-21', database);
    await updateEntry(entry, { amount: 300, meal: 2 }, database);
    const [changed] = await mealEntries('2026-11-21', 2, database);
    expect(changed!.amount).toBe(300);
    expect(changed!.nutrients.kcal).toBeCloseTo(192);
    expect(changed!.nutrients.protein).toBeCloseTo(33);
    expect(await mealEntries('2026-11-21', 0, database)).toHaveLength(0);
  });

  it('deletes by mark and copies a meal to another day', async () => {
    const database = openDb();
    const skyr = ownFood('Skyr', { kcal: 64, protein: 11, carbs: 4, fat: 0.2 });
    const a = await logFood(skyr, 150, 0, '2026-11-20', database);
    await logQuick({ name: 'Canteen', kcal: 700, protein: 30 }, 0, '2026-11-20', database);
    const gone = await logFood(skyr, 99, 0, '2026-11-20', database);
    await removeEntry(gone.id, database);

    expect(await database.entries.count()).toBe(3);
    expect(await mealEntries('2026-11-20', 0, database)).toHaveLength(2);

    expect(await copyMeal('2026-11-20', '2026-11-21', 0, database)).toHaveLength(2);
    const copies = await mealEntries('2026-11-21', 0, database);
    expect(copies.map((c) => c.name)).toEqual(['Skyr', 'Canteen']);
    expect(copies[0]!.id).not.toBe(a.id);
    expect(copies[1]!.nutrients).toEqual({ kcal: 700, protein: 30, carbs: 0, fat: 0 });
  });

  it('logs a dish by grams and leaves old entries untouched when it changes', async () => {
    const database = openDb();
    const lentils = await ensureFood(ownFood('Lentils', { kcal: 350, protein: 24, carbs: 50, fat: 1.5 }), database);
    const dish: Dish = {
      ...fresh(),
      name: 'Lentil stew',
      ingredients: [{ foodId: lentils.id, amount: 200 }],
      cookedWeight: 1000,
      useCount: 0,
    };
    await database.dishes.add(dish);

    const entry = await logDish(dish, 300, 1, '2026-11-21', database);
    expect(entry.nutrients.kcal).toBeCloseTo(210);
    expect((await database.dishes.get(dish.id))!.lastAmount).toBe(300);

    await database.dishes.update(dish.id, { cookedWeight: 500 });
    const [kept] = await mealEntries('2026-11-21', 1, database);
    expect(kept!.nutrients.kcal).toBeCloseTo(210);
    const again = await logDish((await database.dishes.get(dish.id))!, 300, 1, '2026-11-21', database);
    expect(again.nutrients.kcal).toBeCloseTo(420);
  });

  it('saves a meal as a template and logs it again', async () => {
    const database = openDb();
    const oats = ownFood('Oats', { kcal: 370, protein: 13.5, carbs: 58.7, fat: 7 });
    const milk = ownFood('Milk', { kcal: 47, protein: 3.4, carbs: 4.9, fat: 1.5 }, { unit: 'ml' });
    await logFood(oats, 60, 0, '2026-11-20', database);
    await logFood(milk, 200, 0, '2026-11-20', database);
    await logQuick({ name: 'Cookie', kcal: 80 }, 0, '2026-11-20', database);

    const template = await saveMealAsTemplate('2026-11-20', 0, 'Breakfast', database);
    expect(template?.items).toHaveLength(2);
    expect(await saveMealAsTemplate('2026-11-20', 3, 'Empty', database)).toBeUndefined();

    const items = template!.items.map((item) => (item.refId === milk.id ? { ...item, amount: 250 } : item));
    expect(await logItems([...items, { kind: 'food', refId: 'does-not-exist', amount: 10 }], 0, '2026-11-21', database)).toHaveLength(2);
    const logged = await mealEntries('2026-11-21', 0, database);
    expect(logged.map((e) => [e.name, e.amount, e.unit])).toEqual([
      ['Oats', 60, 'g'],
      ['Milk', 250, 'ml'],
    ]);
  });

  it('picks the meal by time of day', () => {
    const at = (h: number, m = 0) => mealForTime(new Date(2026, 10, 21, h, m));
    expect([at(7), at(10, 59), at(11), at(14, 59), at(15), at(18), at(21, 59), at(23), at(2)]).toEqual([0, 0, 1, 1, 3, 2, 2, 3, 3]);
  });
});

// The base catalog is German (Bundeslebensmittelschlüssel, products sold in Germany), so names and search words here are too.
describe('base catalog and search', () => {
  const bls = blsFoods({
    fields: ['id', 'name', 'kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'salt', 'alcohol'],
    rows: [
      ['C1', 'Haferflocken', 370, 13.5, 58.7, 0.7, 7, 1.3, 10, 0.02, 0],
      ['C2', 'Müsli mit Haferflocken und Nüssen', 420, 10, 55, 15, 15, 2, 8, 0.1, null],
      ['F1', 'Apfel roh', 55, 0.3, 11.4, 10.3, 0.4, 0.1, 2, 0, 0],
      ['F2', 'Apfelsaft', 46, 0.1, 10.6, 10, 0.1, null, null, null, null],
    ],
  });
  const off = offFoods({
    fields: ['code', 'name', 'brand', 'quantity', 'unit', 'kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'salt', 'servingLabel', 'servingAmount'],
    rows: [
      ['4008400402222', 'Nutella', 'Ferrero', '450 g', 'g', 539, 6.3, 57.5, 56.3, 30.9, 10.6, null, 0.11, '15 g', 15],
      ['4000000000013', 'Haferflocken zart', 'Kölln', '500 g', 'g', 361, 14, 56, 1.2, 6.7, 1.3, 10, 0.01, null, null],
      ['4000000000020', 'Apfelschorle', 'Brand', '1 l', 'ml', 24, 0, 5.6, 5.5, 0, 0, null, 0, '250 ml', 250],
    ],
  });
  const catalog = indexCatalog(bls, off);
  const names = (list: Choice[]) => list.map((c) => (c.kind === 'food' ? c.food.name : c.dish.name));

  it('reads the data files', () => {
    expect(bls[0]).toMatchObject({ id: 'bls:C1', source: 'bls', unit: 'g', per100: { kcal: 370, fiber: 10, alcohol: 0 } });
    expect(bls[3]!.per100.satFat).toBeUndefined();
    expect(off[0]).toMatchObject({ id: 'off:4008400402222', barcode: '4008400402222', brand: 'Ferrero', quantity: '450 g' });
    expect(off[0]!.portions).toEqual([{ label: '15 g', amount: 15 }]);
    expect(off[1]!.portions).toEqual([]);
    expect(off[2]!.unit).toBe('ml');
  });

  it('normalises spellings', () => {
    expect(normalize('Müsli, Äpfel & Straße')).toBe('musli apfel strasse');
    expect(normalize('  Crème fraîche 30%  ')).toBe('creme fraiche 30');
  });

  it('puts the start of the name before the start of a word and BLS before Open Food Facts', () => {
    expect(names(search('hafer', [], catalog))).toEqual(['Haferflocken', 'Haferflocken zart', 'Müsli mit Haferflocken und Nüssen']);
    expect(names(search('apfel', [], catalog))).toEqual(['Apfel roh', 'Apfelsaft', 'Apfelschorle']);
  });

  it('finds names written as two words when typed as one, and the other way round', () => {
    const split = blsFoods({
      fields: ['id', 'name', 'kcal', 'protein', 'carbs', 'fat'],
      rows: [
        ['C133000', 'Hafer Flocken', 348, 13.2, 53.3, 6.7],
        ['V416100', 'Hähnchen Brustfilet, roh', 109, 23.3, 0, 1.8],
      ],
    });
    const index = indexCatalog(split, off);
    expect(names(search('haferflocken', [], index))).toEqual(['Hafer Flocken', 'Haferflocken zart']);
    expect(names(search('hähnchenbrust', [], index))).toEqual(['Hähnchen Brustfilet, roh']);
    expect(names(search('hafer flocken zart', [], index))).toEqual(['Haferflocken zart']);
  });

  it('puts the food itself before compounds and preparations', () => {
    const basics = blsFoods({
      fields: ['id', 'name', 'kcal', 'protein', 'carbs', 'fat'],
      rows: [
        ['C1', 'Reisrand', 120, 2, 25, 1],
        ['C2', 'Reis Mehl', 350, 7, 78, 1],
        ['C3', 'Reis poliert, roh', 350, 7, 78, 1],
        ['C4', 'Reis gekocht', 130, 3, 28, 0],
        ['C5', 'Milchreis', 120, 3, 20, 3],
        ['B1', 'Brotaufstrich Tomate', 200, 5, 10, 15],
        ['B2', 'Vollkornbrot', 210, 7, 38, 1],
        ['V1', 'Rind Hackfleisch, roh', 220, 20, 0, 15],
        ['Y1', 'Hackfleischsauce', 150, 8, 5, 10],
        ['E1', 'Hühnerei roh', 137, 12, 1, 9],
        ['E2', 'Eiswein', 120, 0, 12, 0],
        ['F1', 'Erdbeere roh', 32, 1, 6, 0],
        ['T1', 'Teigwaren eifrei, gekocht', 150, 5, 30, 1],
        ['M1', 'Milch fettarm, frisch, 1,5 % Fett, pasteurisiert', 47, 3, 5, 2],
        ['M2', 'Milchschokolade', 530, 7, 55, 30],
      ],
    });
    const index = indexCatalog(basics, []);
    const first = (query: string, count = 1) => names(search(query, [], index)).slice(0, count);

    expect(first('reis', 5)).toEqual(['Reis gekocht', 'Reis poliert, roh', 'Milchreis', 'Reis Mehl', 'Reisrand']);
    expect(first('brot', 2)).toEqual(['Vollkornbrot', 'Brotaufstrich Tomate']);
    expect(first('hackfleisch', 2)).toEqual(['Rind Hackfleisch, roh', 'Hackfleischsauce']);
    expect(first('milch', 3)).toEqual(['Milch fettarm, frisch, 1,5 % Fett, pasteurisiert', 'Milchreis', 'Milchschokolade']);
    expect(first('reis gekocht')).toEqual(['Reis gekocht']);
  });

  it('knows plurals and everyday words', () => {
    const basics = blsFoods({
      fields: ['id', 'name', 'kcal', 'protein', 'carbs', 'fat'],
      rows: [
        ['E2', 'Eiswein', 120, 0, 12, 0],
        ['E1', 'Hühnerei roh', 137, 12, 1, 9],
        ['F1', 'Erdbeere roh', 32, 1, 6, 0],
        ['K1', 'Kartoffel geschält, gekocht', 70, 2, 15, 0],
        ['T1', 'Teigwaren eifrei, gekocht', 150, 5, 30, 1],
      ],
    });
    const index = indexCatalog(basics, []);
    const found = (query: string) => names(search(query, [], index));

    expect(found('ei')).toEqual(['Hühnerei roh', 'Eiswein', 'Teigwaren eifrei, gekocht']);
    expect(found('eier')).toEqual(['Hühnerei roh']);
    expect(found('erdbeeren')).toEqual(['Erdbeere roh']);
    expect(found('kartoffeln')).toEqual(['Kartoffel geschält, gekocht']);
    expect(found('nudeln')).toEqual(['Teigwaren eifrei, gekocht']);
  });

  it('alternates in blocks between BLS and products at equal quality', () => {
    const many = blsFoods({
      fields: ['id', 'name', 'kcal', 'protein', 'carbs', 'fat'],
      rows: Array.from({ length: 12 }, (_, i) => [`J${i}`, `Joghurt Sorte ${String.fromCharCode(97 + i)}`, 60, 4, 5, 3]),
    });
    const products = offFoods({
      fields: ['code', 'name', 'brand', 'quantity', 'unit', 'kcal', 'protein', 'carbs', 'fat'],
      rows: [['4000000000037', 'Joghurt Becher', 'Brand', '150 g', 'g', 70, 4, 6, 3]],
    });
    const found = names(search('joghurt', [], indexCatalog(many, products)));
    expect(found).toHaveLength(13);
    expect(found.indexOf('Joghurt Becher')).toBe(8);
  });

  it('keeps own entries in front only when the search word hits a word there', () => {
    const rice = ownFood('Basmatireis', { kcal: 350, protein: 7, carbs: 78, fat: 1 }, { lastUsedAt: 3 });
    const egg = blsFoods({ fields: ['id', 'name', 'kcal', 'protein', 'carbs', 'fat'], rows: [['E1', 'Hühnerei roh', 137, 12, 1, 9]] });
    const found = names(search('ei', [{ kind: 'food', food: rice }], indexCatalog(egg, [])));
    expect(found).toEqual(['Hühnerei roh', 'Basmatireis']);
    expect(names(search('reis', [{ kind: 'food', food: rice }], indexCatalog(egg, [])))).toEqual(['Basmatireis']);
  });

  it('requires all search words and finds brands', () => {
    expect(names(search('musli nuss', [], catalog))).toEqual(['Müsli mit Haferflocken und Nüssen']);
    expect(names(search('ferrero', [], catalog))).toEqual(['Nutella']);
    expect(search('doesnotexist', [], catalog)).toEqual([]);
    expect(search('   ', [], catalog)).toEqual([]);
  });

  it('shows own entries first and hides duplicates from the base catalog', () => {
    const mine = ownFood('Hafermilch', { kcal: 45, protein: 1, carbs: 7, fat: 1.5 }, { lastUsedAt: 5 });
    const usedBls = { ...bls[0]!, lastUsedAt: 9, useCount: 3 };
    const corrected = ownFood('Nutella (corrected)', { kcal: 540, protein: 6, carbs: 57, fat: 31 }, { barcode: '4008400402222' });
    const dish: Dish = { ...fresh(), name: 'Haferbrei', ingredients: [], useCount: 1, lastUsedAt: 7 };
    const local: Choice[] = [
      { kind: 'food', food: mine },
      { kind: 'food', food: usedBls },
      { kind: 'food', food: corrected },
      { kind: 'dish', dish },
    ];
    expect(names(search('hafer', local, catalog))).toEqual([
      'Haferflocken',
      'Haferbrei',
      'Hafermilch',
      'Haferflocken zart',
      'Müsli mit Haferflocken und Nüssen',
    ]);
    expect(names(search('nutella', local, catalog))).toEqual(['Nutella (corrected)']);
  });
});

describe('Open Food Facts', () => {
  const product = {
    code: '4008400402222',
    product_name: 'Nutella',
    product_name_en: 'Hazelnut spread',
    product_name_de: 'Nuss-Nougat-Creme',
    brands: 'Ferrero, Nutella',
    quantity: '450 g',
    serving_size: '15 g',
    serving_quantity: 15,
    nutriments: {
      'energy-kcal_100g': 539,
      energy_100g: 2252,
      proteins_100g: 6.3,
      carbohydrates_100g: 57.5,
      sugars_100g: 56.3,
      fat_100g: 30.9,
      'saturated-fat_100g': 10.6,
      salt_100g: 0.107,
    },
  };

  /** Remembers the address of the last request and answers with the given products. */
  function searchTarget(products: unknown[]) {
    const seen = { url: '' };
    const fetcher = (async (input: RequestInfo | URL) => {
      seen.url = String(input);
      return new Response(JSON.stringify({ products }));
    }) as typeof fetch;
    return { seen, fetcher };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('converts a complete product', () => {
    const { food } = foodFromOff(product, 123);
    expect(food).toMatchObject({
      id: 'off:4008400402222',
      source: 'off',
      name: 'Hazelnut spread',
      brand: 'Ferrero',
      quantity: '450 g',
      unit: 'g',
      fetchedAt: 123,
      per100: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, sugar: 56.3, satFat: 10.6, salt: 0.11 },
      portions: [{ label: '15 g', amount: 15 }],
    });
    expect(food!.per100.fiber).toBeUndefined();
  });

  it('prefers the English product name, then the general one, then the German one', () => {
    expect(foodFromOff(product).food!.name).toBe('Hazelnut spread');
    expect(foodFromOff({ ...product, product_name_en: ' ' }).food!.name).toBe('Nutella');
    expect(foodFromOff({ ...product, product_name_en: undefined, product_name: '' }).food!.name).toBe('Nuss-Nougat-Creme');
  });

  it('converts kilojoules, but never reads the unspecified energy field as kcal', () => {
    const fromKj = foodFromOff({ ...product, nutriments: { ...product.nutriments, 'energy-kcal_100g': undefined, 'energy-kj_100g': 2255 } });
    expect(fromKj.food!.per100.kcal).toBeCloseTo(538.96, 2);
    const onlyGeneric = foodFromOff({ ...product, nutriments: { ...product.nutriments, 'energy-kcal_100g': '' } });
    expect(onlyGeneric.food).toBeUndefined();
    expect(onlyGeneric.draft.per100.kcal).toBeUndefined();
    expect(onlyGeneric.draft).toMatchObject({ name: 'Hazelnut spread', barcode: '4008400402222', per100: { protein: 6.3 } });
  });

  it('recognises drinks and converts sodium to salt', () => {
    const drink = foodFromOff({
      code: '4000000000020',
      product_name: 'Spritzer',
      quantity: '1,5 l',
      serving_size: '250 ml',
      serving_quantity: '250',
      nutriments: { 'energy-kcal_100g': '24', proteins_100g: 0, carbohydrates_100g: '5.6', fat_100g: 0, sodium_100g: 0.004 },
    });
    expect(drink.food).toMatchObject({ unit: 'ml', per100: { kcal: 24, carbs: 5.6, salt: 0.01 } });
    expect(drink.food!.portions).toEqual([{ label: '250 ml', amount: 250 }]);
  });

  it('reports found, incomplete, missing and offline', async () => {
    const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    expect((await fetchProduct('4008400402222', reply(200, { product }))).status).toBe('found');
    expect((await fetchProduct('4008400402222', reply(200, { product: { product_name: 'Name only' } }))).status).toBe('incomplete');
    expect((await fetchProduct('4008400402222', reply(200, { product: {} }))).status).toBe('missing');
    expect((await fetchProduct('4008400402222', reply(404, { status: 'failure' }))).status).toBe('missing');
    expect((await fetchProduct('4008400402222', reply(503, {}))).status).toBe('offline');
    const broken = (async () => {
      throw new TypeError('network');
    }) as typeof fetch;
    expect((await fetchProduct('4008400402222', broken)).status).toBe('offline');
  });

  it('searches by name in English among the products of the chosen country and leaves out incomplete hits', async () => {
    const { seen, fetcher } = searchTarget([product, { code: '4000000000013', product_name: 'No values' }]);
    const result = await searchProducts('hazelnut spread', fetcher);
    expect(result.status === 'ok' && result.foods.map((f) => f.name)).toEqual(['Hazelnut spread']);
    expect(seen.url).toContain('search_terms=hazelnut+spread');
    const params = new URL(seen.url).searchParams;
    expect(params.get('lc')).toBe('en');
    expect(params.get('tagtype_0')).toBe('countries');
    expect(params.get('tag_0')).toBe('united-kingdom');
  });

  it('prefers the German name and searches products sold in Germany on a German device', async () => {
    vi.resetModules();
    vi.stubGlobal('navigator', { userAgent: 'node', language: 'de-DE', languages: ['de-DE'] });
    const german = await import('../src/lib/off');
    expect(german.foodFromOff(product).food!.name).toBe('Nuss-Nougat-Creme');
    expect(german.foodFromOff({ ...product, product_name_de: undefined }).food!.name).toBe('Nutella');
    expect(german.foodFromOff({ ...product, product_name_de: undefined, product_name: '' }).food!.name).toBe('Hazelnut spread');

    const { seen, fetcher } = searchTarget([product, { code: '4000000000013', product_name: 'Ohne Werte' }]);
    const result = await german.searchProducts('nuss nougat', fetcher);
    expect(result.status === 'ok' && result.foods.map((f) => f.name)).toEqual(['Nuss-Nougat-Creme']);
    expect(seen.url).toContain('search_terms=nuss+nougat');
    expect(seen.url).toContain('tag_0=germany');
    const params = new URL(seen.url).searchParams;
    expect(params.get('lc')).toBe('de');
    expect(params.get('tagtype_0')).toBe('countries');
  });
});
