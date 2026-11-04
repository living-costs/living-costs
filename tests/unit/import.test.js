import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBytes, parseCsv } from '../../src/csv.js';
import { headerSignature } from '../../src/mapping.js';
import { emptyState, applyToState } from '../../src/changes.js';
import tuning from '../../src/tuning.js';
import { MAPPINGS } from '../fixtures/mappings.js';
import {
  prepareFiles, suggestAccounts, mapFiles, planImport, commitImport, undoBatches,
} from '../../src/import.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));
const NOW = new Date('2026-11-04T10:00:00.000Z');

const BANK_A = 'bank-a-current.csv';
const REEXPORT = 'bank-a-current-2026-10-reexport.csv';
const SAVINGS = 'bank-a-savings.csv';
const CARD = 'card.csv';
const BANK_B = ['bank-b-2026-08.csv', 'bank-b-2026-09.csv', 'bank-b-2026-10.csv'];

/** @param {string} name */
const text = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
/** @param {string} name */
const buffer = (name) => {
  const b = fs.readFileSync(path.join(DIR, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
/** @param {string} s */
const encode = (s) => new TextEncoder().encode(s).buffer;
/** @param {string} name @param {ArrayBuffer} [bytes] */
const pick = (name, bytes = buffer(name)) => ({ name, bytes });

/** @param {keyof typeof MAPPINGS} key @param {string} fileName */
const mappingFor = (key, fileName) => ({
  ...MAPPINGS[key], headerSignature: headerSignature(parseCsv(decodeBytes(buffer(fileName))).header),
});
const accountA = (extra = {}) => ({
  id: 'A', name: 'Bank A current', currency: 'GBP', kind: 'bank',
  mapping: mappingFor('bankA', BANK_A), repaymentBucketIds: [], ...extra,
});
const accountS = () => ({
  id: 'S', name: 'Bank A savings', currency: 'GBP', kind: 'bank',
  mapping: mappingFor('savings', SAVINGS), repaymentBucketIds: [],
});
const accountB = () => ({
  id: 'B', name: 'Bank B joint', currency: 'GBP', kind: 'bank',
  mapping: mappingFor('bankB', BANK_B[0]), repaymentBucketIds: [],
});

/** @param {any[]} files @param {Record<string, Set<number>>} [skips] */
const withSkips = (files, skips = {}) => files.map((f) => ({ ...f, skipRowNumbers: skips[f.name] ?? new Set() }));

/** Every review row gets `decide(review)`. */
function decisionsFor(plan, decide) {
  return new Map(plan.files.flatMap((f) => f.review.map((r) => [r.row.fingerprint, decide(r)])));
}

/** The whole pipeline for one pick, asserting no refusals along the way. */
async function run(state, account, picks, decide = () => 'both') {
  const prep = await prepareFiles(state, picks);
  assert.equal(prep.signatureError, undefined);
  const mapped = mapFiles(account, prep.files);
  assert.deepEqual(mapped.refused, []);
  const plan = planImport(state, account, withSkips(mapped.files), tuning);
  const changes = commitImport(state, account, plan, decisionsFor(plan, decide), mapped.files, NOW);
  return { prep, files: mapped.files, plan, changes };
}

async function importedBankA() {
  const state = emptyState();
  const { changes } = await run(state, accountA(), [pick(BANK_A)]);
  applyToState(state, changes);
  return state;
}

test('Bank A import: one batch, expected row count, fingerprint on every transaction', async () => {
  const state = emptyState();
  const { prep, plan, changes } = await run(state, accountA(), [pick(BANK_A)]);
  const n = expected.rowCounts[BANK_A];
  assert.deepEqual(plan.totals, { new: n, already: 0, review: 0 });
  const batches = changes.put.batches;
  assert.equal(batches.length, 1);
  const [b] = batches;
  assert.equal(b.rowCount, n);
  assert.equal(b.accountId, 'A');
  assert.equal(b.fileName, BANK_A);
  assert.equal(b.fileHash, prep.files[0].hash);
  assert.equal(b.importedAt, NOW.toISOString());
  assert.equal(b.coversFrom, '2025-11-01');
  assert.equal(b.coversTo, '2026-10-31');
  assert.equal(typeof b.importId, 'string');
  const txns = changes.put.transactions;
  assert.equal(txns.length, n);
  assert.equal(new Set(txns.map((t) => t.fingerprint)).size, n);
  for (const t of txns) {
    assert.ok(t.fingerprint.startsWith('A|'));
    assert.equal(t.batchId, b.id);
    assert.equal(t.accountId, 'A');
    assert.equal(t.currency, 'GBP');
    assert.equal(typeof t.bucketId, 'string');
  }
  assert.ok(changes.put.buckets.length > 0);
  assert.deepEqual(changes.put.accounts, [{ ...accountA(), identifier: '12345678' }]);
});

test('the same bytes again are blocked before parsing', async () => {
  const state = await importedBankA();
  const prep = await prepareFiles(state, [pick(BANK_A)]);
  assert.deepEqual(prep.blocked, [{ name: BANK_A, importedAt: NOW.toISOString(), accountName: 'Bank A current' }]);
  assert.deepEqual(prep.files, []);
  assert.equal(prep.signatureError, undefined);
});

test('prepareFiles parses each file and gives its header signature', async () => {
  const prep = await prepareFiles(emptyState(), [pick(BANK_A)]);
  const [f] = prep.files;
  assert.equal(f.name, BANK_A);
  assert.match(f.hash, /^[0-9a-f]{64}$/);
  assert.equal(f.header[0], 'Transaction Date');
  assert.equal(f.rows.length, expected.rowCounts[BANK_A]);
  assert.deepEqual(f.parseErrors, []);
  assert.equal(f.signature, accountA().mapping.headerSignature);
});

test('a pick mixing headers is refused, naming the odd file', async () => {
  const prep = await prepareFiles(emptyState(), [pick(BANK_A), pick(CARD)]);
  assert.equal(prep.signatureError, `"${CARD}" has different columns from "${BANK_A}"`);
  assert.deepEqual(prep.files, []);
});

test('suggestAccounts returns accounts whose saved mapping has the signature', () => {
  const state = emptyState();
  state.accounts.push(accountA(), accountS(), { ...accountB(), mapping: undefined });
  assert.deepEqual(suggestAccounts(state, accountA().mapping.headerSignature).map((a) => a.id), ['A']);
  assert.deepEqual(suggestAccounts(state, accountB().mapping.headerSignature), []);
});

test('three Bank B files: date order, three batches, one importId, whole months', async () => {
  const state = emptyState();
  const picks = [...BANK_B].reverse().map((n) => pick(n));
  const { files, plan, changes } = await run(state, accountB(), picks);
  assert.deepEqual(plan.files.map((f) => f.name), BANK_B);
  assert.deepEqual(Object.fromEntries(files.map((f) => [f.name, f.wholeMonth])),
    { [BANK_B[0]]: '2026-08', [BANK_B[1]]: '2026-09', [BANK_B[2]]: '2026-10' });
  const batches = changes.put.batches;
  assert.equal(batches.length, 3);
  assert.equal(new Set(batches.map((b) => b.importId)).size, 1);
  assert.equal(new Set(batches.map((b) => b.id)).size, 3);
  for (const b of batches) assert.equal(b.rowCount, expected.rowCounts[b.fileName]);
  assert.equal(changes.put.transactions.length, BANK_B.reduce((s, n) => s + expected.rowCounts[n], 0));
  assert.equal(changes.put.accounts[0].identifier, undefined);
});

test('two picked files with the same name keep their own hash and period', async () => {
  const state = emptyState();
  const [aug, sep] = [buffer(BANK_B[0]), buffer(BANK_B[1])];
  const { prep, changes } = await run(state, accountB(), [pick('statement.csv', sep), pick('statement.csv', aug)]);
  const hashOf = (/** @type {string} */ month) => prep.files.find((f) => f.rows[0].cells[0].endsWith(month)).hash;
  const batches = [...changes.put.batches].sort((a, b) => (a.coversFrom < b.coversFrom ? -1 : 1));
  assert.deepEqual(batches.map((b) => [b.fileHash, b.coversFrom.slice(0, 7), b.coversTo.slice(0, 7), b.rowCount]), [
    [hashOf('/08/2026'), '2026-08', '2026-08', expected.rowCounts[BANK_B[0]]],
    [hashOf('/09/2026'), '2026-09', '2026-09', expected.rowCounts[BANK_B[1]]],
  ]);
  applyToState(state, changes);
  for (const bytes of [aug, sep]) {
    const again = await prepareFiles(state, [pick('statement.csv', bytes)]);
    assert.equal(again.blocked.length, 1);
    assert.deepEqual(again.files, []);
  }
});

test('re-export after Bank A: 1 new, already per expected, 1 to review', async () => {
  const state = await importedBankA();
  const account = state.accounts[0];
  const prep = await prepareFiles(state, [pick(REEXPORT)]);
  const { files } = mapFiles(account, prep.files);
  const plan = planImport(state, account, withSkips(files), tuning);
  assert.deepEqual(plan.totals, { new: 1, already: expected.reexport.already, review: 1 });
  const [r] = plan.files[0].review;
  assert.equal(r.row.rawText, 'CARD PURCHASE TESCO STORE 2041');
  assert.equal(r.candidates[0].rawText, 'CARD PURCHASE TESCO STORES 2041');
  assert.equal(plan.files[0].fresh[0].date, '2026-11-02');

  const same = commitImport(state, account, plan, decisionsFor(plan, () => 'same'), files, NOW);
  assert.equal(same.put.batches.length, 1);
  assert.equal(same.put.batches[0].rowCount, 1);
  assert.equal(same.put.batches[0].coversFrom, '2026-10-01');
  assert.equal(same.put.batches[0].coversTo, '2026-11-02');
  assert.deepEqual(same.put.transactions.map((t) => t.date), ['2026-11-02']);

  const both = commitImport(state, account, plan, decisionsFor(plan, () => 'both'), files, NOW);
  assert.equal(both.put.batches[0].rowCount, 2);
  assert.deepEqual(both.put.transactions.map((t) => t.rawText).sort(),
    ['CARD PURCHASE TESCO STORE 2041', 'SQ *CORNER CAFE']);
});

test('commitImport throws when a review row has no decision', async () => {
  const state = await importedBankA();
  const account = state.accounts[0];
  const { files } = mapFiles(account, (await prepareFiles(state, [pick(REEXPORT)])).files);
  const plan = planImport(state, account, withSkips(files), tuning);
  assert.throws(() => commitImport(state, account, plan, new Map(), files, NOW), /decision/i);
});

test('overlapping files in one pick are checked against the earlier file', async () => {
  const state = emptyState();
  const { plan, changes } = await run(state, accountA(), [pick(REEXPORT), pick(BANK_A)]);
  assert.deepEqual(plan.files.map((f) => f.name), [BANK_A, REEXPORT]);
  assert.deepEqual(plan.totals, {
    new: expected.rowCounts[BANK_A] + 1, already: expected.reexport.already, review: 1,
  });
  assert.equal(changes.put.batches.length, 2);
});

test('skipped rows are left out of the plan', async () => {
  const state = emptyState();
  const account = accountA();
  const { files } = mapFiles(account, (await prepareFiles(state, [pick(BANK_A)])).files);
  const plan = planImport(state, account, withSkips(files, { [BANK_A]: new Set([2, 3]) }), tuning);
  assert.equal(plan.totals.new, expected.rowCounts[BANK_A] - 2);
  assert.ok(plan.files[0].fresh.every((r) => r.rowNumber !== 2 && r.rowNumber !== 3));
});

test('a Bank A file for account 99999999 is refused for an account with identifier 12345678', async () => {
  const bytes = encode(text(BANK_A).replaceAll('12345678', '99999999'));
  const prep = await prepareFiles(emptyState(), [pick('other.csv', bytes)]);
  const r = mapFiles(accountA({ identifier: '12345678' }), prep.files);
  assert.deepEqual(r.files, []);
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].name, 'other.csv');
  assert.match(r.refused[0].reason, /99999999/);
});

test('a file showing more than one account identifier is refused', async () => {
  const lines = text(BANK_A).split('\r\n');
  lines[1] = lines[1].replace('12345678', '99999999');
  const prep = await prepareFiles(emptyState(), [pick('mixed.csv', encode(lines.join('\r\n')))]);
  const r = mapFiles(accountA(), prep.files);
  assert.deepEqual(r.files, []);
  assert.equal(r.refused[0].name, 'mixed.csv');
  assert.match(r.refused[0].reason, /more than one/i);
});

test('files in one pick for a new account that show different identifiers are refused', async () => {
  const other = encode(text(REEXPORT).replaceAll('12345678', '99999999'));
  const prep = await prepareFiles(emptyState(), [pick(BANK_A), pick('other.csv', other)]);
  const r = mapFiles(accountA(), prep.files);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.refused.map((x) => x.name), [BANK_A, 'other.csv']);
});

