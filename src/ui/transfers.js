// Transfers screen: suggested transfer pairs to confirm or reject, confirmed and rejected pairs
// with Undo, and cards you don't import, which are placeholder accounts, with a form to add one.
//
// A suggestion's From side is the money out and its To side the money in. Confirm all confirms
// exactly the suggestions on screen when it is clicked, in one save. After a row's action removes
// it, focus goes to the same button on the next row, else the previous row, else the section
// heading.

/** @import {App} from '../main.js' */
/** @import {Transaction, TransferPair, Changes} from '../types.js' */
/** @import {Suggestion} from '../transfers.js' */
import { h } from '../dom.js';
import { suggestPairs, decidePair, unpair, markPlaceholder } from '../transfers.js';
import { combine } from '../changes.js';
import { formatMoney } from '../money.js';
import { formatDate } from '../dates.js';
import { whileSaving } from './saving.js';
import { field, focusKey, plural, valueOf } from './form.js';

/** The Add a card you don't import form. Not saved; it survives redraws until reset(). */
const form = {
  bucketId: '',
  cardName: '',
  /** @type {{bucket?: string, name?: string}} */
  errors: {},
  /** Confirmation of the last card added, read out by the status line. */
  status: '',
};

/** Entering the screen from the nav starts the form afresh. */
export function reset() {
  form.bucketId = '';
  form.cardName = '';
  form.errors = {};
  form.status = '';
}

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  root.append(
    h('h2', { tabindex: '-1' }, 'Transfers'),
    h('p', null, 'Money moving between your own accounts is neither spending nor income. Confirmed transfers are left out of every total.'),
    suggestedSection(app),
    decidedSection(app, {
      status: 'confirmed', id: 'confirmed', title: 'Confirmed transfers',
      intro: 'Undo puts a pair back into your totals, and it may be suggested again.',
    }),
    decidedSection(app, {
      status: 'rejected', id: 'rejected', title: 'Not transfers',
      intro: 'Undo forgets that a pair is not a transfer, so it may be suggested again.',
    }),
    cardsSection(app));
}

/**
 * The cells for one side of a pair: date, account and description. A side whose transaction is no
 * longer imported shows that instead.
 * @param {Transaction|undefined} t
 * @param {Map<string, string>} accounts account names by id
 * @returns {HTMLElement[]}
 */
function sideCells(t, accounts) {
  if (!t) return [h('td', { colspan: '3', class: 'muted' }, 'Not in your imported statements')];
  return [
    h('td', null, formatDate(t.date)),
    h('td', null, accounts.get(t.accountId) ?? ''),
    h('td', null, h('span', { class: 'raw' }, t.rawText)),
  ];
}

/**
 * Words for a pair, used in its buttons' names: "£300.00 from Bank A current to Credit card, 18/11/2025".
 * @param {Transaction|undefined} a
 * @param {Transaction|undefined} b
 * @param {Map<string, string>} accounts
 * @returns {string}
 */
function pairWords(a, b, accounts) {
  const t = a ?? b;
  if (!t) return 'a pair no longer imported';
  const amount = formatMoney(Math.abs(t.amountMinor), t.currency);
  const from = a ? accounts.get(a.accountId) ?? '' : 'an account no longer imported';
  const to = b ? accounts.get(b.accountId) ?? '' : 'an account no longer imported';
  return `${amount} from ${from} to ${to}, ${formatDate(t.date)}`;
}

/** The column headers shared by both tables. */
const headerRow = (/** @type {string} */ last) => h('tr', null,
  h('th', { scope: 'col' }, 'From date'), h('th', { scope: 'col' }, 'From account'), h('th', { scope: 'col' }, 'From description'),
  h('th', { scope: 'col', class: 'num' }, 'Amount'),
  h('th', { scope: 'col' }, 'To date'), h('th', { scope: 'col' }, 'To account'), h('th', { scope: 'col' }, 'To description'),
  h('th', { scope: 'col' }, last));

/**
 * The key to focus after the row at `i` goes: the same button on the next row, else the
 * previous row, else `fallback`.
 * @param {string[]} keys that button's key on every row, in order
 * @param {number} i
 * @param {string} fallback
 * @returns {string}
 */
const nextFocus = (keys, i, fallback) => keys[i + 1] ?? keys[i - 1] ?? fallback;

/**
 * An element by data-focus-key within `root`.
 * @param {ParentNode} root
 * @param {string} key
 * @returns {HTMLElement|undefined}
 */
const byKey = (root, key) => /** @type {HTMLElement|undefined} */ ([...root.querySelectorAll('[data-focus-key]')]
  .find((el) => el instanceof HTMLElement && el.dataset.focusKey === key));

/** By From date, then fingerprint. */
const suggestionOrder = (/** @type {Suggestion} */ x, /** @type {Suggestion} */ y) => (x.a.date < y.a.date ? -1 : x.a.date > y.a.date ? 1 : 0)
  || (x.a.fingerprint < y.a.fingerprint ? -1 : x.a.fingerprint > y.a.fingerprint ? 1 : 0);

