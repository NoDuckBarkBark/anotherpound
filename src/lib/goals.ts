import type { Goal } from './db';

export type Sex = 'm' | 'w';

export interface Profile {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  /** Activity factor (PAL) per the DGE table. */
  pal: number;
  /** Exercise on four to five days a week: 0.3 added to the PAL value. */
  sport: boolean;
  /** Desired change in kg per week, negative for losing weight. */
  kgPerWeek: number;
  proteinPerKg: number;
}

/** Levels of the activity factor per the DGE (middle of each range). */
export const PAL_LEVELS = [1.4, 1.6, 1.8, 2.2] as const;
export const SPORT_BONUS = 0.3;
export const RATES = [-0.75, -0.5, -0.25, 0, 0.25, 0.5] as const;
export const PROTEIN_LEVELS = [0.8, 1.2, 1.6, 2.0] as const;

/** Approximation: 1 kg of body weight equals 7,700 kcal. */
export const KCAL_PER_KG = 7700;

/** Basal metabolic rate per Mifflin-St Jeor (1990) in kcal per day. */
export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'm' ? 5 : -161);
}

export function age(birthYear: number, today = new Date()): number {
  return today.getFullYear() - birthYear;
}

/** Daily requirement: basal metabolic rate times activity factor. */
export function expenditure(profile: Profile, today = new Date()): number {
  const base = bmr(profile.sex, profile.weightKg, profile.heightCm, age(profile.birthYear, today));
  return base * (profile.pal + (profile.sport ? SPORT_BONUS : 0));
}

export function kcalTarget(dailyExpenditure: number, kgPerWeek: number): number {
  return dailyExpenditure + (kgPerWeek * KCAL_PER_KG) / 7;
}

export interface Targets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Suggestion: protein by body weight, fat 30 % of energy, the rest carbs. */
export function suggest(profile: Profile, today = new Date()): Targets {
  const kcal = Math.round(kcalTarget(expenditure(profile, today), profile.kgPerWeek) / 10) * 10;
  const protein = Math.round(profile.weightKg * profile.proteinPerKg);
  const fat = Math.round((kcal * 0.3) / 9);
  const carbs = Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4));
  return { kcal, protein, carbs, fat };
}

/** The goal that applied on a day: the newest one starting on or before that day. */
export function goalFor(day: string, goals: Goal[]): Goal | undefined {
  let best: Goal | undefined;
  for (const goal of goals) {
    if (goal.deleted || goal.validFrom > day) continue;
    if (!best || goal.validFrom > best.validFrom || (goal.validFrom === best.validFrom && goal.updatedAt > best.updatedAt)) {
      best = goal;
    }
  }
  return best;
}
