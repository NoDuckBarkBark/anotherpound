import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type Request } from '@playwright/test';
import { toBuffer } from 'bwip-js/node';

const NUTELLA = '4008400402222';

const BLS = {
  source: 'bls',
  fields: ['id', 'name', 'kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'salt', 'alcohol'],
  rows: [
    ['C1', 'Rolled oats', 370, 13.5, 58.7, 0.7, 7, 1.3, 10, 0.02, 0],
    ['F1', 'Raw apple', 55, 0.3, 11.4, 10.3, 0.4, 0.1, 2, 0, 0],
    ['M1', 'Whole milk', 65, 3.4, 4.7, 4.7, 3.6, 2.4, 0, 0.1, 0],
    ['H1', 'Dried lentils', 350, 24, 50, 1, 1.5, 0.2, 11, 0.02, 0],
  ],
};

const OFF_STARTER = {
  source: 'off',
  fields: ['code', 'name', 'brand', 'quantity', 'unit', 'kcal', 'protein', 'carbs', 'sugar', 'fat', 'satFat', 'fiber', 'salt', 'servingLabel', 'servingAmount'],
  rows: [[NUTELLA, 'Nutella', 'Ferrero', '450 g', 'g', 539, 6.3, 57.5, 56.3, 30.9, 10.6, null, 0.11, '15 g', 15]],
};

const cors = { 'access-control-allow-origin': '*' };

// No flow may raise an error in the page, even if everything else is right.
let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

/** Replaces the built-in catalog with small fixed files; Open Food Facts answers "not found" by default. */
async function setup(page: Page) {
  await page.route('**/data/bls.json', (route) => route.fulfill({ json: BLS }));
  await page.route('**/data/off-starter.json', (route) => route.fulfill({ json: OFF_STARTER }));
  await page.route('https://world.openfoodfacts.org/**', (route) =>
    route.fulfill({ status: 404, headers: cors, json: { status: 'failure' } }),
  );
  await page.goto('./');
}

const sheet = (page: Page) => page.getByRole('dialog');
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search foods' });
/** The main button of the open sheet. Exact, because "Add serving" sits in the same sheet. */
const addButton = (page: Page) => sheet(page).getByRole('button', { name: 'Add', exact: true });

/** Display of the typed number in the open sheet. */
async function expectAmount(page: Page, value: string, label = 'Amount') {
  const escaped = value.replace(/[.,]/g, '\\$&');
  await expect(sheet(page).getByRole('status', { name: label })).toHaveText(new RegExp(`^\\s*${escaped}(?![\\d.,])`));
}

/** Taps on the number pad of the open sheet. The first key replaces the prefilled value. */
async function tap(page: Page, text: string) {
  const pad = sheet(page).getByRole('group', { name: 'Number pad' });
  for (const key of text) await pad.getByRole('button', { name: key, exact: true }).click();
}

async function openAdd(page: Page, meal: string) {
  await page.getByRole('link', { name: `Add to ${meal}` }).click();
}

async function addFromSearch(page: Page, query: string, name: RegExp, amount?: string) {
  await search(page).fill(query);
  await page.getByRole('button', { name }).first().click();
  if (amount !== undefined) await tap(page, amount);
  await addButton(page).click();
  await expect(sheet(page)).toBeHidden();
}

test('sections are reachable, nothing sticks out sideways, days can be paged', async ({ page }) => {
  await setup(page);
  const nav = page.getByRole('navigation');
  for (const name of ['Dishes', 'History', 'More', 'Today']) {
    await nav.getByRole('link', { name }).click();
    await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `sideways overflow in ${name}`).toBeLessThanOrEqual(0);
  }

  const title = page.getByRole('heading', { level: 1 });
  const today = await title.textContent();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(title).not.toHaveText(today!);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(title).toHaveText(today!);
});

test('search a food, add it, repeat, change and delete', async ({ page }) => {
  await setup(page);
  await openAdd(page, 'Breakfast');

  await search(page).fill('oat');
  await page.getByRole('button', { name: /^Rolled oats/ }).click();
  // No text field in the sheet: the phone keyboard stays closed. The focus is on "Add".
  await expect(sheet(page).getByRole('textbox')).toHaveCount(0);
  await expectAmount(page, '100');
  await expect(addButton(page)).toBeFocused();
  await tap(page, '60');
  await expect(sheet(page).getByText('222', { exact: true })).toBeVisible();
  await addButton(page).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('222 kcal');
  // Repeat: it is listed under "Recent" with the last amount.
  await page.getByRole('button', { name: /Rolled oats.*60 g · 222 kcal/ }).click();
  await expectAmount(page, '60');
  await sheet(page).getByRole('radio', { name: 'Snacks' }).click();
  await addButton(page).click();

  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByText('444', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Breakfast 222 kcal/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Snacks 222 kcal/ })).toBeVisible();

  // Change
  await page.getByRole('button', { name: /Rolled oats 60 g/ }).first().click();
  await tap(page, '100');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: /Breakfast 370 kcal/ })).toBeVisible();

  // Delete
  await page.getByRole('button', { name: /Rolled oats 100 g/ }).click();
  await sheet(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: /Breakfast 0 kcal/ })).toBeVisible();
  await expect(page.getByText('222', { exact: true }).first()).toBeVisible();
});

