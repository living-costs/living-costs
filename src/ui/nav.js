// Top navigation: one button per screen.

/** @import {App, ScreenName} from '../main.js' */
import { h, clear } from '../dom.js';

/** @type {{name: ScreenName, label: string}[]} */
export const SCREEN_LIST = [
  { name: 'help', label: 'Help' },
  { name: 'typical', label: 'Typical month' },
  { name: 'categorise', label: 'Categorise' },
  { name: 'buckets', label: 'Buckets' },
  { name: 'transactions', label: 'Transactions' },
  { name: 'transfers', label: 'Transfers' },
  { name: 'accounts', label: 'Accounts' },
  { name: 'categories', label: 'Categories' },
  { name: 'backup', label: 'Backup' },
];

/**
 * Build the nav buttons once.
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function renderNav(root, app) {
  clear(root);
  for (const { name, label } of SCREEN_LIST) {
    root.append(h('button', { type: 'button', 'data-screen': name, onClick: () => app.navigate(name) }, label));
  }
  markCurrent(root, app.session.screen);
}

/**
 * Set `aria-current="page"` on the current screen's button only.
 * @param {HTMLElement} root
 * @param {string} screen
 * @returns {void}
 */
export function markCurrent(root, screen) {
  for (const button of root.querySelectorAll('button[data-screen]')) {
    if (button.getAttribute('data-screen') === screen) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
