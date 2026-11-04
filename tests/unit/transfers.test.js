import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState, combine } from '../../src/changes.js';
import { buildContext, resolve } from '../../src/resolve.js';
import { normalise } from '../../src/normalise.js';
import tuning from '../../src/tuning.js';
import { pairKey, suggestPairs, decidePair, unpair, markPlaceholder } from '../../src/transfers.js';
import {
  expected, BANK_A, SAVINGS, CARD, BANK_B, text, encode, pick, mappingFor,
  accountA, accountS, accountC, accountB, run,
} from './pipeline.js';

/** A, S, C and the three B files, each imported through the pipeline. */
async function loaded() {
  const state = emptyState();
  for (const [account, names] of [[accountA(), [BANK_A]], [accountS(), [SAVINGS]], [accountC(), [CARD]], [accountB(), BANK_B]]) {
    const { changes } = await run(state, account, names.map((n) => pick(n)));
    applyToState(state, changes);
  }
  return state;
}

const OTHER = 'OTHER CARD PLC';
/** @param {any} state */
const otherCardBucket = (state) => state.buckets.find((b) => b.keys.includes(OTHER));

let n = 0;
const txn = (accountId, date, amountMinor, extra = {}) => ({
  id: `t${++n}`, fingerprint: `fp${n}`, accountId, batchId: 'b', date, amountMinor, currency: 'GBP',
  rawText: 'X', bucketId: 'bk', ...extra,
});
/** @param {any[]} accounts @param {any[]} txns */
function small(accounts, txns) {
  const s = emptyState();
  s.accounts = accounts.map(([id, kind = 'bank']) => ({ id, name: id, currency: 'GBP', kind, repaymentBucketIds: [] }));
  s.transactions = txns;
  return s;
}

test('pairKey sorts the two fingerprints and joins them with a newline', () => {
  assert.equal(pairKey('b', 'a'), 'a\nb');
  assert.equal(pairKey('a', 'b'), 'a\nb');
});

test('the fixtures give exactly the expected number of suggestions', async () => {
  const state = await loaded();
  const pairs = suggestPairs(state, tuning);
  assert.equal(pairs.length, expected.transferPairs);
  const seen = new Set();
  for (const { a, b, days } of pairs) {
    assert.notEqual(a.accountId, b.accountId);
    assert.equal(a.amountMinor, -b.amountMinor);
    assert.ok(days >= 0 && days <= tuning.transactionMatchDays);
    for (const t of [a, b]) {
      assert.ok(!seen.has(t.fingerprint), 'each transaction appears once');
      seen.add(t.fingerprint);
    }
  }
});

test('no suggestion pairs OTHER CARD PLC', async () => {
  const state = await loaded();
  for (const { a, b } of suggestPairs(state, tuning)) {
    for (const t of [a, b]) assert.notEqual(normalise(t.rawText, t.rawType), OTHER);
  }
});

test('a rejected pair is never suggested again', async () => {
  const state = await loaded();
  const [first] = suggestPairs(state, tuning);
  applyToState(state, decidePair(first.a, first.b, 'rejected'));
  const key = pairKey(first.a.fingerprint, first.b.fingerprint);
  assert.equal(state.transferPairs.get(key)?.status, 'rejected');
  const again = suggestPairs(state, tuning);
  assert.equal(again.length, expected.transferPairs - 1);
  assert.ok(!again.some((p) => pairKey(p.a.fingerprint, p.b.fingerprint) === key));
});

test('confirmed pairs resolve to transfer on both sides and are not suggested again', async () => {
  const state = await loaded();
  const pairs = suggestPairs(state, tuning);
  applyToState(state, combine(...pairs.map((p) => decidePair(p.a, p.b, 'confirmed'))));
  assert.equal(state.transferPairs.size, expected.transferPairs);
  const ctx = buildContext(state);
  for (const { a, b } of pairs) {
    assert.equal(resolve(a, ctx).source, 'transfer');
    assert.equal(resolve(b, ctx).source, 'transfer');
  }
  assert.deepEqual(suggestPairs(state, tuning), []);
});

test('decidePair stores the pair under its key; unpair deletes it so it can be suggested again', () => {
  const a = txn('A', '2026-09-01', -500);
  const b = txn('B', '2026-09-02', 500);
  const s = small([['A'], ['B']], [a, b]);
  const c = decidePair(a, b, 'confirmed');
  assert.deepEqual(c, { put: { transferPairs: [{ key: pairKey(a.fingerprint, b.fingerprint), fingerprintA: a.fingerprint, fingerprintB: b.fingerprint, status: 'confirmed' }] } });
  applyToState(s, c);
  assert.deepEqual(suggestPairs(s, tuning), []);
  const key = pairKey(a.fingerprint, b.fingerprint);
  assert.deepEqual(unpair(key), { del: { transferPairs: [key] } });
  applyToState(s, unpair(key));
  assert.equal(suggestPairs(s, tuning).length, 1);
});

