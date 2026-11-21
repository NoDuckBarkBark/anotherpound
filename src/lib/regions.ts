import { language, locale } from './locale';

/**
 * Country whose products the app offers: the most scanned products of that country come as
 * a file, and the search at Open Food Facts is limited to it.
 *
 * `tag` is the name of the country in Open Food Facts. The same countries are listed in
 * scripts/build_off_packs.py, which builds one file per country.
 */
export const REGIONS = [
  { code: 'AT', tag: 'austria' },
  { code: 'BE', tag: 'belgium' },
  { code: 'BG', tag: 'bulgaria' },
  { code: 'CH', tag: 'switzerland' },
  { code: 'CY', tag: 'cyprus' },
  { code: 'CZ', tag: 'czech-republic' },
  { code: 'DE', tag: 'germany' },
  { code: 'DK', tag: 'denmark' },
  { code: 'EE', tag: 'estonia' },
  { code: 'ES', tag: 'spain' },
  { code: 'FI', tag: 'finland' },
  { code: 'FR', tag: 'france' },
  { code: 'GB', tag: 'united-kingdom' },
  { code: 'GR', tag: 'greece' },
  { code: 'HR', tag: 'croatia' },
  { code: 'HU', tag: 'hungary' },
  { code: 'IE', tag: 'ireland' },
  { code: 'IT', tag: 'italy' },
  { code: 'LT', tag: 'lithuania' },
  { code: 'LU', tag: 'luxembourg' },
  { code: 'LV', tag: 'latvia' },
  { code: 'MT', tag: 'malta' },
  { code: 'NL', tag: 'netherlands' },
  { code: 'NO', tag: 'norway' },
  { code: 'PL', tag: 'poland' },
  { code: 'PT', tag: 'portugal' },
  { code: 'RO', tag: 'romania' },
  { code: 'SE', tag: 'sweden' },
  { code: 'SI', tag: 'slovenia' },
  { code: 'SK', tag: 'slovakia' },
] as const;

export type Region = (typeof REGIONS)[number]['code'];

const KEY = 'anotherpound:region';

function isRegion(value: unknown): value is Region {
  return REGIONS.some((entry) => entry.code === value);
}

/** The country the user picked, or null as long as nothing was picked. */
export function chosenRegion(): Region | null {
  try {
    const stored = globalThis.localStorage?.getItem(KEY);
    return isRegion(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Country of a language tag: "de-AT" is Austria, a bare "fr" is France. */
function regionOf(tag: string): string | undefined {
  try {
    const parsed = new Intl.Locale(tag);
    return parsed.region ?? parsed.maximize().region;
  } catch {
    return undefined;
  }
}

/** First country among the languages of the device that the app has products for. */
export function deviceRegion(): Region {
  const nav = globalThis.navigator;
  const tags = nav?.languages?.length ? nav.languages : [nav?.language ?? ''];
  for (const tag of tags) {
    const code = regionOf(tag);
    if (isRegion(code)) return code;
  }
  return language === 'de' ? 'DE' : 'GB';
}

export const region: Region = chosenRegion() ?? deviceRegion();

/** Name of the country in Open Food Facts, for example "germany". */
export const regionTag: string = REGIONS.find((entry) => entry.code === region)!.tag;

/** All countries with their names in the language of the interface, sorted by name. */
export function regionChoices(): { code: Region; name: string }[] {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    // Without the names the codes are shown.
  }
  return REGIONS.map((entry) => ({ code: entry.code, name: names?.of(entry.code) ?? entry.code })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}

/** Stores the country. The app restarts if it differs from the one in use. */
export function setRegion(choice: Region): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    return;
  }
  if (choice !== region) location.reload();
}
