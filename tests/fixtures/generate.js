// Deterministic generator for the synthetic test fixtures. Every name, number and amount
// is invented. Run `node tests/fixtures/generate.js` to rewrite the CSVs and expected.json in
// this folder. It imports nothing from src/: expected values come from its own row list.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const START = '2025-11-01';
const END = '2026-10-31';
const B_START = '2026-08-01';

// ---- Dates: ISO strings, UTC arithmetic ----
const DAY_MS = 86400000;
/** @param {string} iso */
const toMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
/** @param {number} ms */
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);
/** @param {string} iso @param {number} n */
const addDays = (iso, n) => fromMs(toMs(iso) + n * DAY_MS);
/** @param {string} a @param {string} b */
const dayDiff = (a, b) => Math.round((toMs(a) - toMs(b)) / DAY_MS);
/** @param {string} iso */
const weekday = (iso) => new Date(toMs(iso)).getUTCDay();
/** @param {string} iso */
const dom = (iso) => Number(iso.slice(8, 10));
/** @param {string} iso */
const ym = (iso) => iso.slice(0, 7);
/** @param {string} iso */
const isLastDay = (iso) => addDays(iso, 1).slice(8, 10) === '01';
/** @param {string} iso */
const dmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** @param {string} iso */
const ddmonyy = (iso) => `${iso.slice(8, 10)}${MONTH_ABBR[Number(iso.slice(5, 7)) - 1]}${iso.slice(2, 4)}`;
/** Month index from Nov 2025 = 0. @param {string} iso */
const monthIndex = (iso) => (Number(iso.slice(0, 4)) - 2025) * 12 + Number(iso.slice(5, 7)) - 11;
/** @param {string} month YYYY-MM */
const prevMonth = (month) => ym(addDays(`${month}-01`, -1));
/** @param {string} from @param {string} to */
function* eachDay(from, to) {
  for (let d = from; d <= to; d = addDays(d, 1)) yield d;
}
const SUNDAY = 0;
const MONDAY = 1;
const WEDNESDAY = 3;
const SATURDAY = 6;

/** 9-character reference, different for every n. @param {number} n */
const ref = (n) => (36 ** 8 + (n + 1) * 2654435761).toString(36).toUpperCase();

// ---- Intended categories, by normaliser key (written by hand from the brief's table) ----
const INTENDED = {
  'TESCO STORES': 'Groceries',
  'CORNER CAFE': 'Eating out',
  'EXAMPLE COUNCIL': 'Council tax',
  SPOTIFY: 'Subscriptions',
  'AMAZON.CO.UK': 'Household maintenance',
  GAMESHOP: 'Entertainment',
  'CHB CHILD BENEFIT': 'Other income',
  'INTEREST PAID': 'Other income',
  INTEREST: 'Other income',
  'THE VERY LONG NAMED GARDEN CEN': 'Household maintenance',
  '<B>BOLD</B> SHOP': 'Entertainment',
  'MARKET STALL': 'Groceries',
  'FARM SHOP': 'Groceries',
  WEBSHOP: 'Household maintenance',
  BOOKSHOP: 'Entertainment',
  'BIG BOILER CO': 'Big one-offs',
  'NEWSAGENT J PATEL': 'Subscriptions',
  'M JONES': 'Gifts',
  'ACME LETTINGS': 'Housing (rent or mortgage)',
  'EXAMPLE EMPLOYER LTD SALARY': 'Salary',
  TRAINLINE: 'Transport',
  'PARKING METER': 'Transport',
  'OTHER CARD PLC': 'Other Card (not itemised)',
  'A N OTHER': 'Contributions from others',
  'EXAMPLE ENERGY': 'Utilities',
  'WATER CO': 'Utilities',
  'SAINSBURYS S/MKT': 'Groceries',
};
const UNCATEGORISED = ['PAYPAL PAYMENT', '(NO DESCRIPTION)', 'SO (NO DESCRIPTION)'];
const CATEGORY_ORDER = [
  'Salary', 'Other income', 'Contributions from others', 'Housing (rent or mortgage)', 'Council tax',
  'Utilities', 'Insurance', 'Groceries', 'Eating out', 'Takeaway', 'Transport', 'Car', 'Subscriptions',
  'Health', 'Personal care', 'Clothing', 'Entertainment', 'Gifts', 'Holidays', 'Household maintenance',
  'Joint household', 'Big one-offs', 'Other Card (not itemised)',
];
for (const c of Object.values(INTENDED)) if (!CATEGORY_ORDER.includes(c)) throw new Error(`Unknown category ${c}`);

