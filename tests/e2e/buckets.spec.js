import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations, importFiles, readStore } from './helpers.js';

const BANK_A = { new: { name: 'Bank A current', kind: 'bank' }, mapping: 'bankA' };
const CARD = { new: { name: 'Credit card', kind: 'card' }, mapping: 'card' };

/** @param {import('@playwright/test').Page} page */
const screenHeading = (page) => page.locator('#screen h2');
/** @param {import('@playwright/test').Page} page */
const search = (page) => page.getByLabel('Search buckets');
/** @param {import('@playwright/test').Page} page */
const onlyUncategorised = (page) => page.getByLabel('Only uncategorised');
/** The name button of a bucket in the list. */
const nameButton = (page, name) => page.getByRole('button', { name, exact: true });
/** The list row of a bucket, found by its name button. */
const row = (page, name) => page.getByRole('row').filter({ has: nameButton(page, name) });
/** A row's Total cell. */
const total = (page, name) => row(page, name).locator('td.total');
/** A row's Category select. */
const category = (page, name) => page.getByLabel(`Category for ${name}`, { exact: true });
/** @param {import('@playwright/test').Page} page */
const mergeDialog = (page) => page.getByRole('dialog', { name: 'Merge buckets' });

/**
 * "-£12.00" to -1200.
 * @param {string} text
 * @returns {number}
 */
const minor = (text) => {
  const digits = Number(text.replace(/[^\d]/g, ''));
  return text.trim().startsWith('-') ? -digits : digits;
};

/**
 * -1200 to "-£12.00".
 * @param {number} n
 * @returns {string}
 */
const pounds = (n) => `${n < 0 ? '-' : ''}£${(Math.abs(n) / 100).toFixed(2)}`;

async function openBuckets(page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Buckets' }).click();
  await expect(screenHeading(page)).toHaveText('Buckets');
}

test.beforeEach(async ({ page }) => {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(screenHeading(page)).toHaveText('Help');
  await importFiles(page, { files: ['bank-a-current.csv'], account: BANK_A });
  await importFiles(page, { files: ['card.csv'], account: CARD });
  await openBuckets(page);
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('filter and search', async ({ page }) => {
  // The window the totals cover, and that a drill-in shows everything.
  await expect(page.locator('#buckets-window')).toHaveText(
    /^Totals and counts cover [A-Z][a-z]{2} \d{4}( to [A-Z][a-z]{2} \d{4})?\. Opening a bucket shows all its transactions\.$/);
  const buckets = await readStore(page, 'buckets');
  // One header row plus one row per bucket.
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(buckets.length + 1);
  for (const name of ['Total', 'Name', 'Transactions']) {
    await expect(page.getByRole('columnheader').getByRole('button', { name, exact: true })).toBeVisible();
  }
  // Largest absolute total first by default.
  await expect(page.getByRole('columnheader', { name: 'Total' })).toHaveAttribute('aria-sort', 'descending');

  // Typing keeps focus and text.
  await search(page).pressSequentially('amazon');
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue('amazon');
  await expect(nameButton(page, 'AMAZON.CO.UK')).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);

  // Only uncategorised hides categorised buckets.
  await search(page).fill('');
  await category(page, 'MARKET STALL').selectOption({ label: 'Groceries' });
  await expect(category(page, 'MARKET STALL').locator('option:checked')).toHaveText('Groceries');
  await onlyUncategorised(page).check();
  await expect(nameButton(page, 'MARKET STALL')).toHaveCount(0);
  await expect(nameButton(page, 'FARM SHOP')).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(buckets.length);
  await expect(onlyUncategorised(page)).toBeChecked();
  await expectNoAxeViolations(page);

  // Categorising a row that the filter then hides moves focus to a neighbouring row's select.
  await category(page, 'FARM SHOP').focus();
  await category(page, 'FARM SHOP').selectOption({ label: 'Groceries' });
  await expect(nameButton(page, 'FARM SHOP')).toHaveCount(0);
  await expect(page.locator('#screen select:focus')).toHaveAttribute('aria-label', /^Category for /);

  // The search and filter survive leaving the screen.
  await search(page).fill('stall');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Accounts' }).click();
  await openBuckets(page);
  await expect(search(page)).toHaveValue('stall');
  await expect(onlyUncategorised(page)).toBeChecked();
  await expect(page.getByText('No buckets match.')).toBeVisible();
});

test('sorting', async ({ page }) => {
  const names = () => page.getByRole('table').getByRole('rowheader').allTextContents();
  const byName = page.getByRole('columnheader', { name: 'Name' });
  await byName.getByRole('button').click();
  await expect(byName).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('columnheader', { name: 'Total' })).not.toHaveAttribute('aria-sort');
  await expect(byName.getByRole('button')).toBeFocused();
  const asc = await names();
  expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));
  await byName.getByRole('button').click();
  await expect(byName).toHaveAttribute('aria-sort', 'descending');
  expect(await names()).toEqual([...asc].reverse());

  const byCount = page.getByRole('columnheader', { name: 'Transactions' });
  await byCount.getByRole('button').click();
  await expect(byCount).toHaveAttribute('aria-sort', 'descending');
  const counts = (await page.locator('td.count').allTextContents()).map(Number);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
});

