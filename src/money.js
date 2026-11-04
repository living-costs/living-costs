// Money is integer minor units. Debits negative, credits positive. No floats.

/**
 * Number of minor-unit digits for a currency.
 * @param {string} currency
 * @returns {number}
 */
export function currencyExponent(currency) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/**
 * Parse a plain decimal amount into minor units.
 * @param {string} text
 * @param {number} exponent
 * @returns {{minor: number|null} | {error: string}}
 */
export function parseAmount(text, exponent) {
  const t = String(text).trim();
  if (t === '' || t.toLowerCase() === 'null') return { minor: null };
  const m = /^([+-])?(\d+)?(?:\.(\d+))?$/.exec(t);
  if (!m) return { error: `Not a plain number: ${t}` };
  const whole = m[2] ?? '';
  const frac = m[3] ?? '';
  if (whole === '' && frac === '') return { error: `Not a plain number: ${t}` };
  if (frac.length > exponent) return { error: `Too many decimal places: ${t}` };
  const minor = Number(whole === '' ? '0' : whole) * 10 ** exponent + Number(frac.padEnd(exponent, '0') || '0');
  if (!Number.isSafeInteger(minor)) return { error: `Amount too large: ${t}` };
  return { minor: m[1] === '-' && minor !== 0 ? -minor : minor };
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
