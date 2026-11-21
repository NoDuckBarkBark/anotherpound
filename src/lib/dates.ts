import { decimal, locale } from './locale';

/** Days are kept as local dates YYYY-MM-DD, never in UTC. */

export function dayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function todayKey(): string {
  return dayKey(new Date());
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  // Noon, so that daylight saving changes never shift the day.
  return new Date(y!, m! - 1, d!, 12);
}

export function addDays(key: string, days: number): string {
  const date = parseDay(key);
  date.setDate(date.getDate() + days);
  return dayKey(date);
}

const dayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' });
const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

/** Weekday, day and month, for example "Sat, 21 Nov". */
export function formatDay(key: string): string {
  return dayFormat.format(parseDay(key));
}

export function formatDate(timestamp: number): string {
  return dateFormat.format(new Date(timestamp));
}

const momentFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Day and time, for example "21/11, 14:32". */
export function formatMoment(timestamp: number): string {
  return momentFormat.format(new Date(timestamp));
}

/** Whole number with thousands separators. */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

const amountFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

/** Number with at most one decimal, for example for grams and kilograms. */
export function formatAmount(value: number): string {
  return amountFormat.format(value);
}

/** Monday of the week the day belongs to. */
export function weekStart(key: string): string {
  const date = parseDay(key);
  const offset = (date.getDay() + 6) % 7;
  return addDays(key, -offset);
}

const shortFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

/** Day and month, for example "21 Nov". */
export function formatShort(key: string): string {
  return shortFormat.format(parseDay(key));
}

const signedFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, signDisplay: 'exceptZero' });

/** Number with its sign, for example "−0.5" or "+0.25". */
export function formatSigned(value: number): string {
  return signedFormat.format(value).replace('-', '−');
}

/** Number as typed into a field: no thousands separators, the decimal separator of the locale. */
export function formatInput(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', decimal);
}

/** Reads a typed number. Both "," and "." count as the decimal separator. Empty or invalid gives null. */
export function parseInput(input: string): number | null {
  const cleaned = input.trim().replace(',', '.');
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
