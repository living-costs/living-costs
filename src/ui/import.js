// The import flow on the Accounts screen. A small state machine local to this module:
// pick → account → (mismatch) → (mapping) → (problems) → period → (review) → summary → pick.
// Each step only drives the pure pipeline in ../import.js; nothing is saved until Import.

/** @import {App} from '../main.js' */
/** @import {Account, Mapping} from '../types.js' */
/** @import {PreparedFile, MappedFile, PlannedFile, ImportPlan} from '../import.js' */
import { h } from '../dom.js';
import { checkboxField, focusKey, field, help, plural } from './form.js';
import { whileSaving } from './saving.js';
import { cmp } from '../order.js';
/** @import {Child} from '../dom.js' */
import { resumedBuckets } from '../buckets.js';
import { prepareFiles, suggestAccounts, mapFiles, planImport, commitImport } from '../import.js';
import { applyMapping, mappingProblems } from '../mapping.js';
import { formatMoney, currencyExponent } from '../money.js';
import { parseDate, formatDate, formatLocalDate, formatMonth, monthStart, monthEnd } from '../dates.js';

/** @typedef {'pick'|'account'|'mismatch'|'mapping'|'problems'|'period'|'review'|'summary'} Step */
/** @typedef {'dateColumn'|'descriptionColumn'|'typeColumn'|'accountIdColumn'|'amountColumn'|'debitColumn'|'creditColumn'} ColumnKey */
/**
 * @typedef {{name:string, kind:'bank'|'card'|'savings', currency:string, amountStyle:'single'|'split',
 *   signFlipped:boolean} & Record<ColumnKey,string>} MappingForm
 */
/** @typedef {{from:string, to:string, fromError?:string, toError?:string}} PeriodInput */
/**
 * @typedef {{step:Step, messages:string[], prepared:PreparedFile[], choice:string, account:Account|null,
 *   form:MappingForm, formErrors:string[], files:MappedFile[], skip:Map<string,Set<number>>,
 *   periods:Map<string,PeriodInput>, planned:PlannedFile[], plan:ImportPlan|null,
 *   decisions:Map<string,'same'|'both'>, plannedAt:number}} Flow
 */

const NEW = 'new';

/** @returns {MappingForm} */
function blankForm() {
  return {
    name: '', kind: 'bank', currency: 'GBP', amountStyle: 'single', signFlipped: false,
    dateColumn: '', descriptionColumn: '', typeColumn: '', accountIdColumn: '',
    amountColumn: '', debitColumn: '', creditColumn: '',
  };
}

/** @returns {Flow} */
function fresh() {
  return {
    step: 'pick', messages: [], prepared: [], choice: '', account: null, form: blankForm(), formErrors: [],
    files: [], skip: new Map(), periods: new Map(), planned: [], plan: null, decisions: new Map(), plannedAt: -1,
  };
}

/** @type {Flow} */
let flow = fresh();

// Bumped on every store change. `flow.plannedAt` records its value when the plan was made, so
// Import can tell that the data moved underneath the plan (the flow survives navigation).
let changeCount = 0;
/** @type {WeakSet<object>} */
const watched = new WeakSet();

const CHANGED_NOTE = 'Your data changed, so the summary has been updated. Check it and import again.';

/** Drop any half-finished import, so the Accounts screen starts at the file picker. */
export function resetImport() {
  flow = fresh();
}

/** @returns {boolean} true while a pick is in progress (any step after choosing files) */
export function importActive() {
  return flow.step !== 'pick';
}

/**
 * Render the current step of the import flow into `root`.
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function renderImport(root, app) {
  if (!watched.has(app.store)) {
    watched.add(app.store);
    app.store.subscribe(() => { changeCount++; });
  }
  const STEPS = {
    pick: renderPick, account: renderAccount, mismatch: renderMismatch, mapping: renderMapping,
    problems: renderProblems, period: renderPeriod, review: renderReview, summary: renderSummary,
  };
  STEPS[flow.step](root, app);
}

// --- Helpers -----------------------------------------------------------------------------------

/**
 * Append children to `root`, skipping null and false as `h()` does.
 * @param {HTMLElement} root
 * @param {...Child} children
 */
