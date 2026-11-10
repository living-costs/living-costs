import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState } from '../../src/changes.js';
import { isValidFilter, categoryMatcher, transactionMatcher } from '../../src/category-filter.js';

let seq = 0;
/** @param {string} id @param {string} kind @param {string} [budgetType] */
const cat = (id, kind, budgetType) => ({ id, name: id, kind, ...(budgetType ? { budgetType } : {}), position: 0 });
/** @param {string} id @param {string} [categoryId] */
const bucket = (id, categoryId) => ({ id, keys: [id], displayName: id, exampleRawTexts: [], ...(categoryId ? { categoryId } : {}) });
/** @param {string} accountId @param {number} amountMinor @param {string} bucketId */
const txn = (accountId, amountMinor, bucketId) => ({
  id: `t${++seq}`, fingerprint: `f${seq}`, accountId, batchId: 'b', date: '2026-03-10', amountMinor, currency: 'GBP',
  rawText: bucketId, bucketId,
});
/** @param {string} id @param {string} kind */
const acct = (id, kind) => ({ id, name: id, currency: 'GBP', kind, repaymentBucketIds: [] });

const out = txn('A', -5000, 'xfer');
const into = txn('S', 5000, 'xfer');
const [fa, fb] = [out.fingerprint, into.fingerprint].sort();
const plain = {
  rent: txn('A', -100000, 'landlord'),
  shop: txn('A', -3000, 'shop'),
  split: txn('A', -4000, 'shop'),
  deleted: txn('A', -1000, 'shop'),
  gift: txn('A', -2000, 'gift'),
  bank: txn('A', -700, 'moves'),
  free: txn('A', -800, 'mystery'),
  saved: txn('A', -900, 'pot'),
};

const state = /** @type {any} */ (emptyState());
applyToState(state, {
  put: {
    accounts: [acct('A', 'bank'), acct('S', 'savings')],
    categories: [
      cat('rent', 'spend', 'fixed'), cat('fun', 'spend', 'variable'), cat('junk', 'ignore', 'fixed'),
      cat('moves', 'transfer'), cat('pot', 'saving', 'oneoff'),
    ],
    buckets: [
      bucket('landlord', 'rent'), bucket('shop', 'fun'), bucket('gift', 'junk'), bucket('moves', 'moves'),
      bucket('xfer', 'pot'), bucket('mystery'), bucket('pot', 'pot'),
    ],
    transactions: [out, into, ...Object.values(plain)],
    transferPairs: [{ key: `${fa}\n${fb}`, fingerprintA: fa, fingerprintB: fb, status: 'confirmed' }],
    overrides: [
      { fingerprint: plain.split.fingerprint, splits: [{ amountMinor: -3000, categoryId: 'rent' }, { amountMinor: -1000, categoryId: 'junk' }] },
      { fingerprint: plain.deleted.fingerprint, categoryId: 'gone' },
    ],
  },
});

/** @param {string} filter */
const matching = (filter) => {
  const m = transactionMatcher(state, filter);
  return Object.entries({ out, into, ...plain }).filter(([, t]) => m(t)).map(([k]) => k).sort();
};

test('empty filter matches everything', () => {
  assert.equal(matching('').length, 10);
  assert.equal(categoryMatcher(state, '')('anything'), true);
});

test('a category matches either part of a split', () => {
  assert.deepEqual(matching('category:rent'), ['rent', 'split']);
  assert.deepEqual(matching('category:junk'), ['gift', 'split']);
});

test('kind:ignore', () => {
  assert.deepEqual(matching('kind:ignore'), ['gift', 'split']);
});

test('kind:transfer matches confirmed pairs and Transfer-category buckets', () => {
  assert.deepEqual(matching('kind:transfer'), ['bank', 'into', 'out']);
});

test('type: matches budgeted kinds only', () => {
  assert.deepEqual(matching('type:fixed'), ['rent', 'split']); // junk is Ignore with a stray fixed
});

test('type:oneoff does not match a confirmed savings pair', () => {
  assert.deepEqual(matching('type:oneoff'), ['saved']);
});

test('none matches uncategorised and unknown ids, not splits or pairs', () => {
  assert.deepEqual(matching('none'), ['deleted', 'free']);
});

test('categoryMatcher', () => {
  assert.equal(categoryMatcher(state, 'none')(null), true);
  assert.equal(categoryMatcher(state, 'none')(undefined), true);
  assert.equal(categoryMatcher(state, 'none')('gone'), true);
  assert.equal(categoryMatcher(state, 'none')('rent'), false);
  assert.equal(categoryMatcher(state, 'kind:spend')('rent'), true);
  assert.equal(categoryMatcher(state, 'kind:spend')(null), false);
  assert.equal(categoryMatcher(state, 'type:fixed')('junk'), false);
  assert.equal(categoryMatcher(state, 'type:fixed')('rent'), true);
  assert.equal(categoryMatcher(state, 'category:rent')('fun'), false);
});

test('isValidFilter', () => {
  for (const ok of ['', 'none', 'kind:spend', 'kind:ignore', 'type:oneoff', 'category:rent']) assert.equal(isValidFilter(state, ok), true, ok);
  for (const bad of ['kind:', 'kind:food', 'type:weekly', 'category:gone', 'category:', 'category', 'bogus', 'None', 'kind:spend:x', 'type:']) {
    assert.equal(isValidFilter(state, bad), false, bad);
  }
});
