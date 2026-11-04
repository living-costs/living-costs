import { test, expect } from '@playwright/test';
import { trackRequests, trackCspViolations } from './helpers.js';

test('loads with CSP and makes no requests after load', async ({ page }) => {
  await trackCspViolations(page);
  await page.goto('./', { waitUntil: 'load' });
  const requests = trackRequests(page);
  await page.waitForTimeout(500);
  expect(requests()).toEqual([]);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  const csp = await page.evaluate(
    () => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
  );
  expect(csp).toContain("require-trusted-types-for 'script'");
});
