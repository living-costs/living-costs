import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations } from './helpers.js';

const DEFAULTS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/default-categories.js');

/** @param {import('@playwright/test').Page} page */
const screenHeading = (page) => page.locator('#screen h2');
/** @param {import('@playwright/test').Page} page */
const table = (page) => page.getByRole('table', { name: 'Your categories' });
/** Row header texts (category names) in display order. */
const names = (page) => table(page).getByRole('rowheader').allTextContents();
const overflow = (page) => page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);

/** Open the Categories screen from the nav. */
async function openCategories(page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Categories' }).click();
  await expect(screenHeading(page)).toHaveText('Categories');
  await expect(table(page)).toBeVisible();
}

/**
 * Serve default-categories.js with extra entries appended. The app still loads it from its own
 * origin under the same CSP; only the file content differs, as if the owner had edited it.
 */
async function withExtraDefaults(page, entries) {
  const source = fs.readFileSync(DEFAULTS_FILE, 'utf8');
  const extra = entries.map((e) => `  ${JSON.stringify(e)},\n`).join('');
  const body = source.replace(/\];\s*$/, `${extra}];\n`);
  expect(body).not.toBe(source);
  await page.route('**/src/default-categories.js', (route) => route.fulfill({
    status: 200, contentType: 'text/javascript', body,
  }));
}

/** Read a store from IndexedDB. */
const readStore = (page, name) => page.evaluate((storeName) => new Promise((resolve, reject) => {
  const req = indexedDB.open('budgie');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const all = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    all.onsuccess = () => { db.close(); resolve(all.result); };
    all.onerror = () => reject(all.error);
  };
}), name);

/** Put rows into an IndexedDB store (test setup only; the app reads it on the next load). */
const putRows = (page, name, rows) => page.evaluate(({ storeName, items }) => new Promise((resolve, reject) => {
  const req = indexedDB.open('budgie');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(storeName, 'readwrite');
    for (const item of items) tx.objectStore(storeName).put(item);
    tx.oncomplete = () => { db.close(); resolve(undefined); };
    tx.onerror = () => reject(tx.error);
  };
}), { storeName: name, items: rows });

test.beforeEach(async ({ page }) => {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(screenHeading(page)).toHaveText('Help');
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('lists the defaults in order', async ({ page }) => {
  await openCategories(page);
  const list = await names(page);
  expect(list).toHaveLength(25);
  expect(list[0]).toBe('Salary');
  expect(list.at(-1)).toBe('Ignore');
  await expect(page.getByLabel('Kind for Insurance')).toHaveValue('spend');
  await expect(page.getByLabel('Budget type for Insurance')).toHaveValue('annual');
  await expect(page.getByLabel('Budget type for Ignore')).toHaveCount(0);
  await expect(page.locator('#notices')).not.toContainText('New suggested categories');
  await expectNoAxeViolations(page);
});

test('create, retype and delete', async ({ page }) => {
  await openCategories(page);

  // Create Pets (spend, Variable): it appears at the end.
  await page.getByLabel('Name', { exact: true }).fill('Pets');
  await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'Spend' });
  await page.getByLabel('Budget type', { exact: true }).selectOption({ label: 'Variable' });
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(table(page).getByRole('rowheader').last()).toHaveText('Pets');
  await expect(page.getByLabel('Budget type for Pets')).toHaveValue('variable');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
  await expectNoAxeViolations(page);

  // Change Insurance to Variable; focus stays on the select and it survives a reload.
  const insurance = page.getByLabel('Budget type for Insurance');
  await insurance.focus(); // selectOption does not move focus; a user's click or keypress would.
  await insurance.selectOption({ label: 'Variable' });
  await expect(insurance).toHaveValue('variable');
  await expect(insurance).toBeFocused();
  await page.reload();
  await openCategories(page);
  await expect(page.getByLabel('Budget type for Insurance')).toHaveValue('variable');
  expect((await names(page)).at(-1)).toBe('Pets');

  // Delete Pets: nothing refers to it, so no reassignment is asked.
  await page.getByRole('button', { name: 'Delete Pets' }).click();
  await expect(page.getByRole('heading', { name: 'Delete Pets' })).toBeFocused();
  await expect(page.getByLabel('Move its items to')).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(table(page).getByRole('rowheader', { name: 'Pets' })).toHaveCount(0);
  expect(await names(page)).toHaveLength(25);
  await expect(screenHeading(page)).toBeFocused();
  await expectNoAxeViolations(page);
});

