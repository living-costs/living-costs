import { test } from 'node:test';
import assert from 'node:assert/strict';
import tuning from '../../src/tuning.js';

const KEYS = [
  'windowMonths', 'fixedActiveMonths', 'variableRange', 'transactionMatchDays',
  'coverageGapDays', 'unusualMultiple', 'unusualMinMajor', 'relatedMinWordLength',
  'relatedStopWords', 'relatedMaxShown', 'repeatingMinCount', 'firstTenKeys', 'transactionsShown',
];

const isInt = (v) => Number.isInteger(v);

test('tuning has exactly the expected keys', () => {
  assert.deepEqual(Object.keys(tuning).sort(), [...KEYS].sort());
});

test('count-like values are integers of at least 1', () => {
  for (const key of ['windowMonths', 'fixedActiveMonths', 'transactionMatchDays',
    'relatedMinWordLength', 'relatedMaxShown', 'repeatingMinCount', 'transactionsShown']) {
    assert.ok(isInt(tuning[key]) && tuning[key] >= 1, `${key} must be an integer >= 1`);
  }
});

test('coverageGapDays is an integer of at least 0', () => {
  assert.ok(isInt(tuning.coverageGapDays) && tuning.coverageGapDays >= 0);
});

test('windowMonths is at most 36', () => {
  assert.ok(tuning.windowMonths <= 36);
});

test('variableRange is two integers with 0 <= a < b <= 100', () => {
  const r = tuning.variableRange;
  assert.ok(Array.isArray(r) && r.length === 2, 'must be a pair');
  assert.ok(r.every(isInt), 'both must be integers');
  const [a, b] = r;
  assert.ok(a >= 0 && a < b && b <= 100, `got [${a}, ${b}]`);
});

test('unusual-amount thresholds are positive', () => {
  assert.ok(tuning.unusualMultiple > 1);
  assert.ok(tuning.unusualMinMajor > 0);
});

test('relatedStopWords are all upper-case strings', () => {
  assert.ok(Array.isArray(tuning.relatedStopWords));
  for (const w of tuning.relatedStopWords) {
    assert.equal(typeof w, 'string');
    assert.equal(w, w.toUpperCase());
  }
});

test('firstTenKeys is a boolean', () => {
  assert.equal(typeof tuning.firstTenKeys, 'boolean');
});
