// Backup screen: save a backup file, and restore one after checking it. Restoring replaces
// everything in this browser, after the user confirms.

/** @import {App} from '../main.js' */
import { h } from '../dom.js';
import { formatLocalDate } from '../dates.js';
import { buildBackup, validateBackup, restoreChanges, backupFileName } from '../backup.js';
import { field } from './form.js';
import { whileSaving } from './saving.js';

const WARNING = "A backup saved to Google Drive isn't encrypted. It can include dates, amounts, transaction descriptions and account details.";
const CONFIRM = 'Replace all data in this browser with this backup? Imported statements will need re-importing.';

/** @type {{status: string, errors: string[]}} */
let view = { status: '', errors: [] };

/** Forget the last status and errors (on entering the screen). */
export function reset() {
  view = { status: '', errors: [] };
}

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  const heading = h('h2', { tabindex: '-1' }, 'Backup');
  const last = app.store.state.settings.lastBackupAt;
  const lastShown = last ? formatLocalDate(last) : '';
  const input = h('input', {
    type: 'file', accept: '.json,application/json', 'data-focus-key': 'backup-restore',
    onChange: () => restore(app, root, /** @type {HTMLInputElement} */ (input), heading),
  });
  root.append(
    heading,
    h('p', { id: 'backup-last' }, lastShown ? `Last backup: ${lastShown}` : 'Not backed up yet.'),
    h('p', null, "A backup holds your accounts and column settings, buckets, rules, categories and decisions. It doesn't hold your statements."),
    h('p', { class: 'banner' }, WARNING),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', 'data-saves': true, 'data-focus-key': 'backup-save',
        onClick: () => save(app, root, heading),
      }, 'Save backup')),
    h('p', { role: 'status', class: 'muted' }, view.status),
    h('h3', null, 'Restore'),
    h('p', null, 'Restoring replaces everything this app holds in this browser. Afterwards, add your statements again on the Accounts screen.'),
    field('Restore from backup', input),
  );
  if (view.errors.length) {
    root.append(h('div', { class: 'banner', role: 'alert' },
      h('p', null, "This backup can't be restored. Nothing was changed."),
      h('ul', null, ...view.errors.map((e) => h('li', null, e)))));
  }
}

/**
 * @param {App} app
 * @param {HTMLElement} root
 * @param {HTMLElement} focusTo
 */
function save(app, root, focusTo) {
  return whileSaving(root, async () => {
    const now = new Date();
    const text = JSON.stringify(buildBackup(app.store.state, now), null, 2);
    const outcome = await writeFile(backupFileName(now), text);
    if (outcome === 'cancelled') return;
    const status = outcome === 'fallback' ? 'Backup saved to your Downloads folder instead.' : 'Backup saved.';
    view = { status, errors: [] };
    await app.store.apply({ put: { settings: [{ ...app.store.state.settings, lastBackupAt: now.toISOString() }] } });
  }, focusTo);
}

/**
 * Save through the file picker when there is one. If the user cancels, nothing is saved. Any
 * other picker failure falls back to a download, and so does having no picker.
 * @param {string} name
 * @param {string} text
 * @returns {Promise<'picker'|'download'|'fallback'|'cancelled'>} how the file was saved, if it was
 */
async function writeFile(name, text) {
  const w = /** @type {any} */ (window);
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Living Costs backup', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return 'picker';
    } catch (err) {
      if (/** @type {{name?: unknown}} */ (err ?? {}).name === 'AbortError') return 'cancelled';
      download(name, text);
      return 'fallback';
    }
  }
  download(name, text);
  return 'download';
}

/**
 * Download `text` as a file, through a temporary link to an object URL for our own JSON.
 * @param {string} name
 * @param {string} text
 */
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = /** @type {HTMLAnchorElement} */ (h('a', { download: name, hidden: true }));
  link.href = url;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Read, check and (after confirmation) restore the chosen file.
 * @param {App} app
 * @param {HTMLElement} root
 * @param {HTMLInputElement} input
 * @param {HTMLElement} focusTo
 */
function restore(app, root, input, focusTo) {
  const file = input.files?.[0];
  // Cleared now, so choosing the same file again fires another change.
  input.value = '';
  if (!file) return Promise.resolve();
  return whileSaving(root, async () => {
    /** @param {string[]} errors */
    const refuse = (errors) => {
      view = { status: '', errors };
      app.rerender();
    };
    let text;
    try {
      text = await file.text();
    } catch {
      refuse(['The file could not be read.']);
      return;
    }
    /** @type {unknown} */
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      refuse(["This file isn't valid JSON."]);
      return;
    }
    const result = validateBackup(json);
    if (!result.ok) {
      refuse(result.errors);
      return;
    }
    if (!window.confirm(CONFIRM)) {
      view = { status: 'Nothing was restored.', errors: [] };
      app.rerender();
      return;
    }
    await app.store.replaceAll(restoreChanges(result.data, app.store.state.settings));
    reset();
    app.navigate('help');
    showRestored();
  }, focusTo);
}

/** A short success notice above the screen, with a button to dismiss it. */
function showRestored() {
  const notices = document.getElementById('notices');
  if (!notices) return;
  notices.querySelector('#restore-notice')?.remove();
  const notice = h('div', { class: 'banner', role: 'status', id: 'restore-notice' },
    h('p', null, 'Backup restored. Import your statements again to see your transactions.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'secondary', onClick: () => notice.remove() }, 'Dismiss')));
  notices.append(notice);
}
