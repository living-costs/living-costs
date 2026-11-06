// Upgrading data from older versions. Backup content is untrusted: steps run on unvalidated JSON,
// so they must never throw on odd shapes.

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
 * The version of the stored data: null for a fresh install, 1 when there is data but no settings row,
 * NaN when the settings row's version is not usable.
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
