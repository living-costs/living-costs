// Typical month screen: the window, stale-account notices, the summary, the uncategorised line,
// one table each for living costs, income and contributions, and the one-offs list.
// Every figure comes from typicalMonth; this only lays it out. A category name opens that
// category's view (category-view.js) in place of the tables.

/** @import {App} from '../main.js' */
/** @import {Row, TypicalMonth} from '../typical.js' */
/** @import {MonthRange} from '../coverage.js' */
/** @import {State} from '../types.js' */
import { h } from '../dom.js';
import { typicalMonth, settleChoices } from '../typical.js';
import { completeMonths } from '../coverage.js';
import { formatMoney } from '../money.js';
import { formatDate, formatMonth } from '../dates.js';
import { help, plural, focusKey, keyed } from './form.js';
import { renderCategoryView, reset as resetCategoryView } from './category-view.js';
import { showing, back } from './subview.js';

/** Screen state that is not saved. It survives redraws; reset() clears it. */
const ui = {
  /** @type {string|null} the category opened from a table */
  openId: null,
  /** @type {MonthRange|null} the chosen window, or null for the latest months */
  range: null,
  /** @type {string|null} the month compared against the window (YYYY-MM) */
  compare: null,
  /** @type {Set<string>} the categories ticked, whose total the summary adds as its last line */
  ticked: new Set(),
};

/**
 * Entering the screen from the nav shows the tables, not a category opened earlier. Redraws
 * after a store change do not call this, so they stay in the category.
 */
export function reset() {
  ui.openId = null;
  resetCategoryView();
}

/** @param {string} id */
const openKey = (id) => `typical-open-${id}`;
/** @param {string} id */
const tickKey = (id) => `typical-tick-${id}`;

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  const state = app.store.state;
  const heading = h('h2', { tabindex: '-1', class: 'visually-hidden' }, 'Typical month');
  const openId = ui.openId;
  if (openId) {
    root.append(heading);
    // Browser back closes the view too, so closing resets it here, not only in its Back button.
    showing(() => {
      ui.openId = null;
      resetCategoryView();
      app.rerender();
      // The category may have left the tables, then its heading is the place to land.
      if (keyed(openKey(openId))) focusKey(openKey(openId));
      else root.querySelector('h2')?.focus();
    });
    renderCategoryView(root, app, openId, back, ui.range);
    return;
  }
  if (state.transactions.length === 0) {
    root.append(heading,
      h('p', null, 'Nothing to show yet. Add your statements on the Accounts screen first.'),
      h('div', { class: 'actions' }, h('button', { type: 'button', onClick: () => app.navigate('accounts') }, 'Go to Accounts')));
    return;
  }
  Object.assign(ui, settleChoices(completeMonths(state, app.tuning), ui));
  const tm = typicalMonth(state, app.tuning, ui);
  if ('mixedCurrencies' in tm) {
    root.append(heading, h('p', null,
      `Your accounts use more than one currency (${tm.currencies.join(', ')}). They aren't added together.`));
    return;
  }
  /** @param {number} minor */
  const money = (minor) => formatMoney(minor, tm.currency);

  root.append(h('hgroup', null, heading, h('p', { id: 'typical-window' }, windowText(tm))));
  if (tm.complete) {
    const complete = completeMonths(state, app.tuning);
    root.append(windowControls(tm, app, complete), compareControls(app, complete));
  }
  const n = tm.months.length;
  if (tm.isDefault && tm.complete && n < app.tuning.windowMonths) {
    root.append(h('p', null, `Only ${plural(n, 'complete month', 'complete months')} so far. Yearly figures are scaled to 12 months.`));
  }
  for (const account of tm.stale) {
    const last = lastCovered(state, account.id);
    root.append(h('p', { class: 'banner' },
      `${account.name} has no statements after ${formatDate(last)}. Its spending there isn't included.`));
  }

  const cmp = tm.compare;
  if (cmp) for (const account of cmp.missing) {
    root.append(h('p', { class: 'banner' },
      `${formatMonth(cmp.month)} has no complete statement for ${account.name}. Its spending that month isn't included.`));
  }

  root.append(summaryList(tm, money, ui.ticked));

  const { spending, income } = tm.uncategorised;
  if (spending !== 0 || income !== 0) {
    root.append(h('div', { class: 'actions uncategorised' },
      h('p', { id: 'typical-uncategorised' },
        `Uncategorised: ${money(spending)} spending and ${money(income)} income over the window are not included.`),
      h('button', { type: 'button', 'aria-describedby': 'typical-uncategorised', onClick: () => app.navigate('categorise') }, 'Categorise')));
  }

  /** @param {string} id */
  const onOpen = (id) => {
    ui.openId = id;
    app.rerender();
    focusKey('category-heading');
  };
  /** @param {string} id @param {boolean} on */
  const onTick = (id, on) => {
    if (on) ui.ticked.add(id); else ui.ticked.delete(id);
    app.rerender();
  };
  const tables = [
    rowsTable('typical-living', 'Living costs', tm.spend, money, onOpen, onTick, cmp?.month),
    rowsTable('typical-income', 'Income', tm.income, money, onOpen, onTick, cmp?.month),
    rowsTable('typical-contributions', 'Contributions', tm.contribution, money, onOpen, onTick, cmp?.month),
  ];
  for (const part of tables) if (part) root.append(part);
  alignColumns([...root.querySelectorAll('table.typical')]);
  if (cmp) root.append(help('Annual categories use the typical figure in the month too, so a yearly bill doesn\'t skew it.'));
  const oneOffs = oneOffList(state, tm, money);
  if (oneOffs) root.append(oneOffs);
}

