import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState } from '../../src/changes.js';
import { assignBuckets, mergeBuckets } from '../../src/buckets.js';
import { createAmountRule, resolveFlag, routeByRule } from '../../src/rules.js';

let n = 0;
const txn = (date, amountMinor, rawText = 'PAYPAL PAYMENT') => ({
  id: `t${++n}`, fingerprint: `fp${n}`, accountId: 'a1', batchId: 'b1', date, amountMinor, currency: 'GBP', rawText,
});
const month = { count: 1, period: 'month' };

function setup() {
  const s = emptyState();
  const rows = [txn('2026-09-08', -299), txn('2026-09-08', -999), txn('2026-10-08', -299), txn('2026-10-08', -999), txn('2026-10-20', -299)];
  applyToState(s, assignBuckets(s, rows));
  const src = s.buckets[0];
  const c = createAmountRule(s, { sourceBucketId: src.id, amountMinor: -299, expected: month, displayName: 'Google One storage' });
  applyToState(s, c);
  return { s, src, rows, c };
}

test('createAmountRule moves two rows, flags the 20 Oct extra, leaves -999', () => {
  const { s, src, rows } = setup();
  const rule = s.rules[0];
  assert.equal(rule.pattern, src.keys[0]);
  const rb = s.buckets.find((b) => b.id === rule.bucketId);
  assert.deepEqual(rb.keys, []);
  assert.equal(rb.displayName, 'Google One storage');
  assert.deepEqual(rb.exampleRawTexts, ['PAYPAL PAYMENT']);
  const by = (id) => s.transactions.find((t) => t.id === id);
  assert.equal(by(rows[0].id).bucketId, rule.bucketId);
  assert.equal(by(rows[2].id).bucketId, rule.bucketId);
  assert.equal(by(rows[4].id).bucketId, src.id);
  assert.equal(by(rows[4].id).flaggedRuleId, rule.id);
  assert.equal(by(rows[1].id).bucketId, src.id);
  assert.equal(by(rows[3].id).flaggedRuleId, undefined);
});

test('createAmountRule stores no normaliserVersion', () => {
  const { s } = setup();
  assert.equal('normaliserVersion' in s.rules[0], false);
});

test('createAmountRule changes contain only moved/flagged rows', () => {
  const { c } = setup();
  assert.equal(c.put.transactions.length, 3);
  assert.equal(c.put.rules.length, 1);
});

test('createAmountRule with no matching row still creates bucket and rule', () => {
  const { s, src } = setup();
  const c = createAmountRule(s, { sourceBucketId: src.id, amountMinor: -1, expected: month, displayName: 'Nothing' });
  assert.equal(c.put.rules[0].pattern, src.keys[0]);
  assert.equal(c.put.transactions.length, 0);
});

test('assignBuckets routes Nov -299 to rule bucket, flags second Nov', () => {
  const { s, src } = setup();
  const rule = s.rules[0];
  const nov = [txn('2026-11-08', -299), txn('2026-11-15', -299), txn('2026-11-09', -349)];
  const c = assignBuckets(s, [nov[1], nov[0], nov[2]]);
  assert.equal(c.put.transactions.length, 3);
  const get = (t) => c.put.transactions.find((x) => x.id === t.id);
  assert.equal(get(nov[0]).bucketId, rule.bucketId);
  assert.equal(get(nov[1]).bucketId, src.id);
  assert.equal(get(nov[1]).flaggedRuleId, rule.id);
  assert.equal(get(nov[2]).bucketId, src.id);
  assert.equal(get(nov[2]).flaggedRuleId, undefined);
});

test('resolveFlag rule moves the row; re-import honours flagDecision', () => {
  const { s, rows } = setup();
  const rule = s.rules[0];
  applyToState(s, { put: { overrides: [{ fingerprint: rows[4].fingerprint, categoryId: 'c1', unusualDismissed: true }] } });
  const c = resolveFlag(s, rows[4].fingerprint, 'rule');
  applyToState(s, c);
  const t = s.transactions.find((x) => x.id === rows[4].id);
  assert.equal(t.bucketId, rule.bucketId);
  assert.equal(t.flaggedRuleId, undefined);
  const o = s.overrides.get(rows[4].fingerprint);
  assert.deepEqual([o.flagDecision, o.categoryId, o.unusualDismissed], ['rule', 'c1', true]);
  // re-import a row with the same fingerprint into a state without that txn
  const s2 = emptyState();
  applyToState(s2, assignBuckets(s2, rows.slice(0, 4)));
  applyToState(s2, createAmountRule(s2, { sourceBucketId: s2.buckets[0].id, amountMinor: -299, expected: month, displayName: 'G' }));
  s2.overrides.set(rows[4].fingerprint, o);
  const r2 = assignBuckets(s2, [rows[4]]);
  assert.equal(r2.put.transactions[0].bucketId, s2.rules[0].bucketId);
  assert.equal(r2.put.transactions[0].flaggedRuleId, undefined);
});

test('resolveFlag source keeps the row, clears flag, records decision', () => {
  const { s, src, rows } = setup();
  applyToState(s, resolveFlag(s, rows[4].fingerprint, 'source'));
  const t = s.transactions.find((x) => x.id === rows[4].id);
  assert.equal(t.bucketId, src.id);
  assert.equal(t.flaggedRuleId, undefined);
  assert.equal(s.overrides.get(rows[4].fingerprint).flagDecision, 'source');
  const again = assignBuckets(s, [{ ...rows[4], id: 'new' }]);
  assert.equal(again.put.transactions[0].flaggedRuleId, undefined);
});

test('routeByRule', () => {
  const rule = { id: 'r', pattern: 'PAYPAL PAYMENT', matchType: 'keyAmount', amountMinor: -299, expected: month, bucketId: 'b' };
  const counts = new Map();
  assert.equal(routeByRule(rule, txn('2026-11-01', -349), counts), 'none');
  assert.equal(routeByRule(rule, txn('2026-11-01', -299), counts), 'rule');
  assert.equal(routeByRule(rule, txn('2026-11-02', -299), counts), 'flag');
  assert.equal(routeByRule(rule, txn('2026-12-02', -299), counts), 'rule');
});

test('rule bucket merged into its source still routes without spurious flags', () => {
  const { s, src } = setup();
  const rule = s.rules[0];
  applyToState(s, assignBuckets(s, [txn('2026-11-02', -999)]));
  applyToState(s, mergeBuckets(s, src.id, [rule.bucketId], { displayName: 'PayPal' }));
  assert.equal(s.rules[0].bucketId, src.id);
  const rows = [txn('2026-11-08', -299)];
  const c = assignBuckets(s, rows);
  const t = c.put.transactions[0];
  assert.equal(t.bucketId, src.id);
  assert.equal(t.flaggedRuleId, undefined);
});

test('two merged rule buckets do not count each other', () => {
  const { s, src } = setup();
  applyToState(s, createAmountRule(s, { sourceBucketId: src.id, amountMinor: -999, expected: month, displayName: 'Other' }));
  const [r1, r2] = s.rules;
  applyToState(s, assignBuckets(s, [txn('2026-11-01', -299)]));
  applyToState(s, mergeBuckets(s, r1.bucketId, [r2.bucketId], { displayName: 'Both' }));
  const c = assignBuckets(s, [txn('2026-11-09', -999)]);
  assert.equal(c.put.transactions[0].bucketId, r1.bucketId);
  assert.equal(c.put.transactions[0].flaggedRuleId, undefined);
});
