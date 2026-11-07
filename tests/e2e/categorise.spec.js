import { test, expect } from '@playwright/test';
import {
  expectNoAxeViolations, trackCspViolations, importFiles, skipToCard, cardHeading, readStore, navButton, expectBesideHeading,
} from './helpers.js';

const BANK_A = { new: { name: 'Bank A current', kind: 'bank' }, mapping: 'bankA' };
const SALARY = 'EXAMPLE EMPLOYER LTD SALARY';

/** @param {import('@playwright/test').Page} page */
const screenHeading = (page) => page.locator('#screen h2');
/** @param {import('@playwright/test').Page} page */
const card = (page) => page.locator('#card');
/** @param {import('@playwright/test').Page} page */
const progressLine = (page) => page.locator('#categorise-progress');
/** A card section by its heading. */
const section = (page, name) => card(page).getByRole('region', { name, exact: true });
/** The card's "£X over N months · M transactions · …" line. */
const summary = (page) => page.locator('#card-summary');

/** @param {string} text */
const bucketsLeft = (text) => Number(/· (\d+) buckets? left$/.exec(text)?.[1]);
/** @param {string} text */
const percent = (text) => Number(/\((\d+)%\)/.exec(text)?.[1]);
/** @param {string} text */
const txnCount = (text) => Number(/· (\d+) transactions?/.exec(text)?.[1]);

