/** @import {Page} from '@playwright/test' */
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPPINGS } from '../fixtures/mappings.js';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Fails the test if axe finds any WCAG A/AA violation on the page. */
export async function expectNoAxeViolations(page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations).toEqual([]);
}

/**
 * An opened view's Back to button is the only one, on the same line as the view's heading, after
 * it with at least a 24px gap. Run at a window wide enough for both to fit on one line.
 * @param {import('@playwright/test').Locator} heading
 * @param {import('@playwright/test').Locator} button
 */
export async function expectBackBesideHeading(heading, button) {
  await expect(button).toHaveCount(1);
  const [hb, bb] = [await heading.boundingBox(), await button.boundingBox()];
  if (!hb || !bb) throw new Error('heading or button not shown');
  // The same line: the button's vertical middle is inside the heading's box.
  expect(bb.y + bb.height / 2).toBeGreaterThan(hb.y);
  expect(bb.y + bb.height / 2).toBeLessThan(hb.y + hb.height);
  expect(bb.x - (hb.x + hb.width)).toBeGreaterThanOrEqual(24);
}

/**
 * Records request URLs (excluding blob: and data:) from now on.
 * @returns {() => string[]} returns the URLs seen so far
 */
export function trackRequests(page) {
  const urls = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    urls.push(url);
  });
  return () => urls.slice();
}

/** Init script: collects CSP violation events in window.__csp. Call before navigating. */
export async function trackCspViolations(page) {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

/** Read every row of one IndexedDB store. */
export const readStore = (page, name) => page.evaluate((storeName) => new Promise((resolve, reject) => {
  const req = indexedDB.open('living-costs');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const all = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    all.onsuccess = () => { db.close(); resolve(all.result); };
    all.onerror = () => reject(all.error);
  };
}), name);

/**
 * Put rows into one IndexedDB store, in one transaction on a connection of its own that is closed
 * afterwards. With `clear`, the store is emptied first. Reload the page for the app to see them.
 * @param {Page} page
 * @param {string} name
 * @param {object[]} rows
 * @param {{clear?: boolean}} [options]
 */
