// Reconciles the typical month against the synthetic fixtures and expected.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import tuning from '../../src/tuning.js';
import { analysisWindow } from '../../src/coverage.js';
import { buildContext, resolve } from '../../src/resolve.js';
import { monthOf, monthRange } from '../../src/dates.js';
import { typicalMonth } from '../../src/typical.js';
import { bucketCounts, monthlyFigure } from '../../src/progress.js';
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

/** Nearest-rank percentile with a plain sort: rank ceil(p × n / 100). */
function plainPercentile(values, p) {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.max(1, Math.ceil((p * v.length) / 100)) - 1];
}

/** Money out per account month for a spend category, from expected.json. @param {string} name */
const outByAccount = (name) => Object.values(expected.monthlyTotalsByAccount[name])
  .map((months) => Object.values(months).map((v) => -v));
/** @param {number[][]} series @param {(v:number[]) => number} f */
const sumOver = (series, f) => series.reduce((s, v) => s + f(v), 0);

test('Household maintenance (annual) is pinned from expected.json', () => {
  // A: 12 × 5700 = 68400 over 12 months. C: 105841 over 12 months. perYear = 68400 + 105841.
  const perYear = sumOver(outByAccount('Household maintenance'), (v) => v.reduce((s, x) => s + x, 0) * 12 / v.length);
  assert.equal(perYear, 174241);
  const r = rowNamed('Household maintenance');
  assert.equal(r.perYear, 174241);
  assert.equal(r.perMonth, 14520); // 174241 / 12 = 14520.08
});

test('variable rows are pinned from expected.json', () => {
  // Other income: A median 10291 + S median 123.
  const otherIncome = Object.values(expected.monthlyTotalsByAccount['Other income'])
    .reduce((s, months) => s + plainMedian(Object.values(months)), 0);
  assert.equal(otherIncome, 10414);
  assert.equal(rowNamed('Other income').perMonth, 10414);
  // Transport (C): 11 × 4720 and one 2380. Entertainment (A): 11 × 2899 and one 3898.
  // Eating out (A): 7 × 1400 and 5 × 1750, so the middle two are both 1400.
  for (const [name, want] of [['Transport', 4720], ['Entertainment', 2899], ['Eating out', 1400]]) {
    assert.equal(sumOver(outByAccount(name), plainMedian), want, name);
    assert.equal(rowNamed(name).perMonth, want, name);
  }
  // Groceries: A ranks 3 and 9 are 27764 and 35390; B ranks 1 and 3 are 37250 and 54450.
  const groceries = outByAccount('Groceries');
  const range = [sumOver(groceries, (v) => plainPercentile(v, 25)), sumOver(groceries, (v) => plainPercentile(v, 75))];
  assert.deepEqual(range, [65014, 89840]);
  assert.deepEqual(rowNamed('Groceries').range, [65014, 89840]);
});

test('totals are pinned', () => {
  // living = 90000 + 73784 + 15000 + 14750 + 14520 + 13300 + 8997 + 4720 + 4000 + 2899 + 1400
  // income = 250000 + 10414; share = living − 55000; leftOver = income − share
  assert.equal(90000 + 73784 + 15000 + 14750 + 14520 + 13300 + 8997 + 4720 + 4000 + 2899 + 1400, 243370);
  assert.deepEqual(tm.totals, { income: 260414, living: 243370, contributions: 55000, share: 188370, leftOver: 72044, savings: 0 });
});

test('totals add up from the rows', () => {
  const sum = (rows) => rows.reduce((s, r) => s + r.perMonth, 0);
  assert.equal(tm.totals.living, sum(tm.spend));
  assert.equal(tm.totals.income, sum(tm.income));
  assert.equal(tm.totals.contributions, sum(tm.contribution));
  assert.equal(tm.totals.share, tm.totals.living - tm.totals.contributions);
  assert.equal(tm.totals.leftOver, tm.totals.income - tm.totals.share);
});

test('the categorise card monthly figure follows D1: Bank B buckets divide by its 3 months', () => {
  const window = analysisWindow(state, tuning);
  assert.equal(window.accountMonths.get('B').size, 3);
  const counts = bucketCounts(state, tuning);
  /** @param {string} key */
  const figure = (key) => monthlyFigure(counts.get(state.buckets.find((b) => b.keys.includes(key)).id), window.accountMonths);
  // A N OTHER pays 55000 a month into B; the typical month's fixed row agrees.
  assert.deepEqual(figure('A N OTHER'), { perMonth: 55000, months: 3 });
  assert.equal(rowNamed('Contributions from others').perMonth, 55000);
  // SAINSBURYS S/MKT: 134550 over B's 3 months.
  assert.deepEqual(figure('SAINSBURYS S/MKT'), { perMonth: 44850, months: 3 });
  assert.equal(-Object.values(expected.monthlyTotalsByAccount.Groceries.B).reduce((s, v) => s + v, 0), 134550);
});
