// Per-transaction overrides, keyed by fingerprint. Every function returns Changes and never
// mutates the state it is given.

/** @import {State, Changes, Override, Transaction} from './types.js' */
/** @typedef {{amountMinor:number,categoryId:string}} SplitPart */

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

/**
 * Split one transaction into parts, each with an amount and a category. Clears any category
 * override and keeps the other fields. There must be 2 or more parts, each a non-zero whole
 * number of minor units with the transaction's sign and a known category, summing exactly to
 * the transaction's amount.
 * @param {State} state
 * @param {Transaction} txn
 * @param {SplitPart[]} parts
 * @returns {Changes | {error: string}}
 */
export function setSplit(state, txn, parts) {
  if (!Array.isArray(parts) || parts.length < 2) return { error: 'A split needs two or more parts.' };
  const sign = Math.sign(txn.amountMinor);
  if (sign === 0) return { error: 'A transaction of zero cannot be split.' };
  const known = new Set(state.categories.map((c) => c.id));
  let sum = 0;
  for (const p of parts) {
    if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor === 0) return { error: 'Every part needs an amount.' };
    if (Math.sign(p.amountMinor) !== sign) {
      return { error: `Every part must be ${sign < 0 ? 'money out' : 'money in'}, like the transaction.` };
    }
    if (!p.categoryId || !known.has(p.categoryId)) return { error: 'Every part needs a category.' };
    sum += p.amountMinor;
  }
  if (sum !== txn.amountMinor) return { error: 'The parts must add up to the transaction amount.' };
  const { categoryId: _categoryId, ...rest } = current(state, txn.fingerprint);
  const splits = parts.map((p) => ({ amountMinor: p.amountMinor, categoryId: p.categoryId }));
  return { put: { overrides: [{ ...rest, splits }] } };
}

/**
 * Go back to the bucket's category: remove any category override or split, keeping the other
 * fields (such as unusualDismissed and flagDecision). An override left with nothing else is
 * deleted. No override, no changes.
 * @param {State} state
 * @param {string} fingerprint
 * @returns {Changes}
 */
export function resetOverride(state, fingerprint) {
  if (!state.overrides.has(fingerprint)) return {};
  const { categoryId: _categoryId, splits: _splits, ...rest } = current(state, fingerprint);
  if (Object.keys(rest).length === 1) return { del: { overrides: [fingerprint] } };
  return { put: { overrides: [rest] } };
}
