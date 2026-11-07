// Merchant-name matching for category suggestions. The merchant list is credited to
// EmmaExcel/merchant-categorizer on GitHub.

const SUFFIX = /(\.CO\.UK|\.COM|\.UK|\.NET|\.ORG)$/;

/**
 * Upper-case text with punctuation removed, so "SAINSBURY'S" and "Sainsburys" compare equal.
 * @param {string} text
 * @returns {string}
 */
export function squash(text) {
  const tokens = text.toUpperCase().replace(/&/g, ' AND ').replace(/\+/g, ' PLUS ')
    .split(/[^A-Z0-9.'’]+/);
  const out = [];
  for (let t of tokens) {
    t = t.replace(/^WWW\.?(?=.)/, '').replace(SUFFIX, '').replace(/[.'’]/g, '');
    t = t.replace(/(?<=.)COUK$/, '');
    if (t) out.push(t);
  }
  return out.join(' ');
}

/** @type {WeakMap<object[], {squashed: string, glued: string, defaultId: string}[]>} */
const cache = new WeakMap();

/**
 * @param {{name: string, defaultId: string}[]} merchants
 */
function prepared(merchants) {
  let list = cache.get(merchants);
  if (!list) {
    list = [];
    for (const m of merchants) {
      const squashed = squash(m.name);
      if (squashed) list.push({ squashed, glued: squashed.includes(' ') ? squashed.replace(/ /g, '') : '', defaultId: m.defaultId });
    }
    cache.set(merchants, list);
  }
  return list;
}

/**
 * The defaultId of the longest merchant name found in the bucket keys, or null for no match
 * or a tie between different categories.
 * @param {string[]} keys
 * @param {{name: string, defaultId: string}[]} merchants
 * @returns {string | null}
 */
export function matchKeys(keys, merchants) {
  const list = prepared(merchants);
  let best = 0;
  /** @type {Set<string>} */
  let ids = new Set();
  for (const key of keys) {
    const s = squash(key);
    const padded = ` ${s} `;
    const tokens = s.split(' ');
    for (const m of list) {
      const hit = padded.includes(` ${m.squashed} `) || (m.glued !== '' && tokens.includes(m.glued));
      if (!hit || m.squashed.length < best) continue;
      if (m.squashed.length > best) { best = m.squashed.length; ids = new Set(); }
      ids.add(m.defaultId);
    }
  }
  return ids.size === 1 ? [...ids][0] : null;
}
