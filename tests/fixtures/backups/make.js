// Writes tests/fixtures/backups/v<DATA_VERSION>.json and v<DATA_VERSION>.expected.json: a backup of
// the synthetic fixture state plus one of each per-transaction and bucket decision, and the facts
// that backup restores to. Run once, last, when DATA_VERSION is bumped (see the bump checklist in
// src/migrate.js). An old version's files are frozen: this refuses to overwrite either.
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixtureState } from '../../unit/helpers/fixture-state.js';
import { restoreBackup, factsOf, factsJson } from '../../unit/helpers/backup-facts.js';
import { applyToState } from '../../../src/changes.js';
import { buildBackup } from '../../../src/backup.js';
import { setCategoryOverride, setSplit, dismissUnusual } from '../../../src/overrides.js';
import { resolveFlag } from '../../../src/rules.js';
import { setBucketStopped, stoppedDateFor } from '../../../src/buckets.js';
import { decidePair } from '../../../src/transfers.js';
import { DATA_VERSION } from '../../../src/version.js';

const file = fileURLToPath(new URL(`./v${DATA_VERSION}.json`, import.meta.url));
const expectedFile = fileURLToPath(new URL(`./v${DATA_VERSION}.expected.json`, import.meta.url));
for (const f of [file, expectedFile]) {
  if (existsSync(f)) {
    console.error(`${f} already exists. Frozen backups are never overwritten; delete it by hand only if you are sure.`);
    process.exit(1);
  }
}

/** @param {boolean} ok @param {string} what @returns {asserts ok} */
function need(ok, what) {
  if (!ok) throw new Error(`make.js: ${what}`);
}

const state = await fixtureState();
/** @param {string} name */
const bucketNamed = (name) => {
  const b = state.buckets.find((x) => x.displayName === name);
  need(b !== undefined, `no bucket named ${name}`);
  return b;
};
/** @param {string} name */
const categoryNamed = (name) => {
  const c = state.categories.find((x) => x.name === name);
  need(c !== undefined, `no category named ${name}`);
  return c;
};
/** @param {string} bucketName @param {(t: any) => boolean} [where] */
const txnIn = (bucketName, where = () => true) => {
  const id = bucketNamed(bucketName).id;
  const t = state.transactions.find((x) => x.bucketId === id && where(x));
  need(t !== undefined, `no matching transaction in ${bucketName}`);
  return t;
};

// A category move: one grocery shop counted as eating out.
applyToState(state, setCategoryOverride(state, txnIn('TESCO STORES').fingerprint, categoryNamed('Eating out').id));

// A split across two categories, on a transaction also marked as a normal amount.
const order = txnIn('AMAZON.CO.UK', (t) => t.amountMinor === -6069);
const split = setSplit(state, order, [
  { amountMinor: -4000, categoryId: categoryNamed('Household maintenance').id },
  { amountMinor: -2069, categoryId: categoryNamed('Gifts').id },
]);
need(!('error' in split), 'split refused');
applyToState(state, split);
applyToState(state, dismissUnusual(state, order.fingerprint));

// A flag decision on the extra match of a PAYPAL PAYMENT amount rule: it goes to the rule.
const flagged = state.transactions.find((t) => t.flaggedRuleId);
need(flagged !== undefined, 'no flagged transaction');
applyToState(state, resolveFlag(state, flagged.fingerprint, 'rule'));

// A bucket marked Stopped after its latest charge, as the category view does.
const stopped = bucketNamed('NEWSAGENT J PATEL');
applyToState(state, setBucketStopped(state, stopped.id, stoppedDateFor(state, stopped.id)));

// One suggested pair rejected instead of confirmed.
const [pair] = [...state.transferPairs.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
const sideA = state.transactions.find((t) => t.fingerprint === pair.fingerprintA);
const sideB = state.transactions.find((t) => t.fingerprint === pair.fingerprintB);
need(sideA !== undefined && sideB !== undefined, 'pair sides not found');
applyToState(state, decidePair(sideA, sideB, 'rejected'));

const backup = buildBackup(state, new Date('2026-11-04T10:00:00.000Z'));
const text = JSON.stringify(backup);
const facts = factsOf(restoreBackup(JSON.parse(text), `v${DATA_VERSION}.json`));
writeFileSync(file, text);
writeFileSync(expectedFile, factsJson(facts));
console.log(`Wrote ${file}\nWrote ${expectedFile}`);
