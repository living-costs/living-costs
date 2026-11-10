// The Category filter select, shared by lists that filter by category, kind or budget type.

/** @import {State} from '../types.js' */
import { h } from '../dom.js';
import { KINDS, BUDGET_TYPES, sortedCategories } from '../categories.js';
import { KIND_LABELS, BUDGET_LABELS, field, valueOf, focusKey } from './form.js';

/**
 * The Category field. Values are those of category-filter.js. A change calls onChange, then
 * focuses `focusKey` (the caller redraws, which drops focus).
 * @param {State} state
 * @param {{value: string, uncategorised: boolean, focusKey: string, onChange: (value: string) => void}} opts
 * @returns {HTMLElement}
 */
export function categoryFilterField(state, { value, uncategorised, focusKey: key, onChange }) {
  /** @param {string} v @param {string} label */
  const option = (v, label) => h('option', { value: v, selected: v === value }, label);
  return field('Category', h('select', {
    'data-focus-key': key,
    onChange: (/** @type {Event} */ e) => { onChange(valueOf(e)); focusKey(key); },
  },
  option('', 'All categories'),
  uncategorised ? option('none', 'Uncategorised') : null,
  ...KINDS.map((k) => option(`kind:${k}`, `By kind: ${KIND_LABELS[k]}`)),
  ...BUDGET_TYPES.map((t) => option(`type:${t}`, `By type: ${BUDGET_LABELS[t]}`)),
  ...sortedCategories(state).map((c) => option(`category:${c.id}`, c.name))));
}
