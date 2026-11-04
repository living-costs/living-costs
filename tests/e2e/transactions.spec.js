import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations, importFiles, readStore } from './helpers.js';

const BANK_A = { new: { name: 'Bank A current', kind: 'bank' }, mapping: 'bankA' };
const CARD = { new: { name: 'Credit card', kind: 'card' }, mapping: 'card' };
// The synthetic £60.69 Amazon charge on the card, on 24/09/2026.
const AMAZON = 'AMAZON.CO.UK*115GL077M';
const AMAZON_LABEL = `Counts as for ${AMAZON} on 24/09/2026`;

/** @param {import('@playwright/test').Page} page */
const screenHeading = (page) => page.locator('#screen h2');
/** @param {import('@playwright/test').Page} page */
const search = (page) => page.getByLabel('Search transactions');
/** @param {import('@playwright/test').Page} page */
const countLine = (page) => page.locator('#screen').getByText(/^Showing \d+ of \d+\.$/);
/** The results row holding a raw text. */
const row = (page, rawText) => page.getByRole('row').filter({ hasText: rawText });
/** The source text (bucket, override, split, transfer or uncategorised) in a row. */
const source = (page, rawText) => row(page, rawText).locator('.source');
/** @param {import('@playwright/test').Page} page */
const splitDialog = (page) => page.getByRole('dialog', { name: 'Split transaction' });

async function openTransactions(page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Transactions' }).click();
  await expect(screenHeading(page)).toHaveText('Transactions');
}

/** Search on the Transactions screen. */
async function find(page, query) {
  await search(page).fill(query);
  await expect(search(page)).toHaveValue(query);
}

