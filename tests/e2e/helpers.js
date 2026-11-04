import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

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
