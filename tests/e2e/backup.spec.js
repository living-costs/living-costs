// The Backup screen: saving through the file picker or a download, and restoring a backup file.
/** @import {Page} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  expectNoAxeViolations, trackCspViolations, setupFixtureApp, openScreen, importFiles, FIXTURE_ACCOUNTS, readStore,
  pickFiles,
} from './helpers.js';
import defaults from '../../src/default-categories.js';
import { DATA_VERSION } from '../../src/version.js';

const CONFIRM = 'Replace all data in this browser with this backup?';
const WARNING = "A backup saved to Google Drive isn't encrypted. It holds every transaction you've imported: dates, amounts, descriptions and account details.";

/** Init script: no file picker, so saving falls back to a download. */
const noPicker = () => { delete (/** @type {any} */ (window)).showSaveFilePicker; };

/** @param {Page} page */
const heading = (page) => page.locator('#screen h2');
/** @param {Page} page */
const saveButton = (page) => page.getByRole('button', { name: 'Save backup', exact: true });
/** @param {Page} page */
const restoreInput = (page) => page.getByLabel('Restore from backup', { exact: true });

/**
 * Today's local calendar date in the page, as YYYY-MM-DD and DD/MM/YYYY, worked out the way the
 * app does it.
 * @param {Page} page
 */
const today = (page) => page.evaluate(() => {
  const d = new Date();
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const [y, m, day] = [String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())];
  return { iso: `${y}-${m}-${day}`, shown: `${day}/${m}/${y}` };
});

/** The Per month cell of Subscriptions in the typical month's Regular spending table. @param {Page} page */
const subscriptionsPerMonth = (page) => page.getByRole('table', { name: 'Regular spending', exact: true }).getByRole('row')
  .filter({ has: page.getByRole('rowheader', { name: 'Subscriptions', exact: true }) }).getByRole('cell').nth(2);

/** Fresh app, on the Backup screen. @param {Page} page */
async function openBackup(page) {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(heading(page)).toHaveText('Help');
  await openScreen(page, 'Backup');
}

/** A valid, empty backup. */
const emptyBackup = () => JSON.stringify({
  app: 'living-costs', schemaVersion: 2, exportedAt: new Date().toISOString(), accounts: [], buckets: [], rules: [],
  categories: [], overrides: [], transferPairs: [], offeredDefaultIds: [], batches: [], transactions: [],
});

/** @param {string} name @param {string} text */
const jsonFile = (name, text) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

test('download fallback', async ({ page }, testInfo) => {
  await page.addInitScript(noPicker);
  await openBackup(page);
  expect(await page.evaluate(() => 'showSaveFilePicker' in window)).toBe(false);
  await expect(page.getByText('Not backed up yet.', { exact: true })).toBeVisible();
  await expect(page.getByText(WARNING, { exact: true })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), saveButton(page).click()]);
  const { iso, shown } = await today(page);
  expect(download.suggestedFilename()).toBe(`living-costs-backup-${iso}.json`);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved).toMatchObject({ app: 'living-costs', schemaVersion: 3, accounts: [], overrides: [], transferPairs: [] });
  expect(saved.categories.length).toBeGreaterThan(0);
  expect(Array.isArray(saved.transactions)).toBe(true);
  expect(Array.isArray(saved.batches)).toBe(true);

  await expect(page.getByText(`Last backup: ${shown}`, { exact: true })).toBeVisible();
  await expect(page.getByText('Not backed up yet.')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Backup saved.');
  const [settings] = await readStore(page, 'settings');
  expect(settings.lastBackupAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
});

test('picker path', async ({ page }) => {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__saved = '';
    w.__closed = false;
    w.__pickerOptions = null;
    w.showSaveFilePicker = async (/** @type {any} */ options) => {
      w.__pickerOptions = options;
      return {
        createWritable: async () => ({
          write: async (/** @type {string} */ text) => { w.__saved += text; },
          close: async () => { w.__closed = true; },
        }),
      };
    };
  });
  await openBackup(page);
  let downloads = 0;
  page.on('download', () => { downloads++; });

  await saveButton(page).click();
  const { iso, shown } = await today(page);
  await expect(page.getByText(`Last backup: ${shown}`, { exact: true })).toBeVisible();
  const w = await page.evaluate(() => {
    const x = /** @type {any} */ (window);
    return { saved: x.__saved, closed: x.__closed, options: x.__pickerOptions };
  });
  expect(w.closed).toBe(true);
  await expect(page.getByRole('status')).toHaveText('Backup saved.');
  expect(JSON.parse(w.saved).schemaVersion).toBe(3);
  expect(w.options.suggestedName).toBe(`living-costs-backup-${iso}.json`);
  expect(w.options.types).toEqual([{ description: 'Living Costs backup', accept: { 'application/json': ['.json'] } }]);
  expect(downloads).toBe(0);
});

