// Counts as: the per-transaction control in any list of transactions. A select offers every
// category (an override for this one transaction), the bucket's category (which clears an
// override or split) and Split…, which shows a dialog of parts. The source shows next to it.
// A confirmed transfer shows Transfer and cannot be changed here.

/** @import {App} from '../main.js' */
/** @import {Transaction, Category} from '../types.js' */
/** @import {ResolveContext} from '../resolve.js' */
import { h } from '../dom.js';
import { resolve, buildContext } from '../resolve.js';
import { orderedCategories } from '../categories.js';
import { setCategoryOverride, setSplit, resetOverride } from '../overrides.js';
import { parseAmount, formatMoney, currencyExponent, decimalString, withoutCurrencySymbol } from '../money.js';
import { formatDate } from '../dates.js';
import { whileSaving, queueSave } from './saving.js';
import { focusKey, valueOf, field, showModalWhenConnected } from './form.js';

// Option values that are not category ids (those are UUIDs).
const BUCKET = '@bucket';
const SPLIT = '@split';
// A split row selects a hidden option that also reads Split…, so picking the visible Split…
// is a real change (a select fires no change when its selected option is picked again).
const SPLIT_NOW = '@split-now';

const SOURCE_TEXT = { transfer: 'transfer', split: 'split', override: 'override', bucket: 'bucket', none: 'uncategorised' };

/**
 * One row of the split dialog as typed. A part with no amount and no category is left out.
 * `checked` is set on Save split, so a missing amount or category then shows an error.
 * @typedef {{amount: string, categoryId: string, checked: boolean}} DraftPart
 */
/** @typedef {{prefix: string, txnId: string, parts: DraftPart[], error: string}} SplitDraft */

/** The split dialog's draft. It survives redraws, and is null when no dialog is showing. */
let draft = /** @type {SplitDraft|null} */ (null);

/** @returns {DraftPart} */
const blankPart = () => ({ amount: '', categoryId: '', checked: false });

/** @param {DraftPart} p */
const isBlank = (p) => p.amount.trim() === '' && p.categoryId === '';

/**
 * The row's select's data-focus-key. `prefix` is the list's own, so two lists don't clash.
 * @param {string} prefix
 * @param {Transaction} t
 * @returns {string}
 */
const selectKey = (prefix, t) => `${prefix}-counts-${t.id}`;

/**
 * Parse an amount typed without a sign, accepting a leading £ as search does. Empty is
 * {minor: null}; any other text that is not an amount, such as "null", is an error.
 * @param {string} text
 * @param {number} exp
 * @returns {{minor: number|null} | {error: string}}
 */
function parseUnsigned(text, exp) {
  const s = withoutCurrencySymbol(text);
  if (s === '') return { minor: null };
  const example = exp === 0 ? '12' : `12.${'5'.padEnd(exp, '0')}`;
  const r = /^[+-]/.test(s) ? null : parseAmount(s, exp);
  if (!r || 'error' in r || r.minor === null) return { error: `Enter an amount, such as ${example}.` };
  if (r.minor === 0) return { error: 'Enter an amount more than zero.' };
  return { minor: r.minor };
}

/**
 * The Counts as cell for one transaction: a select and its source, or Transfer.
 * @param {App} app
 * @param {Transaction} t
 * @param {ResolveContext} ctx
 * @param {Category[]} cats in order
 * @param {string} prefix the list's prefix for ids and focus keys
 * @returns {HTMLElement}
 */
export function countsAsCell(app, t, ctx, cats, prefix) {
  const r = resolve(t, ctx);
  const sourceId = `${prefix}-source-${t.id}`;
  const sourceEl = h('span', { class: 'source muted', id: sourceId }, SOURCE_TEXT[r.source]);
  if (r.source === 'transfer') return h('div', { class: 'counts-as' }, h('span', null, 'Transfer'), sourceEl);

  const bucketCategoryId = ctx.buckets.get(t.bucketId)?.categoryId;
  const bucketCategory = bucketCategoryId ? ctx.categories.get(bucketCategoryId) : undefined;
  const selected = selectedFor(t, ctx);
  const cell = h('div', { class: 'counts-as' });
  const select = h('select', {
    'aria-label': `Counts as for ${t.rawText} on ${formatDate(t.date)}`,
    'aria-describedby': sourceId, 'data-focus-key': selectKey(prefix, t),
    onChange: (/** @type {Event} */ e) => choose(app, t, valueOf(e), prefix),
  },
  ...cats.map((c) => h('option', { value: c.id, selected: c.id === selected }, c.name)),
  h('option', { value: BUCKET, selected: selected === BUCKET }, `Use bucket's category (${bucketCategory?.name ?? 'none'})`),
  h('option', { value: SPLIT }, 'Split…'),
  selected === SPLIT_NOW ? h('option', { value: SPLIT_NOW, selected: true, hidden: true }, 'Split…') : null);
  cell.append(select, sourceEl);
  return cell;
}