const put = (root, ...children) => root.append(...h('div', null, ...children).childNodes);

/** @param {string} text */
const stepHeading = (text) => h('h4', { tabindex: '-1', 'data-focus-key': 'import-step' }, text);

/** Messages from earlier steps (blocked or refused files, results), shown under the step heading. */
function messages() {
  if (flow.messages.length === 0) return null;
  return h('div', { class: 'banner', role: 'status' }, ...flow.messages.map((m) => h('p', null, m)));
}

/**
 * Move to a step, redraw and put focus on its heading (or on `focus`).
 * @param {App} app
 * @param {Step} step
 * @param {string} [focus]
 */
function go(app, step, focus = 'import-step') {
  flow.step = step;
  app.rerender();
  focusKey(focus);
}

/**
 * Abandon the pick, keeping these messages for the pick step.
 * @param {App} app
 * @param {string[]} [keep]
 */
function restart(app, keep = []) {
  flow = fresh();
  flow.messages = keep;
  go(app, 'pick');
}

/**
 * @param {string} label
 * @param {(app: App) => void} onClick
 * @param {App} app
 * @param {Record<string, unknown>} [props]
 */
const button = (label, onClick, app, props = {}) => h('button', { type: 'button', ...props, onClick: () => onClick(app) }, label);

/** @param {App} app */
const cancelButton = (app) => button('Cancel', () => restart(app), app, { class: 'secondary', 'data-focus-key': 'import-cancel' });

/** @param {unknown} err */
const detail = (err) => (err instanceof Error ? err.message : String(err));

/** @param {string} text */
const raw = (text) => h('span', { class: 'raw' }, text === '' ? '(no description)' : text);

/**
 * @param {string} code
 * @returns {boolean}
 */
function validCurrency(code) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try { currencyExponent(code); return true; } catch { return false; }
}

// --- 1. Pick files -----------------------------------------------------------------------------

/**
 * @param {HTMLElement} root
 * @param {App} app
 */
function renderPick(root, app) {
  /** @param {FileList|null} list */
  const take = (list) => { if (list && list.length) onPick(app, [...list]); };
  const zone = h('div', {
    class: 'dropzone',
    onDragover: (/** @type {DragEvent} */ e) => { e.preventDefault(); zone.classList.add('over'); },
    onDragleave: () => zone.classList.remove('over'),
    onDrop: (/** @type {DragEvent} */ e) => {
      e.preventDefault();
      zone.classList.remove('over');
      take(e.dataTransfer?.files ?? null);
    },
  }, 'Or drop CSV files here.');
  put(root,
    stepHeading('Choose files'),
    messages(),
    help('Choose one or more CSV statements for one account. Each file is checked before anything is saved.'),
    field('Choose CSV files', h('input', {
      type: 'file', multiple: true, accept: '.csv,text/csv', 'data-focus-key': 'import-files',
      onChange: (/** @type {Event} */ e) => take(/** @type {HTMLInputElement} */ (e.target).files),
    })),
    zone,
  );
}

/**
 * @param {App} app
 * @param {File[]} picked
 */
async function onPick(app, picked) {
  let result;
  try {
    const files = await Promise.all(picked.map(async (f) => ({ name: f.name, bytes: await f.arrayBuffer() })));
    result = await prepareFiles(app.store.state, files);
  } catch (err) {
    restart(app, [`The files could not be read. ${detail(err)}`]);
    return;
  }
  const notes = result.blocked.map((b) => `"${b.name}" was already imported on ${formatLocalDate(b.importedAt)} into ${b.accountName}.`);
  if (result.signatureError) {
    restart(app, [...notes, `${result.signatureError}. Choose files for one account at a time.`]);
    return;
  }
  if (result.files.length === 0) {
    restart(app, [...notes, 'No files are left to import.']);
    return;
  }
  flow = fresh();
  flow.messages = notes;
  flow.prepared = result.files;
  go(app, 'account');
}

// --- 2. Account --------------------------------------------------------------------------------

