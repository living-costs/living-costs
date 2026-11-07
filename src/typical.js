// The typical month: one figure per category over the analysis window, by budget type.
// D1: each account counts only over the months it covers fully, and its sums are divided by its
// own month count. D8: integer minor units throughout, rounded with divRound only.
/** @import {State, Account, Transaction, BudgetType, Category} from './types.js' */
/** @import {ResolveContext} from './resolve.js' */
/** @import {Window, MonthRange} from './coverage.js' */
import { analysisWindow, completeMonths, coveringAccounts, staleAccounts } from './coverage.js';
import { buildContext, resolve } from './resolve.js';
import { divRound, currenciesOf } from './money.js';
import { cmp, compareNames } from './order.js';
import { monthOf } from './dates.js';
import { savingsContext, accountRowId, ACCOUNT_ROW_PREFIX } from './savings.js';

/**
 * Figures are positive in the category's natural direction: money out for spend and saving, money
 * in for income and contribution. month: the compared month's figure, on every row when comparing.
 * monthOnly: the category has no transactions in the window, only in the compared month.
 * accountId: set only on a savings-account row, whose categoryId is accountRowId(accountId).
 * @typedef {{categoryId:string,name:string,budgetType:BudgetType,perMonth:number,perYear:number,
 *   range?:[number,number],month?:number,monthOnly?:true,accountId?:string}} Row
 */
/** @typedef {{txn:Transaction,categoryId:string,amountMinor:number}} OneOff */
/**
 * savings: the sum of the saving rows, outside every other total.
 * @typedef {{income:number,living:number,contributions:number,share:number,leftOver:number,savings:number}} Totals
 */
/** @typedef {{range:MonthRange|null, compare:string|null}} TypicalChoices */
/**
 * missing: accounts, in state.accounts order, with transactions counted in the window that don't
 * cover the compared month. totals: as TypicalMonth.totals, from each row's month figure.
 * @typedef {{month:string, missing:Account[], totals:Totals}} Comparison
 */
/**
 * @typedef {{currency:string,months:string[],complete:boolean,isDefault:boolean,stale:Account[],spend:Row[],
 *   income:Row[],contribution:Row[],saving:Row[],oneOffs:OneOff[],uncategorised:{spending:number,income:number},
 *   totals:Totals,compare:Comparison|null}} TypicalMonth
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
 * rowCategories: ctx.categories plus one synthetic Variable saving category per savings-account
 * row seen, keyed accountRowId(account id) and named after the account.
 * @typedef {{ctx:ResolveContext,monthsOf:(accountId:string)=>Set<string>,rowCategories:Map<string,Category>,
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
 * One cell per window month: the month's total from `sums` (0 when absent), or null when the
 * account doesn't cover it. Unusual flags are worked out over the covered months only.
 * @param {string[]} months the window months, oldest first
 * @param {Set<string>} covered the months the account covers
 * @param {Map<string, number>} sums month → total
 * @param {number} percent unusualMonthPercent
 * @returns {MonthCell[]}
 */
export function monthCells(months, covered, sums, percent) {
  const totals = months.filter((m) => covered.has(m)).map((m) => sums.get(m) ?? 0);
  const flags = unusualFlags(totals, percent);
  let i = 0;
  return months.map((month) => {
    if (!covered.has(month)) return { month, total: null, unusual: false };
    const cell = { month, total: totals[i], unusual: flags[i] };
    i += 1;
    return cell;
  });
}

/** @typedef {'spend'|'income'|'contribution'|'saving'} CountedKind */
/**
 * @param {Category} category
 * @returns {category is Category & {kind:CountedKind}}
 */
const counted = (category) => category.kind === 'spend' || category.kind === 'income'
  || category.kind === 'contribution' || category.kind === 'saving';

/** @param {string} categoryId @returns {string|undefined} the account behind a savings-account row id */
const rowAccount = (categoryId) =>
  categoryId.startsWith(ACCOUNT_ROW_PREFIX) ? categoryId.slice(ACCOUNT_ROW_PREFIX.length) : undefined;

/**
 * The one pass over the transactions behind typicalMonth, monthFigures and categoryDetail: each
 * counted transaction's net per category, by account, month and bucket, plus one-offs and
 * uncategorised. A transaction counts only in a month its account covers within `window`.
 * A confirmed pair with exactly one side in a Savings account counts once, on the other side, in
 * that side's Saving category or else its savings-account row; every other transfer is skipped.
 * Inside a Savings account, a Saving category counts only through such a pair.
 * @param {State} state
 * @param {Window} window
 * @returns {Collected}
 */
