import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState } from '../../src/changes.js';
import { setCategoryOverride, dismissUnusual } from '../../src/overrides.js';

test('setCategoryOverride creates an override when there is none', () => {
  const s = emptyState();
  assert.deepEqual(setCategoryOverride(s, 'f1', 'gifts'), { put: { overrides: [{ fingerprint: 'f1', categoryId: 'gifts' }] } });
});

test('setCategoryOverride clears splits and keeps other fields', () => {
  const s = emptyState();
  s.overrides.set('f1', {
    fingerprint: 'f1', categoryId: 'old', splits: [{ amountMinor: -100, categoryId: 'x' }],
    unusualDismissed: true, flagDecision: 'rule',
  });
  const c = setCategoryOverride(s, 'f1', 'gifts');
  assert.deepEqual(c.put?.overrides, [{ fingerprint: 'f1', categoryId: 'gifts', unusualDismissed: true, flagDecision: 'rule' }]);
  assert.deepEqual(s.overrides.get('f1')?.splits, [{ amountMinor: -100, categoryId: 'x' }], 'state is not mutated');
});

test('dismissUnusual creates an override when there is none', () => {
  const s = emptyState();
  assert.deepEqual(dismissUnusual(s, 'f1'), { put: { overrides: [{ fingerprint: 'f1', unusualDismissed: true }] } });
});

test('dismissUnusual keeps other fields', () => {
  const s = emptyState();
  const splits = [{ amountMinor: -100, categoryId: 'x' }];
  s.overrides.set('f1', { fingerprint: 'f1', categoryId: 'gifts', splits, flagDecision: 'source' });
  const c = dismissUnusual(s, 'f1');
  assert.deepEqual(c.put?.overrides, [{ fingerprint: 'f1', categoryId: 'gifts', splits, flagDecision: 'source', unusualDismissed: true }]);
  applyToState(s, c);
  assert.equal(s.overrides.get('f1')?.unusualDismissed, true);
});