test('changing a category saves it and keeps focus', async ({ page }) => {
  const select = category(page, 'FARM SHOP');
  await select.focus();
  await select.selectOption({ label: 'Groceries' });
  await expect(category(page, 'FARM SHOP').locator('option:checked')).toHaveText('Groceries');
  await expect(category(page, 'FARM SHOP')).toBeFocused();
  const groceries = (await readStore(page, 'categories')).find((c) => c.name === 'Groceries');
  const farm = () => readStore(page, 'buckets').then((bs) => bs.find((b) => b.displayName === 'FARM SHOP'));
  expect((await farm()).categoryId).toBe(groceries.id);

  await category(page, 'FARM SHOP').selectOption({ label: '(none)' });
  await expect(category(page, 'FARM SHOP').locator('option:checked')).toHaveText('(none)');
  await expect(category(page, 'FARM SHOP')).toBeFocused();
  await expect.poll(async () => 'categoryId' in (await farm())).toBe(false);
});

test('two quick category changes save the second', async ({ page }) => {
  // As Chrome's type-ahead can: a second change while the first is still saving.
  await category(page, 'FARM SHOP').evaluate((el) => {
    const select = /** @type {HTMLSelectElement} */ (el);
    for (const label of ['Groceries', 'Eating out']) {
      select.value = [...select.options].find((o) => o.text === label)?.value ?? '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  const eating = (await readStore(page, 'categories')).find((c) => c.name === 'Eating out');
  const farm = () => readStore(page, 'buckets').then((bs) => bs.find((b) => b.displayName === 'FARM SHOP'));
  await expect.poll(async () => (await farm()).categoryId).toBe(eating.id);
  await expect(category(page, 'FARM SHOP').locator('option:checked')).toHaveText('Eating out');
});

test('merge', async ({ page }) => {
  const merge = page.getByRole('button', { name: 'Merge selected…' });
  await expect(merge).toBeDisabled();
  const before = minor(await total(page, 'MARKET STALL').textContent()) + minor(await total(page, 'FARM SHOP').textContent());
  expect(before).not.toBe(0);
  await category(page, 'MARKET STALL').selectOption({ label: 'Groceries' });
  await expect(category(page, 'MARKET STALL').locator('option:checked')).toHaveText('Groceries');

  await page.getByLabel('Select MARKET STALL').check();
  await expect(merge).toBeDisabled();
  await page.getByLabel('Select FARM SHOP').check();
  await expect(merge).toBeEnabled();
  await merge.click();

  const dialog = mergeDialog(page);
  await expect(dialog).toBeVisible();
  const names = dialog.getByRole('group', { name: 'Name to keep' });
  await expect(names.getByRole('radio')).toHaveCount(2);
  const cat = dialog.getByLabel('Category', { exact: true });
  await expect(cat.locator('option')).toHaveText(['Groceries', 'None']);
  await expect(cat.locator('option:checked')).toHaveText('Groceries');
  await expectNoAxeViolations(page);

  // Escape cancels and returns focus.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(merge).toBeFocused();
  await merge.click();

  await names.getByRole('radio', { name: 'FARM SHOP' }).check();
  await cat.selectOption({ label: 'Groceries' });
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await expect(nameButton(page, 'MARKET STALL')).toHaveCount(0);
  await expect(row(page, 'FARM SHOP')).toHaveCount(1);
  await expect(total(page, 'FARM SHOP')).toHaveText(pounds(before));
  await expect(category(page, 'FARM SHOP').locator('option:checked')).toHaveText('Groceries');
  await expect(merge).toBeDisabled();
  await expect(nameButton(page, 'FARM SHOP')).toBeFocused();

  const buckets = await readStore(page, 'buckets');
  const groceries = (await readStore(page, 'categories')).find((c) => c.name === 'Groceries');
  const farm = buckets.filter((b) => b.displayName === 'FARM SHOP');
  expect(farm).toHaveLength(1);
  expect(farm[0].categoryId).toBe(groceries.id);
  expect(farm[0].keys).toEqual(expect.arrayContaining(['FARM SHOP', 'MARKET STALL']));
  expect(buckets.some((b) => b.displayName === 'MARKET STALL')).toBe(false);
});

test('drill in', async ({ page }) => {
  await nameButton(page, 'AMAZON.CO.UK').click();
  await expect(page.getByRole('heading', { name: 'AMAZON.CO.UK', level: 3 })).toBeFocused();
  // The bucket is fixed, so there is no Bucket filter.
  await expect(page.getByLabel('Bucket', { exact: true })).toHaveCount(0);
  const txnSearch = page.getByLabel('Search transactions');
  await txnSearch.fill('24/09');
  await expect(page.getByRole('row').nth(1)).toContainText('£60.69');
  await expect(page.getByRole('row').nth(1)).toContainText('24/09/2026');
  // Only this bucket's rows.
  for (const text of await page.locator('td .raw').allTextContents()) expect(text).toMatch(/^AMAZON\.CO\.UK/);
  await expectNoAxeViolations(page);

  // A change made here redraws the screen and stays in the bucket.
  const countsAs = page.getByLabel('Counts as for AMAZON.CO.UK*115GL077M on 24/09/2026');
  await countsAs.focus();
  await countsAs.selectOption({ label: 'Gifts' });
  await expect(page.getByRole('heading', { name: 'AMAZON.CO.UK', level: 3 })).toBeVisible();
  await expect(page.getByRole('row').nth(1).locator('.source')).toHaveText('override');
  await expect(countsAs).toBeFocused();
  await expect(txnSearch).toHaveValue('24/09');

  await page.getByRole('button', { name: 'Back to buckets' }).click();
  await expect(search(page)).toBeVisible();
  await expect(nameButton(page, 'AMAZON.CO.UK')).toBeFocused();
});

test('the Buckets nav button returns to the list', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  const drilled = page.getByRole('heading', { name: 'AMAZON.CO.UK', level: 3 });
  await nameButton(page, 'AMAZON.CO.UK').click();
  await expect(drilled).toBeVisible();
  await nav.getByRole('button', { name: 'Buckets' }).click();
  await expect(drilled).toHaveCount(0);
  await expect(search(page)).toBeVisible();

  // Leaving the screen and coming back also lands on the list.
  await nameButton(page, 'AMAZON.CO.UK').click();
  await expect(drilled).toBeVisible();
  await nav.getByRole('button', { name: 'Accounts' }).click();
  await openBuckets(page);
  await expect(drilled).toHaveCount(0);
  await expect(search(page)).toBeVisible();
});

test('a bucket with several currencies is never added across them', async ({ page }) => {
  // Make one FARM SHOP row euros, so the bucket spans two currencies.
  const farm = (await readStore(page, 'buckets')).find((b) => b.displayName === 'FARM SHOP');
  const txn = (await readStore(page, 'transactions')).find((t) => t.bucketId === farm.id);
  await page.evaluate((t) => new Promise((resolve, reject) => {
    const req = indexedDB.open('living-costs');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('transactions', 'readwrite');
      tx.objectStore('transactions').put({ ...t, currency: 'EUR' });
      tx.oncomplete = () => { db.close(); resolve(undefined); };
      tx.onerror = () => reject(tx.error);
    };
  }), txn);
  await page.reload();
  await openBuckets(page);

  await expect(total(page, 'FARM SHOP')).toHaveText('Several currencies');
  // After every single-currency bucket, in either direction.
  const names = page.getByRole('table').getByRole('rowheader');
  await expect(names.last()).toHaveText('FARM SHOP');
  await page.getByRole('columnheader', { name: 'Total' }).getByRole('button').click();
  await expect(page.getByRole('columnheader', { name: 'Total' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(names.last()).toHaveText('FARM SHOP');

  // Not the default name to keep, although its rows add up to more.
  await page.getByLabel('Select FARM SHOP').check();
  await page.getByLabel('Select MARKET STALL').check();
  await page.getByRole('button', { name: 'Merge selected…' }).click();
  await expect(mergeDialog(page).getByRole('radio', { name: 'MARKET STALL' })).toBeChecked();
});
