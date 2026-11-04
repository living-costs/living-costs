// App entry: open the store, seed defaults on first run, build the nav and route.

/** @import {Store} from './store.js' */
import { openStore } from './store.js';
import { h, clear } from './dom.js';
import tuning from './tuning.js';
import defaults from './default-categories.js';
import { renderNav, markCurrent } from './ui/nav.js';
import { whileSaving } from './ui/saving.js';
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
      const again = key ? [...screenEl.querySelectorAll('[data-focus-key]')]
        .find((el) => el instanceof HTMLElement && el.dataset.focusKey === key) : undefined;
      if (again instanceof HTMLElement) again.focus();
      // Focus that was outside the screen (for example in the nav) and survived stays put.
      else if (!active || active === document.body || !active.isConnected || screenEl.contains(active)) focusHeading();
    },
  };
  return app;
}

/**
 * Render the current screen into #screen and mark it in the nav. Does not move focus.
 * @param {App} app
 */
function drawScreen(app) {
  clear(screenEl);
  SCREENS[app.session.screen](screenEl, app);
  markCurrent(navEl, app.session.screen);
}

async function start() {
  const store = await openStore();
  await seed(store);
  const app = createApp(store);
  renderNav(navEl, app);
  drawScreen(app);
  showDefaultsNotice(app);
  // The notice first, so a removed notice button no longer holds focus when the screen redraws.
  store.subscribe(() => {
    showDefaultsNotice(app);
    app.rerender();
  });
}

window.addEventListener('unhandledrejection', (event) => showError(event.reason));
window.addEventListener('error', (event) => showError(event.error ?? event.message));

start().catch((err) => {
  clear(screenEl);
  const message = err instanceof Error ? err.message : String(err);
  screenEl.append(
    h('h2', { tabindex: '-1' }, 'Budgie could not start'),
    h('p', null, `Saved data could not be opened: ${message}`),
  );
});
