// Shared by the unit tests that load the synthetic fixtures through the import pipeline.
// Not a test file itself (the runner only picks up *.test.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBytes, parseCsv } from '../../src/csv.js';
import { headerSignature } from '../../src/mapping.js';
import tuning from '../../src/tuning.js';
import { MAPPINGS } from '../fixtures/mappings.js';
import { prepareFiles, mapFiles, planImport, commitImport } from '../../src/import.js';

export const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));
export const NOW = new Date('2026-11-04T10:00:00.000Z');

export const BANK_A = 'bank-a-current.csv';
export const REEXPORT = 'bank-a-current-2026-10-reexport.csv';
export const SAVINGS = 'bank-a-savings.csv';
export const CARD = 'card.csv';
export const BANK_B = ['bank-b-2026-08.csv', 'bank-b-2026-09.csv', 'bank-b-2026-10.csv'];

/** @param {string} name */
export const text = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
/** @param {string} name */
export const buffer = (name) => {
  const b = fs.readFileSync(path.join(DIR, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
/** @param {string} s */
export const encode = (s) => new TextEncoder().encode(s).buffer;
/** @param {string} name @param {ArrayBuffer} [bytes] */
export const pick = (name, bytes = buffer(name)) => ({ name, bytes });

/** @param {keyof typeof MAPPINGS} key @param {string} fileName */
export const mappingFor = (key, fileName) => ({
  ...MAPPINGS[key], headerSignature: headerSignature(parseCsv(decodeBytes(buffer(fileName))).header),
});
export const accountA = (extra = {}) => ({
  id: 'A', name: 'Bank A current', currency: 'GBP', kind: 'bank',
  mapping: mappingFor('bankA', BANK_A), repaymentBucketIds: [], ...extra,
});
export const accountS = () => ({
  id: 'S', name: 'Bank A savings', currency: 'GBP', kind: 'bank',
  mapping: mappingFor('savings', SAVINGS), repaymentBucketIds: [],
});
export const accountC = () => ({
  id: 'C', name: 'Credit card', currency: 'GBP', kind: 'card',
  mapping: mappingFor('card', CARD), repaymentBucketIds: [],
});
export const accountB = () => ({
  id: 'B', name: 'Bank B joint', currency: 'GBP', kind: 'bank',
  mapping: mappingFor('bankB', BANK_B[0]), repaymentBucketIds: [],
});

/** @param {any[]} files @param {Record<string, Set<number>>} [skips] */
export const withSkips = (files, skips = {}) => files.map((f) => ({ ...f, skipRowNumbers: skips[f.name] ?? new Set() }));

/** Every review row gets `decide(review)`. */
export function decisionsFor(plan, decide) {
  return new Map(plan.files.flatMap((f) => f.review.map((r) => [r.row.fingerprint, decide(r)])));
}

/** The whole pipeline for one pick, asserting no refusals along the way. */
export async function run(state, account, picks, decide = () => 'both') {
  const prep = await prepareFiles(state, picks);
  assert.equal(prep.signatureError, undefined);
  const mapped = mapFiles(account, prep.files);
  assert.deepEqual(mapped.refused, []);
  const plan = planImport(state, account, withSkips(mapped.files), tuning);
  const changes = commitImport(state, account, plan, decisionsFor(plan, decide), mapped.files, NOW);
  return { prep, files: mapped.files, plan, changes };
}
