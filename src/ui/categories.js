// Categories screen: a table of categories (kind and budget type change in place), inline rename,
// delete with reassignment when the category is in use, and a New category form.

/** @import {App} from '../main.js' */
/** @import {Category, CategoryKind, BudgetType, Changes} from '../types.js' */
import { h } from '../dom.js';
import { whileSaving } from './saving.js';
import {
  isBudgeted, createCategory, updateCategory, deleteCategory, orderedCategories, categoryUseCount,
} from '../categories.js';

/** @type {Record<CategoryKind, string>} */
const KIND_LABELS = { spend: 'Spend', income: 'Income', contribution: 'Contribution', transfer: 'Transfer', ignore: 'Ignore' };
/** @type {Record<BudgetType, string>} */
const BUDGET_LABELS = { fixed: 'Fixed', variable: 'Variable', annual: 'Annual', oneoff: 'One-off' };

/**
 * Screen state that is not saved: the new-category draft, the row being renamed or deleted,
 * and any error to show. It survives redraws caused by store changes.
 */
const ui = {
  /** @type {{name: string, kind: CategoryKind, budgetType: BudgetType}} */
  draft: { name: '', kind: 'spend', budgetType: 'variable' },
  createError: '',
  /** @type {string|null} */
  renameId: null,
  renameValue: '',
  renameError: '',
  /** @type {string|null} */
  deleteId: null,
  deleteTarget: '',
  deleteError: '',
  rowError: '',
};

/** @param {string} key */
function focusKey(key) {
  const el = [...document.querySelectorAll('[data-focus-key]')]
    .find((e) => e instanceof HTMLElement && e.dataset.focusKey === key);
  if (el instanceof HTMLElement) el.focus();
}

let seq = 0;

/**
 * A control with its label above it, linked by id. An error is linked with aria-describedby.
 * @param {string} label
 * @param {HTMLElement} control
 * @param {string} [error]
 * @returns {HTMLElement}
 */
function field(label, control, error) {
  const id = `cat-f${++seq}`;
  control.id = id;
  const errorEl = error ? h('p', { class: 'error', id: `${id}-error` }, error) : null;
  if (errorEl) {
    control.setAttribute('aria-describedby', errorEl.id);
    control.setAttribute('aria-invalid', 'true');
  }
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, errorEl);
}

/**
 * @param {Record<string, string>} labels
 * @param {string|undefined} current
 * @returns {HTMLElement[]}
 */
const options = (labels, current) => Object.entries(labels)
  .map(([value, text]) => h('option', { value, selected: value === current }, text));

/** @param {Event} e */
const valueOf = (e) => /** @type {HTMLInputElement|HTMLSelectElement} */ (e.target).value;

/**
 * @param {number} n
 * @param {string} one
 * @param {string} many
 */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Save valid changes, or show the error above the table.
 * @param {App} app
 * @param {Changes | {error: string}} result
 */
function commit(app, result) {
  if ('error' in result) {
    ui.rowError = result.error;
    app.rerender();
    return;
  }
  ui.rowError = '';
  app.store.apply(result);
}

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  const list = orderedCategories(app.store.state);
  if (ui.renameId && !list.some((c) => c.id === ui.renameId)) ui.renameId = null;
  if (ui.deleteId && !list.some((c) => c.id === ui.deleteId)) ui.deleteId = null;
  const deleting = list.find((c) => c.id === ui.deleteId);

  root.append(
    h('h2', { tabindex: '-1' }, 'Categories'),
    h('p', null, 'Kind decides how a category counts. Budget type decides how it shows in your typical month.'));
  if (ui.rowError) root.append(h('p', { class: 'error', role: 'alert' }, ui.rowError));
  root.append(table(app, list));
  if (deleting) root.append(deletePanel(app, deleting, list));
  root.append(newForm(app));
}

/**
 * @param {App} app
 * @param {Category[]} list
 * @returns {HTMLElement}
 */
function table(app, list) {
  return h('section', { 'aria-labelledby': 'categories-heading' },
    h('h3', { id: 'categories-heading' }, 'Your categories'),
    h('div', { class: 'scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'categories-heading' },
      h('table', { 'aria-labelledby': 'categories-heading' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Name'), h('th', { scope: 'col' }, 'Kind'),
          h('th', { scope: 'col' }, 'Budget type'), h('th', { scope: 'col' }, 'Actions'))),
        h('tbody', null, ...list.map((c) => row(app, c))))));
}

