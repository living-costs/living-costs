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
 * @typedef {{bucketId:string,count:number,total:number,latestDate:string,moved:number}} ContentsBucket
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
 * What is in one category, or null when nothing counts as it.
 * @param {State} state
 * @param {{coverageGapDays:number}} tuning
 * @param {string} categoryId
 * @returns {CategoryContents|null}
 */
export function categoryContents(state, tuning, categoryId) {
  /** @type {{t: Transaction, amount: number, source: string}[]} */
  const found = [];
  eachPart(state, (t, id, amount, source) => { if (id === categoryId) found.push({ t, amount, source }); });
  if (found.length === 0) return null;

  const bucketCategory = new Map(state.buckets.map((b) => [b.id, b.categoryId]));
  const bucketName = new Map(state.buckets.map((b) => [b.id, b.displayName]));
  /** @type {Map<string, {out:number,in:number,months:Map<string,number>}>} */
  const byAccount = new Map();
  /** @type {Map<string, ContentsBucket>} */
  const byBucket = new Map();
  /** @type {Map<string, number>} */
  const partMinor = new Map();
  let out = 0;
  let inn = 0;
  let from = '9999-12';
  let to = '0000-01';

  for (const { t, amount, source } of found) {
    const month = monthOf(t.date);
    if (month < from) from = month;
    if (month > to) to = month;
    partMinor.set(t.id, amount);
    if (amount < 0) out -= amount; else inn += amount;

    let a = byAccount.get(t.accountId);
    if (!a) byAccount.set(t.accountId, a = { out: 0, in: 0, months: new Map() });
    if (amount < 0) a.out -= amount; else a.in += amount;
    a.months.set(month, (a.months.get(month) ?? 0) + amount);

    let b = byBucket.get(t.bucketId);
    if (!b) byBucket.set(t.bucketId, b = { bucketId: t.bucketId, count: 0, total: 0, latestDate: '', moved: 0 });
    b.count += 1;
    b.total += amount;
    if (t.date > b.latestDate) b.latestDate = t.date;
    if ((source === 'override' || source === 'split') && bucketCategory.get(t.bucketId) !== categoryId) b.moved += 1;
  }

  const span = accountsByMonth(state, tuning).months;
  const first = span.length > 0 && span[0] < from ? span[0] : from;
  const last = span.length > 0 && span[span.length - 1] > to ? span[span.length - 1] : to;
  const months = monthRange(first, last);

  const ivs = intervalsByAccount(state, tuning);
  /** @type {ContentsAccount[]} */
  const accounts = [];
  for (const account of state.accounts) {
    const a = byAccount.get(account.id);
    if (!a) continue;
    const cells = months.map((month) => {
      const status = account.kind === 'placeholder' ? 'missing' : accountMonthStatus(ivs.get(account.id) ?? [], month);
      const total = a.months.get(month);
      if (status === 'covered') return { month, total: total ?? 0, partial: false };
      if (status === 'partial') return { month, total: total ?? 0, partial: true };
      return total === undefined ? { month, total: null, partial: false } : { month, total, partial: true };
    });
    accounts.push({ accountId: account.id, out: a.out, in: a.in, cells });
  }

  const buckets = [...byBucket.values()].sort((x, y) => Math.abs(y.total) - Math.abs(x.total)
    || compareNames(bucketName.get(x.bucketId) ?? '', bucketName.get(y.bucketId) ?? '') || cmp(x.bucketId, y.bucketId));

  return {
    currency: soleCurrency(found.map((f) => f.t)),
    count: found.length, out, in: inn, from, to, months, accounts, buckets,
    transactionIds: new Set(partMinor.keys()), partMinor,
  };
}
