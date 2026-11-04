import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../../src/changes.js';
import { countedTransactions, progress, cardQueue, monthlyFigure } from '../../src/progress.js';
import tuning from '../../src/tuning.js';

let n = 0;
const txn = (bucketId, amountMinor, date = '2026-09-10', extra = {}) => ({
  id: `t${++n}`, fingerprint: `fp${n}`, accountId: 'a1', batchId: 'b1', date, amountMinor,
  currency: 'GBP', rawText: bucketId.toUpperCase(), bucketId, ...extra,
});
const bucket = (id, categoryId) => ({ id, keys: [id.toUpperCase()], displayName: id.toUpperCase(), exampleRawTexts: [], ...(categoryId ? { categoryId } : {}) });

/**
 * Account a1 with batches covering Sep and Oct 2026 in full, so those are the window months.
 * Buckets: salary (+250000), tesco (-6000 and -4000), cafe (-350, categorised), xfer (-20000, a
 * confirmed transfer with its other side in savings), old (-99999 in Aug 2026, outside the window).
 */
function build() {
  const s = emptyState();
  s.accounts = [
    { id: 'a1', name: 'Current', currency: 'GBP', kind: 'bank', repaymentBucketIds: [] },
    { id: 'a2', name: 'Savings', currency: 'GBP', kind: 'bank', repaymentBucketIds: [] },
  ];
  s.batches = ['a1', 'a2'].map((accountId) => ({
    id: `b-${accountId}`, importId: 'i1', accountId, fileName: `${accountId}.csv`, fileHash: accountId,
    importedAt: '2026-11-01T00:00:00Z', rowCount: 1, coversFrom: '2026-09-01', coversTo: '2026-10-31',
  }));
  s.categories = [
    { id: 'groceries', name: 'Groceries', kind: 'spend', budgetType: 'variable', position: 0 },
    { id: 'eating', name: 'Eating out', kind: 'spend', budgetType: 'variable', position: 1 },
  ];
  s.buckets = [bucket('salary'), bucket('tesco'), bucket('cafe', 'eating'), bucket('xfer'), bucket('savings'), bucket('old')];
  s.transactions = [
    txn('salary', 250000, '2026-09-25'),
    txn('tesco', -6000, '2026-09-12'),
    txn('tesco', -4000, '2026-10-12'),
    txn('cafe', -350, '2026-10-01'),
    txn('xfer', -20000, '2026-10-26'),
    { ...txn('savings', 20000, '2026-10-27'), accountId: 'a2' },
    txn('old', -99999, '2026-08-15'),
  ];
  const xa = s.transactions.find((t) => t.bucketId === 'xfer');
  const xb = s.transactions.find((t) => t.bucketId === 'savings');
  s.transferPairs.set('p1', { key: 'p1', fingerprintA: xa.fingerprint, fingerprintB: xb.fingerprint, status: 'confirmed' });
  return s;
}

const ids = (buckets) => buckets.map((b) => b.id);

test('countedTransactions keeps only months the account covers in the window', () => {
  const s = build();
  const counted = countedTransactions(s, tuning);
  assert.equal(counted.length, s.transactions.length - 1);
  assert.ok(!counted.some((t) => t.bucketId === 'old'));
});

test('queue is ordered by absolute total, so a salary credit comes before a smaller debit', () => {
  assert.deepEqual(ids(cardQueue(build(), tuning, new Set())), ['salary', 'tesco']);
});

test('confirmed transfers are not counted in progress or the queue', () => {
  const s = build();
  assert.deepEqual(progress(s, tuning), { categorisedAbs: 350, totalAbs: 250000 + 10000 + 350, bucketsLeft: 2 });
  assert.ok(!ids(cardQueue(s, tuning, new Set())).includes('xfer'));
  s.transferPairs.get('p1').status = 'rejected';
  assert.equal(progress(s, tuning).totalAbs, 250000 + 10000 + 350 + 20000 + 20000);
  // Equal totals fall back to name order: SAVINGS before XFER.
  assert.deepEqual(ids(cardQueue(s, tuning, new Set())), ['salary', 'savings', 'xfer', 'tesco']);
});

