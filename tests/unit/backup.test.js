import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState } from '../../src/changes.js';
import { buildContext, resolve } from '../../src/resolve.js';
import { setSplit, setCategoryOverride, dismissUnusual } from '../../src/overrides.js';
import { pairKey, decidePair } from '../../src/transfers.js';
import { typicalMonth } from '../../src/typical.js';
import tuning from '../../src/tuning.js';
import {
  buildBackup, validateBackup, restoreChanges, backupFileName,
} from '../../src/backup.js';
import { localDay } from '../../src/dates.js';
import { DATA_VERSION } from '../../src/version.js';
import { fixtureState, wholeMonths } from './helpers/fixture-state.js';
import { NOW, BANK_A, SAVINGS, CARD, BANK_B, pick, run } from './pipeline.js';
import { prepareFiles } from '../../src/import.js';

/** A small backup that uses every field of every backed-up type, with two batches and three transactions. */
const base = () => ({
  app: 'living-costs',
  schemaVersion: 2,
  exportedAt: '2026-11-04T10:00:00.000Z',
  accounts: [
    {
      id: 'a1', name: 'Current', currency: 'GBP', kind: 'bank', identifier: '12345678',
      mapping: {
        headerSignature: 'date,type,description,amount,account', dateColumn: 'Date', dateFormat: 'DD/MM/YYYY',
        descriptionColumn: 'Description', typeColumn: 'Type', accountIdColumn: 'Account',
        amount: { single: 'Amount', signFlipped: false },
      },
      repaymentBucketIds: [],
    },
    {
      id: 'a2', name: 'Card', currency: 'GBP', kind: 'card',
      mapping: {
        headerSignature: 'date,description,out,in', dateColumn: 'Date', dateFormat: 'DD/MM/YYYY',
        descriptionColumn: 'Description', amount: { debit: 'Out', credit: 'In' },
      },
      repaymentBucketIds: [],
    },
    { id: 'a3', name: 'Other card', currency: 'GBP', kind: 'placeholder', repaymentBucketIds: ['b2'] },
  ],
  buckets: [
    { id: 'b1', keys: ['SHOP'], displayName: 'Shop', categoryId: 'c1', stoppedAfter: '2026-07-05', exampleRawTexts: ['SHOP 123'] },
    { id: 'b2', keys: ['CARD CO', 'CARD COMPANY'], displayName: 'CARD CO', exampleRawTexts: [] },
    { id: 'b3', keys: [], displayName: 'Streaming', categoryId: 'c1', exampleRawTexts: [] },
  ],
  rules: [{
    id: 'r1', pattern: 'SHOP', matchType: 'keyAmount', amountMinor: -999,
    expected: { count: 1, period: 'month' }, bucketId: 'b3',
  }],
  categories: [
    { id: 'c1', name: 'Groceries', kind: 'spend', budgetType: 'variable', defaultId: 'groceries', position: 0 },
    { id: 'c2', name: 'Moves', kind: 'transfer', position: 1 },
  ],
  overrides: [
    { fingerprint: 'f1', categoryId: 'c2' },
    {
      fingerprint: 'f2', splits: [{ amountMinor: -500, categoryId: 'c1' }, { amountMinor: -300, categoryId: 'c2' }],
      unusualDismissed: true, flagDecision: 'rule',
    },
    { fingerprint: 'f5', flagDecision: 'source' },
  ],
  transferPairs: [
    { key: pairKey('f3', 'f4'), fingerprintA: 'f3', fingerprintB: 'f4', status: 'confirmed' },
    { key: pairKey('f6', 'f5'), fingerprintA: 'f6', fingerprintB: 'f5', status: 'rejected' },
  ],
  offeredDefaultIds: ['groceries', 'salary'],
  batches: [
    {
      id: 'k1', importId: 'i1', accountId: 'a1', fileName: 'current.csv', fileHash: 'h1',
      importedAt: '2026-11-01T09:00:00.000Z', rowCount: 2, coversFrom: '2026-10-01', coversTo: '2026-10-31',
    },
    {
      id: 'k2', importId: 'i1', accountId: 'a2', fileName: 'card.csv', fileHash: 'h2',
      importedAt: '2026-11-01T09:00:00.000Z', rowCount: 1, coversFrom: '2026-10-01', coversTo: '2026-10-31',
    },
  ],
  transactions: [
    {
      id: 't1', fingerprint: 'f1', accountId: 'a1', batchId: 'k1', date: '2026-10-02', amountMinor: -999,
      currency: 'GBP', rawText: 'SHOP 123', rawType: 'DEB', bucketId: 'b1', flaggedRuleId: 'r1',
    },
    {
      id: 't2', fingerprint: 'f2', accountId: 'a1', batchId: 'k1', date: '2026-10-03', amountMinor: -800,
      currency: 'GBP', rawText: 'SHOP 456', bucketId: 'b3',
    },
    {
      id: 't3', fingerprint: 'f3', accountId: 'a2', batchId: 'k2', date: '2026-10-04', amountMinor: 5000,
      currency: 'GBP', rawText: 'CARD CO', bucketId: 'b2',
    },
  ],
});