/**
 * @param {HTMLElement} root
 * @param {App} app
 */
function renderAccount(root, app) {
  const { accounts } = app.store.state;
  const suggested = suggestAccounts(app.store.state, flow.prepared[0].signature);
  const rest = accounts.filter((a) => !suggested.includes(a));
  /** @type {{value:string, label:string}[]} */
  const options = [
    ...suggested.map((a) => ({ value: a.id, label: `${a.name} (matches these columns)` })),
    ...rest.filter((a) => a.kind !== 'placeholder').map((a) => ({ value: a.id, label: a.name })),
    ...rest.filter((a) => a.kind === 'placeholder').map((a) => ({ value: a.id, label: `${a.name} (placeholder)` })),
    { value: NEW, label: 'New account' },
  ];
  const cont = button('Continue', onAccountContinue, app, { disabled: !flow.choice, 'data-focus-key': 'import-continue' });
  put(root,
    stepHeading('Account'),
    messages(),
    h('p', null, `Files: ${flow.prepared.map((f) => f.name).join(', ')}`),
    h('fieldset', null,
      h('legend', null, 'Which account is this?'),
      ...options.map((o) => h('label', { class: 'choice' },
        h('input', {
          type: 'radio', name: 'import-account', value: o.value, checked: flow.choice === o.value,
          'data-focus-key': `account-${o.value}`,
          onChange: () => { flow.choice = o.value; cont.toggleAttribute('disabled', false); },
        }),
        o.label))),
    h('div', { class: 'actions' }, cont, cancelButton(app)),
  );
}

/** @param {App} app */
function onAccountContinue(app) {
  if (flow.choice === NEW) {
    flow.account = null;
    flow.form = blankForm();
    flow.formErrors = [];
    go(app, 'mapping');
    return;
  }
  const account = app.store.state.accounts.find((a) => a.id === flow.choice);
  if (!account) return;
  flow.account = account;
  if (account.kind === 'placeholder' || !account.mapping) {
    flow.form = { ...blankForm(), name: account.name, currency: account.currency, kind: account.kind === 'card' || account.kind === 'savings' ? account.kind : 'bank' };
    flow.formErrors = [];
    go(app, 'mapping');
    return;
  }
  if (account.mapping.headerSignature !== flow.prepared[0].signature) {
    go(app, 'mismatch');
    return;
  }
  mapAndContinue(app, account);
}

/**
 * @param {HTMLElement} root
 * @param {App} app
 */
function renderMismatch(root, app) {
  const name = flow.account?.name ?? '';
  put(root,
    stepHeading('Check the account'),
    messages(),
    h('p', { class: 'banner' }, `These columns don't match ${name}'s saved setup.`),
    h('p', null, 'The files may be for a different account. If you import anyway, files missing a column are refused.'),
    h('div', { class: 'actions' },
      button('Import anyway', () => { if (flow.account) mapAndContinue(app, flow.account); }, app),
      button('Choose again', () => go(app, 'account'), app, { class: 'secondary' }),
      cancelButton(app)),
  );
}

/**
 * Map the files with the account's mapping, then go to problems or the covered period.
 * @param {App} app
 * @param {Account} account
 */
function mapAndContinue(app, account) {
  flow.account = account;
  const { files, refused } = mapFiles(account, flow.prepared);
  const notes = refused.map((r) => `"${r.name}" can't be imported: ${r.reason}.`);
  if (files.length === 0) {
    restart(app, [...flow.messages, ...notes, 'No files are left to import.']);
    return;
  }
  flow.messages = [...flow.messages, ...notes];
  flow.files = files;
  flow.skip = new Map();
  if (files.some((f) => f.parseErrors.length || f.mapErrors.length)) go(app, 'problems');
  else toPeriod(app);
}

// --- 3. Mapping form ---------------------------------------------------------------------------

/**
 * @param {MappingForm} f
 * @param {string} headerSignature
 * @returns {Mapping|null} null until every required column is chosen
 */
