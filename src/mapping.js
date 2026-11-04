// Stage 2 of import: a saved mapping turns parsed CSV rows into signed transactions.
// Debits are negative and credits positive, whatever the file does.
/** @import {Mapping} from './types.js' */
import { currencyExponent, parseAmount } from './money.js';
import { parseDate } from './dates.js';

/** @typedef {{rowNumber:number,date:string,amountMinor:number,rawText:string,rawType?:string}} MappedRow */
/** @typedef {{rowNumber:number,message:string}} RowError */
/** @typedef {{minor:number}|{error:string}} AmountResult */

/** @param {string} name */
const norm = (name) => name.replace(/\uFEFF/g, '').trim().toLowerCase();

/**
 * @param {string[]} header
 * @returns {string}
 */
export function headerSignature(header) {
  return header.map(norm).join(',');
}

/** @param {Mapping} mapping @returns {string[]} */
function mappedColumns(mapping) {
  const a = mapping.amount;
  const cols = [mapping.dateColumn, mapping.descriptionColumn];
  if (mapping.typeColumn) cols.push(mapping.typeColumn);
  if (mapping.accountIdColumn) cols.push(mapping.accountIdColumn);
  cols.push(...('single' in a ? [a.single] : [a.debit, a.credit]));
  return cols;
}

/**
 * Mapped column names that are not in the header (compared trimmed, case-insensitive).
 * @param {Mapping} mapping
 * @param {string[]} header
 * @returns {string[]}
 */
export function missingColumns(mapping, header) {
  const have = new Set(header.map(norm));
  return mappedColumns(mapping).filter((c) => !have.has(norm(c)));
}

/**
 * Why a mapping can't be applied to a header: one message per mapped column that is missing
 * (`Missing column: X`) or appears more than once (`Column appears twice: X`). Empty when it fits.
 * @param {Mapping} mapping
 * @param {string[]} header
 * @returns {string[]}
 */
export function mappingProblems(mapping, header) {
  const names = header.map(norm);
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  for (const col of mappedColumns(mapping)) {
    const key = norm(col);
    if (seen.has(key)) continue;
    seen.add(key);
    const count = names.filter((n) => n === key).length;
    if (count === 0) problems.push(`Missing column: ${col}`);
    else if (count > 1) problems.push(`Column appears twice: ${col}`);
  }
  return problems;
}

/** @param {number} n */
const noNegZero = (n) => (n === 0 ? 0 : n);

/**
 * One value in one column, as written, optionally negated.
 * @param {string} cell
 * @param {boolean} flipped
 * @param {number} exp
 * @returns {AmountResult}
 */
function singleAmount(cell, flipped, exp) {
  const p = parseAmount(cell, exp);
  if ('error' in p) return p;
  if (p.minor === null) return { error: 'No amount' };
  return { minor: noNegZero(flipped ? -p.minor : p.minor) };
}

/**
 * Separate unsigned debit and credit columns.
 * @param {string} debit
 * @param {string} credit
 * @param {number} exp
 * @returns {AmountResult}
 */
function debitCreditAmount(debit, credit, exp) {
  for (const cell of [debit, credit]) {
    if (/^[+-]/.test(cell.trim())) return { error: `Unexpected sign in debit/credit: ${cell.trim()}` };
  }
  const d = parseAmount(debit, exp);
  if ('error' in d) return d;
  const c = parseAmount(credit, exp);
  if ('error' in c) return c;
  if (d.minor !== null && c.minor !== null) return { error: 'Both debit and credit' };
  if (d.minor !== null) return { minor: noNegZero(-d.minor) };
  if (c.minor !== null) return { minor: c.minor };
  return { error: 'No amount' };
}

/**
 * Maps rows to signed transactions. If any column the mapping names is missing from the header or
 * appears more than once, nothing is mapped: it returns no rows or identifiers and one error per
 * problem, with rowNumber 1 (the header).
 * @param {Mapping} mapping
 * @param {string[]} header
 * @param {{rowNumber:number,cells:string[]}[]} rows
 * @param {string} currency
 * @returns {{rows: MappedRow[], errors: RowError[], identifiers: string[]}}
 */
export function applyMapping(mapping, header, rows, currency) {
  const problems = mappingProblems(mapping, header);
  if (problems.length > 0) {
    return { rows: [], identifiers: [], errors: problems.map((message) => ({ rowNumber: 1, message })) };
  }
  const names = header.map(norm);
  /** @param {string|undefined} col */
  const idx = (col) => (col === undefined ? -1 : names.indexOf(norm(col)));
  const a = mapping.amount;
  const iDate = idx(mapping.dateColumn);
  const iDesc = idx(mapping.descriptionColumn);
  const iType = idx(mapping.typeColumn);
  const iAcct = idx(mapping.accountIdColumn);
  const iSingle = 'single' in a ? idx(a.single) : -1;
  const iDebit = 'debit' in a ? idx(a.debit) : -1;
  const iCredit = 'credit' in a ? idx(a.credit) : -1;
  const exp = currencyExponent(currency);

  /** @type {MappedRow[]} */
  const out = [];
  /** @type {RowError[]} */
  const errors = [];
  const ids = new Set();

  for (const { rowNumber, cells } of rows) {
    /** @param {number} i */
    const cell = (i) => (i >= 0 ? cells[i] ?? '' : '');

    const id = cell(iAcct).trim().replace(/^'/, '').trim();
    if (id !== '') ids.add(id);

    const date = parseDate(cell(iDate), mapping.dateFormat);
    if (date === null) { errors.push({ rowNumber, message: 'Bad date' }); continue; }

    const amt = 'single' in a
      ? singleAmount(cell(iSingle), a.signFlipped, exp)
      : debitCreditAmount(cell(iDebit), cell(iCredit), exp);
    if ('error' in amt) { errors.push({ rowNumber, message: amt.error }); continue; }

    /** @type {MappedRow} */
    const mapped = { rowNumber, date, amountMinor: amt.minor, rawText: cell(iDesc) };
    const type = cell(iType).trim();
    if (type !== '' && type.toLowerCase() !== 'null') mapped.rawType = type;
    out.push(mapped);
  }
  return { rows: out, errors, identifiers: [...ids] };
}
