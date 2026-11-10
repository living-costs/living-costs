import { test, expect } from '@playwright/test';
import { expectNoAxeViolations, trackCspViolations } from './helpers.js';

const NAV_NAMES = [
  'Help', 'Typical month', 'Categorise', 'Buckets', 'Transactions',
  'Transfers', 'Categories', 'Accounts', 'Backup',
];

/** @param {import('@playwright/test').Page} page */
const nav = (page) => page.getByRole('navigation', { name: 'Main' });
/** @param {import('@playwright/test').Page} page */
const screenHeading = (page) => page.locator('#screen h2');

test.beforeEach(async ({ page }) => {
  await trackCspViolations(page);
  await page.goto('./');
  await expect(screenHeading(page)).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('first launch shows Help', async ({ page }) => {
  await expect(screenHeading(page)).toHaveText('Help');
  await expect(page.getByRole('heading', { name: 'What this app is for' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What this app is for' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import a statement' })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Help', exact: true })).toHaveAttribute('aria-current', 'page');
  await expectNoAxeViolations(page);
});

test('Got it is remembered', async ({ page }) => {
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  await expect(screenHeading(page)).toHaveText('Help');
  await expect(screenHeading(page)).toBeFocused();
  await expectNoAxeViolations(page);

  await page.reload();
  await expect(screenHeading(page)).toHaveText('Help');
  await expect(page.getByRole('heading', { name: 'What this app is for' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import a statement' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  await expectNoAxeViolations(page);
});

test('nav has every screen', async ({ page }) => {
  await expect(nav(page).getByRole('button')).toHaveText([...NAV_NAMES, 'Auto', 'Light', 'Dark']);
  // With nothing imported, no button carries a count or a percent.
  for (const [i, name] of NAV_NAMES.entries()) await expect(nav(page).getByRole('button').nth(i)).toHaveAccessibleName(name);
  await expect(nav(page).getByRole('group', { name: 'Explore' }).getByRole('button')).toHaveText(['Buckets', 'Transactions', 'Transfers', 'Categories']);
  await expect(nav(page).getByRole('group', { name: 'Theme' }).getByRole('button')).toHaveText(['Auto', 'Light', 'Dark']);
  await expect(nav(page).getByRole('group', { name: 'Set up' }).getByRole('button')).toHaveText(['Accounts', 'Backup']);
  // Start away from Help so every click, Help included, is a real navigation.
  for (const name of [...NAV_NAMES.slice(1), 'Help']) {
    const button = nav(page).getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    await expect(nav(page).locator('[aria-current]')).toHaveCount(1);
    await expect(screenHeading(page)).toHaveText(name);
    await expect(screenHeading(page)).toBeFocused();
    await expectNoAxeViolations(page);
  }
});

test('Help leads to import', async ({ page }) => {
  await page.getByRole('button', { name: 'Import a statement' }).click();
  await expect(screenHeading(page)).toHaveText('Accounts');
  await expect(screenHeading(page)).toBeFocused();
  await expect(nav(page).getByRole('button', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page');
  await expectNoAxeViolations(page);
});

test('no CSP violations', async ({ page }) => {
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('button', { name: 'Got it' })).toHaveCount(0);
  for (const name of NAV_NAMES) {
    await nav(page).getByRole('button', { name, exact: true }).click();
    await expect(screenHeading(page)).toBeFocused();
  }
  await page.reload();
  await expect(screenHeading(page)).toBeVisible();
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test('reflows at 320px without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const overflow = () => page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page);
  await nav(page).getByRole('button', { name: 'Typical month' }).click();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

// Linux CI has wider fonts than macOS, so a nav row that just fits on a Mac overflowed there.
// A wide font must wrap the rows rather than scroll the page. (Not the bare `monospace`
// generic: Chrome would also shrink the root font size, and so the rem-sized buttons.)
test('reflows at 320px with a wide font', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => {
    document.documentElement.style.fontFamily = 'Menlo, "DejaVu Sans Mono", "Courier New", monospace';
  });
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(0);
});

test('defaults are seeded once', async ({ page }) => {
  const count = () => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('living-costs');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['categories', 'settings'], 'readonly');
      const cats = tx.objectStore('categories').getAll();
      const settings = tx.objectStore('settings').get('settings');
      tx.oncomplete = () => {
        db.close();
        resolve({
          categories: cats.result.length,
          defaultIds: new Set(cats.result.map((c) => c.defaultId)).size,
          positions: cats.result.map((c) => c.position).sort((a, b) => a - b),
          offered: settings.result.offeredDefaultIds.length,
        });
      };
    };
  }));
  const first = await count();
  expect(first.categories).toBeGreaterThan(0);
  expect(first.defaultIds).toBe(first.categories);
  expect(first.offered).toBe(first.categories);
  expect(first.positions).toEqual([...Array(first.categories).keys()]);
  await page.reload();
  await expect(screenHeading(page)).toBeVisible();
  expect(await count()).toEqual(first);
});

test('store writes IndexedDB first and keeps memory in step', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { openStore: open } = await import('/src/store.js');
    const openStore = async () => {
      const opened = await open();
      if (opened.kind !== 'ready') throw new Error(`Store not ready: ${opened.kind}`);
      return opened.store;
    };
    const store = await openStore();
    let notified = 0;
    store.subscribe(() => { notified++; });
    const before = store.state.categories.length;

    // A row with no key fails the whole transaction: nothing persists, memory is untouched.
    let rejected = false;
    try {
      await store.apply({ put: { categories: [
        { id: 'good', name: 'Good', kind: 'spend', position: 99 },
        { name: 'No id', kind: 'spend', position: 100 },
      ] } });
    } catch { rejected = true; }
    const failed = {
      rejected, notified, same: store.state.categories.length === before,
      persisted: (await openStore()).state.categories.some((c) => c.id === 'good'),
    };

    // Puts then dels in one transaction.
    await store.apply({
      put: { categories: [{ id: 'a', name: 'A', kind: 'spend', position: 1 }, { id: 'b', name: 'B', kind: 'spend', position: 2 }] },
      del: { categories: ['a'] },
    });
    const reloaded = (await openStore()).state;
    const ok = {
      notified,
      memory: store.state.categories.filter((c) => c.id === 'a' || c.id === 'b').map((c) => c.id),
      disk: reloaded.categories.filter((c) => c.id === 'a' || c.id === 'b').map((c) => c.id),
    };

    // replaceAll clears every store, then writes, and memory matches.
    await store.replaceAll({
      put: {
        categories: [{ id: 'only', name: 'Only', kind: 'spend', position: 0 }],
        overrides: [{ fingerprint: 'fp1', categoryId: 'only' }],
      },
    });
    const after = (await openStore()).state;
    const replaced = {
      notified,
      memory: store.state.categories.map((c) => c.id),
      disk: after.categories.map((c) => c.id),
      overridesIsMap: after.overrides instanceof Map && after.transferPairs instanceof Map,
      override: after.overrides.get('fp1')?.categoryId,
      settings: after.settings,
      memorySettings: store.state.settings,
    };
    return { failed, ok, replaced };
  });

  expect(result.failed).toEqual({ rejected: true, notified: 0, same: true, persisted: false });
  expect(result.ok).toEqual({ notified: 1, memory: ['b'], disk: ['b'] });
  expect(result.replaced.notified).toBe(2);
  expect(result.replaced.memory).toEqual(['only']);
  expect(result.replaced.disk).toEqual(['only']);
  expect(result.replaced.overridesIsMap).toBe(true);
  expect(result.replaced.override).toBe('only');
  const empty = { id: 'settings', schemaVersion: 3, offeredDefaultIds: [], helpDismissed: false };
  expect(result.replaced.settings).toEqual(empty);
  expect(result.replaced.memorySettings).toEqual(empty);
});