function buildMapping(f, headerSignature) {
  if (!f.dateColumn || !f.descriptionColumn) return null;
  /** @type {Mapping['amount']} */
  let amount;
  if (f.amountStyle === 'single') {
    if (!f.amountColumn) return null;
    amount = { single: f.amountColumn, signFlipped: f.signFlipped };
  } else {
    if (!f.debitColumn || !f.creditColumn) return null;
    amount = { debit: f.debitColumn, credit: f.creditColumn };
  }
  /** @type {Mapping} */
  const m = { headerSignature, dateColumn: f.dateColumn, dateFormat: 'DD/MM/YYYY', descriptionColumn: f.descriptionColumn, amount };
  if (f.typeColumn) m.typeColumn = f.typeColumn;
  if (f.accountIdColumn) m.accountIdColumn = f.accountIdColumn;
  return m;
}


/**
 * @param {HTMLElement} root
 * @param {App} app
 */
function renderMapping(root, app) {
  const f = flow.form;
  const first = flow.prepared[0];
  const header = first.header;
  const signature = first.signature;
  const isPlaceholder = flow.account?.kind === 'placeholder';

  const previewBox = h('div', { class: 'preview' });
  const amountBox = h('div', null);

  const refreshPreview = () => {
    previewBox.replaceChildren(preview(f, first, signature));
  };

  /**
   * @param {string} label
   * @param {ColumnKey} key
   * @param {boolean} optional
   */
  const columnSelect = (label, key, optional) => field(label, h('select', {
    'data-focus-key': `map-${key}`,
    onChange: (/** @type {Event} */ e) => { f[key] = /** @type {HTMLSelectElement} */ (e.target).value; refreshPreview(); },
  },
  h('option', { value: '', selected: f[key] === '' }, optional ? 'None' : 'Choose a column'),
  ...header.map((c) => h('option', { value: c, selected: f[key] === c }, c))));

  const refreshAmount = () => {
    amountBox.replaceChildren(...(f.amountStyle === 'single'
      ? [
        columnSelect('Amount column', 'amountColumn', false),
        checkboxField('Purchases are positive', h('input', {
          type: 'checkbox', checked: f.signFlipped, 'data-focus-key': 'map-flip',
          onChange: (/** @type {Event} */ e) => {
            f.signFlipped = /** @type {HTMLInputElement} */ (e.target).checked;
            refreshPreview();
          },
        }), { hint: 'Tick this for card files that show spending as positive amounts.' }),
      ]
      : [columnSelect('Debit column', 'debitColumn', false), columnSelect('Credit column', 'creditColumn', false)]));
  };

  /** @param {'single'|'split'} style @param {string} label */
  const styleRadio = (style, label) => h('label', { class: 'choice' },
    h('input', {
      type: 'radio', name: 'amount-style', value: style, checked: f.amountStyle === style,
      'data-focus-key': `map-style-${style}`,
      onChange: () => { f.amountStyle = style; refreshAmount(); refreshPreview(); },
    }),
    label);

  const errors = flow.formErrors.length ? h('div', { class: 'banner error-summary', role: 'alert', tabindex: '-1', 'data-focus-key': 'map-errors' },
    h('p', null, 'Check these before you continue:'),
    h('ul', null, ...flow.formErrors.map((e) => h('li', null, e)))) : null;

  refreshAmount();
  refreshPreview();
  put(root,
    stepHeading('Set up columns'),
    messages(),
    help(`Tell the app how to read ${first.name}. This is saved with the account.`),
    errors,
    field('Account name', h('input', {
      type: 'text', value: f.name, autocomplete: 'off', 'data-focus-key': 'map-name',
      onInput: (/** @type {Event} */ e) => { f.name = /** @type {HTMLInputElement} */ (e.target).value; },
    })),
    isPlaceholder ? null : field('Kind', h('select', {
      'data-focus-key': 'map-kind',
      onChange: (/** @type {Event} */ e) => {
        const v = /** @type {HTMLSelectElement} */ (e.target).value;
        f.kind = v === 'card' || v === 'savings' ? v : 'bank';
      },
    },
    h('option', { value: 'bank', selected: f.kind === 'bank' }, 'Bank'),
    h('option', { value: 'card', selected: f.kind === 'card' }, 'Card'),
    h('option', { value: 'savings', selected: f.kind === 'savings' }, 'Savings'))),
    field('Currency', h('input', {
      type: 'text', value: f.currency, autocomplete: 'off', maxlength: '3', class: 'short', 'data-focus-key': 'map-currency',
      onInput: (/** @type {Event} */ e) => {
        f.currency = /** @type {HTMLInputElement} */ (e.target).value.trim().toUpperCase();
        refreshPreview();
      },
    }), { hint: 'A three-letter code, such as GBP.' }),
    columnSelect('Date column', 'dateColumn', false),
    field('Date format', h('select', { 'data-focus-key': 'map-date-format' }, h('option', { value: 'DD/MM/YYYY', selected: true }, 'DD/MM/YYYY'))),
    columnSelect('Description column', 'descriptionColumn', false),
    columnSelect('Type column (optional)', 'typeColumn', true),
    columnSelect('Account number column (optional)', 'accountIdColumn', true),
    h('fieldset', null,
      h('legend', null, 'Amount style'),
      styleRadio('single', 'One signed column'),
      styleRadio('split', 'Separate debit and credit columns')),
    amountBox,
    previewBox,
    h('div', { class: 'actions' },
      button('Continue', onMappingContinue, app, { 'data-focus-key': 'import-continue' }),
      cancelButton(app)),
  );
}

