// Rematching after a normaliser change: bucket keys and rule patterns are re-derived with the new
// normaliser, while no transaction changes bucket. Pure: the input is never mutated.

/** @import {BackupData} from './backup.js' */
/** @import {Normaliser} from './migrate.js' */

/**
 * @param {BackupData} data a validated backup
 * @param {Normaliser} oldN the normaliser the data was keyed with
 * @param {Normaliser} newN
 * @returns {BackupData}
 */
export function rematch(data, oldN, newN) {
  /** @type {Map<string, Map<string, number>>} old key -> new key -> transactions */
  const targets = new Map();
  /** @param {string} oldKey @param {string} newKey @param {number} n */
  const add = (oldKey, newKey, n) => {
    let m = targets.get(oldKey);
    if (!m) targets.set(oldKey, (m = new Map()));
    m.set(newKey, (m.get(newKey) ?? 0) + n);
  };
  for (const t of data.transactions) add(oldN(t.rawText, t.rawType), newN(t.rawText, t.rawType), 1);
  for (const b of data.buckets) for (const raw of b.exampleRawTexts) add(oldN(raw), newN(raw), 0);

  /** @type {Map<string, Map<number, number>>} new key -> bucket index -> transactions */
  const claims = new Map();
  /** @type {string[][]} each bucket's claimed new keys, in first-claimed order */
  const claimed = data.buckets.map(() => []);
  data.buckets.forEach((b, i) => {
    /** @param {string} newKey @param {number} n */
    const claim = (newKey, n) => {
      let m = claims.get(newKey);
      if (!m) claims.set(newKey, (m = new Map()));
      if (!m.has(i)) claimed[i].push(newKey);
      m.set(i, (m.get(i) ?? 0) + n);
    };
    for (const k of b.keys) {
      const ts = targets.get(k);
      if (!ts || ts.size === 0) claim(newN(k), 0);
      else for (const [nk, n] of ts) claim(nk, n);
    }
  });

  // The bucket with the most transactions wins a shared key; on a tie, the earlier bucket.
  /** @type {Map<string, number>} */
  const winner = new Map();
  for (const [nk, m] of claims) {
    let best = -1;
    let bestCount = -1;
    for (const [i, n] of m) {
      if (n > bestCount || (n === bestCount && i < best)) { best = i; bestCount = n; }
    }
    winner.set(nk, best);
  }

  const buckets = data.buckets.map((b, i) => ({ ...b, keys: claimed[i].filter((nk) => winner.get(nk) === i) }));

  const rules = data.rules.map((r) => {
    const ts = targets.get(r.pattern);
    if (!ts || ts.size === 0) return { ...r, pattern: newN(r.pattern) };
    const candidates = [...ts.keys()];
    if (candidates.length === 1) return { ...r, pattern: candidates[0] };
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const t of data.transactions) {
      if (t.bucketId !== r.bucketId || t.amountMinor !== r.amountMinor) continue;
      const nk = newN(t.rawText, t.rawType);
      if (ts.has(nk)) counts.set(nk, (counts.get(nk) ?? 0) + 1);
    }
    let pattern = candidates[0];
    let top = 0;
    for (const nk of candidates) {
      const n = counts.get(nk) ?? 0;
      if (n > top) { pattern = nk; top = n; }
    }
    return { ...r, pattern };
  });

  return { ...data, buckets, rules };
}
