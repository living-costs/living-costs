import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../../src/changes.js';
import { setAccountKind } from '../../src/accounts.js';

const acct = (id, kind) => ({ id, name: id, currency: 'GBP', kind, repaymentBucketIds: [] });
const state = () => {
  const s = emptyState();
  s.accounts = [acct('A', 'bank'), acct('P', 'placeholder')];
  return s;
};

test('a bank account becomes savings', () => {
  assert.deepEqual(setAccountKind(state(), 'A', 'savings'), { put: { accounts: [acct('A', 'savings')] } });
});

test('a placeholder, an unknown id and an unchanged kind change nothing', () => {
  const s = state();
  assert.deepEqual(setAccountKind(s, 'P', 'bank'), {});
  assert.deepEqual(setAccountKind(s, 'nope', 'bank'), {});
  assert.deepEqual(setAccountKind(s, 'A', 'bank'), {});
});
