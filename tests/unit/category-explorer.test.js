import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryText, outAndIn } from '../../src/ui/category-explorer.js';

/** A plain money formatter: minor units as "N.NN". */
const m = (/** @type {number} */ minor) => (minor / 100).toFixed(2);
const base = /** @type {any} */ ({ currency: 'GBP', count: 23, out: 148210, in: 131000, from: '2025-11', to: '2026-10', buckets: Array(9).fill({}) });

test('summaryText: kind, counts, out and in, and the months', () => {
  assert.equal(summaryText(base, /** @type {any} */ ({ kind: 'ignore' }), m),
    'Ignore · 23 transactions in 9 buckets, 1482.10 out and 1310.00 in, Nov 2025 to Oct 2026.');
});

test('summaryText: a budget type follows the kind, an empty side is left out, one month is named once', () => {
  assert.equal(summaryText({ ...base, count: 1, in: 0, out: 240000, from: '2026-01', to: '2026-01', buckets: [{}] },
    /** @type {any} */ ({ kind: 'spend', budgetType: 'oneoff' }), m),
  'Spend · One-off · 1 transaction in 1 bucket, 2400.00 out, Jan 2026.');
  assert.equal(summaryText({ ...base, out: 0 }, /** @type {any} */ ({ kind: 'income', budgetType: 'fixed' }), m),
    'Income · Fixed · 23 transactions in 9 buckets, 1310.00 in, Nov 2025 to Oct 2026.');
});

test('summaryText: a budget type left on a kind without one is not shown', () => {
  assert.equal(summaryText(base, /** @type {any} */ ({ kind: 'transfer', budgetType: 'variable' }), m),
    'Transfer · 23 transactions in 9 buckets, 1482.10 out and 1310.00 in, Nov 2025 to Oct 2026.');
});

test('outAndIn: out and in, and nothing when both are zero', () => {
  assert.equal(outAndIn({ out: 500, in: 0 }, (n) => `£${(n / 100).toFixed(2)}`), '£5.00 out');
  assert.equal(outAndIn({ out: 0, in: 0 }, m), '');
});