/**
 * Give each column the width of its widest cell across the tables, so Living costs, Income and
 * Contributions line up. Cells don't wrap, so the screen (in the document while it renders) can
 * measure them here. Widths are set through the CSSOM, which the CSP's style-src allows.
 * @param {Element[]} tables all with the same columns
 * @returns {void}
 */
function alignColumns(tables) {
  const heads = tables.map((t) => [.../** @type {HTMLTableElement} */ (t).tHead?.rows[0].cells ?? []]);
  /** @type {number[]} */
  const widest = [];
  for (const cells of heads) cells.forEach((c, i) => { widest[i] = Math.max(widest[i] ?? 0, c.getBoundingClientRect().width); });
  for (const cells of heads) cells.forEach((c, i) => { c.style.width = `${Math.ceil(widest[i])}px`; });
}

/**
 * "Compare with [month]": No month, then the complete months, newest first.
 * @param {App} app
 * @param {string[]} complete complete months, oldest first
 * @returns {HTMLElement}
 */
function compareControls(app, complete) {
  const select = /** @type {HTMLSelectElement} */ (h('select', {
    id: 'typical-compare', 'data-focus-key': 'typical-compare',
    onChange: () => { ui.compare = select.value || null; app.rerender(); },
  }, h('option', { value: '', selected: ui.compare === null }, 'No month'),
  ...[...complete].reverse().map((m) => h('option', { value: m, selected: m === ui.compare }, formatMonth(m)))));
  return h('div', { class: 'typical-controls' }, h('label', { for: 'typical-compare' }, 'Compare with'), select);
}

/**
 * "same", "£x less" or "£x more" for a difference of month minus typical.
 * @param {number} diff
 * @param {(minor: number) => string} money
 * @returns {string}
 */
export function changeText(diff, money) {
  if (diff === 0) return 'same';
  return diff < 0 ? `${money(-diff)} less` : `${money(diff)} more`;
}

/** @param {number} diff */
const changeClass = (diff) => (diff === 0 ? 'num same' : 'num change');

/**
 * "Typical from [month] to [month]", and a button back to the latest months once a window is chosen.
 * @param {TypicalMonth} tm
 * @param {App} app
 * @param {string[]} complete complete months, oldest first
 * @returns {HTMLElement}
 */
