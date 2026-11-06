// Plain JSON backup and validated restore.
// Every backup holds the work that is hard to recreate: accounts and their column mappings,
// buckets, amount rules, categories, offered defaults, overrides and transfer decisions, and
// every transaction and import batch, restored exactly as saved. A backup file is untrusted: validateBackup
// builds every object afresh from known keys only, and its messages never repeat what the file
// contains.

/** @import {State, Changes, Settings, Account, Mapping, Bucket, Rule, Category, Override, TransferPair, Batch, Transaction} from './types.js' */
import { emptyState } from './changes.js';
import { DATA_VERSION } from './version.js';
import { upgradeRaw } from './migrate.js';
import { pairKey } from './transfers.js';
import { KINDS, BUDGET_TYPES, isBudgeted } from './categories.js';
import { currencyExponent } from './money.js';
import { localDay } from './dates.js';

/** Validation stops listing problems after this many. */
const MAX_ERRORS = 20;

/**
 * @typedef {{schemaVersion:number,exportedAt:string,accounts:Account[],buckets:Bucket[],rules:Rule[],
 *   categories:Category[],overrides:Override[],transferPairs:TransferPair[],offeredDefaultIds:string[],
 *   batches:Batch[],transactions:Transaction[]}} BackupData
 */
/** @typedef {{app:'living-costs'} & BackupData} Backup */
/** @typedef {{ok:true,data:BackupData}|{ok:false,errors:string[]}} Validation */

/**
 * The backup of `state`, ready for JSON.stringify.
 * @param {State} state
 * @param {Date} now
 * @returns {Backup}
 */
export function buildBackup(state, now) {
  return {
    app: 'living-costs',
    schemaVersion: DATA_VERSION,
    exportedAt: now.toISOString(),
    accounts: state.accounts,
    buckets: state.buckets,
    rules: state.rules,
    categories: state.categories,
    overrides: [...state.overrides.values()],
    transferPairs: [...state.transferPairs.values()],
    offeredDefaultIds: state.settings.offeredDefaultIds,
    batches: state.batches,
    transactions: state.transactions,
  };
}

/**
 * @param {Date} now
 * @returns {string} living-costs-backup-YYYY-MM-DD.json, using the local date
 */
export function backupFileName(now) {
  return `living-costs-backup-${localDay(now)}.json`;
}

/**
 * The Changes for store.replaceAll: the backup's content, plus settings that keep this
 * browser's helpDismissed, use the current settings schema version, take offeredDefaultIds from
 * the backup, and have no lastBackupAt (this browser hasn't backed up the restored data), unless
 * `keepLastBackup` is set and this browser has one.
 * @param {BackupData} data
 * @param {Settings} current this browser's settings
 * @param {{keepLastBackup?: boolean}} [options]
 * @returns {Changes}
 */
export function restoreChanges(data, current, { keepLastBackup = false } = {}) {
  /** @type {Settings} */
  const settings = {
    id: 'settings',
    schemaVersion: emptyState().settings.schemaVersion,
    offeredDefaultIds: [...data.offeredDefaultIds],
    helpDismissed: current.helpDismissed === true,
  };
  if (keepLastBackup && current.lastBackupAt) settings.lastBackupAt = current.lastBackupAt;
  /** @type {NonNullable<Changes['put']>} */
  const put = {
    settings: [settings],
    accounts: data.accounts,
    buckets: data.buckets,
    rules: data.rules,
    categories: data.categories,
    overrides: data.overrides,
    transferPairs: data.transferPairs,
    batches: data.batches,
    transactions: data.transactions,
  };
  return { put };
}

// --- Validation --------------------------------------------------------------------------------

/** @typedef {Record<string, unknown>} Obj */

/** @param {unknown} v @returns {v is Obj} */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An own property only, so nothing is read from a prototype. @param {Obj} o @param {string} key */
const get = (o, key) => (Object.hasOwn(o, key) ? o[key] : undefined);

/** @param {Obj} o @param {string} key */
const has = (o, key) => Object.hasOwn(o, key);

/** @param {unknown} v @returns {v is string} */
const isText = (v) => typeof v === 'string';

/** @param {unknown} v @returns {v is string} */
const isId = (v) => typeof v === 'string' && v.length > 0;

/** @param {unknown} v @returns {v is number} */
const isInt = (v) => Number.isSafeInteger(v);