test('picker cancelled does nothing; picker failure falls back to a download', async ({ page }) => {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__mode = 'abort';
    w.__calls = 0;
    w.showSaveFilePicker = async () => {
      w.__calls++;
      if (w.__mode === 'abort') throw new DOMException('The user aborted a request.', 'AbortError');
      throw new DOMException('Not allowed here.', 'SecurityError');
    };
  });
  await openBackup(page);
  let downloads = 0;
  page.on('download', () => { downloads++; });

  await saveButton(page).click();
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__calls)).toBe(1);
  await expect(saveButton(page)).toBeEnabled();
  await expect(page.getByText('Not backed up yet.', { exact: true })).toBeVisible();
  expect((await readStore(page, 'settings'))[0].lastBackupAt).toBeUndefined();
  expect(downloads).toBe(0);

  await page.evaluate(() => { /** @type {any} */ (window).__mode = 'fail'; });
  const [download] = await Promise.all([page.waitForEvent('download'), saveButton(page).click()]);
  expect(download.suggestedFilename()).toMatch(/^living-costs-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText(/^Last backup: \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Backup saved to your Downloads folder instead.');
});

test('restore replaces', async ({ browser, baseURL }, testInfo) => {
  // First browser: the full fixture set-up, saved as a download.
  const first = await browser.newContext({ baseURL });
  const before = await first.newPage();
  await before.addInitScript(noPicker);
  await trackCspViolations(before);
  await setupFixtureApp(before);
  await expect(subscriptionsPerMonth(before)).toHaveText('£89.97');
  await openScreen(before, 'Backup');
  await expectNoAxeViolations(before);
  const [download] = await Promise.all([before.waitForEvent('download'), saveButton(before).click()]);
  const file = testInfo.outputPath('restore-me.json');
  await download.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stores = {
    accounts: await readStore(before, 'accounts'),
    overrides: await readStore(before, 'overrides'),
    transferPairs: await readStore(before, 'transferPairs'),
    transactions: await readStore(before, 'transactions'),
    batches: await readStore(before, 'batches'),
  };
  expect(stores.transactions.length).toBeGreaterThan(100);
  expect(saved.transactions.length).toBe(stores.transactions.length);
  expect(saved.batches.length).toBe(stores.batches.length);
  expect(await before.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
  await first.close();

  // A fresh context has no data.
  const second = await browser.newContext({ baseURL });
  const page = await second.newPage();
  await openBackup(page);
  expect(await readStore(page, 'accounts')).toEqual([]);

  /** @type {string[]} */
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.accept();
  });
  await restoreInput(page).setInputFiles(file);

  await expect(heading(page)).toHaveText('Help');
  await expect(page.getByRole('status').filter({ hasText: 'Backup restored.' })).toBeVisible();
  expect(dialogs).toEqual([`confirm: ${CONFIRM}`]);
  expect((await readStore(page, 'accounts')).length).toBe(stores.accounts.length);
  expect((await readStore(page, 'transferPairs')).length).toBe(stores.transferPairs.length);
  expect((await readStore(page, 'overrides')).length).toBe(stores.overrides.length);
  const byId = (/** @type {any[]} */ rows) => rows.toSorted((a, b) => (a.id < b.id ? -1 : 1));
  expect(byId(await readStore(page, 'transactions'))).toEqual(byId(stores.transactions));
  expect(byId(await readStore(page, 'batches'))).toEqual(byId(stores.batches));
  const [settings] = await readStore(page, 'settings');
  expect(settings.lastBackupAt).toBeUndefined();
  expect(settings.helpDismissed).toBe(false);
  expect(settings.schemaVersion).toBe(3);

  // Everything is there without importing anything.
  await openScreen(page, 'Typical month');
  await expect(subscriptionsPerMonth(page)).toHaveText('£89.97');
  // Import batches came back, so each import can still be undone.
  await openScreen(page, 'Accounts');
  await expect(page.getByRole('button', { name: /^Undo / }).first()).toBeVisible();
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
  await second.close();
});

