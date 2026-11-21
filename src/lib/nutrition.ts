import type { Dish, Food, Nutrients, TemplateItem } from './db';

/** Nutrients that are stored along but not given goals. */
export const OPTIONAL_KEYS = ['sugar', 'satFat', 'fiber', 'salt', 'alcohol'] as const;

export function zero(): Nutrients {
  return { kcal: 0, protein: 0, carbs: 0, fat: 0 };
}

export function scale(n: Nutrients, factor: number): Nutrients {
  const out: Nutrients = {
    kcal: n.kcal * factor,
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * factor,
  };
  for (const key of OPTIONAL_KEYS) {
    const value = n[key];
    if (value !== undefined) out[key] = value * factor;
  }
  return out;
}

/** Nutrients of an amount from values per 100 g or 100 ml. */
export function forAmount(per100: Nutrients, amount: number): Nutrients {
  return scale(per100, amount / 100);
}

export function add(a: Nutrients, b: Nutrients): Nutrients {
  const out: Nutrients = {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  };
  for (const key of OPTIONAL_KEYS) {
    if (a[key] !== undefined || b[key] !== undefined) out[key] = (a[key] ?? 0) + (b[key] ?? 0);
  }
  return out;
}

export function total(list: Nutrients[]): Nutrients {
  return list.reduce(add, zero());
}

/** Weight of the finished dish. If not given, the sum of the raw weights applies. */
export function dishWeight(dish: Pick<Dish, 'ingredients' | 'cookedWeight'>): number {
  if (dish.cookedWeight && dish.cookedWeight > 0) return dish.cookedWeight;
  return dish.ingredients.reduce((sum, ingredient) => sum + ingredient.amount, 0);
}

/** Nutrients of the whole dish: sum of the raw ingredients. */
export function dishTotals(dish: Pick<Dish, 'ingredients'>, foods: Map<string, Food>): Nutrients {
  return total(
    dish.ingredients.flatMap((ingredient) => {
      const food = foods.get(ingredient.foodId);
      return food ? [forAmount(food.per100, ingredient.amount)] : [];
    }),
  );
}

/** Values per 100 g of the finished dish: sum of the ingredients divided by the finished weight. */
export function dishPer100(dish: Pick<Dish, 'ingredients' | 'cookedWeight'>, foods: Map<string, Food>): Nutrients {
  const weight = dishWeight(dish);
  return weight > 0 ? scale(dishTotals(dish, foods), 100 / weight) : zero();
}

export function dishPortionWeight(dish: Pick<Dish, 'ingredients' | 'cookedWeight' | 'portions'>): number | undefined {
  return dish.portions && dish.portions > 0 ? dishWeight(dish) / dish.portions : undefined;
}

/** Nutrients of all items of a template. Items whose food is missing are not counted. */
export function itemsTotal(items: TemplateItem[], foods: Map<string, Food>, dishes: Map<string, Dish>): Nutrients {
  return total(
    items.flatMap((item) => {
      if (item.kind === 'food') {
        const food = foods.get(item.refId);
        return food ? [forAmount(food.per100, item.amount)] : [];
      }
      const dish = dishes.get(item.refId);
      return dish ? [forAmount(dishPer100(dish, foods), item.amount)] : [];
    }),
  );
}

/** Energy from the macronutrients per the conversion factors of EU Regulation 1169/2011. */
export function macroEnergy(n: Nutrients): number {
  return 4 * n.protein + 4 * n.carbs + 9 * n.fat + 7 * (n.alcohol ?? 0) + 2 * (n.fiber ?? 0);
}

/**
 * Checks values per 100 g for obvious errors (swapped units, typos).
 * Suspicious entries are flagged, not blocked.
 */
export function isPlausible(per100: Nutrients): boolean {
  const { kcal, protein, carbs, fat } = per100;
  if ([kcal, protein, carbs, fat].some((value) => !Number.isFinite(value) || value < 0)) return false;
  if (kcal > 900 || protein > 100 || carbs > 100 || fat > 100 || protein + carbs + fat > 105) return false;
  const expected = macroEnergy(per100);
  return Math.abs(kcal - expected) <= Math.max(20, expected * 0.25);
}