function windowControls(tm, app, complete) {
  const from = tm.months[0];
  const to = tm.months[tm.months.length - 1];
  /**
   * @param {string} key
   * @param {string[]} months
   * @param {string} selected
   * @param {(m: string) => void} onPick
   */
  const picker = (key, months, selected, onPick) => {
    const select = /** @type {HTMLSelectElement} */ (h('select', {
      id: key, 'data-focus-key': key, onChange: () => onPick(select.value),
    }, ...[...months].reverse().map((m) => h('option', { value: m, selected: m === selected }, formatMonth(m)))));
    return select;
  };
  /** @param {string} a @param {string} b */
  const choose = (a, b) => { ui.range = { from: a, to: b }; app.rerender(); };
  return h('div', { class: 'typical-controls' },
    h('label', { for: 'typical-from' }, 'Typical from'),
    picker('typical-from', complete.filter((m) => m <= to), from, (m) => choose(m, to)),
    h('label', { for: 'typical-to' }, 'to'),
    picker('typical-to', complete.filter((m) => m >= from), to, (m) => choose(from, m)),
    tm.isDefault ? null : h('button', {
      type: 'button', class: 'secondary', 'data-focus-key': 'typical-latest',
      onClick: () => { ui.range = null; app.rerender(); focusKey('typical-from'); },
    }, `Latest ${app.tuning.windowMonths} months`));
}

/**
 * "Based on 12 complete months, Nov 2025 to Oct 2026". With no complete month yet, the figures
 * use every month that has transactions, and it says so.
 * @param {TypicalMonth} tm
 * @returns {string}
 */
function windowText(tm) {
  const n = tm.months.length;
  const first = formatMonth(tm.months[0]);
  const last = formatMonth(tm.months[n - 1]);
  const span = first === last ? first : `${first} to ${last}`;
  if (!tm.complete) return `No complete months yet. These figures use every month with transactions, ${span}.`;
  return `Based on ${plural(n, 'complete month', 'complete months')}, ${span}`;
}

/**
 * The last date any of the account's statements covers.
 * @param {State} state
 * @param {string} accountId
 * @returns {string} ISO date
 */
function lastCovered(state, accountId) {
  return state.batches.filter((b) => b.accountId === accountId)
    .reduce((m, b) => (b.coversTo > m ? b.coversTo : m), '');
}

/**
 * The summary card: Income, Living costs and Left over, then Ticked as a second total of its own.
 * With contributions, Living costs is followed by "less contributions from others" and "your share".
 * Ticked is always there: the plain sum of the ticked rows shown in the tables, whichever table
 * they are in, with their names below; with nothing ticked, a dash and a hint. Comparing a month
 * turns the list into a table with the month and Change.
 * @param {TypicalMonth} tm
 * @param {(minor: number) => string} money
 * @param {Set<string>} ticked
 * @returns {HTMLElement}
 */