test('quick entry and copying a meal from yesterday', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await openAdd(page, 'Lunch');
  await page.getByRole('button', { name: 'Quick entry' }).click();
  await sheet(page).getByRole('textbox', { name: 'kcal' }).fill('700');
  await sheet(page).getByRole('textbox', { name: 'Name' }).fill('Canteen');
  await sheet(page).getByRole('textbox', { name: 'Protein' }).fill('35');
  await addButton(page).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: /Canteen/ })).toBeVisible();
  await expect(page.getByText('700', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByRole('button', { name: /Canteen/ })).toBeHidden();
  await openAdd(page, 'Lunch');
  await page.getByRole('button', { name: 'Copy Lunch from yesterday' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('700 kcal');
});

test('create a food of your own', async ({ page }) => {
  await setup(page);
  await openAdd(page, 'Dinner');
  await search(page).fill('Plain skyr');
  await page.getByRole('button', { name: 'New food' }).click();

  const form = sheet(page);
  await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('Plain skyr');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('textbox', { name: 'kcal' })).toHaveAttribute('aria-invalid', 'true');

  await form.getByRole('textbox', { name: 'kcal' }).fill('64');
  await form.getByRole('textbox', { name: 'Fat', exact: false }).first().fill('0.2');
  await form.getByRole('textbox', { name: 'Carbs' }).fill('4');
  await form.getByRole('textbox', { name: 'Protein' }).fill('11');
  await form.getByRole('textbox', { name: 'Serving', exact: true }).fill('Pot');
  await form.getByRole('textbox', { name: 'Serving size' }).fill('150');
  await form.getByRole('button', { name: 'Save' }).click();

  // After saving, the amount sheet opens with one piece of the serving.
  await expect(sheet(page).getByRole('heading', { name: 'Plain skyr' })).toBeVisible();
  await expectAmount(page, '1');
  await expect(sheet(page).getByRole('radio', { name: 'Pot · 150 g' })).toBeChecked();
  await expect(sheet(page)).toContainText('96 kcal');
  await addButton(page).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('96 kcal');
});

test('piece count: count, change, switch to grams; the app remembers the unit', async ({ page }) => {
  await setup(page);
  // Product with a countable serving: "2 pastilles (2.4 g)" means 1.2 g each.
  await page.route('https://world.openfoodfacts.org/api/v3/product/4000000000037**', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        product: {
          product_name_en: 'Mint drops',
          brands: 'Brand',
          quantity: '25 g',
          serving_size: '2 pastilles (2.4 g)',
          serving_quantity: 2.4,
          nutriments: { 'energy-kcal_100g': 380, proteins_100g: 0, carbohydrates_100g: 94, fat_100g: 1 },
        },
      },
    }),
  );
  await openAdd(page, 'Snacks');
  await page.getByRole('button', { name: 'Scan barcode' }).click();
  await sheet(page).getByRole('textbox', { name: 'Barcode number' }).fill('4000000000037');
  await sheet(page).getByRole('button', { name: 'Search' }).click();

  await expect(sheet(page).getByRole('heading', { name: 'Mint drops' })).toBeVisible();
  await expectAmount(page, '1');
  await expect(sheet(page).getByRole('radio', { name: 'Pastilles · 1.2 g' })).toBeChecked();
  await tap(page, '3');
  await expect(sheet(page)).toContainText('Pastilles · 3.6 g');
  await expect(sheet(page)).toContainText('14 kcal');
  await addButton(page).click();
  await expect(sheet(page)).toBeHidden();

  // The list shows the remembered piece count, the day view shows the entry in pieces.
  await expect(page.getByRole('button', { name: /^Mint drops/ })).toContainText('3 × Pastilles · 14 kcal');
  await page.getByRole('link', { name: 'Back' }).click();
  const row = page.getByRole('button', { name: /^Mint drops/ });
  await expect(row).toContainText('3 × Pastilles');

  // Change the entry: it is still counted in pieces.
  await row.click();
  await expectAmount(page, '3');
  await tap(page, '5');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('5 × Pastilles');
  await expect(row).toContainText('23');

  // Switching to grams converts; after that the app remembers grams.
  await openAdd(page, 'Snacks');
  await page.getByRole('button', { name: /^Mint drops/ }).click();
  await expectAmount(page, '3');
  await sheet(page).getByRole('radio', { name: 'g', exact: true }).click();
  await expectAmount(page, '3.6');
  await tap(page, '10');
  await addButton(page).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole('button', { name: /^Mint drops/ })).toContainText('10 g · 38 kcal');
});

