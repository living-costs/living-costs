// Upgrading data from older versions. Backup content is untrusted: steps run on unvalidated JSON,
// so they must never throw on odd shapes.
//
// Bump checklist, for any change to the shape of stored data or backups, or to normaliser or
// fingerprint output:
//   1. Bump DATA_VERSION in src/version.js.
//   2. Add a step to STEPS below, `to` the new version.
//   3. For a normaliser change, first copy the old normaliser to src/normalise-vN.js (N its
//      NORMALISER_VERSION), raise NORMALISER_VERSION, and set the step's rematchFrom to the copy's
//      normalise.
//   4. If stores or indexes change, bump DB_VERSION in src/db.js too.
//   5. Update PINNED in tests/unit/versions.test.js (its failure message gives the new hash).
//   6. Last, once the change is complete, run node tests/fixtures/backups/make.js once to freeze
//      the new version's backup and expected facts. Never touch older files.
//   7. End the PR description with: "After merging, tag the merge commit:
//      `git tag data-vN <merge-sha> && git push origin data-vN`".

/** @import {StoreName} from './types.js' */
/** @typedef {(rawText: string, rawType?: string) => string} Normaliser */
/** @typedef {{to: number, run: (doc: Record<string, unknown>) => Record<string, unknown>, rematchFrom?: Normaliser}} Step */

/** @param {unknown} x @returns {x is Record<string, unknown>} */
const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);

/** @param {Record<string, unknown>} o @param {string} k */
const get = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);

/** @type {Step[]} STEPS[i].to is i + 2. */
export const STEPS = [
  {
    // Rules no longer carry a normaliser version.
    to: 2,
    run: (doc) => {
      const rules = get(doc, 'rules');
      if (!Array.isArray(rules)) return { ...doc };
      return {
        ...doc,
        rules: rules.map((r) => {
          if (!isObj(r)) return r;
          const copy = { ...r };
          delete copy.normaliserVersion;
          return copy;
        }),
      };
    },
  },
  {
    // A Transfer-kind category named Savings becomes a Variable Saving one.
    to: 3,
    run: (doc) => {
      const categories = get(doc, 'categories');
      if (!Array.isArray(categories)) return { ...doc };
      return {
        ...doc,
        categories: categories.map((c) => (isObj(c) && c.kind === 'transfer' && typeof c.name === 'string'
          && c.name.trim().toLowerCase() === 'savings' ? { ...c, kind: 'saving', budgetType: 'variable' } : c)),
      };
    },
  },
];

/**
 * Run the steps from version `from` up to the last one. Never mutates `doc`.
 * @param {Record<string, unknown>} doc
 * @param {number} from
 * @param {Step[]} [steps]
 * @returns {{doc: Record<string, unknown>, rematchFrom?: Normaliser}}
 */
export function upgradeRaw(doc, from, steps = STEPS) {
  let current = { ...doc };
  /** @type {Normaliser | undefined} */
  let rematchFrom;
  for (const step of steps.slice(from - 1)) {
    current = { ...step.run(current), schemaVersion: step.to };
    rematchFrom ??= step.rematchFrom;
  }
  return rematchFrom ? { doc: current, rematchFrom } : { doc: current };
}

/**
 * The version of the stored data: null for a fresh install, 1 when there is data but no settings row
 * (data from before versioning: the first run's seed always writes the row since), NaN when the
 * settings row's version is not usable.
 * @param {Record<StoreName, unknown[]>} rows
 * @returns {number | null}
 */
export function storedVersion(rows) {
  const settings = rows.settings.find((r) => isObj(r) && get(r, 'id') === 'settings');
  if (!settings) return Object.values(rows).some((list) => list.length > 0) ? 1 : null;
  const v = isObj(settings) ? get(settings, 'schemaVersion') : undefined;
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : NaN;
}

/**
 * Stored rows laid out as a backup file of the given version.
 * @param {Record<StoreName, unknown[]>} rows
 * @param {number} version
 * @param {Date} now
 * @returns {Record<string, unknown>}
 */
export function rowsAsBackup(rows, version, now) {
  const settings = rows.settings.find((r) => isObj(r) && get(r, 'id') === 'settings');
  const offered = isObj(settings) ? get(settings, 'offeredDefaultIds') : undefined;
  return {
    app: 'living-costs',
    schemaVersion: version,
    exportedAt: now.toISOString(),
    accounts: rows.accounts,
    batches: rows.batches,
    transactions: rows.transactions,
    buckets: rows.buckets,
    rules: rows.rules,
    categories: rows.categories,
    overrides: rows.overrides,
    transferPairs: rows.transferPairs,
    offeredDefaultIds: Array.isArray(offered) ? offered : [],
  };
}
