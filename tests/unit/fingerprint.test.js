import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, withFingerprints } from '../../src/fingerprint.js';
import { sha256Hex } from '../../src/hash.js';
import { similarity } from '../../src/similarity.js';

const row = (rowNumber, date, amountMinor, rawText) => ({ rowNumber, date, amountMinor, rawText });

test('fingerprint format', () => {
  assert.equal(fingerprint('a1', '2026-09-24', -350, 'CAFE', 2), 'a1|2026-09-24|-350|CAFE|2');
});

test('identical same-day rows get ordinals 0,1,2', () => {
  const out = withFingerprints('a1', [
    row(1, '2026-09-24', -350, 'CAFE'),
    row(2, '2026-09-24', -350, 'CAFE'),
    row(3, '2026-09-24', -999, 'CAFE'),
    row(4, '2026-09-24', -350, 'CAFE'),
  ]);
  assert.deepEqual(out.map((r) => r.fingerprint), [
    'a1|2026-09-24|-350|CAFE|0',
    'a1|2026-09-24|-350|CAFE|1',
    'a1|2026-09-24|-999|CAFE|0',
    'a1|2026-09-24|-350|CAFE|2',
  ]);
  assert.equal(out[0].rowNumber, 1);
});

test('fingerprints are stable across calls and rawText is used as given', () => {
  const rows = [row(1, '2026-09-24', -350, ' Cafe '), row(2, '2026-09-24', -350, 'Cafe')];
  assert.deepEqual(withFingerprints('a', rows), withFingerprints('a', rows));
  assert.deepEqual(withFingerprints('a', rows).map((r) => r.fingerprint.endsWith('|0')), [true, true]);
});

test('sha256Hex of abc', async () => {
  const buf = new TextEncoder().encode('abc').buffer;
  assert.equal(await sha256Hex(buf), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('similarity', () => {
  assert.ok(similarity('TESCO STORES', 'TESCO STORE') > 0.8);
  assert.ok(similarity('TESCO', 'SHELL') < 0.3);
  assert.equal(similarity('Tesco  Stores', 'TESCO STORES'), 1);
  assert.equal(similarity('', ''), 1);
  assert.equal(similarity('a', 'a'), 1);
  assert.equal(similarity('a', 'b'), 0);
  assert.equal(similarity('a', ''), 0);
  assert.equal(similarity('AAAA', 'AA'), 2 * 1 / (3 + 1));
});