test('restoring a version 1 backup upgrades it', async ({ browser, baseURL }, testInfo) => {
  const first = await browser.newContext({ baseURL });
  const before = await first.newPage();
  await before.addInitScript(noPicker);
  await setupFixtureApp(before);
  await openScreen(before, 'Backup');
  const [download] = await Promise.all([before.waitForEvent('download'), saveButton(before).click()]);
  const file = testInfo.outputPath('version-1.json');
  await download.saveAs(file);
  await first.close();

  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  old.schemaVersion = 1;
  old.rules = old.rules.map((/** @type {object} */ r) => ({ ...r, normaliserVersion: 1 }));
  fs.writeFileSync(file, JSON.stringify(old));

  const second = await browser.newContext({ baseURL });
  const page = await second.newPage();
  await openBackup(page);
  page.on('dialog', (dialog) => dialog.accept());
  await restoreInput(page).setInputFiles(file);
  await expect(page.getByRole('status').filter({ hasText: 'Backup restored.' })).toBeVisible();
  const [settings] = await readStore(page, 'settings');
  expect(settings.schemaVersion).toBe(3);
  await openScreen(page, 'Typical month');
  await expect(subscriptionsPerMonth(page)).toHaveText('£89.97');
  await second.close();
});

test('the frozen v2 fixture restores through the Backup screen', async ({ page }) => {
  const file = new URL('../fixtures/backups/v2.json', import.meta.url);
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  await openBackup(page);
  page.on('dialog', (dialog) => dialog.accept());
  await restoreInput(page).setInputFiles(fileURLToPath(file));
  await expect(page.getByRole('status').filter({ hasText: 'Backup restored.' })).toBeVisible();
  expect(await readStore(page, 'transactions')).toHaveLength(fixture.transactions.length);
  const [settings] = await readStore(page, 'settings');
  expect(settings.schemaVersion).toBe(DATA_VERSION);
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
});

test('bad backup', async ({ page }) => {
  await openBackup(page);
  const snapshot = async () => ({
    settings: await readStore(page, 'settings'),
    categories: await readStore(page, 'categories'),
  });
  const start = await snapshot();
  expect(start.categories.length).toBeGreaterThan(0);
  /** @type {string[]} */
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  const errors = page.getByRole('alert');

  await restoreInput(page).setInputFiles(jsonFile('other.json', '{"app":"other"}'));
  await expect(errors).toContainText("This file isn't a backup from this app.");
  await expect(errors).toContainText('Nothing was changed.');
  expect(dialogs).toEqual([]);
  expect(await snapshot()).toEqual(start);
  // The input is cleared, so the same file can be chosen again.
  await expect(restoreInput(page)).toHaveValue('');

  await restoreInput(page).setInputFiles(jsonFile('broken.json', '{"app":"living-costs",'));
  await expect(errors).toContainText("This file isn't valid JSON.");
  await expect(errors).not.toContainText("This file isn't a backup from this app.");

  const markup = '<img src=x>SECRET';
  const invalid = JSON.parse(emptyBackup());
  invalid.rules = [{ id: markup, pattern: markup, matchType: 'keyAmount', amountMinor: 1.5,
    expected: { count: 1, period: 'month' }, bucketId: markup }];
  await restoreInput(page).setInputFiles(jsonFile('invalid.json', JSON.stringify(invalid)));
  await expect(errors.getByRole('listitem')).toHaveText([
    'Rule 1 has a missing or invalid amount.',
    'Rule 1 points at a missing bucket.',
  ]);
  await expect(page.getByText('SECRET')).toHaveCount(0);
  await expect(page.locator('#screen img')).toHaveCount(0);
  await expectNoAxeViolations(page);
  expect(dialogs).toEqual([]);

  // A valid backup, but the confirmation is declined: nothing changes.
  await restoreInput(page).setInputFiles(jsonFile('empty.json', emptyBackup()));
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs).toEqual([CONFIRM]);
  await expect(page.getByText('Nothing was restored.', { exact: true })).toBeVisible();
  await expect(errors).toHaveCount(0);
  await expect(heading(page)).toHaveText('Backup');
  expect(await snapshot()).toEqual(start);
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
});

test('axe passes on the Backup screen', async ({ page }) => {
  await page.addInitScript(noPicker);
  await openBackup(page);
  await expectNoAxeViolations(page);
  await Promise.all([page.waitForEvent('download'), saveButton(page).click()]);
  await expect(page.getByText(/^Last backup: /)).toBeVisible();
  await expectNoAxeViolations(page);
});

// --- Delete loaded data ------------------------------------------------------------------------

const DELETE_CONFIRM = 'Delete all data in this browser? Save a backup first if you might want it.';
const STORES = ['settings', 'accounts', 'batches', 'transactions', 'buckets', 'rules', 'categories', 'overrides', 'transferPairs'];

/** @param {Page} page */
const deleteButton = (page) => page.getByRole('button', { name: 'Delete loaded data', exact: true });

