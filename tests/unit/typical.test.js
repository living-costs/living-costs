import { test } from 'node:test';
import assert from 'node:assert/strict';
import tuning from '../../src/tuning.js';
import { emptyState, applyToState } from '../../src/changes.js';
import { addDays, monthRange } from '../../src/dates.js';
import { typicalMonth, median, percentile } from '../../src/typical.js';

const YEAR = monthRange('2025-11', '2026-10');

let seq = 0;
/** @param {string} id @param {'bank'|'card'|'placeholder'} [kind] @param {string} [currency] */
const acct = (id, kind = 'bank', currency = 'GBP') => ({ id, name: id, currency, kind, repaymentBucketIds: [] });
/** @param {string} accountId @param {string} from @param {string} to */
const batch = (accountId, from, to) => ({
  id: `b${++seq}`, importId: `i${seq}`, accountId, fileName: 'x.csv', fileHash: `h${seq}`,
  importedAt: '2026-11-04T00:00:00Z', rowCount: 1, coversFrom: from, coversTo: to,
});
const yearBatch = (/** @type {string} */ accountId) => batch(accountId, '2025-11-01', '2026-10-31');
/** @param {string} id @param {string} kind @param {string} [budgetType] */
const cat = (id, kind, budgetType) => ({ id, name: id, kind, ...(budgetType ? { budgetType } : {}), position: 0 });
/** @param {string} id @param {string} [categoryId] */
const bucket = (id, categoryId) => ({ id, keys: [id], displayName: id, exampleRawTexts: [], ...(categoryId ? { categoryId } : {}) });
/** @param {string} accountId @param {string} date @param {number} amountMinor @param {string} bucketId */
const txn = (accountId, date, amountMinor, bucketId, currency = 'GBP') => ({
  id: `t${++seq}`, fingerprint: `f${seq}`, accountId, batchId: 'b', date, amountMinor, currency,
  rawText: bucketId, bucketId,
});
/** One transaction on `day` of each month. @param {string} accountId @param {string[]} months @param {string} day */
const monthly = (accountId, months, day, amountMinor, bucketId) =>
  months.map((m) => txn(accountId, `${m}-${day}`, amountMinor, bucketId));

/** @param {{accounts?:any[],batches?:any[],categories?:any[],buckets?:any[],transactions?:any[],overrides?:any[],transferPairs?:any[]}} p */
function build({ accounts = [acct('A')], batches = [yearBatch('A')], categories = [], buckets = [], transactions = [], overrides = [], transferPairs = [] }) {
  const s = emptyState();
  applyToState(s, { put: { accounts, batches, categories, buckets, transactions, overrides, transferPairs } });
  return /** @type {any} */ (s);
}

/** @param {any} tm @param {string} id */
const row = (tm, id) => [...tm.spend, ...tm.income, ...tm.contribution].find((r) => r.categoryId === id);

test('median and nearest-rank percentiles use integers only', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2]), 2); // divRound(3, 2), half away from zero
  assert.equal(median([-1, -2]), -2);
  assert.equal(median([]), 0);
  const v = [12000, 12500, 13000, 13500, 14000, 14500, 15000, 15500, 16000, 16500, 17000, 17500];
  assert.equal(median(v), 14750);
  assert.equal(percentile(v, 25), 13000); // rank ceil(3) = 3
  assert.equal(percentile(v, 75), 16000); // rank ceil(9) = 9
  assert.equal(percentile(v, 0), 12000);
  assert.equal(percentile(v, 100), 17500);
  assert.equal(percentile([5, 1, 3], 50), 3); // rank ceil(1.5) = 2
});

test('fixed: a weekly 1500 with 52 charges over 12 complete months is 6500 a month', () => {
  const transactions = [];
  for (let i = 0; i < 52; i++) transactions.push(txn('A', addDays('2025-11-03', 7 * i), -1500, 'news'));
  const tm = typicalMonth(build({
    categories: [cat('subs', 'spend', 'fixed')], buckets: [bucket('news', 'subs')], transactions,
  }), tuning);
  assert.deepEqual(tm.months, YEAR);
  assert.equal(tm.complete, true);
  const r = row(tm, 'subs');
  assert.deepEqual(r, { categoryId: 'subs', name: 'subs', budgetType: 'fixed', perMonth: 6500, perYear: 78000 });
  assert.equal(tm.totals.living, 6500);
});