/**
 * @param {App} app
 * @returns {HTMLElement}
 */
function suggestedSection(app) {
  const state = app.store.state;
  const heading = h('h3', { id: 'suggested-heading', tabindex: '-1', 'data-focus-key': 'suggested-heading' }, 'Suggested transfers');
  const section = h('section', { 'aria-labelledby': 'suggested-heading' }, heading);
  const shown = suggestPairs(state, app.tuning).sort(suggestionOrder);
  if (shown.length === 0) {
    section.append(h('p', null, state.transactions.length === 0
      ? 'Nothing imported yet.'
      : 'No suggestions. There are no undecided matching amounts between your accounts.'));
    return section;
  }
  const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
  const confirmKeys = shown.map((s) => `transfer-confirm-${s.a.fingerprint}`);
  const rejectKeys = shown.map((s) => `transfer-reject-${s.a.fingerprint}`);

  /**
   * @param {HTMLElement} scope
   * @param {() => Changes} build
   * @param {string} focus
   */
  const save = (scope, build, focus) => whileSaving(scope, () => app.store.apply(build()), byKey(section, focus) ?? heading);

  const all = h('button', {
    type: 'button', 'data-saves': true, 'data-focus-key': 'transfers-confirm-all', 'aria-describedby': 'suggested-count',
    onClick: () => save(section, () => combine(...shown.map((s) => decidePair(s.a, s.b, 'confirmed'))), 'suggested-heading'),
  }, 'Confirm all');

  section.append(
    h('p', { id: 'suggested-count', class: 'muted' },
      `${plural(shown.length, 'pair', 'pairs')}: the same amount out of one account and into another within ${plural(app.tuning.transactionMatchDays, 'day', 'days')}.`),
    h('div', { class: 'actions' }, all),
    h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'suggested-heading' },
      h('table', { 'aria-labelledby': 'suggested-heading' },
        h('thead', null, headerRow('Decision')),
        h('tbody', null, ...shown.map((s, i) => {
          const words = pairWords(s.a, s.b, accounts);
          const row = h('tr', null,
            ...sideCells(s.a, accounts),
            h('td', { class: 'num' }, formatMoney(Math.abs(s.a.amountMinor), s.a.currency)),
            ...sideCells(s.b, accounts),
            h('td', null, h('div', { class: 'row-actions' },
              h('button', {
                type: 'button', 'data-saves': true, 'data-focus-key': confirmKeys[i], 'aria-label': `Confirm ${words}`,
                onClick: () => save(row, () => decidePair(s.a, s.b, 'confirmed'), nextFocus(confirmKeys, i, 'suggested-heading')),
              }, 'Confirm'),
              h('button', {
                type: 'button', class: 'secondary', 'data-saves': true, 'data-focus-key': rejectKeys[i],
                'aria-label': `Not a transfer: ${words}`,
                onClick: () => save(row, () => decidePair(s.a, s.b, 'rejected'), nextFocus(rejectKeys, i, 'suggested-heading')),
              }, 'Not a transfer'))));
          return row;
        })))));
  return section;
}

/**
 * A table of decided pairs with one status, each with an Undo button that forgets the decision.
 * Confirmed transfers and Not transfers share it.
 * @param {App} app
 * @param {{status: TransferPair['status'], id: string, title: string, intro: string}} opts
 *   id: prefix for the heading id and focus key (`<id>-heading`).
 * @returns {HTMLElement}
 */
function decidedSection(app, { status, id, title, intro }) {
  const state = app.store.state;
  const headingId = `${id}-heading`;
  const heading = h('h3', { id: headingId, tabindex: '-1', 'data-focus-key': headingId }, title);
  const section = h('section', { 'aria-labelledby': headingId }, heading);
  const byFingerprint = new Map(state.transactions.map((t) => [t.fingerprint, t]));
  /** @type {{pair: TransferPair, a: Transaction|undefined, b: Transaction|undefined, date: string}[]} */
  const rows = [...state.transferPairs.values()].filter((p) => p.status === status).map((pair) => {
    const a = byFingerprint.get(pair.fingerprintA);
    const b = byFingerprint.get(pair.fingerprintB);
    return { pair, a, b, date: a?.date ?? b?.date ?? '' };
  }).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || (x.pair.key < y.pair.key ? -1 : x.pair.key > y.pair.key ? 1 : 0));
  if (rows.length === 0) {
    section.append(h('p', null, 'None yet.'));
    return section;
  }
  const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
  const keys = rows.map((r) => `transfer-undo-${r.pair.key}`);
  section.append(
    h('p', { class: 'muted' }, `${plural(rows.length, 'pair', 'pairs')}. ${intro}`),
    h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-labelledby': headingId },
      h('table', { 'aria-labelledby': headingId },
        h('thead', null, headerRow('Undo')),
        h('tbody', null, ...rows.map(({ pair, a, b }, i) => {
          const t = a ?? b;
          const row = h('tr', null,
            ...sideCells(a, accounts),
            h('td', { class: 'num' }, t ? formatMoney(Math.abs(t.amountMinor), t.currency) : ''),
            ...sideCells(b, accounts),
            h('td', null, h('button', {
              type: 'button', class: 'secondary', 'data-saves': true, 'data-focus-key': keys[i],
              'aria-label': `Undo ${pairWords(a, b, accounts)}`,
              onClick: () => whileSaving(row, () => app.store.apply(unpair(pair.key)),
                byKey(section, nextFocus(keys, i, headingId)) ?? heading),
            }, 'Undo')));
          return row;
        })))));
  return section;
}