/**
 * @typedef {{id:string,acct:'A'|'S'|'C'|'B',date:string,text:string,type:string,amount:number,key:string,
 *   cat?:string|null,pair?:string,balance?:number,cleared?:string}} Row
 */

/** @param {Row[]} list @param {'A'|'S'|'C'|'B'} acct @param {string} date */
const adder = (list, acct, date) =>
  /** @param {string} id @param {string} text @param {string} type @param {number} amount @param {string} key @param {Partial<Row>} [extra] */
  (id, text, type, amount, key, extra = {}) => { list.push({ id, acct, date, text, type, amount, key, ...extra }); };

// ---- Card (generated first: A11 depends on it) ----
/** @type {Row[]} */
const C = [];
{
  let k = 0;
  let refN = 0;
  for (const d of eachDay(START, END)) {
    const add = adder(C, 'C', d);
    const day = dom(d);
    if (day === 3 || day === 17) {
      add('C1', `AMAZON.CO.UK*${ref(refN++)}`, 'Purchase', -(2345 + ((k * 317) % 4000)), 'AMAZON.CO.UK');
      k++;
    }
    if (d === '2026-09-24') add('C1s', `AMAZON.CO.UK*${ref(refN++)}`, 'Purchase', -6069, 'AMAZON.CO.UK');
    if (day === 2) add('C2', `PAYPAL *SPOTIFY*${ref(refN++)}`, 'Purchase', -1199, 'SPOTIFY');
    if (day === 10) add('C3', 'TRAINLINE', 'Purchase', -4600, 'TRAINLINE');
    if (d === '2026-04-12') add('C3r', 'TRAINLINE', 'Refund', 2340, 'TRAINLINE');
    if (day === 21) add('C4', 'PARKING METER', 'Not Available', -120, 'PARKING METER');
    if (day === 19) add('C5', 'PAYMENT RECEIVED - THANK YOU', 'Payment', 0, 'PAYMENT RECEIVED THANK YOU', { pair: 'A11-C5' });
  }
}
/** Card net per transaction month, excluding C5 (negative = net spend). @type {Record<string,number>} */
const cardNet = {};
for (const r of C) if (r.id !== 'C5') cardNet[ym(r.date)] = (cardNet[ym(r.date)] ?? 0) + r.amount;
/** A11's signed amount per month. @type {Record<string,number>} */
const a11 = {};
for (const m of Object.keys(cardNet)) a11[m] = m === '2025-11' ? -30000 : cardNet[prevMonth(m)];
for (const r of C) if (r.id === 'C5') r.amount = -a11[ym(r.date)];
// Cleared date = transaction date + 1, 2, 3, 1, 2, 3... in generation order; file sorted by it (stable).
C.forEach((r, i) => { r.cleared = addDays(r.date, (i % 3) + 1); });
const cardFileOrder = [...C].sort((a, b) => (a.cleared < b.cleared ? -1 : a.cleared > b.cleared ? 1 : 0));
if (!cardFileOrder.some((r, i) => i > 0 && cardFileOrder[i - 1].date > r.date)) {
  throw new Error('Card cleared-date order never differs from transaction-date order');
}

