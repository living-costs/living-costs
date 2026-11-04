import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTransactions } from '../../src/search.js';

let n = 0;
const t = (date, amountMinor, rawText, bucketId = 'b1', currency = 'GBP') => ({
  id: 't' + ++n, fingerprint: 'f' + n, accountId: 'a', batchId: 'b', date, amountMinor, currency, rawText, bucketId,
});
const opts = { matchDays: 3 };
const ids = (r) => r.map((x) => x.id);

const amazon = t('2026-09-24', -6069, 'AMAZON MKTP UK');
const tescoA = t('2026-09-10', -1250, 'TESCO STORES 1234');
const tescoB = t('2026-10-02', -800, 'Tesco Express', 'b2');
const d21 = t('2026-09-21', -100, 'D21');
const d22 = t('2026-09-22', -100, 'D22');
const d23 = t('2026-09-23', -100, 'D23');
const d25 = t('2026-09-25', -100, 'D25');
const d27 = t('2026-09-27', -100, 'D27');
const d28 = t('2026-09-28', -100, 'D28');
const all = [tescoA, d28, d21, d27, amazon, d22, d25, d23, tescoB];

test('amount queries find -6069 with or without pound sign', () => {
  assert.deepEqual(ids(searchTransactions(all, '60.69', {}, opts)), [amazon.id]);
  assert.deepEqual(ids(searchTransactions(all, '£60.69', {}, opts)), [amazon.id]);
});

test('text query is case-insensitive substring, newest first', () => {
  assert.deepEqual(ids(searchTransactions(all, ' tesco ', {}, opts)), [tescoB.id, tescoA.id]);
});

test('empty query returns filtered rows newest first', () => {
  const r = searchTransactions(all, '   ', { from: '2026-09-22', to: '2026-09-25' }, opts);
  assert.deepEqual(ids(r), [d25.id, amazon.id, d23.id, d22.id]);
});

test('DD/MM finds 21 to 27 Sept nearest first, ties newer first', () => {
  const r = searchTransactions(all, '24/09', {}, opts);
  assert.deepEqual(ids(r), [amazon.id, d25.id, d23.id, d22.id, d27.id, d21.id]);
});

test('date matches precede text/amount-only matches', () => {
  const odd = t('2026-01-01', -2409, 'REF 24/09 THING');
  const r = searchTransactions([odd, ...all], '24/09', {}, opts);
  assert.equal(r.at(-1).id, odd.id);
  assert.equal(r[0].id, amazon.id);
});

test('DD/MM/YYYY is exact-year', () => {
  const dec = t('2025-09-24', -1, 'LAST YEAR');
  const r = searchTransactions([dec, ...all], '24/09/2026', {}, opts);
  assert.ok(!ids(r).includes(dec.id));
  assert.equal(r[0].id, amazon.id);
});

test('31/12 matches early January of the next year', () => {
  const a = t('2027-01-02', -1, 'A');
  const b = t('2026-12-30', -1, 'B');
  const c = t('2026-12-20', -1, 'C');
  assert.deepEqual(ids(searchTransactions([c, a, b], '31/12', {}, opts)), [b.id, a.id]);
});

test('01/01 matches late December of the previous year', () => {
  const a = t('2026-12-30', -1, 'A');
  assert.deepEqual(ids(searchTransactions([a], '01/01', {}, opts)), [a.id]);
});

test('invalid date is not a date query', () => {
  const r = searchTransactions(all, '31/02', {}, opts);
  assert.deepEqual(r, []);
});

test('bucketId and from/to filters narrow results', () => {
  assert.deepEqual(ids(searchTransactions(all, 'tesco', { bucketId: 'b2' }, opts)), [tescoB.id]);
  assert.deepEqual(ids(searchTransactions(all, 'tesco', { from: '2026-09-01', to: '2026-09-30' }, opts)), [tescoA.id]);
  assert.deepEqual(ids(searchTransactions(all, '', { from: '2026-10-02', to: '2026-10-02' }, opts)), [tescoB.id]);
});

test('amount uses the transaction currency exponent', () => {
  const jpy = t('2026-09-01', -500, 'JPY SHOP', 'b1', 'JPY');
  assert.deepEqual(ids(searchTransactions([jpy], '500', {}, opts)), [jpy.id]);
});