/** @param {unknown} v @returns {v is string[]} */
const isTextList = (v) => Array.isArray(v) && v.every(isText);

/** @param {unknown} v @returns {v is string[]} */
const isIdList = (v) => Array.isArray(v) && v.every(isId);

/**
 * @template {string} T
 * @param {readonly T[]} list
 * @returns {(v: unknown) => v is T}
 */
const oneOf = (list) => /** @type {(v: unknown) => v is T} */ (
  (v) => typeof v === 'string' && /** @type {readonly string[]} */ (list).includes(v));

const isAccountKind = oneOf(/** @type {const} */ (['bank', 'card', 'placeholder']));
const isCategoryKind = oneOf(KINDS);
const isBudgetType = oneOf(BUDGET_TYPES);
const isPeriod = oneOf(/** @type {const} */ (['week', 'month', 'year']));
const isFlagDecision = oneOf(/** @type {const} */ (['rule', 'source']));
const isPairStatus = oneOf(/** @type {const} */ (['confirmed', 'rejected']));

/** A three-letter code that Intl knows. @param {unknown} v @returns {v is string} */
function isCurrency(v) {
  if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v)) return false;
  try { currencyExponent(v); return true; } catch { return false; }
}

/** An ISO timestamp exactly as Date.prototype.toISOString writes it. @param {unknown} v @returns {v is string} */
function isTimestamp(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString() === v;
}

/** A real calendar date as ISO YYYY-MM-DD. @param {unknown} v @returns {v is string} */
function isIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Collects problems, up to MAX_ERRORS. */
class Problems {
  constructor() {
    /** @type {string[]} */
    this.list = [];
    this.more = false;
  }

  /** @param {string} message */
  add(message) {
    if (this.list.length < MAX_ERRORS) this.list.push(message);
    else this.more = true;
  }

  /** @returns {string[]} */
  result() {
    return this.more ? [...this.list, 'There are more problems than are listed here.'] : this.list;
  }
}

/**
 * Field checks for one entry. `need(ok, what)` records "<Label> has a missing or invalid <what>."
 * when ok is false.
 * @param {string} label such as "Account 2"
 * @param {Problems} p
 */
function checker(label, p) {
  return {
    /** @param {boolean} ok @param {string} what @returns {boolean} */
    need(ok, what) {
      if (!ok) p.add(`${label} has a missing or invalid ${what}.`);
      return ok;
    },
    /** @param {string} message the rest of the sentence after the label */
    fail(message) { p.add(`${label} ${message}.`); },
  };
}

/**
 * A column mapping, or null if it is not valid.
 * @param {unknown} raw
 * @returns {Mapping|null}
 */
function readMapping(raw) {
  if (!isObj(raw)) return null;
  const headerSignature = get(raw, 'headerSignature');
  const dateColumn = get(raw, 'dateColumn');
  const dateFormat = get(raw, 'dateFormat');
  const descriptionColumn = get(raw, 'descriptionColumn');
  const typeColumn = get(raw, 'typeColumn');
  const accountIdColumn = get(raw, 'accountIdColumn');
  const amount = get(raw, 'amount');
  if (!isText(headerSignature) || !isId(dateColumn) || dateFormat !== 'DD/MM/YYYY' || !isId(descriptionColumn)) return null;
  if (has(raw, 'typeColumn') && !isId(typeColumn)) return null;
  if (has(raw, 'accountIdColumn') && !isId(accountIdColumn)) return null;
  if (!isObj(amount)) return null;
  /** @type {Mapping['amount']} */
  let amountOut;
  const single = get(amount, 'single');
  const signFlipped = get(amount, 'signFlipped');
  const debit = get(amount, 'debit');
  const credit = get(amount, 'credit');
  if (has(amount, 'single')) {
    if (has(amount, 'debit') || has(amount, 'credit')) return null;
    if (!isId(single) || typeof signFlipped !== 'boolean') return null;
    amountOut = { single, signFlipped };
  } else {
    if (has(amount, 'signFlipped') || !isId(debit) || !isId(credit)) return null;
    amountOut = { debit, credit };
  }
  /** @type {Mapping} */
  const mapping = { headerSignature, dateColumn, dateFormat, descriptionColumn, amount: amountOut };
  if (isId(typeColumn)) mapping.typeColumn = typeColumn;
  if (isId(accountIdColumn)) mapping.accountIdColumn = accountIdColumn;
  return mapping;
}