// ---- Bank A current ----
/** @type {Row[]} */
const A = [];
{
  let k = 0;
  const TESCO = 'CARD PURCHASE TESCO STORES 2041';
  for (const d of eachDay(START, END)) {
    const add = adder(A, 'A', d);
    const day = dom(d);
    const wd = weekday(d);
    const i = monthIndex(d);
    if (day === 25) add('A1', 'EXAMPLE EMPLOYER LTD SALARY', 'BGC', 250000, 'EXAMPLE EMPLOYER LTD SALARY');
    if (day === 1) add('A2', 'ACME LETTINGS', 'SO', -90000, 'ACME LETTINGS');
    if (day === 3) add('A3', 'EXAMPLE COUNCIL 40012345678', 'DD', -15000, 'EXAMPLE COUNCIL');
    if (wd === SATURDAY) {
      add('A4', TESCO, 'DEB', -(4000 + ((k * 731) % 5000)), 'TESCO STORES');
      k++;
    }
    if (d === '2026-06-13') add('A4u', TESCO, 'DEB', -65000, 'TESCO STORES');
    if (wd === WEDNESDAY) add('A5', 'SQ *CORNER CAFE', 'DEB', -350, 'CORNER CAFE');
    if (d === '2026-03-04') add('A5', 'SQ *CORNER CAFE', 'DEB', -350, 'CORNER CAFE');
    if (day === 8) add('A6', 'PAYPAL PAYMENT', 'DEB', -299, 'PAYPAL PAYMENT', { cat: 'Subscriptions' });
    if (day === 15) add('A6', 'PAYPAL PAYMENT', 'DEB', -999, 'PAYPAL PAYMENT', { cat: 'Subscriptions' });
    if (d === '2026-10-20') add('A6x', 'PAYPAL PAYMENT', 'DEB', -299, 'PAYPAL PAYMENT', { cat: null });
    if (wd === MONDAY) add('A7', 'NEWSAGENT J PATEL', 'SO', -1500, 'NEWSAGENT J PATEL');
    if (day === 10) add('A8', 'M JONES', 'SO', -4000, 'M JONES');
    if (day === 6) {
      add('A9', `CHB ${d.replaceAll('-', '')}${31000000 + i * 1013}-&--&-CHILD BENEFIT`, 'BGC', 10240, 'CHB CHILD BENEFIT');
    }
    if (isLastDay(d)) add('A10', 'INTEREST PAID', 'BGC', 51, 'INTEREST PAID');
    if (day === 18) add('A11', 'EXAMPLE CARD SERVICES', 'DD', a11[ym(d)], 'EXAMPLE CARD SERVICES', { pair: 'A11-C5' });
    if (day === 22) add('A12', 'OTHER CARD PLC', 'DD', -(12000 + 500 * i), 'OTHER CARD PLC');
    if (day === 26) add('A13', 'TRANSFER TO SAVINGS', 'FPO', -20000, 'TRANSFER TO SAVINGS', { pair: 'A13-S1' });
    if (d === '2026-07-15') add('A14', 'FROM SAVINGS', 'FPI', 50000, 'FROM SAVINGS', { pair: 'A14-S3' });
    if (day === 28 && d >= B_START) add('A15', 'J DOE JOINT', 'FPO', -60000, 'J DOE JOINT', { pair: 'A15-B5' });
    if (d === '2026-02-11') add('A16', '', '', -500, '(NO DESCRIPTION)');
    if (d === '2026-04-07') add('A17', '', 'SO', -2500, 'SO (NO DESCRIPTION)');
    if (d === '2026-05-09') add('A18', 'CARD PURCHASE <b>BOLD</b> SHOP', 'DEB', -999, '<B>BOLD</B> SHOP');
    if (day === 12) {
      add('A19', 'CARD PURCHASE THE VERY LONG NAMED GARDEN CEN...', 'DEB', -3200, 'THE VERY LONG NAMED GARDEN CEN');
    }
    if (day === 20) add('A20', `GAMESHOP CB${4000000000 + i * 123456789}`, 'DEB', -2000, 'GAMESHOP');
    if (day === 5) add('A21', 'SUMUP *MARKET STALL', 'DEB', -1200, 'MARKET STALL');
    if (day === 9) add('A21', 'ZETTLE_*FARM SHOP', 'DEB', -1850, 'FARM SHOP');
    if (day === 14) add('A21', 'MOLLIE *WEBSHOP', 'DEB', -2500, 'WEBSHOP');
    if (day === 17) add('A21', 'SP BOOKSHOP', 'DEB', -899, 'BOOKSHOP');
    if (d === '2026-01-20') add('A22', 'CARD PURCHASE BIG BOILER CO', 'DEB', -240000, 'BIG BOILER CO');
  }
}