test('a file missing a mapped column is refused with the mapping problem', async () => {
  const prep = await prepareFiles(emptyState(), [pick(SAVINGS)]);
  const r = mapFiles(accountA(), prep.files);
  assert.deepEqual(r.files, []);
  assert.match(r.refused[0].reason, /Missing column: Account Number/);
});

test('undoBatches removes only those transactions; overrides stay; re-import gives the same fingerprints', async () => {
  const state = await importedBankA();
  applyToState(state, (await run(state, accountS(), [pick(SAVINGS)])).changes);
  const batchA = state.batches.find((b) => b.accountId === 'A');
  const fpsA = new Set(state.transactions.filter((t) => t.accountId === 'A').map((t) => t.fingerprint));
  const fp = [...fpsA][0];
  state.overrides.set(fp, { fingerprint: fp, categoryId: 'cat-1' });
  const bucketCount = state.buckets.length;

  const undo = undoBatches(state, [batchA.id]);
  assert.deepEqual(undo.put, undefined);
  applyToState(state, undo);
  assert.equal(state.batches.length, 1);
  assert.equal(state.transactions.length, expected.rowCounts[SAVINGS]);
  assert.ok(state.transactions.every((t) => t.accountId === 'S'));
  assert.deepEqual(state.overrides.get(fp), { fingerprint: fp, categoryId: 'cat-1' });
  assert.equal(state.buckets.length, bucketCount);

  const again = await run(state, state.accounts.find((a) => a.id === 'A'), [pick(BANK_A)]);
  assert.deepEqual(again.prep.blocked, []);
  applyToState(state, again.changes);
  assert.deepEqual(new Set(state.transactions.filter((t) => t.accountId === 'A').map((t) => t.fingerprint)), fpsA);
  assert.ok(state.overrides.has(fp));
});

