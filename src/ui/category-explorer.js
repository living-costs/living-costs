// A category opened from the Categories screen: what is in it, whatever its kind or budget type.
// A summary line, its total for each month of every account, the buckets that feed it, and the
// transactions that count as it. Every figure comes from categoryContents. Not a budget: no
// median, range or Stopped marks, which belong to the category opened on Typical month.

/** @import {App} from '../main.js' */
/** @import {Category} from '../types.js' */
/** @import {CategoryContents, ContentsBucket} from '../explore.js' */
/** @import {PressedMonth} from './month-grid.js' */
import { h } from '../dom.js';
import { categoryContents } from '../explore.js';
import { isBudgeted } from '../categories.js';
import { formatMoney } from '../money.js';
import { formatDate, formatMonth, monthOf } from '../dates.js';
import { KIND_LABELS, BUDGET_LABELS, plural, focusKey } from './form.js';
import { renderTransactionList, listView, forgetListView } from './transactions.js';
import { monthGrid } from './month-grid.js';

/** The focus key of a category's name button on the Categories table. @param {string} id */
export const openKey = (id) => `category-open-${id}`;

/** @param {string} categoryId */
const listKey = (categoryId) => `explore:${categoryId}`;

/**
 * View state that is not saved: the category shown, the month cell pressed, if any, and whether
 * the last draw had anything to show. It survives redraws; Back, browser back and leaving the
 * screen reset it.
 * @type {{categoryId: string, month: PressedMonth|null, shown: boolean}}
 */
const view = { categoryId: '', month: null, shown: false };

/** Whether the element that last took focus was in the view. Set once the view first draws. */
let focusInView = false;
let tracking = false;

/** Note where focus goes, so a redraw can tell focus lost from the view from focus elsewhere. */
function trackFocus() {
  if (tracking) return;
  tracking = true;
  document.addEventListener('focusin', (e) => {
    focusInView = e.target instanceof Element && e.target.closest('.category-explorer') !== null;
  });
}

/** Forget the pressed month and the open category's list filters. */
export function reset() {
  if (view.categoryId) forgetListView(listKey(view.categoryId));
  view.categoryId = '';
  view.month = null;
  view.shown = false;
}

/**
 * "£X out and £Y in", leaving out a side with nothing in it.
 * @param {{out: number, in: number}} sums
 * @param {(minor: number) => string} money
 * @returns {string}
 */
function outAndIn(sums, money) {
  const sides = [];
  if (sums.out !== 0) sides.push(`${money(sums.out)} out`);
  if (sums.in !== 0) sides.push(`${money(sums.in)} in`);
  return sides.join(' and ');
}

/**
 * The one summary line: kind (and budget type, when the kind has one), how many transactions in
 * how many buckets, money out and in, and the months they span.
 * @param {CategoryContents} contents
 * @param {Category} category
 * @param {(minor: number) => string} money
 * @returns {string}
 */
export function summaryText(contents, category, money) {
  const kind = [KIND_LABELS[category.kind]];
  if (isBudgeted(category.kind) && category.budgetType) kind.push(BUDGET_LABELS[category.budgetType]);
  const months = contents.from === contents.to
    ? formatMonth(contents.from) : `${formatMonth(contents.from)} to ${formatMonth(contents.to)}`;
  const counts = `${plural(contents.count, 'transaction', 'transactions')} in ${plural(contents.buckets.length, 'bucket', 'buckets')}`;
  return `${kind.join(' · ')} · ${[counts, outAndIn(contents, money), months].filter(Boolean).join(', ')}.`;
}

/**
 * Render the opened category into `screen`, with Back to Categories beside its name.
 * @param {HTMLElement} screen
 * @param {App} app
 * @param {string} categoryId
 * @param {() => void} onBack
 * @returns {void}
 */