/** @param {Obj} o @param {string} label @param {Problems} p @returns {Account} */
function readAccount(o, label, p) {
  const c = checker(label, p);
  const id = get(o, 'id');
  const name = get(o, 'name');
  const currency = get(o, 'currency');
  const kind = get(o, 'kind');
  const identifier = get(o, 'identifier');
  const repaymentBucketIds = get(o, 'repaymentBucketIds');
  c.need(isId(id), 'ID');
  c.need(isText(name), 'name');
  c.need(isCurrency(currency), 'currency');
  c.need(isAccountKind(kind), 'kind');
  const mapping = has(o, 'mapping') ? readMapping(get(o, 'mapping')) : undefined;
  c.need(mapping !== null, 'column mapping');
  if (has(o, 'identifier')) c.need(isId(identifier), 'account number');
  c.need(isIdList(repaymentBucketIds), 'list of repayment buckets');
  /** @type {Account} */
  const account = {
    id: isId(id) ? id : '',
    name: isText(name) ? name : '',
    currency: isCurrency(currency) ? currency : '',
    kind: isAccountKind(kind) ? kind : 'bank',
    repaymentBucketIds: isIdList(repaymentBucketIds) ? [...repaymentBucketIds] : [],
  };
  if (mapping) account.mapping = mapping;
  if (isId(identifier)) account.identifier = identifier;
  return account;
}

/** @param {Obj} o @param {string} label @param {Problems} p @returns {Bucket} */
function readBucket(o, label, p) {
  const c = checker(label, p);
  const id = get(o, 'id');
  const keys = get(o, 'keys');
  const displayName = get(o, 'displayName');
  const categoryId = get(o, 'categoryId');
  const exampleRawTexts = get(o, 'exampleRawTexts');
  c.need(isId(id), 'ID');
  // Keys come from the normaliser, which never returns an empty string.
  c.need(isIdList(keys), 'list of keys');
  c.need(isText(displayName), 'name');
  if (has(o, 'categoryId')) c.need(isId(categoryId), 'category');
  c.need(isTextList(exampleRawTexts), 'list of examples');
  const stoppedAfter = get(o, 'stoppedAfter');
  if (has(o, 'stoppedAfter')) c.need(isIsoDate(stoppedAfter), 'stopped date');
  /** @type {Bucket} */
  const bucket = {
    id: isId(id) ? id : '',
    keys: isIdList(keys) ? [...keys] : [],
    displayName: isText(displayName) ? displayName : '',
    exampleRawTexts: isTextList(exampleRawTexts) ? [...exampleRawTexts] : [],
  };
  if (isId(categoryId)) bucket.categoryId = categoryId;
  if (isIsoDate(stoppedAfter)) bucket.stoppedAfter = stoppedAfter;
  return bucket;
}

/** @param {Obj} o @param {string} label @param {Problems} p @returns {Rule} */
function readRule(o, label, p) {
  const c = checker(label, p);
  const id = get(o, 'id');
  const pattern = get(o, 'pattern');
  const matchType = get(o, 'matchType');
  const amountMinor = get(o, 'amountMinor');
  const expectedRaw = get(o, 'expected');
  const bucketId = get(o, 'bucketId');
  c.need(isId(id), 'ID');
  c.need(isText(pattern), 'pattern');
  c.need(matchType === 'keyAmount', 'match type');
  c.need(isInt(amountMinor), 'amount');
  const count = isObj(expectedRaw) ? get(expectedRaw, 'count') : undefined;
  const period = isObj(expectedRaw) ? get(expectedRaw, 'period') : undefined;
  const expectedOk = isInt(count) && count >= 1 && isPeriod(period);
  c.need(expectedOk, 'expected frequency');
  c.need(isId(bucketId), 'bucket');
  return {
    id: isId(id) ? id : '',
    pattern: isText(pattern) ? pattern : '',
    matchType: 'keyAmount',
    amountMinor: isInt(amountMinor) ? amountMinor : 0,
    expected: { count: isInt(count) ? count : 1, period: isPeriod(period) ? period : 'month' },
    bucketId: isId(bucketId) ? bucketId : '',
  };
}

