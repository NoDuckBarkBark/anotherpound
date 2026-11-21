import { t } from './texts';
import { de } from './texts/de';

/**
 * Names of the four meals. Only names the user chose are stored; an empty name gives the
 * default of the current language, so the defaults follow a change of language.
 *
 * Up to version 0.5 the app was German only and stored all four names on a rename, so a
 * stored German default counts as empty too.
 */
export function mealNames(stored: readonly (string | undefined)[] | undefined): string[] {
  return t.meals.map((fallback, index) => {
    const name = stored?.[index]?.trim();
    return !name || name === de.meals[index] ? fallback : name;
  });
}

/** The names to store after renaming one meal: defaults stay empty. */
export function renamedMeals(stored: readonly (string | undefined)[] | undefined, index: number, value: string): string[] {
  return t.meals.map((fallback, i) => {
    const name = (i === index ? value : (stored?.[i] ?? '')).trim();
    return name === fallback || name === de.meals[i] ? '' : name;
  });
}
