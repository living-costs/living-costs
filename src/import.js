// The import pipeline, as pure steps the UI drives in order:
// prepareFiles (hash check, parse) → suggestAccounts → mapFiles → planImport → commitImport.
// undoBatches reverses a commit. Nothing here deletes a transaction except undo, and nothing is
// guessed: a review row with no decision is an error.
/** @import {State, Changes, Account, Batch, Transaction} from './types.js' */
/** @import {MappedRow, RowError} from './mapping.js' */
/** @import {ExistingRow, Interval} from './dedupe.js' */
import { decodeBytes, parseCsv } from './csv.js';
import { headerSignature, mappingProblems, applyMapping } from './mapping.js';
import { withFingerprints } from './fingerprint.js';
import { sha256Hex } from './hash.js';
import { classifyIncoming } from './dedupe.js';
import { assignBuckets } from './buckets.js';
import { combine } from './changes.js';
import { coverageIntervals } from './coverage.js';
import { monthOf } from './dates.js';

/** @typedef {{rowNumber:number,cells:string[]}} CsvRow */
/** @typedef {{name:string,hash:string,header:string[],rows:CsvRow[],parseErrors:RowError[],signature:string}} PreparedFile */
/**
 * `coversFrom`/`coversTo` are the first and last mapped dates, or '' when no row mapped.
 * `wholeMonth` (YYYY-MM) is set only when every mapped row is in one calendar month.
 * @typedef {PreparedFile & {mapped:MappedRow[],mapErrors:RowError[],identifiers:string[],
 *   coversFrom:string,coversTo:string,wholeMonth?:string}} MappedFile
 */
/** @typedef {MappedFile & {skipRowNumbers:Set<number>}} PlannedFile */
/** @typedef {MappedRow & {fingerprint:string}} PlanRow */
/** @typedef {{row:PlanRow,candidates:ExistingRow[]}} ReviewRow */
/** `hash` pairs the entry with its MappedFile; names can repeat within a pick. */
/** @typedef {{name:string,hash:string,fresh:PlanRow[],already:PlanRow[],review:ReviewRow[]}} PlanFile */
/** @typedef {{files:PlanFile[],totals:{new:number,already:number,review:number}}} ImportPlan */
/** @typedef {{transactionMatchDays:number,coverageGapDays:number}} ImportTuning */

/**
 * Hashes every file, blocks any whose hash matches a batch in any account (unparsed), and parses
 * the rest. If the remaining files don't all share one header signature, the pick is refused:
 * `signatureError` names the first odd file and `files` is empty.
 * @param {State} state
 * @param {{name:string,bytes:ArrayBuffer}[]} files
 * @returns {Promise<{blocked:{name:string,importedAt:string,accountName:string}[],files:PreparedFile[],signatureError?:string}>}
 */
export async function prepareFiles(state, files) {
  const hashes = await Promise.all(files.map((f) => sha256Hex(f.bytes)));
  /** @type {{name:string,importedAt:string,accountName:string}[]} */
  const blocked = [];
  /** @type {PreparedFile[]} */
  const prepared = [];
  files.forEach((f, i) => {
    const hash = hashes[i];
    const batch = state.batches.find((b) => b.fileHash === hash);
    if (batch) {
      const accountName = state.accounts.find((a) => a.id === batch.accountId)?.name ?? '';
      blocked.push({ name: f.name, importedAt: batch.importedAt, accountName });
      return;
    }
    const { header, rows, errors } = parseCsv(decodeBytes(f.bytes));
    prepared.push({ name: f.name, hash, header, rows, parseErrors: errors, signature: headerSignature(header) });
  });
  const odd = prepared.find((p) => p.signature !== prepared[0].signature);
  if (odd) {
    return { blocked, files: [], signatureError: `"${odd.name}" has different columns from "${prepared[0].name}"` };
  }
  return { blocked, files: prepared };
}

/**
 * @param {State} state
 * @param {string} signature
 * @returns {Account[]} accounts whose saved mapping has this header signature
 */
export function suggestAccounts(state, signature) {
  return state.accounts.filter((a) => a.mapping?.headerSignature === signature);
}