test('new category validation is shown inline', async ({ page }) => {
  await openCategories(page);
  const name = page.getByLabel('Name', { exact: true });
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByText('Enter a name.')).toBeVisible();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expectNoAxeViolations(page);

  await name.fill('gifts');
  await name.press('Enter');
  await expect(page.getByText('There is already a category called Gifts.')).toBeVisible();
  expect(await names(page)).toHaveLength(25);

  // Transfer and ignore have no budget type.
  await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'Transfer' });
  await expect(page.getByLabel('Budget type', { exact: true })).toBeHidden();
  await name.fill('Savings pot');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(table(page).getByRole('rowheader').last()).toHaveText('Savings pot');
  await expect(page.getByLabel('Budget type for Savings pot')).toHaveCount(0);
  await expect(page.getByText('There is already a category called Gifts.')).toHaveCount(0);
});

test('switching kind sets or clears the budget type', async ({ page }) => {
  await openCategories(page);
  await page.getByLabel('Kind for Gifts').focus();
  await page.getByLabel('Kind for Gifts').selectOption({ label: 'Transfer' });
  await expect(page.getByLabel('Budget type for Gifts')).toHaveCount(0);
  await expect(page.getByLabel('Kind for Gifts')).toBeFocused();
  await page.getByLabel('Kind for Gifts').selectOption({ label: 'Spend' });
  await expect(page.getByLabel('Budget type for Gifts')).toHaveValue('variable');
  // A budgeted kind keeps its existing budget type.
  await page.getByLabel('Kind for Salary').selectOption({ label: 'Contribution' });
  await expect(page.getByLabel('Budget type for Salary')).toHaveValue('fixed');
  await expectNoAxeViolations(page);
});

