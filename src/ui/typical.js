// Typical month screen: the window, stale-account notices, the summary, the uncategorised line,
// one table each for living costs, income and contributions, and the one-offs list.
// Every figure comes from typicalMonth; this only lays it out.

/** @import {App} from '../main.js' */
/** @import {Row, TypicalMonth} from '../typical.js' */
/** @import {State} from '../types.js' */
import { h } from '../dom.js';
import { typicalMonth } from '../typical.js';
import { formatMoney } from '../money.js';
import { formatDate, formatMonth } from '../dates.js';
import { plural } from './form.js';

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  const state = app.store.state;
  const heading = h('h2', { tabindex: '-1' }, 'Typical month');
  if (state.transactions.length === 0) {
    root.append(heading,
      h('p', null, 'Nothing to show yet. Add your statements on the Accounts screen first.'),
      h('div', { class: 'actions' }, h('button', { type: 'button', onClick: () => app.navigate('accounts') }, 'Go to Accounts')));
    return;
  }
  const tm = typicalMonth(state, app.tuning);
  if ('mixedCurrencies' in tm) {
    root.append(heading, h('p', null,
      `Your accounts use more than one currency (${tm.currencies.join(', ')}). Budgie doesn't add them together.`));
    return;
  }
  /** @param {number} minor */
  const money = (minor) => formatMoney(minor, tm.currency);

  root.append(h('hgroup', null, heading, h('p', { id: 'typical-window' }, windowText(tm))));
  const n = tm.months.length;
  if (tm.complete && n < app.tuning.windowMonths) {
    root.append(h('p', null, `Only ${plural(n, 'complete month', 'complete months')} so far. Yearly figures are scaled to 12 months.`));
  }
  for (const account of tm.stale) {
    const last = lastCovered(state, account.id);
    root.append(h('p', { class: 'banner' },
      `${account.name} has no statements after ${formatDate(last)}. Its spending there isn't included.`));
  }

  root.append(summaryList(tm, money));

  const { spending, income } = tm.uncategorised;
  if (spending !== 0 || income !== 0) {
    root.append(h('div', { class: 'actions uncategorised' },
      h('p', { id: 'typical-uncategorised' },
        `Uncategorised: ${money(spending)} spending and ${money(income)} income over the window are not included.`),
      h('button', { type: 'button', 'aria-describedby': 'typical-uncategorised', onClick: () => app.navigate('categorise') }, 'Categorise')));
  }

  for (const part of [
    rowsTable('typical-living', 'Living costs', tm.spend, money),
    rowsTable('typical-income', 'Income', tm.income, money),
    rowsTable('typical-contributions', 'Contributions', tm.contribution, money),
    oneOffList(state, tm, money),
  ]) if (part) root.append(part);
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
 * Income, Living costs and Left over. With contributions, Living costs is followed by
 * "less contributions from others" and "your share".
 * @param {TypicalMonth} tm
 * @param {(minor: number) => string} money
 * @returns {HTMLElement}
 */
function summaryList(tm, money) {
  const t = tm.totals;
  /** @type {[string, number, string?][]} */
  const lines = [['Income', t.income], ['Living costs', t.living]];
  if (tm.contribution.length > 0) {
    lines.push(['less contributions from others', t.contributions, 'sub'], ['your share', t.share, 'sub']);
  }
  lines.push(['Left over', t.leftOver]);
  return h('dl', { class: 'summary', 'aria-label': 'Summary per month' },
    ...lines.flatMap(([label, minor, cls]) => [h('dt', { class: cls }, label), h('dd', { class: cls }, money(minor))]));
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
 * @param {string} id the heading's id
 * @param {string} title
 * @param {Row[]} rows largest first
 * @param {(minor: number) => string} money
 * @returns {HTMLElement|null}
 */
function rowsTable(id, title, rows, money) {
  if (rows.length === 0) return null;
  const largest = Math.max(0, ...rows.map((r) => r.perMonth));
  return h('section', { 'aria-labelledby': id },
    h('h3', { id }, title),
    h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-labelledby': id },
      h('table', { class: 'typical', 'aria-labelledby': id },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Category'), h('th', { scope: 'col' }, 'Type'),
          h('th', { scope: 'col', class: 'num' }, 'Per month'), h('th', { scope: 'col', class: 'num' }, 'Per year'),
          h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Share of largest')))),
        h('tbody', null, ...rows.map((r) => h('tr', null,
          h('th', { scope: 'row' }, r.name),
          h('td', null, typeText(r, money)),
          h('td', { class: 'num' }, money(r.perMonth)),
          h('td', { class: 'num' }, money(r.perYear)),
          h('td', { class: 'bar-cell' }, bar(r.perMonth, largest))))))));
}

/**
 * A decorative bar, `value` as a share of `largest`. Its width is set through the CSSOM, which
 * the CSP's style-src allows.
 * @param {number} value
 * @param {number} largest
 * @returns {HTMLElement}
 */
function bar(value, largest) {
  const el = h('span', { class: 'bar', 'aria-hidden': 'true' });
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
    h('p', { class: 'muted' }, 'Not included in living costs.'),
    h('ul', { class: 'plain-list', 'aria-labelledby': 'typical-oneoffs' }, ...tm.oneOffs.map((o) => h('li', null,
      `${formatDate(o.txn.date)} · `,
      h('span', { class: 'raw' }, o.txn.rawText),
      ` · ${names.get(o.categoryId) ?? ''} · ${money(o.amountMinor)}`))));
}