/** @param {Obj} o @param {string} label @param {Problems} p @returns {Category} */
function readCategory(o, label, p) {
  const c = checker(label, p);
  const id = get(o, 'id');
  const name = get(o, 'name');
  const kind = get(o, 'kind');
  const budgetType = get(o, 'budgetType');
  const defaultId = get(o, 'defaultId');
  const position = get(o, 'position');
  c.need(isId(id), 'ID');
  c.need(isText(name) && name.trim() !== '', 'name');
  c.need(isCategoryKind(kind), 'kind');
  c.need(isInt(position) && position >= 0, 'position');
  if (has(o, 'defaultId')) c.need(isId(defaultId), 'default category');
  if (has(o, 'budgetType')) {
    if (c.need(isBudgetType(budgetType), 'budget type') && isCategoryKind(kind) && !isBudgeted(kind)) {
      c.fail('has a budget type, but its kind has none');
    }
  }
  /** @type {Category} */
  const category = {
    id: isId(id) ? id : '',
    name: isText(name) ? name : '',
    kind: isCategoryKind(kind) ? kind : 'spend',
    position: isInt(position) ? position : 0,
  };
  if (isBudgetType(budgetType)) category.budgetType = budgetType;
  if (isId(defaultId)) category.defaultId = defaultId;
  return category;
}

/**
 * Two or more parts, each a non-zero whole amount with the same sign and a category ID.
 * @param {unknown} raw
 * @returns {{amountMinor:number,categoryId:string}[]|null}
 */
function readSplits(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const parts = [];
  for (const part of raw) {
    if (!isObj(part)) return null;
    const amountMinor = get(part, 'amountMinor');
    const categoryId = get(part, 'categoryId');
    if (!isInt(amountMinor) || amountMinor === 0 || !isId(categoryId)) return null;
    parts.push({ amountMinor, categoryId });
  }
  const sign = Math.sign(parts[0].amountMinor);
  return parts.every((x) => Math.sign(x.amountMinor) === sign) ? parts : null;
}

/** @param {Obj} o @param {string} label @param {Problems} p @returns {Override} */
function readOverride(o, label, p) {
  const c = checker(label, p);
  const fingerprint = get(o, 'fingerprint');
  const categoryId = get(o, 'categoryId');
  const unusualDismissed = get(o, 'unusualDismissed');
  const flagDecision = get(o, 'flagDecision');
  c.need(isId(fingerprint), 'fingerprint');
  if (has(o, 'categoryId')) c.need(isId(categoryId), 'category');
  const splits = has(o, 'splits') ? readSplits(get(o, 'splits')) : undefined;
  if (splits === null) c.fail('has an invalid split');
  if (has(o, 'unusualDismissed')) c.need(typeof unusualDismissed === 'boolean', 'unusual-amount flag');
  if (has(o, 'flagDecision')) c.need(isFlagDecision(flagDecision), 'flag decision');
  if (has(o, 'categoryId') && has(o, 'splits')) c.fail('has both a category and a split');
  /** @type {Override} */
  const override = { fingerprint: isId(fingerprint) ? fingerprint : '' };
  if (isId(categoryId)) override.categoryId = categoryId;
  if (splits) override.splits = splits;
  if (typeof unusualDismissed === 'boolean') override.unusualDismissed = unusualDismissed;
  if (isFlagDecision(flagDecision)) override.flagDecision = flagDecision;
  return override;
}

/** @param {Obj} o @param {string} label @param {Problems} p @returns {TransferPair} */
function readPair(o, label, p) {
  const c = checker(label, p);
  const key = get(o, 'key');
  const fingerprintA = get(o, 'fingerprintA');
  const fingerprintB = get(o, 'fingerprintB');
  const status = get(o, 'status');
  c.need(isId(key), 'key');
  c.need(isId(fingerprintA), 'first fingerprint');
  c.need(isId(fingerprintB), 'second fingerprint');
  c.need(isPairStatus(status), 'status');
  if (isId(fingerprintA) && isId(fingerprintB)) {
    if (fingerprintA === fingerprintB) c.fail('pairs a transaction with itself');
    else if (isId(key) && key !== pairKey(fingerprintA, fingerprintB)) c.fail("has a key that doesn't match its fingerprints");
  }
  return {
    key: isId(key) ? key : '',
    fingerprintA: isId(fingerprintA) ? fingerprintA : '',
    fingerprintB: isId(fingerprintB) ? fingerprintB : '',
    status: isPairStatus(status) ? status : 'rejected',
  };
}

