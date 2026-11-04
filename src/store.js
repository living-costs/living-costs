// The in-memory State, kept in step with IndexedDB. IndexedDB is written first;
// memory changes and subscribers hear about it only once that write has succeeded.

/** @import {State, Changes} from './types.js' */
import { openDb, loadAll, write, STORE_NAMES } from './db.js';
import { applyToState, emptyState } from './changes.js';

/** @typedef {(changes: Changes) => void} Listener */
/** @typedef {{state: State, apply(changes: Changes): Promise<void>,
 *   replaceAll(changes: Changes): Promise<void>, subscribe(fn: Listener): void}} Store */

/**
 * Open the database and load everything into memory.
 * @returns {Promise<Store>}
 */
export async function openStore() {
  const db = await openDb();
  const state = await loadAll(db);
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
