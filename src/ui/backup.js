// Backup screen: save a backup file, restore one after checking it, and delete loaded data.
// Restoring and deleting replace everything this app holds in this browser, after the user confirms.

/** @import {App} from '../main.js' */
import { h } from '../dom.js';
import { formatLocalDate } from '../dates.js';
import { buildBackup, validateBackup, restoreChanges, backupFileName } from '../backup.js';
import { firstRunChanges } from '../categories.js';
import { field, help } from './form.js';
import { whileSaving, isSaving } from './saving.js';
import { resetImport } from './import.js';

const WARNING = "A backup saved to Google Drive isn't encrypted. It can include dates, amounts, transaction descriptions and account details.";
const CONFIRM = 'Replace all data in this browser with this backup? Imported statements will need re-importing.';
const DELETE_CONFIRM = 'Delete all data in this browser? Save a backup first if you might want it.';

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
    help("A backup holds your accounts and column settings, buckets, rules, categories and decisions. It doesn't hold your statements."),
    h('p', { class: 'banner' }, WARNING),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', 'data-saves': true, 'data-focus-key': 'backup-save',
        onClick: () => save(app, root, heading),
      }, 'Save backup')),
    h('p', { role: 'status' }, view.status),
    h('h3', null, 'Restore'),
    help('Restoring replaces everything this app holds in this browser. Afterwards, add your statements again on the Accounts screen.'),
    field('Restore from backup', input),
    h('h3', null, 'Delete loaded data'),
    help('This removes everything this app holds in this browser.'),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', 'data-saves': true, 'data-focus-key': 'backup-delete',
        onClick: () => deleteAll(app, root, heading),
      }, 'Delete loaded data')),
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
    resetImport();
    app.navigate('help');
    showNotice('Backup restored. Import your statements again to see your transactions.');
  }, focusTo);
}

/**
 * After confirmation, replace everything with exactly what a first visit stores, then show Help.
 * The confirm comes first (as Undo's does), so declining leaves focus on the button.
 * @param {App} app
 * @param {HTMLElement} root
 * @param {HTMLElement} focusTo
 */
async function deleteAll(app, root, focusTo) {
  if (isSaving() || !window.confirm(DELETE_CONFIRM)) return;
  await whileSaving(root, async () => {
    await app.store.replaceAll(firstRunChanges(app.defaults));
    reset();
    resetImport();
    app.navigate('help');
    showNotice('All data deleted.');
  }, focusTo);
}

/**
 * A short success notice above the screen, with a button to dismiss it. It replaces the last one.
 * @param {string} text
 */
function showNotice(text) {
  const notices = document.getElementById('notices');
  if (!notices) return;
  notices.querySelector('#backup-notice')?.remove();
  const notice = h('div', { class: 'banner', role: 'status', id: 'backup-notice' },
    h('p', null, text),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'secondary', onClick: () => notice.remove() }, 'Dismiss')));
  notices.append(notice);
}
