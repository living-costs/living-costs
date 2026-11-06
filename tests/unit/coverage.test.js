import { test } from 'node:test';
import assert from 'node:assert/strict';
import tuning from '../../src/tuning.js';
import { emptyState, applyToState } from '../../src/changes.js';
import {
  coverageIntervals, monthStatus, accountsByMonth, completeMonths, analysisWindow, staleAccounts,
} from '../../src/coverage.js';


let seq = 0;
/** @param {string} id @param {'bank'|'card'|'placeholder'} [kind] */
const acct = (id, kind = 'bank') => ({ id, name: id, currency: 'GBP', kind, repaymentBucketIds: [] });
/** @param {string} accountId @param {string} from @param {string} to */
const batch = (accountId, from, to) => ({
  id: `b${++seq}`, importId: `i${seq}`, accountId, fileName: 'x.csv', fileHash: `h${seq}`,
  importedAt: '2026-11-04T00:00:00Z', rowCount: 1, coversFrom: from, coversTo: to,
});
/** @param {string} accountId @param {string} date */
const txn = (accountId, date) => ({
  id: `t${++seq}`, fingerprint: `f${seq}`, accountId, batchId: 'b', date, amountMinor: -100,
  currency: 'GBP', rawText: 'X', bucketId: 'k',
});
/** @param {object[]} accounts @param {object[]} batches @param {object[]} [transactions] */
function build(accounts, batches, transactions = []) {
  const s = emptyState();
  applyToState(s, { put: { accounts, batches, transactions } });
  return s;
}

test('batches 1-31 Oct and 3-30 Nov merge with gap 3, not with gap 1', () => {
  const bs = [batch('A', '2026-10-01', '2026-10-31'), batch('A', '2026-11-03', '2026-11-30')];
  assert.deepEqual(coverageIntervals(bs, 3), [{ from: '2026-10-01', to: '2026-11-30' }]);
  assert.deepEqual(coverageIntervals(bs, 1), [
    { from: '2026-10-01', to: '2026-10-31' }, { from: '2026-11-03', to: '2026-11-30' },
  ]);
});

test('gap of 5 merges a 5-day gap, gap 4 does not; overlaps and contained merge; sorted', () => {
  const far = [batch('A', '2026-11-06', '2026-11-30'), batch('A', '2026-10-01', '2026-10-31')];
  assert.equal(coverageIntervals(far, 5).length, 1);
  assert.equal(coverageIntervals(far, 4).length, 2);
  const nested = [batch('A', '2026-01-01', '2026-06-30'), batch('A', '2026-02-01', '2026-03-01'),
    batch('A', '2026-06-01', '2026-08-01')];
  assert.deepEqual(coverageIntervals(nested, 0), [{ from: '2026-01-01', to: '2026-08-01' }]);
  assert.deepEqual(coverageIntervals([], 3), []);
});

test('monthStatus: covered, partial, missing', () => {
  const iv = [{ from: '2026-10-01', to: '2026-11-15' }];
  assert.equal(monthStatus(iv, '2026-10'), 'covered');
  assert.equal(monthStatus(iv, '2026-11'), 'partial');
  assert.equal(monthStatus(iv, '2026-12'), 'missing');
  assert.equal(monthStatus(iv, '2026-09'), 'missing');
  assert.equal(monthStatus([{ from: '2026-09-20', to: '2026-10-01' }], '2026-10'), 'partial');
});

test('savings batch 2025-11-01..2026-10-31 covers every month', () => {
  const s = build([acct('S', 'bank')], [batch('S', '2025-11-01', '2026-10-31')]);
  const t = accountsByMonth(s, tuning);
  assert.equal(t.months.length, 12);
  assert.ok(t.rows[0].cells.every((c) => c.status === 'covered'));
  assert.equal(completeMonths(s, tuning).length, 12);
  const w = analysisWindow(s, tuning);
  assert.equal(w.complete, true);
  assert.equal(w.months[0], '2025-11');
  assert.equal(w.months[11], '2026-10');
});

test('later-starting bank B does not make earlier months incomplete', () => {
  const s = build([acct('A'), acct('B')], [
    batch('A', '2025-11-01', '2026-10-31'), batch('B', '2026-08-01', '2026-10-31'),
  ]);
  const cm = completeMonths(s, tuning);
  assert.equal(cm.length, 12);
  const w = analysisWindow(s, tuning);
  assert.deepEqual([...(w.accountMonths.get('B') ?? [])].sort(), ['2026-08', '2026-09', '2026-10']);
  assert.equal(w.accountMonths.get('A')?.size, 12);
  assert.deepEqual(staleAccounts(s, w), []);
});

