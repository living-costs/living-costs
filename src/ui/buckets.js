// Buckets screen: every bucket with its total and count over the analysis window, a category
// select per row, search, an Only uncategorised filter, sorting, merging and drill-in to the
// bucket's transactions.
//
// Totals cover every counted transaction, transfers included, since this is the raw list. A
// bucket whose counted rows use more than one currency shows "Several currencies" instead of a
// total. It is never added across currencies, even to sort: by Total it comes after every
// single-currency bucket, by name, and it is never the default name to keep when merging
// alongside a single-currency bucket.

/** @import {App} from '../main.js' */
/** @import {Bucket, Category, Transaction} from '../types.js' */
import { h } from '../dom.js';
import { countedTransactions } from '../progress.js';
import { mergeBuckets, setBucketCategory } from '../buckets.js';
import { sortedCategories } from '../categories.js';
import { formatMoney, currenciesOf, soleCurrency } from '../money.js';
import { cmp, compareNames } from '../order.js';
import { analysisWindow } from '../coverage.js';
import { formatMonth } from '../dates.js';
import { whileSaving, queueSave } from './saving.js';
import { field, focusKey, help, plural, valueOf, showModalWhenConnected } from './form.js';
import { bucketSuggestions } from '../suggest.js';
import { renderTransactionList } from './transactions.js';
import { showing, back } from './subview.js';

/** @typedef {'total'|'name'|'count'} SortKey */
/** @typedef {'ascending'|'descending'} SortDir */
/** @typedef {{survivorId: string, categoryId: string}} MergeDraft */
/**
 * One row: the bucket, how many counted transactions it has, and the one currency they use
 * (null when there are none or several). `sum` is their signed minor sum, and is 0 when they
 * span several currencies (`mixed`), since those are never added together. `zero` is the
 * total shown when nothing is counted.
 * @typedef {{bucket: Bucket, sum: number, count: number, currency: string|null, mixed: boolean, zero: string}} Row
 */

/** The direction a column sorts in when first chosen: names A to Z, numbers largest first. */
/** @type {Record<SortKey, SortDir>} */
const FIRST_DIR = { total: 'descending', name: 'ascending', count: 'descending' };
/** @type {Record<SortKey, string>} */
const SORT_LABELS = { name: 'Name', total: 'Total', count: 'Transactions' };

/**
 * Screen state that is not saved. It survives redraws and leaving the screen, except the open
 * bucket, which reset() clears.
 */
const ui = {
  query: '',
  onlyUncategorised: false,
  /** @type {SortKey} */
  sortKey: 'total',
  /** @type {SortDir} */
  sortDir: 'descending',
  /** @type {Set<string>} bucket ids */
  selected: new Set(),
  /** @type {MergeDraft|null} the merge dialog, when it is showing */
  merge: null,
  /** @type {string|null} the bucket opened for drill-in */
  drillId: null,
};

/**
 * Entering the screen from the nav shows the list, not a bucket opened earlier. Redraws after a
 * store change do not call this, so they stay in the bucket.
 */
export function reset() {
  ui.drillId = null;
}

