// Transactions screen: find a transaction by text, amount or date, narrow by bucket and date
// range, and change what it counts as. renderTransactionList is also used inside an opened
// bucket, with the bucket fixed.

/** @import {App} from '../main.js' */
/** @import {Transaction} from '../types.js' */
import { h } from '../dom.js';
import { buildContext } from '../resolve.js';
import { searchTransactions } from '../search.js';
import { orderedCategories } from '../categories.js';
import { formatMoney } from '../money.js';
import { formatDate } from '../dates.js';
import { field, valueOf } from './form.js';
import { countsAsCell, appendSplitDialog } from './counts-as.js';

/** @typedef {{query: string, bucketId: string, from: string, to: string}} View */

/**
 * Each list's search and filters, keyed by its fixed bucket (or 'all'). They survive redraws
 * and leaving the screen.
 * @type {Map<string, View>}
 */
const views = new Map();

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
 * @param {{bucketId?: string}} filters a fixed bucket hides the Bucket filter
 * @returns {void}
 */
export function renderTransactionList(root, app, filters) {
  const state = app.store.state;
  const fixed = filters.bucketId;
  const viewKey = fixed ? `bucket:${fixed}` : 'all';
  const v = views.get(viewKey) ?? { query: '', bucketId: '', from: '', to: '' };
  views.set(viewKey, v);
  if (v.bucketId && !state.buckets.some((b) => b.id === v.bucketId)) v.bucketId = '';
  const p = fixed ? `txns-${fixed}` : 'txns';

  const countEl = h('p', { 'aria-live': 'polite' });
  const results = h('div');
  const update = () => drawResults(app, results, countEl, v, fixed, p);
  /**
   * @param {'query'|'bucketId'|'from'|'to'} key
   * @returns {(e: Event) => void}
   */
  const set = (key) => (e) => { v[key] = valueOf(e); update(); };

  const buckets = [...state.buckets].sort((a, b) => a.displayName.localeCompare(b.displayName));
  root.append(
    h('div', { role: 'search', class: 'row filters' },
      field('Search transactions', h('input', {
        type: 'search', class: 'search', value: v.query, autocomplete: 'off', 'data-focus-key': `${p}-search`, onInput: set('query'),
      }), { hint: 'Text, an amount such as 60.69, or a date such as 24/09.' }),
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
 */
function drawResults(app, results, countEl, v, fixed, prefix) {
  const state = app.store.state;
  const found = searchTransactions(state.transactions, v.query,
    { bucketId: fixed ?? (v.bucketId || undefined), from: v.from || undefined, to: v.to || undefined },
    { matchDays: app.tuning.transactionMatchDays });
  const shown = found.slice(0, app.tuning.transactionsShown);
  countEl.textContent = `Showing ${shown.length} of ${found.length}.`;
  if (shown.length === 0) {
    results.replaceChildren(h('p', null, 'No transactions match.'));
    return;
  }
  const ctx = buildContext(state);
  const cats = orderedCategories(state);
  const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
  /** @param {Transaction} t */
  const row = (t) => h('tr', null,
    h('td', null, formatDate(t.date)),
    h('td', null, accounts.get(t.accountId) ?? ''),
    h('td', null, h('span', { class: 'raw' }, t.rawText)),
    h('td', { class: 'num' }, formatMoney(t.amountMinor, t.currency)),
    h('td', null, countsAsCell(app, t, ctx, cats, prefix)));
  results.replaceChildren(h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': 'Matching transactions' },
    h('table', null,
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Account'), h('th', { scope: 'col' }, 'Description'),
        h('th', { scope: 'col', class: 'num' }, 'Amount'), h('th', { scope: 'col' }, 'Counts as'))),
      h('tbody', null, ...shown.map(row)))));
}
