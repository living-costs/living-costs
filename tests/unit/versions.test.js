import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_VERSION } from '../../src/version.js';
import { validateBackup, restoreChanges } from '../../src/backup.js';
import { emptyState, applyToState } from '../../src/changes.js';
import { typicalMonth } from '../../src/typical.js';
import { normalise } from '../../src/normalise.js';
import tuning from '../../src/tuning.js';
import { fixtureState } from './helpers/fixture-state.js';

/** @param {number} v */
const fileFor = (v) => fileURLToPath(new URL(`../fixtures/backups/v${v}.json`, import.meta.url));
const versions = Array.from({ length: DATA_VERSION - 1 }, (_, i) => i + 2);

/**
 * A typical month with every generated ID replaced by a name (categories, accounts) or a marker,
 * so two states built from the same data compare equal.
 * @param {import('../../src/changes.js').State} state
 */
function comparable(state) {
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const c of state.categories) names.set(c.id, `category:${c.name}`);
  for (const a of state.accounts) names.set(a.id, `account:${a.name}`);
  // Sorted keys, because a restored row may list its fields in another order.
  const text = JSON.stringify(typicalMonth(state, tuning), (_k, v) => (
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v));
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => names.get(id) ?? 'id');
}

// Output of the normaliser and fingerprints over the synthetic fixtures, at this data version.
const PINNED = { dataVersion: 2, sha256: 'd86cbb0e3914e0a927ceacf342ecb09ffeda55f276755fdf32993709f74d2c14' };

test('a frozen backup exists for every version from 2 to DATA_VERSION', () => {
  for (const v of versions) {
    assert.ok(existsSync(fileFor(v)), `tests/fixtures/backups/v${v}.json is missing. Add one with node tests/fixtures/backups/make.js`);
  }
});

test('every frozen backup upgrades, validates and restores to the same typical month', async () => {
  const want = comparable(await fixtureState());
  for (const v of versions) {
    const r = validateBackup(JSON.parse(readFileSync(fileFor(v), 'utf8')));
    assert.ok(r.ok, `v${v}: ${r.ok ? '' : r.errors.join('; ')}`);
    const data = /** @type {{ok: true, data: any}} */ (r).data;
    assert.equal(data.schemaVersion, DATA_VERSION, `v${v}`);
    const after = emptyState();
    applyToState(after, restoreChanges(data, after));
    assert.equal(comparable(after), want, `v${v}`);
  }
});

test('normaliser and fingerprint output is pinned to DATA_VERSION', async () => {
  const rows = [...(await fixtureState()).transactions].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
  const hash = createHash('sha256')
    .update(JSON.stringify(rows.map((t) => [t.fingerprint, normalise(t.rawText, t.rawType)])))
    .digest('hex');
  if (hash === PINNED.sha256 && PINNED.dataVersion === DATA_VERSION) return;
  if (PINNED.dataVersion === DATA_VERSION) {
    assert.fail(`Normaliser or fingerprint output changed. Bump DATA_VERSION and add a step (rematchFrom for the normaliser, a remap for fingerprints), then update PINNED to ${hash}.`);
  }
  assert.fail(`Update PINNED for version ${DATA_VERSION}: ${hash}.`);
});
