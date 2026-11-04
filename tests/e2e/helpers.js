import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
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