/**
 * The select value for what a transaction has now.
 * @param {Transaction} t
 * @param {ResolveContext} ctx
 * @returns {string}
 */
function selectedFor(t, ctx) {
  const r = resolve(t, ctx);
  return r.source === 'split' ? SPLIT_NOW : r.source === 'override' ? r.parts[0].categoryId ?? BUCKET : BUCKET;
}

/**
 * Act on a choice in the Counts as select. The save is queued, not dropped, so a second quick
 * change is saved too; picking what the row has by the time the save runs does nothing. Split…
 * shows the dialog, with the current parts if it is split.
 * @param {App} app
 * @param {Transaction} t
 * @param {string} value
 * @param {string} prefix
 */
function choose(app, t, value, prefix) {
  if (value === SPLIT) {
    startSplit(app, t, prefix);
    return;
  }
  queueSave(async () => {
    const now = app.store.state;
    if (value === selectedFor(t, buildContext(now))) return;
    try {
      await app.store.apply(value === BUCKET
        ? resetOverride(now, t.fingerprint)
        : setCategoryOverride(now, t.fingerprint, value));
    } catch (err) {
      // Nothing was saved: redraw so the select shows what the row still has.
      app.rerender();
      throw err;
    }
  });
}

/**
 * Show the split dialog for a transaction, prefilled with its current parts if it is split.
 * @param {App} app
 * @param {Transaction} t
 * @param {string} prefix
 */
function startSplit(app, t, prefix) {
  const state = app.store.state;
  const exp = currencyExponent(t.currency);
  const known = new Set(state.categories.map((c) => c.id));
  const splits = state.overrides.get(t.fingerprint)?.splits ?? [];
  const parts = splits.length > 0
    ? splits.map((s) => ({ amount: decimalString(s.amountMinor, exp), categoryId: known.has(s.categoryId) ? s.categoryId : '', checked: false }))
    : [blankPart(), blankPart()];
  draft = { prefix, txnId: t.id, parts, error: '' };
  app.rerender();
  focusKey('split-amount-0');
}

/**
 * Append the split dialog to `root` and show it, if one was started from the list with this
 * prefix. A list calls this once after its rows, so the dialog survives a redraw of the screen.
 * @param {HTMLElement} root
 * @param {App} app
 * @param {string} prefix the list's prefix, as given to countsAsCell
 */
export function appendSplitDialog(root, app, prefix) {
  if (!draft || draft.prefix !== prefix) return;
  const d = draft;
  const t = app.store.state.transactions.find((x) => x.id === d.txnId);
  if (!t) {
    draft = null;
    return;
  }
  const dialog = splitDialog(app, t, d);
  root.append(dialog);
  showModalWhenConnected(dialog);
}

/**
 * The split dialog. Amounts are typed without a sign and take the transaction's sign on save.
 * Typing updates Remaining and the errors in place, so focus and text are kept.
 * @param {App} app
 * @param {Transaction} t
 * @param {SplitDraft} d
 * @returns {HTMLElement}
 */