function summaryList(tm, money, ticked) {
  const t = tm.totals;
  const c = tm.compare;
  /** @type {[string, number, number, string?][]} label, typical, the compared month, class */
  const lines = [['Income', t.income, c?.totals.income ?? 0], ['Living costs', t.living, c?.totals.living ?? 0]];
  if (tm.contribution.length > 0) {
    lines.push(['less contributions from others', t.contributions, c?.totals.contributions ?? 0, 'sub'],
      ['your share', t.share, c?.totals.share ?? 0, 'sub']);
  }
  lines.push(['Left over', t.leftOver, c?.totals.leftOver ?? 0, 'total']);

  const tickedRows = [...tm.spend, ...tm.income, ...tm.contribution].filter((r) => ticked.has(r.categoryId));
  const any = tickedRows.length > 0;
  const tickedLabel = any ? `Ticked (${plural(tickedRows.length, 'category', 'categories')})` : 'Ticked';
  const tickedTypical = tickedRows.reduce((sum, r) => sum + r.perMonth, 0);
  const tickedMonth = tickedRows.reduce((sum, r) => sum + (r.month ?? 0), 0);
  /** A dash for nothing ticked, read as "none". */
  const none = () => [h('span', { 'aria-hidden': 'true' }, '—'), h('span', { class: 'visually-hidden' }, 'none')];
  const which = h('p', { class: 'ticked-which' },
    any ? tickedRows.map((r) => r.name).join(', ') : 'Tick categories below to add them up here.');

  /** @type {HTMLElement} */
  let body;
  if (c) {
    body = h('div', { class: 'scroll summary-scroll', tabindex: '0', role: 'region', 'aria-label': 'Summary per month' }, h('table', { class: 'summary-compare', 'aria-label': 'Summary per month' },
      h('thead', null, h('tr', null, h('td'), h('th', { scope: 'col', class: 'num' }, 'Typical'),
        h('th', { scope: 'col', class: 'num' }, formatMonth(c.month)), h('th', { scope: 'col', class: 'num' }, 'Change'))),
      h('tbody', null,
        ...lines.map(([label, minor, month, cls]) => h('tr', { class: cls },
          h('th', { scope: 'row' }, label),
          h('td', { class: 'num' }, money(minor)),
          h('td', { class: 'num' }, money(month)),
          h('td', { class: changeClass(month - minor) }, changeText(month - minor, money)))),
        h('tr', { class: 'ticked' },
          h('th', { scope: 'row' }, tickedLabel),
          ...(any
            ? [h('td', { class: 'num' }, money(tickedTypical)), h('td', { class: 'num' }, money(tickedMonth)),
              h('td', { class: changeClass(tickedMonth - tickedTypical) }, changeText(tickedMonth - tickedTypical, money))]
            : [h('td', { class: 'num same' }, ...none()), h('td', { class: 'num same' }, ...none()), h('td', { class: 'num same' }, ...none())])))));
  } else {
    body = h('dl', { class: 'summary', 'aria-label': 'Summary per month' },
      ...lines.flatMap(([label, minor, , cls]) => [h('dt', { class: cls }, label), h('dd', { class: cls }, money(minor))]),
      h('dt', { class: 'ticked' }, tickedLabel),
      h('dd', { class: 'ticked' }, ...(any ? [money(tickedTypical)] : none())));
  }
  return h('div', { class: 'summary-panel' }, h('p', { class: 'summary-cap' }, 'Per month'), body, which);
}

/**
 * The Type cell: Fixed, "Variable (£a–£b)" or "Annual (£x a year)".
 * @param {Row} r
 * @param {(minor: number) => string} money
 * @returns {string}
 */
function typeText(r, money) {
  if (r.budgetType === 'fixed') return 'Fixed';
  if (r.budgetType === 'annual') return `Annual (${money(r.perYear)} a year)`;
  return r.range ? `Variable (${money(r.range[0])}–${money(r.range[1])})` : 'Variable';
}

/**
 * One table of rows with a decorative bar sized against the largest row. Nothing when empty.
 * Each row starts with a tick box, and each category name is a button that opens it.
 * @param {string} id the heading's id
 * @param {string} title
 * @param {Row[]} rows largest first
 * @param {(minor: number) => string} money
 * @param {(categoryId: string) => void} onOpen
 * @param {(categoryId: string, on: boolean) => void} onTick
 * @param {string} [month] the compared month (YYYY-MM): adds its column, Change and a second bar
 * @returns {HTMLElement|null}
 */
