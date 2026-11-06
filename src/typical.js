// The typical month: one figure per category over the analysis window, by budget type.
// D1: each account counts only over the months it covers fully, and its sums are divided by its
// own month count. D8: integer minor units throughout, rounded with divRound only.
/** @import {State, Account, Transaction, BudgetType, Category} from './types.js' */
/** @import {ResolveContext} from './resolve.js' */
/** @import {Window} from './coverage.js' */
import { analysisWindow, staleAccounts } from './coverage.js';
import { buildContext, resolve } from './resolve.js';
import { divRound, currenciesOf } from './money.js';
import { cmp, compareNames } from './order.js';
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
/** @typedef {{windowMonths:number,coverageGapDays:number,variableRange:number[],unusualMonthPercent:number}} TypicalTuning */

/**
 * One window month of one account's series, in the category's natural direction. total is null
 * when the account doesn't fully cover that month; such a cell is never unusual.
 * @typedef {{month:string,total:number|null,unusual:boolean}} MonthCell
 */
/**
 * share: Variable, that account's median month; Annual, its yearly total scaled to 12 months;
 * Fixed, the sum of its bucket lines. cells: one per window month, oldest first.
 * @typedef {{accountId:string,share:number,cells:MonthCell[]}} AccountSeries
 */
/**
 * One Fixed bucket in one account. perMonth is exactly what it adds to the Row's perMonth.
 * latestDate is '' and latest 0 when count is 0.
 * @typedef {{bucketId:string,accountId:string,latest:number,count:number,latestDate:string,
 *   perMonth:number,stopped:boolean}} BucketLine
 */
/**
 * buckets: [] unless Fixed, ordered perMonth desc, then display name. accounts: in state.accounts
 * order, only those with transactions counted in this category. partMinor: transaction id → the
 * signed sum of its parts in this category, in transaction direction (not natural).
 * @typedef {{row:Row,currency:string,months:string[],accounts:AccountSeries[],buckets:BucketLine[],
 *   transactionIds:Set<string>,partMinor:Map<string,number>}} CategoryDetail
 */

/** @typedef {{count:number,latestDate:string,latest:number,opposite:number}} BucketCharges */
/** @typedef {{months:Map<string,number>,total:number,buckets:Map<string,BucketCharges>}} AccountSums */
/** @typedef {{byAccount:Map<string,AccountSums>,partMinor:Map<string,number>}} CategorySums */
/**
 * @typedef {{window:Window,ctx:ResolveContext,monthsOf:(accountId:string)=>Set<string>,
 *   sums:Map<string,CategorySums>,oneOffs:OneOff[],uncategorised:{spending:number,income:number}}} Collected
 */

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
 * One flag per total: true when it differs from the median of the totals by more than `percent`
 * of that median. With a median of 0, any total that isn't 0 is unusual.
 * @param {number[]} totals
 * @param {number} percent
 * @returns {boolean[]}
 */
export function unusualFlags(totals, percent) {
  const m = median(totals);
  return totals.map((t) => (m === 0 ? t !== 0 : Math.abs(t - m) * 100 > percent * Math.abs(m)));
}

/**
 * @param {Category} category
 * @returns {category is Category & {kind:'spend'|'income'|'contribution'}}
 */
const counted = (category) => category.kind === 'spend' || category.kind === 'income' || category.kind === 'contribution';

/**
 * The one pass over the transactions behind both typicalMonth and categoryDetail: each counted
 * transaction's net per category, by account, month and bucket, plus one-offs and uncategorised.
 * @param {State} state
 * @param {TypicalTuning} tuning
 * @returns {Collected}
 */