test('candidates: opposite non-zero amounts, same currency, different non-placeholder accounts, within the window', () => {
  const w = tuning.transactionMatchDays;
  const s = small([['A'], ['B'], ['P', 'placeholder']], [
    txn('A', '2026-09-01', -500), txn('B', '2026-09-01', 400), // not opposite
    txn('A', '2026-09-10', -600), txn('A', '2026-09-11', 600), // same account
    txn('A', '2026-09-20', 0), txn('B', '2026-09-20', 0), // zero
    txn('A', '2026-10-01', -700), txn('B', '2026-10-01', 700, { currency: 'EUR' }), // currency
    txn('A', '2026-10-10', -800), txn('P', '2026-10-10', 800), // placeholder account
    txn('A', '2026-11-01', -900), txn('B', `2026-11-${String(1 + w + 1).padStart(2, '0')}`, 900), // outside
    txn('A', '2026-12-01', -1000), txn('B', `2026-12-${String(1 + w).padStart(2, '0')}`, 1000), // edge, inside
  ]);
  const pairs = suggestPairs(s, tuning);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.amountMinor, -1000);
  assert.equal(pairs[0].days, w);
});

test('greedy: smallest days first, then the earlier date; each transaction once', () => {
  // One debit, two credits: the closer credit wins.
  const d = txn('A', '2026-09-05', -500);
  const far = txn('B', '2026-09-07', 500);
  const near = txn('C', '2026-09-06', 500);
  let pairs = suggestPairs(small([['A'], ['B'], ['C']], [d, far, near]), tuning);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].b.fingerprint, near.fingerprint);
  assert.equal(pairs[0].days, 1);

  // Two debits a day either side of one credit: equal days, so the earlier date wins.
  const early = txn('A', '2026-10-04', -500);
  const credit = txn('B', '2026-10-05', 500);
  const late = txn('C', '2026-10-06', -500);
  pairs = suggestPairs(small([['A'], ['B'], ['C']], [late, credit, early]), tuning);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.fingerprint, early.fingerprint);
  assert.equal(pairs[0].b.fingerprint, credit.fingerprint);
});

test('a is the money-out side and b the money-in side', () => {
  const credit = txn('B', '2026-09-01', 500);
  const debit = txn('A', '2026-09-02', -500);
  const [p] = suggestPairs(small([['A'], ['B']], [credit, debit]), tuning);
  assert.equal(p.a.fingerprint, debit.fingerprint);
  assert.equal(p.b.fingerprint, credit.fingerprint);
});

test('a transaction in a confirmed pair is not offered with another partner', () => {
  const a = txn('A', '2026-09-01', -500);
  const b = txn('B', '2026-09-01', 500);
  const c = txn('C', '2026-09-02', 500);
  const s = small([['A'], ['B'], ['C']], [a, b, c]);
  applyToState(s, decidePair(a, b, 'confirmed'));
  assert.deepEqual(suggestPairs(s, tuning), []);
});

test('a rejected pair leaves both sides free to pair with others', () => {
  const a = txn('A', '2026-09-01', -500);
  const b = txn('B', '2026-09-01', 500);
  const c = txn('C', '2026-09-02', 500);
  const s = small([['A'], ['B'], ['C']], [a, b, c]);
  applyToState(s, decidePair(a, b, 'rejected'));
  const pairs = suggestPairs(s, tuning);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].b.fingerprint, c.fingerprint);
});

test('markPlaceholder creates the account and Other Card (not itemised), and sets the bucket', async () => {
  const state = await loaded();
  const bucket = otherCardBucket(state);
  const c = markPlaceholder(state, { bucketId: bucket.id, cardName: 'Other Card', currency: 'GBP' });
  applyToState(state, c);
  const account = state.accounts.find((a) => a.kind === 'placeholder');
  assert.ok(account);
  assert.equal(account.name, 'Other Card');
  assert.equal(account.currency, 'GBP');
  assert.deepEqual(account.repaymentBucketIds, [bucket.id]);
  const cat = state.categories.find((x) => x.name === 'Other Card (not itemised)');
  assert.ok(cat);
  assert.equal(cat.kind, 'spend');
  assert.equal(cat.budgetType, 'variable');
  assert.equal(state.buckets.find((b) => b.id === bucket.id)?.categoryId, cat.id);
  // Its repayments now count as spending in that category.
  const ctx = buildContext(state);
  const repayment = state.transactions.find((t) => t.bucketId === bucket.id);
  assert.deepEqual(resolve(repayment, ctx), { source: 'bucket', parts: [{ amountMinor: repayment.amountMinor, categoryId: cat.id }] });
});

