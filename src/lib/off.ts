import type { Food, Nutrients, Unit } from './db';
import { normalizeBarcode } from './ean';
import { language } from './locale';

/**
 * Open Food Facts: lookup of single products by barcode and name search on button press.
 * Data: Open Food Facts, Open Database License (ODbL).
 *
 * The platform allows 15 product lookups and 10 searches per minute and prohibits
 * search while typing. That is why there is no automatic search here.
 */
const HOST = 'https://world.openfoodfacts.org';
const FIELDS =
  'code,product_name,product_name_de,product_name_en,brands,quantity,serving_size,serving_quantity,serving_quantity_unit,nutriments';

/** Incomplete product as a prefill for "create food". */
export interface OffDraft {
  barcode?: string;
  name?: string;
  brand?: string;
  quantity?: string;
  unit: Unit;
  per100: Partial<Nutrients>;
}

export type OffLookup =
  | { status: 'found'; food: Food }
  | { status: 'incomplete'; draft: OffDraft }
  | { status: 'missing' }
  | { status: 'offline' };

function text(value: unknown, max = 80): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, max);
}

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

const round = (value: number) => Math.round(value * 100) / 100;
const LIQUID = /\d\s*(ml|cl|l)\b/i;

/** Converts a product from Open Food Facts. Without kcal, protein, carbs and fat there is only a prefill. */
export function foodFromOff(product: Record<string, unknown>, now = Date.now()): { food?: Food; draft: OffDraft } {
  const n = (product.nutriments ?? {}) as Record<string, unknown>;

  // Only read explicit kcal or kJ fields. The ambiguous energy_100g is never interpreted as kcal.
  const kj = num(n['energy-kj_100g']);
  const kcal = num(n['energy-kcal_100g']) ?? (kj !== undefined ? kj / 4.184 : undefined);
  const sodium = num(n['sodium_100g']);

  const per100: Partial<Nutrients> = {
    kcal,
    protein: num(n['proteins_100g']),
    carbs: num(n['carbohydrates_100g']),
    fat: num(n['fat_100g']),
    sugar: num(n['sugars_100g']),
    satFat: num(n['saturated-fat_100g']),
    fiber: num(n['fiber_100g']),
    salt: num(n['salt_100g']) ?? (sodium !== undefined ? sodium * 2.5 : undefined),
    alcohol: num(n['alcohol_100g']),
  };
  for (const key of Object.keys(per100) as (keyof Nutrients)[]) {
    const value = per100[key];
    if (value === undefined) delete per100[key];
    else per100[key] = round(value);
  }

  const quantity = text(product.quantity, 20);
  const servingText = text(product.serving_size, 24);
  const unit: Unit =
    product.serving_quantity_unit === 'ml' || LIQUID.test(quantity ?? '') || LIQUID.test(servingText ?? '')
      ? 'ml'
      : 'g';

  const rawCode = text(product.code, 20);
  const barcode = rawCode ? (normalizeBarcode(rawCode) ?? rawCode) : undefined;
  const name =
    language === 'de'
      ? (text(product.product_name_de) ?? text(product.product_name) ?? text(product.product_name_en))
      : (text(product.product_name_en) ?? text(product.product_name) ?? text(product.product_name_de));
  const brand = text(product.brands)?.split(',')[0]?.trim() || undefined;
  const draft: OffDraft = { barcode, name, brand, quantity, unit, per100 };

  const complete =
    name !== undefined &&
    barcode !== undefined &&
    per100.kcal !== undefined &&
    per100.protein !== undefined &&
    per100.carbs !== undefined &&
    per100.fat !== undefined;
  if (!complete) return { draft };

  const serving = num(product.serving_quantity);
  const food: Food = {
    id: `off:${barcode}`,
    updatedAt: now,
    deleted: 0,
    source: 'off',
    barcode,
    name,
    brand,
    quantity,
    unit,
    per100: per100 as Nutrients,
    portions: serving && serving > 0 && serving <= 1000 ? [{ label: servingText ?? `${serving} ${unit}`, amount: serving }] : [],
    useCount: 0,
    fetchedAt: now,
  };
  return { food, draft };
}

export async function fetchProduct(code: string, fetcher: typeof fetch = fetch): Promise<OffLookup> {
  let response: Response;
  try {
    response = await fetcher(`${HOST}/api/v3/product/${encodeURIComponent(code)}?fields=${FIELDS}`);
  } catch {
    return { status: 'offline' };
  }
  if (response.status === 404) return { status: 'missing' };
  if (!response.ok) return { status: 'offline' };

  const body = (await response.json().catch(() => null)) as { product?: Record<string, unknown> } | null;
  if (!body?.product) return { status: 'missing' };

  const { food, draft } = foodFromOff({ code, ...body.product });
  if (food) return { status: 'found', food };
  return draft.name || Object.keys(draft.per100).length ? { status: 'incomplete', draft } : { status: 'missing' };
}

export type OffSearch = { status: 'ok'; foods: Food[] } | { status: 'offline' };

/** Search by name. One request per call. */
export async function searchProducts(query: string, fetcher: typeof fetch = fetch): Promise<OffSearch> {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '24',
    lc: language,
    fields: FIELDS,
  });
  // German interface: products sold in Germany. English interface: no country filter.
  if (language === 'de') {
    params.set('tagtype_0', 'countries');
    params.set('tag_contains_0', 'contains');
    params.set('tag_0', 'germany');
  }
  try {
    const response = await fetcher(`${HOST}/cgi/search.pl?${params}`);
    if (!response.ok) return { status: 'offline' };
    const body = (await response.json()) as { products?: Record<string, unknown>[] };
    const foods = (body.products ?? []).flatMap((product) => {
      const { food } = foodFromOff(product);
      return food ? [food] : [];
    });
    return { status: 'ok', foods };
  } catch {
    return { status: 'offline' };
  }
}
