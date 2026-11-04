import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations, importFiles, readStore, fixturePath } from './helpers.js';

const expected = JSON.parse(fs.readFileSync(fixturePath('expected.json'), 'utf8'));

const BANK_A = { new: { name: 'Bank A current', kind: 'bank' }, mapping: 'bankA' };
const SAVINGS = { new: { name: 'Bank A savings', kind: 'bank' }, mapping: 'savings' };
const CARD = { new: { name: 'Credit card', kind: 'card' }, mapping: 'card' };
const BANK_B = { new: { name: 'Bank B joint', kind: 'bank' }, mapping: 'bankB' };

/** @param {import('@playwright/test').Page} page */
const screenHeading = (page) => page.locator('#screen h2');
/** @param {import('@playwright/test').Page} page */
const suggested = (page) => page.getByRole('table', { name: 'Suggested transfers' });
/** @param {import('@playwright/test').Page} page */
const confirmed = (page) => page.getByRole('table', { name: 'Confirmed transfers' });
/** @param {import('@playwright/test').Page} page */
const notTransfers = (page) => page.getByRole('table', { name: 'Not transfers' });
/** Body rows of a table (the header row has no cells). */
const bodyRows = (table) => table.getByRole('row').filter({ has: table.page().getByRole('cell') });

/** @param {import('@playwright/test').Page} page @param {string} name */
async function openScreen(page, name) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
  await expect(screenHeading(page)).toHaveText(name);
}