test('nothing new and nothing to review: no batch, and {} for an unchanged account', async () => {
  const state = await importedBankA();
  const account = state.accounts[0];
  const bytes = encode(`${text(BANK_A)}\r\n`);
  const prep = await prepareFiles(state, [pick('again.csv', bytes)]);
  assert.deepEqual(prep.blocked, []);
  const { files } = mapFiles(account, prep.files);
  const plan = planImport(state, account, withSkips(files), tuning);
  assert.deepEqual(plan.totals, { new: 0, already: expected.rowCounts[BANK_A], review: 0 });
  assert.deepEqual(commitImport(state, account, plan, new Map(), files, NOW), {});
});

test('a new account with nothing to save puts just the account', async () => {
  const state = emptyState();
  const account = accountA();
  const headerOnly = encode(`${text(BANK_A).split('\r\n')[0]}\r\n`);
  const prep = await prepareFiles(state, [pick('empty.csv', headerOnly)]);
  const { files } = mapFiles(account, prep.files);
  assert.equal(files[0].coversFrom, '');
  assert.equal(files[0].coversTo, '');
  assert.equal(files[0].wholeMonth, undefined);
  const plan = planImport(state, account, withSkips(files), tuning);
  assert.deepEqual(commitImport(state, account, plan, new Map(), files, NOW), { put: { accounts: [account] } });
});
