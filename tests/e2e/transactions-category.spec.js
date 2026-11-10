// The Category filter on Transactions, against the full fixture state reached through the real
// UI. One page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations, setupFixtureApp, openScreen, setBucketCategory } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

const categorySelect = () => page.getByLabel('Category', { exact: true });
const bucketSelect = () => page.getByLabel('Bucket', { exact: true });
const rows = () => page.getByRole('region', { name: 'Matching transactions' }).locator('tbody tr');

test.beforeAll(async ({ browser, baseURL }) => {
  // A context of its own: axe needs a page from browser.newContext(), not browser.newPage().
  context = await browser.newContext({ baseURL });
  page = await context.newPage();
  await trackCspViolations(page);
  await setupFixtureApp(page);
});

test.afterAll(async () => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  await context.close();
});

test('the Category select sits between Search and Bucket, with the groups first', async () => {
  await openScreen(page, 'Transactions');
  const labels = await page.locator('#screen [role="search"] label').allInnerTexts();
  const names = labels.map((l) => l.split('\n')[0].trim());
  expect(names.indexOf('Category')).toBe(names.indexOf('Search transactions') + 1);
  expect(names.indexOf('Bucket')).toBe(names.indexOf('Category') + 1);
  const options = await categorySelect().locator('option').allInnerTexts();
  expect(options.slice(0, 3)).toEqual(['All categories', 'Uncategorised', 'By kind: Spend']);
  expect(options).toContain('By type: One-off');
  expect(options).toContain('Groceries');
  await expectNoAxeViolations(page);
});

test('Uncategorised shows only uncategorised rows; a kind narrows the Bucket options', async () => {
  await categorySelect().selectOption({ label: 'Uncategorised' });
  await expect(categorySelect()).toBeFocused();
  await expect(rows().first()).toBeVisible();
  const sources = await rows().locator('.source').allInnerTexts();
  expect(sources.length).toBeGreaterThan(0);
  expect(new Set(sources)).toEqual(new Set(['uncategorised']));

  await categorySelect().selectOption({ label: 'By kind: Income' });
  await expect(bucketSelect().locator('option', { hasText: 'EXAMPLE EMPLOYER LTD SALARY' })).toHaveCount(1);
  await expect(bucketSelect().locator('option', { hasText: 'TESCO STORES' })).toHaveCount(0);
});

test('By kind: Ignore lists a bucket set to Ignore', async () => {
  await openScreen(page, 'Buckets');
  await setBucketCategory(page, 'GAMESHOP', 'Ignore');
  await openScreen(page, 'Transactions');
  await categorySelect().selectOption({ label: 'By kind: Ignore' });
  await expect(rows().first()).toBeVisible();
  await expect(bucketSelect().locator('option', { hasText: 'GAMESHOP' })).toHaveCount(1);
  await expect(rows().first()).toContainText('GAMESHOP');
  await openScreen(page, 'Buckets');
  await setBucketCategory(page, 'GAMESHOP', 'Entertainment');
  await openScreen(page, 'Transactions');
  await categorySelect().selectOption({ label: 'All categories' });
});

test('a bucket that falls out of the chosen group is cleared', async () => {
  await categorySelect().selectOption({ label: 'All categories' });
  await bucketSelect().selectOption({ label: 'TESCO STORES' });
  await expect(bucketSelect().locator('option:checked')).toHaveText('TESCO STORES');
  await categorySelect().selectOption({ label: 'By kind: Income' });
  await expect(bucketSelect().locator('option:checked')).toHaveText('All buckets');
});

test('the choice survives leaving the screen', async () => {
  await categorySelect().selectOption({ label: 'Groceries' });
  await expect(categorySelect().locator('option:checked')).toHaveText('Groceries');
  await expect(rows().first()).toBeVisible();
  for (const select of await rows().getByRole('combobox', { name: /^Counts as for / }).all()) {
    await expect(select.locator('option:checked')).toHaveText(/Groceries/);
  }
  await openScreen(page, 'Buckets');
  await openScreen(page, 'Transactions');
  await expect(categorySelect().locator('option:checked')).toHaveText('Groceries');
  await categorySelect().selectOption({ label: 'All categories' });
});

test('an opened bucket and an opened view have no Category select', async () => {
  await openScreen(page, 'Buckets');
  await page.getByRole('button', { name: 'TESCO STORES', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'TESCO STORES', level: 3 })).toBeVisible();
  await expect(page.getByLabel('Search transactions')).toBeVisible();
  await expect(categorySelect()).toHaveCount(0);

  await openScreen(page, 'Typical month');
  await page.locator('#screen dl.summary').getByRole('button', { name: 'uncategorised', exact: true }).click();
  await expect(page.getByLabel('Search transactions')).toBeVisible();
  await expect(categorySelect()).toHaveCount(0);
});

test('a Counts as change that removes the row leaves focus on a neighbour row', async () => {
  await openScreen(page, 'Transactions');
  await categorySelect().selectOption({ label: 'Uncategorised' });
  await expect(rows().first()).toBeVisible();
  const selects = () => rows().getByRole('combobox', { name: /^Counts as for / });
  const before = await selects().count();
  expect(before).toBeGreaterThan(1);
  const second = await selects().nth(1).getAttribute('aria-label');
  await selects().first().focus();
  await selects().first().selectOption({ label: 'Gifts' });
  await expect(selects()).toHaveCount(before - 1);
  await expect(page.getByLabel(second ?? '', { exact: true })).toBeFocused();
  await categorySelect().selectOption({ label: 'All categories' });
});
