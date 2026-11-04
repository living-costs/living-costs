// Reconciles the typical month against the synthetic fixtures and expected.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import tuning from '../../src/tuning.js';
import { analysisWindow } from '../../src/coverage.js';
import { buildContext, resolve } from '../../src/resolve.js';
import { monthOf, monthRange } from '../../src/dates.js';
import { typicalMonth } from '../../src/typical.js';
import { expected } from './pipeline.js';
import { fixtureState } from './helpers/fixture-state.js';

const state = await fixtureState();
const tm = /** @type {any} */ (typicalMonth(state, tuning));

/** @param {string} name */
function rowNamed(name) {
  const r = [...tm.spend, ...tm.income, ...tm.contribution].find((x) => x.name === name);
  assert.ok(r, `a row for ${name}`);
  return r;
}

/** Plain median of signed values, even counts averaged and rounded half away from zero. */
function plainMedian(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length / 2;
  if (v.length % 2) return v[Math.floor(mid)];
  const sum = v[mid - 1] + v[mid];
  return Math.sign(sum) * Math.round(Math.abs(sum) / 2);
}

test('counted net totals from resolve match expected.monthlyTotals for every category and month', () => {
  const window = analysisWindow(state, tuning);
  const ctx = buildContext(state);
  const names = new Map(state.categories.map((c) => [c.id, c.name]));
  /** @type {Map<string, Map<string, number>>} */
  const got = new Map();
  for (const t of state.transactions) {
    const month = monthOf(t.date);
    if (!window.accountMonths.get(t.accountId)?.has(month)) continue;
    for (const p of resolve(t, ctx).parts) {
      if (!p.categoryId) continue;
      const name = names.get(p.categoryId);
      if (!got.has(name)) got.set(name, new Map());
      const m = got.get(name);
      m.set(month, (m.get(month) ?? 0) + p.amountMinor);
    }
  }
  for (const [name, months] of Object.entries(expected.monthlyTotals)) {
    for (const [month, total] of Object.entries(months)) {
      assert.equal(got.get(name)?.get(month) ?? 0, total, `${name} ${month}`);
    }
  }
  for (const [name, months] of got) {
    const kind = state.categories.find((c) => c.name === name)?.kind;
    if (kind === 'transfer' || kind === 'ignore') continue;
    for (const month of months.keys()) {
      assert.ok(expected.monthlyTotals[name]?.[month] !== undefined, `unexpected ${name} ${month}`);
    }
  }
});

test('the window is Nov 2025 to Oct 2026, complete, one currency, nothing stale', () => {
  assert.equal(tm.mixedCurrencies, undefined);
  assert.equal(tm.currency, 'GBP');
  assert.deepEqual(tm.months, monthRange('2025-11', '2026-10'));
  assert.equal(tm.months.length, 12);
  assert.equal(tm.complete, true);
  assert.deepEqual(tm.stale, []);
});

test('fixed rows: Salary, Housing, Council tax, Contributions, Utilities', () => {
  assert.equal(rowNamed('Salary').perMonth, 250000);
  assert.equal(rowNamed('Housing (rent or mortgage)').perMonth, 90000);
  assert.equal(rowNamed('Council tax').perMonth, 15000);
  assert.equal(rowNamed('Contributions from others').perMonth, 55000);
  assert.equal(rowNamed('Utilities').perMonth, 13300);
});

test('Subscriptions is 6500 + 1199 + 299 + 999', () => {
  assert.equal(rowNamed('Subscriptions').perMonth, 6500 + 1199 + 299 + 999);
  assert.equal(rowNamed('Subscriptions').perMonth, 8997);
});

test('Gifts (annual) is 4000 a month and 48000 a year', () => {
  const r = rowNamed('Gifts');
  assert.equal(r.budgetType, 'annual');
  assert.equal(r.perMonth, 4000);
  assert.equal(r.perYear, 48000);
});

test('Other Card (not itemised) is variable at 14750 with range 13000 to 16000', () => {
  const r = rowNamed('Other Card (not itemised)');
  assert.equal(r.budgetType, 'variable');
  assert.equal(r.perMonth, 14750);
  assert.deepEqual(r.range, [13000, 16000]);
});

test('Groceries is the sum over A and B of each account median', () => {
  const by = expected.monthlyTotalsByAccount.Groceries;
  let want = 0;
  for (const account of ['A', 'B']) want += -plainMedian(Object.values(by[account]));
  assert.equal(rowNamed('Groceries').perMonth, want);
});

test('Big one-offs appears once in oneOffs at 240000 and not in the spend table', () => {
  const big = state.categories.find((c) => c.name === 'Big one-offs');
  const list = tm.oneOffs.filter((o) => o.categoryId === big.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].amountMinor, 240000);
  assert.equal(tm.oneOffs.length, 1);
  assert.ok(!tm.spend.some((r) => r.categoryId === big.id));
});

test('uncategorised spending is A6 extra (299) + A16 (500) + A17 (2500)', () => {
  assert.equal(tm.uncategorised.spending, 299 + 500 + 2500);
  assert.equal(tm.uncategorised.spending, 3299);
  assert.equal(tm.uncategorised.income, 0);
});

test('totals add up from the rows', () => {
  const sum = (rows) => rows.reduce((s, r) => s + r.perMonth, 0);
  assert.equal(tm.totals.living, sum(tm.spend));
  assert.equal(tm.totals.income, sum(tm.income));
  assert.equal(tm.totals.contributions, sum(tm.contribution));
  assert.equal(tm.totals.share, tm.totals.living - tm.totals.contributions);
  assert.equal(tm.totals.leftOver, tm.totals.income - tm.totals.share);
});
