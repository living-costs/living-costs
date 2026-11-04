import { test } from 'node:test';
import assert from 'node:assert/strict';
import tuning from '../../src/tuning.js';
import { bucketWords, relatedBuckets, unusualTransactions, repeatingAmounts } from '../../src/insights.js';

let n = 0;
const txn = (date, amountMinor, extra = {}) => ({
  id: `t${++n}`, fingerprint: `fp${n}`, accountId: 'a1', batchId: 'b1', date, amountMinor, currency: 'GBP', rawText: 'X', bucketId: 'b', ...extra,
});
const bucket = (id, displayName, keys = [displayName]) => ({ id, displayName, keys, exampleRawTexts: [] });

test('bucketWords: upper-cases, drops short and stop words, uses all keys', () => {
  const b = bucket('1', 'tesco express', ['TESCO EXPRESS', 'TESCO STORES 12']);
  assert.deepEqual([...bucketWords(b, tuning)].sort(), ['EXPRESS', 'TESCO']);
  assert.deepEqual([...bucketWords(bucket('2', 'THE CO-OP'), tuning)], []);
});

test('TESCO STORES and TESCO EXPRESS are related; THE CO-OP and THE BAKERY are not', () => {
  const a = bucket('a', 'TESCO STORES');
  const b = bucket('b', 'TESCO EXPRESS');
  const c = bucket('c', 'THE CO-OP');
  const d = bucket('d', 'THE BAKERY');
  assert.deepEqual(relatedBuckets(a, [a, b, c, d], new Map(), tuning).map((x) => x.id), ['b']);
  assert.deepEqual(relatedBuckets(c, [a, b, c, d], new Map(), tuning), []);
});

test('AMAZON.CO.UK and AMZNMKTPLACE share no word', () => {
  const a = bucket('a', 'AMAZON.CO.UK');
  const b = bucket('b', 'AMZNMKTPLACE');
  assert.deepEqual(relatedBuckets(a, [a, b], new Map(), tuning), []);
});

test('related ranking: shared count, then absolute total, then name; limited', () => {
  const me = bucket('me', 'ALPHA BETA GAMMA');
  const two = bucket('two', 'ALPHA BETA');
  const bigOne = bucket('big', 'ZULU ALPHA');
  const smallOne = bucket('small', 'ALPHA YANKEE');
  const tieA = bucket('ta', 'ALPHA AAA');
  const tieB = bucket('tb', 'ALPHA BBB');
  const totals = new Map([['big', 900], ['small', 10]]);
  const all = [me, smallOne, tieB, tieA, bigOne, two];
  const r = relatedBuckets(me, all, totals, tuning).map((x) => x.id);
  assert.deepEqual(r, ['two', 'big', 'small']);
  assert.equal(r.length, tuning.relatedMaxShown);
  const r2 = relatedBuckets(me, [me, tieB, tieA], new Map(), tuning).map((x) => x.id);
  assert.deepEqual(r2, ['ta', 'tb']);
});

test('unusual: only the -65000 row among groceries', () => {
  const rows = [-4000, -5000, -6000, -7000, -8000, -9000, -65000].map((a, i) => txn(`2026-0${i + 1}-05`, a));
  const out = unusualTransactions(rows, new Map(), tuning);
  assert.deepEqual(out.map((t) => t.amountMinor), [-65000]);
});

test('unusual: median 2000, -11000 flagged, -9000 not (under 100 major)', () => {
  const base = [-2000, -2000, -2000, -2000].map((a, i) => txn(`2026-01-0${i + 1}`, a));
  const hi = txn('2026-02-01', -11000);
  const lo = txn('2026-02-02', -9000);
  const out = unusualTransactions([...base, hi, lo], new Map(), tuning);
  assert.deepEqual(out, [hi]);
});

