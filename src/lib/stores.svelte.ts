import { db, getSetting, type Dish, type Food, type Goal, type Template } from './db';
import { live } from './live.svelte';
import { locale } from './locale';
import { mealNames } from './meals';

/** Names of the four meals, with the defaults as fallback. Only call while a component is being set up. */
export function useMealNames() {
  const stored = live(
    () => 0,
    () => getSetting<string[]>('mealNames'),
    undefined as string[] | undefined,
  );
  return {
    get value(): string[] {
      return mealNames(stored.value);
    },
    get ready(): boolean {
      return stored.ready;
    },
  };
}

/** All foods: `list` without deleted ones, `map` with all, so old dishes stay calculable. */
export function useFoods() {
  const all = live(
    () => 0,
    () => db.foods.toArray(),
    [] as Food[],
  );
  const list = $derived(all.value.filter((food) => !food.deleted));
  const map = $derived(new Map(all.value.map((food) => [food.id, food])));
  return {
    get list() {
      return list;
    },
    get map() {
      return map;
    },
  };
}

export function useDishes() {
  const all = live(
    () => 0,
    () => db.dishes.toArray(),
    [] as Dish[],
  );
  const list = $derived(all.value.filter((dish) => !dish.deleted).sort((a, b) => a.name.localeCompare(b.name, locale)));
  const map = $derived(new Map(all.value.map((dish) => [dish.id, dish])));
  return {
    get list() {
      return list;
    },
    get map() {
      return map;
    },
  };
}

export function useTemplates() {
  const all = live(
    () => 0,
    () => db.templates.toArray(),
    [] as Template[],
  );
  const list = $derived(
    all.value.filter((template) => !template.deleted).sort((a, b) => a.name.localeCompare(b.name, locale)),
  );
  return {
    get list() {
      return list;
    },
  };
}

export function useGoals() {
  return live(
    () => 0,
    () => db.goals.toArray(),
    [] as Goal[],
  );
}