test('D1: an account covering only the last 3 months is divided by its own 3 months', () => {
  const B = ['2026-08', '2026-09', '2026-10'];
  const tm = typicalMonth(build({
    accounts: [acct('A'), acct('B')],
    batches: [yearBatch('A'), batch('B', '2026-08-01', '2026-10-31')],
    categories: [cat('salary', 'income', 'fixed'), cat('rent', 'spend', 'fixed'), cat('contrib', 'contribution', 'fixed')],
    buckets: [bucket('emp', 'salary'), bucket('lettings', 'rent'), bucket('other', 'contrib')],
    transactions: [
      ...monthly('A', YEAR, '25', 250000, 'emp'),
      ...monthly('A', YEAR, '01', -90000, 'lettings'),
      ...monthly('B', B, '01', 55000, 'other'),
    ],
  }), tuning);
  assert.equal(row(tm, 'contrib').perMonth, 55000); // not 13750
  assert.equal(tm.contribution.length, 1);
  assert.deepEqual(tm.totals, { income: 250000, living: 90000, contributions: 55000, share: 35000, leftOver: 215000 });
});

test('variable: median month with the variableRange percentiles as the range', () => {
  const amounts = [17500, 12000, 16500, 12500, 13000, 15500, 13500, 14000, 17000, 14500, 15000, 16000];
  const tm = typicalMonth(build({
    categories: [cat('groc', 'spend', 'variable')], buckets: [bucket('shop', 'groc')],
    transactions: YEAR.map((m, i) => txn('A', `${m}-15`, -amounts[i], 'shop')),
  }), tuning);
  assert.deepEqual(row(tm, 'groc'), {
    categoryId: 'groc', name: 'groc', budgetType: 'variable', perMonth: 14750, perYear: 177000, range: [13000, 16000],
  });
});

test('variable: a month with no rows counts as 0 in the series', () => {
  // 6 of 12 months at 1000: median of six 0s and six 1000s is divRound(0 + 1000, 2) = 500.
  const tm = typicalMonth(build({
    categories: [cat('eat', 'spend', 'variable')], buckets: [bucket('cafe', 'eat')],
    transactions: monthly('A', YEAR.slice(6), '10', -1000, 'cafe'),
  }), tuning);
  assert.equal(row(tm, 'eat').perMonth, 500);
  assert.deepEqual(row(tm, 'eat').range, [0, 1000]);
});

test('annual: 48000 in a 12-month window is 48000 a year and 4000 a month', () => {
  const tm = typicalMonth(build({
    categories: [cat('gifts', 'spend', 'annual')], buckets: [bucket('present', 'gifts')],
    transactions: [txn('A', '2025-12-10', -30000, 'present'), txn('A', '2026-06-10', -18000, 'present')],
  }), tuning);
  assert.deepEqual(row(tm, 'gifts'), { categoryId: 'gifts', name: 'gifts', budgetType: 'annual', perMonth: 4000, perYear: 48000 });
});

test('annual: fewer covered months scale the window total to 12', () => {
  const tm = typicalMonth(build({
    batches: [batch('A', '2026-05-01', '2026-10-31')],
    categories: [cat('gifts', 'spend', 'annual')], buckets: [bucket('present', 'gifts')],
    transactions: [txn('A', '2026-06-10', -10000, 'present')],
  }), tuning);
  assert.equal(tm.months.length, 6);
  assert.equal(row(tm, 'gifts').perYear, 20000);
  assert.equal(row(tm, 'gifts').perMonth, 1667);
});