/**
 * Applies the account's mapping to each file. A file is refused when the mapping doesn't fit its
 * header, when its rows show more than one account identifier, when its identifier differs from
 * `account.identifier`, or (for an account with no identifier yet) when files in the pick show
 * different identifiers.
 * @param {Account} account
 * @param {PreparedFile[]} files
 * @returns {{files:MappedFile[],refused:{name:string,reason:string}[]}}
 */
export function mapFiles(account, files) {
  /** @type {({file:MappedFile}|{refused:{name:string,reason:string}})[]} */
  const outcomes = files.map((f) => {
    const mapping = account.mapping;
    if (!mapping) return { refused: { name: f.name, reason: 'This account has no column mapping' } };
    const problems = mappingProblems(mapping, f.header);
    if (problems.length) return { refused: { name: f.name, reason: problems.join('; ') } };
    const m = applyMapping(mapping, f.header, f.rows, account.currency);
    if (m.identifiers.length > 1) {
      return { refused: { name: f.name, reason: `Rows show more than one account: ${m.identifiers.join(', ')}` } };
    }
    const id = m.identifiers[0];
    if (account.identifier && id !== undefined && id !== account.identifier) {
      return { refused: { name: f.name, reason: `Rows are for account ${id}, not ${account.identifier}` } };
    }
    return { file: withCovers({ ...f, mapped: m.rows, mapErrors: m.errors, identifiers: m.identifiers }) };
  });

  if (!account.identifier) {
    const ids = new Set(outcomes.flatMap((o) => ('file' in o ? o.file.identifiers : [])));
    if (ids.size > 1) {
      const reason = `Files in this pick are for different accounts: ${[...ids].join(', ')}`;
      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i];
        if ('file' in o && o.file.identifiers.length) outcomes[i] = { refused: { name: o.file.name, reason } };
      }
    }
  }
  return {
    files: outcomes.flatMap((o) => ('file' in o ? [o.file] : [])),
    refused: outcomes.flatMap((o) => ('refused' in o ? [o.refused] : [])),
  };
}

/**
 * @param {Omit<MappedFile,'coversFrom'|'coversTo'|'wholeMonth'>} f
 * @returns {MappedFile}
 */
function withCovers(f) {
  const dates = f.mapped.map((r) => r.date).sort();
  if (dates.length === 0) return { ...f, coversFrom: '', coversTo: '' };
  const coversFrom = dates[0];
  const coversTo = dates[dates.length - 1];
  /** @type {MappedFile} */
  const out = { ...f, coversFrom, coversTo };
  if (monthOf(coversFrom) === monthOf(coversTo)) out.wholeMonth = monthOf(coversFrom);
  return out;
}

/**
 * Classifies each file's rows, in `coversFrom` order, against the account's transactions plus the
 * earlier files' fresh and review rows, inside the coverage of the account's batches plus the
 * earlier files' declared periods (as given, so edits by the user count).
 * @param {State} state
 * @param {Account} account
 * @param {PlannedFile[]} files
 * @param {ImportTuning} tuning
 * @returns {ImportPlan}
 */
export function planImport(state, account, files, tuning) {
  /** @type {ExistingRow[]} */
  const existing = state.transactions.filter((t) => t.accountId === account.id)
    .map(({ fingerprint, date, amountMinor, rawText }) => ({ fingerprint, date, amountMinor, rawText }));
  /** @type {Batch[]} */
  const periods = state.batches.filter((b) => b.accountId === account.id);
  const ordered = [...files].sort((a, b) => (a.coversFrom < b.coversFrom ? -1 : a.coversFrom > b.coversFrom ? 1 : 0));

  /** @type {PlanFile[]} */
  const out = [];
  const totals = { new: 0, already: 0, review: 0 };
  for (const f of ordered) {
    const incoming = withFingerprints(account.id, f.mapped.filter((r) => !f.skipRowNumbers.has(r.rowNumber)));
    /** @type {Interval[]} */
    const covered = coverageIntervals(periods, tuning.coverageGapDays);
    const { fresh, already, review } = classifyIncoming({
      existing: [...existing], incoming, covered, matchDays: tuning.transactionMatchDays,
    });
    out.push({ name: f.name, hash: f.hash, fresh, already, review });
    totals.new += fresh.length;
    totals.already += already.length;
    totals.review += review.length;
    existing.push(...fresh, ...review.map((r) => r.row));
    if (f.coversFrom && f.coversTo) {
      periods.push(/** @type {Batch} */ ({ coversFrom: f.coversFrom, coversTo: f.coversTo }));
    }
  }
  return { files: out, totals };
}

