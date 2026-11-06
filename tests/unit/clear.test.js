import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState } from '../../src/changes.js';
import { mergeBuckets, setBucketStopped } from '../../src/buckets.js';
import { normalise } from '../../src/normalise.js';
import { setCategoryOverride } from '../../src/overrides.js';
import { clearDecisions } from '../../src/clear.js';
import { fixtureState } from './helpers/fixture-state.js';

/** The state a replaceAll of these changes leaves. @param {any} changes */
function replaced(changes) {
  const s = emptyState();
  applyToState(s, changes);
  return s;
}

/** Fixture state with every kind of decision: categories, rules, pairs, a placeholder card, and
 * also a merge, a rename, a Stopped mark and an override. */
async function decided() {
  const s = await fixtureState();
  const [a, b] = s.buckets.filter((x) => x.keys.length === 1);
  applyToState(s, mergeBuckets(s, a.id, [b.id], { displayName: 'Merged and renamed' }));
  applyToState(s, setBucketStopped(s, a.id, '2026-01-01'));
  const t = s.transactions[0];
  applyToState(s, setCategoryOverride(s, t.fingerprint, s.categories[0].id));
  return s;
}

test('clearing removes every decision', async () => {
  const s = await decided();
  assert.ok(s.rules.length && s.overrides.size && s.transferPairs.size, 'the fixture has decisions to clear');
  assert.ok(s.accounts.some((a) => a.repaymentBucketIds.length));
  const after = replaced(clearDecisions(s));
  assert.deepEqual(after.rules, []);
  assert.equal(after.overrides.size, 0);
  assert.equal(after.transferPairs.size, 0);
  for (const a of after.accounts) assert.deepEqual(a.repaymentBucketIds, [], a.name);
  for (const b of after.buckets) {
    assert.equal(b.categoryId, undefined, b.displayName);
    assert.equal(b.stoppedAfter, undefined, b.displayName);
  }
  for (const t of after.transactions) assert.equal(t.flaggedRuleId, undefined);
});

test('accounts, batches, categories, settings and transactions stay', async () => {
  const s = await decided();
  const after = replaced(clearDecisions(s));
  assert.deepEqual(after.settings, s.settings);
  assert.deepEqual(after.categories, s.categories);
  assert.deepEqual(after.batches, s.batches);
  assert.deepEqual(after.accounts, s.accounts.map((a) => ({ ...a, repaymentBucketIds: [] })));
  /** @param {any} t */
  const bare = ({ bucketId: _b, flaggedRuleId: _f, ...t }) => t;
  const byId = (/** @type {any[]} */ ts) => ts.map(bare).toSorted((x, y) => (x.id < y.id ? -1 : 1));
  assert.deepEqual(byId(after.transactions), byId(s.transactions));
});

test('buckets go back to one per normalised text, as an import makes them', async () => {
  const s = await decided();
  const after = replaced(clearDecisions(s));
  const ids = new Set(after.buckets.map((b) => b.id));
  /** @type {Map<string, number>} */
  const perKey = new Map();
  for (const t of after.transactions) {
    assert.ok(ids.has(t.bucketId), 'every transaction is in a bucket that exists');
    const b = after.buckets.find((x) => x.id === t.bucketId);
    assert.deepEqual(b?.keys, [normalise(t.rawText, t.rawType)]);
    perKey.set(b.keys[0], (perKey.get(b.keys[0]) ?? 0) + 1);
  }
  assert.equal(perKey.size, after.buckets.length, 'no empty buckets, and one bucket per key');
  for (const b of after.buckets) {
    assert.equal(b.displayName, b.keys[0]);
    assert.ok(b.exampleRawTexts.length > 0);
  }
  assert.ok(!after.buckets.some((b) => b.displayName === 'Merged and renamed'));
});

test('clearing with nothing imported keeps the setup', () => {
  const s = emptyState();
  s.categories.push({ id: 'c1', name: 'Food', kind: 'spend', position: 0 });
  s.accounts.push({ id: 'a1', name: 'x', currency: 'GBP', kind: 'card', repaymentBucketIds: ['gone'] });
  const after = replaced(clearDecisions(s));
  assert.deepEqual(after.categories, s.categories);
  assert.deepEqual(after.accounts, [{ ...s.accounts[0], repaymentBucketIds: [] }]);
  assert.deepEqual(after.buckets, []);
  assert.deepEqual(after.transactions, []);
});

test('clearing does not change the state it is given', async () => {
  const s = await decided();
  const before = structuredClone(s);
  clearDecisions(s);
  assert.deepEqual(s, before);
});