test('a refund lowers its variable spend month and never adds to income', () => {
  const tm = typicalMonth(build({
    batches: [batch('A', '2026-04-01', '2026-04-30')],
    categories: [cat('transport', 'spend', 'variable')], buckets: [bucket('train', 'transport')],
    transactions: [txn('A', '2026-04-10', -4600, 'train'), txn('A', '2026-04-12', 2340, 'train')],
  }), tuning);
  assert.equal(row(tm, 'transport').perMonth, 2260);
  assert.deepEqual(tm.income, []);
  assert.equal(tm.totals.income, 0);
  assert.equal(tm.totals.living, 2260);
});

test('fixed: refunds and opposite-sign rows are spread over the account months', () => {
  const tm = typicalMonth(build({
    categories: [cat('rent', 'spend', 'fixed'), cat('salary', 'income', 'fixed')],
    buckets: [bucket('lettings', 'rent'), bucket('emp', 'salary')],
    transactions: [
      ...monthly('A', YEAR, '01', -90000, 'lettings'), txn('A', '2026-03-05', 1200, 'lettings'),
      ...monthly('A', YEAR, '25', 250000, 'emp'), txn('A', '2026-02-26', -12000, 'emp'),
    ],
  }), tuning);
  assert.equal(row(tm, 'rent').perMonth, 89900);
  assert.equal(row(tm, 'salary').perMonth, 249000);
});

test('fixed: uses the latest charge times the charge count', () => {
  // 11 charges of 1000 then a rise to 1200 in Oct: divRound(1200 × 12, 12) = 1200.
  const tm = typicalMonth(build({
    categories: [cat('subs', 'spend', 'fixed')], buckets: [bucket('stream', 'subs')],
    transactions: [...monthly('A', YEAR.slice(0, 11), '05', -1000, 'stream'), txn('A', '2026-10-05', -1200, 'stream')],
  }), tuning);
  assert.equal(row(tm, 'subs').perMonth, 1200);
});

test('a one-off category is listed in oneOffs and kept out of living', () => {
  const tm = typicalMonth(build({
    categories: [cat('rent', 'spend', 'fixed'), cat('big', 'spend', 'oneoff')],
    buckets: [bucket('lettings', 'rent'), bucket('boiler', 'big')],
    transactions: [...monthly('A', YEAR, '01', -90000, 'lettings'), txn('A', '2026-01-20', -240000, 'boiler')],
  }), tuning);
  assert.equal(tm.oneOffs.length, 1);
  assert.equal(tm.oneOffs[0].categoryId, 'big');
  assert.equal(tm.oneOffs[0].amountMinor, 240000);
  assert.equal(tm.oneOffs[0].txn.date, '2026-01-20');
  assert.equal(row(tm, 'big'), undefined);
  assert.equal(tm.totals.living, 90000);
});

test('fixed: a bucket with no charge in the last fixedActiveMonths contributes 0', () => {
  const state = build({
    categories: [cat('bills', 'spend', 'fixed')],
    buckets: [bucket('energy', 'bills'), bucket('gym', 'bills')],
    transactions: [
      ...monthly('A', YEAR, '05', -9500, 'energy'),
      ...monthly('A', YEAR.slice(0, 9), '05', -3000, 'gym'), // last charge in Jul 2026
    ],
  });
  assert.equal(row(typicalMonth(state, tuning), 'bills').perMonth, 9500);
  // With 4 active months (Jul to Oct), the gym counts: divRound(3000 × 9, 12) = 2250.
  assert.equal(row(typicalMonth(state, { ...tuning, fixedActiveMonths: 4 }), 'bills').perMonth, 11750);
});

test('split parts count in their own categories; fixed parts group by the transaction bucket', () => {
  const tm = typicalMonth(build({
    batches: [batch('A', '2026-04-01', '2026-04-30')],
    categories: [cat('groc', 'spend', 'variable'), cat('home', 'spend', 'fixed'), cat('misc', 'spend', 'annual')],
    buckets: [bucket('amazon', 'misc')],
    transactions: [{ ...txn('A', '2026-04-03', -10000, 'amazon'), fingerprint: 'split1' }],
    overrides: [{ fingerprint: 'split1', splits: [{ amountMinor: -6000, categoryId: 'groc' }, { amountMinor: -4000, categoryId: 'home' }] }],
  }), tuning);
  assert.equal(row(tm, 'groc').perMonth, 6000);
  assert.equal(row(tm, 'home').perMonth, 4000);
  // Each part takes its own category's budget type, not the bucket's (annual).
  assert.equal(row(tm, 'groc').budgetType, 'variable');
  assert.equal(row(tm, 'home').budgetType, 'fixed');
  assert.equal(row(tm, 'misc'), undefined);
  assert.deepEqual(tm.uncategorised, { spending: 0, income: 0 });
});

