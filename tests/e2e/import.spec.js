import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  expectNoAxeViolations, trackCspViolations, importFiles, pickFiles, chooseAccount, fillMapping,
  confirmPeriods, answerReview, stepHeading, fixturePath, readStore,
} from './helpers.js';

const expected = JSON.parse(fs.readFileSync(fixturePath('expected.json'), 'utf8'));

/** Rows in a fixture whose first cell is a date in the given MM/YYYY. */
const rowsIn = (file, monthYear) => fs.readFileSync(fixturePath(file), 'utf8')
  .split(/\r?\n/).filter((line) => line.replace(/^"/, '').slice(3, 10) === monthYear).length;

/** Today as DD/MM/YYYY, local time. */
const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const overflow = (page) => page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);

/** The accounts-by-month cell for one account and month (e.g. "Nov 2025"). */
async function monthCell(page, account, month) {
  const table = page.getByRole('table', { name: 'Accounts by month' });
  const headers = await table.getByRole('columnheader').allTextContents();
  const i = headers.indexOf(month);
  expect(i).toBeGreaterThan(0);
  return table.getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: account, exact: true }) })
    .getByRole('cell').nth(i - 1);
}

/** The row for one imported batch in the accounts list. */
const batchRow = (page, fileName) => page.getByRole('row').filter({ hasText: fileName });

const BANK_A = { new: { name: 'Bank A current', kind: 'bank' }, mapping: 'bankA' };
const BANK_B = { new: { name: 'Bank B joint', kind: 'bank' }, mapping: 'bankB' };

