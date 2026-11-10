// Transactions screen: find a transaction by text, amount or date, narrow by bucket and date
// range, and change what it counts as. renderTransactionList is also used inside an opened
// bucket, with the bucket fixed.

/** @import {App} from '../main.js' */
/** @import {Transaction} from '../types.js' */
import { h } from '../dom.js';
import { buildContext, resolve } from '../resolve.js';
import { searchTransactions } from '../search.js';
import { sortedCategories } from '../categories.js';
import { formatMoney } from '../money.js';
import { cmp, compareNames } from '../order.js';
import { formatDate } from '../dates.js';
import { field, valueOf, focusKey, keyed } from './form.js';
import { categoryFilterField } from './category-filter.js';
import { isValidFilter, transactionMatcher, categoryMatcher } from '../category-filter.js';
import { countsAsCell, appendSplitDialog } from './counts-as.js';

/** @typedef {{query: string, category: string, bucketId: string, from: string, to: string}} View */

/**
 * Each list's search and filters, keyed by its fixed bucket (or 'all'). They survive redraws
 * and leaving the screen.
 * @type {Map<string, View>}
 */
const views = new Map();

/**
 * Limits a list to some transactions. key: the view key (stored in `views`), ids: the
 * transactions allowed, bucketIds: the Bucket filter's options, partMinor: each split
 * transaction's signed sum in categoryName (a split row with no entry shows no such note).
 * @typedef {{key: string, ids: Set<string>, bucketIds: string[], categoryName: string, partMinor: Map<string, number>}} Only
 */

/**
 * The stored View for a key, created empty if missing.
 * @param {string} key
 * @returns {View}
 */
export function listView(key) {
  const v = views.get(key) ?? { query: '', category: '', bucketId: '', from: '', to: '' };
  views.set(key, v);
  return v;
}

/**
 * Drop a list's stored search and filters, so it next opens empty.
 * @param {string} key
 * @returns {void}
 */
export function forgetListView(key) {
  views.delete(key);
}

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  root.append(h('h2', { tabindex: '-1' }, 'Transactions'));
  if (app.store.state.transactions.length === 0) {
    root.append(
      h('p', null, 'No transactions yet. Add your statements on the Accounts screen first.'),
      h('div', { class: 'actions' }, h('button', { type: 'button', onClick: () => app.navigate('accounts') }, 'Go to Accounts')));
    return;
  }
  renderTransactionList(root, app, {});
}

/**
 * Search, filters and results with a Counts as control per row. Typing or changing a filter
 * redraws only the results, so focus and text are kept.
 * @param {HTMLElement} root
 * @param {App} app
 * @param {{bucketId?: string, only?: Only}} filters a fixed bucket hides the Bucket filter; `only` limits the list to
 *   some transactions and the Bucket filter to some buckets
 * @returns {void}
 */
export function renderTransactionList(root, app, filters) {
  const state = app.store.state;
  const fixed = filters.bucketId;
  const only = filters.only;
  const v = listView(only ? only.key : fixed ? `bucket:${fixed}` : 'all');
  const filtered = !fixed && !only;
  if (filtered && !isValidFilter(state, v.category)) v.category = '';
  // The Bucket options are the buckets with a transaction in the chosen category group.
  const inGroup = filtered && v.category ? transactionMatcher(state, v.category) : null;
  const groupBucketIds = inGroup ? new Set(state.transactions.filter(inGroup).map((t) => t.bucketId)) : null;
  if (groupBucketIds && v.bucketId && !groupBucketIds.has(v.bucketId)) v.bucketId = '';
  if (v.bucketId && (!state.buckets.some((b) => b.id === v.bucketId) || (only && !only.bucketIds.includes(v.bucketId)))) v.bucketId = '';
  const p = only ? `txns-${only.key}` : fixed ? `txns-${fixed}` : 'txns';

  const countEl = h('p', { 'aria-live': 'polite' });
  const results = h('div');
  const update = () => drawResults(app, results, countEl, v, fixed, p, only);
  /**
   * @param {'query'|'bucketId'|'from'|'to'} key
   * @returns {(e: Event) => void}
   */
  const set = (key) => (e) => { v[key] = valueOf(e); update(); };

  const buckets = state.buckets.filter((b) => (!only || only.bucketIds.includes(b.id)) && (!groupBucketIds || groupBucketIds.has(b.id))).sort((a, b) => compareNames(a.displayName, b.displayName) || cmp(a.id, b.id));
  root.append(
    h('div', { role: 'search', class: 'row filters' },
      field('Search transactions', h('input', {
        type: 'search', class: 'search', value: v.query, autocomplete: 'off', 'data-focus-key': `${p}-search`, onInput: set('query'),
      }), { hint: 'Text, an amount such as 60.69, or a date such as 24/09.' }),
      filtered ? categoryFilterField(state, {
        value: v.category, uncategorised: true, focusKey: `${p}-category`,
        onChange: (value) => { v.category = value; app.rerender(); },
      }) : null,
      fixed ? null : field('Bucket', h('select', { 'data-focus-key': `${p}-bucket`, onChange: set('bucketId') },
        h('option', { value: '', selected: v.bucketId === '' }, 'All buckets'),
        ...buckets.map((b) => h('option', { value: b.id, selected: b.id === v.bucketId }, b.displayName)))),
      field('From', h('input', { type: 'date', value: v.from, 'data-focus-key': `${p}-from`, onInput: set('from') })),
      field('To', h('input', { type: 'date', value: v.to, 'data-focus-key': `${p}-to`, onInput: set('to') }))),
    countEl,
    results);
  update();
  appendSplitDialog(root, app, p);
}

