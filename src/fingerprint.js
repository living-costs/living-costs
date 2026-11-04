/** @import {MappedRow} from './mapping.js' */

/**
 * @param {string} accountId
 * @param {string} date
 * @param {number} amountMinor
 * @param {string} rawText
 * @param {number} n
 * @returns {string}
 */
export function fingerprint(accountId, date, amountMinor, rawText, n) {
  return `${accountId}|${date}|${amountMinor}|${rawText}|${n}`;
}

/**
 * Adds a fingerprint to each row. `n` is the 0-based ordinal among rows with the
 * same (date, amountMinor, rawText) in the rows given. No state is kept between calls.
 * @param {string} accountId
 * @param {MappedRow[]} rows
 * @returns {(MappedRow & {fingerprint: string})[]}
 */
export function withFingerprints(accountId, rows) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return rows.map((row) => {
    const key = JSON.stringify([row.date, row.amountMinor, row.rawText]);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { ...row, fingerprint: fingerprint(accountId, row.date, row.amountMinor, row.rawText, n) };
  });
}
