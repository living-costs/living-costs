import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, upgradeRaw, storedVersion, rowsAsBackup } from '../../src/migrate.js';
import { DATA_VERSION } from '../../src/version.js';

/** @type {import('../../src/migrate.js').Normaliser} */
const n3 = (t) => `n3:${t}`;
/** @type {import('../../src/migrate.js').Normaliser} */
const n4 = (t) => `n4:${t}`;

/**
 * @param {number} to
 * @param {import('../../src/migrate.js').Normaliser} [rematchFrom]
 * @returns {import('../../src/migrate.js').Step}
 */
const trailStep = (to, rematchFrom) => ({
  to,
  run: (doc) => ({ ...doc, trail: [...(/** @type {number[]} */ (doc.trail) ?? []), to] }),
  ...(rematchFrom ? { rematchFrom } : {}),
});

/** @returns {Record<import('../../src/types.js').StoreName, unknown[]>} */
const emptyRows = () => ({
  settings: [], accounts: [], batches: [], transactions: [], buckets: [], rules: [],
  categories: [], overrides: [], transferPairs: [],
});

test('one step per version: STEPS[i].to is i + 2 and STEPS.length is DATA_VERSION - 1', () => {
  assert.equal(STEPS.length, DATA_VERSION - 1);
  STEPS.forEach((s, i) => assert.equal(s.to, i + 2));
});

test('step to 2 drops normaliserVersion from rules and leaves other shapes alone', () => {
  const step = STEPS[0];
  assert.deepEqual(step.run({ rules: 'x', a: 1 }), { rules: 'x', a: 1 });
  const input = { rules: [1, { id: 'r', normaliserVersion: 1 }] };
  assert.deepEqual(step.run(input), { rules: [1, { id: 'r' }] });
  assert.deepEqual(input, { rules: [1, { id: 'r', normaliserVersion: 1 }] });
  step.run(JSON.parse('{"rules":[{"__proto__":{"polluted":1},"id":"r"}]}'));
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test('upgradeRaw runs steps in order, sets schemaVersion, and does not mutate', () => {
  const steps = [trailStep(2), trailStep(3), trailStep(4)];
  const input = { schemaVersion: 2, trail: [] };
  const { doc } = upgradeRaw(input, 2, steps);
  assert.deepEqual(doc.trail, [3, 4]);
  assert.equal(doc.schemaVersion, 4);
  assert.deepEqual(input, { schemaVersion: 2, trail: [] });
});

test('upgradeRaw returns the oldest rematchFrom in the run', () => {
  const steps = [trailStep(2), trailStep(3, n3), trailStep(4, n4)];
  assert.equal(upgradeRaw({}, 2, steps).rematchFrom, n3);
  assert.equal(upgradeRaw({}, 3, steps).rematchFrom, n4);
  assert.equal(upgradeRaw({}, 4, steps).rematchFrom, undefined);
});

test('storedVersion: fresh, no settings row, a number, junk', () => {
  assert.equal(storedVersion(emptyRows()), null);
  assert.equal(storedVersion({ ...emptyRows(), accounts: [{ id: 'a' }] }), 1);
  assert.equal(storedVersion({ ...emptyRows(), settings: [{ id: 'settings', schemaVersion: 2 }] }), 2);
  assert.ok(Number.isNaN(storedVersion({ ...emptyRows(), settings: [{ id: 'settings', schemaVersion: 'x' }] })));
  assert.ok(Number.isNaN(storedVersion({ ...emptyRows(), settings: [{ id: 'settings', schemaVersion: 0 }] })));
});

test('rowsAsBackup holds every store and the old version', () => {
  const rows = {
    ...emptyRows(),
    settings: [{ id: 'settings', schemaVersion: 1, offeredDefaultIds: ['d1'] }],
    accounts: [{ id: 'a' }], batches: [{ id: 'b' }], transactions: [{ id: 't' }], buckets: [{ id: 'k' }],
    rules: [{ id: 'r' }], categories: [{ id: 'c' }], overrides: [{ fingerprint: 'f' }], transferPairs: [{ key: 'p' }],
  };
  const now = new Date('2026-11-06T10:00:00.000Z');
  assert.deepEqual(rowsAsBackup(rows, 1, now), {
    app: 'living-costs', schemaVersion: 1, exportedAt: '2026-11-06T10:00:00.000Z',
    accounts: [{ id: 'a' }], batches: [{ id: 'b' }], transactions: [{ id: 't' }], buckets: [{ id: 'k' }],
    rules: [{ id: 'r' }], categories: [{ id: 'c' }], overrides: [{ fingerprint: 'f' }], transferPairs: [{ key: 'p' }],
    offeredDefaultIds: ['d1'],
  });
  assert.deepEqual(rowsAsBackup(emptyRows(), 1, now).offeredDefaultIds, []);
});