test('add a serving of your own to a catalog food and add it in pieces', async ({ page }) => {
  await setup(page);
  await openAdd(page, 'Snacks');
  await search(page).fill('apple');
  await page.getByRole('button', { name: /^Raw apple/ }).click();

  await expectAmount(page, '100');
  await sheet(page).getByRole('button', { name: 'Add serving' }).click();
  await sheet(page).getByRole('textbox', { name: 'Serving size' }).fill('150');
  await sheet(page).getByRole('button', { name: 'Save' }).click();

  // Without a label the serving is called "Piece"; it is selected right away.
  await expect(sheet(page).getByRole('radio', { name: 'Piece · 150 g' })).toBeChecked();
  await expectAmount(page, '1');
  await tap(page, '2');
  await addButton(page).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('165 kcal');

  // The serving stays with the food and can be replaced with a new weight.
  await search(page).fill('');
  await page.getByRole('button', { name: /^Raw apple/ }).click();
  await expectAmount(page, '2');
  await sheet(page).getByRole('button', { name: 'Add serving' }).click();
  await sheet(page).getByRole('textbox', { name: 'Serving', exact: true }).fill('Piece');
  await sheet(page).getByRole('textbox', { name: 'Serving size' }).fill('180');
  await sheet(page).getByRole('textbox', { name: 'Serving size' }).press('Enter');
  await expect(sheet(page).getByRole('radio', { name: 'Piece · 180 g' })).toBeChecked();
  await expect(sheet(page).getByRole('radio')).toHaveCount(6);
});

test('scanner: image, starter pack, lookup, missing product, invalid number', async ({ page }) => {
  await setup(page);
  await openAdd(page, 'Snacks');

  // Image with the barcode of a product from the starter pack: no lookup needed.
  const png = await toBuffer({ bcid: 'ean13', text: NUTELLA, scale: 4, includetext: true, paddingwidth: 20, paddingheight: 20, backgroundcolor: 'FFFFFF' });
  await page.getByRole('button', { name: 'Scan barcode' }).click();
  await sheet(page).locator('input[type=file]').setInputFiles({ name: 'ean.png', mimeType: 'image/png', buffer: png });
  await expect(sheet(page).getByRole('heading', { name: 'Nutella' })).toBeVisible();
  await expect(sheet(page).getByText('Ferrero · 450 g')).toBeVisible();
  await expectAmount(page, '15');
  await addButton(page).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('81 kcal');

  // Invalid number
  await page.getByRole('button', { name: 'Scan barcode' }).click();
  await sheet(page).getByRole('textbox', { name: 'Barcode number' }).fill('4008400402223');
  await sheet(page).getByRole('button', { name: 'Search' }).click();
  await expect(sheet(page).getByText('Invalid number')).toBeVisible();

  // An unknown product is found at Open Food Facts.
  await page.route('https://world.openfoodfacts.org/api/v3/product/4000000000013**', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        product: {
          product_name_en: 'Test bar',
          brands: 'Brand',
          quantity: '40 g',
          nutriments: { 'energy-kcal_100g': 450, proteins_100g: 8, carbohydrates_100g: 60, fat_100g: 20 },
        },
      },
    }),
  );
  await sheet(page).getByRole('textbox', { name: 'Barcode number' }).fill('4000000000013');
  await sheet(page).getByRole('button', { name: 'Search' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Test bar' })).toBeVisible();
  await tap(page, '40');
  await addButton(page).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('261 kcal');

  // Once found, it stays on the device and is found by typing.
  await search(page).fill('test bar');
  await expect(page.getByRole('button', { name: /^Test bar/ })).toBeVisible();
  await search(page).fill('');

  // A missing product leads to creating one, the barcode is prefilled.
  await page.getByRole('button', { name: 'Scan barcode' }).click();
  await sheet(page).getByRole('textbox', { name: 'Barcode number' }).fill('96385074');
  await sheet(page).getByRole('button', { name: 'Search' }).click();
  await expect(sheet(page).getByRole('heading', { name: 'Food' })).toBeVisible();
  await expect(sheet(page).getByRole('textbox', { name: 'Barcode' })).toHaveValue('96385074');
});