/** Every row of every store. @param {Page} page */
const snapshotAll = async (page) => {
  /** @type {Record<string, unknown[]>} */
  const all = {};
  for (const name of STORES) all[name] = await readStore(page, name);
  return all;
};

test('delete loaded data: declining changes nothing', async ({ page }) => {
  await page.addInitScript(noPicker);
  await trackCspViolations(page);
  await page.goto('./');
  await expect(heading(page)).toHaveText('Help');
  await importFiles(page, { files: ['card.csv'], account: FIXTURE_ACCOUNTS.card });
  await openScreen(page, 'Backup');
  await Promise.all([page.waitForEvent('download'), saveButton(page).click()]);
  await expect(page.getByText(/^Last backup: /)).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Delete loaded data', level: 3 })).toBeVisible();
  await expect(page.getByText('This removes everything this app holds in this browser.', { exact: true })).toBeVisible();
  const before = await snapshotAll(page);
  expect(before.transactions.length).toBeGreaterThan(0);
  expect(before.accounts.length).toBe(1);

  /** @type {string[]} */
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  await deleteButton(page).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs).toEqual([`confirm: ${DELETE_CONFIRM}`]);
  await expect(heading(page)).toHaveText('Backup');
  await expect(deleteButton(page)).toBeEnabled();
  await expect(deleteButton(page)).toBeFocused();
  await expect(page.getByText('All data deleted.')).toHaveCount(0);
  expect(await snapshotAll(page)).toEqual(before);
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
});

