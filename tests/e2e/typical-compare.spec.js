// Typical month: choosing the window and comparing a month, against the full fixture state.
// One page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import { trackCspViolations, setupFixtureApp, openScreen } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

/** A table by its name (its section heading). */
const table = (name) => page.getByRole('table', { name, exact: true });

test.beforeAll(async ({ browser, baseURL }) => {
  context = await browser.newContext({ baseURL });
  page = await context.newPage();
  await trackCspViolations(page);
  await setupFixtureApp(page);
});

test.afterAll(async () => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  await context.close();
});

test('default: the window pickers show the latest 12 months, with no reset button', async () => {
  await expect(page.getByLabel('Typical from')).toHaveValue('2025-11');
  await expect(page.getByLabel('to', { exact: true })).toHaveValue('2026-10');
  await expect(page.getByRole('button', { name: 'Latest 12 months' })).toHaveCount(0);
  await expect(page.getByLabel('Typical from').locator('option').first()).toHaveText('Oct 2026'); // newest first
});

test('a chosen window recalculates and keeps focus', async () => {
  await page.getByLabel('to', { exact: true }).focus(); // selectOption alone does not focus the select
  await page.getByLabel('to', { exact: true }).selectOption('2026-06');
  await expect(page.locator('#typical-window')).toHaveText('Based on 8 complete months, Nov 2025 to Jun 2026');
  await expect(page.getByLabel('to', { exact: true })).toBeFocused();
  await expect(page.getByText('complete months so far')).toHaveCount(0);
  await expect(table('Contributions')).toHaveCount(0); // Bank B starts in Aug
  await expect(page.getByLabel('Typical from').locator('option[value="2026-07"]')).toHaveCount(0);
});

test('the window is kept through a category view and the nav', async () => {
  await table('Living costs').getByRole('button', { name: 'Groceries', exact: true }).click();
  const bankA = page.getByRole('group', { name: 'Each month' }); // Bank B is outside the window
  await expect(bankA.getByRole('button', { name: /^Jun 2026/ })).toHaveCount(1);
  await expect(bankA.getByRole('button', { name: /^Jul 2026/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Typical month', exact: true }).click();
  await expect(page.locator('#typical-window')).toHaveText('Based on 8 complete months, Nov 2025 to Jun 2026');
  await openScreen(page, 'Categorise');
  await openScreen(page, 'Typical month');
  await expect(page.locator('#typical-window')).toHaveText('Based on 8 complete months, Nov 2025 to Jun 2026');
});

test('Latest 12 months puts the default back', async () => {
  await page.getByRole('button', { name: 'Latest 12 months' }).click();
  await expect(page.locator('#typical-window')).toHaveText('Based on 12 complete months, Nov 2025 to Oct 2026');
  await expect(page.getByLabel('Typical from')).toBeFocused();
});
