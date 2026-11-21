import { describe, expect, it } from 'vitest';
import { formatInput } from '../src/lib/dates';
import { PadValue } from '../src/lib/pad.svelte';

function typed(start: number | null, keys: string): PadValue {
  const pad = new PadValue(start);
  for (const key of keys.split(' ').filter(Boolean)) pad.press(key);
  return pad;
}

describe('number pad', () => {
  it('shows the prefilled value the way the language writes it', () => {
    expect(new PadValue(100).text).toBe('100');
    expect(new PadValue(3.6).text).toBe('3.6');
    expect(new PadValue(null).text).toBe('');
    expect(new PadValue(null).value).toBeNull();
    expect(formatInput(81.449)).toBe('81.45');
  });

  it('replaces the prefilled value with the first digit and appends after that', () => {
    const pad = typed(100, '6');
    expect(pad.text).toBe('6');
    expect(pad.fresh).toBe(false);
    pad.press('0');
    expect(pad.text).toBe('60');
    expect(pad.value).toBe(60);
  });

  it('removes the last digit of the prefilled value instead of dropping it', () => {
    const pad = typed(100, 'back');
    expect(pad.text).toBe('10');
    pad.press('5');
    expect(pad.value).toBe(105);
    expect(typed(5, 'back').value).toBeNull();
    expect(typed(null, 'back back').text).toBe('');
  });

  it('sets one decimal separator at most, and two decimals at most', () => {
    expect(typed(null, '1 2 dec 5').value).toBe(12.5);
    expect(typed(null, '1 dec dec 5 dec 2 9').text).toBe('1.52');
    expect(typed(100, 'dec').text).toBe('0.');
    expect(typed(100, 'dec 5').value).toBe(0.5);
    // A separator at the end counts as a whole number.
    expect(typed(null, '8 1 dec').value).toBe(81);
  });

  it('takes comma and point from a keyboard as the decimal separator', () => {
    expect(typed(null, '1 2 , 5').text).toBe('12.5');
    expect(typed(null, '1 2 . 5').text).toBe('12.5');
  });

  it('allows no leading zeros and five digits before the separator at most', () => {
    expect(typed(null, '0 0 7').text).toBe('7');
    expect(typed(null, '0 dec 5').text).toBe('0.5');
    expect(typed(null, '1 2 3 4 5 6 7').text).toBe('12345');
  });

  it('accepts digits, separator and backspace only', () => {
    const pad = typed(100, 'a Enter -');
    expect(pad.text).toBe('100');
    expect(pad.fresh).toBe(true);
  });

  it('counts as untouched again after a reset', () => {
    const pad = typed(100, '2 5');
    pad.reset(1);
    expect(pad.text).toBe('1');
    expect(pad.fresh).toBe(true);
    pad.press('3');
    expect(pad.value).toBe(3);
    pad.reset(null);
    expect(pad.value).toBeNull();
  });
});