function collect(state, tuning) {
  const window = analysisWindow(state, tuning);
  const ctx = buildContext(state);
  /** @param {string} accountId */
  const monthsOf = (accountId) => window.accountMonths.get(accountId) ?? new Set();

  /** @type {Map<string, CategorySums>} category id → sums */
  const sums = new Map();
  /** @type {OneOff[]} */
  const oneOffs = [];
  const uncategorised = { spending: 0, income: 0 };

  for (const t of state.transactions) {
    const month = monthOf(t.date);
    if (!monthsOf(t.accountId).has(month)) continue;
    const res = resolve(t, ctx);
    if (res.source === 'transfer') continue;
    /** @type {Map<string, {natural:number,signed:number}>} this transaction's net per category */
    const net = new Map();
    for (const part of res.parts) {
      const category = part.categoryId ? ctx.categories.get(part.categoryId) : undefined;
      if (!category) {
        if (part.amountMinor < 0) uncategorised.spending -= part.amountMinor;
        else uncategorised.income += part.amountMinor;
        continue;
      }
      if (!counted(category)) continue;
      const natural = category.kind === 'spend' ? -part.amountMinor : part.amountMinor;
      const prev = net.get(category.id) ?? { natural: 0, signed: 0 };
      net.set(category.id, { natural: prev.natural + natural, signed: prev.signed + part.amountMinor });
    }
    for (const [categoryId, { natural: amount, signed }] of net) {
      if (ctx.categories.get(categoryId)?.budgetType === 'oneoff') {
        oneOffs.push({ txn: t, categoryId, amountMinor: amount });
        continue;
      }
      let c = sums.get(categoryId);
      if (!c) sums.set(categoryId, c = { byAccount: new Map(), partMinor: new Map() });
      c.partMinor.set(t.id, signed);
      let s = c.byAccount.get(t.accountId);
      if (!s) c.byAccount.set(t.accountId, s = { months: new Map(), total: 0, buckets: new Map() });
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
  return { window, ctx, monthsOf, sums, oneOffs, uncategorised };
}

/**
 * One category's Row, each account's share of it and, for Fixed, the line per account and bucket
 * that adds into perMonth.
 * @param {Category} category
 * @param {Map<string, AccountSums>} byAccount
 * @param {(accountId:string)=>Set<string>} monthsOf
 * @param {ResolveContext} ctx
 * @param {TypicalTuning} tuning
 * @returns {{row:Row,shares:Map<string,number>,lines:BucketLine[]}}
 */
function buildRow(category, byAccount, monthsOf, ctx, tuning) {
  const budgetType = category.budgetType ?? 'variable';
  /** @type {Row} */
  const row = { categoryId: category.id, name: category.name, budgetType, perMonth: 0, perYear: 0 };
  /** @type {Map<string, number>} */
  const shares = new Map();
  /** @type {BucketLine[]} */
  const lines = [];
  if (budgetType === 'fixed') {
    for (const [accountId, s] of byAccount) {
      const n = monthsOf(accountId).size;
      let share = 0;
      for (const [bucketId, b] of s.buckets) {
        // A Stopped bucket adds nothing, refunds included. A bucket's figure is never below 0.
        const stopped = ctx.buckets.get(bucketId)?.stoppedAfter !== undefined;
        const perMonth = b.count > 0 && !stopped
          ? Math.max(0, divRound(b.latest * b.count, n) + divRound(b.opposite, n))
          : 0;
        lines.push({ bucketId, accountId, latest: b.latest, count: b.count, latestDate: b.latestDate, perMonth, stopped });
        share += perMonth;
      }
      shares.set(accountId, share);
      row.perMonth += share;
    }
    row.perYear = row.perMonth * 12;
  } else if (budgetType === 'annual') {
    for (const [accountId, s] of byAccount) {
      const share = divRound(s.total * 12, monthsOf(accountId).size);
      shares.set(accountId, share);
      row.perYear += share;
    }
    row.perMonth = divRound(row.perYear, 12);
  } else {
    const [lo, hi] = tuning.variableRange;
    let low = 0;
    let high = 0;
    for (const [accountId, s] of byAccount) {
      const series = [...monthsOf(accountId)].map((m) => s.months.get(m) ?? 0);
      const share = median(series);
      shares.set(accountId, share);
      row.perMonth += share;
      low += percentile(series, lo);
      high += percentile(series, hi);
    }
    row.perYear = row.perMonth * 12;
    row.range = [low, high];
  }
  return { row, shares, lines };
}

/**
 * @param {State} state
 * @param {TypicalTuning} tuning
 * @returns {TypicalMonth|MixedCurrencies}
 */
export function typicalMonth(state, tuning) {
  const currencies = currenciesOf(state.transactions);
  if (currencies.length > 1) return { mixedCurrencies: true, currencies };
  const currency = currencies[0] ?? state.accounts[0]?.currency ?? 'GBP';

  const { window, ctx, monthsOf, sums, oneOffs, uncategorised } = collect(state, tuning);
  /** @type {Record<'spend'|'income'|'contribution', Row[]>} */
  const tables = { spend: [], income: [], contribution: [] };
  for (const [categoryId, c] of sums) {
    const category = ctx.categories.get(categoryId);
    if (!category || !counted(category)) continue;
    tables[category.kind].push(buildRow(category, c.byAccount, monthsOf, ctx, tuning).row);
  }
  for (const rows of Object.values(tables)) {
    rows.sort((a, b) => b.perMonth - a.perMonth || compareNames(a.name, b.name) || cmp(a.categoryId, b.categoryId));
  }
  oneOffs.sort((a, b) => cmp(a.txn.date, b.txn.date));

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

/**
 * The figures behind one Typical month row, from the same pass and row builder as typicalMonth.
 * Null when currencies are mixed, or the category has no row in the spend, income or
 * contribution tables.
 * @param {State} state
 * @param {TypicalTuning} tuning
 * @param {string} categoryId
 * @returns {CategoryDetail|null}
 */
export function categoryDetail(state, tuning, categoryId) {
  const currencies = currenciesOf(state.transactions);
  if (currencies.length > 1) return null;
  const currency = currencies[0] ?? state.accounts[0]?.currency ?? 'GBP';

  const { window, ctx, monthsOf, sums } = collect(state, tuning);
  const category = ctx.categories.get(categoryId);
  const c = sums.get(categoryId);
  if (!category || !counted(category) || !c) return null;
  const { row, shares, lines } = buildRow(category, c.byAccount, monthsOf, ctx, tuning);

  /** @type {AccountSeries[]} */
  const accounts = [];
  for (const account of state.accounts) {
    const s = c.byAccount.get(account.id);
    if (!s) continue;
    const covered = monthsOf(account.id);
    // Flags are worked out over the covered months only.
    const totals = window.months.filter((m) => covered.has(m)).map((m) => s.months.get(m) ?? 0);
    const flags = unusualFlags(totals, tuning.unusualMonthPercent);
    let i = 0;
    /** @type {MonthCell[]} */
    const cells = window.months.map((month) => {
      if (!covered.has(month)) return { month, total: null, unusual: false };
      const cell = { month, total: totals[i], unusual: flags[i] };
      i += 1;
      return cell;
    });
    accounts.push({ accountId: account.id, share: shares.get(account.id) ?? 0, cells });
  }

  const order = new Map(state.accounts.map((a, i) => [a.id, i]));
  /** @param {string} bucketId */
  const nameOf = (bucketId) => ctx.buckets.get(bucketId)?.displayName ?? bucketId;
  lines.sort((a, b) => b.perMonth - a.perMonth || compareNames(nameOf(a.bucketId), nameOf(b.bucketId))
    || cmp(a.bucketId, b.bucketId) || (order.get(a.accountId) ?? 0) - (order.get(b.accountId) ?? 0));

  return {
    row, currency, months: window.months, accounts, buckets: lines,
    transactionIds: new Set(c.partMinor.keys()), partMinor: c.partMinor,
  };
}
