// An opened category on Typical month: why its figure is what it is. A line that explains the
// figure, its total for each month (per account when there are several), for Fixed what each
// bucket adds with a Stopped tick, and the transactions that count as it. Every figure comes from
// categoryDetail, the same pass and row builder as the Typical month tables.

/** @import {App} from '../main.js' */
/** @import {CategoryKind} from '../types.js' */
/** @import {CategoryDetail, BucketLine, AccountSeries} from '../typical.js' */
import { h } from '../dom.js';
import { categoryDetail } from '../typical.js';
import { setBucketStopped, stoppedDateFor } from '../buckets.js';
import { formatMoney } from '../money.js';
import { formatDate, formatMonth, monthOf } from '../dates.js';
import { help, plural, focusKey, KIND_WORDS } from './form.js';
import { whileSaving, isSaving } from './saving.js';
import { renderTransactionList, listView } from './transactions.js';

/**
 * View state that is not saved: the category shown, the month cell pressed, if any, and whether
 * the last draw had anything to show. It survives redraws; opening a different category, Back,
 * and leaving the screen reset it.
 * @type {{categoryId: string, month: {month: string, accountId: string}|null, shown: boolean}}
 */
const view = { categoryId: '', month: null, shown: false };

/** Forget the view state, so the next opening starts with no month pressed. */
export function reset() {
  view.categoryId = '';
  view.month = null;
  view.shown = false;
}

/** Whether the element that last took focus was in the view. Set once the view first draws. */
let focusInView = false;
let tracking = false;

/** Note where focus goes, so a redraw can tell focus lost from the view from focus elsewhere. */
function trackFocus() {
  if (tracking) return;
  tracking = true;
  document.addEventListener('focusin', (e) => {
    focusInView = e.target instanceof Element && e.target.closest('.category-view') !== null;
  });
}

/**
 * The one line that explains the figure, in terms of its budget type. The amounts are the Row's
 * own. With one account it names the account's month count; with several, how they combine.
 * @param {CategoryDetail} detail
 * @param {CategoryKind} kind
 * @param {(minor: number) => string} m
 * @returns {string}
 */
export function explanation(detail, kind, m) {
  const { row, accounts } = detail;
  const K = KIND_WORDS[kind];
  const [lo, hi] = row.range ?? [0, 0];
  if (accounts.length > 1) {
    if (row.budgetType === 'fixed') {
      return `${K} · Fixed · ${m(row.perMonth)} a month: each charge's latest amount, as often as it was charged in its account's months.`;
    }
    if (row.budgetType === 'annual') {
      return `${K} · Annual · ${m(row.perYear)} a year: each account's yearly total, scaled to 12 months and added together, so ${m(row.perMonth)} a month.`;
    }
    return `${K} · Variable · ${m(row.perMonth)} a month: each account's median month, added together. Typical range ${m(lo)} to ${m(hi)}.`;
  }
  const n = (accounts[0]?.cells ?? []).filter((c) => c.total !== null).length;
  const months = plural(n, 'month', 'months');
  if (row.budgetType === 'fixed') {
    return `${K} · Fixed · ${m(row.perMonth)} a month: each charge's latest amount, as often as it was charged in these ${months}.`;
  }
  if (row.budgetType === 'annual') {
    const scaled = n < 12 ? ' Yearly figures are scaled to 12 months.' : '';
    return `${K} · Annual · ${m(row.perYear)} a year over these ${months}, so ${m(row.perMonth)} a month.${scaled}`;
  }
  return `${K} · Variable · ${m(row.perMonth)} a month, the median of these ${months}. Typical range ${m(lo)} to ${m(hi)}.`;
}

/**
 * Render the opened category into `screen`, ending with Back to Typical month.
 * @param {HTMLElement} screen
 * @param {App} app
 * @param {string} categoryId
 * @param {() => void} onBack
 * @returns {void}
 */