test('a correction creates a food of your own that takes precedence', async ({ page }) => {
  await setup(page);
  await openAdd(page, 'Snacks');
  await search(page).fill('nutella');
  await page.getByRole('button', { name: /^Nutella/ }).click();
  await sheet(page).getByRole('button', { name: 'Values' }).click();

  await expect(sheet(page).getByRole('textbox', { name: 'Barcode' })).toHaveValue(NUTELLA);
  await sheet(page).getByRole('textbox', { name: 'kcal' }).fill('547');
  await sheet(page).getByRole('button', { name: 'Save' }).click();

  await expect(sheet(page)).toContainText('547 kcal');
  await page.keyboard.press('Escape');

  await search(page).fill('nutella');
  await expect(page.getByRole('button', { name: /^Nutella/ })).toHaveCount(1);
  // The row shows the serving size of 15 g with the corrected value.
  await expect(page.getByRole('button', { name: /^Nutella/ })).toContainText('15 g · 82 kcal');
});

test('create a dish with a cooked weight and add it by grams', async ({ page }) => {
  await setup(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Dishes' }).click();
  await page.getByRole('link', { name: 'New dish' }).click();

  await page.getByRole('textbox', { name: 'Name' }).fill('Lentil stew');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await search(page).fill('lentil');
  await page.getByRole('button', { name: /^Dried lentils/ }).click();
  await page.getByRole('textbox', { name: 'Amount Dried lentils' }).fill('200');
  await page.getByRole('textbox', { name: 'Cooked weight' }).fill('1000');
  await page.getByRole('textbox', { name: 'Servings' }).fill('4');
  await expect(page.getByText('700 kcal')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('link', { name: /Lentil stew.*70 kcal per 100 g/ })).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Today' }).click();
  await openAdd(page, 'Lunch');
  await page.getByRole('tab', { name: 'Dishes' }).click();
  await page.getByRole('button', { name: /^Lentil stew/ }).click();
  // Four servings from 1000 g: the amount sheet opens with one serving, grams still work.
  await expectAmount(page, '1');
  await expect(sheet(page).getByRole('radio', { name: 'Serving · 250 g' })).toBeChecked();
  await sheet(page).getByRole('radio', { name: 'g', exact: true }).click();
  await expectAmount(page, '250');
  await tap(page, '300');
  await addButton(page).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('210 kcal');
});

test('save a meal as a template and add it the next day in one go', async ({ page }) => {
  await setup(page);
  await openAdd(page, 'Breakfast');
  await addFromSearch(page, 'oat', /^Rolled oats/, '60');
  await addFromSearch(page, 'whole milk', /^Whole milk/, '200');

  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'Save Breakfast as template' }).click();
  await expect(page.getByRole('button', { name: /^Breakfast 352 kcal$/ })).toBeVisible();

  await page.getByRole('link', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await openAdd(page, 'Breakfast');
  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: /^Breakfast 352 kcal$/ }).click();

  await expect(sheet(page).getByText('352 kcal')).toBeVisible();
  await sheet(page).getByRole('textbox', { name: 'Amount Whole milk' }).fill('100');
  await expect(sheet(page).getByText('287 kcal')).toBeVisible();
  await addButton(page).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('287 kcal');
});

test('calculate a goal: the day view shows what is left', async ({ page }) => {
  await setup(page);
  await page.getByRole('navigation').getByRole('link', { name: 'More' }).click();
  await page.getByRole('link', { name: /Goals/ }).click();

  await page.getByRole('textbox', { name: 'Birth year' }).fill(String(new Date().getFullYear() - 30));
  await page.getByRole('textbox', { name: 'Height' }).fill('180');
  await page.getByRole('textbox', { name: 'Weight' }).fill('80');
  await page.getByRole('radio', { name: '−0.5' }).click();
  await page.getByRole('radio', { name: '1.6 g' }).click();
  await expect(page.getByText('Maintenance 2,848 kcal')).toBeVisible();
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByRole('textbox', { name: 'kcal' })).toHaveValue('2300');
  await expect(page.getByRole('textbox', { name: 'Protein', exact: false }).first()).toHaveValue('128');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('link', { name: /Goals.*2,300 kcal/ })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Today' }).click();
  await expect(page.getByText('2,300', { exact: true })).toBeVisible();
  await expect(page.getByText('left')).toBeVisible();

  await openAdd(page, 'Breakfast');
  await addFromSearch(page, 'oat', /^Rolled oats/, '100');
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByText('1,930', { exact: true })).toBeVisible();
  await expect(page.getByText('370 / 2,300')).toBeVisible();

  // Restart: the day view only appears with the real values. No interim state without a goal or with 0 kcal.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const text = document.querySelector('main')?.textContent ?? '';
      if (text.includes('kcal')) seen.push(text);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.reload();
  await expect(page.getByText('1,930', { exact: true })).toBeVisible();
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((text) => !text.includes('left') || !text.includes('370 / 2,300'))).toEqual([]);
});