test.beforeEach(async ({ page }) => {
  await trackCspViolations(page);
  await page.addInitScript(() => {
    window.__persist = 0;
    if (navigator.storage) {
      navigator.storage.persist = () => { window.__persist++; return Promise.resolve(false); };
    }
  });
  await page.goto('./');
  await expect(page.locator('#screen h2')).toHaveText('Help');
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('imports Bank A with a new mapping', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: 'Import a statement' }).click();
  await expect(stepHeading(page, 'Choose files')).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);

  await pickFiles(page, ['bank-a-current.csv']);
  await expect(page.getByRole('group', { name: 'Which account is this?' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
  await chooseAccount(page, { new: {} });

  await expect(stepHeading(page, 'Set up columns')).toBeVisible();
  await expect(page.getByLabel('Currency')).toHaveValue('GBP');
  await expect(page.getByLabel('Kind', { exact: true }).locator('option')).toHaveText(['Bank', 'Card', 'Savings']);
  await expect(page.getByLabel('Date column').locator('option')).toContainText([
    'Transaction Date', 'Transaction Type', 'Sort Code', 'Account Number',
    'Transaction Description', 'Debit Amount', 'Credit Amount', 'Balance',
  ]);
  await expect(page.getByLabel('Date format').locator('option')).toHaveText(['DD/MM/YYYY']);
  const preview = page.getByRole('table', { name: 'Preview' });
  await expect(preview).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);

  await fillMapping(page, BANK_A.new, 'bankA', { submit: false });
  // The Amount cell of the ACME LETTINGS row, matched exactly so a sign change is caught.
  const acmeAmount = preview.getByRole('row').filter({ hasText: 'ACME LETTINGS' }).getByRole('cell').nth(2);
  await expect(acmeAmount).toHaveText('-£900.00');
  await expect(preview.getByRole('row')).toHaveCount(6);
  // Live: switching to a single column with the wrong sign flips the preview at once.
  await page.getByRole('radio', { name: 'One signed column' }).check();
  await page.getByLabel('Amount column').selectOption({ label: 'Debit Amount' });
  await expect(acmeAmount).toHaveText('£900.00');
  const flip = page.getByLabel('Purchases are positive');
  await flip.check();
  await expect(acmeAmount).toHaveText('-£900.00');
  // The checkbox is centred on its label, and its hint is linked and starts under the label text.
  await expect(flip).toHaveAccessibleDescription('Tick this for card files that show spending as positive amounts.');
  const box = /** @type {{x: number, y: number, width: number, height: number}} */ (await flip.boundingBox());
  const label = /** @type {{x: number, y: number, width: number, height: number}} */ (
    await page.locator('label', { has: flip }).boundingBox());
  const hint = /** @type {{x: number, y: number, width: number, height: number}} */ (
    await page.locator('.help', { hasText: 'Tick this for card files' }).boundingBox());
  expect(Math.abs((box.y + box.height / 2) - (label.y + label.height / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(hint.x - (box.x + box.width + 8))).toBeLessThanOrEqual(1);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
  await fillMapping(page, BANK_A.new, 'bankA');

  await expect(stepHeading(page, 'Covered period')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^From/ })).toHaveValue('01/11/2025');
  await expect(page.getByRole('textbox', { name: /^To/ })).toHaveValue('31/10/2026');
  await expect(page.getByRole('textbox', { name: 'From, bank-a-current.csv' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
  await confirmPeriods(page);

  await expect(stepHeading(page, 'Summary')).toBeVisible();
  const rows = expected.rowCounts['bank-a-current.csv'];
  await expect(page.getByText(`Total: ${rows} new, 0 already imported, 0 to review`)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  await expect(page.getByLabel('Choose CSV files')).toBeVisible();
  await expect(page.locator('#screen h2')).toHaveText('Accounts');
  await expect(batchRow(page, 'bank-a-current.csv')).toContainText(String(rows));
  await expect(batchRow(page, 'bank-a-current.csv')).toContainText('01/11/2025 to 31/10/2026');
  await expect(await monthCell(page, 'Bank A current', 'Nov 2025'))
    .toHaveText(`✓ ${rowsIn('bank-a-current.csv', '11/2025')}`);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
});

test('asks for persistent storage after the first import only', async ({ page }) => {
  expect(await page.evaluate(() => window.__persist)).toBe(0);
  await importFiles(page, { files: ['bank-b-2026-08.csv'], account: BANK_B });
  expect(await page.evaluate(() => window.__persist)).toBe(1);
  await importFiles(page, { files: ['bank-b-2026-09.csv'], account: { existing: 'Bank B joint' } });
  expect(await page.evaluate(() => window.__persist)).toBe(1);
});

test('blocks the same file twice', async ({ page }) => {
  await importFiles(page, { files: ['bank-b-2026-08.csv'], account: BANK_B });
  await pickFiles(page, ['bank-b-2026-08.csv']);
  await expect(page.getByText(`"bank-b-2026-08.csv" was already imported on ${today()} into Bank B joint.`))
    .toBeVisible();
  await expect(stepHeading(page, 'Choose files')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Which account is this?' })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // One blocked file in a pick doesn't stop the rest.
  await pickFiles(page, ['bank-b-2026-08.csv', 'bank-b-2026-09.csv']);
  await expect(page.getByText('"bank-b-2026-08.csv" was already imported on')).toBeVisible();
  await chooseAccount(page, { existing: 'Bank B joint' });
  await confirmPeriods(page);
  await answerReview(page);
  await expect(page.getByText('Total: 8 new, 0 already imported, 0 to review')).toBeVisible();
});

test('suggests the matching account', async ({ page }) => {
  await importFiles(page, { files: ['bank-a-current.csv'], account: BANK_A });
  await importFiles(page, { files: ['bank-b-2026-08.csv'], account: BANK_B });

  await pickFiles(page, ['bank-a-current-2026-10-reexport.csv']);
  const group = page.getByRole('group', { name: 'Which account is this?' });
  await expect(group.getByRole('radio')).toHaveCount(3);
  await expect(group.getByText(/^Bank A current \(matches these columns\)$/)).toBeVisible();
  await expect(group.locator('label')).toHaveText([
    'Bank A current (matches these columns)', 'Bank B joint', 'New account',
  ]);
  await expectNoAxeViolations(page);
  await chooseAccount(page, { existing: 'Bank A current' });

  await confirmPeriods(page);
  await expect(stepHeading(page, 'Check possible duplicates')).toBeVisible();
  const cont = page.getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  await expect(page.getByRole('group').filter({ hasText: 'TESCO STORE 2041' }).first()).toBeVisible();
  await expect(page.getByText('CARD PURCHASE TESCO STORES 2041').first()).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Same transaction' })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'Both are real' })).not.toBeChecked();
  await expectNoAxeViolations(page);
  await page.getByRole('radio', { name: 'Same transaction' }).check();
  await expect(cont).toBeEnabled();
  await cont.click();

  const { new: fresh, already, review } = expected.reexport;
  await expect(stepHeading(page, 'Summary')).toBeVisible();
  await expect(page.getByText(`Total: ${fresh} new, ${already} already imported, ${review} to review`)).toBeVisible();
  await expect(page.getByText(`bank-a-current-2026-10-reexport.csv: ${fresh} new, ${already} already imported, ${review} to review`))
    .toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(batchRow(page, 'bank-a-current-2026-10-reexport.csv')).toContainText('01/10/2026 to 02/11/2026');
});

test('three monthly files in one pick', async ({ page }) => {
  const files = ['bank-b-2026-08.csv', 'bank-b-2026-09.csv', 'bank-b-2026-10.csv'];
  await pickFiles(page, files);
  await chooseAccount(page, BANK_B);
  await fillMapping(page, BANK_B.new, 'bankB');
  await expect(page.getByRole('button', { name: /^Whole month/ })).toHaveText([
    'Whole month (Aug 2026)', 'Whole month (Sep 2026)', 'Whole month (Oct 2026)',
  ]);
  await confirmPeriods(page, 'whole-month');
  await expect(page.getByText('Total: 25 new, 0 already imported, 0 to review')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();

  for (const f of files) await expect(batchRow(page, f)).toHaveCount(1);
  await expect(batchRow(page, 'bank-b-2026-08.csv')).toContainText('01/08/2026 to 31/08/2026');
  await expect(await monthCell(page, 'Bank B joint', 'Aug 2026')).toHaveText(`✓ ${expected.rowCounts['bank-b-2026-08.csv']}`);
  await expect(await monthCell(page, 'Bank B joint', 'Sep 2026')).toHaveText(`✓ ${expected.rowCounts['bank-b-2026-09.csv']}`);
  await expectNoAxeViolations(page);

  // Undo asks first. Declined, nothing is removed.
  /** @type {string[]} */
  const dialogs = [];
  let accept = false;
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await (accept ? dialog.accept() : dialog.dismiss());
  });
  const sep = expected.rowCounts['bank-b-2026-09.csv'];
  await page.getByRole('button', { name: 'Undo bank-b-2026-09.csv' }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toBe(`confirm: Remove the ${sep} transactions from bank-b-2026-09.csv? You can import the file again later.`);
  await expect(batchRow(page, 'bank-b-2026-09.csv')).toHaveCount(1);
  await expect(await monthCell(page, 'Bank B joint', 'Sep 2026')).toHaveText(`✓ ${sep}`);
  expect((await readStore(page, 'batches')).length).toBe(3);
  expect((await readStore(page, 'transactions')).length).toBe(25);

  // Accepted: its month goes missing, and the other two stay.
  accept = true;
  await page.getByRole('button', { name: 'Undo bank-b-2026-09.csv' }).click();
  await expect(batchRow(page, 'bank-b-2026-09.csv')).toHaveCount(0);
  await expect(await monthCell(page, 'Bank B joint', 'Sep 2026')).toHaveText('Missing');
  expect((await readStore(page, 'transactions')).length).toBe(25 - sep);

  await page.getByRole('button', { name: /^Undo this import/ }).click();
  await expect.poll(() => dialogs.length).toBe(3);
  expect(dialogs[2]).toBe(`confirm: Remove the ${25 - sep} transactions from bank-b-2026-08.csv, bank-b-2026-10.csv? You can import the files again later.`);
  for (const f of files) await expect(batchRow(page, f)).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Accounts by month' })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // The hashes went with the batches, so the files can be imported again.
  await importFiles(page, { files, account: { existing: 'Bank B joint' } });
  for (const f of files) await expect(batchRow(page, f)).toHaveCount(1);
});

test('Import is disabled as soon as it is clicked, so a double click imports once', async ({ page }) => {
  await pickFiles(page, ['bank-a-current.csv']);
  await chooseAccount(page, BANK_A);
  await fillMapping(page, BANK_A.new, 'bankA');
  await confirmPeriods(page);
  await expect(stepHeading(page, 'Summary')).toBeVisible();
  const disabledAfterClick = await page.getByRole('button', { name: 'Import', exact: true }).evaluate((b) => {
    /** @type {HTMLButtonElement} */ (b).click();
    const disabled = /** @type {HTMLButtonElement} */ (b).disabled;
    b.click();
    return disabled;
  });
  expect(disabledAfterClick).toBe(true);
  await expect(batchRow(page, 'bank-a-current.csv')).toHaveCount(1);
  expect((await readStore(page, 'batches')).length).toBe(1);
});

test('refuses mixed formats', async ({ page }) => {
  await pickFiles(page, ['card.csv', 'bank-b-2026-08.csv']);
  await expect(page.getByText('has different columns')).toBeVisible();
  await expect(stepHeading(page, 'Choose files')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Which account is this?' })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('warns when the columns do not match the chosen account', async ({ page }) => {
  await importFiles(page, { files: ['bank-b-2026-08.csv'], account: BANK_B });
  await pickFiles(page, ['card.csv']);
  await chooseAccount(page, { existing: 'Bank B joint' });
  await expect(page.getByText("These columns don't match Bank B joint's saved setup.")).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Choose again' }).click();
  await chooseAccount(page, { existing: 'Bank B joint' });
  await page.getByRole('button', { name: 'Import anyway' }).click();
  await expect(page.getByText('"card.csv" can\'t be imported: Missing column: Date')).toBeVisible();
  await expect(page.getByText('No files are left to import.')).toBeVisible();
  await expect(stepHeading(page, 'Choose files')).toBeVisible();
  await expect(batchRow(page, 'card.csv')).toHaveCount(0);
});

test('savings covered period can be widened', async ({ page }) => {
  await pickFiles(page, ['bank-a-savings.csv']);
  await chooseAccount(page, { new: {} });
  await fillMapping(page, { name: 'Savings', kind: 'bank' }, 'savings');
  await expect(stepHeading(page, 'Covered period')).toBeVisible();
  const from = page.getByRole('textbox', { name: /^From/ });
  await expect(from).toHaveValue('27/11/2025');

  await from.fill('31/02/2026');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter a real date as DD/MM/YYYY.')).toBeVisible();
  await expect(from).toHaveAttribute('aria-invalid', 'true');
  await expectNoAxeViolations(page);
  await from.fill('01/12/2026');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('From must be on or before To.')).toBeVisible();

  await confirmPeriods(page, ['01/11/2025', '31/10/2026']);
  await expect(stepHeading(page, 'Summary')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(batchRow(page, 'bank-a-savings.csv')).toContainText('01/11/2025 to 31/10/2026');
  await expect(await monthCell(page, 'Savings', 'Nov 2025'))
    .toHaveText(`✓ ${rowsIn('bank-a-savings.csv', '11/2025')}`);
});

test('lists parse errors', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('bank-b-bad.csv');
  fs.writeFileSync(file, 'Date,Details,Transaction Type,In,Out,Balance\n01/08/2026,X,Card Transaction,,1,234.00,0.00\n');

  // Cancel abandons the pick.
  await pickFiles(page, [file]);
  await chooseAccount(page, BANK_B);
  await fillMapping(page, BANK_B.new, 'bankB');
  await expect(stepHeading(page, 'Problems')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(stepHeading(page, 'Choose files')).toBeVisible();

  await pickFiles(page, [file]);
  await chooseAccount(page, BANK_B);
  await fillMapping(page, BANK_B.new, 'bankB');
  await expect(stepHeading(page, 'Problems')).toBeVisible();
  const problems = page.getByRole('table', { name: 'Rows that can\'t be read' });
  await expect(problems.getByRole('columnheader')).toHaveText(['File', 'Row', 'Problem']);
  await expect(problems.getByRole('row').nth(1).getByRole('cell')).toHaveText([
    'bank-b-bad.csv', '2', 'Expected 6 fields, found 7',
  ]);
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Skip these rows' }).click();

  await expect(page.getByText('No rows are left to import.')).toBeVisible();
  await expect(stepHeading(page, 'Choose files')).toBeVisible();
  await expect(page.getByText('No accounts yet.')).toBeVisible();
  await expect(batchRow(page, 'bank-b-bad.csv')).toHaveCount(0);
});

test('HTML in a description is shown as text', async ({ page }, testInfo) => {
  await importFiles(page, { files: ['bank-a-current.csv'], account: BANK_A });
  await expect(page.locator('#screen b')).toHaveCount(0);

  // A second export whose row differs only in text: the stored row comes back as a candidate.
  const file = testInfo.outputPath('bank-a-bold.csv');
  const header = fs.readFileSync(fixturePath('bank-a-current.csv'), 'utf8').split('\r\n')[0];
  fs.writeFileSync(file, `${header}\r\n09/05/2026,DEB,'11-22-33,12345678,CARD PURCHASE <b>BOLD</b> SHOP 2,9.99,,100.00\r\n`);
  await pickFiles(page, [file]);
  await chooseAccount(page, { existing: 'Bank A current' });
  await confirmPeriods(page);
  await expect(stepHeading(page, 'Check possible duplicates')).toBeVisible();
  await expect(page.getByText('CARD PURCHASE <b>BOLD</b> SHOP', { exact: true })).toBeVisible();
  await expect(page.getByText('CARD PURCHASE <b>BOLD</b> SHOP 2', { exact: true })).toBeVisible();
  await expect(page.locator('#screen b')).toHaveCount(0);

  // And in a new account's preview.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await pickFiles(page, [file]);
  await chooseAccount(page, { new: {} });
  await expect(page.getByRole('table', { name: 'Preview' })).toHaveCount(0);
  await fillMapping(page, { name: 'Bold', kind: 'bank' }, 'bankA', { submit: false });
  await expect(page.getByRole('table', { name: 'Preview' }).getByText('CARD PURCHASE <b>BOLD</b> SHOP 2')).toBeVisible();
  await expect(page.locator('#screen b')).toHaveCount(0);
});

test('home after data', async ({ page }) => {
  await importFiles(page, { files: ['bank-b-2026-08.csv'], account: BANK_B });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Help' }).click();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#screen h2')).toHaveText('Typical month');
});

test('a re-download with nothing new creates no batch', async ({ page }, testInfo) => {
  await importFiles(page, { files: ['bank-b-2026-08.csv'], account: BANK_B });
  // Same rows, different bytes, so the hash check lets it through and the rows are matched instead.
  const file = testInfo.outputPath('bank-b-2026-08-again.csv');
  fs.writeFileSync(file, `${fs.readFileSync(fixturePath('bank-b-2026-08.csv'), 'utf8')}\n`);
  await pickFiles(page, [file]);
  await chooseAccount(page, { existing: 'Bank B joint' });
  await confirmPeriods(page);
  await expect(stepHeading(page, 'Summary')).toBeVisible();
  await expect(page.getByText('Total: 0 new, 9 already imported, 0 to review')).toBeVisible();
  await expect(page.getByText('Nothing new to import.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(batchRow(page, 'bank-b-2026-08-again.csv')).toHaveCount(0);
  await expect(batchRow(page, 'bank-b-2026-08.csv')).toHaveCount(1);
});

/** Batches saved in IndexedDB, read directly (the accounts list is hidden during a flow). */
const storedBatches = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('living-costs');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const get = db.transaction('batches', 'readonly').objectStore('batches').getAll();
    get.onsuccess = () => { db.close(); resolve(get.result.map((b) => ({ fileName: b.fileName, rowCount: b.rowCount }))); };
    get.onerror = () => reject(get.error);
  };
}));

test('re-plans when data changed after the summary', async ({ page }) => {
  await pickFiles(page, ['bank-a-current.csv']);
  await chooseAccount(page, BANK_A);
  await fillMapping(page, BANK_A.new, 'bankA');
  await confirmPeriods(page);
  await expect(stepHeading(page, 'Summary')).toBeVisible();

  // Change data through the app's own store, mid-flow: leave, dismiss Help (a settings put), come back.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Accounts' }).click();
  await expect(stepHeading(page, 'Summary')).toBeVisible();

  const rows = expected.rowCounts['bank-a-current.csv'];
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Your data changed, so the summary has been updated. Check it and import again.')).toBeVisible();
  await expect(stepHeading(page, 'Summary')).toBeVisible();
  await expect(page.getByText(`Total: ${rows} new, 0 already imported, 0 to review`)).toBeVisible();
  expect(await storedBatches(page)).toEqual([]);
  await expectNoAxeViolations(page);

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByLabel('Choose CSV files')).toBeVisible();
  await expect(batchRow(page, 'bank-a-current.csv')).toContainText(String(rows));
  expect(await storedBatches(page)).toEqual([{ fileName: 'bank-a-current.csv', rowCount: rows }]);
});