export const writeStore = (page, name, rows, { clear = false } = {}) => page.evaluate(
  ({ storeName, list, empty }) => new Promise((resolve, reject) => {
    const req = indexedDB.open('living-costs');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      if (empty) store.clear();
      for (const row of list) store.put(row);
      tx.oncomplete = () => { db.close(); resolve(undefined); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }),
  { storeName: name, list: rows, empty: clear },
);

/**
 * Merge `patch` into the stored settings row. Reload the page for the app to see it.
 * @param {Page} page
 * @param {Record<string, unknown>} patch
 */
export async function patchSettings(page, patch) {
  const [settings] = await readStore(page, 'settings');
  await writeStore(page, 'settings', [{ ...settings, ...patch }]);
}

// --- Import flow -----------------------------------------------------------------------------
// These drive the Accounts screen's import flow using its pinned labels. Fixture names are
// relative to tests/fixtures/; absolute paths (for temp files) are used as given.


const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');

/** @param {string} name */
export const fixturePath = (name) => (path.isAbsolute(name) ? name : path.join(FIXTURES, name));

/** The import flow's current step heading (h4 inside the import section). */
export const stepHeading = (page, name) => page.getByRole('heading', { name, exact: true });

/** Open Accounts (from anywhere) and pick files. */
export async function pickFiles(page, files) {
  const heading = page.locator('#screen h2');
  if ((await heading.textContent()) !== 'Accounts') {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Accounts' }).click();
    await expect(heading).toHaveText('Accounts');
  }
  await page.getByLabel('Choose CSV files').setInputFiles(files.map(fixturePath));
}

/** On the account step, choose an existing account by name, or New account. */
export async function chooseAccount(page, account) {
  await expect(page.getByRole('group', { name: 'Which account is this?' })).toBeVisible();
  if ('existing' in account) await page.getByRole('radio', { name: account.existing }).check();
  else await page.getByRole('radio', { name: 'New account' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Fill the mapping form for a new account from a fixture mapping, then continue (unless `submit` is false). */
export async function fillMapping(page, { name, kind, currency }, mappingKey, { submit = true } = {}) {
  const m = MAPPINGS[mappingKey];
  await expect(stepHeading(page, 'Set up columns')).toBeVisible();
  await page.getByLabel('Account name', { exact: true }).fill(name);
  await page.getByLabel('Kind', { exact: true }).selectOption({ label: kind === 'card' ? 'Card' : 'Bank' });
  if (currency) await page.getByLabel('Currency', { exact: true }).fill(currency);
  await page.getByLabel('Date column', { exact: true }).selectOption({ label: m.dateColumn });
  await page.getByLabel('Date format', { exact: true }).selectOption({ label: m.dateFormat });
  await page.getByLabel('Description column', { exact: true }).selectOption({ label: m.descriptionColumn });
  if (m.typeColumn) await page.getByLabel('Type column (optional)', { exact: true }).selectOption({ label: m.typeColumn });
  if (m.accountIdColumn) {
    await page.getByLabel('Account number column (optional)', { exact: true }).selectOption({ label: m.accountIdColumn });
  }
  if ('single' in m.amount) {
    await page.getByRole('radio', { name: 'One signed column' }).check();
    await page.getByLabel('Amount column', { exact: true }).selectOption({ label: m.amount.single });
    await page.getByLabel('Purchases are positive').setChecked(m.amount.signFlipped);
  } else {
    await page.getByRole('radio', { name: 'Separate debit and credit columns' }).check();
    await page.getByLabel('Debit column', { exact: true }).selectOption({ label: m.amount.debit });
    await page.getByLabel('Credit column', { exact: true }).selectOption({ label: m.amount.credit });
  }
  if (submit) await page.getByRole('button', { name: 'Continue' }).click();
}

/** On the covered-period step: optionally set the period of the first file, then continue. */
export async function confirmPeriods(page, covers) {
  await expect(stepHeading(page, 'Covered period')).toBeVisible();
  if (covers === 'whole-month') {
    for (const button of await page.getByRole('button', { name: /^Whole month/ }).all()) await button.click();
  } else if (covers) {
    await page.getByRole('textbox', { name: /^From/ }).first().fill(covers[0]);
    await page.getByRole('textbox', { name: /^To/ }).first().fill(covers[1]);
  }
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** On the review step (if shown), give every item the same answer, then continue. */
export async function answerReview(page, review = 'both') {
  const next = page.getByRole('heading', { name: /^(Check possible duplicates|Summary)$/ });
  await expect(next).toBeVisible();
  if ((await next.textContent()) !== 'Check possible duplicates') return;
  const label = review === 'same' ? 'Same transaction' : 'Both are real';
  for (const radio of await page.getByRole('radio', { name: label }).all()) await radio.check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

/**
 * Run the whole import flow on the Accounts screen.
 * @param {import('@playwright/test').Page} page
 * @param {{files: string[],
 *   account: {existing: string} | {new: {name: string, kind: 'bank'|'card', currency?: string}, mapping: keyof typeof MAPPINGS},
 *   covers?: [string, string] | 'whole-month', review?: 'same'|'both'}} opts
 */
export async function importFiles(page, opts) {
  await pickFiles(page, opts.files);
  await chooseAccount(page, opts.account);
  if ('new' in opts.account) await fillMapping(page, opts.account.new, opts.account.mapping);
  await confirmPeriods(page, opts.covers);
  await answerReview(page, opts.review);
  await expect(stepHeading(page, 'Summary')).toBeVisible();
  const importButton = page.getByRole('button', { name: 'Import', exact: true });
  if (await importButton.count()) await importButton.click();
  else await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Choose CSV files')).toBeVisible();
}

// --- Categorise card -------------------------------------------------------------------------

/** The categorise card's heading (the bucket name). */
export const cardHeading = (page) => page.locator('#card-heading');

/** On the Categorise screen, click Skip for now until the card heading is `name`. Fails after 100 clicks. */
export async function skipToCard(page, name) {
  const heading = cardHeading(page);
  for (let i = 0; i < 100; i++) {
    await expect(heading).toBeVisible();
    if ((await heading.textContent()) === name) return;
    await page.getByRole('button', { name: 'Skip for now' }).click();
  }
  throw new Error(`No card for ${name} after 100 skips`);
}

// --- Full fixture state ------------------------------------------------------------------------

/** The four imported accounts, named as in tests/unit/pipeline.js. */
export const FIXTURE_ACCOUNTS = {
  bankA: { new: { name: 'Bank A current', kind: 'bank' }, mapping: 'bankA' },
  savings: { new: { name: 'Bank A savings', kind: 'bank' }, mapping: 'savings' },
  card: { new: { name: 'Credit card', kind: 'card' }, mapping: 'card' },
  bankB: { new: { name: 'Bank B joint', kind: 'bank' }, mapping: 'bankB' },
};

/** The main screen's heading. */
const screenH2 = (page) => page.locator('#screen h2');

/**
 * A nav button by its screen's label. Its accessible name may go on after the label, as in
 * "Transfers, 3 suggestions" or "Categorise (at 56%)".
 * @param {Page} page
 * @param {string} name
 */
export const navButton = (page, name) => page.getByRole('navigation', { name: 'Main' })
  .getByRole('button', { name: new RegExp(`^${name}(?:$|[ ,])`) });

/** Go to a screen from the nav and wait for its heading. */
export async function openScreen(page, name) {
  await navButton(page, name).click();
  await expect(screenH2(page)).toHaveText(name);
}

/**
 * On the Buckets screen, set one bucket's category and wait until it is saved in IndexedDB, so the
 * next change is not dropped as a second save in flight.
 */
export async function setBucketCategory(page, bucketName, categoryName) {
  const categoryId = (await readStore(page, 'categories')).find((c) => c.name === categoryName)?.id;
  expect(categoryId, `a category named ${categoryName}`).toBeTruthy();
  await page.getByRole('combobox', { name: `Category for ${bucketName}`, exact: true }).selectOption({ label: categoryName });
  await expect.poll(async () => (await readStore(page, 'buckets'))
    .find((b) => b.displayName === bucketName)?.categoryId).toBe(categoryId);
}

/** Wait until a store holds `n` rows. */
const expectStoreCount = (page, name, n) => expect.poll(async () => (await readStore(page, name)).length).toBe(n);

/**
 * Drive the real UI from a fresh page to the state `fixtureState()` builds in
 * tests/unit/helpers/fixture-state.js: the six main fixture files imported with whole-month
 * covered periods, OTHER CARD PLC as a card you don't import, every other bucket categorised as
 * expected.intendedCategories says, the PAYPAL PAYMENT amounts −2.99 and −9.99 as their own
 * Subscriptions buckets, every suggested transfer confirmed, and Help dismissed. Ends on the
 * Typical month screen. Call trackCspViolations first if the test checks for violations.
 * @param {Page} page
 */
export async function setupFixtureApp(page) {
  const expected = JSON.parse(fs.readFileSync(fixturePath('expected.json'), 'utf8'));
  const wholeYear = /** @type {[string, string]} */ (['01/11/2025', '31/10/2026']);
  await page.goto('./');
  await expect(screenH2(page)).toHaveText('Help');

  await importFiles(page, { files: ['bank-a-current.csv'], account: FIXTURE_ACCOUNTS.bankA, covers: wholeYear });
  await importFiles(page, { files: ['bank-a-savings.csv'], account: FIXTURE_ACCOUNTS.savings, covers: wholeYear });
  await importFiles(page, { files: ['card.csv'], account: FIXTURE_ACCOUNTS.card, covers: wholeYear });
  await importFiles(page, {
    files: ['bank-b-2026-08.csv', 'bank-b-2026-09.csv', 'bank-b-2026-10.csv'], account: FIXTURE_ACCOUNTS.bankB, covers: 'whole-month',
  });
  await expectStoreCount(page, 'batches', 6);

  await openScreen(page, 'Transfers');
  await page.getByLabel('Repayment bucket', { exact: true }).selectOption({ label: 'OTHER CARD PLC' });
  await page.getByLabel('Card name', { exact: true }).fill('Other Card');
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Added Other Card.' })).toBeVisible();

  await openScreen(page, 'Buckets');
  for (const [bucket, category] of Object.entries(expected.intendedCategories)) {
    if (bucket !== 'OTHER CARD PLC') await setBucketCategory(page, bucket, String(category));
  }

  await openScreen(page, 'Categorise');
  await skipToCard(page, 'PAYPAL PAYMENT');
  const card = page.locator('#card');
  let rules = 0;
  for (const [amount, name] of [['£2.99', 'Google One storage'], ['£9.99', 'Streaming']]) {
    await card.getByRole('region', { name: 'Repeating amounts', exact: true }).getByRole('listitem')
      .filter({ hasText: `${amount}, ` }).getByRole('button', { name: 'Make this its own bucket' }).click();
    await expect(card.getByLabel('Times per month')).toHaveValue('1');
    await card.getByLabel('Bucket name').fill(name);
    await card.getByRole('button', { name: 'Make bucket' }).click();
    await expectStoreCount(page, 'rules', ++rules);
    await expect(cardHeading(page)).toHaveText('PAYPAL PAYMENT');
  }

  await openScreen(page, 'Buckets');
  for (const name of ['Google One storage', 'Streaming']) await setBucketCategory(page, name, 'Subscriptions');

  await openScreen(page, 'Transfers');
  await page.getByRole('button', { name: 'Confirm all' }).click();
  await expect(page.getByText('No suggestions.')).toBeVisible();
  await expectStoreCount(page, 'transferPairs', expected.transferPairs);

  await openScreen(page, 'Help');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);

  await openScreen(page, 'Typical month');
}
