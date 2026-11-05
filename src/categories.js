// Categories: seeding and offering defaults, and creating, editing and deleting categories.
// Every function returns Changes (or {error}) and never mutates the state it is given.

/** @import {State, Changes, Settings, Category, CategoryKind, BudgetType, Override} from './types.js' */
import DEFAULTS from './default-categories.js';
import { emptyState } from './changes.js';
import { cmp, compareNames } from './order.js';

/** @typedef {{id:string,name:string,kind:CategoryKind,budgetType?:BudgetType}} Default */
/** @typedef {{error:string}} Invalid */

/** @type {CategoryKind[]} */
export const KINDS = ['spend', 'income', 'contribution', 'transfer', 'ignore'];
/** @type {BudgetType[]} */
export const BUDGET_TYPES = ['fixed', 'variable', 'annual', 'oneoff'];

/**
 * Spend, income and contribution need a budget type; transfer and ignore have none.
 * @param {CategoryKind} kind
 */
export const isBudgeted = (kind) => kind === 'spend' || kind === 'income' || kind === 'contribution';

/** @param {string} name */
const fold = (name) => name.trim().toLowerCase();

/** @param {State} state */
const nextPosition = (state) => state.categories.reduce((max, c) => Math.max(max, c.position), -1) + 1;

/**
 * Record ids as offered, keeping the existing order and adding new ones at the end.
 * @param {Settings} settings
 * @param {string[]} ids
 * @returns {Settings}
 */
function offered(settings, ids) {
  return { ...settings, offeredDefaultIds: [...new Set([...settings.offeredDefaultIds, ...ids])] };
}

/**
 * @param {Default} d
 * @param {number} position
 * @returns {Category}
 */
function fromDefault(d, position) {
  return {
    id: crypto.randomUUID(), name: d.name, kind: d.kind,
    ...(isBudgeted(d.kind) && d.budgetType ? { budgetType: d.budgetType } : {}),
    defaultId: d.id, position,
  };
}

/**
 * First run only (no categories and nothing offered yet): add every default and record them all
 * as offered. Otherwise no changes.
 * @param {Default[]} defaults
 * @param {State} state
 * @returns {Changes}
 */
export function seedDefaults(defaults, state) {
  if (state.categories.length > 0 || state.settings.offeredDefaultIds.length > 0) return {};
  return {
    put: {
      categories: defaults.map((d, i) => fromDefault(d, i)),
      settings: [offered(state.settings, defaults.map((d) => d.id))],
    },
  };
}

/**
 * Everything a first visit stores, for store.replaceAll: fresh settings, and every default seeded
 * and recorded as offered, exactly as seedDefaults does on first run.
 * @param {Default[]} defaults
 * @returns {Changes}
 */
export function firstRunChanges(defaults) {
  return seedDefaults(defaults, emptyState());
}

/**
 * Defaults never offered to this user, in file order.
 * @param {Default[]} defaults
 * @param {Settings} settings
 * @returns {Default[]}
 */
export function pendingDefaults(defaults, settings) {
  const seen = new Set(settings.offeredDefaultIds);
  return defaults.filter((d) => !seen.has(d.id));
}

/**
 * Add the given defaults after the last category, skipping any whose name already exists
 * (ignoring case). Every given id is recorded as offered.
 * @param {State} state
 * @param {string[]} ids
 * @param {Default[]} [defaults]
 * @returns {Changes}
 */
export function acceptDefaults(state, ids, defaults = DEFAULTS) {
  const wanted = new Set(ids);
  const names = new Set(state.categories.map((c) => fold(c.name)));
  let position = nextPosition(state);
  /** @type {Category[]} */
  const added = [];
  for (const d of defaults) {
    if (!wanted.has(d.id) || names.has(fold(d.name))) continue;
    names.add(fold(d.name));
    added.push(fromDefault(d, position++));
  }
  return {
    put: {
      ...(added.length ? { categories: added } : {}),
      settings: [offered(state.settings, ids)],
    },
  };
}

/**
 * Record the given defaults as offered without adding them.
 * @param {State} state
 * @param {string[]} ids
 * @returns {Changes}
 */
export function dismissDefaults(state, ids) {
  return { put: { settings: [offered(state.settings, ids)] } };
}

/**
 * Check a whole category. Returns an error message, or null when valid.
 * @param {State} state
 * @param {{id?:string,name:string,kind:string,budgetType?:string}} c
 * @returns {string|null}
 */
