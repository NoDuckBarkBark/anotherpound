import type { Dish, Food, Nutrients, Unit } from './db';
import { language, type Language } from './locale';
import { chosenRegion, region } from './regions';

/**
 * Base catalog: basic foods from the Bundeslebensmittelschlüssel, named in the language of
 * the interface, and the most scanned products of the chosen country from Open Food Facts.
 * Both are separate files and are only loaded on the first search.
 */
interface DataFile {
  fields: string[];
  rows: (string | number | null)[][];
}

type Row = Record<string, string | number | null>;

function rowsOf(file: DataFile): Row[] {
  return file.rows.map((row) => Object.fromEntries(file.fields.map((field, index) => [field, row[index] ?? null])));
}

function num(value: string | number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function text(value: string | number | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function nutrients(row: Row): Nutrients {
  const out: Nutrients = {
    kcal: num(row.kcal) ?? 0,
    protein: num(row.protein) ?? 0,
    carbs: num(row.carbs) ?? 0,
    fat: num(row.fat) ?? 0,
  };
  for (const key of ['sugar', 'satFat', 'fiber', 'salt', 'alcohol'] as const) {
    const value = num(row[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function blsFoods(file: DataFile, lang: Language = language): Food[] {
  return rowsOf(file).map((row) => ({
    id: `bls:${row.id}`,
    updatedAt: 0,
    deleted: 0,
    source: 'bls',
    sourceId: String(row.id),
    name: String((lang === 'en' ? row.nameEn : undefined) ?? row.name),
    unit: 'g',
    per100: nutrients(row),
    portions: [],
    useCount: 0,
  }));
}

export function offFoods(file: DataFile): Food[] {
  return rowsOf(file).map((row) => {
    const unit: Unit = row.unit === 'ml' ? 'ml' : 'g';
    const serving = num(row.servingAmount);
    return {
      id: `off:${row.code}`,
      updatedAt: 0,
      deleted: 0,
      source: 'off',
      barcode: String(row.code),
      name: String(row.name),
      brand: text(row.brand),
      quantity: text(row.quantity),
      unit,
      per100: nutrients(row),
      portions: serving ? [{ label: text(row.servingLabel) ?? `${serving} ${unit}`, amount: serving }] : [],
      useCount: 0,
    };
  });
}

/** Normalizes text for search: lowercase, without accents and umlaut dots, ß as ss. Letters of every script stay. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type Choice = { kind: 'food'; food: Food } | { kind: 'dish'; dish: Dish };

/** What the search knows about a language. Spelling as after normalize(). */
interface Rules {
  /**
   * State and preparation words. For search, "Reis poliert, roh" is simply "Reis"
   * and "Joghurt mild, mind. 3,5 % Fett" is simply "Joghurt".
   */
  states: Set<string>;
  /** Everyday words for which the BLS lists a basic food under a different name. */
  aliases: Record<string, string>;
  /** Same word, also in singular and plural. */
  same: (word: string, token: string) => boolean;
}

const wordSet = (list: string) => new Set(list.split(' '));

const GERMAN_ENDINGS = new Set(['n', 'e', 'en', 'er']);
const ENGLISH_ENDINGS = new Set(['s', 'es']);

/** Shorter and longer of two words that differ only by one of the endings. */
function differsBy(endings: Set<string>, word: string, token: string): boolean {
  const [short, long] = word.length < token.length ? [word, token] : [token, word];
  return long.startsWith(short) && endings.has(long.slice(short.length));
}

const RULES: Record<Language, Rules> = {
  de: {
    states: wordSet(
      'roh gekocht gegart gedampft gedunstet gebraten gebacken gegrillt geschmort pochiert frittiert druckgedampft ' +
        'frisch getrocknet tiefgefroren poliert unpoliert parboiled geschalt ungeschalt natur abgetropft konserve ' +
        'ohne mit fett schale haut pfanne ofen gesalzen ungesalzen gesusst ungesusst mild gesauert fettarm mind max bis ganz ' +
        'entrahmt hochstens pasteurisiert ultrahocherhitzt homogenisiert laktosefrei eifrei getrank reif type bio',
    ),
    aliases: {
      ei: 'huhnerei',
      eier: 'huhnerei',
      nudel: 'teigwaren',
      nudeln: 'teigwaren',
      pasta: 'teigwaren',
      brokkoli: 'broccoli',
    },
    // Kartoffel/Kartoffeln, Ei/Eier, Nuss/Nüsse
    same: (word, token) => word === token || differsBy(GERMAN_ENDINGS, word, token),
  },
  en: {
    states: wordSet(
      'raw cooked boiled steamed stewed fried baked grilled braised poached roasted deep frozen fresh dried ' +
        'polished unpolished parboiled peeled unpeeled plain drained canned without with fat skin shell pan oven ' +
        'salted unsalted sweetened unsweetened mild soured low min max whole skimmed pasteurised uht homogenised ' +
        'lactose free drink ripe type organic',
    ),
    aliases: {
      noodle: 'pasta',
      noodles: 'pasta',
      yoghurt: 'yogurt',
      oatmeal: 'oat',
    },
    // Apple/Apples, Tomato/Tomatoes, Strawberry/Strawberries
    same: (word, token) => {
      if (word === token || differsBy(ENGLISH_ENDINGS, word, token)) return true;
      const [short, long] = word.length < token.length ? [word, token] : [token, word];
      return short.endsWith('y') && long === short.slice(0, -1) + 'ies';
    },
  },
};

function withoutStates(words: string[], rules: Rules): string[] {
  const core = words.filter((word) => !rules.states.has(word) && !/^\d+$/.test(word));
  return core.length ? core : words;
}

interface Indexed {
  pick: Choice;
  /** Name and brand, normalized. */
  key: string;
  /** Key without spaces: the BLS writes "Hafer Flocken", the search is for "Haferflocken". */
  squashed: string;
  /** Words of the name. */
  words: string[];
  /** Words of the name without state and preparation words. */
  core: string[];
  /** Words of the brand. */
  brand: string[];
  /** 0 = own data, 1 = BLS, 2 = Open Food Facts. */
  group: number;
  order: number;
}

function indexed(pick: Choice, group: number, order: number, rules: Rules): Indexed {
  const words = normalize(pick.kind === 'dish' ? pick.dish.name : pick.food.name).split(' ').filter(Boolean);
  const brand = normalize(pick.kind === 'food' ? (pick.food.brand ?? '') : '').split(' ').filter(Boolean);
  const key = [...words, ...brand].join(' ');
  return { pick, key, squashed: key.replaceAll(' ', ''), words, core: withoutStates(words, rules), brand, group, order };
}

export function indexCatalog(bls: Food[], off: Food[], lang: Language = language): Indexed[] {
  const rules = RULES[lang];
  return [
    ...bls.map((food, order) => indexed({ kind: 'food', food }, 1, order, rules)),
    ...off.map((food, order) => indexed({ kind: 'food', food }, 2, order, rules)),
  ];
}

function isItself(item: Indexed, wanted: string[], rules: Rules): boolean {
  if (item.core.length === wanted.length && wanted.every((token) => item.core.some((word) => rules.same(word, token)))) return true;
  return item.core.join('') === wanted.join('');
}

/**
 * Match quality for a search word:
 * 0 = the food itself ("Reis poliert, roh" for "reis"),
 * 1 = name or brand starts with the word, or it is the base word: second word
 *     ("Rind Hackfleisch" for "hackfleisch") or end of the first ("Vollkornbrot" for "brot"),
 * 2 = the word occurs as a whole word,
 * 3 = name starts this way ("Haferbrot" for "hafer") or a word ends this way ("Rapsöl" for "öl"),
 * 4 = a word starts this way,
 * 5 = occurs anywhere.
 */
function rate(item: Indexed, token: string, wanted: string[], rules: Rules): number {
  const is = (word: string | undefined) => word !== undefined && rules.same(word, token);
  const first = item.words[0] ?? '';

  if (isItself(item, wanted, rules)) return 0;
  if (is(first) || is(item.brand[0]) || is(item.words[1])) return 1;
  if (token.length > first.length && token.startsWith(first) && item.squashed.startsWith(token)) return 1;
  if (token.length >= 4 && first.endsWith(token)) return 1;
  if (item.words.some(is) || item.brand.some(is)) return 2;
  if (first.startsWith(token) || item.words.some((word) => word.endsWith(token))) return 3;
  if (item.words.some((word) => word.startsWith(token)) || item.brand.some((word) => word.startsWith(token))) return 4;
  return 5;
}

/** Quality by the first search word; an everyday word counts like the name in the BLS. */
function matchQuality(item: Indexed, tokens: string[], wanted: string[], rules: Rules): number {
  const token = tokens[0]!;
  const alias = rules.aliases[token];
  const direct = rate(item, token, wanted, rules);
  if (alias === undefined) return direct;
  return Math.min(direct, rate(item, alias, wanted.map((word) => (word === token ? alias : word)), rules));
}

/** Alternates in blocks, so long runs of BLS entries do not push out the products. */
function interleave<T>(a: T[], b: T[], block = 8): T[] {
  const out: T[] = [];
  for (let at = 0; at < a.length || at < b.length; at += block) {
    out.push(...a.slice(at, at + block), ...b.slice(at, at + block));
  }
  return out;
}

/**
 * Searches own data and the base catalog. Order: own and previously used
 * entries first (most recently used first), then the base catalog by match quality.
 * At equal quality, plain BLS entries come before longer ones, products by scan frequency.
 */
export function search(
  query: string,
  local: Choice[],
  catalog: Indexed[],
  limit = 40,
  lang: Language = language,
): Choice[] {
  const rules = RULES[lang];
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const wanted = withoutStates(tokens, rules);

  const localIds = new Set(local.map((pick) => (pick.kind === 'food' ? pick.food.id : pick.dish.id)));
  const localBarcodes = new Set(
    local.flatMap((pick) => (pick.kind === 'food' && pick.food.barcode ? [pick.food.barcode] : [])),
  );

  type Candidate = Indexed & { quality: number; used: number };
  // The plural matches too: "erdbeeren" finds "Erdbeere roh".
  const hits = (item: Indexed, token: string) =>
    item.key.includes(token) || item.squashed.includes(token) || item.words.some((word) => rules.same(word, token));
  const own: Candidate[] = [];
  const tiers: Candidate[][] = [[], [], [], [], [], []];
  const consider = (item: Indexed, used: number) => {
    const alias = (token: string) => rules.aliases[token];
    if (!tokens.every((token) => hits(item, token) || (alias(token) !== undefined && hits(item, alias(token)!)))) return;
    const candidate = { ...item, used, quality: matchQuality(item, tokens, wanted, rules) };
    // Own entries come first as long as the search word starts or ends a word there.
    if (item.group === 0 && candidate.quality < 5) own.push(candidate);
    else tiers[candidate.quality]!.push(candidate);
  };

  local.forEach((pick, order) => {
    const used = pick.kind === 'food' ? (pick.food.lastUsedAt ?? 0) : (pick.dish.lastUsedAt ?? 0);
    consider(indexed(pick, 0, order, rules), used);
  });
  for (const item of catalog) {
    const food = item.pick.kind === 'food' ? item.pick.food : undefined;
    if (food && (localIds.has(food.id) || (food.barcode && localBarcodes.has(food.barcode)))) continue;
    consider(item, 0);
  }

  const byUse = (a: Candidate, b: Candidate) =>
    b.used - a.used || a.quality - b.quality || a.key.length - b.key.length || a.order - b.order;
  const plainFirst = (a: Candidate, b: Candidate) =>
    a.core.length - b.core.length || a.words.length - b.words.length || a.key.length - b.key.length || a.order - b.order;

  const out = own.sort(byUse);
  for (const tier of tiers) {
    if (out.length >= limit) break;
    out.push(
      ...tier.filter((item) => item.group === 0).sort(byUse),
      ...interleave(
        tier.filter((item) => item.group === 1).sort(plainFirst),
        tier.filter((item) => item.group === 2),
      ),
    );
  }
  return out.slice(0, limit).map((candidate) => candidate.pick);
}

let loading: Promise<{ index: Indexed[]; byBarcode: Map<string, Food> }> | null = null;

async function fetchFile(path: string): Promise<DataFile> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as DataFile;
}

const PACK_CACHE = 'anotherpound-pack';

/** File with the most scanned products of the chosen country. */
export function packPath(code: string = region): string {
  return `data/off/${code.toLowerCase()}.json`;
}

async function packCache(): Promise<Cache | undefined> {
  try {
    return typeof caches === 'undefined' ? undefined : await caches.open(PACK_CACHE);
  } catch {
    return undefined;
  }
}

const packUrl = (path: string) => `${path}?v=${__APP_VERSION__}`;

/** Puts the copy in place first and only then removes older ones, so there is never none. */
async function storePack(cache: Cache, url: string, response: Response): Promise<void> {
  await cache.put(url, response);
  const kept = new URL(url, location.href).href;
  for (const request of await cache.keys()) {
    if (request.url !== kept) await cache.delete(request);
  }
}

let keeping: Promise<void> | null = null;

/**
 * Makes sure the products of the chosen country are on the device, without reading them yet.
 * The copy belongs to one version of the app; a new version fetches the file again and
 * replaces the copy, also the one of a country chosen before.
 */
export function keepPack(): Promise<void> {
  if (chosenRegion() === null) return Promise.resolve();
  keeping ??= (async () => {
    const cache = await packCache();
    const url = packUrl(packPath());
    if (!cache || (await cache.match(url))) return;
    const response = await fetch(url);
    if (response.ok) await storePack(cache, url, response);
  })().catch(() => undefined);
  return keeping;
}

/** The products of the country: from the copy on the device, otherwise from the network. */
async function fetchPack(path: string): Promise<Response> {
  // A download that is already running puts the copy in place.
  await keeping;
  const cache = await packCache();
  const url = packUrl(path);
  const stored = await cache?.match(url);
  if (stored) return stored;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    if (cache) void storePack(cache, url, response.clone()).catch(() => undefined);
    return response;
  } catch (error) {
    // Without network, the copy of an earlier version is better than nothing.
    const older = (await cache?.keys())?.find((request) => new URL(request.url).pathname.endsWith(`/${path}`));
    const fallback = older && (await cache!.match(older));
    if (fallback) return fallback;
    throw error;
  }
}

/** Loads the base catalog once. If a file is missing, that part stays empty. */
export function loadCatalog(): Promise<{ index: Indexed[]; byBarcode: Map<string, Food> }> {
  loading ??= (async () => {
    const [bls, off] = await Promise.all([
      fetchFile('data/bls.json').then((file) => blsFoods(file), () => [] as Food[]),
      fetchPack(packPath())
        .then((response) => response.json() as Promise<DataFile>)
        .then(offFoods, () => [] as Food[]),
    ]);
    const byBarcode = new Map(off.flatMap((food) => (food.barcode ? [[food.barcode, food] as const] : [])));
    return { index: indexCatalog(bls, off), byBarcode };
  })();
  return loading;
}