/**
 * The currencies of a bucket's transactions.
 * @param {App} app
 * @param {string} bucketId
 * @returns {string[]}
 */
function bucketCurrencies(app, bucketId) {
  return [...new Set(app.store.state.transactions.filter((t) => t.bucketId === bucketId).map((t) => t.currency))].sort();
}

/**
 * @param {App} app
 * @returns {HTMLElement}
 */
function cardsSection(app) {
  const state = app.store.state;
  const section = h('section', { 'aria-labelledby': 'cards-heading' },
    h('h3', { id: 'cards-heading', tabindex: '-1', 'data-focus-key': 'cards-heading' }, "Cards you don't import"),
    h('p', null, `If you repay a card whose statements you don't import, its repayments count as spending in a "(not itemised)" category. `
      + 'Import its statements into it later, and confirm the repayments as transfers, to see what you spent instead.'));
  const buckets = new Map(state.buckets.map((b) => [b.id, b]));
  const placeholders = state.accounts.filter((a) => a.kind === 'placeholder');
  if (placeholders.length === 0) {
    section.append(h('p', null, 'None yet.'));
  } else {
    section.append(h('table', { 'aria-labelledby': 'cards-heading' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Card'), h('th', { scope: 'col' }, 'Repayment bucket'), h('th', { scope: 'col' }, 'Currency'))),
      h('tbody', null, ...placeholders.map((a) => h('tr', null,
        h('th', { scope: 'row' }, a.name),
        h('td', null, a.repaymentBucketIds.map((id) => buckets.get(id)?.displayName ?? 'A bucket that no longer exists').join(', ')),
        h('td', null, a.currency))))));
  }
  section.append(addCardForm(app));
  return section;
}

/**
 * Add a card you don't import: Repayment bucket and Card name.
 * @param {App} app
 * @returns {HTMLElement}
 */
function addCardForm(app) {
  const state = app.store.state;
  const linked = new Set(state.accounts.flatMap((a) => a.repaymentBucketIds));
  const choices = state.buckets.filter((b) => !linked.has(b.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (form.bucketId && !choices.some((b) => b.id === form.bucketId)) form.bucketId = '';

  const bucketSelect = h('select', {
    'data-focus-key': 'card-bucket',
    onChange: (/** @type {Event} */ e) => { form.bucketId = valueOf(e); },
  },
  h('option', { value: '', selected: form.bucketId === '' }, 'Choose a bucket'),
  ...choices.map((b) => h('option', { value: b.id, selected: b.id === form.bucketId }, b.displayName)));
  const nameInput = h('input', {
    type: 'text', value: form.cardName, autocomplete: 'off', 'data-focus-key': 'card-name',
    onInput: (/** @type {Event} */ e) => { form.cardName = valueOf(e); },
  });

  const el = h('form', {
    novalidate: true, 'aria-labelledby': 'add-card-heading',
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      whileSaving(el, async () => {
        /** @type {{bucket?: string, name?: string}} */
        const errors = {};
        const cardName = form.cardName.trim();
        const currencies = form.bucketId ? bucketCurrencies(app, form.bucketId) : [];
        if (!form.bucketId) errors.bucket = 'Choose the bucket your repayments to this card are in.';
        else if (currencies.length === 0) errors.bucket = "This bucket has no transactions, so its currency isn't known.";
        else if (currencies.length > 1) errors.bucket = `This bucket has transactions in more than one currency (${currencies.join(', ')}). Choose a bucket in one currency.`;
        if (!cardName) errors.name = "Enter the card's name.";
        form.errors = errors;
        form.status = '';
        if (errors.bucket || errors.name) {
          app.rerender();
          focusKey(errors.bucket ? 'card-bucket' : 'card-name');
          return;
        }
        await app.store.apply(markPlaceholder(app.store.state, { bucketId: form.bucketId, cardName, currency: currencies[0] }));
        reset();
        form.status = `Added ${cardName}.`;
        app.rerender();
      }, bucketSelect);
    },
  },
  h('h4', { id: 'add-card-heading' }, "Add a card you don't import"),
  field('Repayment bucket', bucketSelect, {
    hint: 'The bucket that holds your repayments to the card. It moves to a new "(not itemised)" spend category.',
    error: form.errors.bucket,
  }),
  field('Card name', nameInput, { error: form.errors.name }),
  h('div', { class: 'actions' },
    h('button', { type: 'submit', 'data-saves': true, 'data-focus-key': 'card-add' }, 'Add card')),
  h('p', { role: 'status', class: 'muted' }, form.status));
  return el;
}
