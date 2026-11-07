// Categories Editor page. Builds the DOM with createElement and textContent only.
import { KINDS, BUDGET_TYPES, BUDGETED_KINDS, slug, validate, clean } from './format.js';

/** @typedef {import('./format.js').Entry} Entry */
/** @typedef {Entry & {uid: number, isNew: boolean}} Row */

const listEl = /** @type {HTMLOListElement} */ (document.getElementById('list'));
const saveBtn = /** @type {HTMLButtonElement} */ (document.getElementById('save'));
const revertBtn = /** @type {HTMLButtonElement} */ (document.getElementById('revert'));
const statusEl = /** @type {HTMLElement} */ (document.getElementById('status'));
const problemsEl = /** @type {HTMLUListElement} */ (document.getElementById('problems'));
const addForm = /** @type {HTMLFormElement} */ (document.getElementById('add'));
const addName = /** @type {HTMLInputElement} */ (document.getElementById('add-name'));

/** @type {Record<string, string>} */
const TYPE_LABELS = { oneoff: 'one-off' };

let nextUid = 1;
/** @type {Row[]} */
let rows = [];
/** @type {Entry[]} */
let saved = [];
/** @type {Record<string, number>} */
let merchantCounts = {};
let version = '';
/** @type {Row|null} */
let dragged = null;
let message = '';

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node|string|null)[]} children
 */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== null) node.append(c);
  return node;
}

/** @param {{categories: Entry[], merchantCounts: Record<string, number>, version: string}} data */
function load(data) {
  saved = data.categories.map(clean);
  merchantCounts = data.merchantCounts;
  version = data.version;
  rows = saved.map((c) => ({ ...c, uid: nextUid++, isNew: false }));
  build();
}

const entries = () => rows.map(clean);
const dirty = () => JSON.stringify(entries()) !== JSON.stringify(saved);

/** @param {Row} row */
function changed(row) {
  const before = saved.find((c) => c.id === row.id);
  return !!before && JSON.stringify(clean(row)) !== JSON.stringify(before);
}