function splitDialog(app, t, d) {
  const cats = orderedCategories(app.store.state);
  const exp = currencyExponent(t.currency);
  const total = Math.abs(t.amountMinor);
  const sign = Math.sign(t.amountMinor);
  let saved = false;

  const dialog = h('dialog', {
    class: 'split-dialog', 'aria-labelledby': `${d.prefix}-split-heading`, 'aria-describedby': `${d.prefix}-split-txn`,
    // Escape and Cancel both end here. A save sets `saved` first, so this does nothing then.
    onClose: () => {
      if (saved || draft !== d) return;
      draft = null;
      app.rerender();
      focusKey(selectKey(d.prefix, t));
    },
  });

  /** @type {{amount: HTMLElement, amountError: HTMLElement, category: HTMLElement, categoryError: HTMLElement}[]} */
  let refs = [];
  const remainingEl = h('p', { id: `${d.prefix}-split-remaining`, 'aria-live': 'polite' });
  const errorEl = h('p', { class: 'error', role: 'alert' });
  const saveButton = /** @type {HTMLButtonElement} */ (h('button', { type: 'submit', 'data-saves': true, 'data-focus-key': 'split-save' }, 'Save split'));

  /**
   * @param {HTMLElement} control
   * @param {HTMLElement} errorP
   * @param {string} message
   */
  const showError = (control, errorP, message) => {
    errorP.textContent = message;
    errorP.hidden = !message;
    if (message) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', errorP.id);
    } else {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    }
  };

  /** Update Remaining, the errors and Save split from the draft. */
  const refresh = () => {
    let sum = 0;
    let bad = false;
    d.parts.forEach((p, i) => {
      const parsed = parseUnsigned(p.amount, exp);
      let amountMessage = '';
      if ('error' in parsed) {
        amountMessage = parsed.error;
        bad = true;
      } else if (parsed.minor === null) {
        if (p.checked && !isBlank(p)) amountMessage = 'Enter an amount.';
      } else {
        sum += parsed.minor;
      }
      showError(refs[i].amount, refs[i].amountError, amountMessage);
      showError(refs[i].category, refs[i].categoryError, p.checked && !isBlank(p) && !p.categoryId ? 'Choose a category.' : '');
    });
    remainingEl.textContent = `Remaining: ${formatMoney(total - sum, t.currency)}`;
    errorEl.textContent = d.error;
    errorEl.hidden = !d.error;
    saveButton.disabled = bad || sum !== total;
  };

  /**
   * @param {DraftPart} p
   * @param {number} i
   * @returns {HTMLElement}
   */
  const partFields = (p, i) => {
    const edited = () => { d.error = ''; refresh(); };
    const amount = h('input', {
      type: 'text', class: 'short', inputmode: 'decimal', value: p.amount, autocomplete: 'off', 'data-focus-key': `split-amount-${i}`,
      onInput: (/** @type {Event} */ e) => { p.amount = valueOf(e); edited(); },
    });
    const category = h('select', {
      'data-focus-key': `split-category-${i}`,
      onChange: (/** @type {Event} */ e) => { p.categoryId = valueOf(e); edited(); },
    },
    h('option', { value: '', selected: p.categoryId === '' }, 'Choose a category'),
    ...cats.map((c) => h('option', { value: c.id, selected: c.id === p.categoryId }, c.name)));
    const amountField = field('Amount', amount);
    const categoryField = field('Category', category);
    const ref = {
      amount, category,
      amountError: h('p', { class: 'error', id: `${amount.id}-error`, hidden: true }),
      categoryError: h('p', { class: 'error', id: `${category.id}-error`, hidden: true }),
    };
    amountField.append(ref.amountError);
    categoryField.append(ref.categoryError);
    refs[i] = ref;
    return h('fieldset', null, h('legend', null, `Part ${i + 1}`), h('div', { class: 'row' }, amountField, categoryField));
  };

  const save = () => whileSaving(dialog, async () => {
    const used = d.parts.filter((p) => !isBlank(p));
    for (const p of used) p.checked = true;
    refresh();
    const firstBad = d.parts.findIndex((p, i) => p.checked && !isBlank(p) && (refs[i].amount.hasAttribute('aria-invalid') || !p.categoryId));
    if (firstBad >= 0) {
      const which = refs[firstBad].amount.hasAttribute('aria-invalid') ? 'amount' : 'category';
      focusKey(`split-${which}-${firstBad}`);
      return;
    }
    const parts = used.map((p) => {
      const parsed = /** @type {{minor: number}} */ (parseUnsigned(p.amount, exp));
      return { amountMinor: sign * parsed.minor, categoryId: p.categoryId };
    });
    const result = setSplit(app.store.state, t, parts);
    if ('error' in result) {
      d.error = result.error;
      refresh();
      focusKey('split-amount-0');
      return;
    }
    saved = true;
    draft = null;
    /** @type {HTMLDialogElement} */ (dialog).close();
    focusKey(selectKey(d.prefix, t));
    try {
      await app.store.apply(result);
    } catch (err) {
      // Nothing was saved: show the dialog again with what was typed.
      draft = d;
      app.rerender();
      throw err;
    }
  }, saveButton);

  const fill = () => {
    refs = [];
    dialog.replaceChildren(
      h('h3', { id: `${d.prefix}-split-heading` }, 'Split transaction'),
      h('p', { id: `${d.prefix}-split-txn` }, `${formatDate(t.date)} · `, h('span', { class: 'raw' }, t.rawText),
        ` · ${formatMoney(total, t.currency)} ${sign < 0 ? 'out' : 'in'}`),
      h('form', {
        novalidate: true,
        onSubmit: (/** @type {Event} */ e) => { e.preventDefault(); save(); },
      },
      ...d.parts.map(partFields),
      h('div', { class: 'actions' }, h('button', {
        type: 'button', class: 'secondary', 'data-focus-key': 'split-add',
        onClick: () => {
          d.parts.push(blankPart());
          fill();
          focusKey(`split-amount-${d.parts.length - 1}`);
        },
      }, 'Add part')),
      remainingEl,
      errorEl,
      h('div', { class: 'actions' },
        saveButton,
        h('button', { type: 'button', class: 'secondary', onClick: () => /** @type {HTMLDialogElement} */ (dialog).close() }, 'Cancel'))));
    refresh();
  };
  fill();
  return dialog;
}