test.beforeEach(async ({ page }) => {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(screenHeading(page)).toHaveText('Help');
  await importFiles(page, { files: ['bank-a-current.csv'], account: BANK_A });
  await importFiles(page, { files: ['card.csv'], account: CARD });
  await openTransactions(page);
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('lists transactions with filters and the first 200', async ({ page }) => {
  const txns = await readStore(page, 'transactions');
  const total = txns.length;
  expect(total).toBeGreaterThan(200);
  await expect(countLine(page)).toHaveText(`Showing 200 of ${total}.`);
  // One header row plus 200.
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(201);
  for (const name of ['Date', 'Account', 'Description', 'Amount', 'Counts as']) {
    await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByLabel('Bucket', { exact: true })).toBeVisible();

  // A date range narrows the list.
  await page.getByLabel('From', { exact: true }).fill('2026-09-01');
  await page.getByLabel('To', { exact: true }).fill('2026-09-30');
  const inSep = txns.filter((t) => t.date >= '2026-09-01' && t.date <= '2026-09-30').length;
  await expect(countLine(page)).toHaveText(`Showing ${inSep} of ${inSep}.`);

  // Typing keeps focus and text, and the search is still there after leaving the screen.
  await search(page).pressSequentially('amazon');
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue('amazon');
  await expect(row(page, AMAZON)).toHaveCount(1);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Accounts' }).click();
  await openTransactions(page);
  await expect(search(page)).toHaveValue('amazon');
  await expect(row(page, AMAZON)).toHaveCount(1);
  await expectNoAxeViolations(page);
});

test('find by amount and split', async ({ page }) => {
  await find(page, '£60.69');
  await expect(countLine(page)).toHaveText('Showing 1 of 1.');
  await expect(source(page, AMAZON)).toHaveText('uncategorised');
  const select = page.getByLabel(AMAZON_LABEL);
  await expect(select.locator('option:checked')).toHaveText("Use bucket's category (none)");

  await select.selectOption({ label: 'Split…' });
  const dialog = splitDialog(page);
  await expect(dialog).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Save split' });
  await expect(save).toBeDisabled();
  await expect(dialog.getByText(/^Remaining: /)).toHaveText('Remaining: £60.69');

  const part = (n) => dialog.getByRole('group', { name: `Part ${n}` });
  await part(1).getByLabel('Amount').fill('40.00');
  await part(1).getByLabel('Category').selectOption({ label: 'Household maintenance' });
  await expect(dialog.getByText(/^Remaining: /)).toHaveText('Remaining: £20.69');
  await expect(save).toBeDisabled();

  // An unparseable amount shows an error and keeps Save split disabled.
  await part(2).getByLabel('Amount').fill('20.6x');
  await expect(part(2).getByText('Enter an amount, such as 12.50.')).toBeVisible();
  await expect(save).toBeDisabled();
  // "null" is not an amount (and not a blank part); a leading £ is accepted, as in search.
  await part(2).getByLabel('Amount').fill('null');
  await expect(part(2).getByText('Enter an amount, such as 12.50.')).toBeVisible();
  await expect(save).toBeDisabled();
  await part(2).getByLabel('Amount').fill('£20.69');
  await expect(part(2).getByText('Enter an amount, such as 12.50.')).toHaveCount(0);
  // Every part needs a category.
  await save.click();
  await expect(part(2).getByText('Choose a category.')).toBeVisible();
  await expect(part(2).getByLabel('Category')).toBeFocused();
  expect(await readStore(page, 'overrides')).toEqual([]);
  await part(2).getByLabel('Category').selectOption({ label: 'Gifts' });
  await expect(part(2).getByText('Choose a category.')).toHaveCount(0);
  await expect(dialog.getByText(/^Remaining: /)).toHaveText('Remaining: £0.00');
  await expect(save).toBeEnabled();

  // Add part; a part left blank is ignored. The dialog passes axe while it is open.
  await dialog.getByRole('button', { name: 'Add part' }).click();
  await expect(part(3).getByLabel('Amount')).toBeFocused();
  await expect(save).toBeEnabled();
  await expectNoAxeViolations(page);

  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(source(page, AMAZON)).toHaveText('split');
  await expect(page.getByLabel(AMAZON_LABEL).locator('option:checked')).toHaveText('Split…');
  await expect(page.getByLabel(AMAZON_LABEL)).toBeFocused();
  await expect(search(page)).toHaveValue('£60.69');

  const overrides = await readStore(page, 'overrides');
  const categories = await readStore(page, 'categories');
  const id = (name) => categories.find((c) => c.name === name).id;
  expect(overrides).toHaveLength(1);
  expect(overrides[0].splits).toEqual([
    { amountMinor: -4000, categoryId: id('Household maintenance') },
    { amountMinor: -2069, categoryId: id('Gifts') },
  ]);

  // Choosing Split… again reopens the dialog with the current parts. The row's current split is
  // a hidden option, so the listed Split… is a real change in a browser too.
  await expect(page.getByLabel(AMAZON_LABEL).locator('option:checked')).toHaveAttribute('hidden', '');
  await page.getByLabel(AMAZON_LABEL).selectOption({ label: 'Split…' });
  await expect(part(1).getByLabel('Amount')).toHaveValue('40.00');
  await expect(part(2).getByLabel('Amount')).toHaveValue('20.69');
  await expect(part(2).getByLabel('Category').locator('option:checked')).toHaveText('Gifts');
  await expectNoAxeViolations(page);
});

test('cancelling a split leaves the row unchanged', async ({ page }) => {
  await find(page, '£60.69');
  await page.getByLabel(AMAZON_LABEL).selectOption({ label: 'Split…' });
  const dialog = splitDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('group', { name: 'Part 1' }).getByLabel('Amount').fill('10.00');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel(AMAZON_LABEL)).toBeFocused();
  await expect(source(page, AMAZON)).toHaveText('uncategorised');
  await expect(page.getByLabel(AMAZON_LABEL).locator('option:checked')).toHaveText("Use bucket's category (none)");

  await page.getByLabel(AMAZON_LABEL).selectOption({ label: 'Split…' });
  await expect(dialog.getByRole('group', { name: 'Part 1' }).getByLabel('Amount')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel(AMAZON_LABEL)).toBeFocused();
  expect(await readStore(page, 'overrides')).toEqual([]);
});

test('move one transaction', async ({ page }) => {
  await find(page, '24/09');
  // Nearest date first.
  await expect(page.getByRole('row').nth(1)).toContainText('24/09/2026');
  const select = page.getByLabel(AMAZON_LABEL);
  // selectOption does not move focus; a person using the select has focused it.
  await select.focus();
  await select.selectOption({ label: 'Gifts' });
  await expect(source(page, AMAZON)).toHaveText('override');
  await expect(page.getByLabel(AMAZON_LABEL).locator('option:checked')).toHaveText('Gifts');
  await expect(page.getByLabel(AMAZON_LABEL)).toBeFocused();
  // Only that one row moved.
  const overrides = await readStore(page, 'overrides');
  expect(overrides).toHaveLength(1);
  expect(overrides[0].fingerprint).toContain(AMAZON);
  await expectNoAxeViolations(page);
});

test('reset', async ({ page }) => {
  await find(page, '24/09');
  await page.getByLabel(AMAZON_LABEL).selectOption({ label: 'Gifts' });
  await expect(source(page, AMAZON)).toHaveText('override');
  await page.getByLabel(AMAZON_LABEL).selectOption({ label: "Use bucket's category (none)" });
  await expect(source(page, AMAZON)).toHaveText('uncategorised');
  expect(await readStore(page, 'overrides')).toEqual([]);
});

test('two quick Counts as changes save the second, even back to the bucket', async ({ page }) => {
  await find(page, '24/09');
  const id = async (name) => (await readStore(page, 'categories')).find((c) => c.name === name).id;
  const override = async () => (await readStore(page, 'overrides')).map((o) => o.categoryId);
  /** Two changes in a row, as Chrome's type-ahead can fire them. @param {string[]} labels */
  const quick = (labels) => page.getByLabel(AMAZON_LABEL).evaluate((el, list) => {
    const select = /** @type {HTMLSelectElement} */ (el);
    for (const label of list) {
      select.value = [...select.options].find((o) => o.text === label)?.value ?? '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, labels);

  await quick(['Gifts', 'Groceries']);
  const groceries = await id('Groceries');
  await expect.poll(override).toEqual([groceries]);
  await expect(page.getByLabel(AMAZON_LABEL).locator('option:checked')).toHaveText('Groceries');

  // Away and straight back: the second change undoes the first.
  await quick(['Gifts', "Use bucket's category (none)"]);
  await expect.poll(override).toEqual([]);
  await expect(source(page, AMAZON)).toHaveText('uncategorised');
});

test('override survives undo and re-import', async ({ page }) => {
  await find(page, '24/09');
  await page.getByLabel(AMAZON_LABEL).selectOption({ label: 'Gifts' });
  await expect(source(page, AMAZON)).toHaveText('override');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Accounts' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Undo card.csv' }).click();
  await expect(page.getByRole('button', { name: 'Undo card.csv' })).toHaveCount(0);
  await openTransactions(page);
  await expect(row(page, AMAZON)).toHaveCount(0);

  // Undo removed the file's hash, so it can be imported again.
  await importFiles(page, { files: ['card.csv'], account: { existing: 'Credit card' } });
  await openTransactions(page);
  await expect(search(page)).toHaveValue('24/09');
  await expect(source(page, AMAZON)).toHaveText('override');
  await expect(page.getByLabel(AMAZON_LABEL).locator('option:checked')).toHaveText('Gifts');
});

test('a confirmed transfer shows Transfer with no select', async ({ page }) => {
  const txns = await readStore(page, 'transactions');
  const amazon = txns.find((t) => t.rawText === AMAZON);
  const other = txns.find((t) => t.rawText !== AMAZON);
  await page.evaluate(({ a, b }) => new Promise((resolve, reject) => {
    const req = indexedDB.open('budgie');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('transferPairs', 'readwrite');
      tx.objectStore('transferPairs').put({ key: `${a}~${b}`, fingerprintA: a, fingerprintB: b, status: 'confirmed' });
      tx.oncomplete = () => { db.close(); resolve(undefined); };
      tx.onerror = () => reject(tx.error);
    };
  }), { a: amazon.fingerprint, b: other.fingerprint });
  await page.reload();
  await openTransactions(page);
  await find(page, '£60.69');
  await expect(source(page, AMAZON)).toHaveText('transfer');
  await expect(row(page, AMAZON)).toContainText('Transfer');
  await expect(page.getByLabel(AMAZON_LABEL)).toHaveCount(0);
});

test('cancelling on a split row leaves the split unchanged', async ({ page }) => {
  await find(page, '£60.69');
  const select = page.getByLabel(AMAZON_LABEL);
  await select.selectOption({ label: 'Split…' });
  const dialog = splitDialog(page);
  const part = (n) => dialog.getByRole('group', { name: `Part ${n}` });
  await part(1).getByLabel('Amount').fill('40.00');
  await part(1).getByLabel('Category').selectOption({ label: 'Household maintenance' });
  await part(2).getByLabel('Amount').fill('20.69');
  await part(2).getByLabel('Category').selectOption({ label: 'Gifts' });
  await dialog.getByRole('button', { name: 'Save split' }).click();
  await expect(source(page, AMAZON)).toHaveText('split');
  const before = await readStore(page, 'overrides');

  await page.getByLabel(AMAZON_LABEL).selectOption({ label: 'Split…' });
  await expect(part(1).getByLabel('Amount')).toHaveValue('40.00');
  await part(1).getByLabel('Amount').fill('30.00');
  await part(1).getByLabel('Category').selectOption({ label: 'Groceries' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel(AMAZON_LABEL)).toBeFocused();
  await expect(source(page, AMAZON)).toHaveText('split');
  await expect(page.getByLabel(AMAZON_LABEL).locator('option:checked')).toHaveText('Split…');
  expect(await readStore(page, 'overrides')).toEqual(before);

  // Reopening shows the saved parts, not the cancelled edits.
  await page.getByLabel(AMAZON_LABEL).selectOption({ label: 'Split…' });
  await expect(part(1).getByLabel('Amount')).toHaveValue('40.00');
  await expect(part(1).getByLabel('Category').locator('option:checked')).toHaveText('Household maintenance');
});