/** A new row's id follows its name, made unique against every other row. @param {Row} row */
function setNewId(row) {
  const base = slug(row.name) || 'category';
  const taken = new Set(rows.filter((r) => r !== row).map((r) => r.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  row.id = id;
}

/** @param {number} i */
const keyFor = (i) => (i < 10 ? String((i + 1) % 10) : '');

/** @param {Row} row @param {number} i */
function rowEl(row, i) {
  const li = el('li', { 'data-uid': String(row.uid) });
  const handle = el('button', {
    type: 'button', class: 'handle', 'aria-label': `Move ${row.name || 'new category'}`,
    title: 'Drag, or use the up and down arrow keys',
  }, '⋮⋮');
  const name = /** @type {HTMLInputElement} */ (el('input', { class: 'name', 'aria-label': 'Name', value: row.name }));
  const kind = /** @type {HTMLSelectElement} */ (el('select', { 'aria-label': 'Kind' },
    ...KINDS.map((k) => el('option', { value: k }, k))));
  kind.value = row.kind;
  const type = /** @type {HTMLSelectElement} */ (el('select', { 'aria-label': 'Type' }));
  const id = el('span', { class: 'id' });
  const uses = merchantCounts[row.id] ?? 0;
  const del = /** @type {HTMLButtonElement} */ (el('button', {
    type: 'button', class: 'delete', 'aria-label': `Delete ${row.name || 'new category'}`,
  }, '✕'));
  if (uses > 0 && !row.isNew) {
    del.disabled = true;
    del.title = `${uses} merchant suggestion${uses === 1 ? '' : 's'} point here`;
  } else del.title = 'Delete';

  const fillType = () => {
    type.replaceChildren();
    if (BUDGETED_KINDS.includes(row.kind)) {
      type.disabled = false;
      if (!row.budgetType) type.append(el('option', { value: '' }, 'Choose…'));
      for (const t of BUDGET_TYPES) type.append(el('option', { value: t }, TYPE_LABELS[t] ?? t));
      type.value = row.budgetType ?? '';
    } else {
      type.disabled = true;
      type.append(el('option', { value: '' }, '—'));
    }
  };
  const fillId = () => {
    id.replaceChildren(row.isNew ? `${row.id} (new)` : row.id);
    if (uses > 0 && !row.isNew) id.append(el('span', { class: 'uses' }, `${uses} merchant${uses === 1 ? '' : 's'}`));
  };
  fillType();
  fillId();

  name.addEventListener('input', () => {
    row.name = name.value;
    if (row.isNew) { setNewId(row); fillId(); }
    handle.setAttribute('aria-label', `Move ${row.name}`);
    del.setAttribute('aria-label', `Delete ${row.name}`);
    edited();
  });
  kind.addEventListener('change', () => {
    row.kind = kind.value;
    if (!BUDGETED_KINDS.includes(row.kind)) delete row.budgetType;
    fillType();
    edited();
  });
  type.addEventListener('change', () => {
    if (type.value) row.budgetType = type.value; else delete row.budgetType;
    fillType();
    edited();
  });
  del.addEventListener('click', () => {
    rows = rows.filter((r) => r !== row);
    message = '';
    build();
  });

  handle.addEventListener('keydown', (e) => {
    const from = rows.indexOf(row);
    const to = e.key === 'ArrowUp' ? from - 1 : e.key === 'ArrowDown' ? from + 1 : -1;
    if (to < 0 || to >= rows.length) return;
    e.preventDefault();
    move(row, to);
    focusHandle(row);
  });
  // Only the handle starts a drag, so text in the name box can still be selected.
  handle.addEventListener('pointerdown', () => li.setAttribute('draggable', 'true'));
  handle.addEventListener('pointerup', () => li.removeAttribute('draggable'));
  li.addEventListener('dragstart', (e) => {
    dragged = row;
    li.classList.add('dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.id); }
  });
  li.addEventListener('dragend', () => {
    dragged = null;
    li.removeAttribute('draggable');
    build();
  });
  li.addEventListener('dragover', (e) => {
    if (!dragged || dragged === row) return;
    e.preventDefault();
    const after = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
    clearDropMarks();
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  li.addEventListener('drop', (e) => {
    if (!dragged || dragged === row) return;
    e.preventDefault();
    const after = li.classList.contains('drop-after');
    const without = rows.filter((r) => r !== dragged);
    without.splice(without.indexOf(row) + (after ? 1 : 0), 0, dragged);
    rows = without;
    message = '';
  });

  li.append(
    el('div', { class: 'row' }, el('span', { class: 'key' }, keyFor(i)), handle, name, kind, type, id, del),
    el('p', { class: 'row-errors' }),
  );
  if (i === 9) li.classList.add('last-key');
  return li;
}

function clearDropMarks() {
  for (const li of listEl.querySelectorAll('.drop-before, .drop-after')) li.classList.remove('drop-before', 'drop-after');
}

/** @param {Row} row @param {number} to */
function move(row, to) {
  const without = rows.filter((r) => r !== row);
  without.splice(to, 0, row);
  rows = without;
  message = '';
  build();
}

/** @param {Row} row */
function focusHandle(row) {
  const btn = listEl.querySelector(`li[data-uid="${row.uid}"] .handle`);
  if (btn instanceof HTMLElement) btn.focus();
}

/** After any edit: drop the last save's message, then redraw the marks. */
function edited() {
  message = '';
  refresh();
}

function build() {
  listEl.replaceChildren(...rows.map(rowEl));
  refresh();
}

/** Marks, row errors, the problem list and the status line, without rebuilding the rows. */
function refresh() {
  const errors = validate(entries(), merchantCounts);
  rows.forEach((row, i) => {
    const li = listEl.children[i];
    if (!li) return;
    const mine = errors.filter((e) => e.index === i).map((e) => e.message);
    li.classList.toggle('new', row.isNew);
    li.classList.toggle('changed', !row.isNew && changed(row));
    li.classList.toggle('invalid', mine.length > 0);
    const p = li.querySelector('.row-errors');
    if (p) p.textContent = mine.join(' · ');
  });
  problemsEl.replaceChildren(...errors.filter((e) => e.index < 0).map((e) => el('li', {}, e.message)));

  const isDirty = dirty();
  const deleted = saved.filter((c) => !rows.some((r) => r.id === c.id && !r.isNew));
  const parts = [];
  if (message) parts.push(message);
  if (isDirty) {
    parts.push('Unsaved changes');
    if (deleted.length) parts.push(`deleted: ${deleted.map((c) => c.name).join(', ')}`);
    if (errors.length) parts.push(`${errors.length} problem${errors.length === 1 ? '' : 's'} to fix before saving`);
  } else if (!message) parts.push(`${rows.length} categories, all saved`);
  statusEl.textContent = parts.join(' · ');
  saveBtn.disabled = !isDirty || errors.length > 0;
  revertBtn.disabled = !isDirty;
}

async function fetchData() {
  const res = await fetch('/data', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Loading failed: ${res.status}`);
  return res.json();
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  let res, body;
  try {
    res = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, categories: entries() }),
    });
    body = await res.json();
  } catch (err) {
    message = `Not saved: ${err instanceof Error ? err.message : err}. Is the server still running?`;
    refresh();
    return;
  }
  if (res.ok) {
    message = `Saved at ${new Date().toLocaleTimeString()}`;
    load(body);
  } else {
    message = body.error + (body.errors ? `: ${body.errors.map((/** @type {{message: string}} */ e) => e.message).join('; ')}` : '');
    refresh();
  }
});

revertBtn.addEventListener('click', async () => {
  if (!confirm('Throw away unsaved changes and reload the file?')) return;
  message = '';
  load(await fetchData());
});

addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = addName.value.trim();
  if (!name) return;
  /** @type {Row} */
  const row = { id: '', name, kind: 'spend', uid: nextUid++, isNew: true };
  setNewId(row);
  rows.push(row);
  addName.value = '';
  message = '';
  build();
  listEl.lastElementChild?.scrollIntoView({ block: 'center' });
  const typeSelect = listEl.lastElementChild?.querySelectorAll('select')[1];
  if (typeSelect instanceof HTMLElement) typeSelect.focus();
});

listEl.addEventListener('dragleave', (e) => {
  if (!(e.relatedTarget instanceof Node) || !listEl.contains(e.relatedTarget)) clearDropMarks();
});

window.addEventListener('beforeunload', (e) => {
  if (dirty()) e.preventDefault();
});

load(await fetchData());