/** @param {unknown} json @returns {string[]} */
function errorsOf(json) {
  const r = validateBackup(json);
  assert.equal(r.ok, false, 'expected the backup to be rejected');
  return /** @type {{ok: false, errors: string[]}} */ (r).errors;
}

/** @param {unknown} json */
function dataOf(json) {
  const r = validateBackup(json);
  assert.deepEqual(r.ok ? [] : r.errors, []);
  return /** @type {{ok: true, data: any}} */ (r).data;
}

// --- buildBackup -------------------------------------------------------------------------------

test('buildBackup holds the work and the transactions, and leaves out local settings', async () => {
  const s = await fixtureState();
  s.settings = { ...s.settings, helpDismissed: true, lastBackupAt: '2026-10-01T09:00:00.000Z' };
  const b = buildBackup(s, NOW);
  assert.deepEqual(Object.keys(b).sort(), [
    'accounts', 'app', 'batches', 'buckets', 'categories', 'exportedAt', 'offeredDefaultIds', 'overrides', 'rules',
    'schemaVersion', 'transactions', 'transferPairs',
  ]);
  assert.equal(b.app, 'living-costs');
  assert.equal(b.schemaVersion, DATA_VERSION);
  assert.equal(DATA_VERSION, 2);
  assert.equal(b.exportedAt, NOW.toISOString());
  assert.ok(Array.isArray(b.overrides) && Array.isArray(b.transferPairs));
  assert.equal(b.transferPairs.length, s.transferPairs.size);
  assert.doesNotMatch(JSON.stringify(b), /helpDismissed|lastBackupAt/);
});

test('backupFileName and localDay use the local calendar date', () => {
  const lateEvening = new Date(2026, 0, 5, 23, 59, 30);
  assert.equal(localDay(lateEvening), '2026-01-05');
  assert.equal(backupFileName(lateEvening), 'living-costs-backup-2026-01-05.json');
  assert.equal(backupFileName(new Date(2026, 10, 4, 0, 0, 1)), 'living-costs-backup-2026-11-04.json');
});

// --- Round trip --------------------------------------------------------------------------------

test('round trip: a JSON copy of the fixture backup validates and deep-equals the input subsets', async () => {
  const s = await fixtureState();
  const data = dataOf(JSON.parse(JSON.stringify(buildBackup(s, NOW))));
  assert.deepEqual(data.accounts, s.accounts);
  assert.deepEqual(data.buckets, s.buckets);
  assert.deepEqual(data.rules, s.rules);
  assert.deepEqual(data.categories, s.categories);
  assert.deepEqual(data.overrides, [...s.overrides.values()]);
  assert.deepEqual(data.transferPairs, [...s.transferPairs.values()]);
  assert.deepEqual(data.offeredDefaultIds, s.settings.offeredDefaultIds);
  assert.equal(data.exportedAt, NOW.toISOString());
});

test('round trip: every field of every backed-up type is copied', () => {
  const b = base();
  const data = dataOf(JSON.parse(JSON.stringify(b)));
  const { app: _app, ...rest } = b;
  assert.deepEqual(data, rest);
});

// --- Review Focus 3: restore, then re-import -----------------------------------------------------

