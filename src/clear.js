// Clear categorisation: drop every decision about transactions, keeping what was loaded and set up.

/** @import {State, Changes, Transaction} from './types.js' */
import { emptyState, combine } from './changes.js';
import { assignBuckets } from './buckets.js';

/**
 * Everything to store (for `replaceAll`) once every decision is gone. Settings, categories,
 * accounts (with no repayment buckets), batches and transactions stay. Buckets are rebuilt from
 * the transactions as an import with no decisions would make them, so merges, renames, bucket
 * categories and Stopped marks go. Rules, overrides and transfer pairs go.
 * @param {State} state
 * @returns {Changes}
 */
export function clearDecisions(state) {
  const accounts = state.accounts.map((a) => ({ ...a, repaymentBucketIds: [] }));
  const base = emptyState();
  base.settings = state.settings;
  base.categories = state.categories;
  base.accounts = accounts;
  base.batches = state.batches;
  /** @type {Omit<Transaction,'bucketId'|'flaggedRuleId'>[]} */
  const incoming = state.transactions.map(({ bucketId: _b, flaggedRuleId: _f, ...t }) => t);
  return combine(
    { put: { settings: [state.settings], categories: state.categories, accounts, batches: state.batches } },
    assignBuckets(base, incoming),
  );
}
