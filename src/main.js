// App entry: take the one-tab lock, open the store, seed defaults on first run, build the nav and route.

/** @import {Store, Opened} from './store.js' */
import { openStore } from './store.js';
import { h, clear } from './dom.js';
import tuning from './tuning.js';
import defaults from './default-categories.js';
import { renderNav, updateNav } from './ui/nav.js';
import { whileSaving } from './ui/saving.js';
import { keyed } from './ui/form.js';
import * as subview from './ui/subview.js';
import * as help from './ui/help.js';
import * as accounts from './ui/accounts.js';
import * as categories from './ui/categories.js';
import * as categorise from './ui/categorise.js';
import * as transactions from './ui/transactions.js';
import * as buckets from './ui/buckets.js';
import * as transfers from './ui/transfers.js';
import * as typical from './ui/typical.js';
import * as backup from './ui/backup.js';
import { seedDefaults, pendingDefaults, acceptDefaults, dismissDefaults } from './categories.js';

/** @typedef {'help'|'typical'|'categorise'|'buckets'|'transactions'|'transfers'|'accounts'|'categories'|'backup'} ScreenName */
/** @typedef {{store: Store, tuning: typeof tuning, defaults: typeof defaults,
 *   session: {skipped: Set<string>, screen: ScreenName},
 *   navigate(name: ScreenName): void, rerender(): void}} App */
/** @typedef {(root: HTMLElement, app: App) => void} Render */

/** @type {Record<ScreenName, Render>} */
const SCREENS = {
  help: help.render,
  typical: typical.render,
  categorise: categorise.render,
  buckets: buckets.render,
  transactions: transactions.render,
  transfers: transfers.render,
  accounts: accounts.render,
  categories: categories.render,
  backup: backup.render,
};

/**
 * Called when a screen is entered from the nav (or navigate), not on a redraw after a store
 * change, so a screen can drop view state that should not outlive leaving it.
 * @type {Partial<Record<ScreenName, () => void>>}
 */
const RESETS = {
  typical: typical.reset,
  buckets: buckets.reset,
  transfers: transfers.reset,
  backup: backup.reset,
};

const screenEl = /** @type {HTMLElement} */ (document.getElementById('screen'));
const navEl = /** @type {HTMLElement} */ (document.querySelector('header nav'));
const noticesEl = /** @type {HTMLElement} */ (document.getElementById('notices'));

/**
 * Add a plain error message to the notices area, leaving other notices in place.
 * The technical detail is secondary text.
 * @param {unknown} err
 */
function showError(err) {
  const detail = err instanceof Error ? err.message : String(err);
  noticesEl.append(h('div', { class: 'banner', role: 'alert' },
    h('p', null, 'Something went wrong saving your changes. Nothing was saved.'),
    h('p', { class: 'muted' }, `Details: ${detail}`),
  ));
}

/**
 * First run (no categories and nothing offered yet): add every default category.
 * @param {Store} store
 * @returns {Promise<void>}
 */
async function seed(store) {
  const changes = seedDefaults(defaults, store.state);
  if (changes.put) await store.apply(changes);
}

/** Pending default ids the notice currently shows, so it is only rebuilt when they change. */
let noticeShows = '';

/**
 * Show "New suggested categories" in #notices while any default has not been offered yet,
 * and remove it once there are none. Other notices are left alone.
 * @param {App} app
 */
function showDefaultsNotice(app) {
  const pending = pendingDefaults(app.defaults, app.store.state.settings);
  const ids = pending.map((d) => d.id);
  if (ids.join('\n') === noticeShows) return;
  noticeShows = ids.join('\n');
  noticesEl.querySelector('#defaults-notice')?.remove();
  if (ids.length === 0) return;
  const notice = h('div', { class: 'banner', id: 'defaults-notice' },
    h('p', { id: 'defaults-notice-text' }, `New suggested categories: ${pending.map((d) => d.name).join(', ')}`),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', 'aria-describedby': 'defaults-notice-text', 'data-saves': true,
        onClick: () => whileSaving(notice, () => app.store.apply(acceptDefaults(app.store.state, ids, app.defaults))),
      }, 'Add'),
      h('button', {
        type: 'button', class: 'secondary', 'aria-describedby': 'defaults-notice-text', 'data-saves': true,
        onClick: () => whileSaving(notice, () => app.store.apply(dismissDefaults(app.store.state, ids))),
      }, 'Dismiss')));
  noticesEl.append(notice);
}

/** Focus the current screen's h2. */
function focusHeading() {
  screenEl.querySelector('h2')?.focus();
}