function invalid(state, c) {
  if (!c.name) return 'Enter a name.';
  const clash = state.categories.find((o) => o.id !== c.id && fold(o.name) === fold(c.name));
  if (clash) return `There is already a category called ${clash.name}.`;
  if (!KINDS.includes(/** @type {CategoryKind} */ (c.kind))) return 'Choose a kind.';
  if (isBudgeted(/** @type {CategoryKind} */ (c.kind))) {
    if (!BUDGET_TYPES.includes(/** @type {BudgetType} */ (c.budgetType))) return 'Choose a budget type.';
  } else if (c.budgetType !== undefined) {
    return 'Transfer and ignore categories have no budget type.';
  }
  return null;
}

/**
 * @param {State} state
 * @param {{name:string,kind:CategoryKind,budgetType?:BudgetType}} input
 * @returns {Changes | Invalid}
 */
export function createCategory(state, { name, kind, budgetType }) {
  const candidate = { name: String(name ?? '').trim(), kind, ...(budgetType !== undefined ? { budgetType } : {}) };
  const error = invalid(state, candidate);
  if (error) return { error };
  /** @type {Category} */
  const category = { id: crypto.randomUUID(), ...candidate, position: nextPosition(state) };
  return { put: { categories: [category] } };
}

/**
 * Change a category's name, kind or budget type. Changing to transfer or ignore drops the
 * budget type. The id, position and defaultId never change.
 * @param {State} state
 * @param {string} id
 * @param {{name?:string,kind?:CategoryKind,budgetType?:BudgetType}} patch
 * @returns {Changes | Invalid}
 */
export function updateCategory(state, id, patch) {
  const current = state.categories.find((c) => c.id === id);
  if (!current) return { error: 'That category no longer exists.' };
  /** @type {Category} */
  const next = { ...current };
  if (patch.name !== undefined) next.name = String(patch.name).trim();
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.budgetType !== undefined) next.budgetType = patch.budgetType;
  if (!isBudgeted(next.kind) && patch.budgetType === undefined) delete next.budgetType;
  const error = invalid(state, next);
  if (error) return { error };
  return { put: { categories: [next] } };
}

/**
 * How many buckets and transactions (overrides, counting a split once) refer to a category.
 * @param {State} state
 * @param {string} id
 * @returns {{buckets:number,transactions:number}}
 */
export function categoryUseCount(state, id) {
  const buckets = state.buckets.filter((b) => b.categoryId === id).length;
  let transactions = 0;
  for (const o of state.overrides.values()) {
    if (o.categoryId === id || (o.splits ?? []).some((p) => p.categoryId === id)) transactions++;
  }
  return { buckets, transactions };
}

/**
 * Delete a category. Anything that refers to it (a bucket's category, an override's category or
 * a split part) moves to `targetId`, which is required when anything does.
 * @param {State} state
 * @param {string} id
 * @param {string} [targetId]
 * @returns {Changes | Invalid}
 */
export function deleteCategory(state, id, targetId) {
  if (!state.categories.some((c) => c.id === id)) return { error: 'That category no longer exists.' };
  const use = categoryUseCount(state, id);
  if (use.buckets + use.transactions === 0) return { del: { categories: [id] } };
  if (!targetId) return { error: 'Choose a category to move its items to.' };
  if (targetId === id) return { error: 'Choose a different category.' };
  if (!state.categories.some((c) => c.id === targetId)) return { error: 'That category no longer exists.' };

  const buckets = state.buckets.filter((b) => b.categoryId === id).map((b) => ({ ...b, categoryId: targetId }));
  /** @type {Override[]} */
  const overrides = [];
  for (const o of state.overrides.values()) {
    const splitHit = (o.splits ?? []).some((p) => p.categoryId === id);
    if (o.categoryId !== id && !splitHit) continue;
    /** @type {Override} */
    const next = { ...o };
    if (o.categoryId === id) next.categoryId = targetId;
    if (o.splits && splitHit) next.splits = o.splits.map((p) => (p.categoryId === id ? { ...p, categoryId: targetId } : p));
    overrides.push(next);
  }
  return {
    put: {
      ...(buckets.length ? { buckets } : {}),
      ...(overrides.length ? { overrides } : {}),
    },
    del: { categories: [id] },
  };
}

/**
 * @param {State} state
 * @returns {Category[]} a new array, sorted by position
 */
export function orderedCategories(state) {
  return [...state.categories].sort((a, b) => a.position - b.position);
}

/**
 * For dropdowns, where people scan for a name. Ties (names equal ignoring case and accents)
 * fall back to id, so the order is fixed.
 * @param {State} state
 * @returns {Category[]} a new array, sorted by name
 */
export function sortedCategories(state) {
  return [...state.categories].sort((a, b) => compareNames(a.name, b.name) || cmp(a.id, b.id));
}
