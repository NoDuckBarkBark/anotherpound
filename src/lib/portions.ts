import type { Choice } from './catalog';
import { formatAmount } from './dates';
import type { Portion } from './db';
import { language, type Language } from './locale';
import { dishPortionWeight } from './nutrition';

/**
 * Countable units: "3 × Pastille" instead of grams.
 *
 * Serving sizes from Open Food Facts are free text in many languages ("2 Stück (30 g)",
 * "15 g", "1 bar (28.5 g)", "30 g (2 Scheiben)"). From it, a word and the weight
 * of a single piece are extracted. What cannot be read reliably is simply called "Portion".
 */

/** Units of measure: "15 g" or "250 ml" name nothing countable. */
const UNIT_WORD = /^(g|gr|gramm?|grams?|grammes?|ml|cl|dl|l|liter|litre|kg|oz|fl|г|гр|мл)\.?$/i;
/** Words that only say "one serving" or describe the package. */
const GENERIC =
  /^(portion(s|en)?|servings?|porcj[ai]|porzion[ei]|porties?|raci[oó]n|füllmenge|abtropfgewicht|nettogewicht|inhalt|zubereitet|prepared)$/i;
const FILLER = /\s+(ca|circa|etwa|about|approx|env|je|à)\.?$/i;
/** Common English words from Open Food Facts, in German. */
const TO_GERMAN: Record<string, string> = {
  piece: 'Stück',
  pieces: 'Stück',
  pc: 'Stück',
  pcs: 'Stück',
  unit: 'Stück',
  units: 'Stück',
  square: 'Stück',
  squares: 'Stück',
  stk: 'Stück',
  slice: 'Scheibe',
  slices: 'Scheiben',
  bar: 'Riegel',
  bars: 'Riegel',
  bottle: 'Flasche',
  can: 'Dose',
  bag: 'Beutel',
  sachet: 'Beutel',
  pouch: 'Beutel',
  pack: 'Packung',
  package: 'Packung',
  container: 'Packung',
  box: 'Packung',
  cup: 'Becher',
  pot: 'Becher',
  tub: 'Becher',
  glass: 'Glas',
  bowl: 'Schale',
  cookie: 'Keks',
  cookies: 'Kekse',
  biscuit: 'Keks',
  biscuits: 'Kekse',
  sausage: 'Würstchen',
  bun: 'Brötchen',
  waffle: 'Waffel',
  tablet: 'Tablette',
  tablets: 'Tabletten',
  pastille: 'Pastille',
  pastilles: 'Pastillen',
  lozenge: 'Pastille',
  lozenges: 'Pastillen',
  sweet: 'Bonbon',
  sweets: 'Bonbons',
  tbsp: 'EL',
  tsp: 'TL',
};
/** Common German words from Open Food Facts, in English. */
const TO_ENGLISH: Record<string, string> = {
  stück: 'Piece',
  stk: 'Piece',
  pc: 'Piece',
  pcs: 'Pieces',
  scheibe: 'Slice',
  scheiben: 'Slices',
  riegel: 'Bar',
  flasche: 'Bottle',
  dose: 'Can',
  beutel: 'Bag',
  packung: 'Pack',
  becher: 'Cup',
  glas: 'Glass',
  schale: 'Bowl',
  keks: 'Cookie',
  kekse: 'Cookies',
  würstchen: 'Sausage',
  brötchen: 'Bun',
  waffel: 'Waffle',
  tablette: 'Tablet',
  tabletten: 'Tablets',
  pastille: 'Pastille',
  pastillen: 'Pastilles',
  bonbon: 'Sweet',
  bonbons: 'Sweets',
  el: 'tbsp',
  tl: 'tsp',
  tbsp: 'tbsp',
  tsp: 'tsp',
};

/**
 * Reads "2 Stück" as count 2 and word "Stück". Without a word in the result it is an
 * unnamed serving ("1 serving"), without a result it is not a countable value ("15 g").
 */
