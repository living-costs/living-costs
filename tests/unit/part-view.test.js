import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partSummaryText, PART_HEADINGS } from '../../src/ui/part-view.js';

/** A plain money formatter: minor units as "£N,NNN.NN". */
const m = (/** @type {number} */ minor) => `£${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;
const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const buckets = [{ bucketId: 'a' }, { bucketId: 'b' }, { bucketId: 'c' }];
const base = /** @type {any} */ ({ count: 45, buckets, out: 1123640, in: 20000, months });
const tail = 'That is £919.70 a month on Typical month: each account\'s net out over its own months, added together.';

test('PART_HEADINGS names the three parts', () => {
  assert.deepEqual(PART_HEADINGS, { oneOffs: 'One-offs', uncategorised: 'Uncategorised', ignored: 'Ignored' });
});

test('partSummaryText names the group, counts, out and in, the window and the figure', () => {
  assert.equal(partSummaryText('ignored', base, 91970, m),
    `Ignore categories · 45 transactions in 3 buckets, £11,236.40 out and £200.00 in, Nov 2025 to Oct 2026. ${tail}`);
});

test('partSummaryText leads with One-off categories or Uncategorised', () => {
  assert.ok(partSummaryText('oneOffs', base, 91970, m).startsWith('One-off categories · 45 transactions'));
  assert.ok(partSummaryText('uncategorised', base, 91970, m).startsWith('Uncategorised · 45 transactions'));
});

test('partSummaryText names a one-month window once, and one transaction in one bucket', () => {
  const one = { ...base, count: 1, in: 0, out: 240000, months: ['2026-01'], buckets: [{ bucketId: 'a' }] };
  assert.equal(partSummaryText('oneOffs', one, 91970, m),
    `One-off categories · 1 transaction in 1 bucket, £2,400.00 out, Jan 2026. ${tail}`);
});

test('partSummaryText counts distinct buckets: rows repeating a bucket across categories count once', () => {
  const rows = { ...base, buckets: [{ bucketId: 'a' }, { bucketId: 'a' }, { bucketId: 'b' }] };
  assert.ok(partSummaryText('ignored', rows, 91970, m).includes('in 2 buckets,'));
});
