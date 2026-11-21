import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { build, preview } from 'vite';

// The real service worker runs here with the real data files, nothing is faked.
test.use({ serviceWorkers: 'allow' });

const workerReady = (page: Page) => page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));

let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

/** Country already chosen, so the question at the first start does not come up. */
async function chooseCountry(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('anotherpound:region')) localStorage.setItem('anotherpound:region', 'GB');
  });
}

test('starts without network, finds a food in the catalog and adds it', async ({ page, context }) => {
  await page.goto('./');
  // First start: the device is British, so the products of the United Kingdom are fetched and kept.
  await page.getByRole('dialog', { name: 'AnotherPound' }).getByRole('button', { name: 'Start' }).click();
  await workerReady(page);
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open('anotherpound-pack')).keys()).length))
    .toBe(1);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Today' })).toBeVisible();

  await page.getByRole('link', { name: 'Add to Breakfast' }).click();
  // The basic foods come from the Bundeslebensmittelschlüssel, with its English names.
  await page.getByRole('searchbox').fill('oat flakes');
  await page.getByRole('button', { name: /^Oat flakes/ }).first().click();
  const sheet = page.getByRole('dialog');
  for (const key of '60') await sheet.getByRole('button', { name: key, exact: true }).click();
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('209 kcal');

  // A product of the country can be found by its barcode number without network.
  const pack = JSON.parse(readFileSync(new URL('../public/data/off/gb.json', import.meta.url), 'utf8')) as { rows: string[][] };
  const [code, name] = pack.rows[0]!;
  await page.getByRole('button', { name: 'Scan barcode' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Barcode number' }).fill(code!);
  await page.getByRole('dialog').getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toContainText(name!);
});

test("is installable: manifest, icons and the browser's own check", async ({ page }) => {
  await chooseCountry(page);
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifestUrl = new URL(href!, page.url()).href;
  const manifest = await (await page.request.get(manifestUrl)).json();

  expect(manifest).toMatchObject({
    name: 'AnotherPound',
    short_name: 'AnotherPound',
    lang: 'en',
    display: 'standalone',
    start_url: './',
    scope: './',
    // Splash screen and bars during startup are dark.
    background_color: '#151514',
    theme_color: '#151514',
  });
  // The page makes room for the keyboard itself and is dark from the start when the device is.
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /interactive-widget=resizes-content/);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark');
  expect(manifest.icons.map((icon: { sizes: string; purpose?: string }) => `${icon.sizes} ${icon.purpose ?? 'any'}`)).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);
  for (const icon of manifest.icons as { src: string }[]) {
    const response = await page.request.get(new URL(icon.src, manifestUrl).href);
    expect(response.headers()['content-type']).toBe('image/png');
  }

  await workerReady(page);
  const session = await page.context().newCDPSession(page);
  const { installabilityErrors } = await session.send('Page.getInstallabilityErrors');
  // The test window is a private window; Chrome never installs anything there.
  expect(installabilityErrors.filter((error) => error.errorId !== 'in-incognito')).toEqual([]);
});

test('takes over a new version by itself at start, after an input only at the press of a button', async ({ page }) => {
  test.setTimeout(120_000);
  const outDir = 'node_modules/.cache/update-test';
  const publish = async (version: string) => {
    process.env.APP_VERSION = version;
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  };

  await chooseCountry(page);
  await publish('9.0.1');
  const server = await preview({ logLevel: 'silent', build: { outDir }, preview: { port: 4175, strictPort: true } });
  try {
    await page.goto('http://localhost:4175/#/more');
    await expect(page.getByText('Version 9.0.1')).toBeVisible();
    await workerReady(page);

    // A new build is on the server. The next opening shows the stored old build first,
    // the new one loads in the background and takes over, because nothing has been tapped yet.
    await publish('9.0.2');
    await page.reload();
    await expect(page.getByText('Version 9.0.2')).toBeVisible({ timeout: 30_000 });

    // After an input the running build stays until the button is pressed.
    await page.getByRole('textbox', { name: 'Meal 1' }).click();
    await publish('9.0.3');
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration?.update()));
    await expect(page.getByRole('button', { name: 'Update' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Version 9.0.2')).toBeVisible();
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByText('Version 9.0.3')).toBeVisible({ timeout: 30_000 });
  } finally {
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
});
