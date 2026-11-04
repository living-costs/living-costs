// The Typical month screen's notices and edge states, each built through the real import UI from
// small made-up CSVs written at test time. Independent of the shared fixture page in typical.spec.js.
/** @import {Page, TestInfo} from '@playwright/test' */
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations, importFiles, openScreen } from './helpers.js';

const SAVINGS_HEADER = 'Transaction Date,Transaction Type,Transaction Description,Amount,Balance';
const BANK_B_HEADER = 'Date,Details,Transaction Type,In,Out,Balance';

/**
 * Write a made-up CSV into this test's output folder.
 * @param {TestInfo} testInfo
 * @param {string} name
 * @param {string[]} lines header first
 * @returns {string} absolute path
 */
function writeCsv(testInfo, name, lines) {
  const file = testInfo.outputPath(name);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

/** One made-up row per month: a purchase on the 10th, `months` as MM/YYYY. Savings columns. */
const savingsRows = (months) => months.map((m, i) => `10/${m},null,MADE UP SHOP,-${20 + i}.00,${1000 - i}.00`);
/** The same for the Bank B columns (money out). */
const bankBRows = (months) => months.map((m, i) => `12/${m},MADE UP GROCER,Card,,${30 + i}.00,${900 - i}.00`);

/** @param {Page} page */
const screenHeading = (page) => page.locator('#screen h2');

test.beforeEach(async ({ page }) => {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(screenHeading(page)).toHaveText('Help');
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('empty: nothing to show, with Go to Accounts', async ({ page }) => {
  await openScreen(page, 'Typical month');
  await expect(page.getByText('Nothing to show yet. Add your statements on the Accounts screen first.')).toBeVisible();
  await expect(page.locator('#typical-window')).toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Go to Accounts' }).click();
  await expect(screenHeading(page)).toHaveText('Accounts');
});

test('fewer complete months than the window, and a stale account', async ({ page }, testInfo) => {
  // Main covers Jan to Mar 2026 whole. Joint stops at the end of Feb, so Mar is still complete
  // (Joint has no coverage after it) and Joint is stale.
  const main = writeCsv(testInfo, 'made-up-main.csv', [SAVINGS_HEADER, ...savingsRows(['01/2026', '02/2026', '03/2026'])]);
  const joint = writeCsv(testInfo, 'made-up-joint.csv', [BANK_B_HEADER, ...bankBRows(['01/2026', '02/2026'])]);
  await importFiles(page, {
    files: [main], account: { new: { name: 'Main', kind: 'bank' }, mapping: 'savings' }, covers: ['01/01/2026', '31/03/2026'],
  });
  await importFiles(page, {
    files: [joint], account: { new: { name: 'Joint', kind: 'bank' }, mapping: 'bankB' }, covers: ['01/01/2026', '28/02/2026'],
  });
  await openScreen(page, 'Typical month');

  await expect(page.locator('#typical-window')).toHaveText('Based on 3 complete months, Jan 2026 to Mar 2026');
  await expect(page.getByText('Only 3 complete months so far. Yearly figures are scaled to 12 months.', { exact: true }))
    .toBeVisible();
  await expect(page.getByText("Joint has no statements after 28/02/2026. Its spending there isn't included.", { exact: true }))
    .toBeVisible();
  await expect(page.getByText('Main has no statements after')).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('no complete months yet', async ({ page }, testInfo) => {
  // Two rows inside January, with the covered period left at their dates, so no month is whole.
  const file = writeCsv(testInfo, 'made-up-partial.csv', [
    SAVINGS_HEADER, '10/01/2026,null,MADE UP SHOP,-12.00,500.00', '20/01/2026,null,MADE UP SHOP,-14.00,486.00',
  ]);
  await importFiles(page, { files: [file], account: { new: { name: 'Partial', kind: 'bank' }, mapping: 'savings' } });
  await openScreen(page, 'Typical month');
  await expect(page.locator('#typical-window'))
    .toHaveText('No complete months yet. These figures use every month with transactions, Jan 2026.');
  await expect(page.getByText('complete months so far')).toHaveCount(0);
  await expect(page.locator('#typical-window')).not.toContainText('Based on');
  await expectNoAxeViolations(page);
});

test('mixed currencies are not added together', async ({ page }, testInfo) => {
  const gbp = writeCsv(testInfo, 'made-up-gbp.csv', [SAVINGS_HEADER, ...savingsRows(['01/2026', '02/2026'])]);
  const eur = writeCsv(testInfo, 'made-up-eur.csv', [BANK_B_HEADER, ...bankBRows(['01/2026', '02/2026'])]);
  await importFiles(page, {
    files: [gbp], account: { new: { name: 'Pounds', kind: 'bank' }, mapping: 'savings' }, covers: ['01/01/2026', '28/02/2026'],
  });
  await importFiles(page, {
    files: [eur], account: { new: { name: 'Euros', kind: 'bank', currency: 'EUR' }, mapping: 'bankB' },
    covers: ['01/01/2026', '28/02/2026'],
  });
  await openScreen(page, 'Typical month');
  await expect(page.getByText("Your accounts use more than one currency (EUR, GBP). Budgie doesn't add them together.", { exact: true }))
    .toBeVisible();
  // Only the message: no window, summary, tables or uncategorised line.
  await expect(page.locator('#typical-window')).toHaveCount(0);
  await expect(page.locator('dl.summary')).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.locator('#typical-uncategorised')).toHaveCount(0);
  await expectNoAxeViolations(page);
});