/** @param {Obj} o @param {string} label @param {Problems} p @returns {Batch} */
function readBatch(o, label, p) {
  const c = checker(label, p);
  const id = get(o, 'id');
  const importId = get(o, 'importId');
  const accountId = get(o, 'accountId');
  const fileName = get(o, 'fileName');
  const fileHash = get(o, 'fileHash');
  const importedAt = get(o, 'importedAt');
  const rowCount = get(o, 'rowCount');
  const coversFrom = get(o, 'coversFrom');
  const coversTo = get(o, 'coversTo');
  c.need(isId(id), 'ID');
  c.need(isId(importId), 'import ID');
  c.need(isId(accountId), 'account');
  c.need(isText(fileName), 'file name');
  c.need(isId(fileHash), 'file hash');
  c.need(isTimestamp(importedAt), 'import time');
  const countOk = isInt(rowCount) && rowCount >= 1;
  c.need(countOk, 'row count');
  const coversOk = isIsoDate(coversFrom) && isIsoDate(coversTo) && coversFrom <= coversTo;
  c.need(coversOk, 'covered period');
  return {
    id: isId(id) ? id : '',
    importId: isId(importId) ? importId : '',
    accountId: isId(accountId) ? accountId : '',
    fileName: isText(fileName) ? fileName : '',
    fileHash: isId(fileHash) ? fileHash : '',
    importedAt: isTimestamp(importedAt) ? importedAt : '',
    // 0 marks a count that is not valid, so the row count check skips it.
    rowCount: countOk ? rowCount : 0,
    coversFrom: coversOk ? coversFrom : '',
    coversTo: coversOk ? coversTo : '',
  };
}

/** @param {Obj} o @param {string} label @param {Problems} p @returns {Transaction} */
function readTransaction(o, label, p) {
  const c = checker(label, p);
  const id = get(o, 'id');
  const fingerprint = get(o, 'fingerprint');
  const accountId = get(o, 'accountId');
  const batchId = get(o, 'batchId');
  const date = get(o, 'date');
  const amountMinor = get(o, 'amountMinor');
  const currency = get(o, 'currency');
  const rawText = get(o, 'rawText');
  const rawType = get(o, 'rawType');
  const bucketId = get(o, 'bucketId');
  const flaggedRuleId = get(o, 'flaggedRuleId');
  c.need(isId(id), 'ID');
  c.need(isId(fingerprint), 'fingerprint');
  c.need(isId(accountId), 'account');
  c.need(isId(batchId), 'batch');
  c.need(isIsoDate(date), 'date');
  c.need(isInt(amountMinor), 'amount');
  c.need(isCurrency(currency), 'currency');
  c.need(isText(rawText), 'description');
  if (has(o, 'rawType')) c.need(isText(rawType), 'type');
  c.need(isId(bucketId), 'bucket');
  if (has(o, 'flaggedRuleId')) c.need(isId(flaggedRuleId), 'flagged rule');
  /** @type {Transaction} */
  const t = {
    id: isId(id) ? id : '',
    fingerprint: isId(fingerprint) ? fingerprint : '',
    accountId: isId(accountId) ? accountId : '',
    batchId: isId(batchId) ? batchId : '',
    date: isIsoDate(date) ? date : '',
    amountMinor: isInt(amountMinor) ? amountMinor : 0,
    currency: isCurrency(currency) ? currency : '',
    rawText: isText(rawText) ? rawText : '',
    bucketId: isId(bucketId) ? bucketId : '',
  };
  if (isText(rawType)) t.rawType = rawType;
  if (isId(flaggedRuleId)) t.flaggedRuleId = flaggedRuleId;
  return t;
}

/**
 * Report a transaction or batch that points at something missing or disagrees with what it
 * points at, and a batch whose row count doesn't match the transactions it holds.
 * @param {Batch[]} batches
 * @param {Transaction[]} transactions
 * @param {Account[]} accounts
 * @param {Set<string>} bucketIds
 * @param {Rule[]} rules
 * @param {Problems} p
 */