test("one account's gap leaves the month in the window for the others, and out of its own months", () => {
  const s = build([acct('A'), acct('B')], [
    batch('A', '2026-01-01', '2026-12-31'), batch('B', '2026-01-01', '2026-03-15'),
    batch('B', '2026-05-01', '2026-06-30'),
  ]);
  const cm = completeMonths(s, tuning);
  assert.deepEqual(cm, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  const w = analysisWindow(s, tuning);
  // B: Mar partial (Apr not covered, so not bordered), Apr missing.
  assert.deepEqual([...(w.accountMonths.get('B') ?? [])], ['2026-01', '2026-02', '2026-05', '2026-06']);
  assert.equal(w.accountMonths.get('A')?.size, 12);
});

test('a month is complete only when at least one account covers it fully', () => {
  const s = build([acct('A'), acct('B')], [
    batch('A', '2026-01-01', '2026-01-31'), batch('A', '2026-03-01', '2026-03-31'),
    batch('B', '2026-01-01', '2026-02-10'),
  ]);
  // February: A missing, B partial and not bordered (no March).
  assert.deepEqual(completeMonths(s, tuning), ['2026-01', '2026-03']);
});

test('a partial month between two covered months counts as covered for that account', () => {
  // A quiet spell inside March, longer than coverageGapDays.
  const gap = tuning.coverageGapDays + 2;
  const s = build([acct('S'), acct('C')], [
    batch('S', '2026-01-01', '2026-03-05'), batch('S', `2026-03-${String(6 + gap).padStart(2, '0')}`, '2026-05-31'),
    batch('C', '2026-01-01', '2026-05-31'),
  ]);
  const row = accountsByMonth(s, tuning).rows[0];
  assert.equal(row.cells.find((c) => c.month === '2026-03')?.status, 'covered');
  assert.ok(completeMonths(s, tuning).includes('2026-03'));
  assert.ok(analysisWindow(s, tuning).accountMonths.get('S')?.has('2026-03'));
});

test('a missing statement across a month boundary leaves both months partial', () => {
  // Statement 15 Mar to 14 Apr missing: March and April are each bordered by a partial month.
  const s = build([acct('S')], [batch('S', '2026-01-01', '2026-03-14'), batch('S', '2026-04-15', '2026-06-30')]);
  const cells = accountsByMonth(s, tuning).rows[0].cells;
  assert.equal(cells.find((c) => c.month === '2026-03')?.status, 'partial');
  assert.equal(cells.find((c) => c.month === '2026-04')?.status, 'partial');
  assert.ok(!completeMonths(s, tuning).includes('2026-03'));
});

test('first and last months are never bordered', () => {
  const s = build([acct('S')], [batch('S', '2026-01-10', '2026-03-20')]);
  const cells = accountsByMonth(s, tuning).rows[0].cells;
  assert.deepEqual(cells.map((c) => c.status), ['partial', 'covered', 'partial']);
});

test('month after all data is not complete (D2)', () => {
  const s = build([acct('A')], [
    batch('A', '2025-11-01', '2026-10-31'), batch('A', '2026-10-15', '2026-11-02'),
  ]);
  const cm = completeMonths(s, tuning);
  assert.ok(!cm.includes('2026-11'));
  assert.ok(cm.includes('2026-10'));
  assert.equal(accountsByMonth(s, tuning).months.at(-1), '2026-11');
});

test('Review Focus 5: card ends 2026-10-20, bank 2026-10-31', () => {
  const s = build([acct('bank'), acct('card', 'card')], [
    batch('bank', '2025-11-01', '2026-10-31'), batch('card', '2025-11-01', '2026-10-20'),
  ]);
  assert.ok(completeMonths(s, tuning).includes('2026-10'));
  const w = analysisWindow(s, tuning);
  assert.ok(w.months.includes('2026-10'));
  assert.ok(!w.accountMonths.get('card')?.has('2026-10'));
  assert.ok(w.accountMonths.get('card')?.has('2026-09'));
  assert.ok(w.accountMonths.get('bank')?.has('2026-10'));
  assert.deepEqual(staleAccounts(s, w).map((a) => a.id), ['card']);
});

test('placeholder shows not-itemised, never affects completeness, empty accountMonths', () => {
  const s = build([acct('A'), acct('P', 'placeholder')], [batch('A', '2026-09-01', '2026-10-31')],
    [txn('A', '2026-09-05'), txn('A', '2026-09-06')]);
  const t = accountsByMonth(s, tuning);
  assert.deepEqual(t.months, ['2026-09', '2026-10']);
  assert.deepEqual(t.rows.map((r) => r.account.id), ['A', 'P']);
  assert.ok(t.rows[1].cells.every((c) => c.status === 'not-itemised' && c.count === 0));
  assert.deepEqual(t.rows[0].cells.map((c) => c.count), [2, 0]);
  const w = analysisWindow(s, tuning);
  assert.equal(w.accountMonths.get('P')?.size, 0);
  assert.deepEqual(staleAccounts(s, w), []);
});

test('account with no batches: no coverage, empty set, not stale', () => {
  const s = build([acct('A'), acct('N')], [batch('A', '2026-09-01', '2026-10-31')]);
  assert.deepEqual(completeMonths(s, tuning), ['2026-09', '2026-10']);
  const w = analysisWindow(s, tuning);
  assert.equal(w.accountMonths.get('N')?.size, 0);
  assert.deepEqual(staleAccounts(s, w), []);
  const row = accountsByMonth(s, tuning).rows[1];
  assert.ok(row.cells.every((c) => c.status === 'missing'));
});

test('no batches at all: empty table, fallback window uses months with transactions', () => {
  const s = build([acct('A'), acct('B')], [], [txn('A', '2026-03-02'), txn('B', '2026-01-09'), txn('A', '2026-03-20')]);
  assert.deepEqual(accountsByMonth(s, tuning).months, []);
  assert.deepEqual(completeMonths(s, tuning), []);
  const w = analysisWindow(s, tuning);
  assert.equal(w.complete, false);
  assert.deepEqual(w.months, ['2026-01', '2026-03']);
  assert.deepEqual([...(w.accountMonths.get('B') ?? [])], ['2026-01', '2026-03']);
  assert.deepEqual(staleAccounts(s, w), []);
});

test('window is the latest windowMonths complete months; empty window gives no stale', () => {
  const s = build([acct('A')], [batch('A', '2025-01-01', '2026-10-31')]);
  const w = analysisWindow(s, { ...tuning, windowMonths: 3 });
  assert.deepEqual(w.months, ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(staleAccounts(s, { months: [], complete: false, accountMonths: new Map() }), []);
});
