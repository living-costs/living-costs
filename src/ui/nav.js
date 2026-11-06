// Top navigation: the three main screens as tabs, and the other six as two small labelled
// groups. Transfers is highlighted with a count while suggestions remain, and Categorise shows
// how much is categorised by value. Both labels are refreshed on every redraw (updateNav).

/** @import {App, ScreenName} from '../main.js' */
import { h, clear } from '../dom.js';
import { suggestPairs } from '../transfers.js';
import { categorisedPercent } from '../progress.js';
import { renderThemePicker } from './theme.js';

/** @typedef {{name: ScreenName, label: string}} NavScreen */

/** @type {{id: string, label: string|null, screens: NavScreen[]}[]} */
export const NAV_GROUPS = [
  { id: 'main', label: null, screens: [
    { name: 'help', label: 'Help' },
    { name: 'typical', label: 'Typical month' },
    { name: 'categorise', label: 'Categorise' },
  ] },
  { id: 'review', label: 'Review', screens: [
    { name: 'buckets', label: 'Buckets' },
    { name: 'transactions', label: 'Transactions' },
    { name: 'transfers', label: 'Transfers' },
  ] },
  { id: 'setup', label: 'Set up', screens: [
    { name: 'accounts', label: 'Accounts' },
    { name: 'categories', label: 'Categories' },
    { name: 'backup', label: 'Backup' },
  ] },
];

/**
 * Build the nav once: the main tabs first (in reading order), then the small groups, which
 * the stylesheet places on the title row.
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function renderNav(root, app) {
  clear(root);
  /** @param {NavScreen} screen */
  const button = ({ name, label }) => h('button', { type: 'button', 'data-screen': name, onClick: () => app.navigate(name) },
    h('span', { class: 'nav-label' }, label), h('span', { class: 'nav-extra' }));
  const [main, ...small] = NAV_GROUPS;
  root.append(
    h('div', { class: 'nav-tabs' }, ...main.screens.map(button)),
    h('div', { class: 'nav-tools' }, ...small.map((g) => h('div', { class: 'nav-group', role: 'group', 'aria-labelledby': `nav-${g.id}` },
      h('span', { class: 'nav-group-label', id: `nav-${g.id}` }, g.label),
      h('div', { class: 'nav-row' }, ...g.screens.map(button)))),
      themeGroup()),
  );
  updateNav(root, app);
}

/**
 * The rightmost group: the Auto, Light or Dark theme choice, in the same style as the others.
 * @returns {HTMLElement}
 */
function themeGroup() {
  const group = h('div', { class: 'nav-group', role: 'group', 'aria-labelledby': 'nav-theme' });
  renderThemePicker(group);
  return group;
}

/**
 * Mark the current screen, and refresh the Transfers count and the Categorise percent.
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function updateNav(root, app) {
  markCurrent(root, app.session.screen);
  const { state } = app.store;

  const transfers = extra(root, 'transfers');
  const suggestions = suggestPairs(state, app.tuning).length;
  transfers.button.classList.toggle('attention', suggestions > 0);
  transfers.slot.replaceChildren(...(suggestions > 0 ? [' ', h('span', { class: 'count' }, String(suggestions))] : []));
  // An explicit name, since hidden text in the button would add stray spaces to it.
  if (suggestions > 0) transfers.button.setAttribute('aria-label', `Transfers, ${suggestions} ${suggestions === 1 ? 'suggestion' : 'suggestions'}`);
  else transfers.button.removeAttribute('aria-label');

  const categorise = extra(root, 'categorise');
  const percent = categorisedPercent(state, app.tuning);
  categorise.slot.replaceChildren(...(percent === null ? [] : [' ', h('span', { class: 'pct' }, `(at ${percent}%)`)]));
}

/**
 * A screen's nav button and the slot after its label.
 * @param {HTMLElement} root
 * @param {ScreenName} screen
 */
function extra(root, screen) {
  const button = /** @type {HTMLElement} */ (root.querySelector(`button[data-screen="${screen}"]`));
  return { button, slot: /** @type {HTMLElement} */ (button.querySelector('.nav-extra')) };
}

/**
 * Set `aria-current="page"` on the current screen's button only.
 * @param {HTMLElement} root
 * @param {string} screen
 * @returns {void}
 */
function markCurrent(root, screen) {
  for (const button of root.querySelectorAll('button[data-screen]')) {
    if (button.getAttribute('data-screen') === screen) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