/**
 * @param {App} app
 * @param {Category} c
 * @returns {HTMLElement}
 */
function row(app, c) {
  const kind = h('select', {
    'aria-label': `Kind for ${c.name}`, 'data-focus-key': `kind-${c.id}`,
    onChange: (/** @type {Event} */ e) => {
      const next = /** @type {CategoryKind} */ (valueOf(e));
      /** @type {{kind: CategoryKind, budgetType?: BudgetType}} */
      const patch = { kind: next };
      if (isBudgeted(next) && !c.budgetType) patch.budgetType = 'variable';
      commit(app, updateCategory(app.store.state, c.id, patch));
    },
  }, ...options(KIND_LABELS, c.kind));

  const budget = isBudgeted(c.kind) ? h('select', {
    'aria-label': `Budget type for ${c.name}`, 'data-focus-key': `budget-${c.id}`,
    onChange: (/** @type {Event} */ e) => commit(app, updateCategory(app.store.state, c.id, { budgetType: /** @type {BudgetType} */ (valueOf(e)) })),
  }, ...options(BUDGET_LABELS, c.budgetType)) : h('span', { class: 'muted' }, 'None');

  return h('tr', null,
    h('th', { scope: 'row' }, ui.renameId === c.id ? renameForm(app, c) : c.name),
    h('td', null, kind),
    h('td', null, budget),
    h('td', null, h('div', { class: 'row-actions' },
      h('button', {
        type: 'button', class: 'secondary', 'aria-label': `Rename ${c.name}`, 'data-focus-key': `rename-${c.id}`,
        onClick: () => {
          Object.assign(ui, { renameId: c.id, renameValue: c.name, renameError: '', deleteId: null });
          app.rerender();
          focusKey(`rename-input-${c.id}`);
        },
      }, 'Rename'),
      h('button', {
        type: 'button', class: 'secondary', 'aria-label': `Delete ${c.name}`, 'data-focus-key': `delete-${c.id}`,
        onClick: () => {
          Object.assign(ui, { deleteId: c.id, deleteTarget: '', deleteError: '', renameId: null });
          app.rerender();
          focusKey('delete-heading');
        },
      }, 'Delete'))));
}

/**
 * @param {App} app
 * @param {Category} c
 * @returns {HTMLElement}
 */
function renameForm(app, c) {
  const cancel = () => {
    ui.renameId = null;
    app.rerender();
    focusKey(`rename-${c.id}`);
  };
  const errorId = `rename-error-${c.id}`;
  return h('form', {
    class: 'inline-form', novalidate: true,
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      const result = updateCategory(app.store.state, c.id, { name: ui.renameValue });
      if ('error' in result) {
        ui.renameError = result.error;
        app.rerender();
        focusKey(`rename-input-${c.id}`);
        return;
      }
      ui.renameId = null;
      ui.rowError = '';
      app.store.apply(result).then(() => focusKey(`rename-${c.id}`));
    },
  },
  h('input', {
    type: 'text', class: 'name-input', value: ui.renameValue, autocomplete: 'off',
    'aria-label': `New name for ${c.name}`, 'data-focus-key': `rename-input-${c.id}`,
    'aria-invalid': ui.renameError ? 'true' : null, 'aria-describedby': ui.renameError ? errorId : null,
    onInput: (/** @type {Event} */ e) => { ui.renameValue = valueOf(e); },
    onKeydown: (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Escape') cancel(); },
  }),
  ui.renameError ? h('p', { class: 'error', id: errorId }, ui.renameError) : null,
  h('div', { class: 'row-actions' },
    h('button', { type: 'submit' }, 'Save'),
    h('button', { type: 'button', class: 'secondary', onClick: cancel }, 'Cancel')));
}

/**
 * Confirm a delete. When anything uses the category, ask where it should move to.
 * @param {App} app
 * @param {Category} c
 * @param {Category[]} list
 * @returns {HTMLElement}
 */
