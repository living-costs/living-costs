import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rematch } from '../../src/rematch.js';
import { normalise } from '../../src/normalise.js';
import { buildBackup, validateBackup } from '../../src/backup.js';
import { fixtureState } from './helpers/fixture-state.js';
import { NOW } from './pipeline.js';

/** @param {string} id @param {string} rawText @param {string} bucketId @param {number} [amountMinor] */
const tx = (id, rawText, bucketId, amountMinor = -100) => ({
  id, fingerprint: `f${id}`, accountId: 'a1', batchId: 'k1', date: '2026-10-02', amountMinor,
  currency: 'GBP', rawText, bucketId,
});
/** @param {string} id @param {string[]} keys @param {string[]} [examples] */
const bucket = (id, keys, examples = []) => ({ id, keys, displayName: id, exampleRawTexts: examples });

/** @param {any} over @returns {any} */
const data = (over) => ({
  schemaVersion: 2, exportedAt: '2026-11-04T10:00:00.000Z', accounts: [], buckets: [], rules: [], categories: [],
  overrides: [], transferPairs: [], offeredDefaultIds: [], batches: [], transactions: [], ...over,
});

// Old normaliser: the text as is.
const oldN = (/** @type {string} */ s) => s;

test('a split key: the bucket gains both new keys', () => {
  const d = data({
    buckets: [bucket('b1', ['SHOP'])],
    transactions: [tx('1', 'SHOP', 'b1'), tx('2', 'SHOP', 'b1'), { ...tx('3', 'SHOP', 'b1'), rawType: 'X' }],
  });
  const r = rematch(d, (s) => s, (s, t) => (t ? `${s} ${t}` : s));
  assert.deepEqual(r.buckets[0].keys, ['SHOP', 'SHOP X']);
});

test('a merged key goes to the bucket with more transactions; the other keeps its transactions', () => {
  const d = data({
    buckets: [bucket('b1', ['X1']), bucket('b2', ['X2'])],
    transactions: [tx('1', 'X1', 'b1'), tx('2', 'X2', 'b2'), tx('3', 'X2', 'b2')],
  });
  const r = rematch(d, oldN, () => 'X');
  assert.deepEqual(r.buckets.map((b) => b.keys), [[], ['X']]);
  assert.deepEqual(r.transactions, d.transactions);
});

test('a tie goes to the earlier bucket', () => {
  const d = data({
    buckets: [bucket('b1', ['X1']), bucket('b2', ['X2'])],
    transactions: [tx('1', 'X1', 'b1'), tx('2', 'X2', 'b2')],
  });
  const r = rematch(d, oldN, () => 'X');
  assert.deepEqual(r.buckets.map((b) => b.keys), [['X'], []]);
});

test('a rule pattern follows its key; the source bucket gains it and the rule bucket stays keyless', () => {
  const d = data({
    buckets: [bucket('b1', ['PAYPAL PAYMENT']), bucket('b2', [])],
    rules: [{ id: 'r1', pattern: 'PAYPAL PAYMENT', matchType: 'keyAmount', amountMinor: -500, bucketId: 'b2' }],
    transactions: [tx('1', 'PAYPAL PAYMENT', 'b1', -200), tx('2', 'PAYPAL PAYMENT', 'b2', -500)],
  });
  const r = rematch(d, oldN, () => 'PAYPAL');
  assert.deepEqual(r.buckets.map((b) => b.keys), [['PAYPAL'], []]);
  assert.equal(r.rules[0].pattern, 'PAYPAL');
});

test('a rule pattern with several new keys takes the most common at the rule amount', () => {
  const n = (/** @type {string} */ s) => s.split(' ')[1];
  const d = data({
    buckets: [bucket('b1', ['P']), bucket('b2', [])],
    rules: [{ id: 'r1', pattern: 'P', matchType: 'keyAmount', amountMinor: -500, bucketId: 'b2' }],
    transactions: [tx('1', 'P A', 'b1', -200), tx('2', 'P A', 'b1', -200), tx('3', 'P B', 'b2', -500)],
  });
  const r = rematch(d, () => 'P', n);
  assert.equal(r.rules[0].pattern, 'B');
  assert.deepEqual(r.buckets[0].keys, ['A', 'B']);
});

test('a rule pattern counts only the transactions it routes, not others in the rule bucket', () => {
  const first = (/** @type {string} */ s) => s.split(' ')[0];
  const second = (/** @type {string} */ s) => s.split(' ')[1];
  const d = data({
    buckets: [bucket('b1', ['P']), bucket('b2', ['Q'])],
    rules: [{ id: 'r1', pattern: 'P', matchType: 'keyAmount', amountMinor: -500, bucketId: 'b2' }],
    transactions: [
      tx('1', 'P A', 'b1', -200), tx('2', 'P B', 'b2', -500),
      // Same bucket and amount, but under the bucket's other old key Q: not routed by the rule.
      tx('3', 'Q A', 'b2', -500), tx('4', 'Q A', 'b2', -500),
    ],
  });
  const r = rematch(d, first, second);
  assert.equal(r.rules[0].pattern, 'B');
});

test('a bucket with only examples gets keys from them', () => {
  const d = data({ buckets: [bucket('b1', ['OLD'], ['Shop One'])] });
  const r = rematch(d, () => 'OLD', (s) => s.toUpperCase());
  assert.deepEqual(r.buckets[0].keys, ['SHOP ONE']);
});

test('a key with no transactions or examples is normalised as text', () => {
  const d = data({
    buckets: [bucket('b1', ['gone'])],
    rules: [{ id: 'r1', pattern: 'rule text', matchType: 'keyAmount', amountMinor: -1, bucketId: 'b1' }],
  });
  const r = rematch(d, oldN, (s) => s.toUpperCase());
  assert.deepEqual(r.buckets[0].keys, ['GONE']);
  assert.equal(r.rules[0].pattern, 'RULE TEXT');
});

test('nothing else changes', () => {
  const d = data({
    accounts: [{ id: 'a1' }], batches: [{ id: 'k1' }], categories: [{ id: 'c1' }], overrides: [{ fingerprint: 'f1' }],
    transferPairs: [{ key: 'k' }], offeredDefaultIds: ['groceries'],
    buckets: [{ ...bucket('b1', ['A'], ['a']), categoryId: 'c1', stoppedAfter: '2026-07-05' }],
    rules: [{ id: 'r1', pattern: 'A', matchType: 'keyAmount', amountMinor: -1, bucketId: 'b1' }],
    transactions: [tx('1', 'a', 'b1')],
  });
  const before = structuredClone(d);
  const r = rematch(d, () => 'A', () => 'Z');
  assert.deepEqual(d, before, 'input not mutated');
  for (const k of ['accounts', 'batches', 'transactions', 'categories', 'overrides', 'transferPairs', 'offeredDefaultIds']) {
    assert.deepEqual(/** @type {any} */ (r)[k], d[k], k);
  }
  assert.deepEqual(r.buckets.map(({ keys, ...rest }) => rest), d.buckets.map((/** @type {any} */ { keys, ...rest }) => rest));
  assert.deepEqual(r.buckets[0].keys, ['Z']);
  assert.deepEqual(r.rules.map(({ pattern, ...rest }) => rest), d.rules.map((/** @type {any} */ { pattern, ...rest }) => rest));
});

test('the current normaliser on both sides changes nothing on the fixture data', async () => {
  const s = await fixtureState();
  const v = validateBackup(buildBackup(s, NOW));
  assert.equal(v.ok, true);
  const d = /** @type {any} */ (v).data;
  assert.deepEqual(rematch(d, normalise, normalise), d);
});
