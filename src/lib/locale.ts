/**
 * Language of the interface.
 *
 * English is the default. German is used when the device is set to German, or when the
 * user picked it under "More". The language is fixed once at start; changing it reloads the app.
 */
export type Language = 'en' | 'de';

export const LANGUAGES: { id: Language; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
];

const KEY = 'anotherpound:language';

function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'de';
}

/** The language the user picked, or null when the app follows the device. */
export function chosenLanguage(): Language | null {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    // Storage can be blocked (private windows, strict settings). Then the device decides.
    return null;
  }
}

/** First language of the device, for example "de-AT" or "en-US". */
function deviceLocale(): string {
  const nav = globalThis.navigator;
  return nav?.languages?.[0] ?? nav?.language ?? 'en';
}

/** German devices get German, every other language gets English. */
export function deviceLanguage(): Language {
  return deviceLocale().toLowerCase().startsWith('de') ? 'de' : 'en';
}

export const language: Language = chosenLanguage() ?? deviceLanguage();

/**
 * Locale for dates and numbers. It follows the interface language and keeps the regional
 * variant of the device when that matches ("en-US" writes Nov 21, "en-GB" writes 21 Nov).
 */
export const locale: string = deviceLocale().toLowerCase().startsWith(language)
  ? deviceLocale()
  : language === 'de'
    ? 'de-DE'
    : 'en-GB';

function decimalOf(tag: string): string {
  try {
    return new Intl.NumberFormat(tag).formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? '.';
  } catch {
    return '.';
  }
}

/** Decimal separator of the locale: "," in German, "." in English. */
export const decimal: string = decimalOf(locale);

/** Stores the choice (null follows the device again) and restarts the app in that language. */
export function setLanguage(choice: Language | null): void {
  try {
    if (choice) localStorage.setItem(KEY, choice);
    else localStorage.removeItem(KEY);
  } catch {
    return;
  }
  location.reload();
}
