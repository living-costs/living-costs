// What is in a category, for the explorer on the Categories screen: every transaction with a part
// in it, across every month of every account, with totals by month and by bucket. Not a budget
// figure: no window, no budget type, and every kind counts the same way. A transaction is in a
// category exactly when resolve() gives it a part there, so a confirmed transfer pair never is.
/** @import {State, Transaction} from './types.js' */
import { buildContext, resolve } from './resolve.js';
import { accountsByMonth, accountMonthStatus, intervalsByAccount } from './coverage.js';
import { monthOf, monthRange } from './dates.js';
import { soleCurrency } from './money.js';
import { cmp, compareNames } from './order.js';

/**
 * total: the signed net (in minus out) of the category's transactions that month, or null when
 * the account doesn't cover the month and has nothing in it. partial: the account covers the
 * month only in part, or not at all but has something in it.
 * @typedef {{month:string,total:number|null,partial:boolean}} ContentsCell
 */
/**
 * out and in: positive sums of the account's negative and positive amounts here.
 * @typedef {{accountId:string,out:number,in:number,cells:ContentsCell[]}} ContentsAccount
 */
/**
 * count: transactions with a part here. total: their signed net. latestDate: ISO date of the latest.
 * moved: how many are here through an override or split while the bucket's own category is another.
 * categoryId: the category of the row when rows are split by category, else null.
 * @typedef {{bucketId:string,categoryId:string|null,count:number,total:number,latestDate:string,moved:number}} ContentsBucket
 */
/**
 * currency: null when the category's transactions use more than one. from and to: YYYY-MM of the
 * earliest and latest transaction. months: every month shown, oldest first. accounts: in
 * state.accounts order, only those with something here. partMinor: transaction id → signed sum of
 * its parts here (every id in transactionIds has an entry).
 * @typedef {{currency:string|null,count:number,out:number,in:number,from:string,to:string,months:string[],
 *   accounts:ContentsAccount[],buckets:ContentsBucket[],transactionIds:Set<string>,partMinor:Map<string,number>}} CategoryContents
 */

/**
 * One transaction's signed net in one category (null: none), and whether it is here by override or
 * split while its bucket's own category is outside the group.
 * @typedef {{t:Transaction,categoryId:string|null,amount:number,moved:boolean}} ContentsEntry
 */

/**
 * Each transaction's signed amount in each category it has a part in, in one pass.
 * @param {State} state
 * @param {(t: Transaction, categoryId: string, amount: number, source: string) => void} visit
 */
function eachPart(state, visit) {
  const ctx = buildContext(state);
  for (const t of state.transactions) {
    const res = resolve(t, ctx);
    /** @type {Map<string, number>} */
    const net = new Map();
    for (const part of res.parts) {
      if (part.categoryId) net.set(part.categoryId, (net.get(part.categoryId) ?? 0) + part.amountMinor);
    }
    for (const [categoryId, amount] of net) visit(t, categoryId, amount, res.source);
  }
}

/**
 * Ids of every category that at least one transaction has a part in.
 * @param {State} state
 * @returns {Set<string>}
 */
export function openableCategoryIds(state) {
  /** @type {Set<string>} */
  const ids = new Set();
  eachPart(state, (_t, categoryId) => ids.add(categoryId));
  return ids;
}

/**
 * Summarises entries: totals by account and month, and rows by bucket (and by category when
 * byCategory). Null when there are no entries.
 * @param {State} state
 * @param {ContentsEntry[]} entries
 * @param {{months:string[],cell:(accountId:string,month:string,total:number|undefined)=>ContentsCell,byCategory:boolean}} opts
 * @returns {CategoryContents|null}
 */