// ---- Savings ----
/** @type {Row[]} */
const S = [];
for (const d of eachDay(START, END)) {
  const add = adder(S, 'S', d);
  if (dom(d) === 27) add('S1', `TRANSFER FROM 12345678 ${ddmonyy(d)}`, 'null', 20000, 'TRANSFER FROM', { pair: 'A13-S1' });
  if (isLastDay(d)) add('S2', `INTEREST ${ddmonyy(d)}`, 'null', 123, 'INTEREST');
  if (d === '2026-07-14') add('S3', `TRANSFER TO 12345678 ${ddmonyy(d)}`, 'null', -50000, 'TRANSFER TO', { pair: 'A14-S3' });
}

// ---- Bank B (joint), Aug-Oct 2026 ----
/** @type {Row[]} */
const B = [];
{
  let k = 0;
  for (const d of eachDay(B_START, END)) {
    const add = adder(B, 'B', d);
    const day = dom(d);
    if (day === 1) add('B1', 'A N OTHER', 'Standing Order', 55000, 'A N OTHER');
    if (day === 5) add('B2', 'EXAMPLE ENERGY', 'Direct Debit', -9500, 'EXAMPLE ENERGY');
    if (day === 12) add('B3', 'WATER CO', 'Direct Debit', -3800, 'WATER CO');
    if (weekday(d) === SUNDAY) {
      add('B4', 'SAINSBURYS S/MKT', 'Card Transaction', -(6000 + 725 * k), 'SAINSBURYS S/MKT');
      k++;
    }
    if (day === 28) add('B5', 'J DOE', 'BACS Payment Received', 60000, 'J DOE', { pair: 'A15-B5' });
  }
}

// ---- Running balances (balance after each row, in date order) ----
/** @param {Row[]} rows @param {number} opening */
function setBalances(rows, opening) {
  let bal = opening;
  for (const r of rows) {
    bal += r.amount;
    r.balance = bal;
  }
}
setBalances(A, 500000);
setBalances(S, 1500000);
setBalances(B, 80000);