async function openCategorise(page) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Categorise' }).click();
  await expect(screenHeading(page)).toHaveText('Categorise');
  await expect(cardHeading(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(screenHeading(page)).toHaveText('Help');
  await importFiles(page, { files: ['bank-a-current.csv'], account: BANK_A });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('category buttons describe their kind and type', async ({ page }) => {
  await openCategorise(page);
  const buttons = card(page).getByRole('group', { name: 'Category' });
  const salary = buttons.getByRole('button', { name: /Salary$/ });
  const fixed = "Income · Fixed: each charge's latest amount, as often as charged, ÷ 12";
  await expect(salary).toHaveAttribute('title', fixed);
  await expect(salary).toHaveAccessibleDescription(fixed);
  await expect(buttons.getByRole('button', { name: /Groceries$/ })).toHaveAttribute('title', 'Spending · Variable: the median month');
  await expect(buttons.getByRole('button', { name: /Ignore$/ })).toHaveAttribute('title', 'Ignore: not counted');
  await expect(buttons.getByRole('button', { name: 'New category…' })).not.toHaveAttribute('title', /.+/);
});

test('largest first', async ({ page }) => {
  await openCategorise(page);
  await expect(cardHeading(page)).toHaveText(SALARY);
  await expect(summary(page)).toHaveText('£30,000.00 over 12 months · 12 transactions · about £2,500.00 a month');
  await expect(progressLine(page)).toHaveText(/^£0\.00 of £[\d,]+\.\d\d categorised \(0%\) · \d+ buckets left$/);
  await expect(navButton(page, 'Categorise')).toHaveAccessibleName('Categorise (at 0%)');
  const buttons = card(page).getByRole('group', { name: 'Category' }).getByRole('button');
  await expect(buttons.first()).toHaveText('1 Coffee shops');
  await expect(buttons.nth(9)).toHaveText('0 Holidays');
  await expect(buttons.nth(10)).toHaveText('Subscriptions');
  await expect(buttons.last()).toHaveText('New category…');
});

test('number key assigns', async ({ page }) => {
  await openCategorise(page);
  const before = await progressLine(page).textContent();
  await card(page).focus();
  await page.keyboard.press('1');
  await expect(cardHeading(page)).not.toHaveText(SALARY);
  await expect(progressLine(page)).toHaveText(/^£30,000\.00 of /);
  const after = await progressLine(page).textContent();
  expect(bucketsLeft(after)).toBe(bucketsLeft(before) - 1);
  // The nav tab shows the same percent as the progress line.
  expect(percent(after)).toBeGreaterThan(0);
  await expect(navButton(page, 'Categorise')).toHaveAccessibleName(`Categorise (at ${percent(after)}%)`);
  const salary = (await readStore(page, 'buckets')).find((b) => b.displayName === SALARY);
  const categories = await readStore(page, 'categories');
  expect(categories.find((c) => c.id === salary.categoryId)?.name).toBe('Coffee shops');
});

test('focus stays in the card after a number key', async ({ page }) => {
  await openCategorise(page);
  await card(page).focus();
  await page.keyboard.press('1');
  await expect(cardHeading(page)).toHaveText('ACME LETTINGS');
  await expect(card(page)).toBeFocused();
  await page.keyboard.press('1');
  await expect(cardHeading(page)).not.toHaveText('ACME LETTINGS');
  const acme = (await readStore(page, 'buckets')).find((b) => b.displayName === 'ACME LETTINGS');
  expect(acme.categoryId).toBeTruthy();
});

/**
 * Press `2` on the card, wait for the next card, and return the category name the SALARY bucket
 * got. If an earlier key had assigned SALARY, this `2` would land on the next bucket (or be
 * ignored while that save is in flight), so SALARY would not get the second category.
 */
async function pressTwoOnCard(page) {
  await card(page).focus();
  await page.keyboard.press('2');
  await expect(cardHeading(page)).not.toHaveText(SALARY);
  const salary = (await readStore(page, 'buckets')).find((b) => b.displayName === SALARY);
  return (await readStore(page, 'categories')).find((c) => c.id === salary.categoryId)?.name;
}

test('keys inactive outside card', async ({ page }) => {
  await openCategorise(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Categorise' }).focus();
  await page.keyboard.press('1');
  expect(await pressTwoOnCard(page)).toBe('Groceries');
});

test('keys typed in a select inside the card do nothing', async ({ page }) => {
  await openCategorise(page);
  await page.getByRole('button', { name: 'New category…' }).click();
  const kind = card(page).getByLabel('Kind', { exact: true });
  await kind.focus();
  await page.keyboard.press('1');
  await expect(kind).toBeFocused();
  expect(await pressTwoOnCard(page)).toBe('Groceries');
});

test('busy guard: a second click while saving is ignored', async ({ page }) => {
  await openCategorise(page);
  // Two clicks in one task, so the second always lands while the first save is in flight.
  await card(page).getByRole('button', { name: '1 Coffee shops' }).evaluate((b) => { b.click(); b.click(); });
  await expect(cardHeading(page)).toHaveText('ACME LETTINGS');
  expect((await readStore(page, 'buckets')).filter((b) => b.categoryId).map((b) => b.displayName)).toEqual([SALARY]);

  await skipToCard(page, 'PAYPAL PAYMENT');
  const item = section(page, 'Repeating amounts').getByRole('listitem').filter({ hasText: '£2.99, 13 times, monthly' });
  await item.getByRole('button', { name: 'Make this its own bucket' }).click();
  await card(page).getByLabel('Bucket name').fill('Google One storage');
  await card(page).getByRole('button', { name: 'Make bucket' }).evaluate((b) => { b.click(); b.click(); });
  await expect(section(page, 'Flagged')).toBeVisible();
  expect(await readStore(page, 'rules')).toHaveLength(1);
  expect((await readStore(page, 'buckets')).filter((b) => b.displayName === 'Google One storage')).toHaveLength(1);
});

test('category buttons, Skip for now and Stop here', async ({ page }) => {
  await openCategorise(page);
  // Both sit on the bucket name's line, Skip for now first, and nowhere else.
  const skip = page.getByRole('button', { name: 'Skip for now' });
  const stop = page.getByRole('button', { name: 'Stop here' });
  await expectBesideHeading(cardHeading(page), skip);
  await expectBesideHeading(cardHeading(page), stop);
  const [sb, tb] = [await skip.boundingBox(), await stop.boundingBox()];
  expect(tb?.x).toBeGreaterThan((sb?.x ?? 0) + (sb?.width ?? 0));
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(cardHeading(page)).toHaveText('ACME LETTINGS');
  await card(page).getByRole('button', { name: /Housing/ }).click();
  await expect(cardHeading(page)).not.toHaveText('ACME LETTINGS');
  await expect(cardHeading(page)).not.toHaveText(SALARY);
  await page.getByRole('button', { name: 'Stop here' }).click();
  await expect(screenHeading(page)).toHaveText('Typical month');
});

test('new category from the card, and keys typed into its form do nothing', async ({ page }) => {
  await openCategorise(page);
  await page.getByRole('button', { name: 'New category…' }).click();
  const name = card(page).getByLabel('Name', { exact: true });
  await expect(name).toBeFocused();
  await name.pressSequentially('Wages 1');
  await expect(cardHeading(page)).toHaveText(SALARY);
  await card(page).getByLabel('Kind', { exact: true }).selectOption({ label: 'Income' });
  await card(page).getByLabel('Budget type', { exact: true }).selectOption({ label: 'Fixed' });
  await card(page).getByRole('button', { name: 'Add and use' }).click();
  await expect(cardHeading(page)).toHaveText('ACME LETTINGS');
  const categories = await readStore(page, 'categories');
  const wages = categories.find((c) => c.name === 'Wages 1');
  expect(wages).toMatchObject({ kind: 'income', budgetType: 'fixed' });
  const salary = (await readStore(page, 'buckets')).find((b) => b.displayName === SALARY);
  expect(salary.categoryId).toBe(wages.id);
});

test('amount rule', async ({ page }) => {
  await openCategorise(page);
  await skipToCard(page, 'PAYPAL PAYMENT');
  const item = section(page, 'Repeating amounts').getByRole('listitem').filter({ hasText: '£2.99, 13 times, monthly' });
  await item.getByRole('button', { name: 'Make this its own bucket' }).click();
  await expect(card(page).getByLabel('Times per month')).toHaveValue('1');
  await card(page).getByLabel('Bucket name').fill('Google One storage');
  await card(page).getByRole('button', { name: 'Make bucket' }).click();

  await expect(cardHeading(page)).toHaveText('PAYPAL PAYMENT');
  const flagged = section(page, 'Flagged');
  await expect(flagged.getByRole('listitem')).toHaveCount(1);
  await expect(flagged.getByRole('listitem')).toContainText('20/10/2026');
  await expect(flagged).toContainText('Matched Google One storage, but it already had a payment this month.');
  await flagged.getByRole('button', { name: 'It belongs there' }).click();
  await expect(flagged).toHaveCount(0);

  const buckets = await readStore(page, 'buckets');
  const google = buckets.find((b) => b.displayName === 'Google One storage');
  const txns = (await readStore(page, 'transactions')).filter((t) => t.bucketId === google.id);
  expect(txns).toHaveLength(13);
  expect(txns.every((t) => t.flaggedRuleId === undefined)).toBe(true);
});

test('amount rule form needs a name and a whole count', async ({ page }) => {
  await openCategorise(page);
  await skipToCard(page, 'PAYPAL PAYMENT');
  const item = section(page, 'Repeating amounts').getByRole('listitem').filter({ hasText: '£2.99, 13 times, monthly' });
  await item.getByRole('button', { name: 'Make this its own bucket' }).click();
  await card(page).getByLabel('Bucket name').fill('   ');
  await card(page).getByRole('button', { name: 'Make bucket' }).click();
  await expect(card(page).getByText('Enter a bucket name.')).toBeVisible();
  await card(page).getByLabel('Bucket name').fill('Google One storage');
  await card(page).getByLabel('Times per month').fill('0');
  await card(page).getByRole('button', { name: 'Make bucket' }).click();
  await expect(card(page).getByText('Enter a whole number, 1 or more.')).toBeVisible();
  expect(await readStore(page, 'rules')).toEqual([]);
});

test('unusual', async ({ page }) => {
  await openCategorise(page);
  await skipToCard(page, 'TESCO STORES');
  const unusual = section(page, 'Unusual amounts');
  const row = unusual.getByRole('listitem').filter({ hasText: '£650.00' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('13/06/2026');
  await row.getByRole('button', { name: "It's normal" }).click();
  await expect(unusual).toHaveCount(0);
  const overrides = await readStore(page, 'overrides');
  expect(overrides).toHaveLength(1);
  expect(overrides[0].unusualDismissed).toBe(true);
});

test('unusual: move to another category', async ({ page }) => {
  await openCategorise(page);
  await skipToCard(page, 'TESCO STORES');
  const row = section(page, 'Unusual amounts').getByRole('listitem').filter({ hasText: '£650.00' });
  await row.getByRole('button', { name: 'Move to another category…' }).click();
  const names = (await readStore(page, 'categories')).map((c) => c.name)
    .sort((a, b) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' }));
  await expect(row.getByLabel('Move to').locator('option')).toHaveText(['Choose a category', ...names]);
  await row.getByLabel('Move to').selectOption({ label: 'Big one-offs' });
  await row.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(section(page, 'Unusual amounts')).toHaveCount(0);
  const [override] = await readStore(page, 'overrides');
  const categories = await readStore(page, 'categories');
  expect(categories.find((c) => c.id === override.categoryId)?.name).toBe('Big one-offs');
});

test('each month: press a month, move a row out, see the figures change and the row stay, then put it back', async ({ page }) => {
  await openCategorise(page);
  await skipToCard(page, 'TESCO STORES');
  const months = section(page, 'Each month');
  const cells = months.getByRole('group', { name: 'Each month' });
  await expect(cells.getByRole('button')).toHaveCount(12);
  const june = cells.getByRole('button', { name: /^Jun 2026/ });
  // 650.00 + 73.92 + 66.61 + 81.23 + 88.54
  await expect(june).toHaveText('Jun 2026£960.30, unusual');
  await expect(june).toHaveClass(/unusual/);
  const before = await summary(page).textContent();
  const rows = months.getByRole('region', { name: 'Matching transactions' }).locator('tbody tr');
  await expect(rows).toHaveCount(0);

  await june.click();
  await expect(june).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(5);
  for (const r of await rows.all()) await expect(r.locator('td').first()).toHaveText(/^\d\d\/06\/2026$/);

  const big = rows.filter({ hasText: '-£650.00' });
  const select = big.getByLabel('Counts as for CARD PURCHASE TESCO STORES 2041 on 13/06/2026');
  await select.selectOption({ label: 'Gifts' });
  await expect(june).toHaveText('Jun 2026£310.30');
  await expect(june).not.toHaveClass(/unusual/);
  await expect(rows).toHaveCount(5);
  await expect(big.locator('.source')).toHaveText('override');
  expect(txnCount(await summary(page).textContent())).toBe(txnCount(before ?? '') - 1);
  await expect(summary(page)).not.toHaveText(before ?? '');
  await expect(cardHeading(page)).toHaveText('TESCO STORES');

  await select.selectOption({ label: "Use bucket's category (none)" });
  await expect(june).toHaveText('Jun 2026£960.30, unusual');
  await expect(summary(page)).toHaveText(before ?? '');
  expect(await readStore(page, 'overrides')).toHaveLength(0);

  await june.click();
  await expect(june).toHaveAttribute('aria-pressed', 'false');
  await expect(rows).toHaveCount(0);
  // The next card starts with no month pressed.
  await june.click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(cardHeading(page)).not.toHaveText('TESCO STORES');
  await expect(card(page).locator('.month-cells button[aria-pressed="true"]')).toHaveCount(0);
});

test('merge from related', async ({ page }) => {
  await importFiles(page, {
    files: ['bank-a-current-2026-10-reexport.csv'], account: { existing: 'Bank A current' }, review: 'both',
  });
  await openCategorise(page);
  await skipToCard(page, 'TESCO STORES');
  const count = txnCount(await summary(page).textContent());
  const related = section(page, 'Looks related');
  await expect(related.getByRole('listitem')).toHaveCount(1);
  await expect(related.getByRole('listitem')).toContainText('TESCO STORE');
  await related.getByRole('button', { name: 'Merge into this' }).click();
  await expect(related).toHaveCount(0);
  await expect(cardHeading(page)).toHaveText('TESCO STORES');
  expect(txnCount(await summary(page).textContent())).toBe(count + 1);
  const tesco = (await readStore(page, 'buckets')).filter((b) => b.keys.some((k) => k.startsWith('TESCO')));
  expect(tesco).toHaveLength(1);
  expect(tesco[0].keys.sort()).toEqual(['TESCO STORE', 'TESCO STORES']);
});

test('axe passes on the card', async ({ page }) => {
  await openCategorise(page);
  await expectNoAxeViolations(page);
  await section(page, 'Each month').getByRole('button', { name: /^Jun 2026/ }).click();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'New category…' }).click();
  await expectNoAxeViolations(page);
  // TESCO STORES comes before PAYPAL PAYMENT in the queue.
  await skipToCard(page, 'TESCO STORES');
  await section(page, 'Unusual amounts').getByRole('button', { name: 'Move to another category…' }).click();
  await expectNoAxeViolations(page);
  await skipToCard(page, 'PAYPAL PAYMENT');
  await section(page, 'Repeating amounts').getByRole('button', { name: 'Make this its own bucket' }).first().click();
  await expectNoAxeViolations(page);
  await card(page).getByLabel('Bucket name').fill('Google One storage');
  await card(page).getByRole('button', { name: 'Make bucket' }).click();
  await expect(section(page, 'Flagged')).toBeVisible();
  await expectNoAxeViolations(page);
});
