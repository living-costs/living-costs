import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../../src/changes.js';
import { buildContext, resolve, categoryKindOf } from '../../src/resolve.js';

const cat = (id, kind) => ({ id, name: id, kind, position: 0 });
const txn = (fingerprint, amountMinor = -6069) => ({
  id: 't-' + fingerprint, fingerprint, accountId: 'a', batchId: 'b', date: '2026-09-24',
  amountMinor, currency: 'GBP', rawText: 'X', bucketId: 'bk',
});

function build({ bucketCat, override, pair } = {}) {
  const s = emptyState();
  s.categories = [cat('household', 'spend'), cat('gifts', 'spend'), cat('bucketcat', 'spend'), cat('other', 'income')];
  s.buckets = [{ id: 'bk', keys: ['x'], displayName: 'X', categoryId: bucketCat, exampleRawTexts: [] }];
  if (override) s.overrides.set('f1', { fingerprint: 'f1', ...override });
  if (pair) s.transferPairs.set('p', { key: 'p', fingerprintA: 'f1', fingerprintB: 'f2', status: pair });
  return s;
}
const run = (s) => resolve(txn('f1'), buildContext(s));

test('buildContext collects only confirmed pair fingerprints', () => {
  const ctx = buildContext(build({ pair: 'rejected' }));
  assert.equal(ctx.paired.size, 0);
  const ctx2 = buildContext(build({ pair: 'confirmed' }));
  assert.deepEqual([...ctx2.paired].sort(), ['f1', 'f2']);
});

test('precedence: transfer beats split beats override beats bucket beats none', () => {
  const ov = { categoryId: 'gifts', splits: [{ amountMinor: -4000, categoryId: 'household' }, { amountMinor: -2069, categoryId: 'gifts' }] };
  assert.equal(run(build({ bucketCat: 'bucketcat', override: ov, pair: 'confirmed' })).source, 'transfer');
  assert.equal(run(build({ bucketCat: 'bucketcat', override: ov })).source, 'split');
  assert.equal(run(build({ bucketCat: 'bucketcat', override: { categoryId: 'gifts' } })).source, 'override');
  assert.equal(run(build({ bucketCat: 'bucketcat' })).source, 'bucket');
  assert.deepEqual(run(build()), { source: 'none', parts: [{ amountMinor: -6069, categoryId: null }] });
});

test('transfer result has a single null-category part', () => {
  assert.deepEqual(run(build({ pair: 'confirmed' })), { source: 'transfer', parts: [{ amountMinor: -6069, categoryId: null }] });
});

test('split of -6069 resolves to its two parts', () => {
  const r = run(build({ override: { splits: [{ amountMinor: -4000, categoryId: 'household' }, { amountMinor: -2069, categoryId: 'gifts' }] } }));
  assert.equal(r.source, 'split');
  assert.deepEqual(r.parts, [{ amountMinor: -4000, categoryId: 'household' }, { amountMinor: -2069, categoryId: 'gifts' }]);
});

test('empty splits array is ignored', () => {
  assert.equal(run(build({ bucketCat: 'bucketcat', override: { splits: [], categoryId: 'gifts' } })).source, 'override');
});

test('override survives the bucket being recategorised', () => {
  const s = build({ bucketCat: 'bucketcat', override: { categoryId: 'gifts' } });
  s.buckets[0].categoryId = 'household';
  assert.deepEqual(run(s).parts, [{ amountMinor: -6069, categoryId: 'gifts' }]);
});

test('flag-only overrides do not change the result', () => {
  const r = run(build({ bucketCat: 'bucketcat', override: { unusualDismissed: true, flagDecision: 'rule' } }));
  assert.deepEqual(r, { source: 'bucket', parts: [{ amountMinor: -6069, categoryId: 'bucketcat' }] });
});

test('missing category: split part null but source stays split', () => {
  const r = run(build({ override: { splits: [{ amountMinor: -4000, categoryId: 'gone' }, { amountMinor: -2069, categoryId: 'gifts' }] } }));
  assert.equal(r.source, 'split');
  assert.deepEqual(r.parts.map((p) => p.categoryId), [null, 'gifts']);
});

test('missing category: override gives none, no bucket fallback', () => {
  const r = run(build({ bucketCat: 'bucketcat', override: { categoryId: 'gone' } }));
  assert.deepEqual(r, { source: 'none', parts: [{ amountMinor: -6069, categoryId: null }] });
});

test('missing category: bucket gives none', () => {
  assert.equal(run(build({ bucketCat: 'gone' })).source, 'none');
});

test('categoryKindOf', () => {
  const ctx = buildContext(build());
  assert.equal(categoryKindOf({ amountMinor: 1, categoryId: 'other' }, ctx), 'income');
  assert.equal(categoryKindOf({ amountMinor: 1, categoryId: null }, ctx), null);
  assert.equal(categoryKindOf({ amountMinor: 1, categoryId: 'gone' }, ctx), null);
});