test('restore then re-import: splits, overrides, flags and confirmed pairs resolve exactly as before', async () => {
  const before = await fixtureState();
  const ctx0 = buildContext(before);
  const free = before.transactions.filter((t) => resolve(t, ctx0).source === 'bucket' && t.amountMinor < -1000);
  const [splitTxn, movedTxn, dismissedTxn, rejA] = free;
  const rejB = before.transactions.find((t) => t.accountId !== rejA.accountId && resolve(t, ctx0).source === 'bucket');
  assert.ok(splitTxn && movedTxn && dismissedTxn && rejA && rejB);
  const gifts = /** @type {any} */ (before.categories.find((c) => c.name === 'Gifts')).id;
  const groceries = /** @type {any} */ (before.categories.find((c) => c.name === 'Groceries')).id;

  const split = setSplit(before, splitTxn, [
    { amountMinor: -500, categoryId: gifts }, { amountMinor: splitTxn.amountMinor + 500, categoryId: groceries },
  ]);
  assert.ok(!('error' in split));
  applyToState(before, split);
  applyToState(before, setCategoryOverride(before, movedTxn.fingerprint, gifts));
  applyToState(before, dismissUnusual(before, dismissedTxn.fingerprint));
  applyToState(before, decidePair(rejA, /** @type {any} */ (rejB), 'rejected'));

  const ctxBefore = buildContext(before);
  const was = new Map(before.transactions.map((t) => [t.fingerprint, resolve(t, ctxBefore)]));
  const confirmed = [...before.transferPairs.values()].filter((p) => p.status === 'confirmed');
  assert.ok(confirmed.length > 0);

  // Restore into an empty browser.
  const data = dataOf(JSON.parse(JSON.stringify(buildBackup(before, NOW))));
  // Drop the transactions and batches, as if only the setup had survived, to check that re-importing reattaches every decision.
  data.transactions = [];
  data.batches = [];
  const after = emptyState();
  applyToState(after, restoreChanges(data, after.settings));
  assert.equal(after.transactions.length, 0);

  // Re-import the same files into the restored accounts.
  for (const [id, names] of /** @type {[string, string[]][]} */ ([['A', [BANK_A]], ['S', [SAVINGS]], ['C', [CARD]], ['B', BANK_B]])) {
    const account = /** @type {any} */ (after.accounts.find((a) => a.id === id));
    const { changes } = await run(after, account, names.map((n) => pick(n)), () => 'both', wholeMonths);
    applyToState(after, changes);
  }
  assert.equal(after.transactions.length, before.transactions.length);

  const ctxAfter = buildContext(after);
  const now = new Map(after.transactions.map((t) => [t.fingerprint, resolve(t, ctxAfter)]));
  assert.deepEqual(now.get(splitTxn.fingerprint), was.get(splitTxn.fingerprint));
  assert.equal(now.get(splitTxn.fingerprint)?.source, 'split');
  assert.deepEqual(now.get(movedTxn.fingerprint), { source: 'override', parts: [{ amountMinor: movedTxn.amountMinor, categoryId: gifts }] });
  for (const p of confirmed) {
    assert.equal(now.get(p.fingerprintA)?.source, 'transfer');
    assert.equal(now.get(p.fingerprintB)?.source, 'transfer');
  }
  // Every transaction, not just the ones above, counts as it did before.
  assert.deepEqual(now, was);
  assert.equal(after.overrides.get(dismissedTxn.fingerprint)?.unusualDismissed, true);
  // Flagged rows and rule buckets come back the same, so the typical month does too.
  const flags = (/** @type {any} */ st) => st.transactions.filter((t) => t.flaggedRuleId).map((t) => `${t.fingerprint}>${t.flaggedRuleId}`).sort();
  assert.deepEqual(flags(after), flags(before));
  const bucketOf = (/** @type {any} */ st) => new Map(st.transactions.map((t) => [t.fingerprint, t.bucketId]));
  assert.deepEqual(bucketOf(after), bucketOf(before));
  // One-offs carry their transaction, whose id and batchId are new after a re-import.
  const typical = (/** @type {any} */ st) => JSON.parse(JSON.stringify(typicalMonth(st, tuning),
    (k, v) => (k === 'id' || k === 'batchId' ? undefined : v)));
  assert.deepEqual(typical(after), typical(before));
});

test('emptyState uses DATA_VERSION', () => {
  assert.equal(emptyState().settings.schemaVersion, DATA_VERSION);
});

test('a rule with a normaliserVersion still validates, and the field is dropped', () => {
  const b = /** @type {any} */ (base());
  b.rules[0].normaliserVersion = 1;
  const data = dataOf(b);
  assert.equal('normaliserVersion' in data.rules[0], false);
});

// --- restoreChanges ----------------------------------------------------------------------------

