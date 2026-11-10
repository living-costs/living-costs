// The Category filter on Buckets, against the full fixture state reached through the real UI.
// One page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations, setupFixtureApp, openScreen } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

const categoryFilter = () => page.getByLabel('Category', { exact: true });
const rowSelect = (name) => page.getByLabel(`Category for ${name}`, { exact: true });
const nameButton = (name) => page.getByRole('button', { name, exact: true });
const search = () => page.getByLabel('Search buckets');

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

test('the Category select follows Show and has no Uncategorised option', async () => {
  await openScreen(page, 'Buckets');
  const labels = await page.locator('#screen [role="search"] label, #screen [role="search"] [role="group"] > span').allInnerTexts();
  const names = labels.map((l) => l.split('\n')[0].trim());
  expect(names.indexOf('Category')).toBe(names.indexOf('Show') + 1);
  const options = await categoryFilter().locator('option').allInnerTexts();
  expect(options[0]).toBe('All categories');
  expect(options).not.toContain('Uncategorised');
  expect(options).toContain('By kind: Spend');
  expect(options).toContain('Groceries');
  await expectNoAxeViolations(page);
});

test('By type: One-off shows only BIG BOILER CO', async () => {
  await categoryFilter().selectOption({ label: 'By type: One-off' });
  await expect(categoryFilter()).toBeFocused();
  await expect(nameButton('BIG BOILER CO')).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
});

test('a category combines with search', async () => {
  await categoryFilter().selectOption({ label: 'Groceries' });
  await search().fill('farm');
  await expect(nameButton('FARM SHOP')).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  await search().fill('');
});

test('a change that hides the row hands focus to a neighbour, and can be restored', async () => {
  await categoryFilter().selectOption({ label: 'Groceries' });
  await rowSelect('FARM SHOP').focus();
  await rowSelect('FARM SHOP').selectOption({ label: 'Eating out' });
  await expect(nameButton('FARM SHOP')).toHaveCount(0);
  await expect(page.locator('#screen select:focus')).toHaveAttribute('aria-label', /^Category for /);
  // Restore.
  await categoryFilter().selectOption({ label: 'Eating out' });
  await rowSelect('FARM SHOP').selectOption({ label: 'Groceries' });
  await expect(nameButton('FARM SHOP')).toHaveCount(0);
  await categoryFilter().selectOption({ label: 'Groceries' });
  await expect(nameButton('FARM SHOP')).toBeVisible();
});
