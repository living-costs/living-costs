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
 * Format minor units as currency text, built from an exact decimal string.
 * @param {number} minor
 * @param {string} currency
 * @returns {string}
 */
export function formatMoney(minor, currency) {
  const exp = currencyExponent(currency);
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, '0');
  const dec = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
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
  const t = String(text).trim().replace(/^([+-]?)£/, '$1');
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