test('number pad: first key replaces, backspace, decimal point, keyboard on a computer, Enter adds', async ({ page }) => {
  await setup(page);
  await openAdd(page, 'Dinner');
  await search(page).fill('oat');
  await page.getByRole('button', { name: /^Rolled oats/ }).click();
  const pad = sheet(page).getByRole('group', { name: 'Number pad' });
  const back = pad.getByRole('button', { name: 'Backspace' });
  const add = addButton(page);
  await expectAmount(page, '100');

  // Backspace takes the last digit off the prefilled value, the next digit is appended.
  await back.click();
  await expectAmount(page, '10');
  await tap(page, '2');
  await expectAmount(page, '102');
  await expect(sheet(page)).toContainText('377 kcal');

  // Empty: nothing is added, the sheet stays open.
  for (let index = 0; index < 3; index++) await back.click();
  await expectAmount(page, '0');
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await add.click({ force: true });
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('0 kcal');

  await tap(page, '12..5');
  await expectAmount(page, '12.5');
  await expect(sheet(page)).toContainText('46 kcal');

  // Switching the unit prefills anew; the first key replaces again.
  await sheet(page).getByRole('button', { name: 'Add serving' }).click();
  await sheet(page).getByRole('textbox', { name: 'Serving size' }).fill('40');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expectAmount(page, '1');
  await tap(page, '2');
  await expectAmount(page, '2');
  await expect(sheet(page)).toContainText('296 kcal');
  await sheet(page).getByRole('radio', { name: 'g', exact: true }).click();
  await expectAmount(page, '80');

  // With a real keyboard: type digits, Enter adds. A comma counts as the decimal point too.
  await page.keyboard.type('60');
  await expectAmount(page, '60');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('5,5');
  await expectAmount(page, '65.5');
  await page.keyboard.press('Enter');
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('242 kcal');
});

test('confirmation with undo after adding, deleting and a template', async ({ page }) => {
  await setup(page);
  const toast = page.getByRole('status').filter({ hasText: 'Undo' });
  const undo = toast.getByRole('button', { name: 'Undo' });

  await openAdd(page, 'Breakfast');
  await addFromSearch(page, 'oat', /^Rolled oats/, '60');
  await expect(toast).toContainText('Rolled oats · 60 g');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('222 kcal');
  await undo.click();
  await expect(toast).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('0 kcal');

  // Two entries, saved as a template; adding the template can be undone as a whole.
  await addFromSearch(page, 'oat', /^Rolled oats/, '60');
  await addFromSearch(page, 'milk', /^Whole milk/, '200');
  await search(page).fill('');
  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'Save Breakfast as template' }).click();
  await page.getByRole('button', { name: /^Breakfast 352 kcal$/ }).click();
  await addButton(page).click();
  await expect(toast).toContainText('Breakfast · 2 entries');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('704 kcal');
  await undo.click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('352 kcal');

  // Delete in the day view.
  await page.getByRole('link', { name: 'Back' }).click();
  await page.getByRole('button', { name: /Rolled oats 60 g/ }).click();
  await sheet(page).getByRole('button', { name: 'Delete' }).click();
  await expect(toast).toContainText('Rolled oats deleted');
  await expect(page.getByRole('heading', { name: /Breakfast 130 kcal/ })).toBeVisible();
  await undo.click();
  await expect(page.getByRole('heading', { name: /Breakfast 352 kcal/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Rolled oats 60 g/ })).toBeVisible();
});

test('enter a weight and look at the week', async ({ page }) => {
  await setup(page);
  await openAdd(page, 'Dinner');
  await addFromSearch(page, 'apple', /^Raw apple/, '200');
  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();

  await expect(page.getByText('Average')).toBeVisible();
  await expect(page.getByText('110 kcal')).toBeVisible();

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await tap(page, '81.4');
  await addButton(page).click();
  await expect(page.getByText('81.4 kg').first()).toBeVisible();
  await expect(page.getByText(/Trend\s+81\.4 kg/)).toBeVisible();
});

