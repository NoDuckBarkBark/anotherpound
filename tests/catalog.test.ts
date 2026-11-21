import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blsFoods, indexCatalog, normalize, packPath, search, type Choice } from '../src/lib/catalog';
import { REGIONS } from '../src/lib/regions';

const names = (list: Choice[]) => list.map((c) => (c.kind === 'food' ? c.food.name : c.dish.name));
const read = (path: string) => JSON.parse(readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8'));

const FIELDS = ['id', 'name', 'nameEn', 'kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'salt', 'alcohol'];
const file = (rows: [string, string, string | null][]) => ({
  fields: FIELDS,
  rows: rows.map(([id, name, nameEn]) => [id, name, nameEn, 100, 1, 1, 1, 1, 1, 1, 0, 0]),
});

describe('basic foods in two languages', () => {
  const data = file([
    ['F1', 'Apfel roh', 'Apple raw'],
    ['F2', 'Apfelsaft', 'Apple juice'],
    ['X1', 'Nur deutsch', null],
  ]);

  it('names the foods in the language of the interface', () => {
    expect(names(blsFoods(data, 'en').map((food) => ({ kind: 'food', food })))).toEqual(['Apple raw', 'Apple juice', 'Nur deutsch']);
    expect(names(blsFoods(data, 'de').map((food) => ({ kind: 'food', food })))).toEqual(['Apfel roh', 'Apfelsaft', 'Nur deutsch']);
    expect(blsFoods(data)[0]!.name).toBe('Apple raw');
  });

  it('keeps the same id in both languages', () => {
    expect(blsFoods(data, 'en')[0]!.id).toBe(blsFoods(data, 'de')[0]!.id);
  });
});

describe('search in English', () => {
  const foods = blsFoods(
    file([
      ['A1', '', 'Apple raw'],
      ['A2', '', 'Apple juice'],
      ['A3', '', 'Apple-banana-pear sauce raw'],
      ['B1', '', 'Strawberry raw'],
      ['B2', '', 'Strawberry jam'],
      ['C1', '', 'Chicken breast fillet, raw'],
      ['C2', '', 'Chicken breast fillet fried'],
      ['C3', '', 'Chicken heart, raw'],
      ['D1', '', 'Yogurt min. 3.5 % fat'],
      ['D2', '', 'Yogurt dressing'],
      ['E1', '', 'Egg pasta boiled'],
      ['E2', '', 'Rice noodles raw'],
      ['G1', '', 'Tomato raw'],
      ['G2', '', 'Tomato paste'],
      ['H1', '', 'Buttermilk'],
      ['H2', '', 'Milk 3.5 % fat'],
    ]),
    'en',
  );
  const index = indexCatalog(foods, [], 'en');
  const found = (query: string) => names(search(query, [], index, 40, 'en'));

  it('puts the food itself before preparations and compounds', () => {
    expect(found('apple')).toEqual(['Apple raw', 'Apple juice', 'Apple-banana-pear sauce raw']);
    expect(found('tomato')[0]).toBe('Tomato raw');
    expect(found('yogurt')[0]).toBe('Yogurt min. 3.5 % fat');
    expect(found('milk')[0]).toBe('Milk 3.5 % fat');
  });

  it('knows plurals', () => {
    expect(found('apples')[0]).toBe('Apple raw');
    expect(found('tomatoes')[0]).toBe('Tomato raw');
    expect(found('strawberries')).toEqual(['Strawberry raw', 'Strawberry jam']);
  });

  it('knows everyday words and the other spelling', () => {
    expect(found('yoghurt')[0]).toBe('Yogurt min. 3.5 % fat');
    expect(found('noodles')).toEqual(['Egg pasta boiled', 'Rice noodles raw']);
  });

  it('requires every search word', () => {
    expect(found('chicken breast')).toEqual(['Chicken breast fillet, raw', 'Chicken breast fillet fried']);
    expect(found('chicken raw')).toEqual(['Chicken heart, raw', 'Chicken breast fillet, raw']);
    expect(found('zzz')).toEqual([]);
  });
});

describe('search in other scripts', () => {
  it('keeps letters of every script', () => {
    expect(normalize('Φέτα ΠΟΠ')).toBe('φετα ποπ');
    expect(normalize('Кисело мляко 3,6%')).toBe('кисело мляко 3 6');
    expect(normalize('Müsli, Äpfel & Straße')).toBe('musli apfel strasse');
  });
});

describe('countries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load(languages: string[], stored: string | null = null) {
    vi.resetModules();
    vi.stubGlobal('navigator', { userAgent: 'node', language: languages[0], languages });
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key.endsWith('region') ? stored : null) });
    return import('../src/lib/regions');
  }

  it('takes the country from the device', async () => {
    expect((await load(['de-AT'])).region).toBe('AT');
    expect((await load(['de'])).region).toBe('DE');
    expect((await load(['fr'])).region).toBe('FR');
    expect((await load(['en-GB'])).region).toBe('GB');
    expect((await load(['en-IE', 'en'])).region).toBe('IE');
    expect((await load(['nb-NO'])).region).toBe('NO');
  });

  it('falls back to the next language of the device, then to a default', async () => {
    expect((await load(['en-US', 'nl-NL'])).region).toBe('NL');
    expect((await load(['en-US'])).region).toBe('GB');
    expect((await load(['ja-JP'])).region).toBe('GB');
  });

  it('follows the choice made in the app', async () => {
    const chosen = await load(['de-DE'], 'FR');
    expect(chosen.region).toBe('FR');
    expect(chosen.regionTag).toBe('france');
    expect((await load(['de-DE'], 'XX')).region).toBe('DE');
  });

  it('lists the countries by name in the language of the interface', async () => {
    const { regionChoices } = await load(['en-GB']);
    const choices = regionChoices();
    expect(choices).toHaveLength(REGIONS.length);
    expect(choices.find((choice) => choice.code === 'DE')!.name).toBe('Germany');
    expect(choices.map((choice) => choice.name)).toEqual([...choices.map((choice) => choice.name)].sort((a, b) => a.localeCompare(b, 'en-GB')));
  });
});

describe('data files', () => {
  it('has a German and an English name for every basic food', () => {
    const bls = read('data/bls.json');
    expect(bls.fields.slice(0, 3)).toEqual(['id', 'name', 'nameEn']);
    expect(bls.rows.length).toBeGreaterThan(7000);
    for (const row of bls.rows) {
      expect(typeof row[1] === 'string' && row[1].trim() !== '').toBe(true);
      expect(typeof row[2] === 'string' && row[2].trim() !== '').toBe(true);
    }
  });

  it('has a product file for every country', () => {
    for (const { code } of REGIONS) {
      const pack = read(packPath(code));
      expect(pack).toMatchObject({ source: 'off', license: 'ODbL', country: code });
      expect(pack.fields.slice(0, 5)).toEqual(['code', 'name', 'brand', 'quantity', 'unit']);
      expect(pack.rows.length, code).toBeGreaterThan(400);
      expect(pack.rows.length, code).toBeLessThanOrEqual(10_000);
      const first = pack.rows[0];
      expect(first[0]).toMatch(/^\d{8}$|^\d{13}$/);
      expect(typeof first[1]).toBe('string');
    }
  });
});