function checkTransactionRefs(batches, transactions, accounts, bucketIds, rules, p) {
  const accountById = new Map(accounts.filter((a) => a.id).map((a) => [a.id, a]));
  /** @type {Map<string, Batch>} */
  const batchById = new Map();
  for (const b of batches) if (b.id && !batchById.has(b.id)) batchById.set(b.id, b);
  const ruleIds = new Set(rules.map((r) => r.id).filter(Boolean));
  batches.forEach((b, i) => {
    if (b.accountId !== '' && !accountById.has(b.accountId)) p.add(`Batch ${i + 1} points at a missing account.`);
  });
  /** @type {Map<string, number>} */
  const held = new Map();
  transactions.forEach((t, i) => {
    const label = `Transaction ${i + 1}`;
    const account = accountById.get(t.accountId);
    const batch = batchById.get(t.batchId);
    if (t.accountId !== '' && !account) p.add(`${label} points at a missing account.`);
    if (t.batchId !== '' && !batch) p.add(`${label} points at a missing batch.`);
    if (batch && t.accountId !== '' && batch.accountId !== '' && batch.accountId !== t.accountId) {
      p.add(`${label} is in a different account from its batch.`);
    }
    if (account && t.currency !== '' && account.currency !== '' && account.currency !== t.currency) {
      p.add(`${label} has a different currency from its account.`);
    }
    if (t.bucketId !== '' && !bucketIds.has(t.bucketId)) p.add(`${label} points at a missing bucket.`);
    if (t.flaggedRuleId !== undefined && !ruleIds.has(t.flaggedRuleId)) p.add(`${label} points at a missing rule.`);
    if (t.batchId !== '') held.set(t.batchId, (held.get(t.batchId) ?? 0) + 1);
  });
  const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  batches.forEach((b, i) => {
    if (b.id === '' || b.rowCount === 0) return;
    const n = held.get(b.id) ?? 0;
    if (n !== b.rowCount) {
      p.add(`Batch ${i + 1} has ${plural(b.rowCount, 'row')}, but the backup holds ${plural(n, 'transaction')} for it.`);
    }
  });
}

/**
 * Read one top-level list, entry by entry, and report entries whose key repeats an earlier one.
 * @template T
 * @param {Obj} json
 * @param {string} field the backup's key
 * @param {string} noun for "The backup has no list of <noun>."
 * @param {string} name for "<Name> 3 …"
 * @param {(o: Obj, label: string, p: Problems) => T} read
 * @param {(item: T) => string} keyOf
 * @param {string} sameAs the rest of the duplicate message, after "<Name> 3 "
 * @param {Problems} p
 * @returns {T[]}
 */
function readList(json, field, noun, name, read, keyOf, sameAs, p) {
  const raw = get(json, field);
  if (!Array.isArray(raw)) {
    p.add(`The backup has no list of ${noun}.`);
    return [];
  }
  /** @type {T[]} */
  const out = [];
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (let i = 0; i < raw.length; i++) {
    const label = `${name} ${i + 1}`;
    const entry = raw[i];
    if (!isObj(entry)) {
      p.add(`${label} is not a valid entry.`);
      continue;
    }
    const item = read(entry, label, p);
    out.push(item);
    const key = keyOf(item);
    if (key === '') continue;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i + 1);
    else p.add(`${label} ${sameAs} ${name.toLowerCase()} ${first}.`);
  }
  return out;
}

/**
 * Check a parsed backup file and build clean copies of its content. Never throws.
 * @param {unknown} json
 * @returns {Validation}
 */
export function validateBackup(json) {
  try {
    return validate(json);
  } catch {
    return { ok: false, errors: ['This backup could not be checked.'] };
  }
}

/**
 * @param {unknown} input
 * @returns {Validation}
 */
