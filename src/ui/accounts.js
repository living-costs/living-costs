// Accounts screen: the import flow, the accounts-by-month table, and each account with its
// imported files and Undo. While an import is in progress only the flow is shown, so nothing
// changes underneath it.

/** @import {App} from '../main.js' */
/** @import {Account, Batch} from '../types.js' */
import { h } from '../dom.js';
import { undoBatches } from '../import.js';
import { accountsByMonth } from '../coverage.js';
import { formatDate, formatMonth } from '../dates.js';
import { renderImport, importActive } from './import.js';
import { whileSaving, isSaving } from './saving.js';
import { cmp } from '../order.js';
import { help, plural, field, valueOf } from './form.js';
import { setAccountKind } from '../accounts.js';

export const ACCOUNT_KIND_LABELS = { bank: 'Bank', card: 'Card', savings: 'Savings', placeholder: 'Card (not imported)' };

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  const section = h('section', { class: 'card', 'aria-labelledby': 'import-heading' },
    h('h3', { id: 'import-heading' }, 'Import statements'));
  renderImport(section, app);
  root.append(h('h2', { tabindex: '-1' }, 'Accounts'), section);
  if (importActive()) return;
  root.append(byMonth(app), accountList(app));
}

/**
 * Ask, then remove these batches and their transactions. Declined, nothing changes. It asks
 * before the save starts, so a declined Undo leaves focus on its button; while another save is
 * in flight it does nothing, as whileSaving would.
 * @param {App} app
 * @param {Batch[]} list
 * @param {HTMLElement} scope its Undo buttons are disabled while the save is in flight
 * @returns {Promise<void>}
 */
async function undo(app, list, scope) {
  if (isSaving()) return;
  const ids = new Set(list.map((b) => b.id));
  const n = app.store.state.transactions.filter((t) => ids.has(t.batchId)).length;
  const files = list.map((b) => b.fileName).join(', ');
  const again = list.length === 1 ? 'the file' : 'the files';
  if (!confirm(`Remove the ${plural(n, 'transaction', 'transactions')} from ${files}? You can import ${again} again later.`)) return;
  await whileSaving(scope, () => app.store.apply(undoBatches(app.store.state, [...ids])));
}

/**
 * @param {App} app
 * @returns {HTMLElement}
 */
function accountList(app) {
  const { accounts, batches } = app.store.state;
  const section = h('section', { 'aria-labelledby': 'accounts-heading' }, h('h3', { id: 'accounts-heading' }, 'Your accounts'));
  if (accounts.length === 0) {
    section.append(h('p', null, 'No accounts yet.'));
    return section;
  }
  for (const account of accounts) {
    const own = batches.filter((b) => b.accountId === account.id)
      .sort((a, b) => cmp(a.coversFrom, b.coversFrom));
    section.append(accountCard(app, account, own));
  }
  return section;
}

/**
 * @param {App} app
 * @param {Account} account
 * @param {Batch[]} own sorted by coversFrom
 * @returns {HTMLElement}
 */
function accountCard(app, account, own) {
  const card = h('div', { class: 'card' },
    h('h4', null, account.name),
    h('p', { class: 'muted' }, `${ACCOUNT_KIND_LABELS[account.kind]} · ${account.currency}`));
  if (account.kind !== 'placeholder') {
    const kinds = /** @type {const} */ (['bank', 'card', 'savings']);
    card.append(field(`Kind for ${account.name}`, h('select', {
      'data-focus-key': `kind-${account.id}`, 'data-saves': true,
      onChange: (/** @type {Event} */ e) => {
        const kind = kinds.find((k) => k === valueOf(e));
        if (kind) whileSaving(card, () => app.store.apply(setAccountKind(app.store.state, account.id, kind)));
      },
    }, ...kinds.map((k) => h('option', { value: k, selected: account.kind === k }, ACCOUNT_KIND_LABELS[k])))));
  }
  if (own.length === 0) {
    card.append(h('p', null, 'No statements imported.'));
    return card;
  }
  card.append(h('table', null,
    h('caption', null, `Statements for ${account.name}`),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'File'), h('th', { scope: 'col' }, 'Covers'),
      h('th', { scope: 'col', class: 'num' }, 'Rows'), h('th', { scope: 'col' }, 'Undo'))),
    h('tbody', null, ...own.map((b) => h('tr', null,
      h('td', null, b.fileName),
      h('td', null, `${formatDate(b.coversFrom)} to ${formatDate(b.coversTo)}`),
      h('td', { class: 'num' }, String(b.rowCount)),
      h('td', null, h('button', {
        type: 'button', class: 'secondary', 'aria-label': `Undo ${b.fileName}`, 'data-focus-key': `undo-${b.id}`, 'data-saves': true,
        onClick: () => undo(app, [b], card),
      }, 'Undo')))))));

  /** @type {Map<string, Batch[]>} */
  const byImport = new Map();
  for (const b of own) byImport.set(b.importId, [...(byImport.get(b.importId) ?? []), b]);
  const multi = [...byImport.values()].filter((list) => list.length > 1);
  multi.forEach((list, i) => {
    const id = `together-${account.id}-${i}`;
    card.append(h('div', { class: 'actions' },
      h('p', { id }, `Imported together: ${list.map((b) => b.fileName).join(', ')}.`),
      h('button', {
        type: 'button', class: 'secondary', 'aria-describedby': id, 'data-focus-key': `undo-import-${list[0].importId}`, 'data-saves': true,
        onClick: () => undo(app, list, card),
      }, 'Undo this import')));
  });
  return card;
}

/** @type {Record<string, (count: number) => string>} */
const CELL_TEXT = {
  covered: (n) => `✓ ${n}`,
  partial: (n) => `Partial ${n}`,
  missing: () => 'Missing',
  'not-itemised': () => 'Not itemised',
};

/**
 * @param {App} app
 * @returns {HTMLElement}
 */
function byMonth(app) {
  const { months, rows } = accountsByMonth(app.store.state, app.tuning);
  const section = h('section', { 'aria-labelledby': 'by-month-heading' },
    h('h3', { id: 'by-month-heading' }, 'Accounts by month'));
  if (months.length === 0) {
    section.append(h('p', null, 'Nothing imported yet.'));
    return section;
  }
  section.append(
    help('Each month shows whether your statements cover it, and how many transactions it has.'),
    h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'by-month-heading' },
      h('table', { 'aria-labelledby': 'by-month-heading' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Account'),
          ...months.map((m) => h('th', { scope: 'col' }, formatMonth(m))))),
        h('tbody', null, ...rows.map(({ account, cells }) => h('tr', null,
          h('th', { scope: 'row' }, account.name),
          ...cells.map((c) => h('td', { class: `cell-${c.status}` }, CELL_TEXT[c.status](c.count)))))))),
  );
  return section;
}