/**
 * @param {Store} store
 * @returns {App}
 */
function createApp(store) {
  /** @type {App} */
  const app = {
    store, tuning, defaults,
    session: {
      skipped: new Set(),
      screen: store.state.transactions.length === 0 || !store.state.settings.helpDismissed ? 'help' : 'typical',
    },
    navigate(name) {
      RESETS[name]?.();
      app.session.screen = name;
      drawScreen(app);
      focusHeading();
    },
    rerender() {
      const active = document.activeElement;
      const key = active instanceof HTMLElement ? active.dataset.focusKey : undefined;
      drawScreen(app);
      const again = key ? keyed(key, screenEl) : undefined;
      if (again) again.focus();
      // Focus that was outside the screen (for example in the nav) and survived stays put.
      else if (!active || active === document.body || !active.isConnected || screenEl.contains(active)) focusHeading();
    },
  };
  return app;
}

/**
 * Render the current screen into #screen and refresh the nav. Does not move focus.
 * @param {App} app
 */
function drawScreen(app) {
  subview.draw(() => {
    clear(screenEl);
    SCREENS[app.session.screen](screenEl, app);
  });
  updateNav(navEl, app);
}

async function start() {
  const opened = await openStore();
  if (opened.kind === 'newer') {
    cannotStart('Your data was saved by a newer version of this app. Reload the page to get it.');
    return;
  }
  if (opened.kind === 'failed') {
    upgradeFailed(opened);
    return;
  }
  const { store } = opened;
  await seed(store);
  const app = createApp(store);
  subview.install();
  renderNav(navEl, app);
  drawScreen(app);
  showDefaultsNotice(app);
  // The notice first, so a removed notice button no longer holds focus when the screen redraws.
  store.subscribe(() => {
    showDefaultsNotice(app);
    app.rerender();
  });
}

/**
 * Show that the app could not start, in place of the screen.
 * @param {unknown} err
 */
function failed(err) {
  const message = err instanceof Error ? err.message : String(err);
  cannotStart(`Saved data could not be opened: ${message}`);
}

/**
 * Show "The app could not start" and `message` in place of the screen, with the technical detail,
 * if any, as secondary text.
 * @param {string} message
 * @param {string} [detail]
 */
function cannotStart(message, detail) {
  clear(screenEl);
  screenEl.append(
    h('h2', { tabindex: '-1' }, 'The app could not start'),
    h('p', null, message),
  );
  if (detail) screenEl.append(h('p', { class: 'muted' }, `Details: ${detail}`));
}

/**
 * The stored data is older and could not be upgraded, so nothing was written.
 * A stub: Task 7 replaces it with a screen that can save a copy or delete the data.
 * @param {Extract<Opened, {kind: 'failed'}>} opened
 */
function upgradeFailed(opened) {
  cannotStart("Your saved data couldn't be upgraded to this version of the app. Nothing was changed.",
    opened.errors.join(' '));
}

const WAITING = 'This app is already open in another tab. Close that tab and this one will load automatically.';

/**
 * Start while holding the 'living-costs' Web Lock, so only one tab works on the saved data at a time:
 * two tabs would each keep their own copy of it and overwrite each other. The lock is held until
 * the tab closes. A tab that has to wait says so, and starts when the lock is granted. Without
 * Web Locks, start now.
 */
function startAlone() {
  if (!navigator.locks) {
    start().catch(failed);
    return;
  }
  let granted = false;
  const waiting = h('p', null, WAITING);
  navigator.locks.request('living-costs', () => {
    granted = true;
    waiting.remove();
    start().catch(failed);
    // Never settles, so the lock is held for the page's lifetime.
    return new Promise(() => {});
  }).catch(() => {
    // The lock could not be requested at all: start as if there were no Web Locks.
    if (granted) return;
    granted = true;
    waiting.remove();
    start().catch(failed);
  });
  // Show the message only while this tab's request is actually waiting, so a tab that gets the
  // lock straight away never shows it. If the query fails, show it anyway unless the lock has
  // been granted: a message that goes when the lock arrives beats a blank screen.
  navigator.locks.query().then(({ pending }) => {
    if (!granted && pending?.some((l) => l.name === 'living-costs')) screenEl.append(waiting);
  }, () => {
    if (!granted) screenEl.append(waiting);
  });
}

window.addEventListener('unhandledrejection', (event) => showError(event.reason));
window.addEventListener('error', (event) => showError(event.error ?? event.message));

startAlone();
