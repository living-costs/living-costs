/** @param {string} s */
const clean = (s) => s.toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Dice coefficient on character bigrams (multiset) of upper-cased, whitespace-collapsed text.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0 to 1
 */
export function similarity(a, b) {
  const x = clean(a);
  const y = clean(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const c = counts.get(g) ?? 0;
    if (c > 0) { shared++; counts.set(g, c - 1); }
  }
  return (2 * shared) / (x.length - 1 + y.length - 1);
}