/**
 * Saves each file's fresh rows plus review rows decided 'both' as one batch per file (files with
 * nothing to save get none); all batches share one importId. Throws if a review row has no
 * decision. Always puts the account when anything is saved, with `identifier` set from the files
 * if it was unset. With nothing saved, returns `{}`, or just the account if it is new or changed.
 * @param {State} state
 * @param {Account} account
 * @param {ImportPlan} plan
 * @param {Map<string,'same'|'both'>} decisions keyed by fingerprint
 * @param {MappedFile[]} files
 * @param {Date} now
 * @returns {Changes}
 */
export function commitImport(state, account, plan, decisions, files, now) {
  for (const pf of plan.files) {
    for (const r of pf.review) {
      const d = decisions.get(r.row.fingerprint);
      if (d !== 'same' && d !== 'both') throw new Error(`No decision for review row ${r.row.rowNumber} in "${pf.name}"`);
    }
  }
  const ids = [...new Set(files.flatMap((f) => f.identifiers))];
  if (ids.length > 1 || (account.identifier && ids.length === 1 && ids[0] !== account.identifier)) {
    throw new Error('Files show an account identifier that does not match this account');
  }
  const next = !account.identifier && ids.length === 1 ? { ...account, identifier: ids[0] } : account;

  const importId = crypto.randomUUID();
  const importedAt = now.toISOString();
  /** @type {Batch[]} */
  const batches = [];
  /** @type {Omit<Transaction,'bucketId'|'flaggedRuleId'>[]} */
  const txns = [];
  for (const pf of plan.files) {
    const saved = [...pf.fresh, ...pf.review.filter((r) => decisions.get(r.row.fingerprint) === 'both').map((r) => r.row)];
    if (saved.length === 0) continue;
    const file = files.find((f) => f.hash === pf.hash);
    if (!file) throw new Error(`No file matching "${pf.name}" for this plan`);
    const batchId = crypto.randomUUID();
    batches.push({
      id: batchId, importId, accountId: account.id, fileName: file.name, fileHash: file.hash,
      importedAt, rowCount: saved.length, coversFrom: file.coversFrom, coversTo: file.coversTo,
    });
    for (const r of saved) {
      /** @type {Omit<Transaction,'bucketId'|'flaggedRuleId'>} */
      const t = {
        id: crypto.randomUUID(), fingerprint: r.fingerprint, accountId: account.id, batchId,
        date: r.date, amountMinor: r.amountMinor, currency: account.currency, rawText: r.rawText,
      };
      if (r.rawType !== undefined) t.rawType = r.rawType;
      txns.push(t);
    }
  }

  if (batches.length === 0) {
    const stored = state.accounts.find((a) => a.id === account.id);
    return !stored || stableJson(stored) !== stableJson(next) ? { put: { accounts: [next] } } : {};
  }
  return combine({ put: { accounts: [next], batches } }, assignBuckets(state, txns));
}

/**
 * Deletes these batches and their transactions. Overrides, transfer pairs, buckets and rules stay,
 * so fingerprint-keyed decisions come back into force if the same rows are imported again.
 * @param {State} state
 * @param {string[]} batchIds
 * @returns {Changes}
 */
export function undoBatches(state, batchIds) {
  const gone = new Set(batchIds);
  return {
    del: {
      batches: [...gone],
      transactions: state.transactions.filter((t) => gone.has(t.batchId)).map((t) => t.id),
    },
  };
}

/**
 * JSON with object keys sorted, so two equal accounts compare equal whatever their key order.
 * @param {unknown} value
 * @returns {string}
 */
function stableJson(value) {
  return JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : v));
}
