import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIncoming } from '../../src/dedupe.js';
import { withFingerprints } from '../../src/fingerprint.js';

const row = (rowNumber, date, amountMinor, rawText) => ({ rowNumber, date, amountMinor, rawText });
const covered = [{ from: '2026-09-01', to: '2026-09-30' }];
const asExisting = (rows) => withFingerprints('a', rows).map(({ fingerprint, date, amountMinor, rawText }) => ({ fingerprint, date, amountMinor, rawText }));

test('three existing identical rows, four incoming: only n=3 is fresh', () => {
  const cafe = (i) => row(i, '2026-09-10', -350, 'CAFE');
  const existing = asExisting([cafe(1), cafe(2), cafe(3)]);
  const incoming = withFingerprints('a', [cafe(1), cafe(2), cafe(3), cafe(4)]);
  const r = classifyIncoming({ existing, incoming, covered, matchDays: 3 });
  assert.equal(r.already.length, 3);
  assert.deepEqual(r.fresh.map((x) => x.rowNumber), [4]);
  assert.equal(r.review.length, 0);
});

test('different text one day away inside covered goes to review, ranked', () => {
  const existing = asExisting([
    row(1, '2026-09-11', -350, 'SHELL'),
    row(2, '2026-09-12', -350, 'COSTA COFFEE LTD'),
    row(3, '2026-09-11', -350, 'COSTA COFFEE'),
    row(4, '2026-09-11', -400, 'COSTA COFFEE'),
    row(5, '2026-09-20', -350, 'COSTA COFFEE'),
  ]);
  const incoming = withFingerprints('a', [row(1, '2026-09-10', -350, 'COSTA COFFEE')]);
  const r = classifyIncoming({ existing, incoming, covered, matchDays: 3 });
  assert.equal(r.review.length, 1);
  assert.deepEqual(r.review[0].candidates.map((c) => c.rawText), ['COSTA COFFEE', 'COSTA COFFEE LTD', 'SHELL']);
});

test('date distance breaks similarity ties', () => {
  const existing = asExisting([row(1, '2026-09-12', -350, 'X CAFE'), row(2, '2026-09-11', -350, 'X CAFE')]);
  const incoming = withFingerprints('a', [row(1, '2026-09-10', -350, 'Y CAFE')]);
  const r = classifyIncoming({ existing, incoming, covered, matchDays: 3 });
  assert.deepEqual(r.review[0].candidates.map((c) => c.date), ['2026-09-11', '2026-09-12']);
});

test('same text on a nearby different date is a candidate', () => {
  const existing = asExisting([row(1, '2026-09-11', -350, 'CAFE')]);
  const incoming = withFingerprints('a', [row(1, '2026-09-10', -350, 'CAFE')]);
  const r = classifyIncoming({ existing, incoming, covered, matchDays: 3 });
  assert.equal(r.review.length, 1);
});

test('outside covered the same row is fresh (D3); bounds are inclusive', () => {
  const existing = asExisting([row(1, '2026-10-01', -350, 'SHELL')]);
  const incoming = withFingerprints('a', [row(1, '2026-10-02', -350, 'COSTA')]);
  const r = classifyIncoming({ existing, incoming, covered, matchDays: 3 });
  assert.equal(r.fresh.length, 1);
  assert.equal(r.review.length, 0);
  const edge = withFingerprints('a', [row(1, '2026-09-30', -350, 'COSTA')]);
  const e = classifyIncoming({ existing, incoming: edge, covered, matchDays: 3 });
  assert.equal(e.review.length, 1);
});

test('claimed existing rows are never candidates; candidates are not claimed', () => {
  const existing = asExisting([row(1, '2026-09-10', -350, 'CAFE'), row(2, '2026-09-11', -350, 'SHELL')]);
  const incoming = withFingerprints('a', [row(1, '2026-09-10', -350, 'CAFE'), row(2, '2026-09-10', -350, 'COSTA'), row(3, '2026-09-12', -350, 'PRET')]);
  const r = classifyIncoming({ existing, incoming, covered, matchDays: 3 });
  assert.equal(r.already.length, 1);
  assert.equal(r.review.length, 2);
  for (const x of r.review) assert.deepEqual(x.candidates.map((c) => c.rawText), ['SHELL']);
});
