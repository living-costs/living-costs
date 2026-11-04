/** @import {State, Changes, StoreName} from './types.js' */

/** @type {Record<StoreName, string>} */
const KEY_FIELD = {
  settings: 'id', accounts: 'id', batches: 'id', transactions: 'id', buckets: 'id',
  rules: 'id', categories: 'id', overrides: 'fingerprint', transferPairs: 'key',
};

/** @returns {State} */
export function emptyState() {
  return {
    settings: { id: 'settings', schemaVersion: 1, offeredDefaultIds: [], helpDismissed: false },
    accounts: [], batches: [], transactions: [], buckets: [], rules: [], categories: [],
    overrides: new Map(), transferPairs: new Map(),
  };
}

/**
 * @param {object} obj
 * @param {string} field
 * @returns {string}
 */
function keyOf(obj, field) {
  return String(/** @type {Record<string, unknown>} */ (obj)[field]);
}

/**
 * Apply all puts (upsert), then all dels, mutating `state`.
 * @param {State} state
 * @param {Changes} changes
 * @returns {void}
 */
export function applyToState(state, changes) {
  for (const [store, rows] of Object.entries(changes.put ?? {})) {
    const name = /** @type {StoreName} */ (store);
    const field = KEY_FIELD[name];
    for (const row of rows ?? []) {
      if (name === 'settings') {
        state.settings = /** @type {State['settings']} */ (row);
      } else if (name === 'overrides' || name === 'transferPairs') {
        /** @type {Map<string, object>} */ (state[name]).set(keyOf(row, field), row);
      } else {
        const arr = /** @type {object[]} */ (state[name]);
        const k = keyOf(row, field);
        const i = arr.findIndex((r) => keyOf(r, field) === k);
        if (i >= 0) arr[i] = row; else arr.push(row);
      }
    }
  }
  for (const [store, keys] of Object.entries(changes.del ?? {})) {
    const name = /** @type {StoreName} */ (store);
    if (name === 'settings') continue;
    const field = KEY_FIELD[name];
    const gone = new Set(keys ?? []);
    if (name === 'overrides' || name === 'transferPairs') {
      for (const k of gone) /** @type {Map<string, object>} */ (state[name]).delete(k);
    } else {
      const arr = /** @type {object[]} */ (state[name]);
      for (let i = arr.length - 1; i >= 0; i--) if (gone.has(keyOf(arr[i], field))) arr.splice(i, 1);
    }
  }
}

/**
 * Concatenate puts and dels per store, in argument order.
 * @param {...Changes} changes
 * @returns {Changes}
 */
export function combine(...changes) {
  /** @type {Record<string, Record<string, any[]>>} */
  const out = { put: {}, del: {} };
  for (const c of changes) {
    for (const kind of /** @type {const} */ (['put', 'del'])) {
      for (const [store, list] of Object.entries(c[kind] ?? {})) {
        (out[kind][store] ??= []).push(...(list ?? []));
      }
    }
  }
  /** @type {Changes} */
  const result = {};
  if (Object.keys(out.put).length) result.put = out.put;
  if (Object.keys(out.del).length) result.del = out.del;
  return result;
}
