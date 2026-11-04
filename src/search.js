/** @import {Transaction} from './types.js' */
import { parseDate, daysBetween } from './dates.js';
import { parseMoneyQuery, currencyExponent } from './money.js';

/**
 * Smallest day distance from a row to the query date, or null if the query is not a date.
 * @param {{day:string,month:string,year?:string}} q
 * @param {string} rowDate
 * @returns {number|null}
 */
function dateDistance(q, rowDate) {
  if (q.year) {
    const iso = parseDate(`${q.day}/${q.month}/${q.year}`, 'DD/MM/YYYY');
    return iso ? Math.abs(daysBetween(iso, rowDate)) : null;
  }
  const y = Number(rowDate.slice(0, 4));
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    const iso = parseDate(`${q.day}/${q.month}/${String(yy).padStart(4, '0')}`, 'DD/MM/YYYY');
    if (!iso) continue;
    const d = Math.abs(daysBetween(iso, rowDate));
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * @param {string} query
 * @returns {{day:string,month:string,year?:string}|null}
 */
function parseDateQuery(query) {
  const m = /^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/.exec(query);
  if (!m) return null;
  const q = { day: m[1], month: m[2], year: m[3] };
  // 29/02 is valid if any leap year allows it.
  const probe = q.year ?? '2024';
  return parseDate(`${q.day}/${q.month}/${probe}`, 'DD/MM/YYYY') ? q : null;
}

/**
 * Find transactions by text, amount or date. Union of the three kinds of match.
 * @param {Transaction[]} txns
 * @param {string} query
 * @param {{bucketId?:string,from?:string,to?:string}} filters
 * @param {{matchDays:number}} opts
 * @returns {Transaction[]}
 */
export function searchTransactions(txns, query, filters, opts) {
  const rows = txns.filter((t) =>
    (!filters.bucketId || t.bucketId === filters.bucketId) &&
    (!filters.from || t.date >= filters.from) &&
    (!filters.to || t.date <= filters.to));
  /** @param {Transaction} a @param {Transaction} b */
  const newest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const q = query.trim();
  if (q === '') return rows.slice().sort(newest);

  const needle = q.toLowerCase();
  const dq = parseDateQuery(q);
  /** @type {{t:Transaction,dist:number|null}[]} */
  const hits = [];
  for (const t of rows) {
    let dist = null;
    if (dq) {
      const d = dateDistance(dq, t.date);
      if (d !== null && d <= opts.matchDays) dist = d;
    }
    const other = t.rawText.toLowerCase().includes(needle) ||
      parseMoneyQuery(q, currencyExponent(t.currency)) === Math.abs(t.amountMinor);
    if (dist !== null || other) hits.push({ t, dist });
  }
  if (!dq) return hits.map((h) => h.t).sort(newest);
  const byDate = hits.filter((h) => h.dist !== null)
    .sort((a, b) => /** @type {number} */ (a.dist) - /** @type {number} */ (b.dist) || newest(a.t, b.t));
  const rest = hits.filter((h) => h.dist === null).map((h) => h.t).sort(newest);
  return [...byDate.map((h) => h.t), ...rest];
}