/**
 * The live preview: the first 5 rows by date, as the app will read them.
 * @param {MappingForm} f
 * @param {PreparedFile} file
 * @param {string} signature
 * @returns {HTMLElement}
 */
function preview(f, file, signature) {
  const mapping = buildMapping(f, signature);
  if (!mapping) return h('p', null, 'Choose the date, description and amount columns to see a preview.');
  if (!validCurrency(f.currency)) return h('p', null, 'Enter a currency code to see a preview.');
  const { rows, errors } = applyMapping(mapping, file.header, file.rows, f.currency);
  const shown = [...rows].sort((a, b) => cmp(a.date, b.date)).slice(0, 5);
  const note = errors.length ? h('p', null, `${plural(errors.length, 'row', 'rows')} can't be read with these columns.`) : null;
  if (shown.length === 0) return h('div', null, h('p', null, 'No rows can be read with these columns.'), note);
  return h('div', null,
    h('table', null,
      h('caption', null, 'Preview'),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Description'), h('th', { scope: 'col', class: 'num' }, 'Amount'))),
      h('tbody', null, ...shown.map((r) => h('tr', null,
        h('td', null, formatDate(r.date)), h('td', null, raw(r.rawText)),
        h('td', { class: 'num' }, formatMoney(r.amountMinor, f.currency)))))),
    help('The earliest 5 rows, as the app will read them.'),
    note);
}

/** @param {App} app */
function onMappingContinue(app) {
  const f = flow.form;
  const first = flow.prepared[0];
  /** @type {string[]} */
  const errs = [];
  const name = f.name.trim();
  if (!name) errs.push('Enter an account name.');
  if (!validCurrency(f.currency)) errs.push('Enter a three-letter currency code, such as GBP.');
  if (!f.dateColumn) errs.push('Choose the date column.');
  if (!f.descriptionColumn) errs.push('Choose the description column.');
  if (f.amountStyle === 'single' && !f.amountColumn) errs.push('Choose the amount column.');
  if (f.amountStyle === 'split' && !f.debitColumn) errs.push('Choose the debit column.');
  if (f.amountStyle === 'split' && !f.creditColumn) errs.push('Choose the credit column.');
  const mapping = buildMapping(f, first.signature);
  if (mapping) errs.push(...mappingProblems(mapping, first.header).map((p) => `${p}.`));
  if (errs.length || !mapping) {
    flow.formErrors = errs;
    go(app, 'mapping', 'map-errors');
    return;
  }
  flow.formErrors = [];
  const base = flow.account;
  /** @type {Account} */
  const account = base
    ? { ...base, name, currency: f.currency, ...(base.kind === 'placeholder' ? {} : { kind: f.kind }), mapping }
    : { id: crypto.randomUUID(), name, currency: f.currency, kind: f.kind, mapping, repaymentBucketIds: [] };
  mapAndContinue(app, account);
}

