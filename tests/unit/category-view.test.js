import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explanation } from '../../src/ui/category-view.js';

/** A plain money formatter: minor units as "N.NN". */
const m = (minor) => (minor / 100).toFixed(2);

/** One account's cells: `n` covered months, then `gaps` not covered. */
const series = (accountId, n, gaps = 0) => ({
  accountId, share: 0,
  cells: [...Array.from({ length: n }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, total: 1000 })),
    ...Array.from({ length: gaps }, () => ({ month: '2025-01', total: null }))],
});

const detail = (row, accounts) => ({
  row: { categoryId: 'c', name: 'Cat', ...row }, currency: 'GBP', months: [], accounts, buckets: [], transactionIds: new Set(), partMinor: new Map(),
});

test('several accounts: Fixed, Annual and Variable wordings', () => {
  const two = [series('a', 12), series('b', 3, 9)];
  assert.equal(explanation(detail({ budgetType: 'fixed', perMonth: 8997 }, two), 'spend', m),
    "Spending · Fixed · 89.97 a month: each charge's latest amount, as often as it was charged in its account's months.");
  assert.equal(explanation(detail({ budgetType: 'annual', perYear: 120000, perMonth: 10000 }, two), 'spend', m),
    "Spending · Annual · 1200.00 a year: each account's yearly total, scaled to 12 months and added together, so 100.00 a month.");
  assert.equal(explanation(detail({ budgetType: 'variable', perMonth: 73784, range: [65014, 89840] }, two), 'spend', m),
    "Spending · Variable · 737.84 a month: each account's median month, added together. Typical range 650.14 to 898.40.");
});

test('one account: Fixed and Variable count only covered months', () => {
  const one = [series('a', 3, 2)];
  assert.equal(explanation(detail({ budgetType: 'fixed', perMonth: 250000 }, one), 'income', m),
    "Income · Fixed · 2500.00 a month: each charge's latest amount, as often as it was charged in these 3 months.");
  assert.equal(explanation(detail({ budgetType: 'variable', perMonth: 5000, range: [4000, 6000] }, one), 'contribution', m),
    'Contribution · Variable · 50.00 a month, the median of these 3 months. Typical range 40.00 to 60.00.');
});

test('one account: Annual says it is scaled only when there are fewer than 12 months', () => {
  assert.equal(explanation(detail({ budgetType: 'annual', perYear: 24000, perMonth: 2000 }, [series('a', 6, 6)]), 'spend', m),
    'Spending · Annual · 240.00 a year over these 6 months, so 20.00 a month. Yearly figures are scaled to 12 months.');
  assert.equal(explanation(detail({ budgetType: 'annual', perYear: 24000, perMonth: 2000 }, [series('a', 12)]), 'spend', m),
    'Spending · Annual · 240.00 a year over these 12 months, so 20.00 a month.');
});

test('a missing range reads as zero to zero', () => {
  assert.equal(explanation(detail({ budgetType: 'variable', perMonth: 0 }, [series('a', 2)]), 'spend', m),
    'Spending · Variable · 0.00 a month, the median of these 2 months. Typical range 0.00 to 0.00.');
});