export function renderCategoryView(screen, app, categoryId, onBack) {
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
  const detail = categoryDetail(state, app.tuning, categoryId);
  const name = detail?.row.name ?? category?.name ?? 'Category';
  const backButton = h('div', { class: 'actions' }, h('button', {
    type: 'button', class: 'secondary', 'data-focus-key': 'category-back', onClick: () => { reset(); onBack(); },
  }, 'Back to Typical month'));
  const root = h('div', { class: 'category-view' });
  screen.append(root);
  root.append(h('h3', { tabindex: '-1', 'data-focus-key': 'category-heading' }, name));

  const emptied = view.shown;
  view.shown = !!(detail && category);
  if (!detail || !category) {
    root.append(h('p', { tabindex: '-1', 'data-focus-key': 'category-empty' }, `Nothing counts as ${name} in these months now.`),
      backButton);
    // The view has just emptied, usually by an edit made in it. Once App.rerender has put focus
    // back, move focus that is still in the view (or was lost) to the line that says why.
    if (emptied) {
      queueMicrotask(() => {
        const active = document.activeElement;
        if (!active || active === document.body || screen.contains(active)) focusKey('category-empty');
      });
    }
    return;
  }

  /** @param {number} minor */
  const money = (minor) => formatMoney(minor, detail.currency);
  const accountNames = new Map(state.accounts.map((a) => [a.id, a.name]));
  const bucketNames = new Map(state.buckets.map((b) => [b.id, b.displayName]));
  const several = detail.accounts.length > 1;
  const listKey = `category:${categoryId}`;

  const pressed = view.month;
  if (pressed && !detail.accounts.some((a) => a.accountId === pressed.accountId
    && a.cells.some((c) => c.month === pressed.month && c.total !== null))) view.month = null;

  root.append(h('p', { id: 'category-explanation' }, explanation(detail, category.kind, money)));

  root.append(h('section', { 'aria-labelledby': 'category-each-month' },
    h('h4', { id: 'category-each-month' }, 'Each month'),
    ...detail.accounts.flatMap((a) => monthCells(app, a, several, accountNames, money, detail.row.budgetType === 'annual'))));

  if (detail.row.budgetType === 'fixed') root.append(bucketSection(app, root, detail, money, several, accountNames, bucketNames, listKey));

  const txns = state.transactions.filter((t) => detail.transactionIds.has(t.id));
  const month = view.month;
  const ids = new Set(txns.filter((t) => !month || (t.accountId === month.accountId && monthOf(t.date) === month.month)).map((t) => t.id));
  const list = h('section', { 'aria-labelledby': 'category-transactions' },
    h('h4', { id: 'category-transactions', tabindex: '-1', 'data-focus-key': 'category-transactions' }, 'Transactions'));
  root.append(list);
  renderTransactionList(list, app, {
    only: {
      key: listKey, ids, bucketIds: [...new Set(txns.map((t) => t.bucketId))], categoryName: name, partMinor: detail.partMinor,
    },
  });
  root.append(backButton);
  // An edit in the view, such as Counts as on a row, can remove the control that had focus, and
  // App.rerender then puts focus on the screen heading. Land in the Transactions section instead.
  if (lostFrom) {
    queueMicrotask(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active === screen.querySelector('h2')) focusKey('category-transactions');
    });
  }
}

/**
 * One account's month cells: a toggle button per covered month, and "not covered" for the rest.
 * With several accounts, a label with the account's share comes first.
 * @param {App} app
 * @param {AccountSeries} a
 * @param {boolean} several
 * @param {Map<string, string>} accountNames
 * @param {(minor: number) => string} money
 * @param {boolean} annual the share is a yearly figure
 * @returns {HTMLElement[]}
 */
function monthCells(app, a, several, accountNames, money, annual) {
  const labelId = several ? `category-account-${a.accountId}` : 'category-each-month';
  const cells = h('div', { class: 'month-cells', role: 'group', 'aria-labelledby': labelId }, ...a.cells.map((c) => {
    if (c.total === null) return h('span', { class: 'muted uncovered' }, formatMonth(c.month), h('br'), 'not covered');
    const on = view.month?.month === c.month && view.month.accountId === a.accountId;
    return h('button', {
      type: 'button', class: c.unusual ? 'secondary unusual' : 'secondary', 'aria-pressed': String(on),
      'data-focus-key': `category-month-${a.accountId}-${c.month}`,
      onClick: () => {
        view.month = on ? null : { month: c.month, accountId: a.accountId };
        app.rerender();
      },
    }, formatMonth(c.month), h('br'), money(c.total), c.unusual ? h('span', { class: 'visually-hidden' }, ', unusual') : null);
  }));
  if (!several) return [cells];
  const share = annual ? `${money(a.share)} a year` : money(a.share);
  return [h('p', { id: labelId, class: 'account-share' }, `${accountNames.get(a.accountId) ?? ''}: ${share}`), cells];
}

