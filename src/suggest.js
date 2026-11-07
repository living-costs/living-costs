// Merchant-name matching for category suggestions. The merchant list is credited to
// EmmaExcel/merchant-categorizer on GitHub.

import MERCHANTS from './merchants.js';

/** @import {State, Bucket, Category} from './types.js' */

const SUFFIX = /(\.CO\.UK|\.COM|\.UK|\.NET|\.ORG)$/;

/**
 * Upper-case text with punctuation removed, so "SAINSBURY'S" and "Sainsburys" compare equal.
 * @param {string} text
 * @returns {string}
 */
export function squash(text) {
  const tokens = text.toUpperCase().replace(/&/g, ' AND ').replace(/\+/g, ' PLUS ')
    .split(/[^A-Z0-9.'’]+/);
  const out = [];
  for (let t of tokens) {
    t = t.replace(/^WWW\.?(?=.)/, '').replace(SUFFIX, '').replace(/[.'’]/g, '');
    t = t.replace(/(?<=.)COUK$/, '');
    if (t) out.push(t);
  }
  return out.join(' ');
}

/** @type {WeakMap<object[], {squashed: string, glued: string, defaultId: string}[]>} */
const cache = new WeakMap();

/**
 * @param {{name: string, defaultId: string}[]} merchants
 */
function prepared(merchants) {
  let list = cache.get(merchants);
  if (!list) {
    list = [];
    for (const m of merchants) {
      const squashed = squash(m.name);
      if (squashed) list.push({ squashed, glued: squashed.includes(' ') ? squashed.replace(/ /g, '') : '', defaultId: m.defaultId });
    }
    cache.set(merchants, list);
  }
  return list;
}

/**
 * The defaultId of the longest merchant name found in the bucket keys, or null for no match
 * or a tie between different categories.
 * @param {string[]} keys
 * @param {{name: string, defaultId: string}[]} merchants
 * @returns {string | null}
 */
export function matchKeys(keys, merchants) {
  const list = prepared(merchants);
  let best = 0;
  /** @type {Set<string>} */
  let ids = new Set();
  for (const key of keys) {
    const s = squash(key);
    const padded = ` ${s} `;
    const tokens = s.split(' ');
    for (const m of list) {
      const hit = padded.includes(` ${m.squashed} `) || (m.glued !== '' && tokens.includes(m.glued));
      if (!hit || m.squashed.length < best) continue;
      if (m.squashed.length > best) { best = m.squashed.length; ids = new Set(); }
      ids.add(m.defaultId);
    }
  }
  return ids.size === 1 ? [...ids][0] : null;
}

/**
 * @param {State} state
 * @param {Bucket} bucket
 * @returns {boolean} true when the bucket has no category, or its category no longer exists
 */
function uncategorised(state, bucket) {
  return bucket.categoryId === undefined || !state.categories.some((c) => c.id === bucket.categoryId);
}

/**
 * @param {State} state
 * @param {Bucket} bucket
 * @param {number} total signed sum of the bucket's transactions
 * @param {{name: string, defaultId: string}[]} merchants
 * @returns {Category | null}
 */
function suggestFor(state, bucket, total, merchants) {
  if (total >= 0 || !uncategorised(state, bucket)) return null;
  const id = matchKeys(bucket.keys, merchants);
  if (id === null) return null;
  return state.categories.find((c) => c.defaultId === id && c.kind === 'spend') ?? null;
}

/**
 * The spending category to suggest for an uncategorised bucket whose net total is spending.
 * @param {State} state
 * @param {Bucket} bucket
 * @param {{name: string, defaultId: string}[]} [merchants]
 * @returns {Category | null}
 */
export function suggestCategory(state, bucket, merchants = MERCHANTS) {
  let total = 0;
  for (const t of state.transactions) if (t.bucketId === bucket.id) total += t.amountMinor;
  return suggestFor(state, bucket, total, merchants);
}

/**
 * Suggestions for every bucket that has one, keyed by bucket id.
 * @param {State} state
 * @param {{name: string, defaultId: string}[]} [merchants]
 * @returns {Map<string, Category>}
 */
export function bucketSuggestions(state, merchants = MERCHANTS) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  for (const t of state.transactions) totals.set(t.bucketId, (totals.get(t.bucketId) ?? 0) + t.amountMinor);
  /** @type {Map<string, Category>} */
  const out = new Map();
  for (const b of state.buckets) {
    const c = suggestFor(state, b, totals.get(b.id) ?? 0, merchants);
    if (c) out.set(b.id, c);
  }
  return out;
}
