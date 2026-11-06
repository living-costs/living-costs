// Typical month: choosing the window and comparing a month, against the full fixture state.
// One page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { trackCspViolations, setupFixtureApp, openScreen, expectNoAxeViolations, fixturePath, FIXTURE_ACCOUNTS } from './helpers.js';

const expected = JSON.parse(fs.readFileSync(fixturePath('expected.json'), 'utf8'));
const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
/** @param {number} minor */
const gbp = (minor) => fmt.format(minor / 100);

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

/** A table by its name (its section heading). */
const table = (name) => page.getByRole('table', { name, exact: true });

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

test('default: the window pickers show the latest 12 months, with no reset button', async () => {
  await expect(page.getByLabel('Typical from')).toHaveValue('2025-11');
  await expect(page.getByLabel('to', { exact: true })).toHaveValue('2026-10');
  await expect(page.getByRole('button', { name: 'Latest 12 months' })).toHaveCount(0);
  await expect(page.getByLabel('Typical from').locator('option').first()).toHaveText('Oct 2026'); // newest first
});

test('a chosen window recalculates and keeps focus', async () => {
  await page.getByLabel('to', { exact: true }).focus(); // selectOption alone does not focus the select
  await page.getByLabel('to', { exact: true }).selectOption('2026-06');
  await expect(page.locator('#typical-window')).toHaveText('Based on 8 complete months, Nov 2025 to Jun 2026');
  await expect(page.getByLabel('to', { exact: true })).toBeFocused();
  await expect(page.getByText('complete months so far')).toHaveCount(0);
  await expect(table('Contributions')).toHaveCount(0); // Bank B starts in Aug
  await expect(page.getByLabel('Typical from').locator('option[value="2026-07"]')).toHaveCount(0);
});

test('the window is kept through a category view and the nav', async () => {
  await table('Living costs').getByRole('button', { name: 'Groceries', exact: true }).click();
  const bankA = page.getByRole('group', { name: 'Each month' }); // Bank B is outside the window
  await expect(bankA.getByRole('button', { name: /^Jun 2026/ })).toHaveCount(1);
  await expect(bankA.getByRole('button', { name: /^Jul 2026/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Typical month', exact: true }).click();
  await expect(page.locator('#typical-window')).toHaveText('Based on 8 complete months, Nov 2025 to Jun 2026');
  await openScreen(page, 'Categorise');
  await openScreen(page, 'Typical month');
  await expect(page.locator('#typical-window')).toHaveText('Based on 8 complete months, Nov 2025 to Jun 2026');
});

test('Latest 12 months puts the default back', async () => {
  await page.getByRole('button', { name: 'Latest 12 months' }).click();
  await expect(page.locator('#typical-window')).toHaveText('Based on 12 complete months, Nov 2025 to Oct 2026');
  await expect(page.getByLabel('Typical from')).toBeFocused();
});

/**
 * The cells of a table row, by the row's name.
 * @param {string} name @param {string} category
 */
const rowCells = (name, category) => table(name).getByRole('row')
  .filter({ has: page.getByRole('rowheader', { name: category, exact: true }) }).getByRole('cell');

/** Minor units in a money or Change text: "£1.50", "-£1.50", "£1.50 less", "same". */
const parseMinor = (/** @type {string} */ text) => {
  if (text === 'same') return 0;
  const minor = Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100);
  return /less$|^-/.test(text) ? -minor : minor;
};

test('comparing Oct 2026 against Nov 2025 to Jun 2026', async () => {
  await page.getByLabel('to', { exact: true }).selectOption('2026-06');
  await page.getByLabel('Compare with').focus();
  await page.getByLabel('Compare with').selectOption('2026-10');
  await expect(page.getByLabel('Compare with')).toBeFocused();
  await expect(table('Living costs').getByRole('columnheader'))
    .toHaveText(['Tick', 'Category', 'Type', 'Typical', 'Oct 2026', 'Change', 'Share of largest']);
  await expect(rowCells('Living costs', 'Housing (rent or mortgage)')).toHaveText([
    '', 'Fixed', gbp(90000), gbp(90000), 'same', '']);
  await expect(rowCells('Living costs', 'Groceries').nth(3))
    .toHaveText(gbp(-expected.monthlyTotals.Groceries['2026-10']));
  const gifts = rowCells('Living costs', 'Gifts');
  await expect(gifts.nth(3)).toHaveText(/** @type {string} */ (await gifts.nth(2).textContent()));
  await expect(gifts.nth(4)).toHaveText('same');
  await expect(rowCells('Contributions', 'Contributions from others'))
    .toHaveText(['', 'Fixed', gbp(0), gbp(55000), `${gbp(55000)} more`, '']);
  await expect(table('Contributions').getByRole('rowheader', { name: 'Contributions from others' }).getByRole('button')).toHaveCount(0);
  await expect(page.getByText("Annual categories use the typical figure in the month too, so a yearly bill doesn't skew it.")).toBeVisible();
});

test('the month and Change columns reconcile with the summary', async () => {
  const summary = page.getByRole('table', { name: 'Summary per month' });
  await expect(summary.getByRole('columnheader')).toHaveText(['Typical','Oct 2026', 'Change']);
  /** Sum of one column of a table's body rows, in minor units. td index: 0 tick, 1 Type, 2 Typical, 3 month, 4 Change. */
  const columnSum = async (/** @type {string} */ name, /** @type {number} */ col) => {
    const texts = await table(name).locator('tbody tr').evaluateAll(
      (rows, c) => rows.map((r) => r.querySelectorAll('td')[c].textContent ?? ''), col);
    return texts.reduce((n, t) => n + parseMinor(t), 0);
  };
  const summaryCells = (/** @type {string} */ line) => summary.getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: line, exact: true }) }).getByRole('cell');
  for (const [name, line] of [['Living costs', 'Living costs'], ['Income', 'Income'], ['Contributions', 'less contributions from others']]) {
    expect(await columnSum(name, 3)).toBe(parseMinor(/** @type {string} */ (await summaryCells(line).nth(1).textContent())));
    expect(await columnSum(name, 4)).toBe(parseMinor(/** @type {string} */ (await summaryCells(line).nth(2).textContent())));
  }
});

