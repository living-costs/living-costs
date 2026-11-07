import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squash, matchKeys, suggestCategory, bucketSuggestions } from '../../src/suggest.js';
import { emptyState, applyToState } from '../../src/changes.js';
import { assignBuckets } from '../../src/buckets.js';
import { seedDefaults, updateCategory, deleteCategory } from '../../src/categories.js';
import defaults from '../../src/default-categories.js';

const M = [
  { name: 'SAINSBURYS', defaultId: 'groceries' }, { name: 'AMAZON', defaultId: 'shopping' },
  { name: 'AMAZON PRIME', defaultId: 'subscriptions' }, { name: 'BA', defaultId: 'holidays' },
  { name: 'EE', defaultId: 'utilities' }, { name: 'O2', defaultId: 'utilities' },
  { name: 'JUST EAT', defaultId: 'takeaway' }, { name: 'DISNEY+', defaultId: 'subscriptions' },
  { name: 'M&S', defaultId: 'groceries' }, { name: 'APPLE.COM/BILL', defaultId: 'subscriptions' },
  { name: 'SHELL', defaultId: 'fuel' }, { name: 'TESCO', defaultId: 'groceries' },
];

test('squash: apostrophes, symbols, domains', () => {
  assert.equal(squash("SAINSBURY'S"), 'SAINSBURYS');
  assert.equal(squash('Sainsbury’s'), 'SAINSBURYS');
  assert.equal(squash('DISNEY+'), 'DISNEY PLUS');
  assert.equal(squash('M&S SIMPLY FOOD'), 'M AND S SIMPLY FOOD');
  assert.equal(squash('WWW.EXAMPLE.CO.UK'), 'EXAMPLE');
  assert.equal(squash('EXAMPLECOUK'), 'EXAMPLE');
  assert.equal(squash('NETFLIX.COM'), 'NETFLIX');
  assert.equal(squash('APPLE.COM/BILL'), 'APPLE BILL');
  assert.equal(squash('E.ON NEXT'), 'EON NEXT');
  assert.equal(squash('LV='), 'LV');
  assert.equal(squash('SITCOM'), 'SITCOM');
});

test('matchKeys: whole-word hits, longest wins', () => {
  assert.equal(matchKeys(['SAINSBURYS S/MKTS'], M), 'groceries');
  assert.equal(matchKeys(['AMAZON.CO.UK'], M), 'shopping');
  assert.equal(matchKeys(['AMAZON PRIME UK'], M), 'subscriptions');
  assert.equal(matchKeys(['BA LONDON'], M), 'holidays');
});

test('matchKeys: short names do not match inside longer words', () => {
  assert.equal(matchKeys(['BARCLAYS'], M), null);
  assert.equal(matchKeys(['BANK FEES'], M), null);
  assert.equal(matchKeys(['CO2 OFFSET'], M), null);
});

test('matchKeys: glued words', () => {
  assert.equal(matchKeys(['JUSTEAT'], M), 'takeaway');
  assert.equal(matchKeys(['JUSTEATCOUK'], M), 'takeaway');
  assert.equal(matchKeys(['WWW.JUST-EAT.CO.UK'], M), 'takeaway');
});

test('matchKeys: across keys', () => {
  assert.equal(matchKeys(['TESCO', 'SHELL'], M), null);
  assert.equal(matchKeys(['TESCO', 'M&S'], M), 'groceries');
  assert.equal(matchKeys([], M), null);
  assert.equal(matchKeys(['NOTHING HERE'], M), null);
});

let n = 0;
const txn = (amountMinor, rawText) => ({
  id: `t${++n}`, fingerprint: `fp${n}`, accountId: 'a1', batchId: 'b1', date: '2026-09-02', amountMinor, currency: 'GBP', rawText,
});

/** A seeded state with one bucket per text, holding the given amounts for the first text. */
function build(amounts, text = 'TESCO STORES') {
  const s = emptyState();
  applyToState(s, seedDefaults(defaults, s));
  applyToState(s, assignBuckets(s, amounts.map((a) => txn(a, text))));
  const groceries = s.categories.find((c) => c.defaultId === 'groceries');
  return { s, groceries, bucket: s.buckets[0] };
}

test('suggestCategory: an uncategorised spending bucket gets the matching default', () => {
  const { s, groceries, bucket } = build([-500, -700]);
  assert.equal(suggestCategory(s, bucket, M)?.id, groceries.id);
});

test('suggestCategory: none when categorised, but a deleted category counts as uncategorised', () => {
  const { s, groceries, bucket } = build([-500, -700]);
  bucket.categoryId = groceries.id;
  assert.equal(suggestCategory(s, bucket, M), null);
  bucket.categoryId = 'gone';
  assert.equal(suggestCategory(s, bucket, M)?.id, groceries.id);
});

test('suggestCategory: matches by defaultId, so a rename still works; delete or retype gives none', () => {
  const { s, groceries, bucket } = build([-500, -700]);
  applyToState(s, updateCategory(s, groceries.id, { name: 'Food shop' }));
  assert.equal(suggestCategory(s, bucket, M)?.id, groceries.id);
  applyToState(s, updateCategory(s, groceries.id, { kind: 'income' }));
  assert.equal(suggestCategory(s, bucket, M), null);
  applyToState(s, deleteCategory(s, groceries.id));
  assert.equal(suggestCategory(s, bucket, M), null);
});

test('suggestCategory: only a strictly negative total is suggested', () => {
  for (const amounts of [[-500, 500], [-500, 800]]) {
    const c = build(amounts);
    assert.equal(suggestCategory(c.s, c.bucket, M), null);
  }
});

test('suggestCategory: an amount-rule bucket with no keys gets none', () => {
  const { s, bucket } = build([-500]);
  const ruleBucket = { id: 'rb', keys: [], displayName: 'TESCO', exampleRawTexts: [] };
  s.buckets.push(ruleBucket);
  s.transactions.push({ ...txn(-900, 'TESCO'), bucketId: 'rb' });
  assert.equal(suggestCategory(s, ruleBucket, M), null);
  assert.ok(suggestCategory(s, bucket, M));
});

test('bucketSuggestions: one entry per suggestible bucket, keyed by bucket id', () => {
  const { s, groceries, bucket } = build([-500, -700]);
  s.buckets.push({ id: 'rb', keys: [], displayName: 'TESCO', exampleRawTexts: [] });
  const map = bucketSuggestions(s, M);
  assert.equal(map.size, 1);
  assert.equal(map.get(bucket.id)?.id, groceries.id);
});