/** @param {string} id */
const nameKey = (id) => `bucket-name-${id}`;
/** @param {string} id */
const categoryKey = (id) => `bucket-category-${id}`;

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  const state = app.store.state;
  const ids = new Set(state.buckets.map((b) => b.id));
  for (const id of ui.selected) if (!ids.has(id)) ui.selected.delete(id);
  if (ui.drillId && !ids.has(ui.drillId)) ui.drillId = null;
  if (ui.merge && (ui.selected.size < 2 || !ui.selected.has(ui.merge.survivorId))) ui.merge = null;

  root.append(h('h2', { tabindex: '-1' }, 'Buckets'));
  if (state.buckets.length === 0) {
    root.append(
      h('p', null, 'No buckets yet. Add your statements on the Accounts screen first.'),
      h('div', { class: 'actions' }, h('button', { type: 'button', onClick: () => app.navigate('accounts') }, 'Go to Accounts')));
    return;
  }
  const drilled = ui.drillId ? state.buckets.find((b) => b.id === ui.drillId) : undefined;
  if (drilled) {
    drillIn(root, app, drilled);
    return;
  }

  const rows = bucketRows(app);
  const cats = sortedCategories(state);
  const { months } = analysisWindow(state, app.tuning);
  if (months.length > 0) {
    const first = formatMonth(months[0]);
    const last = formatMonth(months[months.length - 1]);
    root.append(
      help('Opening a bucket shows all its transactions.'),
      h('p', { id: 'buckets-window' }, `Totals and counts cover ${first === last ? first : `${first} to ${last}`}.`));
  }
  const results = h('div');
  const update = () => drawList(app, results, rows, cats);
  root.append(
    h('div', { role: 'search', class: 'row filters' },
      field('Search buckets', h('input', {
        type: 'search', class: 'search', value: ui.query, autocomplete: 'off', 'data-focus-key': 'buckets-search',
        onInput: (/** @type {Event} */ e) => { ui.query = valueOf(e); update(); },
      }), { hint: 'Matches the name or any of its texts.' }),
      h('div', { class: 'field toggle' }, h('label', { class: 'choice' },
        h('input', {
          type: 'checkbox', checked: ui.onlyUncategorised, 'data-focus-key': 'buckets-uncategorised',
          onChange: (/** @type {Event} */ e) => {
            ui.onlyUncategorised = /** @type {HTMLInputElement} */ (e.target).checked;
            update();
          },
        }),
        'Only uncategorised'))),
    mergeBar(app),
    results);
  update();
  if (ui.merge) appendMergeDialog(root, app, ui.merge, rows, cats);
}

/**
 * Every bucket with its counted sum, count and currency.
 * @param {App} app
 * @returns {Row[]}
 */
function bucketRows(app) {
  const state = app.store.state;
  /** @type {Map<string, Transaction[]>} */
  const byBucket = new Map();
  /** @type {Map<string, Transaction[]>} every transaction each bucket has, counted or not */
  const own = new Map();
  for (const t of state.transactions) {
    const list = own.get(t.bucketId) ?? [];
    list.push(t);
    own.set(t.bucketId, list);
  }
  for (const t of countedTransactions(state, app.tuning)) {
    const list = byBucket.get(t.bucketId) ?? [];
    list.push(t);
    byBucket.set(t.bucketId, list);
  }
  return state.buckets.map((bucket) => {
    const txns = byBucket.get(bucket.id) ?? [];
    const mixed = currenciesOf(txns).length > 1;
    const ownCurrency = soleCurrency(own.get(bucket.id) ?? []);
    return {
      bucket,
      sum: mixed ? 0 : txns.reduce((s, t) => s + t.amountMinor, 0),
      count: txns.length,
      currency: soleCurrency(txns),
      mixed,
      zero: ownCurrency ? formatMoney(0, ownCurrency) : '0',
    };
  });
}

/**
 * The total as text: signed money, "Several currencies", or a zero total for a bucket with
 * nothing counted (in its own currency when it has just one).
 * @param {Row} r
 * @returns {string}
 */
function totalText(r) {
  if (r.currency) return formatMoney(r.sum, r.currency);
  return r.mixed ? 'Several currencies' : r.zero;
}

/**
 * @param {App} app
 * @param {Bucket} b
 * @returns {boolean}
 */
const isCategorised = (app, b) => b.categoryId !== undefined && app.store.state.categories.some((c) => c.id === b.categoryId);

/**
 * The rows that match the search and filter, in the chosen order. Ties fall back to name, then id.
 * By Total, buckets with several currencies come last in either direction, by name.
 * @param {App} app
 * @param {Row[]} rows
 * @returns {Row[]}
 */
