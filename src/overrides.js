// Per-transaction overrides, keyed by fingerprint. Every function returns Changes and never
// mutates the state it is given.

/** @import {State, Changes, Override} from './types.js' */

/**
 * The existing override for a fingerprint, copied, or a new empty one.
 * @param {State} state
 * @param {string} fingerprint
 * @returns {Override}
 */
const current = (state, fingerprint) => ({ ...(state.overrides.get(fingerprint) ?? {}), fingerprint });

/**
 * Move one transaction to a category. Clears any split and keeps the other fields.
 * @param {State} state
 * @param {string} fingerprint
 * @param {string} categoryId
 * @returns {Changes}
 */
export function setCategoryOverride(state, fingerprint, categoryId) {
  const { splits: _splits, ...rest } = current(state, fingerprint);
  return { put: { overrides: [{ ...rest, categoryId }] } };
}

/**
 * Mark one transaction's amount as normal, so it is no longer shown as unusual.
 * @param {State} state
 * @param {string} fingerprint
 * @returns {Changes}
 */
export function dismissUnusual(state, fingerprint) {
  return { put: { overrides: [{ ...current(state, fingerprint), unusualDismissed: true }] } };
}
