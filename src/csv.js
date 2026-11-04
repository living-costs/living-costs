// Small CSV parser. Knows nothing about banks. All input is untrusted text:
// cells are returned verbatim, never interpreted.

/**
 * Decode file bytes as UTF-8, falling back to Windows-1252. Strips one leading BOM.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function decodeBytes(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  return text.startsWith('﻿') ? text.slice(1) : text;
}

const UNQUOTED = 0;
const QUOTED = 1;
const QUOTE_IN_QUOTED = 2;

/**
 * Parse CSV text into a header and string rows. Row numbers count records,
 * header = 1; blank records are skipped but still counted.
 * @param {string} text
 * @returns {{header: string[], rows: {rowNumber: number, cells: string[]}[], errors: {rowNumber: number, message: string}[]}}
 */
export function parseCsv(text) {
  if (text.startsWith('﻿')) text = text.slice(1);

  /** @type {string[]} */
  let header = [];
  let haveHeader = false;
  let headerFailed = false;
  /** @type {{rowNumber: number, cells: string[]}[]} */
  const rows = [];
  /** @type {{rowNumber: number, message: string}[]} */
  const errors = [];

  let state = UNQUOTED;
  let rowNumber = 1;
  /** @type {string[]} */
  let cells = [];
  let field = '';
  let sawQuote = false; // any quote in this record
  let fieldQuoted = false; // quote already opened in this field
  let badQuote = false;

  const endRecord = () => {
    cells.push(field);
    const blank = cells.length === 1 && cells[0] === '' && !sawQuote;
    if (!blank) {
      if (!haveHeader) {
        haveHeader = true; // first non-blank record is the header, whatever happens
        if (badQuote) {
          headerFailed = true;
          errors.push({ rowNumber, message: 'Unexpected text after closing quote' });
        } else {
          header = cells;
        }
      } else if (headerFailed) {
        // no usable header: later records are unusable
      } else if (badQuote) {
        errors.push({ rowNumber, message: 'Unexpected text after closing quote' });
      } else if (cells.length !== header.length) {
        errors.push({ rowNumber, message: `Expected ${header.length} fields, found ${cells.length}` });
      } else {
        rows.push({ rowNumber, cells });
      }
    }
    rowNumber++;
    cells = [];
    field = '';
    fieldQuoted = false;
    sawQuote = false;
    badQuote = false;
    state = UNQUOTED;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === QUOTED) {
      if (c === '"') state = QUOTE_IN_QUOTED;
      else field += c;
    } else if (state === QUOTE_IN_QUOTED && c === '"') {
      field += '"';
      state = QUOTED;
    } else if (c === ',') {
      cells.push(field);
      field = '';
      fieldQuoted = false;
      state = UNQUOTED;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
    } else if (state === QUOTE_IN_QUOTED) {
      badQuote = true; // text after a closing quote
      field += c;
    } else if (c === '"' && field === '' && !fieldQuoted) {
      sawQuote = fieldQuoted = true;
      state = QUOTED;
    } else {
      field += c; // includes a stray quote mid-field
    }
  }

  if (state === QUOTED) {
    errors.push({ rowNumber, message: 'Unterminated quote' });
  } else if (field !== '' || cells.length > 0 || sawQuote) {
    endRecord();
  }
  return { header, rows, errors };
}
