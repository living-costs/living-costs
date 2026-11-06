// Writes tests/fixtures/backups/v<DATA_VERSION>.json from the synthetic fixture state.
// Run once when DATA_VERSION is bumped. An old version's file is frozen: this refuses to overwrite.
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixtureState } from '../../unit/helpers/fixture-state.js';
import { buildBackup } from '../../../src/backup.js';
import { DATA_VERSION } from '../../../src/version.js';

const file = fileURLToPath(new URL(`./v${DATA_VERSION}.json`, import.meta.url));
if (existsSync(file)) {
  console.error(`${file} already exists. Frozen backups are never overwritten; delete it by hand only if you are sure.`);
  process.exit(1);
}
const backup = buildBackup(await fixtureState(), new Date('2026-11-04T10:00:00.000Z'));
writeFileSync(file, JSON.stringify(backup));
console.log(`Wrote ${file}`);
