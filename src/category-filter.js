import { KINDS, BUDGET_TYPES, isBudgeted } from './categories.js';
import { buildContext, resolve } from './resolve.js';

/** @import {State, Transaction} from './types.js' */

/**
 * Filter values: '' (all), 'none' (uncategorised), 'kind:<kind>', 'type:<budget type>', 'category:<id>'.
 * @param {State} state
 * @param {string} filter
 * @returns {boolean}
 */
export function isValidFilter(state, filter) {
  if (filter === '' || filter === 'none') return true;
  if (filter.startsWith('kind:')) return /** @type {readonly string[]} */ (KINDS).includes(filter.slice(5));
  if (filter.startsWith('type:')) return /** @type {readonly string[]} */ (BUDGET_TYPES).includes(filter.slice(5));
  if (filter.startsWith('category:')) {
    const id = filter.slice(9);
    return state.categories.some((c) => c.id === id);
  }
  return false;
}

/**
 * Does a category id fall in the chosen group? A missing or unknown id is uncategorised.
 * @param {State} state
 * @param {string} filter
 * @returns {(categoryId: string|null|undefined) => boolean}
 */
export function categoryMatcher(state, filter) {
  if (filter === '') return () => true;
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  if (filter === 'none') return (id) => !id || !byId.has(id);
  if (filter.startsWith('kind:')) {
    const kind = filter.slice(5);
    return (id) => (id ? byId.get(id)?.kind === kind : false);
  }
  if (filter.startsWith('type:')) {
    const type = filter.slice(5);
    return (id) => {
      const c = id ? byId.get(id) : undefined;
      return !!c && isBudgeted(c.kind) && c.budgetType === type;
    };
  }
  if (filter.startsWith('category:')) {
    const want = filter.slice(9);
    return (id) => id === want;
  }
  return () => false;
}

/**
 * Does a transaction's "Counts as" put any part of it in the chosen group?
 * @param {State} state
 * @param {string} filter
 * @returns {(t: Transaction) => boolean}
 */
export function transactionMatcher(state, filter) {
  if (filter === '') return () => true;
  const ctx = buildContext(state);
  const inGroup = categoryMatcher(state, filter);
  if (filter === 'none') return (t) => resolve(t, ctx).source === 'none';
  const withTransfers = filter === 'kind:transfer';
  return (t) => {
    const r = resolve(t, ctx);
    if (withTransfers && r.source === 'transfer') return true;
    return r.parts.some((p) => inGroup(p.categoryId));
  };
}