test('rename inline, with errors and cancel', async ({ page }) => {
  await openCategories(page);
  await page.getByRole('button', { name: 'Rename Gifts' }).click();
  const input = page.getByLabel('New name for Gifts');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Gifts');
  await expectNoAxeViolations(page);

  await input.fill('Health');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('There is already a category called Health.')).toBeVisible();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Rename Gifts' })).toBeFocused();
  await expect(table(page).getByRole('rowheader', { name: 'Gifts', exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'Rename Gifts' }).click();
  await page.getByLabel('New name for Gifts').fill('Presents');
  await page.getByLabel('New name for Gifts').press('Enter');
  await expect(table(page).getByRole('rowheader', { name: 'Presents', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Rename Presents' })).toBeFocused();
  await page.reload();
  await openCategories(page);
  await expect(table(page).getByRole('rowheader', { name: 'Presents', exact: true })).toHaveCount(1);
});

test('deleting a category in use asks where its items go', async ({ page }) => {
  const cats = await readStore(page, 'categories');
  const gifts = cats.find((c) => c.name === 'Gifts');
  const ent = cats.find((c) => c.name === 'Entertainment');
  await putRows(page, 'buckets', [{ id: 'bk1', keys: ['card shop'], displayName: 'CARD SHOP', categoryId: gifts.id, exampleRawTexts: [] }]);
  await putRows(page, 'overrides', [
    { fingerprint: 'fp1', categoryId: gifts.id },
    { fingerprint: 'fp2', splits: [{ amountMinor: -100, categoryId: gifts.id }, { amountMinor: -200, categoryId: ent.id }] },
  ]);
  await page.reload();
  await openCategories(page);

  await page.getByRole('button', { name: 'Delete Gifts' }).click();
  await expect(page.getByRole('heading', { name: 'Delete Gifts' })).toBeFocused();
  await expect(page.getByText('Gifts is used by 1 bucket and 2 transactions.')).toBeVisible();
  const target = page.getByLabel('Move its items to');
  await expect(target.locator('option', { hasText: /^Gifts$/ })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // Cancel returns focus to the row's Delete button.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Delete Gifts' })).toBeFocused();

  await page.getByRole('button', { name: 'Delete Gifts' }).click();
  await page.getByRole('button', { name: 'Delete and move' }).click();
  await expect(page.getByText('Choose a category to move its items to.')).toBeVisible();
  await expect(page.getByLabel('Move its items to')).toBeFocused();
  await expect(page.getByLabel('Move its items to')).toHaveAttribute('aria-invalid', 'true');
  await expect(table(page).getByRole('rowheader', { name: 'Gifts', exact: true })).toHaveCount(1);
  await expectNoAxeViolations(page);
  await page.getByLabel('Move its items to').selectOption({ label: 'Entertainment' });
  await page.getByRole('button', { name: 'Delete and move' }).click();
  await expect(table(page).getByRole('rowheader', { name: 'Gifts', exact: true })).toHaveCount(0);

  const buckets = await readStore(page, 'buckets');
  const overrides = await readStore(page, 'overrides');
  expect(buckets[0].categoryId).toBe(ent.id);
  expect(overrides.find((o) => o.fingerprint === 'fp1').categoryId).toBe(ent.id);
  expect(overrides.find((o) => o.fingerprint === 'fp2').splits.map((p) => p.categoryId)).toEqual([ent.id, ent.id]);
  expect((await readStore(page, 'categories')).some((c) => c.id === gifts.id)).toBe(false);
});

test('reflows at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openCategories(page);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Rename Gifts' }).click();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Delete Gifts' }).click();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

test('new suggested categories can be added', async ({ page }) => {
  await withExtraDefaults(page, [
    { id: 'pets', name: 'Pets', kind: 'spend', budgetType: 'variable' },
    { id: 'charity', name: 'Charity', kind: 'spend', budgetType: 'fixed' },
  ]);
  await page.reload();
  const notice = page.locator('#notices');
  await expect(notice).toContainText('New suggested categories: Pets, Charity');
  await expectNoAxeViolations(page);
  await notice.getByRole('button', { name: 'Add' }).click();
  await expect(notice).not.toContainText('New suggested categories');
  await expect(screenHeading(page)).toBeFocused();

  await openCategories(page);
  expect((await names(page)).slice(-2)).toEqual(['Pets', 'Charity']);
  await expect(page.getByLabel('Budget type for Charity')).toHaveValue('fixed');

  await page.reload();
  await expect(screenHeading(page)).toBeVisible();
  await expect(notice).not.toContainText('New suggested categories');
});

test('new suggested categories can be dismissed, keeping other notices', async ({ page }) => {
  await withExtraDefaults(page, [{ id: 'pets', name: 'Pets', kind: 'spend', budgetType: 'variable' }]);
  await page.reload();
  const notice = page.locator('#notices');
  await expect(notice).toContainText('New suggested categories: Pets');
  // Another notice already there must survive.
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'other-notice';
    p.textContent = 'Other notice';
    document.getElementById('notices')?.append(p);
  });
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).not.toContainText('New suggested categories');
  await expect(page.locator('#other-notice')).toHaveText('Other notice');

  await openCategories(page);
  expect(await names(page)).not.toContain('Pets');
  await page.reload();
  await expect(screenHeading(page)).toBeVisible();
  await expect(notice).not.toContainText('New suggested categories');
});

test('double-clicking Add on the suggestions adds each category once', async ({ page }) => {
  await withExtraDefaults(page, [
    { id: 'pets', name: 'Pets', kind: 'spend', budgetType: 'variable' },
    { id: 'charity', name: 'Charity', kind: 'spend', budgetType: 'fixed' },
  ]);
  await page.reload();
  const notice = page.locator('#notices');
  await expect(notice).toContainText('New suggested categories: Pets, Charity');
  await notice.getByRole('button', { name: 'Add' }).dblclick();
  await expect(notice).not.toContainText('New suggested categories');

  await openCategories(page);
  const list = await names(page);
  expect(list.filter((n) => n === 'Pets')).toHaveLength(1);
  expect(list.filter((n) => n === 'Charity')).toHaveLength(1);
  const stored = (await readStore(page, 'categories')).map((c) => c.name);
  expect(stored.filter((n) => n === 'Pets')).toHaveLength(1);
  expect(stored.filter((n) => n === 'Charity')).toHaveLength(1);
});

test('double-clicking Add category adds it once', async ({ page }) => {
  await openCategories(page);
  await page.getByLabel('Name', { exact: true }).fill('Pets');
  await page.getByRole('button', { name: 'Add category' }).dblclick();
  await expect(table(page).getByRole('rowheader').last()).toHaveText('Pets');
  expect((await readStore(page, 'categories')).filter((c) => c.name === 'Pets')).toHaveLength(1);
  expect(await names(page)).toHaveLength(26);
  // The second click is ignored, rather than submitting the cleared form.
  await expect(page.getByText('Enter a name.')).toHaveCount(0);
});
