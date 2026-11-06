// Normaliser v1: raw bank description -> bucket key. Prefer too many buckets over wrong merges.

// Names the frozen copies only (src/normalise-vN.js). Changing it triggers nothing: a rematch runs
// only for a DATA_VERSION step in src/migrate.js that sets rematchFrom.
export const NORMALISER_VERSION = 1;

/** Processor and bank prefixes, stripped repeatedly from the start. */
export const PREFIXES = ['PAYPAL *', 'SQ *', 'SP ', 'MOLLIE *', 'ZETTLE_*', 'SUMUP *', 'CARD PURCHASE '];

const MONTHS = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';
const TRAILING_REF = /\*[^\s*]*$/;
const DATE_PATTERNS = [
  new RegExp(`\\b\\d{1,2}(${MONTHS})\\d{2}(\\d{2})?\\b`, 'g'),
  new RegExp(`\\b\\d{1,2}(${MONTHS})\\b`, 'g'),
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g,
];
const SORT_CODE = /\b\d{2}-\d{2}-\d{2}\b/g;
const CARD_FRAGMENT = /\*+\d+/g;
const LONG_DIGITS = /\d{4,}/;
const PUNCTUATION_ONLY = /^[^\p{L}\p{N}]+$/u;
const TRAILING_JUNK = /[.…&\s-]+$/;

/**
 * @param {string} s
 * @returns {string}
 */
function collapse(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Turn a raw description into a stable bucket key.
 * @param {string} rawText
 * @param {string | null} [rawType] Transaction type column, used only when nothing else is left.
 * @returns {string}
 */
export function normalise(rawText, rawType) {
  // 1. Upper-case, collapse whitespace.
  let s = collapse(String(rawText ?? '').toUpperCase());

  // 2. Strip prefixes repeatedly.
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of PREFIXES) {
      if (s.startsWith(p)) {
        s = s.slice(p.length).trimStart();
        changed = true;
      }
    }
  }

  // 3. Trailing * reference token.
  s = s.replace(TRAILING_REF, '');

  // 4. Dates, sort codes, card fragments; then drop long-digit and punctuation-only pieces.
  for (const re of DATE_PATTERNS) s = s.replace(re, ' ');
  s = s.replace(SORT_CODE, ' ').replace(CARD_FRAGMENT, ' ');
  s = s
    .split(/[\s-]+/)
    .filter((piece) => piece !== '' && !LONG_DIGITS.test(piece) && !PUNCTUATION_ONLY.test(piece))
    .join(' ');

  // 5. Trim trailing punctuation.
  s = s.replace(TRAILING_JUNK, '');

  // 6. Fall back to the type.
  if (s === '') {
    const t = typeof rawType === 'string' ? rawType.trim().toUpperCase() : '';
    return t === '' ? '(NO DESCRIPTION)' : `${t} (NO DESCRIPTION)`;
  }
  return s;
}
