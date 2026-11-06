// Stored data on load: older data is upgraded silently, current data is left as it is, and newer
// data is refused without being touched. Each test changes the stored rows, then reloads.
/** @import {Page} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import {
  trackCspViolations, setupFixtureApp, readStore, writeStore, patchSettings, expectNoAxeViolations,
} from './helpers.js';

const NEWER = 'Your data was saved by a newer version of this app. Reload the page to get it.';
const STORES = ['settings', 'accounts', 'batches', 'transactions', 'buckets', 'rules', 'categories', 'overrides', 'transferPairs'];
const WARNING = "A backup saved to Google Drive isn't encrypted. It holds every transaction you've imported: dates, amounts, descriptions and account details.";
const DELETE_CONFIRM = 'Delete all data in this browser? Save a backup first if you might want it.';
const FAILED = "Your saved data couldn't be upgraded to this version of the app. Nothing was changed.";

/** @param {Page} page */
const heading = (page) => page.locator('#screen h2');

/** The Per month cell of Subscriptions in the typical month's Living costs table. @param {Page} page */
const subscriptionsPerMonth = (page) => page.getByRole('table', { name: 'Living costs', exact: true }).getByRole('row')
  .filter({ has: page.getByRole('rowheader', { name: 'Subscriptions', exact: true }) }).getByRole('cell').nth(2);

test('version 1 data upgrades silently on load', async ({ page }) => {
  await trackCspViolations(page);
  await setupFixtureApp(page);
  const subscriptions = await subscriptionsPerMonth(page).textContent();
  const lastBackupAt = '2026-10-01T09:30:00.000Z';
  await patchSettings(page, { schemaVersion: 1, lastBackupAt });
  const rules = await readStore(page, 'rules');
  expect(rules.length).toBeGreaterThan(0);
  await writeStore(page, 'rules', rules.map((r) => ({ ...r, normaliserVersion: 1 })));
  const transactions = (await readStore(page, 'transactions')).length;

  await page.reload();
  await expect(heading(page)).toHaveText('Typical month');
  await expect(page.locator('#notices .banner')).toHaveCount(0);
  await expect(subscriptionsPerMonth(page)).toHaveText(/** @type {string} */ (subscriptions));

  const [settings] = await readStore(page, 'settings');
  expect(settings).toMatchObject({ schemaVersion: 2, lastBackupAt, helpDismissed: true });
  expect((await readStore(page, 'rules')).some((r) => 'normaliserVersion' in r)).toBe(false);
  expect(await readStore(page, 'transactions')).toHaveLength(transactions);
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
});

test('data with no settings row is treated as version 1', async ({ page }) => {
  await setupFixtureApp(page);
  const transactions = (await readStore(page, 'transactions')).length;
  await writeStore(page, 'settings', [], { clear: true });

  await page.reload();
  await expect(heading(page)).toHaveText('Help');
  expect(await readStore(page, 'transactions')).toHaveLength(transactions);
  const [settings] = await readStore(page, 'settings');
  expect(settings).toMatchObject({ id: 'settings', schemaVersion: 2 });
});

test('a current-version load does not rewrite the data', async ({ page }) => {
  await setupFixtureApp(page);
  const [first] = await readStore(page, 'transactions');
  await writeStore(page, 'transactions', [{ ...first, sentinel: 1 }]);

  await page.reload();
  await expect(heading(page)).toHaveText('Typical month');
  const after = (await readStore(page, 'transactions')).find((t) => t.id === first.id);
  expect(after).toEqual({ ...first, sentinel: 1 });
});

test('newer data is refused and left alone', async ({ page }) => {
  await setupFixtureApp(page);
  await patchSettings(page, { schemaVersion: 99 });
  const transactions = await readStore(page, 'transactions');
  const settings = await readStore(page, 'settings');

  await page.reload();
  await expect(heading(page)).toHaveText('The app could not start');
  await expect(page.locator('#screen')).toContainText(NEWER);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button')).toHaveCount(0);
  expect(await readStore(page, 'transactions')).toEqual(transactions);
  expect(await readStore(page, 'settings')).toEqual(settings);
});

test('a newer IndexedDB version is refused', async ({ page }) => {
  await setupFixtureApp(page);
  // The app's own connection closes itself on versionchange, so this open is not blocked.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('living-costs', 5);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
    req.onsuccess = () => { req.result.close(); resolve(undefined); };
  }));

  await page.reload();
  await expect(heading(page)).toHaveText('The app could not start');
  await expect(page.locator('#screen')).toContainText(NEWER);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button')).toHaveCount(0);
});