test('restoreChanges writes the backup, keeps helpDismissed, sets the schema version and drops lastBackupAt', () => {
  const data = dataOf(base());
  const current = { ...emptyState().settings, helpDismissed: true, lastBackupAt: '2026-10-01T09:00:00.000Z', offeredDefaultIds: ['x'] };
  const c = restoreChanges(data, current);
  assert.deepEqual(c.put?.settings, [{ id: 'settings', schemaVersion: 2, offeredDefaultIds: ['groceries', 'salary'], helpDismissed: true }]);
  assert.deepEqual(c.put?.accounts, data.accounts);
  assert.deepEqual(c.put?.buckets, data.buckets);
  assert.deepEqual(c.put?.rules, data.rules);
  assert.deepEqual(c.put?.categories, data.categories);
  assert.deepEqual(c.put?.overrides, data.overrides);
  assert.deepEqual(c.put?.transferPairs, data.transferPairs);
  assert.deepEqual(c.put?.transactions, data.transactions);
  assert.deepEqual(c.put?.batches, data.batches);
  assert.equal(c.del, undefined);

  const s = emptyState();
  applyToState(s, c);
  assert.equal(s.overrides.get('f2')?.flagDecision, 'rule');
  assert.equal(s.transferPairs.get(pairKey('f3', 'f4'))?.status, 'confirmed');
  assert.equal(s.settings.helpDismissed, true);
});

test('restoreChanges keeps lastBackupAt only when asked', () => {
  const data = dataOf(base());
  const current = { ...emptyState().settings, lastBackupAt: '2026-10-01T09:00:00.000Z' };
  assert.equal(restoreChanges(data, current).put?.settings?.[0].lastBackupAt, undefined);
  assert.equal(restoreChanges(data, current, { keepLastBackup: true }).put?.settings?.[0].lastBackupAt, '2026-10-01T09:00:00.000Z');
  const none = emptyState().settings;
  assert.equal('lastBackupAt' in /** @type {any} */ (restoreChanges(data, none, { keepLastBackup: true }).put?.settings?.[0]), false);
});

// --- Rejections --------------------------------------------------------------------------------

test('anything that is not a backup object from this app is rejected without throwing', () => {
  for (const json of [null, undefined, [], [base()], 'living-costs', '', 42, 0, true, false, {}, { app: 'other' }, { app: 'Living Costs' }]) {
    assert.deepEqual(errorsOf(json), ["This file isn't a backup from this app."], JSON.stringify(json) ?? 'undefined');
  }
});

test('a newer schema version is refused', () => {
  assert.deepEqual(errorsOf({ ...base(), schemaVersion: 3 }), ['This backup is from a newer version of this app.']);
  assert.deepEqual(errorsOf({ ...base(), schemaVersion: 99 }), ['This backup is from a newer version of this app.']);
});

test('an older schema version is refused', () => {
  assert.deepEqual(errorsOf({ ...base(), schemaVersion: 1 }), ["This backup is from an older version of this app and can't be restored."]);
});

test('a missing or malformed schema version is refused', () => {
  for (const v of [undefined, null, '1', 0, -1, 1.5, Number.MAX_VALUE, [], {}]) {
    const b = /** @type {any} */ ({ ...base(), schemaVersion: v });
    if (v === undefined) delete b.schemaVersion;
    assert.deepEqual(errorsOf(b), ["This backup's version is missing or not valid."], String(v));
  }
});

