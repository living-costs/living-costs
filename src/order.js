// Shared orderings. `cmp` is code-unit order, for ids, keys and ISO dates, where the point is a
// fixed, repeatable order. `compareNames` is for names a person reads in a sorted list, so every
// screen orders them the same way: case and accents are ignored, as people expect.

/**
 * Code-unit order: -1, 0 or 1.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const NAMES = new Intl.Collator('en-GB', { sensitivity: 'base' });

/**
 * Name order for display: the same as `a.localeCompare(b, 'en-GB', { sensitivity: 'base' })`.
 * Names that differ only in case or accents compare equal, so callers that need a fixed order
 * break ties with `cmp` on an id.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export const compareNames = (a, b) => NAMES.compare(a, b);
