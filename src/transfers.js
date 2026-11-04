// Transfer pairs and cards you don't import.
// suggestPairs finds likely transfers between two imported accounts; the user confirms or
// rejects each one with decidePair, and unpair removes a decision. markPlaceholder records a card
// whose statements aren't imported: its repayments count as spending in a not-itemised category
// until that card is imported and the repayments are confirmed as transfers.
// Every function returns Changes and never mutates the state it is given.

/** @import {State, Changes, Transaction, TransferPair, Account} from './types.js' */
import { daysBetween } from './dates.js';
import { createCategory } from './categories.js';
import { setBucketCategory } from './buckets.js';
import { combine } from './changes.js';
import { cmp } from './order.js';

/** @typedef {{a: Transaction, b: Transaction, days: number}} Suggestion */

/**
 * The store key for a pair: the two fingerprints sorted and joined with a newline, so the same
 * two transactions give the same key in either order.
 * @param {string} fpA
 * @param {string} fpB
 * @returns {string}
 */
export function pairKey(fpA, fpB) {
  return fpA < fpB ? `${fpA}\n${fpB}` : `${fpB}\n${fpA}`;
}

/**
 * Likely transfers. A candidate is a debit and a credit of exactly opposite, non-zero amounts in
 * the same currency, in two different accounts that are not placeholders, at most
 * `transactionMatchDays` apart. Neither side may already be in a confirmed pair, and a rejected
 * pair is never offered. Matching is greedy: the fewest days apart first, then the earlier date,
 * and each transaction is in at most one suggestion. `a` is the money-out side.
 * @param {State} state
 * @param {{transactionMatchDays: number}} tuning
 * @returns {Suggestion[]}
 */
export function suggestPairs(state, tuning) {
  const placeholders = new Set(state.accounts.filter((a) => a.kind === 'placeholder').map((a) => a.id));
  const paired = new Set();
  for (const p of state.transferPairs.values()) {
    if (p.status === 'confirmed') { paired.add(p.fingerprintA); paired.add(p.fingerprintB); }
  }
  const free = state.transactions.filter((t) => t.amountMinor !== 0 && !placeholders.has(t.accountId) && !paired.has(t.fingerprint));

  /** @type {Map<string, Transaction[]>} credits by currency and amount */
  const credits = new Map();
  for (const t of free) {
    if (t.amountMinor <= 0) continue;
    const k = `${t.currency}|${t.amountMinor}`;
    const list = credits.get(k);
    if (list) list.push(t); else credits.set(k, [t]);
  }

  /** @type {(Suggestion & {first: string})[]} */
  const candidates = [];
  for (const a of free) {
    if (a.amountMinor >= 0) continue;
    for (const b of credits.get(`${a.currency}|${-a.amountMinor}`) ?? []) {
      if (b.accountId === a.accountId) continue;
      const days = Math.abs(daysBetween(a.date, b.date));
      if (days > tuning.transactionMatchDays) continue;
      const rejected = state.transferPairs.get(pairKey(a.fingerprint, b.fingerprint))?.status === 'rejected';
      if (rejected) continue;
      candidates.push({ a, b, days, first: a.date < b.date ? a.date : b.date });
    }
  }
  candidates.sort((x, y) => x.days - y.days || cmp(x.first, y.first)
    || cmp(x.a.fingerprint, y.a.fingerprint) || cmp(x.b.fingerprint, y.b.fingerprint));

  const used = new Set();
  /** @type {Suggestion[]} */
  const out = [];
  for (const { a, b, days } of candidates) {
    if (used.has(a.fingerprint) || used.has(b.fingerprint)) continue;
    used.add(a.fingerprint);
    used.add(b.fingerprint);
    out.push({ a, b, days });
  }
  return out;
}

/**
 * Record the user's decision on a pair: confirmed (both sides become transfers) or rejected
 * (never suggested again).
 * @param {Transaction} a
 * @param {Transaction} b
 * @param {TransferPair['status']} status
 * @returns {Changes}
 */
export function decidePair(a, b, status) {
  /** @type {TransferPair} */
  const pair = { key: pairKey(a.fingerprint, b.fingerprint), fingerprintA: a.fingerprint, fingerprintB: b.fingerprint, status };
  return { put: { transferPairs: [pair] } };
}

/**
 * Remove a pair decision, so the pair can be suggested again.
 * @param {string} key
 * @returns {Changes}
 */
export function unpair(key) {
  return { del: { transferPairs: [key] } };
}

/**
 * A card whose statements aren't imported, repaid through `bucketId`: a placeholder account, a
 * spend category "<card name> (not itemised)" (Variable; " 2", " 3"… is added if the name is
 * taken), and the bucket put in that category. Throws if the bucket doesn't exist or the name is
 * blank; the screen checks both first.
 * @param {State} state
 * @param {{bucketId: string, cardName: string, currency: string}} input
 * @returns {Changes}
 */
export function markPlaceholder(state, { bucketId, cardName, currency }) {
  const name = cardName.trim();
  if (!name) throw new Error('A card name is needed');
  const base = `${name} (not itemised)`;
  const taken = new Set(state.categories.map((c) => c.name.trim().toLowerCase()));
  let catName = base;
  for (let i = 2; taken.has(catName.toLowerCase()); i++) catName = `${base} ${i}`;
  const made = createCategory(state, { name: catName, kind: 'spend', budgetType: 'variable' });
  if ('error' in made) throw new Error(made.error);
  const category = made.put?.categories?.[0];
  if (!category) throw new Error('No category was made');
  /** @type {Account} */
  const account = { id: crypto.randomUUID(), name, currency, kind: 'placeholder', repaymentBucketIds: [bucketId] };
  return combine(made, { put: { accounts: [account] } }, setBucketCategory(state, bucketId, /** @type {{id: string}} */ (category).id));
}
