// IndexedDB access. Every function here talks only to the local `living-costs` database.

/** @import {State, Changes, StoreName, Settings} from './types.js' */
import { emptyState } from './changes.js';

const DB_NAME = 'living-costs';
const DB_VERSION = 1;

/** @type {Record<StoreName, string>} */
const KEY_PATHS = {
  settings: 'id', accounts: 'id', batches: 'id', transactions: 'id', buckets: 'id',
  rules: 'id', categories: 'id', overrides: 'fingerprint', transferPairs: 'key',
};

/** Every store name, in a fixed order. */
export const STORE_NAMES = /** @type {StoreName[]} */ (Object.keys(KEY_PATHS));

/**
 * Open (and on first use create) the `living-costs` database.
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: KEY_PATHS[name] });
      }
      const tx = /** @type {IDBTransaction} */ (req.transaction);
      const transactions = tx.objectStore('transactions');
      if (!transactions.indexNames.contains('accountId')) transactions.createIndex('accountId', 'accountId');
      if (!transactions.indexNames.contains('batchId')) transactions.createIndex('batchId', 'batchId');
      const batches = tx.objectStore('batches');
      if (!batches.indexNames.contains('fileHash')) batches.createIndex('fileHash', 'fileHash');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('This app is already open in another tab. Close that tab and this one will load automatically.'));
  });
}

/**
 * Read every store into a fresh State.
 * @param {IDBDatabase} db
 * @returns {Promise<State>}
 */
export function loadAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAMES, 'readonly');
    /** @type {Partial<Record<StoreName, IDBRequest<any[]>>>} */
    const reqs = {};
    for (const name of STORE_NAMES) reqs[name] = tx.objectStore(name).getAll();
    tx.oncomplete = () => {
      /** @param {StoreName} name */
      const rows = (name) => /** @type {any[]} */ (/** @type {IDBRequest<any[]>} */ (reqs[name]).result);
      const state = emptyState();
      /** @type {Settings | undefined} */
      const settings = rows('settings').find((s) => s.id === 'settings');
      if (settings) state.settings = settings;
      state.accounts = rows('accounts');
      state.batches = rows('batches');
      state.transactions = rows('transactions');
      state.buckets = rows('buckets');
      state.rules = rows('rules');
      state.categories = rows('categories');
      state.overrides = new Map(rows('overrides').map((o) => [o.fingerprint, o]));
      state.transferPairs = new Map(rows('transferPairs').map((p) => [p.key, p]));
      resolve(state);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Reading saved data was cancelled.'));
  });
}

/**
 * In one readwrite transaction: clear `clearFirst`, then apply every put, then every del.
 * Resolves when the transaction completes; rejects (and nothing is saved) on error or abort.
 * Deleting `settings` is ignored, matching `applyToState`.
 * @param {IDBDatabase} db
 * @param {Changes} changes
 * @param {StoreName[]} [clearFirst]
 * @returns {Promise<void>}
 */
export function write(db, changes, clearFirst = []) {
  const put = changes.put ?? {};
  const del = changes.del ?? {};
  /** @type {Set<StoreName>} */
  const touched = new Set(clearFirst);
  for (const name of /** @type {StoreName[]} */ (Object.keys(put))) if (put[name]?.length) touched.add(name);
  for (const name of /** @type {StoreName[]} */ (Object.keys(del))) {
    if (name !== 'settings' && del[name]?.length) touched.add(name);
  }
  for (const name of touched) {
    if (!(name in KEY_PATHS)) return Promise.reject(new Error(`Unknown store: ${name}`));
  }
  if (touched.size === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([...touched], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Saving was cancelled.'));
    try {
      for (const name of clearFirst) tx.objectStore(name).clear();
      for (const name of /** @type {StoreName[]} */ (Object.keys(put))) {
        for (const row of put[name] ?? []) tx.objectStore(name).put(row);
      }
      for (const name of /** @type {StoreName[]} */ (Object.keys(del))) {
        if (name === 'settings') continue;
        for (const key of del[name] ?? []) tx.objectStore(name).delete(key);
      }
    } catch (err) {
      // A synchronous failure (for example a row with no key) must not leave a partial write.
      try { tx.abort(); } catch { /* already finished */ }
      reject(err);
    }
  });
}

/**
 * Clear the given stores in one transaction.
 * @param {IDBDatabase} db
 * @param {StoreName[]} stores
 * @returns {Promise<void>}
 */
export function clear(db, stores) {
  return write(db, {}, stores);
}
