import { resolveUnpaired } from './resolve.js';

/** @import {State} from './types.js' */
/** @import {ResolveContext} from './resolve.js' */

/** @typedef {{savingsAccountId:string, categoryId:string|null}} SavingSide */

export const ACCOUNT_ROW_PREFIX = 'account:';

/** @param {string} accountId */
export function accountRowId(accountId) {
  return ACCOUNT_ROW_PREFIX + accountId;
}

/**
 * Which confirmed pairs count as saving: exactly one side is in a Savings account.
 * `sides` is keyed by the fingerprint of the other (counting) side.
 * @param {State} state
 * @param {ResolveContext} ctx
 * @returns {{savingsAccounts:Set<string>, sides:Map<string, SavingSide>}}
 */
export function savingsContext(state, ctx) {
  const savingsAccounts = new Set(state.accounts.filter((a) => a.kind === 'savings').map((a) => a.id));
  /** @type {Map<string, SavingSide>} */
  const sides = new Map();
  if (savingsAccounts.size === 0) return { savingsAccounts, sides };
  const byFingerprint = new Map(state.transactions.map((t) => [t.fingerprint, t]));
  for (const p of state.transferPairs.values()) {
    if (p.status !== 'confirmed') continue;
    const a = byFingerprint.get(p.fingerprintA);
    const b = byFingerprint.get(p.fingerprintB);
    if (!a || !b) continue;
    const aSaving = savingsAccounts.has(a.accountId);
    if (aSaving === savingsAccounts.has(b.accountId)) continue;
    const counted = aSaving ? b : a;
    const savingsAccountId = aSaving ? a.accountId : b.accountId;
    const r = resolveUnpaired(counted, ctx);
    const id = r.source === 'override' || r.source === 'bucket'
      ? r.parts[0].categoryId
      : r.source === 'split' ? ctx.buckets.get(counted.bucketId)?.categoryId ?? null : null;
    const categoryId = id && ctx.categories.get(id)?.kind === 'saving' ? id : null;
    sides.set(counted.fingerprint, { savingsAccountId, categoryId });
  }
  return { savingsAccounts, sides };
}
