import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState, combine } from '../../src/changes.js';
import { assignBuckets, mergeBuckets, setBucketCategory, setBucketStopped, stoppedDateFor, resumedBuckets } from '../../src/buckets.js';

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
  s.rules.push({ id: 'r1', pattern: 'X', matchType: 'keyAmount', amountMinor: 1, expected: { count: 1, period: 'month' }, bucketId: b.id });
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
  const rows = [1234, 5678, 9012, 3456, 7890, 1111, 2222].map((d, i) => txn(`2026-09-0${i + 1}`, -1, `TESCO STORES ${d}`));
  applyToState(s, assignBuckets(s, rows));
  assert.equal(s.buckets.length, 1);
  assert.equal(s.buckets[0].exampleRawTexts.length, 5);
  assert.equal(new Set(s.buckets[0].exampleRawTexts).size, 5);
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

// --- Stopped -------------------------------------------------------------------------------------

function stoppedState(kind = 'spend') {
  const s = emptyState();
  s.categories.push({ id: 'c1', name: 'Cat', kind, position: 0 });
  s.buckets.push({ id: 'g', keys: ['GYM'], displayName: 'Gym', categoryId: 'c1', stoppedAfter: '2026-07-05', exampleRawTexts: ['GYM'] });
  return s;
}

test('setBucketStopped sets and clears', () => {
  const s = stoppedState();
  s.buckets[0] = { id: 'g', keys: ['GYM'], displayName: 'Gym', exampleRawTexts: [] };
  applyToState(s, setBucketStopped(s, 'g', '2026-07-05'));
  assert.equal(s.buckets[0].stoppedAfter, '2026-07-05');
  applyToState(s, setBucketStopped(s, 'g', undefined));
  assert.equal('stoppedAfter' in s.buckets[0], false);
});

test('stoppedDateFor uses the latest charge across accounts, not a later refund or another bucket', () => {
  const s = stoppedState();
  s.transactions.push(
    txn('2026-06-05', -3000, 'GYM', { bucketId: 'g' }),
    txn('2026-07-01', -3000, 'GYM', { bucketId: 'g', accountId: 'a2' }),
    txn('2026-07-20', 500, 'GYM', { bucketId: 'g' }),
    txn('2026-09-01', -100, 'OTHER', { bucketId: 'x' }),
  );
  assert.equal(stoppedDateFor(s, 'g'), '2026-07-01');
  assert.equal(stoppedDateFor(s, 'none'), undefined);
});

test('stoppedDateFor counts a credit as the charge for an income bucket', () => {
  const s = stoppedState('income');
  s.transactions.push(txn('2026-06-05', 250000, 'GYM', { bucketId: 'g' }), txn('2026-06-20', -100, 'GYM', { bucketId: 'g' }));
  assert.equal(stoppedDateFor(s, 'g'), '2026-06-05');
});

test('stoppedDateFor picks a charge in an incomplete month', () => {
  // Statements end mid-September, so September is incomplete and outside the category's months.
  const s = stoppedState();
  s.transactions.push(txn('2026-07-05', -3000, 'GYM', { bucketId: 'g' }), txn('2026-08-05', -3000, 'GYM', { bucketId: 'g' }),
    txn('2026-09-05', -3000, 'GYM', { bucketId: 'g' }));
  assert.equal(stoppedDateFor(s, 'g'), '2026-09-05');
});

test('marking Stopped then re-importing the same charges keeps the mark', () => {
  const s = emptyState();
  s.categories.push({ id: 'c1', name: 'Cat', kind: 'spend', position: 0 });
  const rows = [txn('2026-07-05', -3000, 'GYM'), txn('2026-08-05', -3000, 'GYM'), txn('2026-09-05', -3000, 'GYM')];
  applyToState(s, assignBuckets(s, rows));
  const id = s.buckets[0].id;
  applyToState(s, setBucketCategory(s, id, 'c1'));
  applyToState(s, setBucketStopped(s, id, stoppedDateFor(s, id)));
  assert.equal(s.buckets[0].stoppedAfter, '2026-09-05');
  // Undo the batch, or a settings-only restore, then import the same CSV again.
  s.transactions = [];
  const c = assignBuckets(s, rows.map((t) => ({ ...t })));
  assert.deepEqual(resumedBuckets(s, c), []);
  applyToState(s, c);
  assert.equal(s.buckets[0].stoppedAfter, '2026-09-05');
});

test('merge keeps stoppedAfter only when every merged bucket was stopped', () => {
  const s = stoppedState();
  s.buckets.push({ id: 'h', keys: ['GYM2'], displayName: 'Gym2', stoppedAfter: '2026-08-01', exampleRawTexts: [] });
  s.buckets.push({ id: 'i', keys: ['OTHER'], displayName: 'Other', exampleRawTexts: [] });
  assert.equal(mergeBuckets(s, 'g', ['h'], { displayName: 'G' }).put.buckets[0].stoppedAfter, '2026-08-01');
  assert.equal('stoppedAfter' in mergeBuckets(s, 'g', ['h', 'i'], { displayName: 'G' }).put.buckets[0], false);
});

test('a newer charge on import clears stoppedAfter and is reported', () => {
  const s = stoppedState();
  const c = assignBuckets(s, [txn('2026-08-05', -3000, 'GYM')]);
  assert.equal('stoppedAfter' in c.put.buckets[0], false);
  assert.deepEqual(resumedBuckets(s, c).map((b) => b.id), ['g']);
});

test('an older or same-day charge, or a newer refund, leaves stoppedAfter alone', () => {
  const s = stoppedState();
  const c = assignBuckets(s, [txn('2026-07-05', -3000, 'GYM'), txn('2026-08-10', 500, 'GYM')]);
  assert.equal(c.put.buckets?.find((b) => b.id === 'g')?.stoppedAfter ?? '2026-07-05', '2026-07-05');
  assert.deepEqual(resumedBuckets(s, c), []);
});

test('an income bucket counts a credit as a charge', () => {
  const s = stoppedState('income');
  const c = assignBuckets(s, [txn('2026-08-05', 250000, 'GYM')]);
  assert.deepEqual(resumedBuckets(s, c).map((b) => b.id), ['g']);
});
