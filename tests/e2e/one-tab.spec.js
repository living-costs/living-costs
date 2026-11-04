// One tab at a time: a second tab waits on a Web Lock until the first one closes.
import { test, expect } from '@playwright/test';
import { trackCspViolations, expectNoAxeViolations } from './helpers.js';

const WAITING = 'Budgie is already open in another tab. Close it and this tab will load automatically.';

test('a second tab waits until the first closes, then loads', async ({ context }) => {
  const first = await context.newPage();
  await trackCspViolations(first);
  await first.goto('./');
  await expect(first.locator('#screen h2')).toHaveText('Help');

  const second = await context.newPage();
  await trackCspViolations(second);
  await second.goto('./');
  await expect(second.locator('#screen')).toHaveText(WAITING);
  await expect(second.getByRole('navigation', { name: 'Main' }).getByRole('button')).toHaveCount(0);
  await expect(second.locator('#screen h2')).toHaveCount(0);
  await expectNoAxeViolations(second);

  await first.close();
  await expect(second.locator('#screen h2')).toHaveText('Help');
  await expect(second.locator('#screen')).not.toContainText(WAITING);
  await expect(second.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Accounts' })).toBeVisible();
  expect(await second.evaluate(() => window.__csp)).toEqual([]);
});

test('without Web Locks the app starts normally', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'locks', { configurable: true, get: () => undefined });
  });
  await page.goto('./');
  await expect(page.locator('#screen h2')).toHaveText('Help');
});
