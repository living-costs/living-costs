import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations } from './helpers.js';

const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('auto follows the OS, and the toggle forces and remembers light or dark', async ({ page }) => {
  await trackCspViolations(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  const picker = page.getByRole('group', { name: 'Theme' });
  await expect(picker.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
  const dark = await bodyBg(page);
  expect(dark).toBe('rgb(22, 22, 22)');

  await picker.getByRole('button', { name: 'Light' }).click();
  await expect(picker.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
  expect(await bodyBg(page)).toBe('rgb(244, 244, 242)');

  // Remembered across a reload, and applied without waiting for the app to start.
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  expect(await bodyBg(page)).toBe('rgb(244, 244, 242)');

  await picker.getByRole('button', { name: 'Dark' }).click();
  expect(await bodyBg(page)).toBe(dark);
  await picker.getByRole('button', { name: 'Auto' }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await bodyBg(page)).toBe('rgb(244, 244, 242)');
  expect(await page.evaluate(() => localStorage.getItem('living-costs-theme'))).toBeNull();
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('dark theme passes the accessibility checks', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await page.getByRole('button', { name: 'Help' }).click();
  await expectNoAxeViolations(page);
  await page.getByRole('button', { name: 'Typical month' }).click();
  await expectNoAxeViolations(page);
});
