// Shared by the Categories Editor's server and page: the rules a default category must meet,
// and how src/default-categories.js is written. Pure functions, no Node or DOM APIs.

export const KINDS = ['spend', 'income', 'contribution', 'saving', 'transfer', 'ignore'];
export const BUDGET_TYPES = ['fixed', 'variable', 'annual', 'oneoff'];
export const BUDGETED_KINDS = ['spend', 'income', 'contribution', 'saving'];
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPENING = 'export default [';

/** @typedef {{id: string, name: string, kind: string, budgetType?: string}} Entry */

/**
 * An id made from a name: lower case, letters and digits, words joined by hyphens.
 * @param {string} name
 * @returns {string}
 */
export function slug(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Problems that stop a save, each tied to a row index, or -1 for the whole list.
 * @param {Entry[]} list
 * @param {Record<string, number>} merchantCounts merchant entries per category id
 * @returns {{index: number, message: string}[]}
 */
export function validate(list, merchantCounts) {
  /** @type {{index: number, message: string}[]} */
  const errors = [];
  const ids = new Map();
  const names = new Map();
  list.forEach((c, index) => {
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (typeof c.id !== 'string' || !ID.test(c.id)) errors.push({ index, message: `id "${c.id}" must be lower-case letters, digits and hyphens` });
    else if (ids.has(c.id)) errors.push({ index, message: `id "${c.id}" is already used by row ${ids.get(c.id) + 1}` });
    else ids.set(c.id, index);
    if (name === '') errors.push({ index, message: 'Name is empty' });
    else if (name !== c.name) errors.push({ index, message: 'Name has spaces at the start or end' });
    else if (/[\u0000-\u001f\u007f]/.test(name)) errors.push({ index, message: 'Name has a control character' });
    else {
      const folded = name.toLowerCase();
      if (names.has(folded)) errors.push({ index, message: `Name is the same as row ${names.get(folded) + 1}` });
      else names.set(folded, index);
    }
    if (!KINDS.includes(c.kind)) errors.push({ index, message: `Kind "${c.kind}" is not one of ${KINDS.join(', ')}` });
    else if (BUDGETED_KINDS.includes(c.kind)) {
      if (!c.budgetType || !BUDGET_TYPES.includes(c.budgetType)) errors.push({ index, message: 'Choose a Type' });
    } else if ('budgetType' in c) {
      errors.push({ index, message: `A ${c.kind} category has no Type` });
    }
    const used = merchantCounts[c.id] ?? 0;
    if (used > 0 && c.kind !== 'spend') {
      errors.push({ index, message: `${used} merchant suggestions point here, so it must stay spend` });
    }
  });
  for (const [id, used] of Object.entries(merchantCounts)) {
    if (used > 0 && !list.some((c) => c.id === id)) {
      errors.push({ index: -1, message: `"${id}" is deleted, but ${used} merchant suggestions point at it` });
    }
  }
  return errors;
}

/**
 * A JavaScript string literal in single quotes, as the file uses.
 * @param {string} s
 * @returns {string}
 */
function quote(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Everything in the source up to and including the line that opens the list.
 * @param {string} source
 * @returns {string}
 */
export function header(source) {
  const at = source.indexOf(OPENING);
  if (at < 0) throw new Error(`src/default-categories.js has no "${OPENING}" line`);
  return source.slice(0, at + OPENING.length) + '\n';
}

/**
 * The whole file: the existing header, one line per entry, and the closing bracket.
 * @param {string} head from header()
 * @param {Entry[]} list
 * @returns {string}
 */
export function render(head, list) {
  const lines = list.map((c) => {
    const parts = [`id: ${quote(c.id)}`, `name: ${quote(c.name)}`, `kind: ${quote(c.kind)}`];
    if (c.budgetType) parts.push(`budgetType: ${quote(c.budgetType)}`);
    return `  { ${parts.join(', ')} },`;
  });
  return `${head}${lines.join('\n')}\n];\n`;
}

/**
 * Only the known fields, in the file's order, so a save never writes stray properties.
 * @param {Entry} c
 * @returns {Entry}
 */
export function clean(c) {
  /** @type {Entry} */
  const out = { id: c.id, name: c.name, kind: c.kind };
  if (BUDGETED_KINDS.includes(c.kind) && c.budgetType) out.budgetType = c.budgetType;
  return out;
}
