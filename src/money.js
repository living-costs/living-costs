// Money is integer minor units. Debits negative, credits positive. No floats.

/**
 * Number of minor-unit digits for a currency.
 * @param {string} currency
 * @returns {number}
 */
export function currencyExponent(currency) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

// Optional sign; a whole part that is plain digits or correctly grouped in threes; optional decimals.
const UK_AMOUNT = /^([+-])?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?$/;
const CONTINENTAL_AMOUNT = /^([+-])?(\d{1,3}(?:\.\d{3})+|\d+)?(?:,(\d+))?$/;

/**
 * Parse an amount into minor units. Accepts UK style (1,234.56) and continental style (1.234,56),
 * with or without thousands separators. Each value is read on its own: where both styles fit but
 * give different values, as 1,234 does in a 3-decimal currency, it is an error, never a guess.
 * @param {string} text
 * @param {number} exponent
 * @returns {{minor: number|null} | {error: string}}
 */
export function parseAmount(text, exponent) {
  const t = String(text).trim();
  if (t === '' || t.toLowerCase() === 'null') return { minor: null };
  const readings = [];
  for (const [re, sep] of /** @type {const} */ ([[UK_AMOUNT, ','], [CONTINENTAL_AMOUNT, '.']])) {
    const m = re.exec(t);
    if (m && (m[2] || m[3])) readings.push(toMinor(m[1] === '-', (m[2] ?? '').replaceAll(sep, ''), m[3] ?? '', exponent, t));
  }
  if (readings.length === 0) return { error: `Not a plain number: ${t}` };
  const values = new Set(readings.flatMap((r) => ('minor' in r ? [r.minor] : [])));
  if (values.size > 1) return { error: `Ambiguous amount: ${t}` };
  return readings.find((r) => 'minor' in r) ?? readings[0];
}

/**
 * Whole and fractional digit strings to signed minor units.
 * @param {boolean} negative
 * @param {string} whole digits only, possibly empty
 * @param {string} frac digits only, possibly empty
 * @param {number} exponent
 * @param {string} t the original text, for error messages
 * @returns {{minor: number} | {error: string}}
 */
function toMinor(negative, whole, frac, exponent, t) {
  if (frac.length > exponent) return { error: `Too many decimal places: ${t}` };
  const minor = Number(whole === '' ? '0' : whole) * 10 ** exponent + Number(frac.padEnd(exponent, '0') || '0');
  if (!Number.isSafeInteger(minor)) return { error: `Amount too large: ${t}` };
  return { minor: negative && minor !== 0 ? -minor : minor };
}

/**
 * Minor units as an exact unsigned plain decimal, such as 40.00 (exponent 2) or 1234 (exponent 0).
 * @param {number} minor
 * @param {number} exponent
 * @returns {string}
 */
export function decimalString(minor, exponent) {
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  return exponent === 0 ? digits : `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/**
 * Drop a £ typed before an amount, keeping any sign before it: "£60.69" to "60.69", "-£5" to "-5".
 * @param {string} text
 * @returns {string}
 */
export function withoutCurrencySymbol(text) {
  return String(text).trim().replace(/^([+-]?)£/, '$1');
}

/**
 * Format minor units as currency text, built from an exact decimal string.
 * @param {number} minor
 * @param {string} currency
 * @returns {string}
 */
export function formatMoney(minor, currency) {
  const neg = minor < 0;
  const dec = decimalString(minor, currencyExponent(currency));
  const nf = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
  // The string overload of format() is exact; the typings only list number|bigint.
  return nf.format(/** @type {any} */ (neg ? `-${dec}` : dec));
}

/**
 * Parse search input such as "£60.69" or "-60" to an absolute minor amount.
 * @param {string} text
 * @param {number} exponent
 * @returns {number|null}
 */
export function parseMoneyQuery(text, exponent) {
  const t = withoutCurrencySymbol(text);
  if (t === '' || t.toLowerCase() === 'null') return null;
  const r = parseAmount(t, exponent);
  if ('error' in r || r.minor === null) return null;
  return Math.abs(r.minor);
}

/**
 * Integer division rounding half away from zero.
 * @param {number} n
 * @param {number} d
 * @returns {number}
 */
export function divRound(n, d) {
  const an = Math.abs(n);
  const ad = Math.abs(d);
  let q = Math.floor(an / ad);
  if (2 * (an - q * ad) >= ad) q += 1;
  return (n < 0) !== (d < 0) && q !== 0 ? -q : q;
}

/**
 * The distinct currencies of some transactions (or anything with a currency), sorted.
 * @param {{currency: string}[]} items
 * @returns {string[]}
 */
export function currenciesOf(items) {
  return [...new Set(items.map((x) => x.currency))].sort();
}

/**
 * The one currency of some transactions, or null when there are none or several.
 * @param {{currency: string}[]} items
 * @returns {string|null}
 */
export function soleCurrency(items) {
  const list = currenciesOf(items);
  return list.length === 1 ? list[0] : null;
}