function parse(text: string, needsNumber: boolean, lang: Language): { count: number; word?: string } | undefined {
  const match = /^(\d+(?:[.,]\d+)?)?\s*(?:x\s+)?(.*)$/i.exec(text.trim());
  if (!match || (needsNumber && !match[1])) return undefined;
  const count = match[1] ? Number(match[1].replace(',', '.')) : 1;
  // Only up to the next number or the next separator: "Riegel = 25 g" becomes "Riegel".
  const phrase = (match[2] ?? '')
    .split(/[\d=,;:/(*]/)[0]!
    .trim()
    .replace(FILLER, '')
    .replace(/[.\s-]+$/, '');
  const words = phrase.split(/\s+/).slice(0, 2);
  const first = words[0] ?? '';
  if (!(count > 0) || first.length < 2 || !/^[\p{L}\p{M}' -]+$/u.test(phrase) || UNIT_WORD.test(first)) return undefined;
  if (GENERIC.test(first)) return { count };

  const word = words.join(' ');
  const known = (lang === 'de' ? TO_GERMAN : TO_ENGLISH)[word.toLowerCase()];
  return { count, word: known ?? word[0]!.toUpperCase() + word.slice(1) };
}

/** One piece of the serving: word and weight. Without a countable word it is named like `fallback`. */
export function countable(portion: Portion, fallback: string, lang: Language = language): Portion {
  const outside = portion.label.replace(/\([^)]*\)?/g, ' ');
  const inside = [...portion.label.matchAll(/\(([^)]*)\)?/g)].map((found) => found[1] ?? '');
  // In parentheses only a value with a number counts: "30 g (2 Scheiben)", not "(zubereitet)".
  const parsed = parse(outside, false, lang) ?? inside.map((text) => parse(text, true, lang)).find(Boolean);
  if (!parsed) return { label: fallback, amount: portion.amount };
  return { label: parsed.word ?? fallback, amount: portion.amount / parsed.count };
}

/** All countable units of a food, each label once. */
export function countablePortions(portions: Portion[], fallback: string, lang: Language = language): Portion[] {
  const out: Portion[] = [];
  for (const portion of portions) {
    const unit = countable(portion, fallback, lang);
    if (!(unit.amount > 0) || out.some((other) => other.label === unit.label)) continue;
    // "Portion · 100 g" says nothing the gram input cannot already do.
    if (unit.label === fallback && unit.amount === 100) continue;
    out.push(unit);
  }
  return out;
}

/** Units of a food or dish besides grams or milliliters. */
export function unitsOf(choice: Choice, fallback: string, portions?: Portion[]): Portion[] {
  if (choice.kind === 'food') return countablePortions(portions ?? choice.food.portions, fallback);
  const weight = dishPortionWeight(choice.dish);
  return weight ? [{ label: fallback, amount: Math.round(weight) }] : [];
}

export interface Start {
  /** Selected unit; if missing, grams or milliliters apply. */
  portion?: Portion;
  /** Number in the input field: pieces or grams. */
  value: number;
  /** Amount in grams or milliliters. */
  amount: number;
}

/**
 * What the amount input opens with: as last time; otherwise one piece, if the
 * food has pieces; otherwise the serving size in grams; otherwise 100.
 */
export function startFor(choice: Choice, fallback: string, units = unitsOf(choice, fallback)): Start {
  const last = choice.kind === 'food' ? choice.food : choice.dish;
  const { lastPortion, lastCount, lastAmount } = last;
  const used =
    units.find((unit) => unit.label === lastPortion) ??
    // The label is stored as shown. After a change of language the size still tells which unit it was.
    (lastPortion && lastCount && lastAmount
      ? units.find((unit) => Math.abs(unit.amount * lastCount - lastAmount) < 0.01)
      : undefined);
  if (used && last.lastCount) return { portion: used, value: last.lastCount, amount: last.lastCount * used.amount };
  if (last.lastAmount) return { value: last.lastAmount, amount: last.lastAmount };

  const first = units[0];
  if (!first) return { value: 100, amount: 100 };
  const named = choice.kind === 'dish' || first.label !== fallback;
  return named ? { portion: first, value: 1, amount: first.amount } : { value: first.amount, amount: first.amount };
}

export function formatCount(count: number, label: string): string {
  return `${formatAmount(count)} × ${label}`;
}