/** Init script: no file picker, so saving falls back to a download. */
const noPicker = () => { delete (/** @type {any} */ (window)).showSaveFilePicker; };

/** @param {Page} page */
const readAll = async (page) => Object.fromEntries(await Promise.all(STORES.map(async (n) => [n, await readStore(page, n)])));

/**
 * Load the fixture app, make the first batch's rowCount wrong (so the upgrade fails validation),
 * mark the data version 1 and reload.
 * @param {Page} page
 */
async function setupFailure(page) {
  await page.addInitScript(noPicker);
  await trackCspViolations(page);
  await setupFixtureApp(page);
  const [batch] = await readStore(page, 'batches');
  await writeStore(page, 'batches', [{ ...batch, rowCount: batch.rowCount + 1 }]);
  await patchSettings(page, { schemaVersion: 1 });
  const before = await readAll(page);
  await page.reload();
  await expect(heading(page)).toHaveText('The app could not start');
  return { before, batch };
}

/** @param {Page} page */
const saveCopy = (page) => page.getByRole('button', { name: 'Save a copy of your data', exact: true });
/** @param {Page} page */
const deleteButton = (page) => page.getByRole('button', { name: 'Delete all data and start afresh', exact: true });

test('an upgrade that fails shows the failure screen and changes nothing', async ({ page }) => {
  const { before } = await setupFailure(page);
  const screen = page.locator('#screen');
  await expect(screen).toContainText(FAILED);
  await expect(screen.getByText('Details:', { exact: true })).toBeVisible();
  await expect(screen.getByRole('listitem').filter({ hasText: 'row' }).first()).toBeVisible();
  await expect(screen.getByText(WARNING, { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button')).toHaveCount(0);
  expect(await readAll(page)).toEqual(before);
  await expectNoAxeViolations(page);
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
});

test('save a copy writes the data at its old version', async ({ page }, testInfo) => {
  const { before, batch } = await setupFailure(page);
  const [download] = await Promise.all([page.waitForEvent('download'), saveCopy(page).click()]);
  const iso = await page.evaluate(() => {
    const d = new Date();
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  expect(download.suggestedFilename()).toBe(`living-costs-backup-${iso}.json`);
  const file = testInfo.outputPath('copy.json');
  await download.saveAs(file);
  const copy = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(copy.schemaVersion).toBe(1);
  expect(copy.batches[0].rowCount).toBe(batch.rowCount + 1);
  expect(copy.transactions.length).toBeGreaterThan(0);
  await expect(page.getByRole('status')).toHaveText('Copy saved.');
  expect(await readAll(page)).toEqual(before);
});

test('a settings schemaVersion that is not a number also fails, and the copy says version 1', async ({ page }, testInfo) => {
  await page.addInitScript(noPicker);
  await setupFixtureApp(page);
  await patchSettings(page, { schemaVersion: 'two' });
  const before = await readAll(page);
  await page.reload();
  await expect(heading(page)).toHaveText('The app could not start');
  await expect(page.locator('#screen')).toContainText(FAILED);
  const [download] = await Promise.all([page.waitForEvent('download'), saveCopy(page).click()]);
  const file = testInfo.outputPath('copy.json');
  await download.saveAs(file);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).schemaVersion).toBe(1);
  expect(await readAll(page)).toEqual(before);
});

test('delete all data starts afresh', async ({ page }) => {
  const { before } = await setupFailure(page);
  const dialogs = [];
  let accept = false;
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await (accept ? dialog.accept() : dialog.dismiss());
  });
  await deleteButton(page).click();
  expect(dialogs).toEqual([`confirm: ${DELETE_CONFIRM}`]);
  await expect(heading(page)).toHaveText('The app could not start');
  expect(await readAll(page)).toEqual(before);

  accept = true;
  await deleteButton(page).click();
  await expect(heading(page)).toHaveText('Help');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button').first()).toBeVisible();
  const [settings] = await readStore(page, 'settings');
  expect(settings.schemaVersion).toBe(2);
  expect(await readStore(page, 'transactions')).toHaveLength(0);
  expect((await readStore(page, 'categories')).length).toBeGreaterThan(0);
});
