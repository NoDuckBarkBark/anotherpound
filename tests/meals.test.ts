import { describe, expect, it } from 'vitest';
import { mealNames, renamedMeals } from '../src/lib/meals';

describe('meal names', () => {
  it('uses the defaults of the language when nothing is stored', () => {
    expect(mealNames(undefined)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
    expect(mealNames([])).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
    expect(mealNames(['', '  ', undefined])).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
  });

  it('keeps the names the user chose', () => {
    expect(mealNames(['', 'Late lunch', '', 'After training'])).toEqual([
      'Breakfast',
      'Late lunch',
      'Dinner',
      'After training',
    ]);
  });

  it('does not treat German defaults stored by older versions as a choice', () => {
    expect(mealNames(['Frühstück', 'Kantine', 'Abend', 'Snacks'])).toEqual(['Breakfast', 'Kantine', 'Dinner', 'Snacks']);
  });

  it('stores only the renamed meal and leaves defaults empty', () => {
    expect(renamedMeals(undefined, 1, ' Late lunch ')).toEqual(['', 'Late lunch', '', '']);
    expect(renamedMeals(['', 'Late lunch', '', ''], 3, 'After training')).toEqual(['', 'Late lunch', '', 'After training']);
    expect(renamedMeals(['Frühstück', 'Kantine', 'Abend', 'Snacks'], 0, 'Early')).toEqual(['Early', 'Kantine', '', '']);
  });

  it('goes back to the default when a name is cleared or set to the default', () => {
    expect(renamedMeals(['', 'Late lunch', '', ''], 1, '')).toEqual(['', '', '', '']);
    expect(renamedMeals(['', 'Late lunch', '', ''], 1, 'Lunch')).toEqual(['', '', '', '']);
  });
});