test('parts with a category of any kind count as categorised', () => {
  const s = build();
  s.categories.push({ id: 'ign', name: 'Ignore', kind: 'ignore', position: 2 });
  s.buckets.find((b) => b.id === 'salary').categoryId = 'ign';
  const tesco = s.transactions.filter((t) => t.bucketId === 'tesco');
  s.overrides.set(tesco[0].fingerprint, { fingerprint: tesco[0].fingerprint, splits: [
    { amountMinor: -5000, categoryId: 'groceries' }, { amountMinor: -1000, categoryId: 'gone' },
  ] });
  assert.deepEqual(progress(s, tuning), { categorisedAbs: 250000 + 5000 + 350, totalAbs: 260350, bucketsLeft: 1 });
});

test('a bucket whose category no longer exists is uncategorised', () => {
  const s = build();
  s.buckets.find((b) => b.id === 'cafe').categoryId = 'gone';
  assert.deepEqual(ids(cardQueue(s, tuning, new Set())), ['salary', 'tesco', 'cafe']);
});

test('a categorised bucket with a flagged row is in the queue', () => {
  const s = build();
  const cafe = s.transactions.find((t) => t.bucketId === 'cafe');
  cafe.flaggedRuleId = 'r1';
  assert.deepEqual(ids(cardQueue(s, tuning, new Set())), ['salary', 'tesco', 'cafe']);
  assert.equal(progress(s, tuning).bucketsLeft, 3);
});

test('a flagged row outside the window still puts its bucket in the queue, last', () => {
  const s = build();
  s.buckets.find((b) => b.id === 'old').categoryId = 'groceries';
  s.transactions.find((t) => t.bucketId === 'old').flaggedRuleId = 'r1';
  assert.deepEqual(ids(cardQueue(s, tuning, new Set())), ['salary', 'tesco', 'old']);
});

test('uncategorised buckets with nothing counted are left out', () => {
  const s = build();
  assert.ok(!ids(cardQueue(s, tuning, new Set())).includes('old'));
});

test('skipped buckets are left out of the queue but still count as left', () => {
  const s = build();
  assert.deepEqual(ids(cardQueue(s, tuning, new Set(['salary']))), ['tesco']);
  assert.equal(progress(s, tuning).bucketsLeft, 2);
});

test('empty state', () => {
  const s = emptyState();
  assert.deepEqual(countedTransactions(s, tuning), []);
  assert.deepEqual(progress(s, tuning), { categorisedAbs: 0, totalAbs: 0, bucketsLeft: 0 });
  assert.deepEqual(cardQueue(s, tuning, new Set()), []);
});

test('monthlyFigure divides each account by its own month count (D1) and sums', () => {
  const t = (accountId, amountMinor) => ({ ...txn('x', amountMinor), accountId });
  const accountMonths = new Map([['a1', new Set(['2026-09', '2026-10'])], ['a2', new Set(['2026-10'])], ['a3', new Set()]]);
  // a1: 3000 over 2 months = 1500. a2: 1001 over 1 month = 1001.
  assert.deepEqual(monthlyFigure({ absTotal: 4001, txns: [t('a1', -1000), t('a1', -2000), t('a2', 1001)] }, accountMonths),
    { perMonth: 2501, months: null });
  // One account: its month count is shared, so it is given.
  assert.deepEqual(monthlyFigure({ absTotal: 3001, txns: [t('a1', -1000), t('a1', -2001)] }, accountMonths),
    { perMonth: 1501, months: 2 });
  // An account counting no months contributes nothing.
  assert.deepEqual(monthlyFigure({ absTotal: 1500, txns: [t('a3', -500), t('a2', -1000)] }, accountMonths),
    { perMonth: 1000, months: null });
  assert.deepEqual(monthlyFigure({ absTotal: 500, txns: [t('a3', -500)] }, accountMonths), { perMonth: 0, months: 0 });
});

test('equal totals fall back to name order ignoring case, as the Buckets screen orders names', () => {
  const s = build();
  s.buckets.push(bucket('lower'), bucket('upper'));
  s.buckets.find((b) => b.id === 'lower').displayName = 'apple stall';
  s.buckets.find((b) => b.id === 'upper').displayName = 'BAKERY';
  s.transactions.push(txn('lower', -700, '2026-10-02'), txn('upper', -700, '2026-10-03'));
  // Code-unit order would put BAKERY before apple stall.
  assert.deepEqual(ids(cardQueue(s, tuning, new Set())).slice(-2), ['lower', 'upper']);
});