function shownRows(app, rows) {
  const q = ui.query.trim().toLowerCase();
  const matches = (/** @type {Bucket} */ b) => q === ''
    || b.displayName.toLowerCase().includes(q) || b.keys.some((k) => k.toLowerCase().includes(q));
  const byName = (/** @type {Row} */ a, /** @type {Row} */ b) => compareNames(a.bucket.displayName, b.bucket.displayName)
    || cmp(a.bucket.id, b.bucket.id);
  /** @type {Record<SortKey, (a: Row, b: Row) => number>} ascending */
  const compare = {
    name: byName,
    total: (a, b) => Math.abs(a.sum) - Math.abs(b.sum),
    count: (a, b) => a.count - b.count,
  };
  const sign = ui.sortDir === 'ascending' ? 1 : -1;
  /** @type {(a: Row, b: Row) => number} */
  const order = (a, b) => (ui.sortKey === 'total' && (a.mixed || b.mixed)
    ? Number(a.mixed) - Number(b.mixed)
    : sign * compare[ui.sortKey](a, b));
  return rows
    .filter((r) => matches(r.bucket) && !(ui.onlyUncategorised && isCategorised(app, r.bucket)))
    .sort((a, b) => order(a, b) || byName(a, b));
}

/**
 * Merge selected… and how many are selected.
 * @param {App} app
 * @returns {HTMLElement}
 */
function mergeBar(app) {
  const n = ui.selected.size;
  return h('div', { class: 'actions' },
    h('button', {
      type: 'button', disabled: n < 2, 'aria-describedby': 'buckets-selected', 'data-focus-key': 'buckets-merge',
      onClick: () => startMerge(app),
    }, 'Merge selected…'),
    h('p', { id: 'buckets-selected', 'aria-live': 'polite' }, `${plural(n, 'bucket', 'buckets')} selected`));
}

/**
 * Redraw the table, or a message when nothing matches.
 * @param {App} app
 * @param {HTMLElement} results
 * @param {Row[]} rows
 * @param {Category[]} cats
 */
function drawList(app, results, rows, cats) {
  const shown = shownRows(app, rows);
  const suggestions = bucketSuggestions(app.store.state);
  if (shown.length === 0) {
    results.replaceChildren(h('p', null, 'No buckets match.'));
    return;
  }
  /** @param {SortKey} key */
  const header = (key) => h('th', {
    scope: 'col', class: key === 'name' ? null : 'num', 'aria-sort': ui.sortKey === key ? ui.sortDir : null,
  }, h('button', {
    type: 'button', class: 'secondary sort', 'data-focus-key': `buckets-sort-${key}`,
    onClick: () => {
      ui.sortDir = ui.sortKey === key ? (ui.sortDir === 'ascending' ? 'descending' : 'ascending') : FIRST_DIR[key];
      ui.sortKey = key;
      app.rerender();
    },
  }, SORT_LABELS[key]));
  results.replaceChildren(h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-label': 'Buckets' },
    h('table', { class: 'buckets' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Select'), header('name'), header('total'), header('count'),
        h('th', { scope: 'col' }, 'Category'), h('th', { scope: 'col' }, 'Suggested'))),
      h('tbody', null, ...shown.map((r, i) => bucketRow(app, r, cats, shown, i, suggestions))))));
}

/**
 * @param {App} app
 * @param {Row} r
 * @param {Category[]} cats
 * @param {Row[]} shown the rows on screen, in order
 * @param {number} i this row's place in `shown`
 * @param {Map<string, Category>} suggestions the suggested category for each bucket that has one
 * @returns {HTMLElement}
 */
