import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeText } from '../../src/ui/typical.js';

const m = (/** @type {number} */ minor) => (minor / 100).toFixed(2);
test('changeText', () => {
  assert.equal(changeText(0, m), 'same');
  assert.equal(changeText(-7300, m), '73.00 less');
  assert.equal(changeText(5500, m), '55.00 more');
  // a negative Left over that got worse: -20000 typical, -50000 month
  assert.equal(changeText(-50000 - -20000, m), '300.00 less');
});
