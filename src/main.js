// App entry: open the store, seed defaults on first run, build the nav and route.

/** @import {Store} from './store.js' */
/** @import {Changes} from './types.js' */
import { openStore } from './store.js';
import { h, clear } from './dom.js';
import tuning from './tuning.js';
import defaults from './default-categories.js';
import { SCREEN_LIST, renderNav, markCurrent } from './ui/nav.js';
import * as help from './ui/help.js';
import * as accounts from './ui/accounts.js';

/** @typedef {'help'|'typical'|'categorise'|'buckets'|'transactions'|'transfers'|'accounts'|'categories'|'backup'} ScreenName */
/** @typedef {{store: Store, tuning: typeof tuning, defaults: typeof defaults,
 *   session: {skipped: Set<string>, screen: ScreenName},
 *   navigate(name: ScreenName): void, rerender(): void}} App */
/** @typedef {(root: HTMLElement, app: App) => void} Render */

/**
 * Until a screen's own module exists, it shows only its heading.
 * @param {string} label
 * @returns {Render}
 */
const placeholder = (label) => (root) => { root.append(h('h2', { tabindex: '-1' }, label)); };

/** @param {ScreenName} name */
const label = (name) => SCREEN_LIST.find((s) => s.name === name)?.label ?? name;

/** @type {Record<ScreenName, Render>} */
const SCREENS = {
  help: help.render,
  typical: placeholder(label('typical')),
  categorise: placeholder(label('categorise')),
  buckets: placeholder(label('buckets')),
  transactions: placeholder(label('transactions')),
  transfers: placeholder(label('transfers')),
  accounts: accounts.render,
  categories: placeholder(label('categories')),
  backup: placeholder(label('backup')),
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
 * Task 17 replaces this with `seedDefaults`.
 * @param {Store} store
 * @returns {Promise<void>}
 */
async function seed(store) {
  const { state } = store;
  if (state.categories.length > 0 || state.settings.offeredDefaultIds.length > 0) return;
  /** @type {Changes} */
  const changes = {
    put: {
      categories: defaults.map((d, i) => ({
        id: crypto.randomUUID(), name: d.name, kind: d.kind,
        ...(d.budgetType ? { budgetType: d.budgetType } : {}),
        defaultId: d.id, position: i,
      })),
      settings: [{ ...state.settings, offeredDefaultIds: defaults.map((d) => d.id) }],
    },
  };
  await store.apply(changes);
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
  store.subscribe(() => app.rerender());
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