/**
 * By bucket, for Fixed: what each bucket adds, a toggle that narrows the list to it, and a
 * Stopped tick for each bucket with a charge.
 * @param {App} app
 * @param {HTMLElement} root the view, the scope for whileSaving
 * @param {CategoryDetail} detail
 * @param {(minor: number) => string} money
 * @param {boolean} several
 * @param {Map<string, string>} accountNames
 * @param {Map<string, string>} bucketNames
 * @param {string} listKey
 * @returns {HTMLElement}
 */
function bucketSection(app, root, detail, money, several, accountNames, bucketNames, listKey) {
  const chosen = listView(listKey).bucketId;
  /** @param {BucketLine} line */
  const stoppedBox = (line, /** @type {string} */ name) => h('input', {
    type: 'checkbox', class: 'select', checked: line.stopped,
    'aria-label': several ? `Stopped: ${name}, ${accountNames.get(line.accountId) ?? ''}` : `Stopped: ${name}`,
    'data-focus-key': `category-stopped-${line.bucketId}-${line.accountId}`,
    onChange: (/** @type {Event} */ e) => {
      const box = /** @type {HTMLInputElement} */ (e.target);
      // Another save is in flight: whileSaving would ignore this one, so undo the tick too.
      if (isSaving()) {
        box.checked = !box.checked;
        return;
      }
      whileSaving(root, async () => {
        const after = box.checked ? stoppedDateFor(app.store.state, line.bucketId) : undefined;
        try {
          await app.store.apply(setBucketStopped(app.store.state, line.bucketId, after));
        } catch (err) {
          // Nothing was saved: redraw so the tick shows what the bucket still has.
          app.rerender();
          throw err;
        }
      });
    },
  });
  /** @param {BucketLine} line */
  const bucketRow = (line) => {
    const name = bucketNames.get(line.bucketId) ?? '';
    const charged = line.count > 0;
    return h('tr', { class: line.stopped ? 'stopped' : null },
      h('th', { scope: 'row' }, h('button', {
        type: 'button', class: 'secondary name', 'aria-pressed': String(chosen === line.bucketId),
        'data-focus-key': `category-bucket-${line.bucketId}-${line.accountId}`,
        onClick: () => {
          const v = listView(listKey);
          v.bucketId = v.bucketId === line.bucketId ? '' : line.bucketId;
          app.rerender();
        },
      }, name)),
      several ? h('td', null, accountNames.get(line.accountId) ?? '') : null,
      h('td', { class: 'num' }, charged ? money(line.latest) : 'None'),
      h('td', { class: 'num' }, String(line.count)),
      h('td', null, charged ? formatDate(line.latestDate) : 'None'),
      h('td', { class: 'num' }, money(line.perMonth)),
      h('td', null, charged ? stoppedBox(line, name) : null));
  };
  const col = (/** @type {string} */ text, num = false) => h('th', { scope: 'col', class: num ? 'num' : null }, text);
  return h('section', { 'aria-labelledby': 'category-by-bucket' },
    h('h4', { id: 'category-by-bucket' }, 'By bucket'),
    h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'category-by-bucket' },
      h('table', { class: 'buckets', 'aria-labelledby': 'category-by-bucket' },
        h('thead', null, h('tr', null,
          col('Bucket'), several ? col('Account') : null, col('Latest charge', true), col('Charges', true),
          col('Last charged'), col('Adds per month', true), col('Stopped'))),
        h('tbody', null, ...detail.buckets.map(bucketRow)))),
    help('Mark a charge Stopped only if it has ended and nothing replaced it. If another bucket took over, such as after a name change, leave both as they are, or merge them on Buckets so the latest amount is used.'));
}
