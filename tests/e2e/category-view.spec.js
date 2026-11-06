// Opening a category from Typical month, against the full fixture state reached through the real
// UI. One page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations, setupFixtureApp, openScreen, readStore } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

/** A row of a typical-month table by its category name. */
const row = (tableName, category) => page.getByRole('table', { name: tableName, exact: true }).getByRole('row')
  .filter({ has: page.getByRole('rowheader', { name: category, exact: true }) });

/** The opened category's heading. */
const viewHeading = (name) => page.getByRole('heading', { level: 3, name, exact: true });

/** Open a category from its Typical month row. */
async function open(tableName, category) {
  await row(tableName, category).getByRole('button', { name: category, exact: true }).click();
  await expect(viewHeading(category)).toBeFocused();
}

const back = () => page.getByRole('button', { name: 'Back to Typical month', exact: true });

/** "£2,500.00" or "-£3.00" as minor units. */
const minor = (text) => {
  const m = /^(-?)£([\d,]+)\.(\d\d)$/.exec(text.trim());
  if (!m) throw new Error(`not money: ${text}`);
  return (m[1] ? -1 : 1) * (Number(m[2].replaceAll(',', '')) * 100 + Number(m[3]));
};
/** @param {number} n minor units */
const pounds = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(n / 100);

const bucketTable = () => page.getByRole('table', { name: 'By bucket', exact: true });

/** The text of one column of the By bucket table, by its header. */
const bucketColumn = (header) => bucketTable().evaluate((table, name) => {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
  const i = heads.indexOf(name);
  return [...table.querySelectorAll('tbody tr')].map((tr) => tr.children[i]?.textContent ?? '');
}, header);

/** The By bucket row for one bucket. */
const bucketRow = (name) => bucketTable().getByRole('row')
  .filter({ has: page.getByRole('rowheader', { name, exact: true }) });

/** The transaction list's body rows. */
const listRows = () => page.getByRole('region', { name: 'Matching transactions' }).locator('tbody tr');

const explanationLine = () => page.locator('#category-explanation');

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

test('Salary opens from Typical month with the Fixed explanation', async () => {
  await openScreen(page, 'Typical month');
  await open('Income', 'Salary');
  await expect(page.getByText("Income · Fixed · £2,500.00 a month: each charge's latest amount, as often as it was charged in these 12 months.", { exact: true }))
    .toBeVisible();
  // One account: a single row of cells, with no label.
  await expect(page.locator('#screen .month-cells')).toHaveCount(1);
  await expect(page.locator('#screen .month-cells button')).toHaveCount(12);
  await expect(page.getByRole('heading', { level: 4, name: 'Each month' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 4, name: 'By bucket' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 4, name: 'Transactions' })).toBeVisible();
  // One account: no Account column.
  await expect(bucketTable().getByRole('columnheader', { name: 'Account' })).toHaveCount(0);
  await expect(listRows()).toHaveCount(12);
});

test('the bucket lines add up to the figure', async () => {
  const adds = await bucketColumn('Adds per month');
  expect(adds.length).toBeGreaterThan(0);
  expect(adds.reduce((s, t) => s + minor(t), 0)).toBe(250000);
  await expect(bucketRow('EXAMPLE EMPLOYER LTD SALARY')).toContainText('£2,500.00');
  await expect(bucketRow('EXAMPLE EMPLOYER LTD SALARY')).toContainText('25/10/2026');
  await expect(page.getByText('Mark a charge Stopped only if it has ended and nothing replaced it.', { exact: false })).toBeVisible();
  await back().click();
});

