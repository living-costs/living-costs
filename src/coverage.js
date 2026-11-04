// Coverage: which days each account's batches declare, which months are complete, and the
// per-account analysis window (decision D1: a transaction counts only in months its account covers fully).
/** @import {State, Account, Batch} from './types.js' */
import { addDays, monthOf, monthStart, monthEnd, monthRange } from './dates.js';

/** @typedef {{from:string,to:string}} Interval */
/** @typedef {'covered'|'partial'|'missing'} Status */
/** @typedef {{months:string[],complete:boolean,accountMonths:Map<string,Set<string>>}} Window */

/**
 * Merge batch periods into ascending intervals. Gaps of up to `gapDays` count as covered.
 * @param {Batch[]} batches
 * @param {number} gapDays
 * @returns {Interval[]}
 */
export function coverageIntervals(batches, gapDays) {
  const sorted = batches.map((b) => ({ from: b.coversFrom, to: b.coversTo }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  /** @type {Interval[]} */
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.from <= addDays(last.to, 1 + gapDays)) {
      if (iv.to > last.to) last.to = iv.to;
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/**
 * @param {Interval[]} intervals
 * @param {string} month YYYY-MM
 * @returns {Status}
 */
export function monthStatus(intervals, month) {
  const s = monthStart(month);
  const e = monthEnd(month);
  if (intervals.some((iv) => iv.from <= s && iv.to >= e)) return 'covered';
  if (intervals.some((iv) => iv.from <= e && iv.to >= s)) return 'partial';
  return 'missing';
}

/**
 * Coverage intervals for every account, keyed by account id (empty for accounts without batches).
 * @param {State} state
 * @param {{coverageGapDays:number}} tuning
 * @returns {Map<string, Interval[]>}
 */
function intervalsByAccount(state, tuning) {
  return new Map(state.accounts.map((a) => [
    a.id, coverageIntervals(state.batches.filter((b) => b.accountId === a.id), tuning.coverageGapDays),
  ]));
}

/**
 * @param {State} state
 * @param {Map<string, Interval[]>} ivs
 * @returns {{account:Account, ivs:Interval[]}[]} non-placeholder accounts that have coverage
 */
function coveredAccounts(state, ivs) {
  return state.accounts
    .map((account) => ({ account, ivs: ivs.get(account.id) ?? [] }))
    .filter((x) => x.account.kind !== 'placeholder' && x.ivs.length > 0);
}

/**
 * @param {{account:Account, ivs:Interval[]}[]} covered
 * @returns {string[]}
 */
function tableMonths(covered) {
  if (covered.length === 0) return [];
  let min = '9999-12';
  let max = '0000-01';
  for (const { ivs } of covered) {
    const a = monthOf(ivs[0].from);
    const b = monthOf(ivs[ivs.length - 1].to);
    if (a < min) min = a;
    if (b > max) max = b;
  }
  return monthRange(min, max);
}

/**
 * @param {State} state
 * @param {{coverageGapDays:number}} tuning
 * @returns {{months:string[], rows:{account:Account, cells:{month:string, status:Status|'not-itemised', count:number}[]}[]}}
 */
export function accountsByMonth(state, tuning) {
  const ivs = intervalsByAccount(state, tuning);
  const months = tableMonths(coveredAccounts(state, ivs));
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const t of state.transactions) {
    const k = `${t.accountId}|${monthOf(t.date)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rows = state.accounts.map((account) => ({
    account,
    cells: months.map((month) => account.kind === 'placeholder'
      ? { month, status: /** @type {const} */ ('not-itemised'), count: 0 }
      : { month, status: monthStatus(ivs.get(account.id) ?? [], month), count: counts.get(`${account.id}|${month}`) ?? 0 }),
  }));
  return { months, rows };
}

/**
 * @param {State} state
 * @param {{coverageGapDays:number}} tuning
 * @returns {string[]} ascending
 */
export function completeMonths(state, tuning) {
  const ivs = intervalsByAccount(state, tuning);
  const covered = coveredAccounts(state, ivs);
  return tableMonths(covered).filter((month) => {
    const s = monthStart(month);
    const e = monthEnd(month);
    let anyFull = false;
    for (const { ivs: list } of covered) {
      const full = monthStatus(list, month) === 'covered';
      if (full) anyFull = true;
      else if (list[0].from < s && list[list.length - 1].to > e) return false;
    }
    return anyFull;
  });
}

/**
 * @param {State} state
 * @param {{windowMonths:number, coverageGapDays:number}} tuning
 * @returns {Window}
 */
export function analysisWindow(state, tuning) {
  const complete = completeMonths(state, tuning);
  if (complete.length === 0) {
    const months = [...new Set(state.transactions.map((t) => monthOf(t.date)))].sort();
    return {
      months, complete: false,
      accountMonths: new Map(state.accounts.map((a) => [a.id, new Set(months)])),
    };
  }
  const months = complete.slice(-tuning.windowMonths);
  const ivs = intervalsByAccount(state, tuning);
  return {
    months, complete: true,
    accountMonths: new Map(state.accounts.map((a) => [a.id, new Set(
      a.kind === 'placeholder' ? [] : months.filter((m) => monthStatus(ivs.get(a.id) ?? [], m) === 'covered'),
    )])),
  };
}

/**
 * Non-placeholder accounts whose coverage ends before the end of the last window month.
 * @param {State} state
 * @param {Window} window
 * @returns {Account[]}
 */
export function staleAccounts(state, window) {
  if (window.months.length === 0) return [];
  const end = monthEnd(window.months[window.months.length - 1]);
  return state.accounts.filter((a) => {
    if (a.kind === 'placeholder') return false;
    const bs = state.batches.filter((b) => b.accountId === a.id);
    if (bs.length === 0) return false;
    return bs.reduce((m, b) => (b.coversTo > m ? b.coversTo : m), '') < end;
  });
}
