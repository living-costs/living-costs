// Typical month: tick boxes beside the categories, the Ticked line in the summary, and columns
// that line up across Living costs, Income and Contributions. Against the full fixture state.
// One page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import { trackCspViolations, setupFixtureApp, openScreen, expectNoAxeViolations } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
/** @param {number} minor */
const gbp = (minor) => fmt.format(minor / 100);
/** Minor units in a money text such as "£1,234.56". */
const minor = (/** @type {string} */ s) => Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100);

/** A table by its name (its section heading). */
const table = (name) => page.getByRole('table', { name, exact: true });

/** One category's tick box. */
const tick = (category) => page.getByRole('checkbox', { name: `Tick ${category}`, exact: true });

/** The summary list's labels and values, in order, as "label: value". */
const summaryLines = () => page.locator('dl.summary').evaluate((dl) => [...dl.querySelectorAll('dt')]
  .map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`));

/** The left edge of each column header, one array per table shown. */
const columnLefts = () => page.locator('table.typical').evaluateAll((tables) => tables.map((t) =>
  [.../** @type {HTMLTableElement} */ (t).tHead?.rows[0].cells ?? []].map((c) => Math.round(c.getBoundingClientRect().left))));

test.beforeAll(async ({ browser, baseURL }) => {
  context = await browser.newContext({ baseURL });
  page = await context.newPage();
  await trackCspViolations(page);
  await setupFixtureApp(page);
});

test.afterAll(async () => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  await context.close();
});

test('nothing ticked: no Ticked line', async () => {
  await expect(tick('Groceries')).not.toBeChecked();
  expect((await summaryLines()).at(-1)).toBe('Left over: £720.44');
});

test('ticking adds a Ticked line under Left over and keeps focus', async () => {
  await tick('Groceries').focus();
  await page.keyboard.press('Space');
  await expect(tick('Groceries')).toBeChecked();
  await expect(tick('Groceries')).toBeFocused();
  expect((await summaryLines()).slice(-2)).toEqual(['Left over: £720.44', 'Ticked (1 category): £737.84']);
  await tick('Housing (rent or mortgage)').check();
  expect((await summaryLines()).at(-1)).toBe('Ticked (2 categories): £1,637.84'); // £900.00 + £737.84
});

test('ticks in other tables add to the same line', async () => {
  await tick('Salary').check();
  expect((await summaryLines()).at(-1)).toBe('Ticked (3 categories): £4,137.84'); // + £2,500.00
  await tick('Salary').uncheck();
  expect((await summaryLines()).at(-1)).toBe('Ticked (2 categories): £1,637.84');
});

test('each tick box sits before its category, centred in the row', async () => {
  const r = table('Living costs').getByRole('row').filter({ has: tick('Groceries') });
  const [box, row, name] = await Promise.all([tick('Groceries').boundingBox(), r.boundingBox(),
    r.getByRole('button', { name: 'Groceries', exact: true }).boundingBox()]);
  if (!box || !row || !name) throw new Error('not shown');
  expect(box.x + box.width).toBeLessThan(name.x);
  expect(Math.abs((box.y + box.height / 2) - (row.y + row.height / 2))).toBeLessThanOrEqual(1);
});

test('columns line up across the three tables', async () => {
  const lefts = await columnLefts();
  expect(lefts).toHaveLength(3);
  expect(lefts[0]).toHaveLength(6);
  expect(lefts[1]).toEqual(lefts[0]);
  expect(lefts[2]).toEqual(lefts[0]);
});

test('ticks survive opening a category', async () => {
  await table('Living costs').getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Typical month', exact: true }).click();
  await expect(tick('Groceries')).toBeChecked();
  expect((await summaryLines()).at(-1)).toBe('Ticked (2 categories): £1,637.84');
});

test('comparing a month: the Ticked row has the month and Change too, and columns line up', async () => {
  await tick('Contributions from others').check();
  await page.getByLabel('to', { exact: true }).selectOption('2026-06');
  // Bank B starts in Aug, so Contributions has gone from the window and isn't counted.
  await expect(table('Contributions')).toHaveCount(0);
  // Cells: tick, Type, Per month, Per year, bar. Groceries' typical figure differs in this window.
  const windowGroceries = await table('Living costs').getByRole('row').filter({ has: tick('Groceries') }).getByRole('cell').nth(2).textContent();
  expect((await summaryLines()).at(-1)).toBe(`Ticked (2 categories): ${gbp(90000 + minor(/** @type {string} */ (windowGroceries)))}`);
  await page.getByLabel('Compare with').selectOption('2026-10');
  // Contributions comes back as a month-only row (typical £0.00, Oct £550.00), still ticked.
  await expect(tick('Contributions from others')).toBeChecked();
  const summary = page.getByRole('table', { name: 'Summary per month' });
  const ticked = summary.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Ticked (3 categories)', exact: true }) });
  // Housing £900.00 and Contributions £0.00 typical, and £900.00 and £550.00 in Oct, plus Groceries.
  const [typical, month, change] = await ticked.getByRole('cell').allTextContents();
  const groceries = await table('Living costs').getByRole('row').filter({ has: tick('Groceries') }).getByRole('cell').allTextContents();
  // Cells: tick, Type, Typical, Oct 2026, Change, bar.
  expect(minor(typical)).toBe(90000 + minor(groceries[2]));
  expect(minor(month)).toBe(90000 + 55000 + minor(groceries[3]));
  const diff = 55000 + minor(groceries[3]) - minor(groceries[2]);
  expect(change).toBe(diff === 0 ? 'same' : `${gbp(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'}`);
  await expect(summary.getByRole('rowheader').last()).toHaveText('Ticked (3 categories)');
  const lefts = await columnLefts();
  expect(lefts).toHaveLength(3);
  expect(lefts[0]).toHaveLength(7);
  expect(lefts[1]).toEqual(lefts[0]);
  expect(lefts[2]).toEqual(lefts[0]);
});

test('axe passes with ticks, and 320px has no horizontal scroll', async () => {
  await expectNoAxeViolations(page);
  await page.getByLabel('Compare with').selectOption('');
  await page.getByRole('button', { name: 'Latest 12 months' }).click();
  await expectNoAxeViolations(page);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('ticks clear when the screen is opened from the nav', async () => {
  await expect(tick('Groceries')).toBeChecked();
  await openScreen(page, 'Categorise');
  await openScreen(page, 'Typical month');
  await expect(tick('Groceries')).not.toBeChecked();
  expect((await summaryLines()).at(-1)).toBe('Left over: £720.44');
});
