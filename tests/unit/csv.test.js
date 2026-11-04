import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBytes, parseCsv } from '../../src/csv.js';

const bytes = (/** @type {number[]} */ a) => new Uint8Array(a).buffer;

test('BOM plus quoted header via decodeBytes', () => {
  const text = decodeBytes(bytes([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('"Transaction Date",Amount\n')]));
  assert.deepEqual(parseCsv(text).header, ['Transaction Date', 'Amount']);
});

test('BOM plus quoted header via parseCsv string', () => {
  assert.deepEqual(parseCsv('﻿"Transaction Date",Amount\n').header, ['Transaction Date', 'Amount']);
});

test('quotes and commas inside quotes', () => {
  const r = parseCsv('h1,h2,h3\na,"b,c","d ""e"""\n');
  assert.deepEqual(r.rows, [{ rowNumber: 2, cells: ['a', 'b,c', 'd "e"'] }]);
  assert.deepEqual(r.errors, []);
});

test('CRLF and LF are identical; quoted CRLF stays one record', () => {
  const lf = parseCsv('a,b\n1,2\n3,4\n');
  const crlf = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
  assert.deepEqual(crlf, lf);
  const q = parseCsv('a,b\r\n"x\r\ny",2\r\n');
  assert.deepEqual(q.rows, [{ rowNumber: 2, cells: ['x\r\ny', '2'] }]);
});

test('trailing newline and blank lines add no rows; blanks still count', () => {
  const r = parseCsv('a,b\n1,2\n\n3,4\n\n\n');
  assert.deepEqual(r.rows.map((x) => x.rowNumber), [2, 4]);
  assert.deepEqual(r.errors, []);
});

test('unterminated quote gives an error with row number', () => {
  const r = parseCsv('a,b\n1,2\n3,"oops\n4,5\n');
  assert.deepEqual(r.rows.map((x) => x.rowNumber), [2]);
  assert.deepEqual(r.errors, [{ rowNumber: 3, message: 'Unterminated quote' }]);
});

test('text after a closing quote is an error, not a silent misread', () => {
  const r = parseCsv('a,b\n"x"y,2\n');
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.errors, [{ rowNumber: 2, message: 'Unexpected text after closing quote' }]);
});

test('HTML stays literal text', () => {
  const r = parseCsv('a\n<b>x</b>\n');
  assert.deepEqual(r.rows[0].cells, ['<b>x</b>']);
});

test('empty fields give empty strings', () => {
  const r = parseCsv('a,b,c\n,,\n1,,3');
  assert.deepEqual(r.rows, [{ rowNumber: 2, cells: ['', '', ''] }, { rowNumber: 3, cells: ['1', '', '3'] }]);
});

test('decodeBytes falls back to windows-1252', () => {
  assert.equal(decodeBytes(bytes([0x41, 0xa3, 0x35])), 'A£5');
});

test('decodeBytes leaves valid UTF-8 unchanged', () => {
  assert.equal(decodeBytes(new TextEncoder().encode('café').buffer), 'café');
});

test('wrong cell count goes to errors, not rows', () => {
  const r = parseCsv('a,b,c,d,e\n1,2\n1,2,3,4,5\n');
  assert.deepEqual(r.errors, [{ rowNumber: 2, message: 'Expected 5 fields, found 2' }]);
  assert.deepEqual(r.rows.map((x) => x.rowNumber), [3]);
});

test('empty input', () => {
  assert.deepEqual(parseCsv(''), { header: [], rows: [], errors: [] });
});

test('bad-quote header refuses the whole file', () => {
  const r = parseCsv('"a"x,b\n1,2\n');
  assert.deepEqual(r.header, []);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.errors, [{ rowNumber: 1, message: 'Unexpected text after closing quote' }]);
});

test('unterminated-quote header gives empty header and an error', () => {
  const r = parseCsv('"a,b\n1,2\n');
  assert.deepEqual(r.header, []);
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.errors, [{ rowNumber: 1, message: 'Unterminated quote' }]);
});