test('h() builds safely and refuses style, html and URL props', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { h, clear } = await import('/src/dom.js');
    /** @param {() => unknown} fn */
    const throws = (fn) => { try { fn(); return false; } catch { return true; } };
    let clicks = 0;
    const el = h('div', { class: 'x', hidden: true, 'data-a': false, 'aria-label': null, onClick: () => { clicks++; } },
      '<b>bold</b>', null, false, h('span', null, 'in'), 3);
    el.click();
    const built = {
      cls: el.getAttribute('class'), hidden: el.getAttribute('hidden'),
      dataA: el.hasAttribute('data-a'), label: el.hasAttribute('aria-label'),
      bold: el.querySelector('b'), text: el.textContent, clicks,
    };
    clear(el);
    return {
      built, cleared: el.childNodes.length,
      refused: [
        throws(() => h('div', { style: 'color:red' })),
        throws(() => h('div', { Style: 'color:red' })),
        throws(() => h('div', { innerHTML: '<b>x</b>' })),
        throws(() => h('div', { outerHTML: 'x' })),
        throws(() => h('iframe', { srcdocHTML: 'x' })),
        throws(() => h('div', { onclick: 'alert(1)' })),
        // URL-bearing attributes, any case.
        ...['href', 'HREF', 'src', 'Src', 'srcset', 'src' + 'doc', 'action', 'formAction', 'ping',
          'poster', 'background', 'xlink:href', 'XLink:Href']
          .map((key) => throws(() => h('a', { [key]: 'x' }))),
      ],
      allowed: [
        throws(() => h('input', { type: 'file', accept: '.csv', 'data-src': 'x', 'aria-label': 'x' })),
        throws(() => h('label', { for: 'x' })),
      ],
    };
  });
  expect(result.built).toEqual({
    cls: 'x', hidden: '', dataA: false, label: false, bold: null, text: '<b>bold</b>in3', clicks: 1,
  });
  expect(result.cleared).toBe(0);
  expect(result.refused).toEqual(Array(19).fill(true));
  expect(result.allowed).toEqual([false, false]);
});
