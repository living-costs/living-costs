/** @import {State, Changes, Rule, Transaction, Bucket, Override} from './types.js' */
import { normalise } from './normalise.js';
import { periodKey } from './dates.js';
import { cmp } from './order.js';

/**
 * Decide whether an amount rule takes a transaction. Increments the count on 'rule'.
 * @param {Rule} rule
 * @param {{date:string,amountMinor:number,rawText:string,rawType?:string}} txn
 * @param {Map<string, number>} counts keyed `${rule.id}|${periodKey}`
 * @returns {'rule'|'flag'|'none'}
 */
export function routeByRule(rule, txn, counts) {
  if (rule.pattern !== normalise(txn.rawText, txn.rawType) || rule.amountMinor !== txn.amountMinor) return 'none';
  const ck = `${rule.id}|${periodKey(txn.date, rule.expected.period)}`;
  const n = counts.get(ck) ?? 0;
  if (n < rule.expected.count) {
    counts.set(ck, n + 1);
    return 'rule';
  }
  return 'flag';
}

/**
 * Stable sort by date, input order breaking ties.
 * @template {{date:string}} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function byDate(rows) {
  return rows.map((r, i) => ({ r, i }))
    .sort((a, b) => cmp(a.r.date, b.r.date) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Add a raw text to a bucket's examples (max 5 distinct). Returns true if changed.
 * @param {Bucket} bucket
 * @param {string} rawText
 * @returns {boolean}
 */
export function addExample(bucket, rawText) {
  if (bucket.exampleRawTexts.length >= 5 || bucket.exampleRawTexts.includes(rawText)) return false;
  bucket.exampleRawTexts.push(rawText);
  return true;
}

/**
 * @param {State} state
 * @param {{sourceBucketId:string,amountMinor:number,expected:{count:number,period:'week'|'month'|'year'},displayName:string}} args
 * @returns {Changes}
 */
export function createAmountRule(state, { sourceBucketId, amountMinor, expected, displayName }) {
  const source = state.buckets.find((b) => b.id === sourceBucketId);
  if (!source) throw new Error(`Unknown bucket ${sourceBucketId}`);
  const matching = byDate(state.transactions.filter((t) => t.bucketId === sourceBucketId && t.amountMinor === amountMinor));
  const pattern = matching.length ? normalise(matching[0].rawText, matching[0].rawType) : (source.keys[0] ?? '');
  /** @type {Rule} */
  const rule = {
    id: crypto.randomUUID(), pattern, matchType: 'keyAmount', amountMinor, expected,
    bucketId: crypto.randomUUID(),
  };
  /** @type {Bucket} */
  const bucket = { id: rule.bucketId, keys: [], displayName, exampleRawTexts: [] };
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Transaction[]} */
  const changed = [];
  for (const t of matching) {
    if (normalise(t.rawText, t.rawType) !== pattern) continue;
    const verdict = routeByRule(rule, t, counts);
    if (verdict === 'rule') {
      addExample(bucket, t.rawText);
      const { flaggedRuleId, ...rest } = t;
      changed.push({ ...rest, bucketId: bucket.id });
    } else if (verdict === 'flag') {
      changed.push({ ...t, flaggedRuleId: rule.id });
    }
  }
  return { put: { buckets: [bucket], rules: [rule], transactions: changed } };
}

/**
 * @param {State} state
 * @param {string} fingerprint
 * @param {'rule'|'source'} decision
 * @returns {Changes}
 */
export function resolveFlag(state, fingerprint, decision) {
  /** @type {Override} */
  const override = { ...(state.overrides.get(fingerprint) ?? { fingerprint }), flagDecision: decision };
  /** @type {Changes} */
  const changes = { put: { overrides: [override] } };
  const txn = state.transactions.find((t) => t.fingerprint === fingerprint);
  if (txn) {
    const rule = state.rules.find((r) => r.id === txn.flaggedRuleId);
    const { flaggedRuleId, ...rest } = txn;
    const bucketId = decision === 'rule' && rule ? rule.bucketId : txn.bucketId;
    if (decision === 'rule' && rule) {
      const rb = state.buckets.find((b) => b.id === rule.bucketId);
      if (rb) {
        const copy = { ...rb, exampleRawTexts: [...rb.exampleRawTexts] };
        if (addExample(copy, txn.rawText)) changes.put = { ...changes.put, buckets: [copy] };
      }
    }
    changes.put = { ...changes.put, transactions: [{ ...rest, bucketId }] };
  }
  return changes;
}
