/** @import {State, Transaction, Override, Bucket, Category, CategoryKind} from './types.js' */

/** @typedef {{paired:Set<string>,overrides:Map<string,Override>,buckets:Map<string,Bucket>,categories:Map<string,Category>}} ResolveContext */
/** @typedef {{amountMinor:number,categoryId:string|null}} Part */
/** @typedef {{source:'transfer'|'split'|'override'|'bucket'|'none',parts:Part[]}} Resolution */

/**
 * @param {State} state
 * @returns {ResolveContext}
 */
export function buildContext(state) {
  const paired = new Set();
  for (const p of state.transferPairs.values()) {
    if (p.status === 'confirmed') {
      paired.add(p.fingerprintA);
      paired.add(p.fingerprintB);
    }
  }
  return {
    paired,
    overrides: state.overrides,
    buckets: new Map(state.buckets.map((b) => [b.id, b])),
    categories: new Map(state.categories.map((c) => [c.id, c])),
  };
}

/**
 * What a transaction counts as: confirmed transfer, split, override, bucket, else none.
 * @param {Transaction} txn
 * @param {ResolveContext} ctx
 * @returns {Resolution}
 */
export function resolve(txn, ctx) {
  if (ctx.paired.has(txn.fingerprint)) {
    return { source: 'transfer', parts: [{ amountMinor: txn.amountMinor, categoryId: null }] };
  }
  return resolveUnpaired(txn, ctx);
}

/**
 * `resolve` without the confirmed-pair check: what the transaction would count as on its own.
 * @param {Transaction} txn
 * @param {ResolveContext} ctx
 * @returns {Resolution}
 */
export function resolveUnpaired(txn, ctx) {
  const none = () => ({ source: /** @type {const} */ ('none'), parts: [{ amountMinor: txn.amountMinor, categoryId: null }] });
  const ov = ctx.overrides.get(txn.fingerprint);
  if (ov?.splits && ov.splits.length > 0) {
    return {
      source: 'split',
      parts: ov.splits.map((s) => ({ amountMinor: s.amountMinor, categoryId: ctx.categories.has(s.categoryId) ? s.categoryId : null })),
    };
  }
  if (ov?.categoryId) {
    if (!ctx.categories.has(ov.categoryId)) return none();
    return { source: 'override', parts: [{ amountMinor: txn.amountMinor, categoryId: ov.categoryId }] };
  }
  const catId = ctx.buckets.get(txn.bucketId)?.categoryId;
  if (catId && ctx.categories.has(catId)) {
    return { source: 'bucket', parts: [{ amountMinor: txn.amountMinor, categoryId: catId }] };
  }
  return none();
}

/**
 * @param {Part} part
 * @param {ResolveContext} ctx
 * @returns {CategoryKind|null}
 */
export function categoryKindOf(part, ctx) {
  if (!part.categoryId) return null;
  return ctx.categories.get(part.categoryId)?.kind ?? null;
}
