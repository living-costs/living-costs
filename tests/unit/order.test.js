import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmp, compareNames } from '../../src/order.js';

test('cmp is code-unit order', () => {
  assert.deepEqual(['b', 'B', 'a', 'A', 'a'].sort(cmp), ['A', 'B', 'a', 'a', 'b']);
  assert.equal(cmp('x', 'x'), 0);
});

test('compareNames ignores case and accents, and matches localeCompare with sensitivity base', () => {
  const names = ['tesco', 'Amazon', 'ZOO', 'café', 'Bakery', 'apple'];
  assert.deepEqual([...names].sort(compareNames), ['Amazon', 'apple', 'Bakery', 'café', 'tesco', 'ZOO']);
  assert.equal(compareNames('Tesco', 'TESCO'), 0);
  assert.equal(compareNames('cafe', 'Café'), 0);
  for (const a of names) {
    for (const b of names) assert.equal(Math.sign(compareNames(a, b)), Math.sign(a.localeCompare(b, 'en-GB', { sensitivity: 'base' })));
  }
});
