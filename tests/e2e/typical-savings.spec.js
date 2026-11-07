// Typical month: a savings account marked Savings gets a Savings table and a Savings summary line.
// Against the full fixture state; one page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import { trackCspViolations, setupFixtureApp, openScreen, expectNoAxeViolations, readStore, writeStore } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

/** Minor units in a money text such as "£1,234.56". */
const minor = (/** @type {string} */ s) => Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100);
const table = (/** @type {string} */ name) => page.getByRole('table', { name, exact: true });
const tick = (/** @type {string} */ category) => page.getByRole('checkbox', { name: `Tick ${category}`, exact: true });
const summaryLines = () => page.locator('dl.summary').evaluate((dl) => [...dl.querySelectorAll('dt')]
  .map((dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}`));
/** @param {string} label */
const line = async (label) => (await summaryLines()).find((l) => l.startsWith(`${label}: `))?.slice(label.length + 2) ?? '';
const savingsRow = () => table('Savings').getByRole('row').filter({ has: tick('Bank A savings') });

let leftOverBefore = '';

test.beforeAll(async ({ browser, baseURL }) => {
  context = await browser.newContext({ baseURL });
  page = await context.newPage();
  await trackCspViolations(page);
  await setupFixtureApp(page);
  leftOverBefore = await line('Left over');
  const accounts = await readStore(page, 'accounts');
  await writeStore(page, 'accounts', accounts.map((a) => (a.name === 'Bank A savings' ? { ...a, kind: 'savings' } : a)));
  await page.reload();
  await openScreen(page, 'Typical month');
});

test.afterAll(async () => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  await context.close();
});

test('a Savings table follows Contributions, with the account as plain text', async () => {
  await expect(table('Savings')).toBeVisible();
  const names = await page.locator('section > h3').allTextContents();
  expect(names.indexOf('Savings')).toBe(names.indexOf('Contributions') + 1);
  await expect(savingsRow().getByRole('rowheader', { name: 'Bank A savings', exact: true })).toBeVisible();
  await expect(savingsRow().getByRole('button')).toHaveCount(0);
  const perMonth = await savingsRow().getByRole('cell').nth(2).textContent();
  expect(minor(perMonth ?? '')).not.toBe(0);
});

test('the summary has a Savings line after Left over, and Left over is unchanged', async () => {
  const lines = await summaryLines();
  expect(lines.at(-1)).toBe('Ticked: —none');
  expect(lines.at(-2)?.startsWith('Savings: ')).toBe(true);
  expect(lines.at(-3)).toBe(`Left over: ${leftOverBefore}`);
  const perMonth = await savingsRow().getByRole('cell').nth(2).textContent();
  expect(await line('Savings')).toBe(perMonth);
});

test('ticking the savings row adds it to Ticked', async () => {
  const perMonth = await savingsRow().getByRole('cell').nth(2).textContent();
  await tick('Bank A savings').check();
  expect(await line('Ticked (1 category)')).toBe(perMonth);
});

test('comparing a month adds a Savings line with the month and Change', async () => {
  await page.getByLabel('Compare with').selectOption('2026-10');
  const row = page.getByRole('table', { name: 'Summary per month' }).getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Savings', exact: true }) });
  const cells = await row.getByRole('cell').allTextContents();
  expect(cells).toHaveLength(3);
  expect(cells[0]).toMatch(/£/);
  expect(cells[1]).toMatch(/£/);
  expect(cells[2]).toMatch(/same|less|more/);
});

test('axe passes and there are no CSP violations', async () => {
  await expectNoAxeViolations(page);
});

test('the Kind select on Accounts sets an account to Savings', async () => {
  const accounts = await readStore(page, 'accounts');
  await writeStore(page, 'accounts', accounts.map((a) => (a.name === 'Bank A savings' ? { ...a, kind: 'bank' } : a)));
  await page.reload();
  await openScreen(page, 'Accounts');
  const kind = page.getByLabel('Kind for Bank A savings', { exact: true });
  await expect(kind.locator('option')).toHaveText(['Bank', 'Card', 'Savings']);
  await kind.selectOption({ label: 'Savings' });
  await expect.poll(async () => (await readStore(page, 'accounts')).find((a) => a.name === 'Bank A savings')?.kind).toBe('savings');
  await expect(page.getByText('Savings · GBP')).toBeVisible();
  await expectNoAxeViolations(page);
  await openScreen(page, 'Typical month');
  await expect(table('Savings')).toBeVisible();
});
