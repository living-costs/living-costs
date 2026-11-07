import { test, expect } from '@playwright/test';
import {
  expectNoAxeViolations, trackCspViolations, importFiles, readStore, openScreen, navButton, setBucketCategory, FIXTURE_ACCOUNTS, skipToCard, cardHeading,
} from './helpers.js';

/** The row of a bucket, found by its select's name. */
const rowOf = (page, name) => page.getByRole('row').filter({ has: page.getByRole('combobox', { name: `Category for ${name}`, exact: true }) });
const categoryOf = async (page, name) => (await readStore(page, 'buckets')).find((b) => b.displayName === name)?.categoryId;

test.beforeEach(async ({ page }) => {
  await trackCspViolations(page);
  // The first half of setupFixtureApp, without savings, and with nothing categorised.
  await page.goto('./');
  await expect(page.locator('#screen h2')).toHaveText('Help');
  const wholeYear = /** @type {[string, string]} */ (['01/11/2025', '31/10/2026']);
  await importFiles(page, { files: ['bank-a-current.csv'], account: FIXTURE_ACCOUNTS.bankA, covers: wholeYear });
  await importFiles(page, { files: ['card.csv'], account: FIXTURE_ACCOUNTS.card, covers: wholeYear });
  await importFiles(page, {
    files: ['bank-b-2026-08.csv', 'bank-b-2026-09.csv', 'bank-b-2026-10.csv'], account: FIXTURE_ACCOUNTS.bankB, covers: 'whole-month',
  });
  await expect.poll(async () => (await readStore(page, 'batches')).length).toBe(5);
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('nav count, Suggested column and Accept', async ({ page }) => {
  const nav = navButton(page, 'Buckets');
  await expect(nav).toHaveAccessibleName('Buckets, 5 suggestions');
  await expect(nav).toHaveClass(/\battention\b/);

  await openScreen(page, 'Buckets');
  const headers = page.getByRole('columnheader');
  await expect(headers.last()).toHaveText('Suggested');
  const tesco = rowOf(page, 'TESCO STORES');
  const lastCell = (row) => row.getByRole('cell').last();
  await expect(lastCell(tesco)).toContainText('Groceries');
  await expect(tesco.getByRole('button', { name: 'Accept Groceries for TESCO STORES' })).toBeVisible();
  await expect(lastCell(rowOf(page, 'PARKING METER'))).toHaveText('');
  await expectNoAxeViolations(page);

  await tesco.getByRole('button', { name: 'Accept Groceries for TESCO STORES' }).click();
  const groceries = (await readStore(page, 'categories')).find((c) => c.name === 'Groceries').id;
  expect(await categoryOf(page, 'TESCO STORES')).toBe(groceries);
  await expect(page.getByRole('combobox', { name: 'Category for TESCO STORES', exact: true })).toHaveValue(groceries);
  await expect(page.getByRole('combobox', { name: 'Category for TESCO STORES', exact: true })).toBeFocused();
  await expect(nav).toHaveAccessibleName('Buckets, 4 suggestions');
  await expect(lastCell(rowOf(page, 'TESCO STORES'))).toHaveText('');

  await setBucketCategory(page, 'SPOTIFY', 'Entertainment');
  await expect(nav).toHaveAccessibleName('Buckets, 3 suggestions');
});

test('quick double Accept with the filter on', async ({ page }) => {
  await openScreen(page, 'Buckets');
  await page.getByLabel('Only uncategorised').check();
  await page.getByRole('button', { name: 'Accept Shopping for AMAZON.CO.UK' }).click();
  await page.getByRole('button', { name: 'Accept Transport for TRAINLINE' }).click();
  const shopping = (await readStore(page, 'categories')).find((c) => c.name === 'Shopping').id;
  const transport = (await readStore(page, 'categories')).find((c) => c.name === 'Transport').id;
  await expect.poll(() => categoryOf(page, 'AMAZON.CO.UK')).toBe(shopping);
  await expect.poll(() => categoryOf(page, 'TRAINLINE')).toBe(transport);
  const focused = page.locator(':focus');
  await expect(focused).toHaveAttribute('aria-label', /^Category for /);
  await expect(navButton(page, 'Buckets')).toHaveAccessibleName('Buckets, 3 suggestions');
});

test('accepting every suggestion clears the highlight', async ({ page }) => {
  await openScreen(page, 'Buckets');
  for (const [cat, name] of [['Groceries', 'TESCO STORES'], ['Groceries', 'SAINSBURYS S/MKT'], ['Shopping', 'AMAZON.CO.UK'],
    ['Subscriptions', 'SPOTIFY'], ['Transport', 'TRAINLINE']]) {
    await page.getByRole('button', { name: `Accept ${cat} for ${name}` }).click();
    await expect.poll(() => categoryOf(page, name)).toBeTruthy();
  }
  const nav = navButton(page, 'Buckets');
  await expect(nav).toHaveAccessibleName('Buckets');
  await expect(nav).not.toHaveClass(/\battention\b/);
  await expectNoAxeViolations(page);
});

test('categorise card marks the suggested category', async ({ page }) => {
  await openScreen(page, 'Categorise');
  await skipToCard(page, 'TESCO STORES');
  const groceries = page.locator('#card').getByRole('button', { name: /^\d* ?Groceries/ });
  await expect(groceries).toHaveAccessibleName(/Groceries Suggested$/);
  await expect(groceries).toContainText('Suggested');
  await expect(page.locator('#card button', { hasText: 'Suggested' })).toHaveCount(1);
  await skipToCard(page, 'PARKING METER');
  await expect(page.locator('#card button', { hasText: 'Suggested' })).toHaveCount(0);
});

test('Enter on the card accepts the suggestion', async ({ page }) => {
  await openScreen(page, 'Categorise');
  await skipToCard(page, 'TESCO STORES');
  await page.locator('#card').focus();
  await page.keyboard.press('Enter');
  const groceries = (await readStore(page, 'categories')).find((c) => c.name === 'Groceries').id;
  await expect.poll(() => categoryOf(page, 'TESCO STORES')).toBe(groceries);
  await expect(cardHeading(page)).not.toHaveText('TESCO STORES');
});

test('Enter on a button keeps its own meaning', async ({ page }) => {
  await openScreen(page, 'Categorise');
  await skipToCard(page, 'AMAZON.CO.UK');
  await page.locator('#card').getByRole('button', { name: /^\d* ?Shopping/ }).focus();
  await page.keyboard.press('Enter');
  const id = async (n) => (await readStore(page, 'categories')).find((c) => c.name === n).id;
  await expect.poll(() => categoryOf(page, 'AMAZON.CO.UK')).toBe(await id('Shopping'));
  await skipToCard(page, 'SPOTIFY');
  await page.locator('#card').getByRole('button', { name: /^\d* ?Eating out/ }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => categoryOf(page, 'SPOTIFY')).toBe(await id('Eating out'));
});

for (const scheme of ['light', 'dark']) {
  test(`suggested mark passes axe in ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openScreen(page, 'Categorise');
    await skipToCard(page, 'TESCO STORES');
    await expect(page.locator('#card button', { hasText: 'Suggested' })).toHaveCount(1);
    await expectNoAxeViolations(page);
  });
}
