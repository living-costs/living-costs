// Categorising progress and the categorise card's queue. Both use the counted transactions:
// those in months their account fully covers in the analysis window (decision D1).

/** @import {State, Transaction, Bucket} from './types.js' */
/** @import {ResolveContext} from './resolve.js' */
import { analysisWindow } from './coverage.js';
import { buildContext, resolve } from './resolve.js';
import { monthOf } from './dates.js';

/** @typedef {{windowMonths:number, coverageGapDays:number}} ProgressTuning */
/** @typedef {{absTotal:number, txns:Transaction[]}} BucketCount */

/**
 * Transactions whose month is in the window for their account.
 * @param {State} state
 * @param {ProgressTuning} tuning
 * @returns {Transaction[]}
 */
export function countedTransactions(state, tuning) {
  const { accountMonths } = analysisWindow(state, tuning);
  return state.transactions.filter((t) => accountMonths.get(t.accountId)?.has(monthOf(t.date)) ?? false);
}

/**
 * Counted transactions that are not confirmed transfers.
 * @param {State} state
 * @param {ProgressTuning} tuning
 * @param {ResolveContext} ctx
 * @returns {Transaction[]}
 */
const countedSpending = (state, tuning, ctx) => countedTransactions(state, tuning).filter((t) => !ctx.paired.has(t.fingerprint));

/**
 * Per bucket: the counted transactions (not confirmed transfers) and their absolute total.
 * Buckets with nothing counted are absent.
 * @param {State} state
 * @param {ProgressTuning} tuning
 * @returns {Map<string, BucketCount>}
 */
export function bucketCounts(state, tuning) {
  const ctx = buildContext(state);
  /** @type {Map<string, BucketCount>} */
  const out = new Map();
  for (const t of countedSpending(state, tuning, ctx)) {
    const entry = out.get(t.bucketId) ?? { absTotal: 0, txns: [] };
    entry.absTotal += Math.abs(t.amountMinor);
    entry.txns.push(t);
    out.set(t.bucketId, entry);
  }
  return out;
}

/**
 * Value categorised so far, by absolute amount, and how many buckets are still waiting.
 * A part with a category of any kind (including transfer and ignore) counts as categorised.
 * @param {State} state
 * @param {ProgressTuning} tuning
 * @returns {{categorisedAbs:number, totalAbs:number, bucketsLeft:number}}
 */
export function progress(state, tuning) {
  const ctx = buildContext(state);
  let categorisedAbs = 0;
  let totalAbs = 0;
  for (const t of countedSpending(state, tuning, ctx)) {
    for (const part of resolve(t, ctx).parts) {
      const abs = Math.abs(part.amountMinor);
      totalAbs += abs;
      if (part.categoryId) categorisedAbs += abs;
    }
  }
  return { categorisedAbs, totalAbs, bucketsLeft: cardQueue(state, tuning, new Set()).length };
}

/**
 * Buckets for the card, largest absolute counted total first: uncategorised buckets with
 * something counted, plus any bucket with a flagged row waiting for a decision. Skipped
 * buckets are left out. Equal totals fall back to name order.
 * @param {State} state
 * @param {ProgressTuning} tuning
 * @param {Set<string>} skipped bucket ids
 * @returns {Bucket[]}
 */
export function cardQueue(state, tuning, skipped) {
  const ctx = buildContext(state);
  const counts = bucketCounts(state, tuning);
  const flagged = new Set(state.transactions.filter((t) => t.flaggedRuleId).map((t) => t.bucketId));
  const total = (/** @type {Bucket} */ b) => counts.get(b.id)?.absTotal ?? 0;
  return state.buckets
    .filter((b) => {
      if (skipped.has(b.id)) return false;
      if (flagged.has(b.id)) return true;
      const categorised = b.categoryId !== undefined && ctx.categories.has(b.categoryId);
      return !categorised && total(b) > 0;
    })
    .sort((a, b) => total(b) - total(a)
      || (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
