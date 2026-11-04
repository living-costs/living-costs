import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState } from '../../src/changes.js';
import { setCategoryOverride, dismissUnusual, setSplit, resetOverride } from '../../src/overrides.js';
import { setBucketCategory } from '../../src/buckets.js';
import { buildContext, resolve } from '../../src/resolve.js';

test('setCategoryOverride creates an override when there is none', () => {
  const s = emptyState();
  assert.deepEqual(setCategoryOverride(s, 'f1', 'gifts'), { put: { overrides: [{ fingerprint: 'f1', categoryId: 'gifts' }] } });
});

test('setCategoryOverride clears splits and keeps other fields', () => {
  const s = emptyState();
  s.overrides.set('f1', {
    fingerprint: 'f1', categoryId: 'old', splits: [{ amountMinor: -100, categoryId: 'x' }],
    unusualDismissed: true, flagDecision: 'rule',
  });
  const c = setCategoryOverride(s, 'f1', 'gifts');
  assert.deepEqual(c.put?.overrides, [{ fingerprint: 'f1', categoryId: 'gifts', unusualDismissed: true, flagDecision: 'rule' }]);
  assert.deepEqual(s.overrides.get('f1')?.splits, [{ amountMinor: -100, categoryId: 'x' }], 'state is not mutated');
});

test('dismissUnusual creates an override when there is none', () => {
  const s = emptyState();
  assert.deepEqual(dismissUnusual(s, 'f1'), { put: { overrides: [{ fingerprint: 'f1', unusualDismissed: true }] } });
});

test('dismissUnusual keeps other fields', () => {
  const s = emptyState();
  const splits = [{ amountMinor: -100, categoryId: 'x' }];
  s.overrides.set('f1', { fingerprint: 'f1', categoryId: 'gifts', splits, flagDecision: 'source' });
  const c = dismissUnusual(s, 'f1');
  assert.deepEqual(c.put?.overrides, [{ fingerprint: 'f1', categoryId: 'gifts', splits, flagDecision: 'source', unusualDismissed: true }]);
  applyToState(s, c);
  assert.equal(s.overrides.get('f1')?.unusualDismissed, true);
});

/** State with two categories and one bucket, and a debit of -60.69 in that bucket. */
function withTxn() {
  const s = emptyState();
  s.categories = [
    { id: 'household', name: 'Household', kind: 'spend', budgetType: 'annual', position: 0 },
    { id: 'gifts', name: 'Gifts', kind: 'spend', budgetType: 'annual', position: 1 },
  ];
  s.buckets = [{ id: 'bk', keys: ['amazon'], displayName: 'AMAZON', exampleRawTexts: [] }];
  const txn = {
    id: 't1', fingerprint: 'f1', accountId: 'a', batchId: 'b', date: '2026-09-24',
    amountMinor: -6069, currency: 'GBP', rawText: 'AMAZON', bucketId: 'bk',
  };
  s.transactions = [txn];
  return { s, txn };
}

test('setSplit saves parts that sum to the transaction, clearing a category override', () => {
  const { s, txn } = withTxn();
  s.overrides.set('f1', { fingerprint: 'f1', categoryId: 'gifts', unusualDismissed: true });
  const parts = [{ amountMinor: -4000, categoryId: 'household' }, { amountMinor: -2069, categoryId: 'gifts' }];
  const c = setSplit(s, txn, parts);
  assert.deepEqual(c, { put: { overrides: [{ fingerprint: 'f1', unusualDismissed: true, splits: parts }] } });
  assert.equal(s.overrides.get('f1')?.categoryId, 'gifts', 'state is not mutated');
});

test('a split that does not sum is an error', () => {
  const { s, txn } = withTxn();
  const r = setSplit(s, txn, [{ amountMinor: -4000, categoryId: 'household' }, { amountMinor: -2000, categoryId: 'gifts' }]);
  assert.ok('error' in r);
});

test('a mixed-sign split is an error', () => {
  const { s, txn } = withTxn();
  const r = setSplit(s, txn, [
    { amountMinor: -8000, categoryId: 'household' }, { amountMinor: 1931, categoryId: 'gifts' },
  ]);
  assert.ok('error' in r);
});

test('a split needs two or more non-zero parts, each with a known category', () => {
  const { s, txn } = withTxn();
  assert.ok('error' in setSplit(s, txn, [{ amountMinor: -6069, categoryId: 'household' }]));
  assert.ok('error' in setSplit(s, txn, [
    { amountMinor: -6069, categoryId: 'household' }, { amountMinor: 0, categoryId: 'gifts' },
  ]));
  assert.ok('error' in setSplit(s, txn, [
    { amountMinor: -4000, categoryId: 'household' }, { amountMinor: -2069, categoryId: '' },
  ]));
  assert.ok('error' in setSplit(s, txn, [
    { amountMinor: -4000, categoryId: 'household' }, { amountMinor: -2069, categoryId: 'gone' },
  ]));
  assert.ok('error' in setSplit(s, txn, [
    { amountMinor: -4000.5, categoryId: 'household' }, { amountMinor: -2068.5, categoryId: 'gifts' },
  ]));
});

test('reset keeps unusualDismissed', () => {
  const { s } = withTxn();
  s.overrides.set('f1', {
    fingerprint: 'f1', splits: [{ amountMinor: -4000, categoryId: 'household' }, { amountMinor: -2069, categoryId: 'gifts' }],
    unusualDismissed: true, flagDecision: 'rule',
  });
  assert.deepEqual(resetOverride(s, 'f1'),
    { put: { overrides: [{ fingerprint: 'f1', unusualDismissed: true, flagDecision: 'rule' }] } });
  s.overrides.set('f2', { fingerprint: 'f2', categoryId: 'gifts', unusualDismissed: true });
  assert.deepEqual(resetOverride(s, 'f2'), { put: { overrides: [{ fingerprint: 'f2', unusualDismissed: true }] } });
});

test('reset deletes an override left with nothing in it, and does nothing without one', () => {
  const { s } = withTxn();
  s.overrides.set('f1', { fingerprint: 'f1', categoryId: 'gifts' });
  const c = resetOverride(s, 'f1');
  assert.deepEqual(c, { del: { overrides: ['f1'] } });
  applyToState(s, c);
  assert.equal(s.overrides.has('f1'), false);
  assert.deepEqual(resetOverride(s, 'f1'), {});
});

test('an override set, then the bucket recategorised, still resolves to the override', () => {
  const { s, txn } = withTxn();
  s.categories.push({ id: 'other', name: 'Other', kind: 'spend', budgetType: 'variable', position: 2 });
  applyToState(s, setBucketCategory(s, 'bk', 'household'));
  applyToState(s, setCategoryOverride(s, 'f1', 'gifts'));
  applyToState(s, setBucketCategory(s, 'bk', 'other'));
  const r = resolve(txn, buildContext(s));
  assert.equal(r.source, 'override');
  assert.deepEqual(r.parts, [{ amountMinor: -6069, categoryId: 'gifts' }]);
});

test('a split, then the bucket recategorised, still resolves to the split', () => {
  const { s, txn } = withTxn();
  const parts = [{ amountMinor: -4000, categoryId: 'household' }, { amountMinor: -2069, categoryId: 'gifts' }];
  applyToState(s, /** @type {any} */ (setSplit(s, txn, parts)));
  applyToState(s, setBucketCategory(s, 'bk', 'gifts'));
  applyToState(s, setBucketCategory(s, 'bk', 'household'));
  const r = resolve(txn, buildContext(s));
  assert.equal(r.source, 'split');
  assert.deepEqual(r.parts, parts);
});