export function summariseContents(state, entries, opts) {
  if (entries.length === 0) return null;

  const bucketName = new Map(state.buckets.map((b) => [b.id, b.displayName]));
  const categoryName = new Map(state.categories.map((c) => [c.id, c.name]));
  /** @type {Map<string, {out:number,in:number,months:Map<string,number>}>} */
  const byAccount = new Map();
  /** @type {Map<string, ContentsBucket>} */
  const byBucket = new Map();
  /** @type {Map<string, number>} */
  const partMinor = new Map();
  /** @type {Map<string, Transaction>} */
  const distinct = new Map();
  let out = 0;
  let inn = 0;
  let from = '9999-12';
  let to = '0000-01';

  for (const { t, categoryId, amount, moved } of entries) {
    const month = monthOf(t.date);
    if (month < from) from = month;
    if (month > to) to = month;
    distinct.set(t.id, t);
    partMinor.set(t.id, (partMinor.get(t.id) ?? 0) + amount);
    if (amount < 0) out -= amount; else inn += amount;

    let a = byAccount.get(t.accountId);
    if (!a) byAccount.set(t.accountId, a = { out: 0, in: 0, months: new Map() });
    if (amount < 0) a.out -= amount; else a.in += amount;
    a.months.set(month, (a.months.get(month) ?? 0) + amount);

    const rowCategory = opts.byCategory ? categoryId : null;
    const key = `${t.bucketId}\n${rowCategory ?? ''}`;
    let b = byBucket.get(key);
    if (!b) byBucket.set(key, b = { bucketId: t.bucketId, categoryId: rowCategory, count: 0, total: 0, latestDate: '', moved: 0 });
    b.count += 1;
    b.total += amount;
    if (t.date > b.latestDate) b.latestDate = t.date;
    if (moved) b.moved += 1;
  }

  /** @type {ContentsAccount[]} */
  const accounts = [];
  for (const account of state.accounts) {
    const a = byAccount.get(account.id);
    if (!a) continue;
    accounts.push({ accountId: account.id, out: a.out, in: a.in, cells: opts.months.map((month) => opts.cell(account.id, month, a.months.get(month))) });
  }

  const buckets = [...byBucket.values()].sort((x, y) => Math.abs(y.total) - Math.abs(x.total)
    || compareNames(bucketName.get(x.bucketId) ?? '', bucketName.get(y.bucketId) ?? '') || cmp(x.bucketId, y.bucketId)
    || compareNames(categoryName.get(x.categoryId ?? '') ?? '', categoryName.get(y.categoryId ?? '') ?? '') || cmp(x.categoryId ?? '', y.categoryId ?? ''));

  return {
    currency: soleCurrency([...distinct.values()]),
    count: distinct.size, out, in: inn, from, to, months: opts.months, accounts, buckets,
    transactionIds: new Set(partMinor.keys()), partMinor,
  };
}

/**
 * What is in one category, or null when nothing counts as it.
 * @param {State} state
 * @param {{coverageGapDays:number}} tuning
 * @param {string} categoryId
 * @returns {CategoryContents|null}
 */
export function categoryContents(state, tuning, categoryId) {
  const bucketCategory = new Map(state.buckets.map((b) => [b.id, b.categoryId]));
  /** @type {ContentsEntry[]} */
  const entries = [];
  eachPart(state, (t, id, amount, source) => {
    if (id !== categoryId) return;
    const moved = (source === 'override' || source === 'split') && bucketCategory.get(t.bucketId) !== categoryId;
    entries.push({ t, categoryId: id, amount, moved });
  });
  if (entries.length === 0) return null;

  let from = '9999-12';
  let to = '0000-01';
  for (const { t } of entries) {
    const month = monthOf(t.date);
    if (month < from) from = month;
    if (month > to) to = month;
  }
  const span = accountsByMonth(state, tuning).months;
  const first = span.length > 0 && span[0] < from ? span[0] : from;
  const last = span.length > 0 && span[span.length - 1] > to ? span[span.length - 1] : to;
  const months = monthRange(first, last);

  const ivs = intervalsByAccount(state, tuning);
  const kinds = new Map(state.accounts.map((a) => [a.id, a.kind]));
  return summariseContents(state, entries, {
    months,
    byCategory: false,
    cell: (accountId, month, total) => {
      const status = kinds.get(accountId) === 'placeholder' ? 'missing' : accountMonthStatus(ivs.get(accountId) ?? [], month);
      if (status === 'covered') return { month, total: total ?? 0, partial: false };
      if (status === 'partial') return { month, total: total ?? 0, partial: true };
      return total === undefined ? { month, total: null, partial: false } : { month, total, partial: true };
    },
  });
}