function bucketRow(app, r, cats, shown, i, suggestions) {
  const b = r.bucket;
  const current = cats.some((c) => c.id === b.categoryId) ? b.categoryId : '';
  /** @param {string} value a category id, or '' for none */
  const choose = (value) => {
    // A row that the filter will hide hands focus to its neighbour before the redraw.
    if (ui.onlyUncategorised && value !== '') {
      const next = shown[i + 1] ?? shown[i - 1];
      if (next) focusKey(categoryKey(next.bucket.id));
    }
    // Queued, not dropped, so a second quick change is saved too.
    queueSave(async () => {
      try {
        await app.store.apply(setBucketCategory(app.store.state, b.id, value === '' ? undefined : value));
      } catch (err) {
        // Nothing was saved: redraw so the select shows what the bucket still has.
        app.rerender();
        throw err;
      }
    });
  };
  const select = h('select', {
    'aria-label': `Category for ${b.displayName}`, 'data-focus-key': categoryKey(b.id),
    onChange: (/** @type {Event} */ e) => choose(valueOf(e)),
  },
  ...cats.map((c) => h('option', { value: c.id, selected: c.id === current }, c.name)),
  h('option', { value: '', selected: current === '' }, '(none)'));
  const suggestion = suggestions.get(b.id);
  return h('tr', null,
    h('td', null, h('input', {
      type: 'checkbox', class: 'select', checked: ui.selected.has(b.id), 'aria-label': `Select ${b.displayName}`,
      'data-focus-key': `bucket-select-${b.id}`,
      onChange: (/** @type {Event} */ e) => {
        if (/** @type {HTMLInputElement} */ (e.target).checked) ui.selected.add(b.id);
        else ui.selected.delete(b.id);
        app.rerender();
      },
    })),
    h('th', { scope: 'row' }, h('button', {
      type: 'button', class: 'secondary name', 'data-focus-key': nameKey(b.id),
      onClick: () => {
        ui.drillId = b.id;
        app.rerender();
        focusKey('bucket-heading');
      },
    }, b.displayName)),
    h('td', { class: 'num total' }, totalText(r)),
    h('td', { class: 'num count' }, String(r.count)),
    h('td', null, select),
    h('td', null, ...(suggestion ? [suggestion.name, ' ', h('button', {
      type: 'button', class: 'secondary', 'aria-label': `Accept ${suggestion.name} for ${b.displayName}`,
      'data-focus-key': `bucket-accept-${b.id}`, 'data-saves': true,
      onClick: () => {
        // The row's own select keeps focus when it stays; with the filter on, choose() hands it on.
        if (!ui.onlyUncategorised) focusKey(categoryKey(b.id));
        choose(suggestion.id);
      },
    }, 'Accept')] : [])));
}

/**
 * Show the merge dialog with its defaults: the name of the selected bucket with the largest
 * absolute total, and that bucket's category, else the first selected one that has one.
 * Buckets with several currencies have no total, so one is the default only when every selected
 * bucket has several (then the first).
 * @param {App} app
 */
function startMerge(app) {
  const rows = bucketRows(app).filter((r) => ui.selected.has(r.bucket.id));
  if (rows.length < 2) return;
  const single = rows.filter((r) => !r.mixed);
  const largest = single.length === 0 ? rows[0]
    : single.reduce((best, r) => (Math.abs(r.sum) > Math.abs(best.sum) ? r : best));
  const withCategory = [largest, ...rows].find((r) => isCategorised(app, r.bucket));
  ui.merge = { survivorId: largest.bucket.id, categoryId: withCategory?.bucket.categoryId ?? '' };
  app.rerender();
  focusKey(`merge-name-${largest.bucket.id}`);
}

/**
 * Append the merge dialog to `root` and show it.
 * @param {HTMLElement} root
 * @param {App} app
 * @param {MergeDraft} d
 * @param {Row[]} rows
 * @param {Category[]} cats
 */
function appendMergeDialog(root, app, d, rows, cats) {
  const dialog = mergeDialog(app, d, rows.filter((r) => ui.selected.has(r.bucket.id)), cats);
  root.append(dialog);
  showModalWhenConnected(dialog);
}

/**
 * Name to keep (a radio per selected bucket) and Category (the selected buckets' categories,
 * in category order, plus None), then Merge or Cancel.
 * @param {App} app
 * @param {MergeDraft} d
 * @param {Row[]} chosen the selected buckets' rows
 * @param {Category[]} cats
 * @returns {HTMLElement}
 */
