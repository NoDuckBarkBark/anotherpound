import { afterEach, describe, expect, it, vi } from 'vitest';

/** Loads the language modules as a device set to the given languages would. */
async function load(languages: string[], stored: string | null = null) {
  vi.resetModules();
  vi.stubGlobal('navigator', { userAgent: 'node', language: languages[0], languages });
  vi.stubGlobal('localStorage', { getItem: () => stored });
  const locale = await import('../src/lib/locale');
  const { t } = await import('../src/lib/texts');
  const dates = await import('../src/lib/dates');
  return { ...locale, t, ...dates };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('language', () => {
  it('is German on German devices, whatever the region', async () => {
    for (const tag of ['de', 'de-DE', 'de-AT', 'de-CH']) {
      const app = await load([tag, 'en-US']);
      expect(app.language).toBe('de');
      expect(app.t.nav.today).toBe('Heute');
    }
  });

  it('is English on every other device', async () => {
    for (const tag of ['en-US', 'en-GB', 'fr-FR', 'nl', 'ja-JP', 'da-DK']) {
      const app = await load([tag, 'de-DE']);
      expect(app.language).toBe('en');
      expect(app.t.nav.today).toBe('Today');
    }
  });

  it('follows the choice made in the app over the device', async () => {
    expect((await load(['de-DE'], 'en')).language).toBe('en');
    expect((await load(['en-US'], 'de')).language).toBe('de');
    expect((await load(['de-DE'], 'fr')).language).toBe('de');
  });

  it('keeps the region of the device only when it fits the language', async () => {
    expect((await load(['en-US'])).locale).toBe('en-US');
    expect((await load(['de-AT'])).locale).toBe('de-AT');
    expect((await load(['fr-FR'])).locale).toBe('en-GB');
    expect((await load(['en-US'], 'de')).locale).toBe('de-DE');
  });

  it('writes numbers the way the language does and reads both separators', async () => {
    const german = await load(['de-DE']);
    expect(german.decimal).toBe(',');
    expect(german.formatInput(12.5)).toBe('12,5');
    expect(german.formatNumber(2150)).toBe('2.150');
    expect(german.parseInput('12.5')).toBe(12.5);

    const english = await load(['en-GB']);
    expect(english.decimal).toBe('.');
    expect(english.formatInput(12.5)).toBe('12.5');
    expect(english.formatNumber(2150)).toBe('2,150');
    expect(english.parseInput('12,5')).toBe(12.5);
  });

  it('has every English text in German as well', async () => {
    const { en } = await import('../src/lib/texts/en');
    const { de } = await import('../src/lib/texts/de');
    const shape = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.length
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]))
          : typeof value;
    expect(shape(de)).toEqual(shape(en));
  });
});