test('a month an account does not cover shows a banner', async () => {
  await page.getByRole('button', { name: 'Latest 12 months' }).click();
  await page.getByLabel('Compare with').selectOption('2026-06');
  await expect(page.locator('.banner', { hasText: 'Jun 2026 has no complete statement for' })).toHaveText(
    `Jun 2026 has no complete statement for ${FIXTURE_ACCOUNTS.bankB.new.name}. Its spending that month isn't included.`);
  await expect(rowCells('Contributions', 'Contributions from others'))
    .toHaveText(['', 'Fixed', gbp(55000), gbp(0), `${gbp(55000)} less`, '']);
});

test('comparison fits 320px and passes axe', async () => {
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expectNoAxeViolations(page);
  // No cell breaks onto a second line: each is shorter than two lines of its own text.
  const tall = await page.locator('table.summary-compare').locator('th, td').evaluateAll(
    (cells) => cells.filter((c) => c.getBoundingClientRect().height > 2 * parseFloat(getComputedStyle(c).fontSize) * 1.2)
      .map((c) => c.textContent));
  expect(tall).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('the choices survive the nav and reset on reload', async () => {
  await openScreen(page, 'Categorise');
  await openScreen(page, 'Typical month');
  await expect(page.getByLabel('Compare with')).toHaveValue('2026-06');
  await page.reload();
  await expect(page.getByLabel('Compare with')).toHaveValue('');
  await expect(page.getByLabel('Typical from')).toHaveValue('2025-11');
  await expect(page.getByLabel('to', { exact: true })).toHaveValue('2026-10');
  await expect(table('Living costs').getByRole('columnheader', { name: 'Per year' })).toHaveCount(1);
});

test('No month puts the tables back', async () => {
  await page.getByLabel('Compare with').selectOption('2026-10');
  await expect(page.locator('dl.summary')).toHaveCount(0);
  await page.getByLabel('Compare with').selectOption('');
  await expect(table('Living costs').getByRole('columnheader'))
    .toHaveText(['Tick', 'Category', 'Type', 'Per month', 'Per year', 'Share of largest']);
  await expect(page.locator('dl.summary')).toHaveCount(1);
  await expect(page.getByText('Annual categories use the typical figure')).toHaveCount(0);
});
