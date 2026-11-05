import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currencyExponent, parseAmount, formatMoney, parseMoneyQuery, divRound, decimalString, withoutCurrencySymbol,
} from '../../src/money.js';

test('parseAmount valid at exponent 2', () => {
  const cases = [['46', 4600], ['1.2', 120], ['.51', 51], ['+12.58', 1258], ['-1234.56', -123456], [' 7.00 ', 700], ['-0.05', -5]];
  for (const [t, m] of cases) assert.deepEqual(parseAmount(t, 2), { minor: m }, t);
});

test('parseAmount empty and null', () => {
  for (const t of ['', '  ', 'null', 'NULL', ' Null ']) assert.deepEqual(parseAmount(t, 2), { minor: null }, t);
});

test('parseAmount errors', () => {
  for (const t of ['£12', '(12.00)', '1e3', '-', '.', '12.', 'abc']) {
    assert.ok('error' in parseAmount(t, 2), t);
  }
});

test('parseAmount UK thousands separators', () => {
  const cases = [['-1,234.00', -123400], ['2,345.67', 234567], ['1,234,567', 123456700], ['+1,000.5', 100050],
    ['1,234', 123400], ['999,999.99', 99999999]];
  for (const [t, m] of cases) assert.deepEqual(parseAmount(t, 2), { minor: m }, t);
});

test('parseAmount continental decimal comma and dot grouping', () => {
  const cases = [['1.234,56', 123456], ['-1.234,00', -123400], ['1.234.567', 123456700], ['1234,56', 123456],
    ['12,34', 1234], [',51', 51], ['1.234', 123400], ['-0,05', -5]];
  for (const [t, m] of cases) assert.deepEqual(parseAmount(t, 2), { minor: m }, t);
});

test('parseAmount rejects other separators and bad grouping', () => {
  const bad = ['1 234.56', "1'234.56", '1,23.00', '12.34.56', '1,234,567.8.9', ',123', '1,,234', '1,234.567,89',
    '1.234.56', '1,2345.00', '1234,567.00', '1.234,567', '12,', '1,234.', '1.234,', '1.2,34', '1,234,56'];
  for (const t of bad) assert.ok('error' in parseAmount(t, 2), t);
});

test('parseAmount exponent 0 with separators', () => {
  assert.deepEqual(parseAmount('1,234', 0), { minor: 1234 });
  assert.deepEqual(parseAmount('1.234', 0), { minor: 1234 });
  assert.deepEqual(parseAmount('1.234.567', 0), { minor: 1234567 });
  assert.ok('error' in parseAmount('12,34', 0));
  assert.ok('error' in parseAmount('1,234.5', 0));
});

test('parseAmount exponent 3: a lone 3-digit group is ambiguous', () => {
  for (const t of ['1,234', '1.234', '-1,234', '12,345', '999.999']) {
    const r = parseAmount(t, 3);
    assert.ok('error' in r && /ambiguous/i.test(r.error), t);
  }
  assert.deepEqual(parseAmount('1,234.567', 3), { minor: 1234567 });
  assert.deepEqual(parseAmount('1.234,567', 3), { minor: 1234567 });
  assert.deepEqual(parseAmount('1,234,567', 3), { minor: 1234567000 });
  assert.deepEqual(parseAmount('1,2345', 3), { error: 'Too many decimal places: 1,2345' });
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

test('decimalString is exact and unsigned', () => {
  assert.equal(decimalString(4000, 2), '40.00');
  assert.equal(decimalString(-2069, 2), '20.69');
  assert.equal(decimalString(5, 2), '0.05');
  assert.equal(decimalString(0, 2), '0.00');
  assert.equal(decimalString(1234, 0), '1234');
  assert.equal(decimalString(-7, 0), '7');
  assert.equal(decimalString(0, 0), '0');
  assert.equal(decimalString(12345, 3), '12.345');
});

test('withoutCurrencySymbol drops a leading £ and keeps the sign', () => {
  assert.equal(withoutCurrencySymbol(' £60.69 '), '60.69');
  assert.equal(withoutCurrencySymbol('-£5'), '-5');
  assert.equal(withoutCurrencySymbol('60.69'), '60.69');
  assert.equal(withoutCurrencySymbol('60£'), '60£');
});