test('a __proto__ key in an account is dropped, not copied', () => {
  const text = JSON.stringify(base()).replace('{"id":"a1",', '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"id":"a1",');
  const json = JSON.parse(text);
  assert.ok(Object.hasOwn(json.accounts[0], '__proto__'));
  const data = dataOf(json);
  const account = data.accounts[0];
  assert.equal(Object.getPrototypeOf(account), Object.prototype);
  assert.equal('polluted' in account, false);
  assert.equal(Object.hasOwn(account, '__proto__'), false);
  assert.equal(Object.hasOwn(account, 'constructor'), false);
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test('unknown keys are dropped everywhere', () => {
  const b = /** @type {any} */ (base());
  b.extra = 1;
  b.accounts[0].extra = 1;
  b.accounts[0].mapping.extra = 1;
  b.accounts[0].mapping.amount.extra = 1;
  b.buckets[0].extra = 1;
  b.rules[0].extra = 1;
  b.rules[0].expected.extra = 1;
  b.categories[0].extra = 1;
  b.overrides[1].extra = 1;
  b.overrides[1].splits[0].extra = 1;
  b.transferPairs[0].extra = 1;
  assert.doesNotMatch(JSON.stringify(dataOf(b)), /extra/);
});

test('a float amountMinor is refused', () => {
  const b = base();
  b.rules[0].amountMinor = -9.99;
  assert.deepEqual(errorsOf(b), ['Rule 1 has a missing or invalid amount.']);
  const c = base();
  /** @type {any} */ (c.overrides[1]).splits[0].amountMinor = -5.5;
  assert.deepEqual(errorsOf(c), ['Override 2 has an invalid split.']);
});

test('a rule pointing at a missing bucket is refused', () => {
  const b = base();
  b.rules[0].bucketId = 'nope';
  assert.deepEqual(errorsOf(b), ['Rule 1 points at a missing bucket.']);
});

test('a duplicate category ID is refused', () => {
  const b = base();
  b.categories[1].id = 'c1';
  // The overrides that used c2 now point at nothing, and say so too.
  assert.deepEqual(errorsOf(b), [
    'Category 2 has the same ID as category 1.',
    'Override 1 points at a missing category.',
    'Override 2 points at a missing category.',
  ]);
});

test('every reference must resolve', () => {
  const b = /** @type {any} */ (base());
  b.buckets[0].categoryId = 'gone';
  b.accounts[2].repaymentBucketIds = ['gone'];
  b.overrides[0].categoryId = 'gone';
  b.overrides[1].splits[1].categoryId = 'gone';
  assert.deepEqual(errorsOf(b), [
    'Account 3 points at a missing bucket.',
    'Bucket 1 points at a missing category.',
    'Override 1 points at a missing category.',
    'Override 2 points at a missing category.',
  ]);
});

test('a bucket stoppedAfter that is not an ISO date is rejected', () => {
  const b = /** @type {any} */ (base());
  b.buckets[0].stoppedAfter = '5 July';
  assert.equal(errorsOf(b).length, 1);
});

test('duplicate IDs, keys and fingerprints are refused', () => {
  const b = /** @type {any} */ (base());
  b.batches = [];
  b.transactions = [];
  b.accounts[1].id = 'a1';
  b.buckets[2].id = 'b1';
  b.rules[0].bucketId = 'b1';
  b.rules.push({ ...b.rules[0] });
  b.overrides[2].fingerprint = 'f1';
  b.transferPairs.push({ ...b.transferPairs[0], status: 'rejected' });
  b.offeredDefaultIds.push('salary');
  assert.deepEqual(errorsOf(b), [
    'Account 2 has the same ID as account 1.',
    'Bucket 3 has the same ID as bucket 1.',
    'Rule 2 has the same ID as rule 1.',
    'Override 3 has the same fingerprint as override 1.',
    'Transfer pair 3 is the same pair as transfer pair 1.',
    'The list of offered default categories repeats an entry.',
  ]);
});

test('an empty bucket key is refused, since the normaliser never makes one', () => {
  const b = base();
  b.buckets[0].keys.push('');
  assert.deepEqual(errorsOf(b), ['Bucket 1 has a missing or invalid list of keys.']);
});

test('a bucket key in two buckets is refused', () => {
  const b = base();
  b.buckets[1].keys.push('SHOP');
  assert.deepEqual(errorsOf(b), ['Bucket 2 shares a key with bucket 1.']);
});

test("a transfer pair whose key doesn't match its fingerprints is refused", () => {
  const b = base();
  b.transferPairs[0].key = 'f3|f4';
  assert.deepEqual(errorsOf(b), ["Transfer pair 1 has a key that doesn't match its fingerprints."]);
  const c = base();
  c.transferPairs[0] = { key: pairKey('f3', 'f3'), fingerprintA: 'f3', fingerprintB: 'f3', status: 'confirmed' };
  assert.deepEqual(errorsOf(c), ['Transfer pair 1 pairs a transaction with itself.']);
});

test('enums, types and shapes are checked field by field', () => {
  const b = /** @type {any} */ (base());
  b.exportedAt = '04/11/2026';
  b.accounts[0].kind = 'savings';
  b.accounts[0].currency = 'gbp';
  b.accounts[1].mapping.dateFormat = 'MM/DD/YYYY';
  b.accounts[1].mapping.amount = { single: 'Amount', debit: 'Out', credit: 'In', signFlipped: false };
  b.accounts[2].identifier = 12;
  b.buckets[0].keys = 'SHOP';
  b.buckets[1].exampleRawTexts = [1];
  b.rules[0].matchType = 'regex';
  b.rules[0].expected = { count: 0, period: 'day' };
  b.categories[0].kind = 'savings';
  b.categories[1].budgetType = 'fixed';
  b.categories[1].position = 1.5;
  b.overrides[0].unusualDismissed = 'yes';
  b.overrides[1].flagDecision = 'maybe';
  b.overrides[2].categoryId = null;
  b.transferPairs[0].status = 'maybe';
  b.offeredDefaultIds = ['ok', 3];
  assert.deepEqual(errorsOf(b), [
    "The backup's export date is missing or not valid.",
    'Account 1 has a missing or invalid currency.',
    'Account 1 has a missing or invalid kind.',
    'Account 2 has a missing or invalid column mapping.',
    'Account 3 has a missing or invalid account number.',
    'Bucket 1 has a missing or invalid list of keys.',
    'Bucket 2 has a missing or invalid list of examples.',
    'Rule 1 has a missing or invalid match type.',
    'Rule 1 has a missing or invalid expected frequency.',
    'Category 1 has a missing or invalid kind.',
    'Category 2 has a missing or invalid position.',
    'Category 2 has a budget type, but its kind has none.',
    'Override 1 has a missing or invalid unusual-amount flag.',
    'Override 2 has a missing or invalid flag decision.',
    'Override 3 has a missing or invalid category.',
    'Transfer pair 1 has a missing or invalid status.',
    'The list of offered default categories is missing or not valid.',
  ]);
});

test('category rules: names are unique and need text, and an override is a move or a split, not both', () => {
  const b = /** @type {any} */ (base());
  b.categories[1].name = ' groceries ';
  b.categories.push({ id: 'c3', name: '  ', kind: 'ignore', position: 2 });
  b.overrides[0].splits = [{ amountMinor: -1, categoryId: 'c1' }, { amountMinor: -2, categoryId: 'c1' }];
  assert.deepEqual(errorsOf(b), [
    'Category 3 has a missing or invalid name.',
    'Override 1 has both a category and a split.',
    'Category 2 has the same name as category 1.',
  ]);
});

test('splits need two or more non-zero parts with the same sign', () => {
  for (const splits of [
    [], [{ amountMinor: -1, categoryId: 'c1' }], [{ amountMinor: -1, categoryId: 'c1' }, { amountMinor: 0, categoryId: 'c1' }],
    [{ amountMinor: -1, categoryId: 'c1' }, { amountMinor: 2, categoryId: 'c1' }], [{ amountMinor: -1, categoryId: 'c1' }, null],
    [{ amountMinor: -1, categoryId: 'c1' }, { amountMinor: -1 }], 'x',
  ]) {
    const b = /** @type {any} */ (base());
    b.overrides[1].splits = splits;
    assert.deepEqual(errorsOf(b), ['Override 2 has an invalid split.'], JSON.stringify(splits));
  }
});

test('missing or wrongly typed lists are reported, and entries that are not objects', () => {
  const b = /** @type {any} */ (base());
  delete b.accounts;
  b.batches = [];
  b.transactions = [];
  b.rules = {};
  b.categories = [null, 'x', [], ...b.categories];
  assert.deepEqual(errorsOf(b), [
    'The backup has no list of accounts.',
    'The backup has no list of rules.',
    'Category 1 is not a valid entry.',
    'Category 2 is not a valid entry.',
    'Category 3 is not a valid entry.',
  ]);
});

test('errors are collected, not just the first, up to a cap', () => {
  const b = /** @type {any} */ (base());
  b.accounts = Array.from({ length: 1000 }, () => 1);
  const errors = errorsOf(b);
  assert.equal(errors.length, 21);
  assert.equal(errors[0], 'Account 1 is not a valid entry.');
  assert.equal(errors[19], 'Account 20 is not a valid entry.');
  assert.equal(errors[20], 'There are more problems than are listed here.');
});

test('a huge array is handled without throwing', () => {
  const b = /** @type {any} */ (base());
  b.overrides = Array.from({ length: 200000 }, (_, i) => ({ fingerprint: `fp${i}`, unusualDismissed: true }));
  assert.equal(dataOf(b).overrides.length, 200000);
  b.buckets = Array.from({ length: 200000 }, () => ({}));
  assert.equal(errorsOf(b).length, 21);
});

test('deep nesting is handled without throwing', () => {
  /** @type {any} */
  let deep = {};
  for (let i = 0; i < 200000; i++) deep = { a: deep, accounts: [deep] };
  const b = /** @type {any} */ (base());
  b.extra = deep;
  dataOf(b);
  b.accounts[0].mapping = deep;
  b.categories = [deep];
  assert.deepEqual(errorsOf(b).slice(0, 2), ['Account 1 has a missing or invalid column mapping.', 'Category 1 has a missing or invalid ID.']);
  assert.deepEqual(errorsOf(deep), ["This file isn't a backup from this app."]);
});

test('objects without a prototype and inherited names are handled', () => {
  const b = /** @type {any} */ (base());
  const bare = Object.assign(Object.create(null), b.categories[0]);
  b.categories[0] = bare;
  assert.equal(dataOf(b).categories[0].name, 'Groceries');
  const c = /** @type {any} */ (base());
  delete c.buckets[0].categoryId;
  delete c.buckets[0].keys;
  c.buckets[0] = Object.assign(Object.create({ keys: ['SHOP'], categoryId: 'c1' }), c.buckets[0]);
  assert.deepEqual(errorsOf(c), ['Bucket 1 has a missing or invalid list of keys.']);
});

test('messages never echo backup content', () => {
  const b = /** @type {any} */ (base());
  const evil = '<img src=x onerror=alert(1)>SECRET MERCHANT';
  b.categories[0].id = evil;
  b.categories[1].id = evil;
  b.buckets[0].categoryId = evil;
  b.accounts[0].name = { evil };
  b.rules[0].bucketId = evil;
  const errors = errorsOf(b);
  assert.ok(errors.length >= 3);
  for (const e of errors) assert.doesNotMatch(e, /SECRET|img|evil/);
});

// --- Transactions and batches -----------------------------------------------


test('buildBackup holds every transaction and batch', async () => {
  const s = await fixtureState();
  const b = buildBackup(s, NOW);
  assert.deepEqual(b.transactions, s.transactions);
  assert.deepEqual(b.batches, s.batches);
  assert.ok(s.transactions.length > 100 && s.batches.length > 1);
  assert.doesNotMatch(JSON.stringify(b), /helpDismissed|lastBackupAt/);
});

test('full round trip: every field of every transaction and batch is copied', () => {
  const b = base();
  const data = dataOf(JSON.parse(JSON.stringify(b)));
  const { app: _app, ...rest } = b;
  assert.deepEqual(data, rest);
});

test('restoring a full backup brings back the same app, with no re-import', async () => {
  const before = await fixtureState();
  const data = dataOf(JSON.parse(JSON.stringify(buildBackup(before, NOW))));
  const after = emptyState();
  applyToState(after, restoreChanges(data, after.settings));
  assert.deepEqual(after.transactions, before.transactions);
  assert.deepEqual(after.batches, before.batches);
  const ctxB = buildContext(before);
  const ctxA = buildContext(after);
  assert.deepEqual(after.transactions.map((t) => resolve(t, ctxA)), before.transactions.map((t) => resolve(t, ctxB)));
  assert.deepEqual(typicalMonth(after, tuning), typicalMonth(before, tuning));
});

test('after a full restore, importing an identical file is still blocked', async () => {
  const before = await fixtureState();
  const data = dataOf(JSON.parse(JSON.stringify(buildBackup(before, NOW))));
  const after = emptyState();
  applyToState(after, restoreChanges(data, after.settings));
  const { blocked, files } = await prepareFiles(after, [pick(CARD)]);
  assert.equal(files.length, 0);
  assert.deepEqual(blocked.map((x) => x.name), [CARD]);
});

test('a backup needs both lists', () => {
  const { batches: _b, ...noBatches } = base();
  assert.deepEqual(errorsOf(noBatches), ['The backup has no list of batches.']);
  const { transactions: _t, ...noTxns } = base();
  assert.deepEqual(errorsOf(noTxns), ['The backup has no list of transactions.']);
  assert.deepEqual(errorsOf({ ...base(), transactions: {} }), ['The backup has no list of transactions.']);
  const { batches: _b2, transactions: _t2, ...neither } = base();
  assert.deepEqual(errorsOf(neither), ['The backup has no list of batches.', 'The backup has no list of transactions.']);
});

test('transaction and batch fields are checked field by field', () => {
  const b = /** @type {any} */ (base());
  b.batches[0].importId = '';
  b.batches[0].fileName = 3;
  b.batches[0].fileHash = null;
  b.batches[0].importedAt = '2026-11-01';
  b.batches[1].rowCount = 0;
  b.batches[1].coversFrom = '2026-02-30';
  b.batches[1].coversTo = '31/10/2026';
  b.transactions[0].date = '2026-13-01';
  b.transactions[0].amountMinor = -9.99;
  b.transactions[0].rawText = 5;
  b.transactions[0].rawType = 7;
  b.transactions[1].fingerprint = '';
  b.transactions[1].currency = 'gbp';
  b.transactions[2].flaggedRuleId = '';
  assert.deepEqual(errorsOf(b), [
    'Batch 1 has a missing or invalid import ID.',
    'Batch 1 has a missing or invalid file name.',
    'Batch 1 has a missing or invalid file hash.',
    'Batch 1 has a missing or invalid import time.',
    'Batch 2 has a missing or invalid row count.',
    'Batch 2 has a missing or invalid covered period.',
    'Transaction 1 has a missing or invalid date.',
    'Transaction 1 has a missing or invalid amount.',
    'Transaction 1 has a missing or invalid description.',
    'Transaction 1 has a missing or invalid type.',
    'Transaction 2 has a missing or invalid fingerprint.',
    'Transaction 2 has a missing or invalid currency.',
    'Transaction 3 has a missing or invalid flagged rule.',
  ]);
});

test("a batch's covered period must not end before it starts", () => {
  const b = base();
  b.batches[0].coversFrom = '2026-11-01';
  assert.deepEqual(errorsOf(b), ['Batch 1 has a missing or invalid covered period.']);
});

test('duplicate transaction and batch IDs are refused, but a repeated fingerprint is allowed', () => {
  const b = /** @type {any} */ (base());
  b.batches.push({ ...b.batches[0] });
  b.transactions[1].id = 't1';
  assert.deepEqual(errorsOf(b), [
    'Batch 3 has the same ID as batch 1.',
    'Transaction 2 has the same ID as transaction 1.',
  ]);
  const c = base();
  c.transactions[1].fingerprint = 'f1';
  dataOf(c);
});

test('every transaction and batch reference must resolve and agree', () => {
  const b = /** @type {any} */ (base());
  b.batches[1].accountId = 'gone';
  b.transactions[0].bucketId = 'gone';
  b.transactions[0].flaggedRuleId = 'gone';
  b.transactions[1].accountId = 'a2';
  b.transactions[2].batchId = 'gone';
  assert.deepEqual(errorsOf(b), [
    'Batch 2 points at a missing account.',
    'Transaction 1 points at a missing bucket.',
    'Transaction 1 points at a missing rule.',
    'Transaction 2 is in a different account from its batch.',
    'Transaction 3 points at a missing batch.',
    'Batch 2 has 1 row, but the backup holds 0 transactions for it.',
  ]);
  const c = /** @type {any} */ (base());
  c.transactions[2].accountId = 'gone';
  c.batches[1].accountId = 'gone';
  assert.deepEqual(errorsOf(c), [
    'Batch 2 points at a missing account.',
    'Transaction 3 points at a missing account.',
  ]);
});

test("a batch's row count must match its transactions", () => {
  const b = base();
  b.transactions[2].batchId = 'k1';
  b.transactions[2].accountId = 'a1';
  assert.deepEqual(errorsOf(b), [
    'Batch 1 has 2 rows, but the backup holds 3 transactions for it.',
    'Batch 2 has 1 row, but the backup holds 0 transactions for it.',
  ]);
  const c = base();
  c.batches[0].rowCount = 5;
  assert.deepEqual(errorsOf(c), ['Batch 1 has 5 rows, but the backup holds 2 transactions for it.']);
});

test("a transaction's currency must match its account's", () => {
  const b = base();
  b.transactions[0].currency = 'EUR';
  assert.deepEqual(errorsOf(b), ["Transaction 1 has a different currency from its account."]);
});

test('unknown keys are dropped from transactions and batches', () => {
  const b = /** @type {any} */ (base());
  b.batches[0].extra = 1;
  b.transactions[0].extra = 1;
  assert.doesNotMatch(JSON.stringify(dataOf(b)), /extra/);
});

test('transaction and batch messages never echo backup content', () => {
  const b = /** @type {any} */ (base());
  const evil = '<img src=x onerror=alert(1)>SECRET MERCHANT';
  b.transactions[0].bucketId = evil;
  b.transactions[1].batchId = evil;
  b.transactions[2].rawText = { evil };
  b.batches[0].fileName = { evil };
  const errors = errorsOf(b);
  assert.ok(errors.length >= 4);
  for (const e of errors) assert.doesNotMatch(e, /SECRET|img|evil/);
});
