// Facts about a restored backup that come only from the backup's own data, read through the app's
// resolve path. They never depend on the owner-editable default-categories.js or tuning.js, so a
// frozen backup's facts (tests/fixtures/backups/vN.expected.json) stay true when those change.
/** @import {State} from '../../../src/types.js' */
import { validateBackup, restoreChanges } from '../../../src/backup.js';
import { emptyState, applyToState } from '../../../src/changes.js';
import { buildContext, resolve } from '../../../src/resolve.js';

/** @param {string} a @param {string} b */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Upgrade, validate and restore backup JSON into a fresh state, as the Backup screen does.
 * @param {unknown} json
 * @param {string} label named in the error when the backup is refused
 * @returns {State}
 */
export function restoreBackup(json, label) {
  const r = validateBackup(json);
  if (!r.ok) throw new Error(`${label}: ${r.errors.join('; ')}`);
  const state = emptyState();
  applyToState(state, restoreChanges(r.data, state.settings));
  return state;
}

/**
 * The transaction count; each transaction's bucket display name, how it resolves, and its parts
 * with category names (several for a split); the confirmed and rejected pair keys; overrides
 * counted by kind; and the buckets marked Stopped.
 * @param {State} state
 */
export function factsOf(state) {
  const ctx = buildContext(state);
  /** @param {string|null} id */
  const categoryName = (id) => (id === null ? null : ctx.categories.get(id)?.name ?? null);
  const rows = state.transactions
    .map((t) => {
      const r = resolve(t, ctx);
      return [t.fingerprint, ctx.buckets.get(t.bucketId)?.displayName ?? null, r.source,
        r.parts.map((p) => [p.amountMinor, categoryName(p.categoryId)])];
    })
    .sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
  const pairs = [...state.transferPairs.values()];
  const overrides = [...state.overrides.values()];
  return {
    transactions: state.transactions.length,
    pairs: {
      confirmed: pairs.filter((p) => p.status === 'confirmed').map((p) => p.key).sort(cmp),
      rejected: pairs.filter((p) => p.status === 'rejected').map((p) => p.key).sort(cmp),
    },
    overrides: {
      move: overrides.filter((o) => o.categoryId !== undefined).length,
      split: overrides.filter((o) => o.splits !== undefined).length,
      unusualDismissed: overrides.filter((o) => o.unusualDismissed === true).length,
      flagDecision: overrides.filter((o) => o.flagDecision !== undefined).length,
    },
    stopped: state.buckets.filter((b) => b.stoppedAfter).map((b) => [b.displayName, b.stoppedAfter])
      .sort((a, b) => cmp(String(a[0]), String(b[0]))),
    rows,
  };
}

/**
 * Facts as JSON with one transaction per line, so a change shows as a readable diff.
 * @param {ReturnType<typeof factsOf>} facts
 * @returns {string}
 */
export function factsJson(facts) {
  const { rows, ...rest } = facts;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  return `${head},\n  "rows": [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]\n}\n`;
}