test('rename meals', async ({ page }) => {
  await setup(page);
  await page.getByRole('navigation').getByRole('link', { name: 'More' }).click();
  const field = page.getByRole('textbox', { name: 'Meal 2' });
  await field.fill('Late lunch');
  await field.blur();
  await page.getByRole('navigation').getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: /Late lunch/ })).toBeVisible();

  // The other names stay defaults: they follow the language, the chosen one stays.
  await page.getByRole('navigation').getByRole('link', { name: 'More' }).click();
  await page.getByRole('radio', { name: 'Deutsch', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Mahlzeit 1' })).toHaveValue('Frühstück');
  await expect(page.getByRole('textbox', { name: 'Mahlzeit 2' })).toHaveValue('Late lunch');

  // An emptied name goes back to the default.
  await page.getByRole('textbox', { name: 'Mahlzeit 2' }).fill('');
  await page.getByRole('textbox', { name: 'Mahlzeit 2' }).blur();
  await expect(page.getByRole('textbox', { name: 'Mahlzeit 2' })).toHaveValue('Mittag');
  await page.getByRole('navigation').getByRole('link', { name: 'Heute' }).click();
  await expect(page.getByRole('heading', { name: /Mittag/ })).toBeVisible();
});

test('a backup becomes due a week after the first entry and the mark goes away with the export', async ({ page }) => {
  await setup(page);
  const more = page.getByRole('navigation').getByRole('link', { name: 'More' });
  await openAdd(page, 'Breakfast');
  await addFromSearch(page, 'oat', /^Rolled oats/);
  await expect(more.getByRole('img', { name: 'Backup due' })).toHaveCount(0);

  await page.clock.install({ time: Date.now() + 8 * 24 * 60 * 60 * 1000 });
  await page.reload();
  await expect(more.getByRole('img', { name: 'Backup due' })).toBeVisible();
  await more.click();
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Backup' }) });
  await expect(card.getByRole('img', { name: 'Backup due' })).toBeVisible();

  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export' }).click();
  await download;
  await expect(card.getByRole('img', { name: 'Backup due' })).toHaveCount(0);
  await expect(more.getByRole('img', { name: 'Backup due' })).toHaveCount(0);
});

test('backup: export, delete, import brings everything back; foreign files are rejected', async ({ page }) => {
  await setup(page);
  await openAdd(page, 'Breakfast');
  await addFromSearch(page, 'oat', /^Rolled oats/, '60');
  await page.getByRole('navigation').getByRole('link', { name: 'More' }).click();
  await expect(page.getByText('never')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^anotherpound-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const file = JSON.parse(await readFile(path, 'utf8'));
  expect(file).toMatchObject({ app: 'anotherpound', formatVersion: 1 });
  expect(file.tables.entries).toHaveLength(1);
  expect(file.tables.foods).toHaveLength(1);
  await expect(page.getByText('never')).toBeHidden();

  await page.getByRole('navigation').getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: /Rolled oats 60 g/ }).click();
  await sheet(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: /Rolled oats 60 g/ })).toBeHidden();

  await page.getByRole('navigation').getByRole('link', { name: 'More' }).click();
  const picker = page.locator('input[type=file]');
  await picker.setInputFiles(path);
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText('Backup restored')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('button', { name: /Rolled oats 60 g/ })).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'More' }).click();
  await picker.setInputFiles({ name: 'foreign.json', mimeType: 'application/json', buffer: Buffer.from('{"foo":1}') });
  await expect(page.getByText('Not an AnotherPound backup')).toBeVisible();
});

const HOOK = 'https://hooks.example.test/in';

interface Received {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any;
  headers: Record<string, string>;
}

/** Stands in for a webhook target and collects what arrives. `accepts` decides per request whether it gets through. */
async function hookTarget(page: Page, accepts: (request: Request) => boolean = () => true) {
  const received: Received[] = [];
  await page.route('https://hooks.example.test/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } });
    }
    if (!accepts(request)) return route.abort('failed');
    received.push({ message: request.postDataJSON(), headers: request.headers() });
    await route.fulfill({ status: 200, headers: cors, body: '' });
  });
  return received;
}

