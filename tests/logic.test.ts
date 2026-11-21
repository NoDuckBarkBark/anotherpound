import { describe, expect, it } from 'vitest';
import type { Dish, Food, Goal } from '../src/lib/db';
import { bmr, expenditure, goalFor, kcalTarget, suggest, type Profile } from '../src/lib/goals';
import {
  add,
  dishPer100,
  dishPortionWeight,
  dishTotals,
  dishWeight,
  forAmount,
  isPlausible,
  itemsTotal,
  macroEnergy,
  total,
} from '../src/lib/nutrition';
import { trendSeries, weeklyRate } from '../src/lib/trend';

function food(id: string, kcal: number, protein: number, carbs: number, fat: number): Food {
  return {
    id,
    updatedAt: 0,
    deleted: 0,
    source: 'own',
    name: id,
    unit: 'g',
    per100: { kcal, protein, carbs, fat },
    portions: [],
    useCount: 0,
  };
}

describe('nutrients of an amount', () => {
  it('converts from 100 g to the amount', () => {
    const n = forAmount({ kcal: 370, protein: 13.5, carbs: 58.7, fat: 7, fiber: 10 }, 60);
    expect(n.kcal).toBeCloseTo(222);
    expect(n.protein).toBeCloseTo(8.1);
    expect(n.carbs).toBeCloseTo(35.22);
    expect(n.fat).toBeCloseTo(4.2);
    expect(n.fiber).toBeCloseTo(6);
    expect(n.sugar).toBeUndefined();
  });

  it('adds up and does not turn missing extra values into numbers', () => {
    const sum = add({ kcal: 100, protein: 1, carbs: 2, fat: 3, salt: 0.5 }, { kcal: 50, protein: 4, carbs: 5, fat: 6 });
    expect(sum).toEqual({ kcal: 150, protein: 5, carbs: 7, fat: 9, salt: 0.5 });
    expect(total([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('dish', () => {
  const foods = new Map([
    ['lentils', food('lentils', 350, 24, 50, 1.5)],
    ['tomatoes', food('tomatoes', 20, 1, 3, 0.2)],
    ['oil', food('oil', 884, 0, 0, 100)],
  ]);
  const ingredients = [
    { foodId: 'lentils', amount: 200 },
    { foodId: 'tomatoes', amount: 400 },
    { foodId: 'oil', amount: 20 },
  ];

  it('adds up the raw ingredients', () => {
    const totals = dishTotals({ ingredients }, foods);
    expect(totals.kcal).toBeCloseTo(956.8);
    expect(totals.protein).toBeCloseTo(52);
    expect(totals.carbs).toBeCloseTo(112);
    expect(totals.fat).toBeCloseTo(23.8);
  });

  it('divides by the cooked weight', () => {
    const per100 = dishPer100({ ingredients, cookedWeight: 1200 }, foods);
    expect(per100.kcal).toBeCloseTo(79.73, 2);
    expect(per100.protein).toBeCloseTo(4.33, 2);
    expect(per100.fat).toBeCloseTo(1.98, 2);
  });

  it('takes the sum of the raw weights when there is no cooked weight', () => {
    expect(dishWeight({ ingredients })).toBe(620);
    expect(dishPer100({ ingredients }, foods).kcal).toBeCloseTo(154.32, 2);
  });

  it('knows the weight of one serving', () => {
    expect(dishPortionWeight({ ingredients, cookedWeight: 1200, portions: 4 })).toBe(300);
    expect(dishPortionWeight({ ingredients })).toBeUndefined();
  });

  it('skips missing ingredients and survives an empty dish', () => {
    expect(dishTotals({ ingredients: [{ foodId: 'gone', amount: 100 }] }, foods).kcal).toBe(0);
    expect(dishPer100({ ingredients: [] }, foods)).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('template', () => {
  it('adds up foods and dishes and skips what is missing', () => {
    const oats: Food = { id: 'oats', updatedAt: 0, deleted: 0, source: 'own', name: 'Oats', unit: 'g', per100: { kcal: 370, protein: 13, carbs: 59, fat: 7 }, portions: [], useCount: 0 };
    const stew: Dish = { id: 'stew', updatedAt: 0, deleted: 0, name: 'Porridge', ingredients: [{ foodId: 'oats', amount: 100 }], cookedWeight: 500, useCount: 0 };
    const sum = itemsTotal(
      [
        { kind: 'food', refId: 'oats', amount: 50 },
        { kind: 'dish', refId: 'stew', amount: 250 },
        { kind: 'food', refId: 'missing', amount: 100 },
      ],
      new Map([[oats.id, oats]]),
      new Map([[stew.id, stew]]),
    );
    expect(sum.kcal).toBeCloseTo(370);
    expect(sum.protein).toBeCloseTo(13);
  });
});

describe('plausibility check', () => {
  it('calculates energy from macros', () => {
    expect(macroEnergy({ kcal: 0, protein: 10, carbs: 20, fat: 5 })).toBe(165);
    expect(macroEnergy({ kcal: 0, protein: 0, carbs: 0, fat: 0, alcohol: 10, fiber: 5 })).toBe(80);
  });

  it('lets consistent values pass', () => {
    expect(isPlausible({ kcal: 370, protein: 13.5, carbs: 58.7, fat: 7, fiber: 10 })).toBe(true);
    expect(isPlausible({ kcal: 0, protein: 0, carbs: 0, fat: 0 })).toBe(true);
    expect(isPlausible({ kcal: 42, protein: 0, carbs: 10.6, fat: 0 })).toBe(true);
  });

  it('flags kilojoules entered as kcal, impossible amounts and large deviations', () => {
    expect(isPlausible({ kcal: 1548, protein: 13.5, carbs: 58.7, fat: 7 })).toBe(false);
    expect(isPlausible({ kcal: 50, protein: 20, carbs: 60, fat: 10 })).toBe(false);
    expect(isPlausible({ kcal: 400, protein: 60, carbs: 60, fat: 10 })).toBe(false);
    expect(isPlausible({ kcal: 100, protein: -1, carbs: 10, fat: 1 })).toBe(false);
    expect(isPlausible({ kcal: Number.NaN, protein: 1, carbs: 1, fat: 1 })).toBe(false);
  });
});

describe('calorie goal', () => {
  const today = new Date(2026, 10, 21);
  const profile: Profile = {
    sex: 'm',
    birthYear: 1996,
    heightCm: 180,
    weightKg: 80,
    pal: 1.6,
    sport: false,
    kgPerWeek: -0.5,
    proteinPerKg: 1.6,
  };

  it('calculates the basal metabolic rate with Mifflin-St Jeor', () => {
    expect(bmr('m', 80, 180, 30)).toBe(1780);
    expect(bmr('w', 60, 165, 40)).toBe(1270.25);
  });

  it('multiplies by the activity factor, with an extra for exercise', () => {
    expect(expenditure(profile, today)).toBeCloseTo(2848);
    expect(expenditure({ ...profile, sport: true }, today)).toBeCloseTo(1780 * 1.9);
  });

  it('subtracts 550 kcal a day for half a kilo per week', () => {
    expect(kcalTarget(2848, -0.5)).toBeCloseTo(2298);
    expect(kcalTarget(2848, 0)).toBe(2848);
    expect(kcalTarget(2848, 0.25)).toBeCloseTo(3123);
  });

  it('suggests macros in grams', () => {
    expect(suggest(profile, today)).toEqual({ kcal: 2300, protein: 128, carbs: 274, fat: 77 });
  });

  it('finds the goal that applied on a given day', () => {
    const goal = (validFrom: string, kcal: number, extra: Partial<Goal> = {}): Goal => ({
      id: validFrom + kcal,
      updatedAt: 1,
      deleted: 0,
      validFrom,
      kcal,
      protein: 1,
      carbs: 1,
      fat: 1,
      ...extra,
    });
    const goals = [goal('2026-11-15', 2000), goal('2026-11-01', 2200), goal('2026-11-20', 1500, { deleted: 1 })];
    expect(goalFor('2026-11-10', goals)?.kcal).toBe(2200);
    expect(goalFor('2026-11-15', goals)?.kcal).toBe(2000);
    expect(goalFor('2026-11-21', goals)?.kcal).toBe(2000);
    expect(goalFor('2026-10-31', goals)).toBeUndefined();
    expect(goalFor('2026-11-01', [goal('2026-11-01', 1, { updatedAt: 1 }), goal('2026-11-01', 2, { updatedAt: 5 })])?.kcal).toBe(2);
  });
});

describe('weight trend', () => {
  it('smooths by a tenth per day', () => {
    const series = trendSeries([
      { date: '2026-11-02', kg: 81 },
      { date: '2026-11-01', kg: 80 },
    ]);
    expect(series.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-02']);
    expect(series[0]!.trend).toBe(80);
    expect(series[1]!.trend).toBeCloseTo(80.1);
  });

  it('accounts for days without a measurement', () => {
    const series = trendSeries([
      { date: '2026-11-01', kg: 80 },
      { date: '2026-11-04', kg: 81 },
    ]);
    expect(series[1]!.trend).toBeCloseTo(80.271);
  });

  it('gives the weekly rate only from seven days on', () => {
    const days = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: `2026-11-${String(i + 1).padStart(2, '0')}`,
        kg: 80 - i * 0.1,
      }));
    expect(weeklyRate(trendSeries(days(5)))).toBeUndefined();
    const rate = weeklyRate(trendSeries(days(20)))!;
    expect(rate).toBeLessThan(0);
    expect(rate).toBeGreaterThan(-0.7);
    expect(weeklyRate([])).toBeUndefined();
  });
});
