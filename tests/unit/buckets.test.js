import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState, combine } from '../../src/changes.js';
import { assignBuckets, mergeBuckets, setBucketCategory } from '../../src/buckets.js';

let n = 0;
const txn = (date, amountMinor, rawText, extra = {}) => ({
  id: `t${++n}`, fingerprint: `fp${n}`, accountId: 'a1', batchId: 'b1', date, amountMinor, currency: 'GBP', rawText, ...extra,
});

test('same key shares a bucket; new key makes another; every txn appears once', () => {
  const s = emptyState();
  const incoming = [txn('2026-09-02', -500, 'TESCO STORES 1234'), txn('2026-09-03', -700, 'TESCO STORES 1234'), txn('2026-09-04', -100, 'GREGGS')];
  const c = assignBuckets(s, incoming);
  assert.equal(c.put.transactions.length, 3);
  applyToState(s, c);
  assert.equal(s.buckets.length, 2);
  assert.equal(s.transactions[0].bucketId, s.transactions[1].bucketId);
  assert.notEqual(s.transactions[0].bucketId, s.transactions[2].bucketId);
  assert.equal(s.buckets[0].displayName, s.buckets[0].keys[0]);
  assert.equal(s.buckets[0].categoryId, undefined);
});

test('merged key routes to the survivor on re-import; merge repoints everything', () => {
  const s = emptyState();
  applyToState(s, assignBuckets(s, [txn('2026-09-02', -500, 'AMAZON.CO.UK'), txn('2026-09-03', -700, 'AMZNMKTPLACE')]));
  const [a, b] = s.buckets;
  s.accounts.push({ id: 'a1', name: 'x', currency: 'GBP', kind: 'card', repaymentBucketIds: [a.id, b.id] });
  s.rules.push({ id: 'r1', pattern: 'X', matchType: 'keyAmount', amountMinor: 1, expected: { count: 1, period: 'month' }, bucketId: b.id, normaliserVersion: 1 });
  const before = structuredClone(s.buckets);
  const c = mergeBuckets(s, a.id, [b.id], { displayName: 'Amazon', categoryId: 'c1' });
  assert.deepEqual(s.buckets, before, 'no mutation');
  applyToState(s, c);
  assert.equal(s.buckets.length, 1);
  assert.deepEqual(s.buckets[0].keys, [a.keys[0], b.keys[0]]);
  assert.equal(s.buckets[0].categoryId, 'c1');
  assert.ok(s.transactions.every((t) => t.bucketId === a.id));
  assert.equal(s.rules[0].bucketId, a.id);
  assert.deepEqual(s.accounts[0].repaymentBucketIds, [a.id]);
  const c2 = assignBuckets(s, [txn('2026-10-03', -1, 'AMZNMKTPLACE')]);
  assert.equal(c2.put.transactions[0].bucketId, a.id);
  assert.equal(c2.put.buckets, undefined);
  applyToState(s, mergeBuckets(s, a.id, [], { displayName: 'Amazon' }));
  assert.equal(s.buckets[0].categoryId, undefined, 'omitted categoryId clears');
});

test('setBucketCategory sets and clears', () => {
  const s = emptyState();
  applyToState(s, assignBuckets(s, [txn('2026-09-02', -500, 'GREGGS')]));
  const id = s.buckets[0].id;
  applyToState(s, setBucketCategory(s, id, 'c9'));
  assert.equal(s.buckets[0].categoryId, 'c9');
  applyToState(s, setBucketCategory(s, id, undefined));
  assert.ok(!('categoryId' in s.buckets[0]));
});

test('examples cap at 5 distinct', () => {
  const s = emptyState();
  const rows = ['GREGGS', 'GREGGS', 'GREGGS  ', ...[1, 2, 3, 4, 5, 6].map((i) => `GREGGS ${'x'.repeat(i)}`)].map((r, i) => txn(`2026-09-0${i + 1}`, -1, r));
  applyToState(s, assignBuckets(s, rows));
  for (const b of s.buckets) assert.ok(b.exampleRawTexts.length <= 5);
  assert.equal(new Set(s.buckets[0].exampleRawTexts).size, s.buckets[0].exampleRawTexts.length);
});

test('applyToState: upsert in place, del after put; combine concatenates', () => {
  const s = emptyState();
  applyToState(s, { put: { buckets: [{ id: 'x', keys: [], displayName: 'a', exampleRawTexts: [] }, { id: 'y', keys: [], displayName: 'b', exampleRawTexts: [] }] } });
  applyToState(s, combine({ put: { buckets: [{ id: 'x', keys: [], displayName: 'a2', exampleRawTexts: [] }] } }, { put: { buckets: [{ id: 'x', keys: [], displayName: 'a3', exampleRawTexts: [] }] }, del: { buckets: ['y'] } }));
  assert.deepEqual(s.buckets.map((b) => b.displayName), ['a3']);
  applyToState(s, { put: { overrides: [{ fingerprint: 'f', categoryId: 'c' }], settings: [{ ...s.settings, helpDismissed: true }] } });
  assert.equal(s.overrides.get('f').categoryId, 'c');
  assert.equal(s.settings.helpDismissed, true);
  applyToState(s, { del: { overrides: ['f'] } });
  assert.equal(s.overrides.size, 0);
});