test('markPlaceholder adds " 2" when the category name is taken', () => {
  const s = small([['A']], [txn('A', '2026-09-01', -500)]);
  s.buckets = [{ id: 'bk', keys: ['X'], displayName: 'X', exampleRawTexts: [] }, { id: 'bk2', keys: ['Y'], displayName: 'Y', exampleRawTexts: [] }];
  applyToState(s, markPlaceholder(s, { bucketId: 'bk', cardName: ' Other Card ', currency: 'GBP' }));
  applyToState(s, markPlaceholder(s, { bucketId: 'bk2', cardName: 'other card', currency: 'GBP' }));
  assert.deepEqual(s.categories.map((c) => c.name), ['Other Card (not itemised)', 'other card (not itemised) 2']);
  assert.deepEqual(s.accounts.filter((a) => a.kind === 'placeholder').map((a) => a.name), ['Other Card', 'other card']);
});

// A small made-up Other Card statement, in the card format. Its payments received mirror the
// first three OTHER CARD PLC repayments (22nd of Nov 2025, Dec 2025 and Jan 2026) a day later.
const OTHER_CARD_CSV = [
  text(CARD).replace(/^﻿/, '').split('\n')[0],
  '"05/11/2025","06/11/2025","Purchase","EXAMPLE GARDEN SHOP","37.10"',
  '"23/11/2025","23/11/2025","Payment","PAYMENT RECEIVED","-120.00"',
  '"23/12/2025","23/12/2025","Payment","PAYMENT RECEIVED","-125.00"',
  '"23/01/2026","23/01/2026","Payment","PAYMENT RECEIVED","-130.00"',
  '',
].join('\n');

test('importing into the placeholder makes it a card account, and its repayments get suggested pairs', async () => {
  const state = await loaded();
  const bucket = otherCardBucket(state);
  applyToState(state, markPlaceholder(state, { bucketId: bucket.id, cardName: 'Other Card', currency: 'GBP' }));
  const placeholder = state.accounts.find((a) => a.kind === 'placeholder');
  const before = suggestPairs(state, tuning).length;

  // The import flow gives the placeholder a mapping and keeps its kind; commit makes it a card.
  const target = { ...placeholder, mapping: mappingFor('card', CARD) };
  const { changes } = await run(state, target, [pick('other-card.csv', encode(OTHER_CARD_CSV))]);
  assert.equal(changes.put.batches.length, 1);
  assert.deepEqual(changes.put.accounts, [{ ...target, kind: 'card' }]);
  applyToState(state, changes);

  const account = state.accounts.find((a) => a.id === placeholder.id);
  assert.equal(account.kind, 'card');
  assert.deepEqual(account.repaymentBucketIds, [bucket.id]);
  const cat = state.categories.find((c) => c.name === 'Other Card (not itemised)');
  assert.equal(state.buckets.find((b) => b.id === bucket.id)?.categoryId, cat.id);

  const pairs = suggestPairs(state, tuning);
  const theirs = pairs.filter((p) => p.b.accountId === placeholder.id);
  assert.equal(pairs.length, before + 3);
  assert.equal(theirs.length, 3);
  for (const { a } of theirs) assert.equal(a.bucketId, bucket.id);
  assert.deepEqual(theirs.map((p) => p.a.date).sort(), ['2025-11-22', '2025-12-22', '2026-01-22']);

  // Confirmed, those repayments are transfers; later ones still count in the not-itemised category.
  applyToState(state, combine(...theirs.map((p) => decidePair(p.a, p.b, 'confirmed'))));
  const ctx = buildContext(state);
  for (const { a } of theirs) assert.equal(resolve(a, ctx).source, 'transfer');
  const later = state.transactions.find((t) => t.bucketId === bucket.id && t.date === '2026-10-22');
  assert.deepEqual(resolve(later, ctx).parts, [{ amountMinor: later.amountMinor, categoryId: cat.id }]);
});

test('importing into a bank or card account leaves its kind alone', async () => {
  const state = emptyState();
  const { changes } = await run(state, accountC(), [pick(CARD)]);
  assert.equal(changes.put.accounts[0].kind, 'card');
});