test('delete loaded data: accepting leaves exactly a first visit', async ({ page }) => {
  await page.addInitScript(noPicker);
  await trackCspViolations(page);
  await setupFixtureApp(page);

  // An override and a backup date, so every store has something to delete.
  await openScreen(page, 'Transactions');
  await page.getByLabel('Search transactions').fill('24/09');
  await page.getByLabel('Counts as for AMAZON.CO.UK*115GL077M on 24/09/2026').selectOption({ label: 'Gifts' });
  await expect.poll(async () => (await readStore(page, 'overrides')).length).toBe(1);
  await openScreen(page, 'Backup');
  await Promise.all([page.waitForEvent('download'), saveButton(page).click()]);
  await expect(page.getByText(/^Last backup: /)).toBeVisible();
  const before = await snapshotAll(page);
  for (const name of STORES) expect(before[name].length, name).toBeGreaterThan(0);
  expect(before.categories.length).toBeGreaterThan(defaults.length);

  /** @type {string[]} */
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.accept();
  });
  await deleteButton(page).click();

  await expect(heading(page)).toHaveText('Help');
  await expect(page.getByRole('status').filter({ hasText: 'All data deleted.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
  expect(dialogs).toEqual([`confirm: ${DELETE_CONFIRM}`]);

  /** The stores as a first visit leaves them. */
  const expectFirstVisit = async () => {
    const after = await snapshotAll(page);
    for (const name of ['accounts', 'batches', 'transactions', 'buckets', 'rules', 'overrides', 'transferPairs']) {
      expect(after[name], name).toEqual([]);
    }
    const categories = /** @type {{name: string, defaultId?: string, position: number}[]} */ (after.categories)
      .toSorted((a, b) => a.position - b.position);
    expect(categories.map((c) => c.name)).toEqual(defaults.map((d) => d.name));
    expect(categories.map((c) => c.defaultId)).toEqual(defaults.map((d) => d.id));
    expect(after.settings).toEqual([{
      id: 'settings', schemaVersion: 3, offeredDefaultIds: defaults.map((d) => d.id), helpDismissed: false,
    }]);
  };
  await expectFirstVisit();
  await expect(page.locator('#defaults-notice')).toHaveCount(0);
  await expectNoAxeViolations(page);

  // In memory too: the screens show no data and no backup.
  await openScreen(page, 'Backup');
  await expect(page.getByText('Not backed up yet.', { exact: true })).toBeVisible();
  await openScreen(page, 'Accounts');
  await expect(page.getByRole('button', { name: /^Undo / })).toHaveCount(0);

  // And after a reload, which must not seed the defaults a second time.
  await page.reload();
  await expect(heading(page)).toHaveText('Help');
  await expectFirstVisit();
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
});

/**
 * Start an import on Accounts and leave it at the account step, then go to Backup.
 * @param {Page} page
 */
async function leaveImportHalfDone(page) {
  await pickFiles(page, ['card.csv']);
  await expect(page.getByRole('group', { name: 'Which account is this?' })).toBeVisible();
  await openScreen(page, 'Backup');
}

/** Accounts shows the file picker, with no import in progress. @param {Page} page */
async function expectNoImportInProgress(page) {
  await openScreen(page, 'Accounts');
  await expect(page.getByLabel('Choose CSV files')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Which account is this?' })).toHaveCount(0);
}

test('delete loaded data clears a half-finished import', async ({ page }) => {
  await page.goto('./');
  await expect(heading(page)).toHaveText('Help');
  await leaveImportHalfDone(page);
  page.on('dialog', (dialog) => dialog.accept());
  await deleteButton(page).click();
  await expect(heading(page)).toHaveText('Help');
  await expectNoImportInProgress(page);
});

test('restore clears a half-finished import', async ({ page }) => {
  await page.goto('./');
  await expect(heading(page)).toHaveText('Help');
  await leaveImportHalfDone(page);
  page.on('dialog', (dialog) => dialog.accept());
  await restoreInput(page).setInputFiles(jsonFile('empty.json', emptyBackup()));
  await expect(heading(page)).toHaveText('Help');
  await expectNoImportInProgress(page);
});

// --- Clear categorisation ----------------------------------------------------------------------

const CLEAR_CONFIRM = 'Clear all categorisation? Your accounts, categories and transactions stay. Save a backup first if you might want it.';

/** @param {Page} page */
const clearButton = (page) => page.getByRole('button', { name: 'Clear categorisation', exact: true });

test('clear categorisation: declining changes nothing', async ({ page }) => {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(heading(page)).toHaveText('Help');
  await importFiles(page, { files: ['card.csv'], account: FIXTURE_ACCOUNTS.card });
  await openScreen(page, 'Backup');
  await expect(page.getByRole('heading', { name: 'Clear categorisation', level: 3 })).toBeVisible();
  const before = await snapshotAll(page);

  /** @type {string[]} */
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  await clearButton(page).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs).toEqual([`confirm: ${CLEAR_CONFIRM}`]);
  await expect(heading(page)).toHaveText('Backup');
  await expect(clearButton(page)).toBeFocused();
  expect(await snapshotAll(page)).toEqual(before);
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
});

test('clear categorisation: accepting keeps what was loaded and drops every decision', async ({ page }) => {
  await page.addInitScript(noPicker);
  await trackCspViolations(page);
  await setupFixtureApp(page);

  // An override and a backup date as well.
  await openScreen(page, 'Transactions');
  await page.getByLabel('Search transactions').fill('24/09');
  await page.getByLabel('Counts as for AMAZON.CO.UK*115GL077M on 24/09/2026').selectOption({ label: 'Gifts' });
  await expect.poll(async () => (await readStore(page, 'overrides')).length).toBe(1);
  await openScreen(page, 'Backup');
  await Promise.all([page.waitForEvent('download'), saveButton(page).click()]);
  await expect(page.getByText(/^Last backup: /)).toBeVisible();
  const before = await snapshotAll(page);
  for (const name of ['rules', 'overrides', 'transferPairs']) expect(before[name].length, name).toBeGreaterThan(0);
  expect(before.buckets.some((/** @type {any} */ b) => b.categoryId)).toBe(true);

  /** @type {string[]} */
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.accept();
  });
  await clearButton(page).click();
  await expect(page.getByRole('status').filter({ hasText: 'Categorisation cleared.' })).toBeVisible();
  await expect(heading(page)).toHaveText('Categorise');
  await expect(page.locator('#card-heading')).toBeVisible();
  expect(dialogs).toEqual([`confirm: ${CLEAR_CONFIRM}`]);

  const expectCleared = async () => {
    const after = await snapshotAll(page);
    for (const name of ['rules', 'overrides', 'transferPairs']) expect(after[name], name).toEqual([]);
    for (const name of ['settings', 'categories', 'batches']) expect(after[name], name).toEqual(before[name]);
    expect(after.accounts).toEqual(before.accounts.map((/** @type {any} */ a) => ({ ...a, repaymentBucketIds: [] })));
    const ids = (/** @type {any[]} */ ts) => ts.map((t) => t.id).toSorted();
    expect(ids(after.transactions)).toEqual(ids(before.transactions));
    expect(after.buckets.length).toBeGreaterThan(0);
    for (const b of /** @type {any[]} */ (after.buckets)) {
      expect(b.categoryId, b.displayName).toBeUndefined();
      expect(b.keys, b.displayName).toHaveLength(1);
    }
  };
  await expectCleared();
  await expectNoAxeViolations(page);

  // The backup date is kept, and survives a reload with everything else.
  await openScreen(page, 'Backup');
  await expect(page.getByText(/^Last backup: /)).toBeVisible();
  await page.reload();
  await expectCleared();
  expect(await page.evaluate(() => /** @type {any} */ (window).__csp)).toEqual([]);
});
