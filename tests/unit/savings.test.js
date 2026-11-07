import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../../src/changes.js';
import { buildContext } from '../../src/resolve.js';
import { savingsContext, accountRowId, ACCOUNT_ROW_PREFIX } from '../../src/savings.js';

const acct = (id, kind = 'bank') => ({ id, name: id, currency: 'GBP', kind, repaymentBucketIds: [] });
const cat = (id, kind) => ({ id, name: id, kind, position: 0 });
const txn = (fingerprint, accountId, amountMinor, bucketId = 'to-s') => ({
  id: 't-' + fingerprint, fingerprint, accountId, batchId: 'b', date: '2026-09-24',
  amountMinor, currency: 'GBP', rawText: 'X', bucketId,
});

function build({ kinds = ['bank', 'savings'], bucketCat, override, status = 'confirmed', second = true } = {}) {
  const s = emptyState();
  s.accounts = [acct('A', kinds[0]), acct('S', kinds[1])];
  s.categories = [cat('sav', 'saving'), cat('between', 'transfer'), cat('food', 'spend')];
  s.buckets = [{ id: 'to-s', keys: ['x'], displayName: 'X', categoryId: bucketCat, exampleRawTexts: [] }];
  s.transactions = [txn('fA', 'A', -5000), ...(second ? [txn('fS', 'S', 5000, 'other')] : [])];
  if (override) s.overrides.set('fA', { fingerprint: 'fA', ...override });
  s.transferPairs.set('p', { key: 'p', fingerprintA: 'fA', fingerprintB: 'fS', status });
  return s;
}
const sides = (s) => [...savingsContext(s, buildContext(s)).sides];

test('a pair bank -> savings counts on the bank side, with no category when its bucket has none', () => {
  assert.deepEqual(sides(build()), [['fA', { savingsAccountId: 'S', categoryId: null }]]);
});

test('the pair counts on the bank side whichever way round it is stored', () => {
  const s = build();
  s.transferPairs.set('p', { key: 'p', fingerprintA: 'fS', fingerprintB: 'fA', status: 'confirmed' });
  assert.deepEqual(sides(s), [['fA', { savingsAccountId: 'S', categoryId: null }]]);
});

test("the bank side keeps its bucket's Saving category, and an override to one", () => {
  assert.equal(sides(build({ bucketCat: 'sav' }))[0][1].categoryId, 'sav');
  assert.equal(sides(build({ bucketCat: 'food', override: { categoryId: 'sav' } }))[0][1].categoryId, 'sav');
});

test('a non-Saving category on the bank side gives null', () => {
  assert.equal(sides(build({ bucketCat: 'between' }))[0][1].categoryId, null);
});

test("a split on the bank side is ignored: the bucket's category decides", () => {
  const splits = [{ amountMinor: -3000, categoryId: 'food' }, { amountMinor: -2000, categoryId: 'between' }];
  assert.equal(sides(build({ bucketCat: 'sav', override: { splits } }))[0][1].categoryId, 'sav');
  assert.equal(sides(build({ bucketCat: 'food', override: { splits } }))[0][1].categoryId, null);
});

test('a card side counts like a bank side', () => {
  assert.deepEqual(sides(build({ kinds: ['card', 'savings'] })), [['fA', { savingsAccountId: 'S', categoryId: null }]]);
});

test('savings <-> savings, bank <-> bank, and rejected pairs give no entry', () => {
  assert.deepEqual(sides(build({ kinds: ['savings', 'savings'] })), []);
  assert.deepEqual(sides(build({ kinds: ['bank', 'bank'] })), []);
  assert.deepEqual(sides(build({ status: 'rejected' })), []);
});

test('a pair whose other transaction is gone gives no entry and does not throw', () => {
  assert.deepEqual(sides(build({ second: false })), []);
});

test('savingsAccounts lists the Savings accounts; accountRowId is account:<id>', () => {
  const s = build();
  assert.deepEqual([...savingsContext(s, buildContext(s)).savingsAccounts], ['S']);
  assert.equal(accountRowId('S'), 'account:S');
  assert.equal(ACCOUNT_ROW_PREFIX, 'account:');
});
