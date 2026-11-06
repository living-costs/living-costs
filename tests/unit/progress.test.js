import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../../src/changes.js';
import { countedTransactions, progress, categorisedPercent, cardQueue, monthlyFigure, bucketMonths, bucketCounts } from '../../src/progress.js';
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

test('categorisedPercent is by value, rounded down, and null when it would mislead', () => {
  const s = build();
  // 350 of 260350 is 0.13%.
  assert.equal(categorisedPercent(s, tuning), 0);
  s.buckets.find((b) => b.id === 'salary').categoryId = 'eating';
  // 250350 of 260350 is 96.2%.
  assert.equal(categorisedPercent(s, tuning), 96);
  s.buckets.find((b) => b.id === 'tesco').categoryId = 'groceries';
  assert.equal(categorisedPercent(s, tuning), 100);
  s.transactions.find((t) => t.bucketId === 'cafe').currency = 'EUR';
  assert.equal(categorisedPercent(s, tuning), null);
  assert.equal(categorisedPercent(emptyState(), tuning), null);
});

/**
 * Bucket shop: Current covers Aug to Oct 2026; Card covers Oct 2026 only (its batch starts on
 * 1 Oct). Window months are Aug, Sep and Oct. Shop has -1000 in Aug and Sep, -1000 and -9000 in
 * Oct, all in Current, and -500 in Oct on Card.
 */
function shopState() {
  const s = emptyState();
  s.accounts = [
    { id: 'a1', name: 'Current', currency: 'GBP', kind: 'bank', repaymentBucketIds: [] },
    { id: 'c1', name: 'Card', currency: 'GBP', kind: 'card', repaymentBucketIds: [] },
    { id: 'a2', name: 'Savings', currency: 'GBP', kind: 'bank', repaymentBucketIds: [] },
  ];
  const batch = (accountId, coversFrom) => ({
    id: `b-${accountId}`, importId: 'i1', accountId, fileName: `${accountId}.csv`, fileHash: accountId,
    importedAt: '2026-11-01T00:00:00Z', rowCount: 1, coversFrom, coversTo: '2026-10-31',
  });
  s.batches = [batch('a1', '2026-08-01'), batch('c1', '2026-10-01'), batch('a2', '2026-08-01')];
  s.categories = [{ id: 'groceries', name: 'Groceries', kind: 'spend', budgetType: 'variable', position: 0 }];
  s.buckets = [bucket('shop'), bucket('other')];
  s.transactions = [
    txn('shop', -1000, '2026-08-05'),
    txn('shop', -1000, '2026-09-05'),
    txn('shop', -1000, '2026-10-05'),
    txn('shop', -9000, '2026-10-20'),
    { ...txn('shop', -500, '2026-10-07'), accountId: 'c1' },
    { ...txn('other', -100, '2026-10-07'), accountId: 'a2' },
  ];
  return s;
}

const shopCount = (s) => bucketCounts(s, tuning).get('shop');

test('bucketMonths: one series per account in the bucket, absolute totals, uncovered months null', () => {
  const s = shopState();
  const { months, kept, accounts } = bucketMonths(s, tuning, shopCount(s));
  assert.deepEqual(months, ['2026-08', '2026-09', '2026-10']);
  assert.equal(kept?.absTotal, 12500);
  assert.equal(kept?.txns.length, 5);
  // Savings has nothing in the bucket, so it has no series.
  assert.deepEqual(accounts.map((a) => a.accountId), ['a1', 'c1']);
  assert.deepEqual(accounts[0].cells.map((c) => c.total), [1000, 1000, 10000]);
  assert.deepEqual(accounts[1].cells.map((c) => c.total), [null, null, 500]);
});

test('bucketMonths: a month far from the median is unusual, as on the category view', () => {
  const s = shopState();
  const { accounts } = bucketMonths(s, tuning, shopCount(s));
  assert.deepEqual(accounts[0].cells.map((c) => c.unusual), [false, false, true]);
  // An uncovered month is never unusual; one covered month is its own median.
  assert.deepEqual(accounts[1].cells.map((c) => c.unusual), [false, false, false]);
});

test('bucketMonths: a transaction moved by override or split no longer counts, but its account keeps a series', () => {
  const s = shopState();
  const big = s.transactions.find((t) => t.amountMinor === -9000);
  s.overrides.set(big.fingerprint, { fingerprint: big.fingerprint, categoryId: 'groceries' });
  const card = s.transactions.find((t) => t.accountId === 'c1');
  s.overrides.set(card.fingerprint, { fingerprint: card.fingerprint, splits: [{ amountMinor: -500, categoryId: 'groceries' }] });
  const { kept, accounts } = bucketMonths(s, tuning, shopCount(s));
  assert.equal(kept?.absTotal, 3000);
  assert.equal(kept?.txns.length, 3);
  assert.deepEqual(accounts[0].cells.map((c) => c.total), [1000, 1000, 1000]);
  assert.deepEqual(accounts[0].cells.map((c) => c.unusual), [false, false, false]);
  assert.deepEqual(accounts[1].cells.map((c) => c.total), [null, null, 0]);
  // The queue still orders by the whole bucket.
  assert.equal(shopCount(s)?.absTotal, 12500);
});

test('bucketMonths: an override to a category that no longer exists does not move it; all moved leaves nothing kept', () => {
  const s = shopState();
  const first = s.transactions[0];
  s.overrides.set(first.fingerprint, { fingerprint: first.fingerprint, categoryId: 'gone' });
  assert.equal(bucketMonths(s, tuning, shopCount(s)).kept?.txns.length, 5);
  for (const t of s.transactions.filter((x) => x.bucketId === 'shop')) {
    s.overrides.set(t.fingerprint, { fingerprint: t.fingerprint, categoryId: 'groceries' });
  }
  const { kept, accounts } = bucketMonths(s, tuning, shopCount(s));
  assert.equal(kept, undefined);
  assert.equal(accounts.length, 2);
});