function deletePanel(app, c, list) {
  const use = categoryUseCount(app.store.state, c.id);
  const used = use.buckets + use.transactions > 0;
  const cancel = () => {
    ui.deleteId = null;
    app.rerender();
    focusKey(`delete-${c.id}`);
  };
  /** @param {string} [targetId] */
  const remove = (targetId) => whileSaving(panel, async () => {
    const result = deleteCategory(app.store.state, c.id, targetId);
    if ('error' in result) {
      ui.deleteError = result.error;
      app.rerender();
      focusKey('delete-target');
      return;
    }
    ui.deleteId = null;
    ui.rowError = '';
    await app.store.apply(result);
  });

  const panel = h('section', { class: 'card', 'aria-labelledby': 'delete-heading' },
    h('h3', { id: 'delete-heading', tabindex: '-1', 'data-focus-key': 'delete-heading' }, `Delete ${c.name}`));
  if (!used) {
    panel.append(
      h('p', null, `Nothing uses ${c.name}, so nothing needs to move.`),
      h('div', { class: 'actions' },
        h('button', { type: 'button', 'data-focus-key': 'delete-confirm', 'data-saves': true, onClick: () => remove() }, 'Yes, delete'),
        h('button', { type: 'button', class: 'secondary', onClick: cancel }, 'Cancel')));
    return panel;
  }
  const parts = [
    use.buckets ? plural(use.buckets, 'bucket', 'buckets') : '',
    use.transactions ? plural(use.transactions, 'transaction', 'transactions') : '',
  ].filter(Boolean);
  const target = h('select', {
    'data-focus-key': 'delete-target',
    onChange: (/** @type {Event} */ e) => { ui.deleteTarget = valueOf(e); },
  },
  h('option', { value: '', selected: ui.deleteTarget === '' }, 'Choose a category'),
  ...list.filter((o) => o.id !== c.id).map((o) => h('option', { value: o.id, selected: o.id === ui.deleteTarget }, o.name)));
  panel.append(
    h('p', null, `${c.name} is used by ${parts.join(' and ')}.`),
    field('Move its items to', target, ui.deleteError),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', 'data-focus-key': 'delete-confirm', 'data-saves': true, onClick: () => remove(ui.deleteTarget || undefined),
      }, 'Delete and move'),
      h('button', { type: 'button', class: 'secondary', onClick: cancel }, 'Cancel')));
  return panel;
}

/**
 * @param {App} app
 * @returns {HTMLElement}
 */
function newForm(app) {
  const d = ui.draft;
  const budgetField = field('Budget type', h('select', {
    'data-focus-key': 'new-budget',
    onChange: (/** @type {Event} */ e) => { d.budgetType = /** @type {BudgetType} */ (valueOf(e)); },
  }, ...options(BUDGET_LABELS, d.budgetType)));
  budgetField.hidden = !isBudgeted(d.kind);

  const nameInput = h('input', {
    type: 'text', value: d.name, autocomplete: 'off', 'data-focus-key': 'new-name',
    onInput: (/** @type {Event} */ e) => { d.name = valueOf(e); },
  });
  // After Add category, focus goes to the name, ready for the next one.
  const form = h('form', {
    novalidate: true,
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      whileSaving(form, async () => {
        const result = createCategory(app.store.state, {
          name: d.name, kind: d.kind, ...(isBudgeted(d.kind) ? { budgetType: d.budgetType } : {}),
        });
        if ('error' in result) {
          ui.createError = result.error;
          app.rerender();
          focusKey('new-name');
          return;
        }
        d.name = '';
        ui.createError = '';
        await app.store.apply(result);
      }, nameInput);
    },
  },
  field('Name', nameInput, ui.createError),
  field('Kind', h('select', {
    'data-focus-key': 'new-kind',
    onChange: (/** @type {Event} */ e) => {
      d.kind = /** @type {CategoryKind} */ (valueOf(e));
      budgetField.hidden = !isBudgeted(d.kind);
    },
  }, ...options(KIND_LABELS, d.kind))),
  budgetField,
  h('div', { class: 'actions' }, h('button', { type: 'submit', 'data-focus-key': 'new-add', 'data-saves': true }, 'Add category')));

  return h('section', { 'aria-labelledby': 'new-category-heading' },
    h('h3', { id: 'new-category-heading' }, 'New category'),
    form);
}

