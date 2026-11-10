// Opening one-offs, uncategorised and ignored from Typical month's summary, against the full
// fixture state reached through the real UI. One page is set up once and shared, in order, by
// every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import {
  expectNoAxeViolations, trackCspViolations, setupFixtureApp, openScreen, setBucketCategory, expectBesideHeading,
} from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

/** A part's button on the summary card, or its plain label. */
const partButton = (name) => page.locator('#screen dl.summary, #screen table.summary-compare')
  .getByRole('button', { name, exact: true });
const viewHeading = (name) => page.locator('.category-explorer').getByRole('heading', { level: 3, name, exact: true });
const back = () => page.getByRole('button', { name: 'Back to Typical month', exact: true });
const summary = () => page.locator('#explore-summary');
const bucketTable = () => page.getByRole('table', { name: 'By bucket', exact: true });
const listRows = () => page.getByRole('region', { name: 'Matching transactions' }).locator('tbody tr');
const monthButton = (label) => page.locator('#screen .month-cells').getByRole('button', { name: new RegExp(`^${label}`) });
/** The card's figure for a part, read from its definition. */
const cardFigure = (label) => page.locator('#screen dl.summary dt').filter({ hasText: new RegExp(`^${label}$`) })
  .locator('xpath=following-sibling::dd[1]').innerText();

/** Open a part from the card. */
async function open(name, heading) {
  await partButton(name).click();
  await expect(viewHeading(heading)).toBeFocused();
}

test.beforeAll(async ({ browser, baseURL }) => {
  // A context of its own: axe needs a page from browser.newContext(), not browser.newPage().
  context = await browser.newContext({ baseURL });
  page = await context.newPage();
  await trackCspViolations(page);
  await setupFixtureApp(page);
});

test.afterAll(async () => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  await context.close();
});

test('one-offs and uncategorised are buttons; ignored is a dash and plain text', async () => {
  await expect(partButton('one-offs')).toBeVisible();
  await expect(partButton('uncategorised')).toBeVisible();
  await expect(partButton('ignored')).toHaveCount(0);
  await expect(page.locator('#screen dl.summary dt').filter({ hasText: /^ignored$/ })).toBeVisible();
  expect(await cardFigure('ignored')).toContain('—');
});

test('one-offs opens with its summary naming the card\'s figure', async () => {
  const figure = (await cardFigure('one-offs')).trim();
  expect(figure).toBe('£200.00');
  await open('one-offs', 'One-offs');
  await expectBesideHeading(viewHeading('One-offs'), back());
  await expect(summary()).toContainText(`That is ${figure} a month on Typical month`);
  await expect(summary()).toContainText('One-off categories · ');
  await expect(bucketTable().getByRole('columnheader', { name: 'Category', exact: true })).toBeVisible();
  const row = bucketTable().getByRole('row').filter({ has: page.getByRole('button', { name: 'BIG BOILER CO', exact: true }) });
  await expect(row).toContainText('Big one-offs');
  await expect(page.locator('#screen .month-cells')).not.toHaveCount(0);
  await expectNoAxeViolations(page);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expectNoAxeViolations(page);
  await page.setViewportSize({ width: 1280, height: 720 });
});

test('Back returns focus to one-offs; reopening shows no filters', async () => {
  await bucketTable().getByRole('button', { name: 'BIG BOILER CO', exact: true }).click();
  await monthButton('Jan 2026').click();
  await back().click();
  await expect(partButton('one-offs')).toBeFocused();
  await open('one-offs', 'One-offs');
  await expect(page.locator('#screen .month-cells button[aria-pressed="true"]')).toHaveCount(0);
  await expect(bucketTable().getByRole('button', { name: 'BIG BOILER CO', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await monthButton('Jan 2026').click();
  await page.goBack();
  await expect(viewHeading('One-offs')).toHaveCount(0);
  await expect(partButton('one-offs')).toBeFocused();
  await open('one-offs', 'One-offs');
  await expect(page.locator('#screen .month-cells button[aria-pressed="true"]')).toHaveCount(0);
  await back().click();
});

test('ignored opens after a bucket is set to Ignore', async () => {
  await openScreen(page, 'Buckets');
  await setBucketCategory(page, 'GAMESHOP', 'Ignore');
  await openScreen(page, 'Typical month');
  const figure = (await cardFigure('ignored')).trim();
  expect(figure).not.toContain('—');
  await open('ignored', 'Ignored');
  await expect(summary()).toContainText('Ignore categories · ');
  await expect(summary()).toContainText(`That is ${figure} a month on Typical month`);
  const bucket = bucketTable().getByRole('button', { name: 'GAMESHOP', exact: true });
  await expect(bucket).toBeVisible();
  const all = await listRows().count();
  const cell = page.locator('#screen .month-cells button:not([disabled])').first();
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await bucket.click();
  await expect(bucket).toHaveAttribute('aria-pressed', 'true');
  expect(await listRows().count()).toBeLessThanOrEqual(all);
  await back().click();
});

test('uncategorised: categorise in place and it leaves; the last one leaves the empty line focused', async () => {
  await open('uncategorised', 'Uncategorised');
  await expect(bucketTable().getByRole('columnheader', { name: 'Category', exact: true })).toHaveCount(0);
  for (let left = await listRows().count(); left > 0; left--) {
    const select = listRows().first().getByRole('combobox', { name: /^Counts as for / });
    // selectOption does not move focus, so focus the select as a keyboard user would have.
    await select.focus();
    await select.selectOption({ label: 'Gifts' });
    if (left > 1) await expect(listRows()).toHaveCount(left - 1);
  }
  const empty = page.getByText('Nothing is uncategorised in these months now.', { exact: true });
  await expect(empty).toBeVisible();
  await expect(empty).toBeFocused();
  await back().click();
  await expect(partButton('uncategorised')).toHaveCount(0);
  await expect(page.locator('#screen h2')).toBeFocused();
});

test('changing the window, opening and Back keep the window', async () => {
  const from = page.getByLabel('Typical from', { exact: true });
  // Options run newest first; the second oldest drops Nov 2025 from the window, keeping Jan 2026.
  await from.selectOption('2025-12');
  const chosen = 'Dec 2025';
  await expect(from.locator('option:checked')).toHaveText(chosen);
  const window = await page.locator('#typical-window').textContent();
  await open('one-offs', 'One-offs');
  await expect(summary()).toContainText('Dec 2025 to Oct 2026');
  await back().click();
  await expect(page.locator('#typical-window')).toHaveText(window ?? '');
  await expect(from.locator('option:checked')).toHaveText(chosen);
});
