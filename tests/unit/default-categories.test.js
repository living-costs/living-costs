import { test } from 'node:test';
import assert from 'node:assert/strict';
import defaults from '../../src/default-categories.js';

const KINDS = ['spend', 'income', 'contribution', 'transfer', 'ignore'];
const BUDGET_TYPES = ['fixed', 'variable', 'annual', 'oneoff'];
const BUDGETED_KINDS = ['spend', 'income', 'contribution'];

test('IDs are unique', () => {
  const ids = defaults.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('names are unique, case-insensitively', () => {
  const names = defaults.map((c) => c.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test('every kind is one of the five', () => {
  for (const c of defaults) assert.ok(KINDS.includes(c.kind), `${c.id}: ${c.kind}`);
});

test('budgetType is valid for budgeted kinds and absent for transfer and ignore', () => {
  for (const c of defaults) {
    if (BUDGETED_KINDS.includes(c.kind)) {
      assert.ok(BUDGET_TYPES.includes(c.budgetType), `${c.id} needs a budgetType`);
    } else {
      assert.equal('budgetType' in c, false, `${c.id} must not have a budgetType`);
    }
  }
});

test('has the 25-row starting list, first entry Salary', () => {
  assert.equal(defaults.length, 25);
  assert.deepEqual(defaults[0], { id: 'salary', name: 'Salary', kind: 'income', budgetType: 'fixed' });
});
