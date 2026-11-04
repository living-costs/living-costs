import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBytes, parseCsv } from '../../src/csv.js';
import { headerSignature, applyMapping } from '../../src/mapping.js';
import { normalise } from '../../src/normalise.js';
import { FILES } from '../fixtures/mappings.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));

/** @param {string} name */
const bytes = (name) => fs.readFileSync(path.join(DIR, name));
/** @param {string} name */
const buffer = (name) => {
  const b = bytes(name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

/** @param {{name:string,mapping:object}} file */
function load(file) {
  const { header, rows, errors } = parseCsv(decodeBytes(buffer(file.name)));
  assert.deepEqual(errors, [], `${file.name}: parse errors`);
  const mapping = { ...file.mapping, headerSignature: headerSignature(header) };
  return { header, rows, mapped: applyMapping(/** @type {any} */ (mapping), header, rows, 'GBP') };
}

const MAIN = FILES.filter((f) => !f.reexport);

test('FILES lists six main files and one re-export, all with row counts', () => {
  assert.equal(MAIN.length, 6);
  assert.equal(FILES.filter((f) => f.reexport).length, 1);
  assert.deepEqual(Object.keys(expected.rowCounts).sort(), FILES.map((f) => f.name).sort());
});

for (const file of FILES) {
  test(`${file.name} maps with no errors and the expected row count`, () => {
    const { mapped } = load(file);
    assert.deepEqual(mapped.errors, []);
    assert.equal(mapped.rows.length, expected.rowCounts[file.name]);
  });
}

test('every intended and uncategorised key comes out of the normaliser', () => {
  const keys = new Set();
  for (const file of MAIN) for (const r of load(file).mapped.rows) keys.add(normalise(r.rawText, r.rawType));
  for (const key of [...Object.keys(expected.intendedCategories), ...expected.uncategorisedKeys]) {
    assert.ok(keys.has(key), `missing key ${key}`);
  }
});

test('file format quirks', () => {
  const card = bytes('card.csv');
  assert.deepEqual([...card.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(bytes('bank-a-current.csv').toString('utf8').includes('\r\n'));
  for (const f of ['bank-b-2026-08.csv', 'bank-b-2026-09.csv', 'bank-b-2026-10.csv']) {
    assert.ok(!bytes(f).toString('utf8').includes('\r'), f);
  }
  assert.ok(bytes('bank-a-current.csv').toString('utf8').includes(',.51,'));
  assert.ok(/"46"/.test(card.toString('utf8')) && /"1\.2"/.test(card.toString('utf8')));
});

test('card rows are in cleared-date order, which differs from transaction-date order', () => {
  const { header, rows } = load({ name: 'card.csv', mapping: MAIN.find((f) => f.name === 'card.csv')?.mapping ?? {} });
  const iso = (/** @type {string} */ d) => d.split('/').reverse().join('-');
  const txn = rows.map((r) => iso(r.cells[header.indexOf('Transaction Date')]));
  const cleared = rows.map((r) => iso(r.cells[header.indexOf('Transaction Cleared Date')]));
  for (let i = 1; i < cleared.length; i++) assert.ok(cleared[i - 1] <= cleared[i], `cleared order at ${i}`);
  assert.ok(txn.some((d, i) => i > 0 && txn[i - 1] > d), 'transaction dates never out of order');
});

test('expected.json headline figures', () => {
  const t = expected.monthlyTotals;
  const sum = (/** @type {Record<string,number>} */ o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(expected.transferPairs, 28);
  assert.deepEqual(expected.uncategorisedKeys, ['PAYPAL PAYMENT', '(NO DESCRIPTION)', 'SO (NO DESCRIPTION)']);
  assert.deepEqual(t['Big one-offs'], { '2026-01': -240000 });
  assert.deepEqual(t['Contributions from others'], { '2026-08': 55000, '2026-09': 55000, '2026-10': 55000 });
  assert.deepEqual(t.Utilities, { '2026-08': -13300, '2026-09': -13300, '2026-10': -13300 });
  assert.deepEqual(Object.values(t['Other Card (not itemised)']),
    Array.from({ length: 12 }, (_, i) => -(12000 + 500 * i)));
  assert.deepEqual(Object.values(t.Gifts), Array(12).fill(-4000));
  assert.equal(sum(t.Subscriptions), 52 * -1500 + 12 * (-1199 - 299 - 999));
  assert.deepEqual(expected.reexport, { new: 1, already: expected.rowCounts['bank-a-current-2026-10-reexport.csv'] - 1 - 1, review: 1 });
});

test('per-account totals add up to the monthly totals', () => {
  for (const [cat, byMonth] of Object.entries(expected.monthlyTotals)) {
    /** @type {Record<string,number>} */
    const sums = {};
    for (const months of Object.values(expected.monthlyTotalsByAccount[cat])) {
      for (const [m, v] of Object.entries(months)) sums[m] = (sums[m] ?? 0) + v;
    }
    assert.deepEqual(sums, byMonth, cat);
  }
});

test('mapped amounts across the main files reconcile with expected totals', () => {
  // Transfer pairs net to zero; the excluded rows are A6's extra -299, A16 -500 and A17 -2500.
  let mapped = 0;
  for (const file of MAIN) for (const r of load(file).mapped.rows) mapped += r.amountMinor;
  let totals = 0;
  for (const byMonth of Object.values(expected.monthlyTotals)) for (const v of Object.values(byMonth)) totals += v;
  assert.equal(mapped, totals - 299 - 500 - 2500);
});
