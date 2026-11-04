import { daysBetween } from './dates.js';
import { similarity } from './similarity.js';

/** @typedef {{fingerprint: string, date: string, amountMinor: number, rawText: string}} ExistingRow */
/** @typedef {{from: string, to: string}} Interval */

/**
 * Splits incoming rows into fresh, already imported (exact fingerprint match) and
 * review (same amount near an unclaimed existing row, inside the covered period).
 * Nothing is deleted or merged here.
 * @template {{fingerprint: string, date: string, amountMinor: number, rawText: string}} R
 * @param {{existing: ExistingRow[], incoming: R[], covered: Interval[], matchDays: number}} args
 * @returns {{fresh: R[], already: R[], review: {row: R, candidates: ExistingRow[]}[]}}
 */
export function classifyIncoming({ existing, incoming, covered, matchDays }) {
  /** @type {Map<string, ExistingRow>} */
  const byFp = new Map(existing.map((e) => [e.fingerprint, e]));
  /** @type {Set<string>} */
  const claimed = new Set();
  /** @type {Set<R>} */
  const exact = new Set();
  for (const row of incoming) {
    if (byFp.has(row.fingerprint) && !claimed.has(row.fingerprint)) {
      claimed.add(row.fingerprint);
      exact.add(row);
    }
  }
  const unclaimed = existing.filter((e) => !claimed.has(e.fingerprint));

  /** @type {R[]} */
  const fresh = [];
  /** @type {R[]} */
  const already = [];
  /** @type {{row: R, candidates: ExistingRow[]}[]} */
  const review = [];
  for (const row of incoming) {
    if (exact.has(row)) { already.push(row); continue; }
    const inside = covered.some((c) => row.date >= c.from && row.date <= c.to);
    if (!inside) { fresh.push(row); continue; }
    const candidates = unclaimed
      .filter((e) => e.amountMinor === row.amountMinor && Math.abs(daysBetween(e.date, row.date)) <= matchDays)
      .map((e) => ({ e, s: similarity(e.rawText, row.rawText), d: Math.abs(daysBetween(e.date, row.date)) }))
      .sort((p, q) => q.s - p.s || p.d - q.d)
      .map((x) => x.e);
    if (candidates.length) review.push({ row, candidates });
    else fresh.push(row);
  }
  return { fresh, already, review };
}
