/** @import {Bucket, Transaction, Override} from './types.js' */
import { currencyExponent } from './money.js';
import { median } from './typical.js';
import { cmp, compareNames } from './order.js';
import { daysBetween } from './dates.js';

/**
 * @typedef {{relatedMinWordLength:number,relatedStopWords:string[],relatedMaxShown:number,
 *   unusualMultiple:number,unusualMinMajor:number,repeatingMinCount:number}} InsightTuning
 */

/**
 * Whole upper-case words from a bucket's name and keys.
 * @param {Bucket} bucket
 * @param {InsightTuning} tuning
 * @returns {Set<string>}
 */
export function bucketWords(bucket, tuning) {
  /** @type {Set<string>} */
  const words = new Set();
  for (const text of [bucket.displayName, ...bucket.keys]) {
    for (const w of text.toUpperCase().match(/[A-Z]+/g) ?? []) {
      if (w.length >= tuning.relatedMinWordLength && !tuning.relatedStopWords.includes(w)) words.add(w);
    }
  }
  return words;
}

/**
 * Other buckets sharing at least one whole word, best first.
 * @param {Bucket} bucket
 * @param {Bucket[]} buckets
 * @param {Map<string, number>} absTotals
 * @param {InsightTuning} tuning
 * @returns {Bucket[]}
 */
export function relatedBuckets(bucket, buckets, absTotals, tuning) {
  const mine = bucketWords(bucket, tuning);
  const scored = [];
  for (const other of buckets) {
    if (other.id === bucket.id) continue;
    let shared = 0;
    for (const w of bucketWords(other, tuning)) if (mine.has(w)) shared++;
    if (shared > 0) scored.push({ other, shared, total: absTotals.get(other.id) ?? 0 });
  }
  scored.sort((a, b) => b.shared - a.shared || b.total - a.total
    || compareNames(a.other.displayName, b.other.displayName) || cmp(a.other.id, b.other.id));
  return scored.slice(0, tuning.relatedMaxShown).map((s) => s.other);
}

/**
 * Transactions far above the bucket's median amount.
 * @param {Transaction[]} txns the whole bucket
 * @param {Map<string, Override>} overrides by fingerprint
 * @param {InsightTuning} tuning
 * @returns {Transaction[]}
 */
export function unusualTransactions(txns, overrides, tuning) {
  if (txns.length === 0) return [];
  const med = median(txns.map((t) => Math.abs(t.amountMinor)));
  return txns.filter((t) => {
    const abs = Math.abs(t.amountMinor);
    if (!(abs > tuning.unusualMultiple * med)) return false;
    if (abs < tuning.unusualMinMajor * 10 ** currencyExponent(t.currency)) return false;
    const o = overrides.get(t.fingerprint);
    return !(o && (o.unusualDismissed || o.categoryId || o.splits));
  });
}

/** @type {{period: 'week'|'month'|'year', min: number, max: number}[]} */
const BANDS = [
  { period: 'week', min: 5, max: 9 },
  { period: 'month', min: 25, max: 35 },
  { period: 'year', min: 350, max: 380 },
];

/**
 * Exact amounts that recur at a regular interval inside a mixed bucket.
 * @param {Transaction[]} txns
 * @param {InsightTuning} tuning
 * @returns {{amountMinor:number,count:number,period:'week'|'month'|'year',expectedCount:1}[]}
 */
export function repeatingAmounts(txns, tuning) {
  /** @type {Map<number, string[]>} */
  const byAmount = new Map();
  for (const t of txns) {
    const list = byAmount.get(t.amountMinor);
    if (list) list.push(t.date); else byAmount.set(t.amountMinor, [t.date]);
  }
  if (byAmount.size < 2) return [];
  /** @type {{amountMinor:number,count:number,period:'week'|'month'|'year',expectedCount:1}[]} */
  const out = [];
  for (const [amountMinor, dates] of byAmount) {
    if (dates.length < tuning.repeatingMinCount) continue;
    const sorted = [...dates].sort();
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1], sorted[i]));
    const med = median(gaps);
    const band = BANDS.find((b) => med >= b.min && med <= b.max);
    if (!band) continue;
    const inBand = gaps.filter((g) => g >= band.min && g <= band.max).length;
    if (inBand * 5 >= gaps.length * 4) out.push({ amountMinor, count: dates.length, period: band.period, expectedCount: 1 });
  }
  return out.sort((a, b) => b.count - a.count || a.amountMinor - b.amountMinor);
}
