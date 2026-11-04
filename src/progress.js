// Categorising progress and the categorise card's queue. Both use the counted transactions:
// those in months their account fully covers in the analysis window (decision D1).
//
// Currency caveat: the absolute totals here add minor units across currencies. They are used
// only to order buckets and, by the UI, as money when every counted transaction shares one
// currency (see soleCurrency in money.js). Never show them as money otherwise.

/** @import {State, Transaction, Bucket} from './types.js' */
/** @import {ResolveContext} from './resolve.js' */
import { analysisWindow } from './coverage.js';
import { buildContext, resolve } from './resolve.js';
import { monthOf } from './dates.js';
import { divRound } from './money.js';
import { cmp, compareNames } from './order.js';

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
 * Buckets with nothing counted are absent. `absTotal` sums across currencies (see the caveat at
 * the top): it is for ordering, and for display only when the bucket has a single currency.
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
 * Both totals sum across currencies (see the caveat at the top), so they are shown as money only
 * when the counted transactions share one currency.
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
 * buckets are left out. Equal totals fall back to name order. The ordering totals sum across
 * currencies (see the caveat at the top).
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
    .sort((a, b) => total(b) - total(a) || compareNames(a.displayName, b.displayName) || cmp(a.id, b.id));
}

/**
 * About how much a bucket comes to a month, by D1: each account's absolute counted total divided
 * by the number of months that account counts, rounded with divRound, then summed. An account
 * counting no months contributes nothing. `months` is the month count when every contributing
 * account has the same one, otherwise null. Sums across currencies, like `absTotal`.
 * @param {BucketCount} count
 * @param {Map<string, Set<string>>} accountMonths from analysisWindow
 * @returns {{perMonth:number, months:number|null}}
 */
export function monthlyFigure(count, accountMonths) {
  /** @type {Map<string, number>} */
  const byAccount = new Map();
  for (const t of count.txns) byAccount.set(t.accountId, (byAccount.get(t.accountId) ?? 0) + Math.abs(t.amountMinor));
  let perMonth = 0;
  const counts = new Set();
  for (const [accountId, total] of byAccount) {
    const n = accountMonths.get(accountId)?.size ?? 0;
    counts.add(n);
    if (n > 0) perMonth += divRound(total, n);
  }
  return { perMonth, months: counts.size === 1 ? [...counts][0] : null };
}