// --- 4. Problems -------------------------------------------------------------------------------

/**
 * @param {HTMLElement} root
 * @param {App} app
 */
function renderProblems(root, app) {
  const rows = flow.files.flatMap((f) => [...f.parseErrors, ...f.mapErrors]
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .map((e) => h('tr', null, h('td', null, f.name), h('td', { class: 'num' }, String(e.rowNumber)), h('td', null, e.message))));
  put(root,
    stepHeading('Problems'),
    messages(),
    h('p', null, "Some rows can't be read. Skip them to import the rest, or cancel and check the file."),
    h('table', null,
      h('caption', null, "Rows that can't be read"),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'File'), h('th', { scope: 'col', class: 'num' }, 'Row'), h('th', { scope: 'col' }, 'Problem'))),
      h('tbody', null, ...rows)),
    h('div', { class: 'actions' },
      button('Skip these rows', onSkip, app, { 'data-focus-key': 'import-continue' }),
      cancelButton(app)),
  );
}

/** @param {App} app */
function onSkip(app) {
  flow.skip = new Map(flow.files.map((f) => [f.hash,
    new Set([...f.parseErrors, ...f.mapErrors].map((e) => e.rowNumber))]));
  toPeriod(app);
}

// --- 5. Covered period -------------------------------------------------------------------------

/**
 * Drop files with no rows to import, then prefill each file's period.
 * @param {App} app
 */
function toPeriod(app) {
  const kept = flow.files.filter((f) => f.mapped.length > 0);
  if (kept.length === 0) {
    restart(app, [...flow.messages, 'No rows are left to import.']);
    return;
  }
  const dropped = flow.files.filter((f) => f.mapped.length === 0);
  flow.messages = [...flow.messages, ...dropped.map((f) => `"${f.name}" has no rows to import.`)];
  flow.files = [...kept].sort((a, b) => cmp(a.coversFrom, b.coversFrom));
  flow.periods = new Map(flow.files.map((f) => [f.hash, { from: formatDate(f.coversFrom), to: formatDate(f.coversTo) }]));
  go(app, 'period');
}

/**
 * @param {HTMLElement} root
 * @param {App} app
 */
function renderPeriod(root, app) {
  put(root,
    stepHeading('Covered period'),
    messages(),
    help('Check the dates each file covers. They start as the first and last transaction dates. '
      + 'Widen them if the statement covers more, for example a whole month.'),
    ...flow.files.map((f, i) => {
      const p = /** @type {PeriodInput} */ (flow.periods.get(f.hash));
      /** @param {'from'|'to'} which @param {string} label */
      const dateField = (which, label) => field(label, h('input', {
        type: 'text', class: 'date', value: p[which], autocomplete: 'off', 'aria-label': `${label}, ${f.name}`,
        'data-focus-key': `period-${which}-${i}`,
        onInput: (/** @type {Event} */ e) => { p[which] = /** @type {HTMLInputElement} */ (e.target).value; },
      }), { hint: 'DD/MM/YYYY', error: which === 'from' ? p.fromError : p.toError });
      const whole = f.wholeMonth;
      return h('fieldset', { class: 'period' },
        h('legend', null, f.name),
        h('div', { class: 'row' }, dateField('from', 'From'), dateField('to', 'To')),
        whole ? button(`Whole month (${formatMonth(whole)})`, () => {
          p.from = formatDate(monthStart(whole));
          p.to = formatDate(monthEnd(whole));
          delete p.fromError;
          delete p.toError;
          app.rerender();
        }, app, { class: 'secondary', 'data-focus-key': `period-whole-${i}` }) : null);
    }),
    h('div', { class: 'actions' },
      button('Continue', onPeriodContinue, app, { 'data-focus-key': 'import-continue' }),
      cancelButton(app)),
  );
}

