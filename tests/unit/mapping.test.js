import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerSignature, missingColumns, applyMapping } from '../../src/mapping.js';

/** @import {Mapping} from '../../src/types.js' */

const header = ['Date', 'Details', 'Type', 'Debit', 'Credit', 'Account'];
/** @type {Mapping} */
const dc = {
  headerSignature: headerSignature(header), dateColumn: 'Date', dateFormat: 'DD/MM/YYYY',
  descriptionColumn: 'Details', typeColumn: 'Type', accountIdColumn: 'Account',
  amount: { debit: 'Debit', credit: 'Credit' },
};
const row = (/** @type {number} */ n, /** @type {string[]} */ cells) => ({ rowNumber: n, cells });

test('headerSignature trims, lower-cases, strips BOM', () => {
  assert.equal(headerSignature(['﻿Date', ' Details ']), 'date,details');
});

test('debit/credit amounts', () => {
  const r = applyMapping(dc, header, [
    row(2, ['01/02/2025', 'SHOP', 'POS', '12.50', '', '']),
    row(3, ['02/02/2025', 'PAY', 'null', '', '.51', '']),
    row(4, ['03/02/2025', 'ZERO', '', '0.00', '', '']),
  ], 'GBP');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows, [
    { rowNumber: 2, date: '2025-02-01', amountMinor: -1250, rawText: 'SHOP', rawType: 'POS' },
    { rowNumber: 3, date: '2025-02-02', amountMinor: 51, rawText: 'PAY' },
    { rowNumber: 4, date: '2025-02-03', amountMinor: 0, rawText: 'ZERO' },
  ]);
  assert.ok(Object.is(r.rows[2].amountMinor, 0));
});

test('debit/credit errors', () => {
  const r = applyMapping(dc, header, [
    row(2, ['01/02/2025', 'A', '', '', '', '']),
    row(3, ['01/02/2025', 'B', '', '1.00', '2.00', '']),
    row(4, ['01/02/2025', 'C', '', '-1.00', '', '']),
    row(5, ['01/02/2025', 'D', '', '', '+2.00', '']),
    row(6, ['01/02/2025', 'E', '', '1,000.00', '', '']),
  ], 'GBP');
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.errors.map((e) => e.rowNumber), [2, 3, 4, 5, 6]);
  assert.equal(r.errors[0].message, 'No amount');
  assert.equal(r.errors[1].message, 'Both debit and credit');
  assert.match(r.errors[2].message, /-1\.00/);
  assert.match(r.errors[3].message, /\+2\.00/);
  assert.match(r.errors[4].message, /1,000\.00/);
});

test('single amount, signed and flipped', () => {
  const h = ['Date', 'Desc', 'Amt'];
  /** @type {Mapping} */
  const m = { headerSignature: headerSignature(h), dateColumn: 'Date', dateFormat: 'DD/MM/YYYY',
    descriptionColumn: 'Desc', amount: { single: 'Amt', signFlipped: false } };
  const rows = [row(2, ['01/02/2025', '', '+12.58']), row(3, ['01/02/2025', ' x ', '-0.00']), row(4, ['01/02/2025', 'y', ''])];
  const r = applyMapping(m, h, rows, 'GBP');
  assert.deepEqual(r.rows.map((x) => x.amountMinor), [1258, 0]);
  assert.equal(r.rows[0].rawText, '');
  assert.equal(r.rows[1].rawText, ' x ');
  assert.ok(!('rawType' in r.rows[0]));
  assert.deepEqual(r.errors, [{ rowNumber: 4, message: 'No amount' }]);

  const f = applyMapping({ ...m, amount: { single: 'Amt', signFlipped: true } }, h,
    [row(2, ['01/02/2025', 'a', '46']), row(3, ['01/02/2025', 'b', '-23.40']), row(4, ['01/02/2025', 'c', '0'])], 'GBP');
  assert.deepEqual(f.rows.map((x) => x.amountMinor), [-4600, 2340, 0]);
  assert.ok(Object.is(f.rows[2].amountMinor, 0));
});

test('bad date and footer row do not stop other rows', () => {
  const r = applyMapping(dc, header, [
    row(2, ['31/02/2025', 'A', '', '1.00', '', '']),
    row(3, ['01/02/2025', 'B', '', '1.00', '', '']),
    row(4, ['Total', '', '', '', '123.45', '']),
    row(5, ['', '', '', '', '123.45', '']),
  ], 'GBP');
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.errors.map((e) => [e.rowNumber, e.message]), [[2, 'Bad date'], [4, 'Bad date'], [5, 'Bad date']]);
});

test('missingColumns ignores case and whitespace', () => {
  assert.deepEqual(missingColumns(dc, ['date', ' DETAILS ', 'Type', 'Debit', 'Credit', 'Account']), []);
  assert.deepEqual(missingColumns(dc, ['Date', 'Details']), ['Type', 'Account', 'Debit', 'Credit']);
});

test('identifiers: stripped, distinct, from failed rows too', () => {
  const r = applyMapping(dc, header, [
    row(2, ['01/02/2025', 'A', '', '1.00', '', "'11-22-33"]),
    row(3, ['bad', 'B', '', '1.00', '', ' 12345678 ']),
    row(4, ['01/02/2025', 'C', '', '1.00', '', '12345678']),
    row(5, ['01/02/2025', 'D', '', '1.00', '', '87654321']),
    row(6, ['01/02/2025', 'E', '', '1.00', '', ' ']),
    row(7, ['01/02/2025', 'F', '', '1.00', '', "'11-22-33"]),
  ], 'GBP');
  assert.deepEqual(r.identifiers, ['11-22-33', '12345678', '87654321']);
});

test('columns are matched case-insensitively', () => {
  const r = applyMapping(dc, ['date', 'DETAILS', 'type', 'debit', 'credit', 'account'],
    [row(2, ['01/02/2025', '<b>x</b>', '', '5', '', ''])], 'GBP');
  assert.equal(r.rows[0].amountMinor, -500);
  assert.equal(r.rows[0].rawText, '<b>x</b>');
});