// ---- Amount writing ----
/** Unsigned, 2 decimal places. @param {number} minor */
const two = (minor) => {
  const a = Math.abs(minor);
  return `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};
/** @param {number} minor */
const signedTwo = (minor) => (minor < 0 ? '-' : '') + two(minor);
/** Bank A: unsigned, 2 decimal places, no leading 0 below 1 (0.51 is `.51`). @param {number} minor */
const bankAAmount = (minor) => two(minor).replace(/^0\./, '.');
/** Savings: explicit sign. @param {number} minor */
const savingsAmount = (minor) => (minor < 0 ? '-' : '+') + two(minor);
/** Card: minimal (46, 1.2, 60.69), no leading 0 below 1. @param {number} minor */
const minimal = (minor) => {
  const a = Math.abs(minor);
  const whole = Math.floor(a / 100);
  const frac = String(a % 100).padStart(2, '0').replace(/0+$/, '');
  const w = whole === 0 && frac !== '' ? '' : String(whole);
  return (minor < 0 ? '-' : '') + (frac === '' ? w : `${w}.${frac}`);
};

/** @param {string[]} cells */
const unquoted = (cells) => {
  for (const c of cells) if (/[",\r\n]/.test(c)) throw new Error(`Field needs quoting: ${c}`);
  return cells.join(',');
};
/** @param {string[]} cells */
const quoted = (cells) => cells.map((c) => `"${c.replaceAll('"', '""')}"`).join(',');

const A_HEADER = 'Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance';
/** @param {Row} r */
const bankALine = (r) => unquoted([
  dmy(r.date), r.type, "'11-22-33", '12345678', r.text,
  r.amount < 0 ? bankAAmount(r.amount) : '', r.amount > 0 ? bankAAmount(r.amount) : '',
  signedTwo(/** @type {number} */ (r.balance)),
]);
/** Newest first, CRLF. @param {Row[]} rows in date order */
const bankAFile = (rows) => [A_HEADER, ...[...rows].reverse().map(bankALine)].join('\r\n') + '\r\n';

const savingsFile = [
  'Transaction Date,Transaction Type,Transaction Description,Amount,Balance',
  ...S.map((r) => unquoted([dmy(r.date), r.type, r.text, savingsAmount(r.amount), signedTwo(/** @type {number} */ (r.balance))])),
].join('\r\n') + '\r\n';

const cardFile = '﻿' + [
  quoted(['Transaction Date', 'Transaction Cleared Date', 'Transaction Type', 'Transaction Description', 'Transaction Amount']),
  ...cardFileOrder.map((r) => quoted([dmy(r.date), dmy(/** @type {string} */ (r.cleared)), r.type, r.text, minimal(-r.amount)])),
].join('\n') + '\n';

/** @param {string} month */
const bankBFile = (month) => [
  'Date,Details,Transaction Type,In,Out,Balance',
  ...B.filter((r) => ym(r.date) === month).map((r) => unquoted([
    dmy(r.date), r.text, r.type, r.amount > 0 ? two(r.amount) : '', r.amount < 0 ? two(r.amount) : '',
    signedTwo(/** @type {number} */ (r.balance)),
  ])),
].join('\n') + '\n';

// ---- Re-export of October 2026 (Bank A format) ----
const octA = A.filter((r) => ym(r.date) === '2026-10');
const changed = octA.filter((r) => r.id === 'A4' && r.date === '2026-10-03');
if (changed.length !== 1) throw new Error('Expected one A4 row on 2026-10-03');
const lastA = A[A.length - 1];
if (lastA.date !== END) throw new Error('Bank A does not end on 2026-10-31');
/** @type {Row[]} */
const reexportRows = [
  ...octA.map((r) => (r === changed[0] ? { ...r, text: 'CARD PURCHASE TESCO STORE 2041' } : r)),
  { id: 'A5new', acct: 'A', date: '2026-11-02', text: 'SQ *CORNER CAFE', type: 'DEB', amount: -350, key: 'CORNER CAFE',
    balance: /** @type {number} */ (lastA.balance) - 350 },
];

// ---- Collision guard and transfer-pair count ----
const MAIN_ROWS = [...A, ...S, ...C, ...B];
let transferPairs = 0;
/** @type {Map<Row,number>} */
const pairedCount = new Map();
/** @param {Row} r */
const describe = (r) => `${r.id} ${r.acct} ${r.date} ${r.amount} ${r.text}`;
for (let i = 0; i < MAIN_ROWS.length; i++) {
  for (let j = i + 1; j < MAIN_ROWS.length; j++) {
    const a = MAIN_ROWS[i];
    const b = MAIN_ROWS[j];
    if (a.acct === b.acct || a.amount !== -b.amount || Math.abs(dayDiff(a.date, b.date)) > 3) continue;
    if (!a.pair || a.pair !== b.pair) throw new Error(`Unintended transfer-like pair: ${describe(a)} <-> ${describe(b)}`);
    transferPairs++;
    pairedCount.set(a, (pairedCount.get(a) ?? 0) + 1);
    pairedCount.set(b, (pairedCount.get(b) ?? 0) + 1);
  }
}
for (const r of MAIN_ROWS) {
  if (r.pair && pairedCount.get(r) !== 1) throw new Error(`Transfer row not paired exactly once: ${describe(r)}`);
}
if (transferPairs !== 28) throw new Error(`Expected 28 transfer pairs, got ${transferPairs}`);

// ---- Categories and totals ----
/** @param {Row} r @returns {string|null} */
function categoryOf(r) {
  if (r.pair) return null;
  if (r.cat !== undefined) return r.cat;
  if (UNCATEGORISED.includes(r.key)) return null;
  const c = /** @type {Record<string,string>} */ (INTENDED)[r.key];
  if (!c) throw new Error(`No intended category for key ${r.key}`);
  return c;
}
/** @type {Record<string,Record<string,number>>} */
const totals = {};
/** @type {Record<string,Record<string,Record<string,number>>>} */
const byAccount = {};
for (const r of MAIN_ROWS) {
  const cat = categoryOf(r);
  if (cat === null) continue;
  const m = ym(r.date);
  totals[cat] ??= {};
  totals[cat][m] = (totals[cat][m] ?? 0) + r.amount;
  byAccount[cat] ??= {};
  byAccount[cat][r.acct] ??= {};
  byAccount[cat][r.acct][m] = (byAccount[cat][r.acct][m] ?? 0) + r.amount;
}
/** @param {Record<string,number>} o */
const sortMonths = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const cats = CATEGORY_ORDER.filter((c) => totals[c]);
const monthlyTotals = Object.fromEntries(cats.map((c) => [c, sortMonths(totals[c])]));
const monthlyTotalsByAccount = Object.fromEntries(cats.map((c) => [c,
  Object.fromEntries(['A', 'S', 'C', 'B'].filter((a) => byAccount[c][a]).map((a) => [a, sortMonths(byAccount[c][a])]))]));

// ---- Self-checks against figures later tasks assert ----
/** @param {boolean} ok @param {string} msg */
const check = (ok, msg) => { if (!ok) throw new Error(`Self-check failed: ${msg}`); };
/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MONTHS = Object.keys(sortMonths(cardNet));
check(MONTHS.length === 12 && MONTHS[0] === '2025-11' && MONTHS[11] === '2026-10', 'twelve months');
check(A.filter((r) => r.id === 'A7').length === 52, '52 Mondays');
for (const m of MONTHS) {
  const mondays = A.filter((r) => r.id === 'A7' && ym(r.date) === m).length;
  check(monthlyTotals.Subscriptions[m] === -1500 * mondays - 1199 - 299 - 999, `Subscriptions ${m}`);
}
check(same(Object.values(monthlyTotals['Other Card (not itemised)']), MONTHS.map((_, i) => -(12000 + 500 * i))), 'Other Card');
check(same(monthlyTotals.Gifts, Object.fromEntries(MONTHS.map((m) => [m, -4000]))), 'Gifts');
const BMONTHS = ['2026-08', '2026-09', '2026-10'];
check(same(monthlyTotals['Contributions from others'], Object.fromEntries(BMONTHS.map((m) => [m, 55000]))), 'Contributions');
check(same(monthlyTotals.Utilities, Object.fromEntries(BMONTHS.map((m) => [m, -13300]))), 'Utilities');
check(same(monthlyTotals['Big one-offs'], { '2026-01': -240000 }), 'Big one-offs');
check(B.find((r) => r.id === 'B4')?.date === '2026-08-02', 'B4 starts 2026-08-02');
check(S.find((r) => r.id === 'S3')?.text === 'TRANSFER TO 12345678 14JUL26', 'S3 text');
const usedKeys = new Set(MAIN_ROWS.filter((r) => !r.pair).map((r) => r.key));
check(same([...usedKeys].sort(), [...Object.keys(INTENDED), ...UNCATEGORISED].sort()), 'keys used = intended + uncategorised');

// ---- Write ----
const files = {
  'bank-a-current.csv': { text: bankAFile(A), rows: A.length },
  'bank-a-savings.csv': { text: savingsFile, rows: S.length },
  'card.csv': { text: cardFile, rows: C.length },
  ...Object.fromEntries(BMONTHS.map((m) => [`bank-b-${m}.csv`,
    { text: bankBFile(m), rows: B.filter((r) => ym(r.date) === m).length }])),
  'bank-a-current-2026-10-reexport.csv': { text: bankAFile(reexportRows), rows: reexportRows.length },
};
for (const [name, f] of Object.entries(files)) fs.writeFileSync(path.join(DIR, name), f.text, 'utf8');

const expected = {
  rowCounts: Object.fromEntries(Object.entries(files).map(([n, f]) => [n, f.rows])),
  reexport: { new: 1, already: octA.length - 1, review: 1 },
  intendedCategories: INTENDED,
  uncategorisedKeys: UNCATEGORISED,
  transferPairs,
  monthlyTotals,
  monthlyTotalsByAccount,
};
fs.writeFileSync(path.join(DIR, 'expected.json'), JSON.stringify(expected, null, 2) + '\n', 'utf8');

console.log('Row counts:', expected.rowCounts);
console.log('Re-export:', expected.reexport);
console.log('Card net per month (excl. C5):', sortMonths(cardNet));
console.log('A11 per month:', sortMonths(a11));
