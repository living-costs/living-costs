// Dates are ISO YYYY-MM-DD, months YYYY-MM. Day arithmetic is UTC. localDay and
// formatLocalDate are the exceptions: they give the local calendar date of a moment in time.
const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @param {string} iso
 * @returns {number} UTC milliseconds
 */
function toMs(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * @param {number} ms
 * @returns {string}
 */
function fromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Strictly parse a date in the given format to ISO, or null.
 * @param {string} text
 * @param {'DD/MM/YYYY'} format
 * @returns {string|null}
 */
export function parseDate(text, format) {
  if (format !== 'DD/MM/YYYY') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text).trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * @param {string} iso
 * @returns {string} DD/MM/YYYY
 */
export function formatDate(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * @param {string} iso
 * @param {number} n
 * @returns {string}
 */
export function addDays(iso, n) {
  return fromMs(toMs(iso) + n * DAY_MS);
}

/**
 * Whole days from a to b (b - a).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function daysBetween(a, b) {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/**
 * @param {string} iso
 * @returns {string} YYYY-MM
 */
export function monthOf(iso) {
  return iso.slice(0, 7);
}

/**
 * @param {string} month
 * @returns {string}
 */
export function monthStart(month) {
  return `${month}-01`;
}

/**
 * @param {string} month
 * @returns {string}
 */
export function monthEnd(month) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return fromMs(Date.UTC(y, m, 1) - DAY_MS);
}

/**
 * Inclusive list of months; empty if from is after to.
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
export function monthRange(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * @param {string} month
 * @returns {string} e.g. "Oct 2026"
 */
export function formatMonth(month) {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/**
 * Bucket key for a date: Monday ISO date, YYYY-MM, or YYYY.
 * @param {string} iso
 * @param {'week'|'month'|'year'} period
 * @returns {string}
 */
export function periodKey(iso, period) {
  if (period === 'year') return iso.slice(0, 4);
  if (period === 'month') return monthOf(iso);
  const dow = new Date(toMs(iso)).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

/**
 * The local calendar date of a moment, as YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
export function localDay(date) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The local calendar date of an ISO timestamp, as DD/MM/YYYY, or '' if it isn't a valid time.
 * @param {string} iso
 * @returns {string}
 */
export function formatLocalDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDate(localDay(d));
}
