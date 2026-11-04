/** @import {State, Changes, Transaction, Bucket, Account} from './types.js' */
import { normalise } from './normalise.js';
import { routeByRule, byDate, addExample } from './rules.js';
import { periodKey } from './dates.js';

/**
 * @param {State} state
 * @param {Omit<Transaction,'bucketId'|'flaggedRuleId'>[]} incoming
 * @returns {Changes}
 */
export function assignBuckets(state, incoming) {
  /** @type {Map<string, string>} */
  const byKey = new Map();
  /** @type {Map<string, Bucket>} */
  const work = new Map();
  for (const b of state.buckets) {
    work.set(b.id, { ...b, exampleRawTexts: [...b.exampleRawTexts] });
    for (const k of b.keys) byKey.set(k, b.id);
  }
  /** @type {Set<string>} */
  const changedBuckets = new Set();
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const rule of state.rules) {
    for (const t of state.transactions) {
      if (t.bucketId !== rule.bucketId || t.amountMinor !== rule.amountMinor) continue;
      if (normalise(t.rawText, t.rawType) !== rule.pattern) continue;
      const ck = `${rule.id}|${periodKey(t.date, rule.expected.period)}`;
      counts.set(ck, (counts.get(ck) ?? 0) + 1);
    }
  }
  /** @type {Transaction[]} */
  const out = [];
  for (const t of byDate(incoming)) {
    const key = normalise(t.rawText, t.rawType);
    let sourceId = byKey.get(key);
    if (!sourceId) {
      sourceId = crypto.randomUUID();
      work.set(sourceId, { id: sourceId, keys: [key], displayName: key, exampleRawTexts: [] });
      byKey.set(key, sourceId);
      changedBuckets.add(sourceId);
    }
    let target = sourceId;
    /** @type {string|undefined} */
    let flaggedRuleId;
    const rule = state.rules.find((r) => r.pattern === key && r.amountMinor === t.amountMinor);
    if (rule) {
      const decision = state.overrides.get(t.fingerprint)?.flagDecision;
      if (decision === 'rule') {
        const ck = `${rule.id}|${periodKey(t.date, rule.expected.period)}`;
        counts.set(ck, (counts.get(ck) ?? 0) + 1);
        target = rule.bucketId;
      } else if (decision === 'source') {
        target = sourceId;
      } else {
        const verdict = routeByRule(rule, t, counts);
        if (verdict === 'rule') target = rule.bucketId;
        else if (verdict === 'flag') flaggedRuleId = rule.id;
      }
    }
    const tb = work.get(target);
    if (tb && addExample(tb, t.rawText)) changedBuckets.add(target);
    /** @type {Transaction} */
    const txn = { ...t, bucketId: target };
    if (flaggedRuleId) txn.flaggedRuleId = flaggedRuleId;
    out.push(txn);
  }
  /** @type {Changes} */
  const changes = { put: { transactions: out } };
  if (changedBuckets.size && changes.put) changes.put.buckets = [...changedBuckets].map((id) => /** @type {Bucket} */ (work.get(id)));
  return changes;
}

/**
 * @param {State} state
 * @param {string} survivorId
 * @param {string[]} mergedIds
 * @param {{displayName:string,categoryId?:string}} opts
 * @returns {Changes}
 */
export function mergeBuckets(state, survivorId, mergedIds, { displayName, categoryId }) {
  const survivor = state.buckets.find((b) => b.id === survivorId);
  if (!survivor) throw new Error(`Unknown bucket ${survivorId}`);
  const merged = new Set(mergedIds);
  const keys = [...survivor.keys];
  const examples = [...survivor.exampleRawTexts];
  for (const id of mergedIds) {
    const b = state.buckets.find((x) => x.id === id);
    if (!b) continue;
    for (const k of b.keys) if (!keys.includes(k)) keys.push(k);
    for (const e of b.exampleRawTexts) if (!examples.includes(e)) examples.push(e);
  }
  /** @type {Bucket} */
  const next = { id: survivor.id, keys, displayName, exampleRawTexts: examples.slice(0, 5) };
  if (categoryId !== undefined) next.categoryId = categoryId;
  const transactions = state.transactions.filter((t) => merged.has(t.bucketId)).map((t) => ({ ...t, bucketId: survivorId }));
  const rules = state.rules.filter((r) => merged.has(r.bucketId)).map((r) => ({ ...r, bucketId: survivorId }));
  /** @type {Account[]} */
  const accounts = state.accounts.filter((a) => a.repaymentBucketIds.some((id) => merged.has(id))).map((a) => ({
    ...a,
    repaymentBucketIds: [...new Set(a.repaymentBucketIds.map((id) => (merged.has(id) ? survivorId : id)))],
  }));
  /** @type {Changes} */
  const changes = { put: { buckets: [next] }, del: { buckets: mergedIds.filter((id) => id !== survivorId) } };
  if (changes.put) {
    if (transactions.length) changes.put.transactions = transactions;
    if (rules.length) changes.put.rules = rules;
    if (accounts.length) changes.put.accounts = accounts;
  }
  return changes;
}

/**
 * @param {State} state
 * @param {string} bucketId
 * @param {string|undefined} categoryId
 * @returns {Changes}
 */
export function setBucketCategory(state, bucketId, categoryId) {
  const b = state.buckets.find((x) => x.id === bucketId);
  if (!b) throw new Error(`Unknown bucket ${bucketId}`);
  const { categoryId: _old, ...rest } = b;
  return { put: { buckets: [categoryId === undefined ? rest : { ...rest, categoryId }] } };
}