test('Groceries shows one row of month cells per account, with not covered months', async () => {
  await open('Living costs', 'Groceries');
  await expect(page.getByText(/^Spending · Variable · £737\.84 a month: each account's median month, added together\. Typical range £650\.14 to £898\.40\.$/))
    .toBeVisible();
  await expect(page.locator('#screen .month-cells')).toHaveCount(2);
  const bankB = page.getByRole('group', { name: /^Bank B joint: / });
  await expect(bankB.locator('.uncovered')).toHaveCount(9);
  await expect(bankB.locator('.uncovered').first()).toContainText('not covered');
  await expect(bankB.getByRole('button')).toHaveCount(3);
  const bankA = page.getByRole('group', { name: /^Bank A current: / });
  await expect(bankA.locator('.uncovered')).toHaveCount(0);
  await expect(bankA.getByRole('button')).toHaveCount(12);
  const labels = await page.locator('#screen .account-share').allTextContents();
  expect(labels).toHaveLength(2);
  expect(labels.reduce((s, t) => s + minor(t.slice(t.indexOf(': ') + 2)), 0)).toBe(73784);
  // Variable: no bucket table.
  await expect(bucketTable()).toHaveCount(0);
  // The large June shop makes June unusual, and says so.
  const june = bankA.getByRole('button', { name: /^Jun 2026/ });
  await expect(june).toHaveClass(/unusual/);
  await expect(june).toContainText(', unusual');
});

test('month filter combines with search', async () => {
  const search = page.getByLabel('Search transactions');
  await search.fill('TESCO');
  const march = page.getByRole('group', { name: /^Bank A current: / }).getByRole('button', { name: /^Mar 2026/ });
  await expect(march).toHaveAttribute('aria-pressed', 'false');
  await march.click();
  await expect(march).toHaveAttribute('aria-pressed', 'true');
  await expect(march).toBeFocused();
  await expect(search).toHaveValue('TESCO');
  const n = await listRows().count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(6);
  for (const r of await listRows().all()) {
    await expect(r.locator('td').first()).toHaveText(/^\d\d\/03\/2026$/);
    await expect(r.locator('td .raw')).toContainText('TESCO');
  }
  await march.click();
  await expect(march).toHaveAttribute('aria-pressed', 'false');
  expect(await listRows().count()).toBeGreaterThan(n);
  await search.fill('');
});

test('splitting a transaction out updates the month cell, and the split row says which part counts', async () => {
  const june = page.getByRole('group', { name: /^Bank A current: / }).getByRole('button', { name: /^Jun 2026/ });
  const juneTotal = async () => minor((await june.textContent() ?? '').replace('Jun 2026', '').replace(', unusual', ''));
  const before = await juneTotal();
  const search = page.getByLabel('Search transactions');
  await search.fill('650.00');
  await expect(listRows()).toHaveCount(1);
  const select = page.getByLabel('Counts as for CARD PURCHASE TESCO STORES 2041 on 13/06/2026');
  await select.selectOption({ label: 'Split…' });
  const dialog = page.getByRole('dialog', { name: 'Split transaction' });
  const part = (n) => dialog.getByRole('group', { name: `Part ${n}` });
  await part(1).getByLabel('Amount').fill('600.00');
  await part(1).getByLabel('Category').selectOption({ label: 'Gifts' });
  await part(2).getByLabel('Amount').fill('50.00');
  await part(2).getByLabel('Category').selectOption({ label: 'Groceries' });
  await dialog.getByRole('button', { name: 'Save split' }).click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(juneTotal).toBe(before - 60000);
  const note = listRows().first().getByText('-£50.00 of this counts as Groceries', { exact: true });
  await expect(note).toBeVisible();
  // The note has its own line under the Counts as control.
  const control = await listRows().first().locator('.counts-as').boundingBox();
  const noteBox = await note.boundingBox();
  expect(noteBox?.y ?? 0).toBeGreaterThanOrEqual((control?.y ?? 0) + (control?.height ?? 0) - 1);

  await select.selectOption({ label: "Use bucket's category (Groceries)" });
  await expect.poll(juneTotal).toBe(before);
  await expect(note).toHaveCount(0);
  await search.fill('');
  await back().click();
});

test('a bucket name filters the list and toggles off', async () => {
  await open('Living costs', 'Subscriptions');
  // Two accounts: the Account column is shown.
  await expect(bucketTable().getByRole('columnheader', { name: 'Account' })).toBeVisible();
  const all = await listRows().count();
  const spotify = bucketRow('SPOTIFY').getByRole('button', { name: 'SPOTIFY', exact: true });
  await expect(spotify).toHaveAttribute('aria-pressed', 'false');
  await spotify.click();
  await expect(spotify).toHaveAttribute('aria-pressed', 'true');
  await expect(spotify).toBeFocused();
  await expect(listRows()).toHaveCount(12);
  for (const text of await page.locator('#screen td .raw').allTextContents()) expect(text).toContain('SPOTIFY');
  await spotify.click();
  await expect(spotify).toHaveAttribute('aria-pressed', 'false');
  await expect(listRows()).toHaveCount(all);
});

test('Stopped lowers the figure here and on Typical month, and unticking restores it', async () => {
  await expect(explanationLine())
    .toHaveText("Spending · Fixed · £89.97 a month: each charge's latest amount, as often as it was charged in its account's months.");
  const adds = minor(await bucketRow('SPOTIFY').locator('td').nth(4).textContent() ?? '');
  expect(adds).toBe(1199);
  const lowered = pounds(8997 - adds);

  const stopped = page.getByRole('checkbox', { name: 'Stopped: SPOTIFY', exact: true });
  await stopped.check();
  await expect.poll(async () => (await readStore(page, 'buckets')).find((b) => b.displayName === 'SPOTIFY')?.stoppedAfter)
    .toBe('2026-10-02');
  await expect(explanationLine()).toContainText(`Spending · Fixed · ${lowered} a month`);
  await expect(bucketRow('SPOTIFY')).toHaveClass(/stopped/);
  await expect(bucketRow('SPOTIFY').locator('td').nth(4)).toHaveText('£0.00');
  await expect(stopped).toBeChecked();
  await expect(stopped).toBeFocused();
  // A muted Stopped row still has enough contrast.
  await expectNoAxeViolations(page);

  await back().click();
  await expect(row('Living costs', 'Subscriptions').getByRole('cell').nth(1)).toHaveText(lowered);

  await open('Living costs', 'Subscriptions');
  await stopped.uncheck();
  await expect.poll(async () => (await readStore(page, 'buckets')).find((b) => b.displayName === 'SPOTIFY')?.stoppedAfter)
    .toBeUndefined();
  await expect(explanationLine()).toContainText('Spending · Fixed · £89.97 a month');
  await expect(bucketRow('SPOTIFY')).not.toHaveClass(/stopped/);
  await back().click();
  await expect(row('Living costs', 'Subscriptions').getByRole('cell').nth(1)).toHaveText('£89.97');
});

test('Back returns focus to the category button', async () => {
  await open('Income', 'Salary');
  await back().click();
  await expect(row('Income', 'Salary').getByRole('button', { name: 'Salary', exact: true })).toBeFocused();
});

test('leaving through the nav closes the category', async () => {
  await open('Income', 'Salary');
  await openScreen(page, 'Buckets');
  await openScreen(page, 'Typical month');
  await expect(viewHeading('Salary')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Living costs', exact: true })).toBeVisible();
  // The Typical month nav button itself also closes it.
  await open('Income', 'Salary');
  await openScreen(page, 'Typical month');
  await expect(viewHeading('Salary')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Income', exact: true })).toBeVisible();
});

/**
 * Visible controls shorter than 32px, described for the failure message (as in a11y.spec.js).
 * @param {Page} p
 */
const shortTargets = (p) => p.evaluate(() => {
  const controls = document.querySelectorAll('#screen button, #screen select, #screen input:not([type=checkbox]):not([type=radio])');
  return [...controls].filter((el) => el.checkVisibility())
    .map((el) => ({ el, height: el.getBoundingClientRect().height }))
    .filter(({ height }) => height < 32)
    .map(({ el, height }) => `${el.tagName.toLowerCase()} "${el.textContent?.trim() || el.getAttribute('aria-label') || el.id}" is ${height}px`);
});

/** Tab from the heading to the first button, and report its focus ring. */
async function focusRingOfFirstButton() {
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.tagName === 'BUTTON')) break;
  }
  return page.evaluate(() => {
    const el = /** @type {HTMLElement} */ (document.activeElement);
    const style = getComputedStyle(el);
    return { inScreen: !!document.getElementById('screen')?.contains(el), width: style.outlineWidth,
      style: style.outlineStyle, focusVisible: el.matches(':focus-visible') };
  });
}

test('category view passes axe, has large targets and focus rings, and fits 320px', async () => {
  for (const [tableName, name] of [['Living costs', 'Groceries'], ['Living costs', 'Subscriptions'], ['Income', 'Salary']]) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(tableName, name);
    await expectNoAxeViolations(page);
    expect(await shortTargets(page)).toEqual([]);
    expect(await focusRingOfFirstButton()).toEqual({ inScreen: true, width: '3px', style: 'solid', focusVisible: true });
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(viewHeading(name)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await expectNoAxeViolations(page);
    await back().click();
  }
  await page.setViewportSize({ width: 1280, height: 720 });
});
