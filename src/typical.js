// The typical month: one figure per category over the analysis window, by budget type.
// D1: each account counts only over the months it covers fully, and its sums are divided by its
// own month count. D8: integer minor units throughout, rounded with divRound only.
/** @import {State, Account, Transaction, BudgetType} from './types.js' */
import { analysisWindow, staleAccounts } from './coverage.js';
import { buildContext, resolve } from './resolve.js';
import { divRound } from './money.js';
import { monthOf } from './dates.js';

/**
 * Figures are positive in the category's natural direction: money out for spend, money in for
 * income and contribution.
 * @typedef {{categoryId:string,name:string,budgetType:BudgetType,perMonth:number,perYear:number,
 *   range?:[number,number]}} Row
 */
/** @typedef {{txn:Transaction,categoryId:string,amountMinor:number}} OneOff */
/** @typedef {{income:number,living:number,contributions:number,share:number,leftOver:number}} Totals */
/**
 * @typedef {{currency:string,months:string[],complete:boolean,stale:Account[],spend:Row[],income:Row[],
 *   contribution:Row[],oneOffs:OneOff[],uncategorised:{spending:number,income:number},totals:Totals}} TypicalMonth
 */
/** @typedef {{mixedCurrencies:true,currencies:string[]}} MixedCurrencies */
/** @typedef {{windowMonths:number,coverageGapDays:number,fixedActiveMonths:number,variableRange:number[]}} TypicalTuning */

/** @typedef {{count:number,latestDate:string,latest:number,opposite:number}} BucketCharges */
/** @typedef {{months:Map<string,number>,total:number,buckets:Map<string,BucketCharges>}} AccountSums */

/**
 * Median of integers; an even count averages the two middle values with divRound. Empty is 0.
 * @param {number[]} values
 * @returns {number}
 */
export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  const half = (n - (n % 2)) / 2;
  return n % 2 ? v[half] : divRound(v[half - 1] + v[half], 2);
}

/**
 * Nearest-rank percentile: the value at rank ceil(p × n / 100), at least 1. Empty is 0.
 * @param {number[]} values
 * @param {number} p 0 to 100
 * @returns {number}
 */
export function percentile(values, p) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  // variableRange percentiles must be integers: x % 100 is exact only for integers.
  const x = p * n;
  const rank = (x - (x % 100)) / 100 + (x % 100 > 0 ? 1 : 0);
  return v[Math.min(n, Math.max(1, rank)) - 1];
}

/**
 * @param {State} state
 * @param {TypicalTuning} tuning
 * @returns {TypicalMonth|MixedCurrencies}
 */
