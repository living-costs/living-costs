// Colour theme toggle: Auto (follow the OS and browser), Light or Dark. A display preference for
// this browser only, so it lives in localStorage, not in the data store or backups.

import { h, clear } from '../dom.js';

/** Same key as in theme-init.js. */
export const THEME_KEY = 'living-costs-theme';

/** @typedef {'auto'|'light'|'dark'} Theme */
/** @type {{value: Theme, label: string}[]} */
const CHOICES = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** @returns {Theme} */
export function savedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch { return 'auto'; }
}

/**
 * Apply a theme to the page and remember it. Auto removes the override and the saved value.
 * @param {Theme} theme
 * @returns {void}
 */
export function setTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch { /* storage blocked: applies for this page only */ }
}

/**
 * Fill the nav's theme group (a label and three buttons).
 * @param {HTMLElement} root
 * @returns {void}
 */
export function renderThemePicker(root) {
  const draw = () => {
    const current = savedTheme();
    clear(root);
    root.append(
      h('span', { class: 'nav-group-label', id: 'nav-theme' }, 'Theme'),
      h('div', { class: 'nav-row' }, ...CHOICES.map(({ value, label }) => h('button', {
        type: 'button', 'aria-pressed': String(value === current),
        onClick: () => { setTheme(value); draw(); },
      }, label))),
    );
  };
  draw();
}
