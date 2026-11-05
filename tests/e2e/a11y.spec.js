// Whole-app accessibility sweep: every screen, reached through the nav, against the full fixture
// state. One page is set up once and shared, in order, by every test here.
/** @import {Page, BrowserContext} from '@playwright/test' */
import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations, setupFixtureApp, openScreen } from './helpers.js';

test.describe.configure({ mode: 'serial' });

/** Every nav label, in nav order (src/ui/nav.js). */
const SCREENS = [
  'Help', 'Typical month', 'Categorise', 'Buckets', 'Transactions', 'Transfers', 'Accounts', 'Categories', 'Backup',
];

/** The main tabs: their selected tab names the screen, so the h2 is for screen readers only. */
const MAIN_TABS = ['Help', 'Typical month', 'Categorise'];

/** @type {BrowserContext} */
let context;
/** @type {Page} */
let page;

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

/**
 * Visible controls shorter than 32px, described for the failure message. The documented
 * exception: the small nav buttons (Review and Set up) need only 24px, the WCAG 2.2 AA minimum.
 * @param {Page} p
 */
const shortTargets = (p) => p.evaluate(() => {
  const controls = document.querySelectorAll('button, select, input:not([type=checkbox]):not([type=radio])');
  return [...controls].filter((el) => el.checkVisibility())
    .map((el) => ({ el, height: el.getBoundingClientRect().height }))
    .filter(({ el, height }) => height < (el.matches('nav .nav-row button') ? 24 : 32))
    .map(({ el, height }) => `${el.tagName.toLowerCase()} "${el.textContent?.trim() || el.getAttribute('aria-label') || el.id}" is ${height}px`);
});

/**
 * Move focus with Tab to the first button in the screen, or Shift+Tab from the heading to the
 * last nav button if the screen has none. Real key presses, so the focus counts as keyboard focus.
 * Returns the focused button's outline and whether it matches :focus-visible.
 * @param {Page} p
 */
async function keyboardFocusButton(p) {
  const active = () => p.evaluate(() => {
    const el = document.activeElement;
    return { button: el?.tagName === 'BUTTON', inScreen: !!el && el !== document.getElementById('screen')
      && !!document.getElementById('screen')?.contains(el) };
  });
  // openScreen leaves focus on the screen's h2.
  let found = false;
  for (let i = 0; i < 50; i++) {
    await p.keyboard.press('Tab');
    const now = await active();
    if (!now.inScreen) break;
    if (now.button) { found = true; break; }
  }
  if (!found) {
    await p.locator('#screen h2').focus();
    await p.keyboard.press('Shift+Tab');
    expect((await active()).button, 'Shift+Tab from the heading reaches a button').toBe(true);
  }
  return p.evaluate(() => {
    const el = /** @type {HTMLElement} */ (document.activeElement);
    const style = getComputedStyle(el);
    return { width: style.outlineWidth, style: style.outlineStyle, focusVisible: el.matches(':focus-visible') };
  });
}

for (const name of SCREENS) {
  test(`${name}: axe, target size, focus ring and 320px width`, async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openScreen(page, name);
    await expectNoAxeViolations(page);
    expect(await shortTargets(page)).toEqual([]);

    expect(await keyboardFocusButton(page)).toEqual({ width: '3px', style: 'solid', focusVisible: true });

    await page.setViewportSize({ width: 320, height: 640 });
    await expect(page.locator('#screen h2')).toHaveText(name);
    const box = await page.locator('#screen h2').boundingBox();
    expect((box?.height ?? 0) <= 1, `${name} heading is visually hidden`).toBe(MAIN_TABS.includes(name));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
}