function validate(input) {
  if (!isObj(input) || get(input, 'app') !== 'living-costs') return { ok: false, errors: ["This file isn't a backup from this app."] };
  const version = get(input, 'schemaVersion');
  if (!isInt(version) || version < 1) return { ok: false, errors: ["This backup's version is missing or not valid."] };
  if (version > DATA_VERSION) {
    return { ok: false, errors: ['This backup is from a newer version of this app. Reload the page to get the latest version, then try again.'] };
  }
  let json = input;
  if (version < DATA_VERSION) {
    const upgraded = upgradeRaw(input, version);
    json = upgraded.doc;
    // Task 4 re-buckets with this normaliser when the upgrade changed how text is normalised.
    void upgraded.rematchFrom;
  }

  const p = new Problems();
  const exportedAt = get(json, 'exportedAt');
  if (!isTimestamp(exportedAt)) p.add("The backup's export date is missing or not valid.");

  const byId = (/** @type {{id: string}} */ x) => x.id;
  const accounts = readList(json, 'accounts', 'accounts', 'Account', readAccount, byId, 'has the same ID as', p);
  const buckets = readList(json, 'buckets', 'buckets', 'Bucket', readBucket, byId, 'has the same ID as', p);
  const rules = readList(json, 'rules', 'rules', 'Rule', readRule, byId, 'has the same ID as', p);
  const categories = readList(json, 'categories', 'categories', 'Category', readCategory, byId, 'has the same ID as', p);
  const overrides = readList(json, 'overrides', 'overrides', 'Override', readOverride,
    (o) => o.fingerprint, 'has the same fingerprint as', p);
  const transferPairs = readList(json, 'transferPairs', 'transfer pairs', 'Transfer pair', readPair,
    (x) => x.key, 'is the same pair as', p);
  const batches = readList(json, 'batches', 'batches', 'Batch', readBatch, byId, 'has the same ID as', p);
  const transactions = readList(json, 'transactions', 'transactions', 'Transaction', readTransaction, byId, 'has the same ID as', p);

  const offered = get(json, 'offeredDefaultIds');
  /** @type {string[]} */
  let offeredDefaultIds = [];
  if (!isIdList(offered)) p.add('The list of offered default categories is missing or not valid.');
  else if (new Set(offered).size !== offered.length) p.add('The list of offered default categories repeats an entry.');
  else offeredDefaultIds = [...offered];

  // Bucket keys: a key belongs to one bucket only.
  /** @type {Map<string, number>} */
  const keyOwner = new Map();
  buckets.forEach((b, i) => {
    const reported = new Set();
    for (const k of b.keys) {
      const owner = keyOwner.get(k);
      if (owner === undefined) keyOwner.set(k, i);
      else if (owner !== i && !reported.has(owner)) {
        reported.add(owner);
        p.add(`Bucket ${i + 1} shares a key with bucket ${owner + 1}.`);
      }
    }
  });

  // Category names are unique, ignoring case and surrounding spaces, as the app requires.
  /** @type {Map<string, number>} */
  const names = new Map();
  categories.forEach((c, i) => {
    const folded = c.name.trim().toLowerCase();
    if (folded === '') return;
    const first = names.get(folded);
    if (first === undefined) names.set(folded, i);
    else p.add(`Category ${i + 1} has the same name as category ${first + 1}.`);
  });

  // References.
  const bucketIds = new Set(buckets.map((b) => b.id).filter(Boolean));
  const categoryIds = new Set(categories.map((c) => c.id).filter(Boolean));
  accounts.forEach((a, i) => {
    if (a.repaymentBucketIds.some((id) => !bucketIds.has(id))) p.add(`Account ${i + 1} points at a missing bucket.`);
  });
  buckets.forEach((b, i) => {
    if (b.categoryId !== undefined && !categoryIds.has(b.categoryId)) p.add(`Bucket ${i + 1} points at a missing category.`);
  });
  rules.forEach((r, i) => {
    if (r.bucketId !== '' && !bucketIds.has(r.bucketId)) p.add(`Rule ${i + 1} points at a missing bucket.`);
  });
  overrides.forEach((o, i) => {
    const used = [...(o.categoryId !== undefined ? [o.categoryId] : []), ...(o.splits ?? []).map((s) => s.categoryId)];
    if (used.some((id) => !categoryIds.has(id))) p.add(`Override ${i + 1} points at a missing category.`);
  });
  // Without both lists, every reference would fail; the missing list is already reported.
  if (Array.isArray(get(json, 'batches')) && Array.isArray(get(json, 'transactions'))) {
    checkTransactionRefs(batches, transactions, accounts, bucketIds, rules, p);
  }

  const errors = p.result();
  if (errors.length) return { ok: false, errors };
  /** @type {BackupData} */
  const data = {
    schemaVersion: DATA_VERSION,
    exportedAt: /** @type {string} */ (exportedAt),
    accounts, buckets, rules, categories, overrides, transferPairs, offeredDefaultIds, batches, transactions,
  };
  return { ok: true, data };
}