test('unusual: strict multiple, and currency exponent respected', () => {
  const rows = [txn('2026-01-01', -2000), txn('2026-01-02', -2000), txn('2026-01-03', -2000), txn('2026-01-04', -10000)];
  assert.deepEqual(unusualTransactions(rows, new Map(), tuning), []); // exactly 5x
  const jpy = [100, 100, 100, 20000].map((a, i) => txn(`2026-01-0${i + 1}`, a, { currency: 'JPY' }));
  assert.equal(unusualTransactions(jpy, new Map(), tuning).length, 1); // 20000 >= 100 * 10^0
  const jpyLow = [10, 10, 10, 90].map((a, i) => txn(`2026-01-0${i + 1}`, a, { currency: 'JPY' }));
  assert.equal(unusualTransactions(jpyLow, new Map(), tuning).length, 0);
});

test('unusual: dismissed, categorised and split rows are excluded', () => {
  const base = [-2000, -2000, -2000, -2000, -2000, -2000, -2000].map((a, i) => txn(`2026-01-0${i + 1}`, a));
  const d = txn('2026-02-01', -50000);
  const c = txn('2026-02-02', -50000);
  const s = txn('2026-02-03', -50000);
  const keep = txn('2026-02-04', -50000);
  const ov = new Map([
    [d.fingerprint, { fingerprint: d.fingerprint, unusualDismissed: true }],
    [c.fingerprint, { fingerprint: c.fingerprint, categoryId: 'x' }],
    [s.fingerprint, { fingerprint: s.fingerprint, splits: [{ amountMinor: -50000, categoryId: 'x' }] }],
  ]);
  assert.deepEqual(unusualTransactions([...base, d, c, s, keep], ov, tuning), [keep]);
});

test('unusual: empty input gives []', () => {
  assert.deepEqual(unusualTransactions([], new Map(), tuning), []);
});

function paypal() {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const y = i < 2 ? 2025 : 2026;
    const m = ((10 + i) % 12) + 1;
    const mm = String(m).padStart(2, '0');
    rows.push(txn(`${y}-${mm}-08`, -299));
    rows.push(txn(`${y}-${mm}-15`, -999));
  }
  rows.push(txn('2026-10-20', -299));
  return rows;
}

test('PAYPAL PAYMENT: two monthly entries, -299 count 13', () => {
  const out = repeatingAmounts(paypal(), tuning);
  assert.deepEqual(out, [
    { amountMinor: -299, count: 13, period: 'month', expectedCount: 1 },
    { amountMinor: -999, count: 12, period: 'month', expectedCount: 1 },
  ]);
});

test('repeating: one distinct amount gives []', () => {
  const rows = [1, 2, 3, 4].map((i) => txn(`2026-0${i}-08`, -299));
  assert.deepEqual(repeatingAmounts(rows, tuning), []);
});

test('repeating: weekly, yearly, irregular and too-few', () => {
  const weekly = [1, 8, 15, 22].map((d) => txn(`2026-03-${String(d).padStart(2, '0')}`, -500));
  const yearly = ['2023-06-01', '2024-06-01', '2025-06-01'].map((d) => txn(d, -12000));
  const irregular = ['2026-01-01', '2026-01-03', '2026-04-20', '2026-05-01'].map((d) => txn(d, -777));
  const few = ['2026-01-01', '2026-02-01'].map((d) => txn(d, -111));
  const out = repeatingAmounts([...weekly, ...yearly, ...irregular, ...few], tuning);
  assert.deepEqual(out, [
    { amountMinor: -500, count: 4, period: 'week', expectedCount: 1 },
    { amountMinor: -12000, count: 3, period: 'year', expectedCount: 1 },
  ]);
});

test('repeating: median gap in band but under 80% of gaps in band is skipped', () => {
  // gaps: 30, 30, 2, 2, 30 -> median 30 (band month), 3/5 in band
  const ds = ['2026-01-01', '2026-01-31', '2026-03-02', '2026-03-04', '2026-03-06', '2026-04-05'];
  const rows = [...ds.map((d) => txn(d, -400)), txn('2026-01-02', -401)];
  assert.deepEqual(repeatingAmounts(rows, tuning), []);
});

test('related buckets with equal scores are in name order ignoring case', () => {
  const me = bucket('m', 'FARM SHOP');
  const upper = bucket('u', 'FARM ZONE');
  const lower = bucket('l', 'farm apples');
  assert.deepEqual(relatedBuckets(me, [me, upper, lower], new Map(), tuning).map((x) => x.id), ['l', 'u']);
});
