// Whole-app privacy and offline checks: after the first page load, nothing touches the network.
/** @import {Page} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import {
  trackRequests, trackCspViolations, importFiles, openScreen, readStore, cardHeading, FIXTURE_ACCOUNTS,
} from './helpers.js';

/** Every nav label, in nav order (src/ui/nav.js). */
const SCREENS = [
  'Help', 'Typical month', 'Categorise', 'Buckets', 'Transactions', 'Transfers', 'Accounts', 'Categories', 'Backup',
];

const WHOLE_YEAR = /** @type {[string, string]} */ (['01/11/2025', '31/10/2026']);

/** @param {Page} page */
const heading = (page) => page.locator('#screen h2');

/** Number of buckets that have a category. @param {Page} page */
const categorised = async (page) => (await readStore(page, 'buckets')).filter((b) => b.categoryId).length;

test('no requests after load', async ({ page }) => {
  // No file picker, so saving the backup falls back to a download.
  await page.addInitScript(() => { delete (/** @type {any} */ (window)).showSaveFilePicker; });
  await trackCspViolations(page);
  await page.goto('./');
  await expect(heading(page)).toHaveText('Help');
  const requests = trackRequests(page);

  // The six main fixture files.
  await importFiles(page, { files: ['bank-a-current.csv'], account: FIXTURE_ACCOUNTS.bankA, covers: WHOLE_YEAR });
  await importFiles(page, { files: ['bank-a-savings.csv'], account: FIXTURE_ACCOUNTS.savings, covers: WHOLE_YEAR });
  await importFiles(page, { files: ['card.csv'], account: FIXTURE_ACCOUNTS.card, covers: WHOLE_YEAR });
  await importFiles(page, {
    files: ['bank-b-2026-08.csv', 'bank-b-2026-09.csv', 'bank-b-2026-10.csv'], account: FIXTURE_ACCOUNTS.bankB, covers: 'whole-month',
  });
  await expect.poll(async () => (await readStore(page, 'batches')).length).toBe(6);

  // Categorise one bucket from the card.
  await openScreen(page, 'Categorise');
  const before = await categorised(page);
  const first = await cardHeading(page).textContent();
  await page.locator('#card').getByRole('group', { name: 'Category' }).getByRole('button').first().click();
  await expect(cardHeading(page)).not.toHaveText(String(first));
  await expect.poll(() => categorised(page)).toBe(before + 1);

  // Confirm the suggested transfers.
  await openScreen(page, 'Transfers');
  await page.getByRole('button', { name: 'Confirm all' }).click();
  await expect(page.getByText('No suggestions.')).toBeVisible();
  expect((await readStore(page, 'transferPairs')).length).toBeGreaterThan(0);

  for (const name of SCREENS) await openScreen(page, name);

  // Save a backup through the download fallback.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save backup', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^budgie-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByRole('status')).toHaveText('Backup saved.');

  expect(requests()).toEqual([]);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('works offline', async ({ page, context }) => {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(heading(page)).toHaveText('Help');
  await context.setOffline(true);

  await importFiles(page, { files: ['bank-a-current.csv'], account: FIXTURE_ACCOUNTS.bankA, covers: WHOLE_YEAR });
  await openScreen(page, 'Typical month');
  await expect(page.locator('#typical-window')).toHaveText('Based on 12 complete months, Nov 2025 to Oct 2026');
  await expect(page.locator('dl.summary dd').first()).toHaveText(/^£[\d,]+\.\d\d$/);
  await expect(page.locator('#typical-uncategorised')).toContainText(/£[1-9][\d,]*\.\d\d spending/);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});