/** @param {App} app */
function onPeriodContinue(app) {
  /** @type {string|null} */
  let firstBad = null;
  /** @type {PlannedFile[]} */
  const planned = [];
  flow.files.forEach((f, i) => {
    const p = /** @type {PeriodInput} */ (flow.periods.get(f.hash));
    delete p.fromError;
    delete p.toError;
    const from = parseDate(p.from, 'DD/MM/YYYY');
    const to = parseDate(p.to, 'DD/MM/YYYY');
    if (!from) p.fromError = 'Enter a real date as DD/MM/YYYY.';
    if (!to) p.toError = 'Enter a real date as DD/MM/YYYY.';
    if (from && to && from > to) p.fromError = 'From must be on or before To.';
    if (!firstBad && p.fromError) firstBad = `period-from-${i}`;
    if (!firstBad && p.toError) firstBad = `period-to-${i}`;
    if (from && to) {
      planned.push({ ...f, coversFrom: from, coversTo: to, skipRowNumbers: flow.skip.get(f.hash) ?? new Set() });
    }
  });
  if (firstBad) {
    go(app, 'period', firstBad);
    return;
  }
  const account = /** @type {Account} */ (flow.account);
  flow.planned = planned;
  flow.plan = planImport(app.store.state, account, planned, app.tuning);
  flow.plannedAt = changeCount;
  flow.decisions = new Map();
  go(app, flow.plan.totals.review > 0 ? 'review' : 'summary');
}

// --- 6. Review ---------------------------------------------------------------------------------

/**
 * @param {HTMLElement} root
 * @param {App} app
 */
function renderReview(root, app) {
  const plan = /** @type {ImportPlan} */ (flow.plan);
  const currency = /** @type {Account} */ (flow.account).currency;
  const items = plan.files.flatMap((pf) => pf.review.map((r) => ({ file: pf.name, ...r })));
  const allDecided = () => items.every((it) => flow.decisions.has(it.row.fingerprint));
  const cont = button('Continue', () => go(app, 'summary'), app, { disabled: !allDecided(), 'data-focus-key': 'import-continue' });

  /** @param {{date:string, amountMinor:number, rawText:string}} r */
  const line = (r) => [formatDate(r.date), ' · ', raw(r.rawText), ' · ', formatMoney(r.amountMinor, currency)];

  put(root,
    stepHeading('Check possible duplicates'),
    messages(),
    help('These rows look like ones already imported, but not exactly. Say whether each is the same transaction or a separate one.'),
    ...items.map((it, i) => {
      /** @param {'same'|'both'} value @param {string} label */
      const choice = (value, label) => h('label', { class: 'choice' },
        h('input', {
          type: 'radio', name: `review-${i}`, value, checked: flow.decisions.get(it.row.fingerprint) === value,
          'data-focus-key': `review-${i}-${value}`,
          onChange: () => {
            flow.decisions.set(it.row.fingerprint, value);
            cont.toggleAttribute('disabled', !allDecided());
          },
        }),
        label);
      return h('fieldset', { class: 'review' },
        h('legend', null, `${it.file}, row ${it.row.rowNumber}`),
        h('p', null, h('strong', null, 'In this file: '), ...line(it.row)),
        h('p', null, h('strong', null, it.candidates.length === 1 ? 'Already imported:' : 'Already imported, closest first:')),
        h('ul', null, ...it.candidates.map((c) => h('li', null, ...line(c)))),
        choice('same', 'Same transaction'),
        choice('both', 'Both are real'));
    }),
    h('div', { class: 'actions' }, cont, cancelButton(app)),
  );
}

// --- 7. Summary --------------------------------------------------------------------------------

/**
 * @param {{new:number, already:number, review:number}} t
 * @returns {string}
 */
const counts = (t) => `${t.new} new, ${t.already} already imported, ${t.review} to review`;

/**
 * @param {HTMLElement} root
 * @param {App} app
 */
