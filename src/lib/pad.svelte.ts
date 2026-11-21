import { formatInput } from './dates';
import { decimal } from './locale';

/**
 * A number typed on the app's own number pad, written the way the locale writes it
 * ("12,5" in German, "12.5" in English).
 *
 * A prefilled value counts as untouched: the first digit replaces it instead of being
 * appended. Nothing has to be selected, and the phone's keyboard stays closed.
 */
const MAX_WHOLE = 5;
const MAX_DECIMALS = 2;

/** Keys of the pad. "dec" is the decimal separator, "back" removes the last character. */
export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'dec' | 'back';

export class PadValue {
  text = $state('');
  /** Untouched since it was prefilled. */
  fresh = $state(true);

  constructor(start: number | null = null) {
    this.text = start === null ? '' : formatInput(start);
  }

  get value(): number | null {
    if (this.text === '') return null;
    const parsed = Number(this.text.replace(decimal, '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  /** New starting value, for example after switching the unit. */
  reset(value: number | null): void {
    this.text = value === null ? '' : formatInput(value);
    this.fresh = true;
  }

  /** Accepts the pad keys; "," and "." both mean the decimal separator. Anything else is ignored. */
  press(key: string): void {
    if (key === 'back') {
      this.text = this.text.slice(0, -1);
      this.fresh = false;
      return;
    }
    const isDecimal = key === 'dec' || key === ',' || key === '.';
    if (!isDecimal && !/^\d$/.test(key)) return;

    const base = this.fresh ? '' : this.text;
    this.fresh = false;
    if (isDecimal) {
      this.text = base.includes(decimal) ? base : (base === '' ? '0' : base) + decimal;
      return;
    }
    const [whole = '', decimals] = base.split(decimal);
    if (decimals !== undefined) this.text = decimals.length < MAX_DECIMALS ? base + key : base;
    else if (whole === '0') this.text = key;
    else this.text = whole.length < MAX_WHOLE ? base + key : base;
  }
}
