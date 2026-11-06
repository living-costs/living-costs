// The in-memory State, kept in step with IndexedDB. IndexedDB is written first;
// memory changes and subscribers hear about it only once that write has succeeded.

/** @import {State, Changes, Settings, StoreName} from './types.js' */
import { openDb, loadRows, rowsToState, write, STORE_NAMES } from './db.js';
import { applyToState, emptyState } from './changes.js';
import { DATA_VERSION } from './version.js';
import { storedVersion, rowsAsBackup } from './migrate.js';
import { validateBackup, restoreChanges } from './backup.js';

/** @typedef {(changes: Changes) => void} Listener */
/** @typedef {{state: State, apply(changes: Changes): Promise<void>,
 *   replaceAll(changes: Changes): Promise<void>, subscribe(fn: Listener): void}} Store */
/**
 * What opening the saved data gave: a store to start the app on, data from a newer version of the
 * app (left alone), or older data that could not be upgraded (left alone). `copy` is that data as
 * it was stored, in backup format, and `deleteAll` empties every store.
 * @typedef {{kind: 'ready', store: Store} | {kind: 'newer'}
 *   | {kind: 'failed', errors: string[], copy: Record<string, unknown>, deleteAll: () => Promise<void>}} Opened
 */

/**
 * Open the database and load everything into memory. Data from an older version is upgraded and
 * written back in one transaction first; if it can't be upgraded, nothing is written.
 * @param {Date} [now] the export date for the upgrade and for `copy`
 * @returns {Promise<Opened>}
 */
export async function openStore(now = new Date()) {
  /** @type {IDBDatabase} */
  let db;
  try {
    db = await openDb();
  } catch (err) {
    // The database was created by a copy of the app with a higher DB_VERSION.
    if (err instanceof Error && err.name === 'VersionError') return { kind: 'newer' };
    throw err;
  }
  const rows = await loadRows(db);
  const version = storedVersion(rows);
  // The everyday path: nothing to upgrade, nothing written.
  if (version === null || version === DATA_VERSION) return { kind: 'ready', store: makeStore(db, rowsToState(rows)) };
  if (version > DATA_VERSION) return { kind: 'newer' };

  // Older, or a version that can't be read (NaN), which validation refuses.
  const result = validateBackup(rowsAsBackup(rows, version, now));
  if (!result.ok) {
    return {
      kind: 'failed',
      errors: result.errors,
      copy: rowsAsBackup(rows, Number.isNaN(version) ? 1 : version, now),
      deleteAll: () => write(db, {}, STORE_NAMES),
    };
  }
  const changes = restoreChanges(result.data, thisBrowser(rows), { keepLastBackup: true });
  await write(db, changes, STORE_NAMES);
  const state = emptyState();
  applyToState(state, changes);
  return { kind: 'ready', store: makeStore(db, state) };
}

/**
 * The parts of the stored settings row that restoreChanges keeps: helpDismissed, and lastBackupAt
 * when it is a readable date. Defaults when there is no row.
 * @param {Record<StoreName, any[]>} rows
 * @returns {Settings}
 */
function thisBrowser(rows) {
  const settings = emptyState().settings;
  const row = rows.settings.find((r) => typeof r === 'object' && r !== null && r.id === 'settings');
  if (!row) return settings;
  settings.helpDismissed = row.helpDismissed === true;
  const last = row.lastBackupAt;
  if (typeof last === 'string' && !Number.isNaN(Date.parse(last))) settings.lastBackupAt = last;
  return settings;
}

/**
 * @param {IDBDatabase} db
 * @param {State} state
 * @returns {Store}
 */
function makeStore(db, state) {
  /** @type {Listener[]} */
  const listeners = [];

  /** @param {Changes} changes */
  const notify = (changes) => { for (const fn of listeners) fn(changes); };

  /** @type {Store} */
  const store = {
    state,
    async apply(changes) {
      await write(db, changes);
      applyToState(store.state, changes);
      notify(changes);
    },
    async replaceAll(changes) {
      await write(db, changes, STORE_NAMES);
      // Rebuild in place so anything holding `store.state` sees the new data.
      Object.assign(store.state, emptyState());
      applyToState(store.state, changes);
      notify(changes);
    },
    subscribe(fn) { listeners.push(fn); },
  };
  return store;
}
