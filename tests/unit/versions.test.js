import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_VERSION } from '../../src/version.js';
import { normalise } from '../../src/normalise.js';
import { fixtureState } from './helpers/fixture-state.js';
import { restoreBackup, factsOf } from './helpers/backup-facts.js';

/** @param {string} name a file in tests/fixtures/backups */
const backupFile = (name) => fileURLToPath(new URL(`../fixtures/backups/${name}`, import.meta.url));
const versions = Array.from({ length: DATA_VERSION - 1 }, (_, i) => i + 2);

// Output of the normaliser and fingerprints over the synthetic fixtures, at this data version.
const PINNED = { dataVersion: 3, sha256: 'd86cbb0e3914e0a927ceacf342ecb09ffeda55f276755fdf32993709f74d2c14' };

test('a frozen backup and its expected facts exist for every version from 2 to DATA_VERSION', () => {
  for (const v of versions) {
    for (const name of [`v${v}.json`, `v${v}.expected.json`]) {
      assert.ok(existsSync(backupFile(name)),
        `tests/fixtures/backups/${name} is missing. Write both files with node tests/fixtures/backups/make.js (see the bump checklist in src/migrate.js).`);
    }
  }
});

// The facts were frozen with each file, so editing default-categories.js or tuning.js can't break this.
test('every frozen backup upgrades, validates and restores to its frozen facts', () => {
  for (const v of versions) {
    const state = restoreBackup(JSON.parse(readFileSync(backupFile(`v${v}.json`), 'utf8')), `v${v}.json`);
    assert.equal(state.settings.schemaVersion, DATA_VERSION, `v${v}.json`);
    const want = JSON.parse(readFileSync(backupFile(`v${v}.expected.json`), 'utf8'));
    assert.deepEqual(factsOf(state), want, `v${v}.json no longer restores to the facts in v${v}.expected.json`);
  }
});

test('normaliser and fingerprint output is pinned to DATA_VERSION', async () => {
  const rows = [...(await fixtureState()).transactions].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
  const hash = createHash('sha256')
    .update(JSON.stringify(rows.map((t) => [t.fingerprint, normalise(t.rawText, t.rawType)])))
    .digest('hex');
  if (hash === PINNED.sha256 && PINNED.dataVersion === DATA_VERSION) return;
  if (PINNED.dataVersion === DATA_VERSION) {
    assert.fail('Normaliser or fingerprint output changed. Bump DATA_VERSION and add a step: for the normaliser, '
      + 'freeze the old one as src/normalise-vN.js and set rematchFrom to it; for fingerprints, a remap. '
      + `Then update PINNED to ${hash}. See the bump checklist in src/migrate.js.`);
  }
  assert.fail(`Update PINNED for version ${DATA_VERSION}: ${hash}.`);
});
