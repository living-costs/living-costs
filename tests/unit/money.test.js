import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currencyExponent, parseAmount, formatMoney, parseMoneyQuery, divRound } from '../../src/money.js';

test('parseAmount valid at exponent 2', () => {
  const cases = [['46', 4600], ['1.2', 120], ['.51', 51], ['+12.58', 1258], ['-1234.56', -123456], [' 7.00 ', 700], ['-0.05', -5]];
  for (const [t, m] of cases) assert.deepEqual(parseAmount(t, 2), { minor: m }, t);
});

test('parseAmount empty and null', () => {
  for (const t of ['', '  ', 'null', 'NULL', ' Null ']) assert.deepEqual(parseAmount(t, 2), { minor: null }, t);
});

test('parseAmount errors', () => {
  for (const t of ['1,234.56', '£12', '(12.00)', '1.234', '1e3', '-', '.', '12.', 'abc']) {
    assert.ok('error' in parseAmount(t, 2), t);
  }
});

test('parseAmount exponent 0', () => {
  assert.deepEqual(parseAmount('5', 0), { minor: 5 });
  assert.ok('error' in parseAmount('5.1', 0));
  assert.ok('error' in parseAmount('5.0', 0));
  assert.ok('error' in parseAmount('5.', 0));
});

test('currencyExponent', () => {
  assert.equal(currencyExponent('GBP'), 2);
  assert.equal(currencyExponent('JPY'), 0);
});

test('formatMoney', () => {
  assert.equal(formatMoney(-123456, 'GBP'), '-£1,234.56');
  assert.equal(formatMoney(5, 'GBP'), '£0.05');
  assert.equal(formatMoney(-5, 'GBP'), '-£0.05');
  assert.equal(formatMoney(0, 'GBP'), '£0.00');
  assert.equal(formatMoney(1234, 'JPY'), 'JP¥1,234');
});

test('parseMoneyQuery', () => {
  assert.equal(parseMoneyQuery('60.69', 2), 6069);
  assert.equal(parseMoneyQuery('£60.69', 2), 6069);
  assert.equal(parseMoneyQuery('-60.69', 2), 6069);
  assert.equal(parseMoneyQuery('60', 2), 6000);
  assert.equal(parseMoneyQuery('abc', 2), null);
  assert.equal(parseMoneyQuery('', 2), null);
});

test('divRound', () => {
  assert.equal(divRound(5, 2), 3);
  assert.equal(divRound(-5, 2), -3);
  assert.equal(divRound(7, 3), 2);
  assert.equal(divRound(29900, 12), 2492);
  assert.equal(divRound(5, -2), -3);
  assert.equal(divRound(0, 5), 0);
});