test('webhook: test, report changes, collect without network and send later in order', async ({ page, context }) => {
  await setup(page);
  const received = await hookTarget(page);
  const events = () => received.map((call) => call.message.event);
  const nav = page.getByRole('navigation');
  const address = page.getByRole('textbox', { name: 'URL' });

  await nav.getByRole('link', { name: 'More' }).click();
  const tryIt = page.getByRole('button', { name: 'Test', exact: true });
  await expect(tryIt).toBeDisabled();
  await address.fill('http://hooks.example.test/in');
  await expect(tryIt).toBeDisabled();
  await address.fill(HOOK);
  await page.getByRole('textbox', { name: 'Header' }).fill('X-Token');
  await page.getByLabel('Value', { exact: true }).fill('abc123');
  await tryIt.click();
  await expect(page.getByText('Last sent')).toBeVisible();
  expect(events()).toEqual(['test']);
  expect(received[0]!.headers['x-token']).toBe('abc123');
  expect(received[0]!.headers['content-type']).toBe('application/json');
  expect(received[0]!.message).toMatchObject({ app: 'anotherpound', format: 1, text: 'AnotherPound: test' });

  // Switch off: entries are added, but nothing is reported.
  await nav.getByRole('link', { name: 'Today' }).click();
  await openAdd(page, 'Breakfast');
  await addFromSearch(page, 'oat', /^Rolled oats/, '60');

  await nav.getByRole('link', { name: 'More' }).click();
  await expect(address).toHaveValue(HOOK);
  await page.getByRole('switch', { name: 'Webhook' }).check();
  await nav.getByRole('link', { name: 'Today' }).click();
  await openAdd(page, 'Breakfast');
  await addFromSearch(page, 'apple', /^Raw apple/, '200');
  await expect.poll(events).toEqual(['test', 'entry.created']);
  const created = received[1]!.message;
  expect(created).toMatchObject({
    entry: { name: 'Raw apple', amount: 200, unit: 'g', meal: 0, mealName: 'Breakfast', kind: 'food', nutrients: { kcal: 110 } },
    day: { total: { kcal: 332 }, goal: null },
    text: 'Added: Raw apple, 200 g, 110 kcal (Breakfast). Day: 332 kcal.',
  });
  expect(created.day.date).toBe(created.entry.date);
  expect(received[1]!.headers['x-token']).toBe('abc123');

  // Without network: adding and changing keep working, the messages wait.
  await context.setOffline(true);
  await addFromSearch(page, 'oat', /^Rolled oats/, '100');
  await page.getByRole('link', { name: 'Back' }).click();
  await page.getByRole('button', { name: /Raw apple 200 g/ }).click();
  await tap(page, '100');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: /Breakfast 647 kcal/ })).toBeVisible();
  await nav.getByRole('link', { name: 'More' }).click();
  await expect(page.getByText(/Waiting\s*2/)).toBeVisible();
  expect(events()).toEqual(['test', 'entry.created']);

  // Network back: both go out in the order of the changes, with the day total of that moment.
  await context.setOffline(false);
  await expect.poll(events).toEqual(['test', 'entry.created', 'entry.created', 'entry.updated']);
  expect(received[2]!.message).toMatchObject({ entry: { name: 'Rolled oats', amount: 100 }, day: { total: { kcal: 702 } } });
  expect(received[3]!.message).toMatchObject({ entry: { name: 'Raw apple', amount: 100, nutrients: { kcal: 55 } }, day: { total: { kcal: 647 } } });
  await expect(page.getByText('Waiting')).toBeHidden();

  // Weight and goal
  await nav.getByRole('link', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await tap(page, '81.4');
  await addButton(page).click();
  await expect.poll(events).toHaveLength(5);
  expect(received[4]!.message).toMatchObject({ event: 'weight.set', weight: { kg: 81.4 }, text: expect.stringMatching(/^Weight: 81\.4 kg/) });

  await nav.getByRole('link', { name: 'More' }).click();
  await page.getByRole('link', { name: /Goals/ }).click();
  await page.getByRole('textbox', { name: 'kcal' }).fill('2000');
  for (const [name, grams] of [['Protein', '120'], ['Carbs', '220'], ['Fat', '65']] as const) {
    await page.getByRole('textbox', { name }).first().fill(grams);
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(events).toHaveLength(6);
  expect(received[5]!.message).toMatchObject({
    event: 'goal.changed',
    goal: { kcal: 2000, protein: 120, carbs: 220, fat: 65 },
    day: { total: { kcal: 647 }, goal: { kcal: 2000 } },
  });
});

