// Opening a category from the Categories screen, against the full fixture state reached through
// the real UI. One page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import {
  expectNoAxeViolations, trackCspViolations, setupFixtureApp, openScreen, expectBesideHeading,
} from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

const table = () => page.getByRole('table', { name: 'Your categories', exact: true });
/** The button on a category's name in the Categories table. */
const nameButton = (name) => table().getByRole('button', { name, exact: true });
/** The opened category's heading. */
const viewHeading = (name) => page.getByRole('heading', { level: 3, name, exact: true });
const back = () => page.getByRole('button', { name: 'Back to Categories', exact: true });
const summary = () => page.locator('#explore-summary');
const bucketTable = () => page.getByRole('table', { name: 'By bucket', exact: true });
/** The By bucket row for one bucket. */
const bucketRow = (name) => bucketTable().getByRole('row')
  .filter({ has: page.getByRole('button', { name, exact: true }) });
/** The transaction list's body rows. */
const listRows = () => page.getByRole('region', { name: 'Matching transactions' }).locator('tbody tr');
const monthButton = (label) => page.locator('#screen .month-cells').getByRole('button', { name: new RegExp(`^${label}`) });

/** Open a category from its name on the Categories table. */
async function open(name) {
  await nameButton(name).click();
  await expect(viewHeading(name)).toBeFocused();
}

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

test('a category with nothing in it is plain text; one with something is a button', async () => {
  await openScreen(page, 'Categories');
  await expect(table().getByRole('rowheader', { name: 'Ignore', exact: true })).toBeVisible();
  await expect(nameButton('Ignore')).toHaveCount(0);
  await expect(nameButton('Big one-offs')).toBeVisible();
  await expect(page.getByText('Open a category to see what is in it.', { exact: false })).toBeVisible();
});

test('Big one-offs opens with its summary, 12 months and its bucket', async () => {
  await open('Big one-offs');
  await expectBesideHeading(viewHeading('Big one-offs'), back());
  await expect(summary()).toHaveText('Spend · One-off · 1 transaction in 1 bucket, £2,400.00 out, Jan 2026.');
  // The table, guide and New category form are hidden while a category is open.
  await expect(table()).toHaveCount(0);
  await expect(page.locator('#screen h2')).toHaveText('Categories');
  await expect(page.locator('#screen .month-cells')).toHaveCount(1);
  await expect(page.locator('#screen .month-cells button')).toHaveCount(12);
  await expect(bucketRow('BIG BOILER CO')).toContainText('-£2,400.00');
  await expect(bucketRow('BIG BOILER CO')).toContainText('20/01/2026');
  await expect(listRows()).toHaveCount(1);
  await expectNoAxeViolations(page);
});

test('pressing a month, then the bucket, narrows the list', async () => {
  const dec = monthButton('Dec 2025');
  await expect(dec).toContainText('£0.00');
  await dec.click();
  await expect(dec).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('No transactions match.')).toBeVisible();
  const jan = monthButton('Jan 2026');
  await jan.click();
  await expect(jan).toHaveAttribute('aria-pressed', 'true');
  await expect(listRows()).toHaveCount(1);
  await jan.click();
  await expect(jan).toHaveAttribute('aria-pressed', 'false');
  const bucket = bucketTable().getByRole('button', { name: 'BIG BOILER CO', exact: true });
  await bucket.click();
  await expect(bucket).toHaveAttribute('aria-pressed', 'true');
  await expect(listRows()).toHaveCount(1);
});

test('Back returns focus to the name; reopening shows no filters', async () => {
  await monthButton('Jan 2026').click();
  await back().click();
  await expect(nameButton('Big one-offs')).toBeFocused();
  await open('Big one-offs');
  await expect(page.locator('#screen .month-cells button[aria-pressed="true"]')).toHaveCount(0);
  await expect(bucketTable().getByRole('button', { name: 'BIG BOILER CO', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(listRows()).toHaveCount(1);
  await back().click();
});

test('browser back closes the view, as Back does', async () => {
  const url = page.url();
  await open('Big one-offs');
  await monthButton('Jan 2026').click();
  await page.goBack();
  await expect(viewHeading('Big one-offs')).toHaveCount(0);
  await expect(nameButton('Big one-offs')).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => history.state?.livingCostsSubview === true)).toBe(false);
  await open('Big one-offs');
  await expect(page.locator('#screen .month-cells button[aria-pressed="true"]')).toHaveCount(0);
  await back().click();
});

test('leaving through the nav closes the view', async () => {
  await open('Big one-offs');
  await openScreen(page, 'Buckets');
  await openScreen(page, 'Categories');
  await expect(viewHeading('Big one-offs')).toHaveCount(0);
  await expect(table()).toBeVisible();
});

test('moving the last transaction out empties the view, and it shows in Ignore as moved here', async () => {
  await open('Big one-offs');
  const select = page.getByLabel(/^Counts as for .*BIG BOILER CO.* on 20\/01\/2026$/);
  // selectOption does not move focus, so focus the select as a keyboard user would have.
  await select.focus();
  await select.selectOption({ label: 'Ignore' });
  const empty = page.getByText('Nothing counts as Big one-offs now.', { exact: true });
  await expect(empty).toBeVisible();
  await expect(empty).toBeFocused();
  await back().click();
  await expect(nameButton('Big one-offs')).toHaveCount(0);
  await expect(page.locator('#screen h2')).toBeFocused();
  await open('Ignore');
  await expect(summary()).toHaveText('Ignore · 1 transaction in 1 bucket, £2,400.00 out, Jan 2026.');
  await expect(bucketRow('BIG BOILER CO')).toContainText('(1 moved here)');
  await back().click();
});

test('Groceries over two accounts: labelled rows, not covered months, and 320px with no sideways scroll', async () => {
  await open('Groceries');
  await expect(page.locator('#screen .month-cells')).toHaveCount(2);
  const bankB = page.getByRole('group', { name: /^Bank B joint: / });
  await expect(bankB.locator('.uncovered')).toHaveCount(9);
  await expect(bankB.locator('.uncovered').first()).toContainText('not covered');
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expectNoAxeViolations(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await back().click();
});