function mergeDialog(app, d, chosen, cats) {
  let merged = false;
  const used = new Set(chosen.map((r) => r.bucket.categoryId));
  const offered = cats.filter((c) => used.has(c.id));
  if (d.categoryId && !offered.some((c) => c.id === d.categoryId)) d.categoryId = '';

  const dialog = h('dialog', {
    'aria-labelledby': 'merge-heading', 'aria-describedby': 'merge-about',
    // Escape and Cancel both end here. A merge sets `merged` first, so this does nothing then.
    onClose: () => {
      if (merged || ui.merge !== d) return;
      ui.merge = null;
      app.rerender();
      focusKey('buckets-merge');
    },
  });
  const mergeButton = h('button', { type: 'submit', 'data-saves': true, 'data-focus-key': 'merge-confirm' }, 'Merge');
  const save = () => whileSaving(dialog, async () => {
    const survivorId = d.survivorId;
    const others = chosen.map((r) => r.bucket.id).filter((id) => id !== survivorId);
    const survivor = chosen.find((r) => r.bucket.id === survivorId)?.bucket;
    if (!survivor) return;
    const changes = mergeBuckets(app.store.state, survivorId, others,
      { displayName: survivor.displayName, categoryId: d.categoryId === '' ? undefined : d.categoryId });
    const selected = new Set(ui.selected);
    merged = true;
    ui.merge = null;
    ui.selected.clear();
    /** @type {HTMLDialogElement} */ (dialog).close();
    focusKey(nameKey(survivorId));
    try {
      await app.store.apply(changes);
    } catch (err) {
      // Nothing was saved: show the dialog again with the same choices.
      for (const id of selected) ui.selected.add(id);
      ui.merge = d;
      app.rerender();
      throw err;
    }
  }, mergeButton);

  dialog.append(
    h('h3', { id: 'merge-heading' }, 'Merge buckets'),
    h('p', { id: 'merge-about' }, `${plural(chosen.length, 'bucket', 'buckets')} become one. Their texts and transactions move to it.`),
    h('form', {
      novalidate: true,
      onSubmit: (/** @type {Event} */ e) => { e.preventDefault(); save(); },
    },
    h('fieldset', null, h('legend', null, 'Name to keep'),
      ...chosen.map((r) => h('label', { class: 'choice' },
        h('input', {
          type: 'radio', name: 'merge-name', value: r.bucket.id, checked: r.bucket.id === d.survivorId,
          'data-focus-key': `merge-name-${r.bucket.id}`,
          onChange: () => { d.survivorId = r.bucket.id; },
        }),
        h('span', { class: 'raw' }, r.bucket.displayName)))),
    field('Category', h('select', {
      'data-focus-key': 'merge-category',
      onChange: (/** @type {Event} */ e) => { d.categoryId = valueOf(e); },
    },
    ...offered.map((c) => h('option', { value: c.id, selected: c.id === d.categoryId }, c.name)),
    h('option', { value: '', selected: d.categoryId === '' }, 'None'))),
    h('div', { class: 'actions' },
      mergeButton,
      h('button', { type: 'button', class: 'secondary', onClick: () => /** @type {HTMLDialogElement} */ (dialog).close() }, 'Cancel'))));
  return dialog;
}

/**
 * One bucket's transactions, with search, and Back to buckets beside its name. Browser back does
 * the same.
 * @param {HTMLElement} root
 * @param {App} app
 * @param {Bucket} b
 */
function drillIn(root, app, b) {
  root.append(h('div', { class: 'view-heading' },
    h('h3', { tabindex: '-1', 'data-focus-key': 'bucket-heading' }, b.displayName),
    h('button', { type: 'button', class: 'secondary', 'data-focus-key': 'bucket-back', onClick: back }, 'Back to buckets')));
  renderTransactionList(root, app, { bucketId: b.id });
  showing(() => {
    ui.drillId = null;
    app.rerender();
    focusKey(nameKey(b.id));
  });
}