export function typicalMonth(state, tuning) {
  const currencies = [...new Set(state.transactions.map((t) => t.currency))].sort();
  if (currencies.length > 1) return { mixedCurrencies: true, currencies };
  const currency = currencies[0] ?? state.accounts[0]?.currency ?? 'GBP';

  const window = analysisWindow(state, tuning);
  const ctx = buildContext(state);
  const activeMonths = new Set(window.months.slice(Math.max(0, window.months.length - tuning.fixedActiveMonths)));
  /** @param {string} accountId */
  const monthsOf = (accountId) => window.accountMonths.get(accountId) ?? new Set();

  /** @type {Map<string, Map<string, AccountSums>>} category id → account id → sums */
  const sums = new Map();
  /** @type {OneOff[]} */
  const oneOffs = [];
  const uncategorised = { spending: 0, income: 0 };

  for (const t of state.transactions) {
    const month = monthOf(t.date);
    if (!monthsOf(t.accountId).has(month)) continue;
    const res = resolve(t, ctx);
    if (res.source === 'transfer') continue;
    /** @type {Map<string, number>} this transaction's net per category, in natural direction */
    const net = new Map();
    for (const part of res.parts) {
      const category = part.categoryId ? ctx.categories.get(part.categoryId) : undefined;
      if (!category) {
        if (part.amountMinor < 0) uncategorised.spending -= part.amountMinor;
        else uncategorised.income += part.amountMinor;
        continue;
      }
      if (category.kind !== 'spend' && category.kind !== 'income' && category.kind !== 'contribution') continue;
      const natural = category.kind === 'spend' ? -part.amountMinor : part.amountMinor;
      net.set(category.id, (net.get(category.id) ?? 0) + natural);
    }
    for (const [categoryId, amount] of net) {
      if (ctx.categories.get(categoryId)?.budgetType === 'oneoff') {
        oneOffs.push({ txn: t, categoryId, amountMinor: amount });
        continue;
      }
      let byAccount = sums.get(categoryId);
      if (!byAccount) sums.set(categoryId, byAccount = new Map());
      let s = byAccount.get(t.accountId);
      if (!s) byAccount.set(t.accountId, s = { months: new Map(), total: 0, buckets: new Map() });
      s.months.set(month, (s.months.get(month) ?? 0) + amount);
      s.total += amount;
      let b = s.buckets.get(t.bucketId);
      if (!b) s.buckets.set(t.bucketId, b = { count: 0, latestDate: '', latest: 0, opposite: 0 });
      if (amount < 0) b.opposite += amount;
      if (amount > 0) {
        b.count += 1;
        // Newest date wins; on the same date, the larger charge.
        if (t.date > b.latestDate || (t.date === b.latestDate && amount > b.latest)) {
          b.latestDate = t.date;
          b.latest = amount;
        }
      }
    }
  }

  const [lo, hi] = tuning.variableRange;
  /** @type {Record<'spend'|'income'|'contribution', Row[]>} */
  const tables = { spend: [], income: [], contribution: [] };
  for (const [categoryId, byAccount] of sums) {
    const category = ctx.categories.get(categoryId);
    if (!category || (category.kind !== 'spend' && category.kind !== 'income' && category.kind !== 'contribution')) continue;
    const budgetType = category.budgetType ?? 'variable';
    /** @type {Row} */
    const row = { categoryId, name: category.name, budgetType, perMonth: 0, perYear: 0 };
    if (budgetType === 'fixed') {
      for (const [accountId, s] of byAccount) {
        const n = monthsOf(accountId).size;
        for (const b of s.buckets.values()) {
          // An ended bucket (no charge in the active months) contributes 0, refunds included.
          if (b.count > 0 && activeMonths.has(monthOf(b.latestDate))) {
            row.perMonth += divRound(b.latest * b.count, n);
            row.perMonth += divRound(b.opposite, n);
          }
        }
      }
      row.perYear = row.perMonth * 12;
    } else if (budgetType === 'annual') {
      for (const [accountId, s] of byAccount) row.perYear += divRound(s.total * 12, monthsOf(accountId).size);
      row.perMonth = divRound(row.perYear, 12);
    } else {
      let low = 0;
      let high = 0;
      for (const [accountId, s] of byAccount) {
        const series = [...monthsOf(accountId)].map((m) => s.months.get(m) ?? 0);
        row.perMonth += median(series);
        low += percentile(series, lo);
        high += percentile(series, hi);
      }
      row.perYear = row.perMonth * 12;
      row.range = [low, high];
    }
    tables[category.kind].push(row);
  }
  for (const rows of Object.values(tables)) {
    rows.sort((a, b) => b.perMonth - a.perMonth || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  oneOffs.sort((a, b) => (a.txn.date < b.txn.date ? -1 : a.txn.date > b.txn.date ? 1 : 0));

  /** @param {Row[]} rows */
  const sum = (rows) => rows.reduce((acc, r) => acc + r.perMonth, 0);
  const living = sum(tables.spend);
  const contributions = sum(tables.contribution);
  const income = sum(tables.income);
  const share = living - contributions;
  return {
    currency, months: window.months, complete: window.complete, stale: staleAccounts(state, window),
    spend: tables.spend, income: tables.income, contribution: tables.contribution, oneOffs, uncategorised,
    totals: { income, living, contributions, share, leftOver: income - share },
  };
}
