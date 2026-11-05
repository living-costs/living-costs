// Help screen. The text is static in index.html (#help-content); this shows a copy of it.

/** @import {App} from '../main.js' */
import { h } from '../dom.js';

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  const source = document.getElementById('help-content');
  /** @type {HTMLElement | null} */
  let content = null;
  if (source) {
    content = /** @type {HTMLElement} */ (source.cloneNode(true));
    content.removeAttribute('id');
    content.hidden = false;
  }
  const { settings } = app.store.state;
  const gotIt = settings.helpDismissed ? null : h('button', {
    type: 'button',
    'data-focus-key': 'help-got-it',
    onClick: () => app.store.apply({ put: { settings: [{ ...app.store.state.settings, helpDismissed: true }] } }),
  }, 'Got it');
  root.append(
    h('h2', { tabindex: '-1', class: 'visually-hidden' }, 'Help'),
    content ?? h('p', null, 'Help text is missing.'),
    h('div', { class: 'actions' },
      gotIt,
      h('button', { type: 'button', 'data-focus-key': 'help-import', onClick: () => app.navigate('accounts') },
        'Import a statement'),
    ),
  );
}