/**
 * Redraw the results and the count line.
 * @param {App} app
 * @param {HTMLElement} results
 * @param {HTMLElement} countEl
 * @param {View} v
 * @param {string|undefined} fixed
 * @param {string} prefix the list's prefix for ids and focus keys
 * @param {Only|undefined} only
 */
function drawResults(app, results, countEl, v, fixed, prefix, only) {
  const state = app.store.state;
  let found = searchTransactions(state.transactions, v.query,
    { bucketId: fixed ?? (v.bucketId || undefined), from: v.from || undefined, to: v.to || undefined },
    { matchDays: app.tuning.transactionMatchDays });
  if (only) found = found.filter((t) => only.ids.has(t.id));
  else if (!fixed && v.category) found = found.filter(transactionMatcher(state, v.category));
  const shown = found.slice(0, app.tuning.transactionsShown);
  countEl.textContent = `Showing ${shown.length} of ${found.length}.`;
  if (shown.length === 0) {
    results.replaceChildren(h('p', null, 'No transactions match.'));
    return;
  }
  const ctx = buildContext(state);
  const cats = sortedCategories(state);
  const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
  const category = !fixed && !only ? v.category : '';
  const matches = category ? categoryMatcher(state, category) : null;
  /**
   * Before a change that the Category filter will hide, move focus to a neighbour row's Counts as
   * (or, with none, to the Category select), so the redraw keeps it.
   * @param {Transaction} t
   * @param {number} i
   * @param {string|undefined} categoryId
   */
  const leaving = (t, i, categoryId) => {
    if (!matches || matches(categoryId)) return;
    const near = [...shown.slice(i + 1), ...shown.slice(0, i).reverse()].map((n) => `${prefix}-counts-${n.id}`).find((k) => keyed(k));
    focusKey(near ?? `${prefix}-category`);
  };
  /**
   * @param {Transaction} t
   * @param {number} i
   */
  const row = (t, i) => h('tr', null,
    h('td', null, formatDate(t.date)),
    h('td', null, accounts.get(t.accountId) ?? ''),
    h('td', null, h('span', { class: 'raw' }, t.rawText)),
    h('td', { class: 'num' }, formatMoney(t.amountMinor, t.currency)),
    h('td', null, countsAsCell(app, t, ctx, cats, prefix, (id) => leaving(t, i, id)),
      only?.partMinor.has(t.id) && resolve(t, ctx).source === 'split'
        ? h('span', { class: 'muted' }, `${formatMoney(only.partMinor.get(t.id) ?? 0, t.currency)} of this counts as ${only.categoryName}`)
        : null));
  results.replaceChildren(h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': 'Matching transactions' },
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Account'), h('th', { scope: 'col' }, 'Description'),
        h('th', { scope: 'col', class: 'num' }, 'Amount'), h('th', { scope: 'col' }, 'Counts as'))),
      h('tbody', null, ...shown.map(row)))));
}
