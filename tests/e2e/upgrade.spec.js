// Stored data on load: older data is upgraded silently, current data is left as it is, and newer
// data is refused without being touched. Each test changes the stored rows, then reloads.
/** @import {Page} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import { trackCspViolations, setupFixtureApp, readStore, writeStore, patchSettings } from './helpers.js';

const NEWER = 'Your data was saved by a newer version of this app. Reload the page to get it.';
const FAILED = "Your saved data couldn't be upgraded to this version of the app. Nothing was changed.";

/** @param {Page} page */
const heading = (page) => page.locator('#screen h2');

/** The Per month cell of Subscriptions in the typical month's Living costs table. @param {Page} page */
const subscriptionsPerMonth = (page) => page.getByRole('table', { name: 'Living costs', exact: true }).getByRole('row')
  .filter({ has: page.getByRole('rowheader', { name: 'Subscriptions', exact: true }) }).getByRole('cell').nth(1);

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

test('an upgrade that fails writes nothing', async ({ page }) => {
  await setupFixtureApp(page);
  await patchSettings(page, { schemaVersion: 1 });
  const [first] = await readStore(page, 'transactions');
  // Not a valid transaction: the upgraded data fails validation.
  await writeStore(page, 'transactions', [{ ...first, amountMinor: 'lots' }]);
  const before = {};
  for (const name of ['settings', 'transactions', 'rules', 'buckets']) before[name] = await readStore(page, name);

  await page.reload();
  await expect(heading(page)).toHaveText('The app could not start');
  await expect(page.locator('#screen')).toContainText(FAILED);
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button')).toHaveCount(0);
  for (const name of Object.keys(before)) expect(await readStore(page, name)).toEqual(before[name]);
});