test('uncategorised keeps debits and credits apart; transfers and ignore are left out', () => {
  const tm = typicalMonth(build({
    accounts: [acct('A'), acct('S')],
    batches: [yearBatch('A'), yearBatch('S')],
    categories: [cat('ign', 'ignore'), cat('between', 'transfer')],
    buckets: [bucket('mystery'), bucket('junk', 'ign'), bucket('moved', 'between'), bucket('xfer')],
    transactions: [
      txn('A', '2026-02-11', -500, 'mystery'), txn('A', '2026-04-07', -2500, 'mystery'),
      txn('A', '2026-05-07', 300, 'mystery'), txn('A', '2026-05-08', -7777, 'junk'),
      txn('A', '2026-05-09', -8888, 'moved'),
      { ...txn('A', '2026-06-26', -20000, 'xfer'), fingerprint: 'out' },
      { ...txn('S', '2026-06-27', 20000, 'xfer'), fingerprint: 'in' },
    ],
    transferPairs: [{ key: 'in\nout', fingerprintA: 'out', fingerprintB: 'in', status: 'confirmed' }],
  }), tuning);
  assert.deepEqual(tm.uncategorised, { spending: 3000, income: 300 });
  assert.deepEqual(tm.spend, []);
  assert.equal(tm.totals.living, 0);
});

test('mixed currencies are not added together', () => {
  const tm = typicalMonth(build({
    accounts: [acct('A'), acct('E', 'bank', 'EUR')],
    batches: [yearBatch('A'), yearBatch('E')],
    transactions: [txn('A', '2026-01-05', -100, 'x'), txn('E', '2026-01-05', -100, 'x', 'EUR')],
  }), tuning);
  assert.deepEqual(tm, { mixedCurrencies: true, currencies: ['EUR', 'GBP'] });
});

test('Review Focus 5: a card covered only to 20 Oct is stale and its Oct rows do not count', () => {
  const tm = typicalMonth(build({
    accounts: [acct('A'), acct('C', 'card')],
    batches: [yearBatch('A'), batch('C', '2025-11-01', '2026-10-20')],
    categories: [cat('rent', 'spend', 'fixed'), cat('gifts', 'spend', 'annual')],
    buckets: [bucket('lettings', 'rent'), bucket('shop', 'gifts'), bucket('mystery')],
    transactions: [
      ...monthly('A', YEAR, '01', -90000, 'lettings'),
      ...monthly('C', YEAR.slice(0, 11), '02', -1000, 'shop'),
      txn('C', '2026-10-02', -50000, 'shop'), txn('C', '2026-10-05', -700, 'mystery'),
    ],
  }), tuning);
  assert.deepEqual(tm.months, YEAR);
  assert.deepEqual(tm.stale.map((a) => a.id), ['C']);
  // C covers 11 months: divRound(11000 × 12, 11) = 12000. Oct's 50000 is not counted.
  assert.equal(row(tm, 'gifts').perYear, 12000);
  assert.equal(row(tm, 'gifts').perMonth, 1000);
  assert.deepEqual(tm.uncategorised, { spending: 0, income: 0 });
});

test('spend rows are ordered largest per month first', () => {
  const tm = typicalMonth(build({
    categories: [cat('small', 'spend', 'fixed'), cat('large', 'spend', 'fixed')],
    buckets: [bucket('s', 'small'), bucket('l', 'large')],
    transactions: [...monthly('A', YEAR, '05', -100, 's'), ...monthly('A', YEAR, '06', -9000, 'l')],
  }), tuning);
  assert.deepEqual(tm.spend.map((r) => r.categoryId), ['large', 'small']);
});