export function renderCategoryExplorer(screen, app, categoryId, onBack) {
  trackFocus();
  // Focus was in this category's view before the redraw that is now drawing it again.
  const lostFrom = view.categoryId === categoryId && view.shown && focusInView;
  if (view.categoryId !== categoryId) {
    view.categoryId = categoryId;
    view.month = null;
    view.shown = false;
  }
  const state = app.store.state;
  const category = state.categories.find((c) => c.id === categoryId);
  const contents = categoryContents(state, app.tuning, categoryId);
  const name = category?.name ?? 'Category';
  const root = h('div', { class: 'category-explorer' });
  screen.append(root);
  root.append(h('div', { class: 'view-heading' },
    h('h3', { tabindex: '-1', 'data-focus-key': 'explore-heading' }, name),
    h('button', { type: 'button', class: 'secondary', 'data-focus-key': 'explore-back', onClick: onBack }, 'Back to Categories')));

  const emptied = view.shown;
  view.shown = !!(contents && category);
  if (!contents || !category) {
    root.append(h('p', { tabindex: '-1', 'data-focus-key': 'explore-empty' }, `Nothing counts as ${name} now.`));
    // The view has just emptied, usually by an edit made in it. Once App.rerender has put focus
    // back, move focus that is still in the view (or was lost) to the line that says why.
    if (emptied) {
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!active || active === document.body || screen.contains(active)) focusKey('explore-empty');
      });
    }
    return;
  }

  const currency = contents.currency;
  /** @param {number} minor */
  const money = (minor) => formatMoney(minor, currency ?? '');
  const accountNames = new Map(state.accounts.map((a) => [a.id, a.name]));
  const key = listKey(categoryId);

  const pressed = view.month;
  if (pressed && !contents.accounts.some((a) => a.accountId === pressed.accountId
    && a.cells.some((c) => c.month === pressed.month && c.total !== null))) view.month = null;
  if (!currency) view.month = null;

  if (currency) {
    root.append(h('p', { id: 'explore-summary' }, summaryText(contents, category, money)));
    const sums = new Map(contents.accounts.map((a) => [a.accountId, a]));
    root.append(h('section', { 'aria-labelledby': 'explore-each-month' },
      h('h4', { id: 'explore-each-month' }, 'Each month'),
      monthGrid({
        prefix: 'explore', series: contents.accounts, money, pressed: view.month,
        label: (accountId) => {
          const a = sums.get(accountId);
          return `${accountNames.get(accountId) ?? ''}: ${a ? outAndIn(a, money) : ''}`;
        },
        onToggle: (next) => { view.month = next; app.rerender(); },
      })));
  } else {
    root.append(h('p', { id: 'explore-summary' }, 'Totals need a single currency.'));
  }

  root.append(bucketSection(app, contents, money, key));

  const month = view.month;
  const txns = state.transactions.filter((t) => contents.transactionIds.has(t.id));
  const ids = new Set(txns.filter((t) => !month || (t.accountId === month.accountId && monthOf(t.date) === month.month)).map((t) => t.id));
  const list = h('section', { 'aria-labelledby': 'explore-transactions' },
    h('h4', { id: 'explore-transactions', tabindex: '-1', 'data-focus-key': 'explore-transactions' }, 'Transactions'));
  root.append(list);
  renderTransactionList(list, app, {
    only: {
      key, ids, bucketIds: contents.buckets.map((b) => b.bucketId), categoryName: name, partMinor: contents.partMinor,
    },
  });
  // An edit in the view, such as Counts as on a row, can remove the control that had focus, and
  // App.rerender then puts focus on the screen heading. Land in the Transactions section instead.
  if (lostFrom) {
    queueMicrotask(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active === screen.querySelector('h2')) focusKey('explore-transactions');
    });
  }
}

/**
 * By bucket: each bucket with something here, a toggle that narrows the list to it, how many
 * transactions, their total (when there is one currency) and the latest date.
 * @param {App} app
 * @param {CategoryContents} contents
 * @param {(minor: number) => string} money
 * @param {string} key the list's view key
 * @returns {HTMLElement}
 */
function bucketSection(app, contents, money, key) {
  const chosen = listView(key).bucketId;
  const names = new Map(app.store.state.buckets.map((b) => [b.id, b.displayName]));
  const totals = contents.currency !== null;
  /** @param {ContentsBucket} b */
  const bucketRow = (b) => h('tr', null,
    h('th', { scope: 'row' },
      h('button', {
        type: 'button', class: 'secondary name', 'aria-pressed': String(chosen === b.bucketId),
        'data-focus-key': `explore-bucket-${b.bucketId}`,
        onClick: () => {
          const v = listView(key);
          v.bucketId = v.bucketId === b.bucketId ? '' : b.bucketId;
          app.rerender();
        },
      }, names.get(b.bucketId) ?? b.bucketId),
      b.moved > 0 ? h('span', { class: 'muted' }, ` (${b.moved} moved here)`) : null),
    h('td', { class: 'num' }, String(b.count)),
    totals ? h('td', { class: 'num' }, money(b.total)) : null,
    h('td', null, formatDate(b.latestDate)));
  const col = (/** @type {string} */ text, num = false) => h('th', { scope: 'col', class: num ? 'num' : null }, text);
  return h('section', { 'aria-labelledby': 'explore-by-bucket' },
    h('h4', { id: 'explore-by-bucket' }, 'By bucket'),
    h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'explore-by-bucket' },
      h('table', { class: 'buckets', 'aria-labelledby': 'explore-by-bucket' },
        h('thead', null, h('tr', null,
          col('Bucket'), col('Transactions', true), totals ? col('Total', true) : null, col('Last'))),
        h('tbody', null, ...contents.buckets.map(bucketRow)))));
}
