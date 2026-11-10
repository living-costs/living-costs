// The Typical month screen against the full fixture state, reached through the real UI.
// One page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations, setupFixtureApp, openScreen } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

/** @param {Page} p */
const screenHeading = (p) => p.locator('#screen h2');

/** A table by its name (its section heading). */
const table = (name) => page.getByRole('table', { name, exact: true });

/** A row of a typical-month table by its category name. */
const row = (tableName, category) => table(tableName).getByRole('row')
  .filter({ has: page.getByRole('rowheader', { name: category, exact: true }) });

/** Type, Per month and Per year cells of one row (the category is the row header, after the tick box). */
async function cells(tableName, category) {
  const r = row(tableName, category);
  await expect(r).toHaveCount(1);
  const [, type, perMonth, perYear] = await r.getByRole('cell').allTextContents();
  return { type, perMonth, perYear };
}

/** The value beside one label in the summary list. */
const summary = (label) => page.locator('dl.summary dt').filter({ hasText: new RegExp(`^${label}$`) })
  .locator('xpath=following-sibling::dd[1]');

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

test('heading and window', async () => {
  await expect(screenHeading(page)).toHaveText('Typical month');
  await expect(page.locator('#typical-window')).toHaveText('Based on 12 complete months, Nov 2025 to Oct 2026');
  await expect(page.getByText('complete months so far')).toHaveCount(0);
  await expect(page.getByText('has no statements after')).toHaveCount(0);
});

test('rows show the reconciled figures', async () => {
  expect(await cells('Income', 'Salary')).toEqual({ type: 'Fixed', perMonth: '£2,500.00', perYear: '£30,000.00' });
  expect((await cells('Regular spending', 'Subscriptions')).perMonth).toBe('£89.97');
  expect((await cells('Contributions', 'Contributions from others')).perMonth).toBe('£550.00');
  expect(await cells('Regular spending', 'Housing (rent or mortgage)')).toMatchObject({ type: 'Fixed', perMonth: '£900.00' });
  expect(await cells('Regular spending', 'Gifts')).toEqual({ type: 'Annual (£480.00 a year)', perMonth: '£40.00', perYear: '£480.00' });
  expect(await cells('Regular spending', 'Other Card (not itemised)'))
    .toMatchObject({ type: 'Variable (£130.00–£160.00)', perMonth: '£147.50' });
  expect(await cells('Regular spending', 'Groceries')).toMatchObject({ type: 'Variable (£650.14–£898.40)', perMonth: '£737.84' });
  expect((await cells('Income', 'Other income')).perMonth).toBe('£104.14');
  // Largest first.
  await expect(table('Regular spending').getByRole('rowheader').first()).toHaveText('Housing (rent or mortgage)');
});

test('summary with contributions', async () => {
  await expect(summary('Income')).toHaveText('£2,604.14');
  await expect(summary('Regular spending')).toHaveText('£2,433.70');
  await expect(summary('less contributions from others')).toHaveText('£550.00');
  await expect(summary('your share')).toHaveText('£1,883.70');
  await expect(summary('Remaining')).toHaveText('£720.44');
});

test('Remaining is broken down into its parts, a dash for a part with no transactions', async () => {
  const lines = await page.locator('dl.summary').evaluate((dl) => [...dl.querySelectorAll('dt')]
    .map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`));
  // One-offs: £2,400.00 over 12 months. Uncategorised: £32.99 of spending, as each account's
  // per month. Not accounted for: £720.44 − £200.00 − £2.75.
  expect(lines.slice(lines.indexOf('Remaining: £720.44'))).toEqual([
    'Remaining: £720.44', 'saved: —none', 'one-offs: £200.00', 'uncategorised: £2.75', 'ignored: —none',
    'not accounted for: £517.69', 'Ticked: —none',
  ]);
  // What "not accounted for" holds is help below the card, not a note in it.
  await expect(page.locator('.summary-panel + p.help')).toHaveText('not accounted for: typical month vs actual months, and money in accounts not tracked');
  // Remaining and Ticked are the size of Regular spending, not larger.
  const size = (/** @type {string} */ label) => page.locator('dl.summary dt').filter({ hasText: new RegExp(`^${label}$`) })
    .evaluate((dt) => getComputedStyle(dt).fontSize);
  expect(await size('Remaining')).toBe(await size('Regular spending'));
  expect(await size('Ticked')).toBe(await size('Regular spending'));
});

test('one-offs are listed apart from regular spending', async () => {
  await expect(row('Regular spending', 'Big one-offs')).toHaveCount(0);
  const oneOffs = page.getByRole('list', { name: 'One-offs' });
  await expect(oneOffs.getByRole('listitem')).toHaveCount(1);
  await expect(oneOffs).toContainText('Big one-offs');
  await expect(oneOffs).toContainText('£2,400.00');
});

test('bars are decorative and sized against the largest row', async () => {
  const bars = page.locator('#screen span.bar');
  expect(await bars.count()).toBeGreaterThan(0);
  for (const bar of await bars.all()) await expect(bar).toHaveAttribute('aria-hidden', 'true');
  const width = (category) => row('Regular spending', category).locator('span.bar').evaluate((el) => el.style.width);
  expect(await width('Housing (rent or mortgage)')).toBe('100%');
  // Groceries £737.84 of Housing £900.00 is 81.98%, rounded to 82%.
  expect(await width('Groceries')).toBe('82%');
  expect(await width('Eating out')).toBe('2%'); // £14.00 of £900.00 is 1.56%
});

test('uncategorised line leads to Categorise', async () => {
  const line = page.locator('#typical-uncategorised');
  await expect(line).toContainText('Uncategorised: £32.99 spending and £0.00 income over the window are not included.');
  await page.getByRole('button', { name: 'Categorise', exact: true }).and(page.locator('#screen button')).click();
  await expect(screenHeading(page)).toHaveText('Categorise');
  await openScreen(page, 'Typical month');
});

test('axe passes', async () => {
  await expectNoAxeViolations(page);
});

test('no horizontal scroll at 320px', async () => {
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(page.locator('#typical-window')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expectNoAxeViolations(page);
});

test('it is the home screen once there is data and Help is dismissed', async () => {
  await page.reload();
  await expect(screenHeading(page)).toHaveText('Typical month');
  await expect(page.locator('#typical-window')).toBeVisible();
});