function rowsTable(id, title, rows, money, onOpen, onTick, month) {
  if (rows.length === 0) return null;
  const largest = Math.max(0, ...rows.flatMap((r) => (month ? [r.perMonth, r.month ?? 0] : [r.perMonth])));
  const label = month ? formatMonth(month) : '';
  return h('section', { 'aria-labelledby': id },
    h('h3', { id }, title),
    month ? h('p', { class: 'bar-key', 'aria-hidden': 'true' },
      h('span', { class: 'key' }, h('span', { class: 'bar' }), 'Typical'),
      h('span', { class: 'key' }, h('span', { class: 'bar month' }), label)) : null,
    h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-labelledby': id },
      h('table', { class: 'typical', 'aria-labelledby': id },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Tick')),
          h('th', { scope: 'col' }, 'Category'), h('th', { scope: 'col' }, 'Type'),
          ...(month
            ? [h('th', { scope: 'col', class: 'num' }, 'Typical'), h('th', { scope: 'col', class: 'num' }, label),
              h('th', { scope: 'col', class: 'num' }, 'Change')]
            : [h('th', { scope: 'col', class: 'num' }, 'Per month'), h('th', { scope: 'col', class: 'num' }, 'Per year')]),
          h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Share of largest')))),
        h('tbody', null, ...rows.map((r) => h('tr', null,
          h('td', { class: 'tick' }, h('input', {
            type: 'checkbox', class: 'select', checked: ui.ticked.has(r.categoryId), 'aria-label': `Tick ${r.name}`,
            'data-focus-key': tickKey(r.categoryId),
            onChange: (/** @type {Event} */ e) => onTick(r.categoryId, /** @type {HTMLInputElement} */ (e.target).checked),
          })),
          h('th', { scope: 'row' }, r.monthOnly ? r.name : h('button', {
            type: 'button', class: 'secondary name', 'data-focus-key': openKey(r.categoryId),
            onClick: () => onOpen(r.categoryId),
          }, r.name)),
          h('td', null, typeText(r, money)),
          ...(month
            ? [h('td', { class: 'num' }, money(r.perMonth)), h('td', { class: 'num' }, money(r.month ?? 0)),
              h('td', { class: changeClass((r.month ?? 0) - r.perMonth) }, changeText((r.month ?? 0) - r.perMonth, money))]
            : [h('td', { class: 'num' }, money(r.perMonth)), h('td', { class: 'num' }, money(r.perYear))]),
          h('td', { class: 'bar-cell' }, month
            ? h('div', { class: 'bars', 'aria-hidden': 'true' }, bar(r.perMonth, largest), bar(r.month ?? 0, largest, 'month'))
            : bar(r.perMonth, largest))))))));
}

/**
 * A decorative bar, `value` as a share of `largest`. Its width is set through the CSSOM, which
 * the CSP's style-src allows.
 * @param {number} value
 * @param {number} largest
 * @param {string} [extra] another class, "month" for the outlined compared-month bar
 * @returns {HTMLElement}
 */
function bar(value, largest, extra) {
  const el = h('span', { class: extra ? `bar ${extra}` : 'bar', 'aria-hidden': 'true' });
  el.style.width = `${largest > 0 ? Math.round((Math.max(0, value) * 100) / largest) : 0}%`;
  return el;
}

/**
 * Date, description, category and amount of each one-off, oldest first. Nothing when empty.
 * @param {State} state
 * @param {TypicalMonth} tm
 * @param {(minor: number) => string} money
 * @returns {HTMLElement|null}
 */
function oneOffList(state, tm, money) {
  if (tm.oneOffs.length === 0) return null;
  const names = new Map(state.categories.map((c) => [c.id, c.name]));
  return h('section', { 'aria-labelledby': 'typical-oneoffs' },
    h('h3', { id: 'typical-oneoffs' }, 'One-offs'),
    help('Not included in living costs.'),
    h('ul', { class: 'plain-list', 'aria-labelledby': 'typical-oneoffs' }, ...tm.oneOffs.map((o) => h('li', null,
      `${formatDate(o.txn.date)} · `,
      h('span', { class: 'raw' }, o.txn.rawText),
      ` · ${names.get(o.categoryId) ?? ''} · ${money(o.amountMinor)}`))));
}
