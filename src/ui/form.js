// Shared form pieces for the screens: labels, a labelled field, focus by key, and the New
// category form used on the Categories screen and the categorise card.

/** @import {App} from '../main.js' */
/** @import {Category, CategoryKind, BudgetType, Changes} from '../types.js' */
import { h } from '../dom.js';
import { createCategory, isBudgeted } from '../categories.js';
import { whileSaving } from './saving.js';

/** @type {Record<CategoryKind, string>} */
export const KIND_LABELS = { spend: 'Spend', income: 'Income', contribution: 'Contribution', transfer: 'Transfer', ignore: 'Ignore' };
/** @type {Record<BudgetType, string>} */
export const BUDGET_LABELS = { fixed: 'Fixed', variable: 'Variable', annual: 'Annual', oneoff: 'One-off' };

/**
 * The element within `root` whose data-focus-key is `key`, if there is one.
 * @param {string} key
 * @param {ParentNode} [root]
 * @returns {HTMLElement|undefined}
 */
export function keyed(key, root = document) {
  const el = [...root.querySelectorAll('[data-focus-key]')]
    .find((e) => e instanceof HTMLElement && e.dataset.focusKey === key);
  return el instanceof HTMLElement ? el : undefined;
}

/**
 * Focus the element whose data-focus-key is `key`, if there is one.
 * @param {string} key
 */
export function focusKey(key) {
  keyed(key)?.focus();
}

/**
 * @param {number} n
 * @param {string} one
 * @param {string} many
 */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** @param {Event} e */
export const valueOf = (e) => /** @type {HTMLInputElement|HTMLSelectElement} */ (e.target).value;

/**
 * Show a dialog as modal once it is in the document: now if it is, otherwise after the caller
 * has finished appending (a screen is built detached, then attached). Does nothing if it is
 * already modal or never gets attached.
 * @param {HTMLElement} dialog
 */
export function showModalWhenConnected(dialog) {
  const show = () => { if (dialog.isConnected && !dialog.matches(':modal')) /** @type {HTMLDialogElement} */ (dialog).showModal(); };
  if (dialog.isConnected) show(); else queueMicrotask(show);
}

let seq = 0;

/**
 * A control with its label above it, linked by id (not by nesting, so a select's options stay out
 * of its name). An optional hint and error are linked with aria-describedby.
 * @param {string} label
 * @param {HTMLElement} control
 * @param {{hint?: string, error?: string}} [extra]
 * @returns {HTMLElement}
 */
export function field(label, control, { hint, error } = {}) {
  const id = `f${++seq}`;
  control.id = id;
  const hintEl = hint ? h('p', { class: 'muted hint', id: `${id}-hint` }, hint) : null;
  const errorEl = error ? h('p', { class: 'error', id: `${id}-error` }, error) : null;
  const described = [errorEl?.id, hintEl?.id].filter(Boolean).join(' ');
  if (described) control.setAttribute('aria-describedby', described);
  if (error) control.setAttribute('aria-invalid', 'true');
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hintEl, errorEl);
}

/**
 * One option per label, with `current` selected.
 * @param {Record<string, string>} labels
 * @param {string|undefined} current
 * @returns {HTMLElement[]}
 */
export const options = (labels, current) => Object.entries(labels)
  .map(([value, text]) => h('option', { value, selected: value === current }, text));

/** @typedef {{name: string, kind: CategoryKind, budgetType: BudgetType}} CategoryDraft */

/** @returns {CategoryDraft} */
export const emptyDraft = () => ({ name: '', kind: 'spend', budgetType: 'variable' });

/**
 * The New category form: Name, Kind and Budget type (hidden for kinds without one).
 * On submit it builds the category with createCategory. An invalid one goes to `setError`, and
 * focus returns to Name. A valid one goes to `save`, which applies it and then clears the
 * caller's draft, so input survives a failed or skipped save.
 * @param {App} app
 * @param {{draft: CategoryDraft, error: string, setError(message: string): void,
 *   save(changes: Changes, category: Category): Promise<void>,
 *   keyPrefix: string, submitLabel: string, formProps?: Record<string, unknown>,
 *   buttons?: HTMLElement[], scope?: HTMLElement, focusTo?: HTMLElement}} opts
 *   keyPrefix: data-focus-key prefix for the controls (`<prefix>-name`, `-kind`, `-budget`, `-add`).
 *   scope and focusTo: passed to whileSaving; they default to the form and the Name field.
 * @returns {HTMLElement}
 */
export function categoryForm(app, opts) {
  const d = opts.draft;
  const p = opts.keyPrefix;
  const nameInput = h('input', {
    type: 'text', value: d.name, autocomplete: 'off', 'data-focus-key': `${p}-name`,
    onInput: (/** @type {Event} */ e) => { d.name = valueOf(e); },
  });
  const budgetField = field('Budget type', h('select', {
    'data-focus-key': `${p}-budget`,
    onChange: (/** @type {Event} */ e) => { d.budgetType = /** @type {BudgetType} */ (valueOf(e)); },
  }, ...options(BUDGET_LABELS, d.budgetType)));
  budgetField.hidden = !isBudgeted(d.kind);

  const form = h('form', {
    novalidate: true, ...opts.formProps,
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      whileSaving(opts.scope ?? form, async () => {
        const result = createCategory(app.store.state, {
          name: d.name, kind: d.kind, ...(isBudgeted(d.kind) ? { budgetType: d.budgetType } : {}),
        });
        if ('error' in result) {
          opts.setError(result.error);
          app.rerender();
          focusKey(`${p}-name`);
          return;
        }
        await opts.save(result, /** @type {Category} */ (result.put?.categories?.[0]));
      }, opts.focusTo ?? nameInput);
    },
  },
  field('Name', nameInput, { error: opts.error }),
  field('Kind', h('select', {
    'data-focus-key': `${p}-kind`,
    onChange: (/** @type {Event} */ e) => {
      d.kind = /** @type {CategoryKind} */ (valueOf(e));
      budgetField.hidden = !isBudgeted(d.kind);
    },
  }, ...options(KIND_LABELS, d.kind))),
  budgetField,
  h('div', { class: 'actions' },
    h('button', { type: 'submit', 'data-focus-key': `${p}-add`, 'data-saves': true }, opts.submitLabel),
    ...(opts.buttons ?? [])));
  return form;
}
