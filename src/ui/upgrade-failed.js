// The screen shown when stored data is older and could not be upgraded. Nothing has been written, so
// the user can save a copy of it as it was, or delete everything and start afresh.

import { h, clear } from '../dom.js';
import { backupFileName } from '../backup.js';
import { writeFile } from './backup.js';
import { whileSaving, isSaving } from './saving.js';

const FAILURE = "Your saved data couldn't be upgraded to this version of the app. Nothing was changed.";
const WARNING = "A backup saved to Google Drive isn't encrypted. It holds every transaction you've imported: dates, amounts, descriptions and account details.";
const DELETE_CONFIRM = 'Delete all data in this browser? Save a backup first if you might want it.';

/**
 * @param {HTMLElement} root
 * @param {{errors: string[], copy: object, deleteAll: () => Promise<void>}} opened
 * @param {() => void} restart
 * @returns {void}
 */
export function renderUpgradeFailed(root, opened, restart) {
  const heading = h('h2', { tabindex: '-1' }, 'The app could not start');
  const status = h('p', { role: 'status' });
  root.append(
    heading,
    h('p', null, FAILURE),
    h('p', { class: 'muted' }, 'Details:'),
    h('ul', null, ...opened.errors.map((e) => h('li', null, e))),
    h('p', { class: 'banner' }, WARNING),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', 'data-saves': true,
        onClick: () => whileSaving(root, async () => {
          const text = JSON.stringify(opened.copy, null, 2);
          const outcome = await writeFile(backupFileName(new Date()), text);
          if (outcome === 'cancelled') return;
          status.textContent = outcome === 'fallback' ? 'Copy saved to your Downloads folder instead.' : 'Copy saved.';
        }, heading),
      }, 'Save a copy of your data')),
    status,
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', 'data-saves': true,
        onClick: async () => {
          if (isSaving() || !window.confirm(DELETE_CONFIRM)) return;
          await whileSaving(root, async () => {
            await opened.deleteAll();
            restart();
          }, heading);
        },
      }, 'Delete all data and start afresh')),
  );
  heading.focus();
}