function renderSummary(root, app) {
  const plan = /** @type {ImportPlan} */ (flow.plan);
  const account = /** @type {Account} */ (flow.account);
  const kept = [...flow.decisions.values()].filter((d) => d === 'both').length;
  const nothing = plan.totals.new + kept === 0;
  const heading = stepHeading('Summary');
  const actions = h('div', { class: 'actions' });
  put(actions,
    nothing
      ? button('Done', () => restart(app), app, { 'data-focus-key': 'import-continue' })
      : button('Import', () => onImport(app, actions, heading), app, { 'data-focus-key': 'import-continue', 'data-saves': true }),
    nothing ? null : cancelButton(app));
  put(root,
    heading,
    messages(),
    h('p', null, `Account: ${account.name}`),
    h('ul', null, ...plan.files.map((pf) => h('li', null,
      `${pf.name}: ${counts({ new: pf.fresh.length, already: pf.already.length, review: pf.review.length })}`))),
    h('p', null, h('strong', null, `Total: ${counts(plan.totals)}`)),
    nothing ? h('p', null, 'Nothing new to import.') : null,
    actions,
  );
}

/**
 * The account to plan and commit against now. An existing account comes from the store, so a
 * stale snapshot never overwrites it; if it had no mapping, it takes the form's name, currency,
 * kind and mapping. A new account is the one built from the form.
 * @param {App} app
 * @returns {Account|null} null when an existing account has since been removed
 */
function currentAccount(app) {
  const flowAccount = /** @type {Account} */ (flow.account);
  if (flow.choice === NEW) return flowAccount;
  const stored = app.store.state.accounts.find((a) => a.id === flowAccount.id);
  if (!stored) return null;
  if (stored.mapping) return stored;
  const { name, currency, kind, mapping } = flowAccount;
  return { ...stored, name, currency, kind, ...(mapping ? { mapping } : {}) };
}

/**
 * The data changed since planning: plan again with the same files, skips and periods, keep the
 * decisions that still apply, and show the result (Review if anything new needs a decision).
 * @param {App} app
 */
function replan(app) {
  const account = currentAccount(app);
  if (!account) {
    restart(app, [`The account ${flow.account?.name ?? ''} no longer exists. Nothing was imported.`]);
    return;
  }
  flow.account = account;
  flow.plan = planImport(app.store.state, account, flow.planned, app.tuning);
  flow.plannedAt = changeCount;
  const reviewFps = new Set(flow.plan.files.flatMap((pf) => pf.review.map((r) => r.row.fingerprint)));
  flow.decisions = new Map([...flow.decisions].filter(([fp]) => reviewFps.has(fp)));
  if (!flow.messages.includes(CHANGED_NOTE)) flow.messages = [...flow.messages, CHANGED_NOTE];
  const undecided = [...reviewFps].some((fp) => !flow.decisions.has(fp));
  go(app, undecided ? 'review' : 'summary');
}

/**
 * Commit the plan, one save at a time: Import is disabled while it is in flight, so a double
 * click imports once.
 * @param {App} app
 * @param {HTMLElement} scope the summary's actions
 * @param {HTMLElement} focusTo
 * @returns {Promise<void>}
 */
function onImport(app, scope, focusTo) {
  return whileSaving(scope, async () => {
    if (changeCount !== flow.plannedAt) {
      replan(app);
      return;
    }
    const state = app.store.state;
    const account = currentAccount(app);
    if (!account) {
      replan(app);
      return;
    }
    const firstEver = state.batches.length === 0;
    // Synchronous from the check above to here, so nothing can change the state in between.
    // The commit's own write bumps changeCount, but the flow restarts straight after it.
    const changes = commitImport(state, account, /** @type {ImportPlan} */ (flow.plan), flow.decisions, flow.planned, new Date());
    const resumed = resumedBuckets(state, changes);
    await app.store.apply(changes);
    const batches = /** @type {{rowCount:number}[]} */ (changes.put?.batches ?? []);
    if (firstEver && batches.length > 0 && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    const rows = batches.reduce((n, b) => n + b.rowCount, 0);
    restart(app, [
      `Imported ${plural(rows, 'row', 'rows')} from ${plural(batches.length, 'file', 'files')} into ${account.name}.`,
      ...resumed.map((b) => `${b.displayName} was marked Stopped and has charged again, so it counts again.`),
    ]);
  }, focusTo);
}