function collect(state, window) {
  const ctx = buildContext(state);
  const { savingsAccounts, sides } = savingsContext(state, ctx);
  /** @type {Map<string, Category>} */
  const rowCategories = new Map(ctx.categories);
  const accountsById = new Map(state.accounts.map((a) => [a.id, a]));
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
    let parts = res.parts;
    if (res.source === 'transfer') {
      const side = sides.get(t.fingerprint);
      if (!side) continue;
      // A savings pair: one part, the whole amount, any split ignored.
      const categoryId = side.categoryId ?? accountRowId(side.savingsAccountId);
      if (!rowCategories.has(categoryId)) {
        const name = accountsById.get(side.savingsAccountId)?.name ?? side.savingsAccountId;
        rowCategories.set(categoryId, { id: categoryId, name, kind: 'saving', budgetType: 'variable', position: 0 });
      }
      parts = [{ amountMinor: t.amountMinor, categoryId }];
    }
    /** @type {Map<string, {natural:number,signed:number}>} this transaction's net per category */
    const net = new Map();
    for (const part of parts) {
      const category = part.categoryId ? rowCategories.get(part.categoryId) : undefined;
      if (!category) {
        if (part.amountMinor < 0) uncategorised.spending -= part.amountMinor;
        else uncategorised.income += part.amountMinor;
        continue;
      }
      if (!counted(category)) continue;
      // Inside a Savings account only confirmed pairs count as saving, so a deposit isn't counted twice.
      if (category.kind === 'saving' && savingsAccounts.has(t.accountId)) continue;
      const natural = category.kind === 'spend' || category.kind === 'saving' ? -part.amountMinor : part.amountMinor;
      const prev = net.get(category.id) ?? { natural: 0, signed: 0 };
      net.set(category.id, { natural: prev.natural + natural, signed: prev.signed + part.amountMinor });
    }
    for (const [categoryId, { natural: amount, signed }] of net) {
      if (rowCategories.get(categoryId)?.budgetType === 'oneoff') {
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
  return { ctx, monthsOf, rowCategories, sums, oneOffs, uncategorised };
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
  const accountId = rowAccount(category.id);
  if (accountId !== undefined) row.accountId = accountId;
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
 * The summary figures, from one figure per row.
 * @param {Record<CountedKind, Row[]>} tables
 * @param {(row:Row)=>number} figure
 * @returns {Totals}
 */
function totalsOf(tables, figure) {
  /** @param {Row[]} rows */
  const sum = (rows) => rows.reduce((acc, r) => acc + figure(r), 0);
  const living = sum(tables.spend);
  const contributions = sum(tables.contribution);
  const income = sum(tables.income);
  const share = living - contributions;
  return { income, living, contributions, share, leftOver: income - share, savings: sum(tables.saving) };
}

/**
 * Each category's net in `month`, in its natural direction, over the accounts that cover that
 * month: a second collect pass with a one-month window, so resolving is exactly as for the window.
 * @param {State} state
 * @param {TypicalTuning} tuning
 * @param {string} month YYYY-MM
 * @returns {{covering:Set<string>, figures:Map<string, number>, rowCategories:Map<string, Category>}}
 */
function monthFigures(state, tuning, month) {
  const covering = coveringAccounts(state, tuning, month);
  const accountMonths = new Map(state.accounts.map((a) => [a.id, new Set(covering.has(a.id) ? [month] : [])]));
  const { sums, rowCategories } = collect(state, { months: [month], complete: true, isDefault: false, accountMonths });
  /** @type {Map<string, number>} */
  const figures = new Map();
  for (const [categoryId, c] of sums) {
    let total = 0;
    for (const s of c.byAccount.values()) total += s.months.get(month) ?? 0;
    figures.set(categoryId, total);
  }
  return { covering, figures, rowCategories };
}

/**
 * The typical month over the chosen window (the default window when `choices.range` is null),
 * with every row's figure for `choices.compare` when that month is complete.
 * @param {State} state
 * @param {TypicalTuning} tuning
 * @param {TypicalChoices} [choices]
 * @returns {TypicalMonth|MixedCurrencies}
 */
export function typicalMonth(state, tuning, choices = { range: null, compare: null }) {
  const currencies = currenciesOf(state.transactions);
  if (currencies.length > 1) return { mixedCurrencies: true, currencies };
  const currency = currencies[0] ?? state.accounts[0]?.currency ?? 'GBP';

  const window = analysisWindow(state, tuning, choices.range);
  const { ctx, monthsOf, rowCategories, sums, oneOffs, uncategorised } = collect(state, window);
  const compareMonth = choices.compare;
  const month = compareMonth !== null && window.complete && completeMonths(state, tuning).includes(compareMonth)
    ? monthFigures(state, tuning, compareMonth) : null;

  /** @type {Record<CountedKind, Row[]>} */
  const tables = { spend: [], income: [], contribution: [], saving: [] };
  for (const [categoryId, c] of sums) {
    const category = rowCategories.get(categoryId);
    if (!category || !counted(category)) continue;
    const { row } = buildRow(category, c.byAccount, monthsOf, ctx, tuning);
    // Annual compares its typical figure: one month's total says little about a yearly cost.
    if (month) row.month = row.budgetType === 'annual' ? row.perMonth : month.figures.get(categoryId) ?? 0;
    tables[category.kind].push(row);
  }
  if (month) {
    // A category seen only in the compared month still gets a row, so the month column adds up.
    // Annual never does: its month figure is its typical one, 0.
    for (const [categoryId, figure] of month.figures) {
      // The month's own row categories: a savings-account row may be seen only in that month.
      const category = month.rowCategories.get(categoryId);
      if (sums.has(categoryId) || !category || !counted(category)) continue;
      const budgetType = category.budgetType ?? 'variable';
      if (budgetType === 'annual') continue;
      /** @type {Row} */
      const r = { categoryId, name: category.name, budgetType, perMonth: 0, perYear: 0, month: figure, monthOnly: true };
      const accountId = rowAccount(categoryId);
      if (accountId !== undefined) r.accountId = accountId;
      tables[category.kind].push(r);
    }
  }
  for (const rows of Object.values(tables)) {
    rows.sort((a, b) => b.perMonth - a.perMonth || compareNames(a.name, b.name) || cmp(a.categoryId, b.categoryId));
  }
  oneOffs.sort((a, b) => cmp(a.txn.date, b.txn.date));

  /** @type {Comparison|null} */
  let compare = null;
  if (compareMonth !== null && month) {
    const inWindow = new Set([...sums.values()].flatMap((c) => [...c.byAccount.keys()]));
    compare = {
      month: compareMonth,
      missing: state.accounts.filter((a) => inWindow.has(a.id) && !month.covering.has(a.id)),
      totals: totalsOf(tables, (r) => r.month ?? 0),
    };
  }
  return {
    currency, months: window.months, complete: window.complete, isDefault: window.isDefault,
    stale: staleAccounts(state, window),
    spend: tables.spend, income: tables.income, contribution: tables.contribution, saving: tables.saving,
    oneOffs, uncategorised,
    totals: totalsOf(tables, (r) => r.perMonth), compare,
  };
}

/**
 * The choices that still apply to `complete`. A range with from after to, or with none of
 * `complete` inside it, becomes null, and so does a compared month `complete` doesn't include.
 * @param {string[]} complete the complete months, as completeMonths gives them
 * @param {TypicalChoices} choices
 * @returns {TypicalChoices}
 */
export function settleChoices(complete, choices) {
  const { range, compare } = choices;
  const keepRange = range !== null && range.from <= range.to
    && complete.some((m) => m >= range.from && m <= range.to);
  return { range: keepRange ? range : null, compare: compare !== null && complete.includes(compare) ? compare : null };
}

/**
 * The figures behind one Typical month row, from the same pass and row builder as typicalMonth.
 * Null when currencies are mixed, the id is a savings-account row's, or the category has no row in
 * the spend, income, contribution or saving tables.
 * @param {State} state
 * @param {TypicalTuning} tuning
 * @param {string} categoryId
 * @param {MonthRange|null} [range] the chosen window, as given to typicalMonth
 * @returns {CategoryDetail|null}
 */
export function categoryDetail(state, tuning, categoryId, range = null) {
  const currencies = currenciesOf(state.transactions);
  if (currencies.length > 1 || rowAccount(categoryId) !== undefined) return null;
  const currency = currencies[0] ?? state.accounts[0]?.currency ?? 'GBP';

  const window = analysisWindow(state, tuning, range);
  const { ctx, monthsOf, rowCategories, sums } = collect(state, window);
  const category = rowCategories.get(categoryId);
  const c = sums.get(categoryId);
  if (!category || !counted(category) || !c) return null;
  const { row, shares, lines } = buildRow(category, c.byAccount, monthsOf, ctx, tuning);

  /** @type {AccountSeries[]} */
  const accounts = [];
  for (const account of state.accounts) {
    const s = c.byAccount.get(account.id);
    if (!s) continue;
    const cells = monthCells(window.months, monthsOf(account.id), s.months, tuning.unusualMonthPercent);
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