test('webhook: a target that does not admit browsers gets the plain request; with a header an error remains', async ({ page }) => {
  await setup(page);
  // This target only accepts what a browser may send without asking first: no JSON type, no header of its own.
  const received = await hookTarget(page, (request) => !request.headers()['content-type']?.startsWith('application/json'));
  await page.getByRole('navigation').getByRole('link', { name: 'More' }).click();

  await page.getByRole('textbox', { name: 'URL' }).fill(HOOK);
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByText(/Last sent.*unconfirmed/)).toBeVisible();
  expect(received).toHaveLength(1);
  expect(received[0]!.headers['content-type']).toMatch(/^text\/plain/);
  expect(received[0]!.message).toMatchObject({ event: 'test', format: 1 });

  await page.getByRole('textbox', { name: 'Header' }).fill('Authorization');
  await page.getByLabel('Value', { exact: true }).fill('Bearer abc');
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByText(/Last error\s*Unreachable/)).toBeVisible();
  expect(received).toHaveLength(1);

  // The URL survives a reload, the secret stays masked.
  await page.reload();
  await page.getByRole('navigation').getByRole('link', { name: 'More' }).click();
  await expect(page.getByRole('textbox', { name: 'URL' })).toHaveValue(HOOK);
  await expect(page.getByLabel('Value', { exact: true })).toHaveCSS('-webkit-text-security', 'disc');
  await expect(page.getByLabel('Value', { exact: true })).toHaveValue('Bearer abc');
});

test.describe('language', () => {
  /** A chip of the language card under "More". The card is called "Sprache" in German. */
  const chip = (page: Page, card: string, name: string) =>
    page.getByRole('radiogroup', { name: card }).getByRole('radio', { name, exact: true });

  test.describe('German device', () => {
    test.use({ locale: 'de-DE' });

    test('gets the German interface with a comma on the number pad', async ({ page }) => {
      await setup(page);
      await expect(page.getByRole('navigation').getByRole('link', { name: 'Heute' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');

      await page.getByRole('link', { name: 'Zu Frühstück hinzufügen' }).click();
      await page.getByRole('searchbox', { name: 'Lebensmittel suchen' }).fill('oat');
      await page.getByRole('button', { name: /^Rolled oats/ }).click();
      const pad = sheet(page).getByRole('group', { name: 'Zahlenfeld' });
      await expect(pad.getByRole('button', { name: ',', exact: true })).toBeVisible();
      await expect(pad.getByRole('button', { name: '.', exact: true })).toHaveCount(0);
      for (const key of '12,5') await pad.getByRole('button', { name: key, exact: true }).click();
      await expectAmount(page, '12,5', 'Menge');
    });
  });

  test.describe('English device', () => {
    test.use({ locale: 'en-GB' });

    test('gets the English interface with a point on the number pad', async ({ page }) => {
      await setup(page);
      await expect(page.getByRole('navigation').getByRole('link', { name: 'Today' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');

      await openAdd(page, 'Breakfast');
      await search(page).fill('oat');
      await page.getByRole('button', { name: /^Rolled oats/ }).click();
      const pad = sheet(page).getByRole('group', { name: 'Number pad' });
      await expect(pad.getByRole('button', { name: '.', exact: true })).toBeVisible();
      await expect(pad.getByRole('button', { name: ',', exact: true })).toHaveCount(0);
    });

    test('switching under "More" restarts the app in that language; the choice survives a reload', async ({ page }) => {
      await setup(page);
      const nav = page.getByRole('navigation');
      const html = page.locator('html');
      await nav.getByRole('link', { name: 'More' }).click();
      await expect(page.getByRole('heading', { name: 'Language' })).toBeVisible();
      await expect(chip(page, 'Language', 'Device')).toHaveAttribute('aria-checked', 'true');
      await expect(chip(page, 'Language', 'English')).toHaveAttribute('aria-checked', 'false');
      await expect(chip(page, 'Language', 'Deutsch')).toHaveAttribute('aria-checked', 'false');

      const expectGerman = async () => {
        await expect(nav.getByRole('link', { name: 'Heute' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Mehr' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('heading', { name: 'Sprache' })).toBeVisible();
        await expect(html).toHaveAttribute('lang', 'de');
        await expect(chip(page, 'Sprache', 'Deutsch')).toHaveAttribute('aria-checked', 'true');
        await expect(chip(page, 'Sprache', 'Gerät')).toHaveAttribute('aria-checked', 'false');
        await expect(chip(page, 'Sprache', 'English')).toHaveAttribute('aria-checked', 'false');
      };

      // Choosing German reloads the app; it comes back in German on the same page.
      await chip(page, 'Language', 'Deutsch').click();
      await expectGerman();
      await page.reload();
      await expectGerman();

      // Back to the device: English again.
      await chip(page, 'Sprache', 'Gerät').click();
      await expect(nav.getByRole('link', { name: 'Today' })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { name: 'Language' })).toBeVisible();
      await expect(html).toHaveAttribute('lang', 'en');
      await expect(chip(page, 'Language', 'Device')).toHaveAttribute('aria-checked', 'true');
      await expect(chip(page, 'Language', 'Deutsch')).toHaveAttribute('aria-checked', 'false');
    });
  });
});