test.beforeEach(async ({ page }) => {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(screenHeading(page)).toHaveText('Help');
  await importFiles(page, { files: ['bank-a-current.csv'], account: BANK_A });
  await importFiles(page, { files: ['bank-a-savings.csv'], account: SAVINGS });
  await importFiles(page, { files: ['card.csv'], account: CARD });
  await importFiles(page, { files: ['bank-b-2026-08.csv', 'bank-b-2026-09.csv', 'bank-b-2026-10.csv'], account: BANK_B });
  await openScreen(page, 'Transfers');
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('confirm all', async ({ page }) => {
  await expect(bodyRows(suggested(page))).toHaveCount(expected.transferPairs);
  await expect(confirmed(page)).toHaveCount(0);
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Confirm all' }).click();
  await expect(suggested(page)).toHaveCount(0);
  await expect(page.getByText('No suggestions.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Suggested transfers' })).toBeFocused();
  await expect(bodyRows(confirmed(page))).toHaveCount(expected.transferPairs);
  const pairs = await readStore(page, 'transferPairs');
  expect(pairs).toHaveLength(expected.transferPairs);
  expect(pairs.every((p) => p.status === 'confirmed')).toBe(true);
  await expectNoAxeViolations(page);

  // Undo takes one back out, and it is suggested again; focus moves to the next Undo.
  const firstUndo = bodyRows(confirmed(page)).first().getByRole('button', { name: /^Undo/ });
  const secondUndoName = await bodyRows(confirmed(page)).nth(1).getByRole('button', { name: /^Undo/ }).getAttribute('aria-label');
  await firstUndo.click();
  await expect(bodyRows(confirmed(page))).toHaveCount(expected.transferPairs - 1);
  await expect(bodyRows(suggested(page))).toHaveCount(1);
  await expect(page.getByRole('button', { name: secondUndoName, exact: true })).toBeFocused();
  expect(await readStore(page, 'transferPairs')).toHaveLength(expected.transferPairs - 1);
});

test('reject one', async ({ page }) => {
  const first = bodyRows(suggested(page)).first();
  const text = await first.textContent();
  const nextReject = await bodyRows(suggested(page)).nth(1).getByRole('button', { name: /^Not a transfer/ }).getAttribute('aria-label');
  await first.getByRole('button', { name: /^Not a transfer/ }).click();
  await expect(bodyRows(suggested(page))).toHaveCount(expected.transferPairs - 1);
  await expect(bodyRows(suggested(page)).filter({ hasText: text ?? '' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: nextReject, exact: true })).toBeFocused();
  expect((await readStore(page, 'transferPairs')).map((p) => p.status)).toEqual(['rejected']);

  // Confirm one: it moves to Confirmed transfers.
  await bodyRows(suggested(page)).first().getByRole('button', { name: /^Confirm/ }).click();
  await expect(bodyRows(suggested(page))).toHaveCount(expected.transferPairs - 2);
  await expect(bodyRows(confirmed(page))).toHaveCount(1);

  await page.reload();
  await openScreen(page, 'Transfers');
  await expect(bodyRows(suggested(page))).toHaveCount(expected.transferPairs - 2);
  await expect(bodyRows(suggested(page)).filter({ hasText: text ?? '' })).toHaveCount(0);
  await expect(bodyRows(confirmed(page))).toHaveCount(1);
});

test('not a transfer, then undo, suggests the pair again', async ({ page }) => {
  const notSection = page.getByRole('region', { name: 'Not transfers', exact: true });
  await expect(notSection.getByText('None yet.')).toBeVisible();
  const first = bodyRows(suggested(page)).first();
  const cells = await first.getByRole('cell').allTextContents();
  const label = /** @type {string} */ (await first.getByRole('button', { name: /^Not a transfer/ }).getAttribute('aria-label'));
  const words = label.replace(/^Not a transfer: /, '');
  await first.getByRole('button', { name: /^Not a transfer/ }).click();
  await expect(bodyRows(suggested(page))).toHaveCount(expected.transferPairs - 1);

  // It is listed under Not transfers, in the same columns as Confirmed transfers.
  await expect(bodyRows(notTransfers(page))).toHaveCount(1);
  const row = bodyRows(notTransfers(page)).first();
  await expect(row.getByRole('cell')).toHaveText([...cells.slice(0, 7), 'Undo']);
  await expect(notTransfers(page).getByRole('columnheader')).toHaveText([
    'From date', 'From account', 'From description', 'Amount', 'To date', 'To account', 'To description', 'Undo',
  ]);
  await expectNoAxeViolations(page);

  // Undo forgets the decision, so the pair is suggested again.
  await row.getByRole('button', { name: `Undo ${words}`, exact: true }).click();
  await expect(notTransfers(page)).toHaveCount(0);
  await expect(notSection.getByText('None yet.')).toBeVisible();
  await expect(bodyRows(suggested(page))).toHaveCount(expected.transferPairs);
  await expect(bodyRows(suggested(page)).first().getByRole('cell')).toHaveText([...cells.slice(0, 7), /Confirm/]);
  await expect(page.getByRole('heading', { name: 'Not transfers' })).toBeFocused();
  expect(await readStore(page, 'transferPairs')).toEqual([]);
});

test('placeholder', async ({ page }) => {
  const cards = page.getByRole('region', { name: "Cards you don't import" });
  await expect(cards.getByText('None yet.')).toBeVisible();

  // Both fields are needed.
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByText('Choose the bucket your repayments to this card are in.')).toBeVisible();
  await expect(page.getByText("Enter the card's name.")).toBeVisible();
  await expect(page.getByLabel('Repayment bucket')).toBeFocused();
  await expectNoAxeViolations(page);

  await page.getByLabel('Repayment bucket').selectOption({ label: 'OTHER CARD PLC' });
  await page.getByLabel('Card name').fill('  Other Card  ');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(cards.getByRole('status')).toHaveText('Added Other Card.');
  const row = cards.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Other Card', exact: true }) });
  await expect(row).toContainText('OTHER CARD PLC');
  await expect(row).toContainText('GBP');
  // The bucket is linked now, so it is not offered again.
  await expect(page.getByLabel('Repayment bucket').getByRole('option', { name: 'OTHER CARD PLC' })).toHaveCount(0);
  await expectNoAxeViolations(page);

  const accounts = await readStore(page, 'accounts');
  const placeholder = accounts.find((a) => a.kind === 'placeholder');
  expect(placeholder).toMatchObject({ name: 'Other Card', currency: 'GBP' });
  expect(placeholder.repaymentBucketIds).toHaveLength(1);

  await openScreen(page, 'Categories');
  await expect(page.getByRole('table', { name: 'Your categories' })
    .getByRole('rowheader', { name: 'Other Card (not itemised)', exact: true })).toBeVisible();

  await openScreen(page, 'Accounts');
  const byMonth = page.getByRole('table', { name: 'Accounts by month' });
  const cells = byMonth.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Other Card', exact: true }) }).getByRole('cell');
  await expect(cells.first()).toHaveText('Not itemised');
  expect(new Set(await cells.allTextContents())).toEqual(new Set(['Not itemised']));
});
