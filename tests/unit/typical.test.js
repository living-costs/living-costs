import { test } from 'node:test';
import assert from 'node:assert/strict';
import tuning from '../../src/tuning.js';
import { emptyState, applyToState } from '../../src/changes.js';
import { addDays, monthRange } from '../../src/dates.js';
import { typicalMonth, median, percentile, unusualFlags, categoryDetail, settleChoices } from '../../src/typical.js';

const YEAR = monthRange('2025-11', '2026-10');

let seq = 0;
/** @param {string} id @param {'bank'|'card'|'savings'|'placeholder'} [kind] @param {string} [currency] */
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
const row = (tm, id) => [...tm.spend, ...tm.income, ...tm.contribution, ...(tm.saving ?? [])].find((r) => r.categoryId === id);

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
  assert.deepEqual(tm.totals, { income: 250000, living: 90000, contributions: 55000, share: 35000, leftOver: 215000, savings: 0 });
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

test('fixed: a bucket that stopped charging still counts its charges in the window', () => {
  const state = build({
    categories: [cat('bills', 'spend', 'fixed')],
    buckets: [bucket('energy', 'bills'), bucket('gym', 'bills')],
    transactions: [
      ...monthly('A', YEAR, '05', -9500, 'energy'),
      ...monthly('A', YEAR.slice(0, 9), '05', -3000, 'gym'), // last charge in Jul 2026
    ],
  });
  assert.equal(row(typicalMonth(state, tuning), 'bills').perMonth, 9500 + 2250);
});

test('fixed: a Stopped bucket adds nothing, refunds included', () => {
  const state = build({
    categories: [cat('bills', 'spend', 'fixed')],
    buckets: [bucket('energy', 'bills'), { ...bucket('gym', 'bills'), stoppedAfter: '2026-07-05' }],
    transactions: [
      ...monthly('A', YEAR, '05', -9500, 'energy'),
      ...monthly('A', YEAR.slice(0, 9), '05', -3000, 'gym'),
      txn('A', '2026-08-01', 1000, 'gym'),
    ],
  });
  assert.equal(row(typicalMonth(state, tuning), 'bills').perMonth, 9500);
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

test('fixed: an old bucket and its refund still count', () => {
  const tm = typicalMonth(build({
    categories: [cat('broadband', 'spend', 'fixed')],
    buckets: [bucket('new', 'broadband'), bucket('old', 'broadband')],
    transactions: [
      ...monthly('A', YEAR, '05', -3500, 'new'),
      ...monthly('A', YEAR.slice(0, 3), '06', -3000, 'old'),
      txn('A', '2026-04-10', 4500, 'old'),
    ],
  }), tuning);
  assert.equal(row(tm, 'broadband').perMonth, 3500 + 750 - 375);
});

test("fixed: a bucket's refund lowers its figure but never below 0", () => {
  const tm = typicalMonth(build({
    categories: [cat('broadband', 'spend', 'fixed')],
    buckets: [bucket('old', 'broadband'), bucket('old2', 'broadband')],
    transactions: [
      ...monthly('A', YEAR.slice(0, 3), '06', -3000, 'old'), txn('A', '2026-04-10', 4500, 'old'),
      ...monthly('A', YEAR.slice(0, 3), '07', -3000, 'old2'), txn('A', '2026-04-11', 12000, 'old2'),
    ],
  }), tuning);
  assert.equal(row(tm, 'broadband').perMonth, 375);
});

test('fixed: council tax over 10 months, with the window ending in March', () => {
  const tm = typicalMonth(build({
    batches: [batch('A', '2025-04-01', '2026-03-31')],
    categories: [cat('ctax', 'spend', 'fixed')], buckets: [bucket('council', 'ctax')],
    transactions: monthly('A', monthRange('2025-04', '2026-01'), '01', -18000, 'council'),
  }), tuning);
  assert.equal(row(tm, 'ctax').perMonth, 15000);
});

test('fixed: a renamed employer across two buckets gives the full salary', () => {
  const tm = typicalMonth(build({
    categories: [cat('salary', 'income', 'fixed')],
    buckets: [bucket('emp-old', 'salary'), bucket('emp-new', 'salary')],
    transactions: [
      ...monthly('A', YEAR.slice(0, 9), '25', 250000, 'emp-old'),
      ...monthly('A', YEAR.slice(9), '25', 250000, 'emp-new'),
    ],
  }), tuning);
  assert.equal(row(tm, 'salary').perMonth, 250000);
});

test('fixed: a yearly charge counts as a twelfth', () => {
  const tm = typicalMonth(build({
    categories: [cat('subs', 'spend', 'fixed')], buckets: [bucket('stream', 'subs'), bucket('prime', 'subs')],
    transactions: [...monthly('A', YEAR, '05', -1000, 'stream'), txn('A', '2026-01-15', -9500, 'prime')],
  }), tuning);
  assert.equal(row(tm, 'subs').perMonth, 1000 + 792);
});

test('fixed: a refund still lowers perMonth', () => {
  const tm = typicalMonth(build({
    categories: [cat('broadband', 'spend', 'fixed')],
    buckets: [bucket('new', 'broadband')],
    transactions: [...monthly('A', YEAR, '05', -3500, 'new'), txn('A', '2026-04-10', 1200, 'new')],
  }), tuning);
  assert.equal(row(tm, 'broadband').perMonth, 3500 - 100);
});

test('rows with equal figures are in name order ignoring case', () => {
  const s = build({
    categories: [{ ...cat('z', 'spend', 'annual'), name: 'Zoo' }, { ...cat('a', 'spend', 'annual'), name: 'apples' }],
    buckets: [bucket('bz', 'z'), bucket('ba', 'a')],
    transactions: [txn('A', '2026-01-10', -1200, 'bz'), txn('A', '2026-01-10', -1200, 'ba')],
  });
  const tm = /** @type {any} */ (typicalMonth(s, tuning));
  // Code-unit order would put Zoo before apples.
  assert.deepEqual(tm.spend.map((r) => r.name), ['apples', 'Zoo']);
});

/** @param {any} o @param {string[]} keys */
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

test('unusualFlags: exactly the percent is not unusual', () => {
  assert.deepEqual(unusualFlags([100, 100, 0, 200, 100, 125], 25), [false, false, true, true, false, false]);
});

test('unusualFlags handles zero and negative medians', () => {
  assert.deepEqual(unusualFlags([0, 0, 5], 25), [false, false, true]);
  assert.deepEqual(unusualFlags([-100, -100, -300], 25), [false, false, true]);
  assert.deepEqual(unusualFlags([], 25), []);
});

test('categoryDetail: variable over two accounts with different coverage', () => {
  const S = ['2026-08', '2026-09', '2026-10'];
  const state = build({
    accounts: [acct('A'), acct('S')],
    batches: [yearBatch('A'), batch('S', '2026-08-01', '2026-10-31')],
    categories: [cat('groc', 'spend', 'variable')], buckets: [bucket('shop', 'groc')],
    transactions: [
      ...YEAR.map((m) => txn('A', `${m}-15`, m === '2026-03' ? -20000 : -10000, 'shop')),
      ...monthly('S', S, '20', -5000, 'shop'),
    ],
  });
  const d = /** @type {any} */ (categoryDetail(state, tuning, 'groc'));
  assert.deepEqual(d.row, row(typicalMonth(state, tuning), 'groc'));
  assert.equal(d.currency, 'GBP');
  assert.deepEqual(d.months, YEAR);
  assert.deepEqual(d.accounts.map((a) => [a.accountId, a.share]), [['A', 10000], ['S', 5000]]);
  assert.equal(d.accounts[0].share + d.accounts[1].share, d.row.perMonth);
  const [a, s] = d.accounts;
  assert.deepEqual(a.cells.map((c) => c.month), YEAR);
  assert.deepEqual(a.cells.map((c) => c.total), YEAR.map((m) => (m === '2026-03' ? 20000 : 10000)));
  assert.deepEqual(a.cells.map((c) => c.unusual), YEAR.map((m) => m === '2026-03'));
  assert.equal(s.cells.length, 12);
  assert.deepEqual(s.cells.slice(0, 9).map((c) => c.total), Array(9).fill(null));
  assert.deepEqual(s.cells.slice(9).map((c) => c.total), [5000, 5000, 5000]);
  // Flags use only S's covered months: over all 12 as 0, its median would be 0 and Aug to Oct unusual.
  assert.deepEqual(s.cells.map((c) => c.unusual), Array(12).fill(false));
  assert.deepEqual(d.buckets, []);
});

test('categoryDetail: annual account shares are scaled yearly totals that add to perYear', () => {
  const state = build({
    accounts: [acct('A'), acct('S')],
    batches: [yearBatch('A'), batch('S', '2026-05-01', '2026-10-31')],
    categories: [cat('gifts', 'spend', 'annual')], buckets: [bucket('present', 'gifts')],
    transactions: [txn('A', '2025-12-10', -30000, 'present'), txn('S', '2026-06-10', -10000, 'present')],
  });
  const d = /** @type {any} */ (categoryDetail(state, tuning, 'gifts'));
  assert.deepEqual(d.accounts.map((a) => [a.accountId, a.share]), [['A', 30000], ['S', 20000]]);
  assert.equal(d.row.perYear, 50000);
  assert.deepEqual(d.row, row(typicalMonth(state, tuning), 'gifts'));
});

test('categoryDetail: fixed bucket lines add up to perMonth, and a stopped line is 0', () => {
  const state = build({
    categories: [cat('bills', 'spend', 'fixed')],
    buckets: [bucket('energy', 'bills'), { ...bucket('gym', 'bills'), stoppedAfter: '2026-07-05' }],
    transactions: [
      ...monthly('A', YEAR, '05', -9500, 'energy'),
      ...monthly('A', YEAR.slice(0, 9), '05', -3000, 'gym'),
    ],
  });
  const d = /** @type {any} */ (categoryDetail(state, tuning, 'bills'));
  assert.deepEqual(d.row, row(typicalMonth(state, tuning), 'bills'));
  assert.equal(d.buckets.reduce((s, b) => s + b.perMonth, 0), d.row.perMonth);
  assert.deepEqual(d.buckets.map((b) => [b.bucketId, b.accountId, b.count, b.latest, b.latestDate, b.perMonth, b.stopped]),
    [['energy', 'A', 12, 9500, '2026-10-05', 9500, false], ['gym', 'A', 9, 3000, '2026-07-05', 0, true]]);
  assert.deepEqual(d.accounts.map((a) => [a.accountId, a.share]), [['A', 9500]]);
});

test('categoryDetail: fixed lines are ordered by perMonth, then display name', () => {
  const state = build({
    categories: [cat('subs', 'spend', 'fixed')],
    buckets: [
      { ...bucket('z1', 'subs'), displayName: 'Zed' }, { ...bucket('a1', 'subs'), displayName: 'apple' },
      bucket('big', 'subs'),
    ],
    transactions: [
      ...monthly('A', YEAR, '05', -1000, 'z1'), ...monthly('A', YEAR, '06', -1000, 'a1'),
      ...monthly('A', YEAR, '07', -5000, 'big'),
    ],
  });
  const d = /** @type {any} */ (categoryDetail(state, tuning, 'subs'));
  assert.deepEqual(d.buckets.map((b) => b.bucketId), ['big', 'a1', 'z1']);
});

test('a refund-only bucket line has count 0', () => {
  const state = build({
    categories: [cat('broadband', 'spend', 'fixed')],
    buckets: [bucket('new', 'broadband'), bucket('old', 'broadband')],
    transactions: [...monthly('A', YEAR, '05', -3500, 'new'), txn('A', '2026-04-10', 4500, 'old')],
  });
  const d = /** @type {any} */ (categoryDetail(state, tuning, 'broadband'));
  const old = d.buckets.find((b) => b.bucketId === 'old');
  assert.deepEqual(pick(old, ['count', 'latest', 'latestDate', 'perMonth']), { count: 0, latest: 0, latestDate: '', perMonth: 0 });
  assert.equal(d.buckets.reduce((s, b) => s + b.perMonth, 0), d.row.perMonth);
});

test('stopped applies to every line of a bucket', () => {
  const state = build({
    accounts: [acct('A'), acct('C', 'card')],
    batches: [yearBatch('A'), yearBatch('C')],
    categories: [cat('bills', 'spend', 'fixed')],
    buckets: [bucket('energy', 'bills'), { ...bucket('gym', 'bills'), stoppedAfter: '2026-07-05' }],
    transactions: [
      ...monthly('A', YEAR, '05', -9500, 'energy'),
      ...monthly('C', YEAR.slice(0, 9), '05', -3000, 'gym'),
      ...monthly('A', YEAR.slice(0, 6), '06', -3000, 'gym'),
    ],
  });
  const d = /** @type {any} */ (categoryDetail(state, tuning, 'bills'));
  assert.deepEqual(d.buckets.map((b) => [b.bucketId, b.accountId, b.count, b.perMonth, b.stopped]),
    [['energy', 'A', 12, 9500, false], ['gym', 'A', 6, 0, true], ['gym', 'C', 9, 0, true]]);
  assert.deepEqual(d.accounts.map((a) => [a.accountId, a.share]), [['A', 9500], ['C', 0]]);
});

test('categoryDetail: counted transactions include overrides and split parts, not transfers or uncovered months', () => {
  const plain = txn('A', '2026-02-03', -2500, 'diy');
  const refund = txn('A', '2026-02-09', 700, 'diy');
  const movedIn = { ...txn('A', '2026-03-03', -1800, 'cafe'), fingerprint: 'moved' };
  const movedOut = { ...txn('A', '2026-03-04', -900, 'diy'), fingerprint: 'out' };
  const split = { ...txn('A', '2026-04-03', -10000, 'amazon'), fingerprint: 'split1' };
  const transfer = { ...txn('A', '2026-05-01', -20000, 'diy'), fingerprint: 'xa' };
  const other = { ...txn('S', '2026-05-02', 20000, 'diy'), fingerprint: 'xb' };
  const uncovered = txn('C', '2026-10-02', -5000, 'diy');
  const state = build({
    accounts: [acct('A'), acct('S'), acct('C', 'card')],
    batches: [yearBatch('A'), yearBatch('S'), batch('C', '2025-11-01', '2026-10-20')],
    categories: [cat('home', 'spend', 'variable'), cat('groc', 'spend', 'variable'), cat('eat', 'spend', 'variable')],
    buckets: [bucket('diy', 'home'), bucket('cafe', 'eat'), bucket('amazon', 'groc')],
    transactions: [plain, refund, movedIn, movedOut, split, transfer, other, uncovered],
    overrides: [
      { fingerprint: 'moved', categoryId: 'home' },
      { fingerprint: 'out', categoryId: 'eat' },
      { fingerprint: 'split1', splits: [{ amountMinor: -6000, categoryId: 'groc' }, { amountMinor: -4000, categoryId: 'home' }] },
    ],
    transferPairs: [{ key: 'xa\nxb', fingerprintA: 'xa', fingerprintB: 'xb', status: 'confirmed' }],
  });
  const d = /** @type {any} */ (categoryDetail(state, tuning, 'home'));
  assert.ok(d.transactionIds.has(movedIn.id));
  assert.equal(d.partMinor.get(split.id), -4000);
  assert.ok(!d.transactionIds.has(transfer.id));
  assert.ok(!d.transactionIds.has(uncovered.id));
  assert.deepEqual([...d.transactionIds].sort(), [plain.id, refund.id, movedIn.id, split.id].sort());
  assert.deepEqual([...d.partMinor].sort(), [[plain.id, -2500], [refund.id, 700], [movedIn.id, -1800], [split.id, -4000]].sort());
  assert.deepEqual(d.accounts.map((a) => a.accountId), ['A']);
});

test('categoryDetail returns null for one-off, transfer, unknown and empty categories, and mixed currencies', () => {
  const state = build({
    accounts: [acct('A'), acct('S')],
    batches: [yearBatch('A'), yearBatch('S')],
    categories: [cat('rent', 'spend', 'fixed'), cat('big', 'spend', 'oneoff'), cat('between', 'transfer'), cat('quiet', 'spend', 'variable')],
    buckets: [bucket('lettings', 'rent'), bucket('boiler', 'big'), bucket('moved', 'between')],
    transactions: [
      ...monthly('A', YEAR, '01', -90000, 'lettings'), txn('A', '2026-01-20', -240000, 'boiler'),
      txn('A', '2026-02-20', -5000, 'moved'),
    ],
  });
  assert.ok(categoryDetail(state, tuning, 'rent'));
  assert.equal(categoryDetail(state, tuning, 'big'), null);
  assert.equal(categoryDetail(state, tuning, 'between'), null);
  assert.equal(categoryDetail(state, tuning, 'nope'), null);
  assert.equal(categoryDetail(state, tuning, 'quiet'), null);
  const mixed = build({
    accounts: [acct('A'), acct('E', 'bank', 'EUR')],
    batches: [yearBatch('A'), yearBatch('E')],
    categories: [cat('rent', 'spend', 'fixed')], buckets: [bucket('lettings', 'rent')],
    transactions: [txn('A', '2026-01-05', -100, 'lettings'), txn('E', '2026-01-05', -100, 'lettings', 'EUR')],
  });
  assert.equal(categoryDetail(mixed, tuning, 'rent'), null);
});

// Groceries: 10000 a month Nov to Jun, 6000 Jul to Oct. Rent: 90000 every month. Gifts: 48000 in Dec.
const seasonal = build({
  categories: [cat('groceries', 'spend', 'variable'), cat('rent', 'spend', 'fixed'), cat('gifts', 'spend', 'annual')],
  buckets: [bucket('shop', 'groceries'), bucket('lettings', 'rent'), bucket('present', 'gifts')],
  transactions: [
    ...monthly('A', YEAR.slice(0, 8), '15', -10000, 'shop'),
    ...monthly('A', YEAR.slice(8), '15', -6000, 'shop'),
    ...monthly('A', YEAR, '01', -90000, 'lettings'),
    txn('A', '2025-12-10', -48000, 'present'),
  ],
});

test('a chosen range gives the typical figures over its months only', () => {
  const tm = /** @type {any} */ (typicalMonth(seasonal, tuning, { range: { from: '2025-11', to: '2026-06' }, compare: null }));
  assert.deepEqual(tm.months, monthRange('2025-11', '2026-06'));
  assert.equal(row(tm, 'groceries').perMonth, 10000);
  assert.equal(tm.isDefault, false);
  assert.equal(tm.compare, null);
  assert.equal(row(tm, 'groceries').month, undefined);
});

test('the default window is marked as the default', () => {
  const tm = /** @type {any} */ (typicalMonth(seasonal, tuning));
  assert.equal(tm.isDefault, true);
  assert.equal(tm.compare, null);
  assert.equal(row(tm, 'groceries').perMonth, 10000); // median of eight 10000s and four 6000s
});

test('compare: fixed and variable use the month total, annual its typical figure', () => {
  const tm = /** @type {any} */ (typicalMonth(seasonal, tuning, { range: { from: '2025-11', to: '2026-06' }, compare: '2026-10' }));
  assert.equal(row(tm, 'groceries').month, 6000);
  assert.equal(row(tm, 'rent').month, 90000);
  // divRound(48000 × 12, 8) = 72000 a year, 6000 a month.
  assert.equal(row(tm, 'gifts').perMonth, 6000);
  assert.equal(row(tm, 'gifts').month, row(tm, 'gifts').perMonth);
  assert.equal(tm.compare?.month, '2026-10');
  assert.equal(tm.compare?.totals.living, 6000 + 90000 + row(tm, 'gifts').perMonth);
  assert.deepEqual(tm.compare?.missing, []);
});

test('comparing leaves the typical figures unchanged', () => {
  const plain = /** @type {any} */ (typicalMonth(seasonal, tuning));
  const compared = /** @type {any} */ (typicalMonth(seasonal, tuning, { range: null, compare: '2026-03' }));
  const strip = (/** @type {any[]} */ rows) => rows.map(({ month, ...r }) => r);
  assert.deepEqual(strip(compared.spend), plain.spend);
  assert.deepEqual(compared.totals, plain.totals);
  assert.deepEqual(compared.spend.map((/** @type {any} */ r) => r.month), [90000, 10000, 4000]);
});

test('compare is null when the month is not complete', () => {
  assert.equal(/** @type {any} */ (typicalMonth(seasonal, tuning, { range: null, compare: '2026-11' })).compare, null);
  const none = build({
    batches: [],
    categories: [cat('rent', 'spend', 'fixed')], buckets: [bucket('lettings', 'rent')],
    transactions: [txn('A', '2026-01-01', -90000, 'lettings')],
  });
  const tm = /** @type {any} */ (typicalMonth(none, tuning, { range: null, compare: '2026-01' }));
  assert.equal(tm.complete, false);
  assert.equal(tm.compare, null);
  assert.equal(row(tm, 'rent').month, undefined);
});

test('a category only in the compared month gets a month-only row; annual does not', () => {
  const state = build({
    accounts: [acct('A'), acct('B')],
    batches: [yearBatch('A'), batch('B', '2026-08-01', '2026-10-31')],
    categories: [cat('rent', 'spend', 'fixed'), cat('contrib', 'contribution', 'fixed'), cat('holiday', 'spend', 'annual')],
    buckets: [bucket('lettings', 'rent'), bucket('other', 'contrib'), bucket('trip', 'holiday')],
    transactions: [
      ...monthly('A', YEAR, '01', -90000, 'lettings'),
      ...monthly('B', ['2026-08', '2026-09', '2026-10'], '01', 55000, 'other'),
      txn('A', '2026-10-10', -30000, 'trip'),
    ],
  });
  const tm = /** @type {any} */ (typicalMonth(state, tuning, { range: { from: '2025-11', to: '2026-06' }, compare: '2026-10' }));
  assert.deepEqual(row(tm, 'contrib'), {
    categoryId: 'contrib', name: 'contrib', budgetType: 'fixed', perMonth: 0, perYear: 0, month: 55000, monthOnly: true,
  });
  assert.equal(row(tm, 'holiday'), undefined);
  assert.equal(row(tm, 'rent').monthOnly, undefined);
  assert.deepEqual(tm.compare?.totals, { income: 0, living: 90000, contributions: 55000, share: 35000, leftOver: -35000, savings: 0 });
  assert.deepEqual(tm.totals, { income: 0, living: 90000, contributions: 0, share: 90000, leftOver: -90000, savings: 0 });
});

test('compare.missing lists window accounts that do not cover the month', () => {
  const state = build({
    accounts: [acct('A'), acct('B'), acct('C')],
    batches: [yearBatch('A'), batch('B', '2026-08-01', '2026-10-31'), batch('C', '2026-08-01', '2026-10-31')],
    categories: [cat('rent', 'spend', 'fixed'), cat('contrib', 'contribution', 'fixed')],
    buckets: [bucket('lettings', 'rent'), bucket('other', 'contrib')],
    transactions: [
      ...monthly('A', YEAR, '01', -90000, 'lettings'),
      ...monthly('B', ['2026-08', '2026-09', '2026-10'], '01', 55000, 'other'),
    ],
  });
  // C covers Aug to Oct too, but has nothing counted in the window.
  const june = /** @type {any} */ (typicalMonth(state, tuning, { range: null, compare: '2026-06' }));
  assert.deepEqual(june.compare?.missing.map((/** @type {any} */ a) => a.id), ['B']);
  const sept = /** @type {any} */ (typicalMonth(state, tuning, { range: null, compare: '2026-09' }));
  assert.deepEqual(sept.compare?.missing, []);
});

test('month figures resolve splits and transfers like the typical ones', () => {
  const state = build({
    accounts: [acct('A'), acct('S')],
    batches: [yearBatch('A'), yearBatch('S')],
    categories: [cat('groceries', 'spend', 'variable'), cat('household', 'spend', 'fixed')],
    buckets: [bucket('amazon', 'groceries'), bucket('diy', 'household'), bucket('mystery')],
    transactions: [
      { ...txn('A', '2026-10-03', -10000, 'amazon'), fingerprint: 'split1' },
      { ...txn('A', '2026-10-05', -20000, 'diy'), fingerprint: 'xa' },
      { ...txn('S', '2026-10-06', 20000, 'mystery'), fingerprint: 'xb' },
      txn('A', '2026-10-07', -500, 'mystery'),
    ],
    overrides: [{ fingerprint: 'split1', splits: [{ amountMinor: -7000, categoryId: 'groceries' }, { amountMinor: -3000, categoryId: 'household' }] }],
    transferPairs: [{ key: 'xa\nxb', fingerprintA: 'xa', fingerprintB: 'xb', status: 'confirmed' }],
  });
  const tm = /** @type {any} */ (typicalMonth(state, tuning, { range: null, compare: '2026-10' }));
  assert.equal(row(tm, 'groceries').month, 7000);
  assert.equal(row(tm, 'household').month, 3000);
  assert.equal(tm.compare?.totals.living, 10000);
  assert.deepEqual(tm.uncategorised, { spending: 500, income: 0 });
});

test('month columns reconcile with the compare totals', () => {
  const state = build({
    accounts: [acct('A'), acct('B')],
    batches: [yearBatch('A'), batch('B', '2026-08-01', '2026-10-31')],
    categories: [
      cat('salary', 'income', 'fixed'), cat('groceries', 'spend', 'variable'), cat('rent', 'spend', 'fixed'),
      cat('gifts', 'spend', 'annual'), cat('contrib', 'contribution', 'fixed'),
    ],
    buckets: [
      bucket('emp', 'salary'), bucket('shop', 'groceries'), bucket('lettings', 'rent'),
      bucket('present', 'gifts'), bucket('other', 'contrib'),
    ],
    transactions: [
      ...monthly('A', YEAR, '25', 250000, 'emp'),
      ...monthly('A', YEAR.slice(0, 8), '15', -10000, 'shop'),
      ...monthly('A', YEAR.slice(8), '15', -6000, 'shop'),
      ...monthly('A', YEAR, '01', -90000, 'lettings'),
      txn('A', '2025-12-10', -48000, 'present'),
      ...monthly('B', ['2026-08', '2026-09', '2026-10'], '01', 55000, 'other'),
    ],
  });
  const tm = /** @type {any} */ (typicalMonth(state, tuning, { range: { from: '2025-11', to: '2026-06' }, compare: '2026-10' }));
  /** @param {any[]} rows */
  const sumMonth = (rows) => rows.reduce((acc, r) => acc + r.month, 0);
  const t = tm.compare.totals;
  assert.equal(sumMonth(tm.spend), t.living);
  assert.equal(sumMonth(tm.income), t.income);
  assert.equal(sumMonth(tm.contribution), t.contributions);
  assert.equal(t.share, t.living - t.contributions);
  assert.equal(t.leftOver, t.income - t.share);
  assert.deepEqual(t, { income: 250000, living: 102000, contributions: 55000, share: 47000, leftOver: 203000, savings: 0 });
  assert.ok([...tm.spend, ...tm.income, ...tm.contribution].every((r) => typeof r.month === 'number'));
});

test('settleChoices drops choices that are no longer complete', () => {
  const complete = monthRange('2026-01', '2026-06');
  assert.deepEqual(settleChoices(complete, { range: { from: '2026-02', to: '2026-04' }, compare: '2026-05' }),
    { range: { from: '2026-02', to: '2026-04' }, compare: '2026-05' });
  assert.deepEqual(settleChoices(complete, { range: { from: '2025-01', to: '2025-06' }, compare: '2026-09' }),
    { range: null, compare: null });
  assert.deepEqual(settleChoices(complete, { range: { from: '2026-04', to: '2026-02' }, compare: null }),
    { range: null, compare: null });
  // A range that still overlaps the complete months keeps its own from and to.
  assert.deepEqual(settleChoices(complete, { range: { from: '2025-10', to: '2026-02' }, compare: null }),
    { range: { from: '2025-10', to: '2026-02' }, compare: null });
});

test('categoryDetail with a range matches the row typicalMonth gives', () => {
  const range = { from: '2025-11', to: '2026-06' };
  const tm = /** @type {any} */ (typicalMonth(seasonal, tuning, { range, compare: null }));
  const d = categoryDetail(seasonal, tuning, 'groceries', range);
  assert.deepEqual(d?.row, row(tm, 'groceries'));
  assert.deepEqual(d?.months, monthRange('2025-11', '2026-06'));
  assert.deepEqual(categoryDetail(seasonal, tuning, 'groceries')?.months, YEAR);
});

/**
 * A confirmed pair: `amountMinor` leaves `from` and arrives in `to` the next day.
 * @param {string} from @param {string} to @param {string} date @param {number} amountMinor
 * @param {string} [fromBucket] @param {string} [toBucket]
 */
function pair(from, to, date, amountMinor, fromBucket = 'xfer', toBucket = 'xfer') {
  const out = txn(from, date, -amountMinor, fromBucket);
  const into = txn(to, addDays(date, 1), amountMinor, toBucket);
  const [a, b] = [out.fingerprint, into.fingerprint].sort();
  return { out, into, txns: [out, into], link: { key: `${a}\n${b}`, fingerprintA: a, fingerprintB: b, status: 'confirmed' } };
}
/** @param {ReturnType<typeof pair>[]} pairs */
const paired = (pairs) => ({ transactions: pairs.flatMap((p) => p.txns), transferPairs: pairs.map((p) => p.link) });
/** @param {any[]} rows @param {(r:any)=>number} figure */
const sumOf = (rows, figure) => rows.reduce((acc, r) => acc + figure(r), 0);
const savingsAccounts = { accounts: [acct('A'), acct('S', 'savings')], batches: [yearBatch('A'), yearBatch('S')] };

const everyday = {
  categories: [cat('salary', 'income', 'fixed'), cat('rent', 'spend', 'fixed'), cat('contrib', 'contribution', 'fixed')],
  buckets: [bucket('emp', 'salary'), bucket('lettings', 'rent'), bucket('other', 'contrib')],
  transactions: [
    ...monthly('A', YEAR, '25', 250000, 'emp'),
    ...monthly('A', YEAR, '01', -90000, 'lettings'),
    ...monthly('A', YEAR, '05', 30000, 'other'),
  ],
};

test('saving: a monthly -20000 to a Saving category is a 20000 saving and changes no other total', () => {
  const without = /** @type {any} */ (typicalMonth(build(everyday), tuning));
  const tm = /** @type {any} */ (typicalMonth(build({
    categories: [...everyday.categories, cat('sav', 'saving', 'variable')],
    buckets: [...everyday.buckets, bucket('isa', 'sav')],
    transactions: [...everyday.transactions, ...monthly('A', YEAR, '02', -20000, 'isa')],
  }), tuning));
  assert.equal(row(tm, 'sav').perMonth, 20000);
  assert.deepEqual(tm.saving.map((/** @type {any} */ r) => r.categoryId), ['sav']);
  assert.equal(tm.totals.savings, 20000);
  assert.equal(without.totals.savings, 0);
  assert.deepEqual(without.saving, []);
  const { savings: _with, ...rest } = tm.totals;
  const { savings: _without, ...before } = without.totals;
  assert.deepEqual(rest, before);
  assert.deepEqual(rest, { income: 250000, living: 90000, contributions: 30000, share: 60000, leftOver: 190000 });
  assert.deepEqual(tm.uncategorised, without.uncategorised);
});

test('saving is net: a withdrawal bucket in a Variable Saving category reduces it', () => {
  const months = monthRange('2026-01', '2026-04');
  const tm = /** @type {any} */ (typicalMonth(build({
    batches: [batch('A', '2026-01-01', '2026-04-30')],
    categories: [cat('sav', 'saving', 'variable')],
    buckets: [bucket('isa', 'sav'), bucket('back', 'sav')],
    transactions: [...monthly('A', months, '02', -20000, 'isa'), txn('A', '2026-03-20', 5000, 'back')],
  }), tuning));
  // Months 20000, 20000, 15000, 20000: median 20000; the 25th percentile is the lowest, 15000.
  assert.equal(row(tm, 'sav').perMonth, 20000);
  assert.deepEqual(row(tm, 'sav').range, [15000, 20000]);
});

test('a Fixed Saving category ignores a withdrawal-only bucket', () => {
  const tm = /** @type {any} */ (typicalMonth(build({
    categories: [cat('sav', 'saving', 'fixed')],
    buckets: [bucket('isa', 'sav'), bucket('back', 'sav')],
    transactions: [...monthly('A', YEAR, '02', -20000, 'isa'), txn('A', '2026-03-20', 5000, 'back')],
  }), tuning, { range: null, compare: '2026-03' }));
  assert.equal(row(tm, 'sav').perMonth, 20000);
  assert.equal(tm.totals.savings, 20000);
  // It does reduce that month's figure when comparing.
  assert.equal(row(tm, 'sav').month, 15000);
});

test('a confirmed pair bank → savings counts once, on the bank side, in an account row', () => {
  const pairs = YEAR.map((m) => pair('A', 'S', `${m}-10`, 10000));
  const state = build({ ...savingsAccounts, buckets: [bucket('xfer')], ...paired(pairs) });
  const tm = /** @type {any} */ (typicalMonth(state, tuning));
  assert.deepEqual(tm.saving.map((/** @type {any} */ r) => [r.categoryId, r.name, r.perMonth, r.accountId]), [['account:S', 'S', 10000, 'S']]);
  assert.equal(row(tm, 'account:S').budgetType, 'variable');
  assert.deepEqual(row(tm, 'account:S').range, [10000, 10000]);
  assert.equal(tm.totals.savings, 10000);
  assert.deepEqual(tm.uncategorised, { spending: 0, income: 0 });
  assert.equal(tm.totals.living, 0);
  assert.equal(tm.totals.income, 0);
});

test('a pair takes the bank side\'s Saving category', () => {
  const tm = /** @type {any} */ (typicalMonth(build({
    ...savingsAccounts,
    categories: [cat('sav', 'saving', 'variable')],
    buckets: [bucket('tosav', 'sav'), bucket('xfer')],
    ...paired(YEAR.map((m) => pair('A', 'S', `${m}-10`, 10000, 'tosav'))),
  }), tuning));
  assert.deepEqual(tm.saving.map((/** @type {any} */ r) => [r.categoryId, r.perMonth, r.accountId]), [['sav', 10000, undefined]]);
  assert.ok(!('accountId' in row(tm, 'sav')));
  assert.equal(tm.totals.savings, 10000);
});

test('a withdrawal pair savings → bank counts negative', () => {
  const tm = /** @type {any} */ (typicalMonth(build({
    ...savingsAccounts,
    categories: [cat('sav', 'saving', 'annual')],
    buckets: [bucket('xfer'), bucket('fromsav', 'sav')],
    ...paired([pair('S', 'A', '2026-06-10', 12000, 'xfer', 'fromsav'), pair('S', 'A', '2026-03-10', 30000)]),
  }), tuning, { range: null, compare: '2026-03' }));
  // The categorised one lands in its Annual Saving category; the other in the account row.
  assert.equal(row(tm, 'sav').perYear, -12000);
  assert.equal(row(tm, 'account:S').month, -30000);
  assert.equal(tm.compare.totals.savings, -30000 + row(tm, 'sav').perMonth);
  assert.equal(tm.compare.totals.living, 0);
  assert.equal(tm.compare.totals.income, 0);
});

test('a withdrawal pair in a month the bank side does not cover counts nothing', () => {
  const tm = /** @type {any} */ (typicalMonth(build({
    accounts: savingsAccounts.accounts,
    batches: [batch('A', '2025-11-01', '2026-06-15'), yearBatch('S')],
    categories: [cat('sav', 'saving', 'annual')],
    buckets: [bucket('xfer'), bucket('fromsav', 'sav')],
    ...paired([pair('S', 'A', '2026-06-08', 30000, 'xfer', 'fromsav')]),
  }), tuning));
  assert.ok(tm.months.includes('2026-06'));
  assert.deepEqual(tm.saving, []);
  assert.equal(tm.totals.savings, 0);
  assert.deepEqual(tm.uncategorised, { spending: 0, income: 0 });
});

test('an unpaired Saving-category deposit inside a Savings account counts nothing', () => {
  const state = build({
    ...savingsAccounts,
    categories: [cat('sav', 'saving', 'variable'), cat('pot', 'saving', 'variable')],
    buckets: [bucket('dep', 'sav'), bucket('dd', 'sav'), bucket('interest', 'pot')],
    transactions: [
      ...monthly('S', YEAR, '10', 10000, 'dep'), ...monthly('A', YEAR, '02', -5000, 'dd'),
      ...monthly('S', YEAR, '28', 300, 'interest'),
    ],
  });
  const tm = /** @type {any} */ (typicalMonth(state, tuning));
  assert.deepEqual(tm.saving.map((/** @type {any} */ r) => [r.categoryId, r.perMonth]), [['sav', 5000]]);
  assert.equal(tm.totals.savings, 5000);
  assert.deepEqual(tm.uncategorised, { spending: 0, income: 0 });
  assert.equal(categoryDetail(state, tuning, 'pot'), null);
  const d = /** @type {any} */ (categoryDetail(state, tuning, 'sav'));
  assert.deepEqual(d.accounts.map((/** @type {any} */ a) => a.accountId), ['A']);
});

test('changing S from savings to bank makes its pairs plain transfers again', () => {
  const p = paired(YEAR.map((m) => pair('A', 'S', `${m}-10`, 10000)));
  const banks = /** @type {any} */ (typicalMonth(build({
    accounts: [acct('A'), acct('S')], batches: savingsAccounts.batches, buckets: [bucket('xfer')], ...p,
  }), tuning));
  assert.deepEqual(banks.saving, []);
  assert.equal(banks.totals.savings, 0);
  assert.deepEqual(banks.uncategorised, { spending: 0, income: 0 });
  // Both sides in Savings accounts: a plain transfer too.
  const both = /** @type {any} */ (typicalMonth(build({
    accounts: [acct('A', 'savings'), acct('S', 'savings')], batches: savingsAccounts.batches, buckets: [bucket('xfer')], ...p,
  }), tuning));
  assert.deepEqual(both.saving, []);
  assert.equal(both.totals.savings, 0);
});

test('Savings rows sum to totals.savings, typical and compared month', () => {
  const p = paired([...YEAR.map((m) => pair('A', 'S', `${m}-10`, 10000)), pair('A', 'T', '2026-10-12', 7000)]);
  const tm = /** @type {any} */ (typicalMonth(build({
    accounts: [...savingsAccounts.accounts, acct('T', 'savings')],
    batches: [...savingsAccounts.batches, yearBatch('T')],
    categories: [...everyday.categories, cat('sav', 'saving', 'variable'), cat('pot', 'saving', 'fixed'), cat('big', 'saving', 'oneoff')],
    buckets: [...everyday.buckets, bucket('isa', 'sav'), bucket('pension', 'pot'), bucket('lump', 'big'), bucket('xfer')],
    transactions: [
      ...everyday.transactions,
      ...monthly('A', YEAR.slice(0, 8), '02', -20000, 'isa'),
      ...monthly('A', YEAR.slice(8), '02', -25000, 'isa'),
      ...monthly('A', YEAR, '03', -15000, 'pension'),
      txn('A', '2026-01-15', -100000, 'lump'),
      ...p.transactions,
    ],
    transferPairs: p.transferPairs,
  }), tuning, { range: { from: '2025-11', to: '2026-06' }, compare: '2026-10' }));
  assert.equal(tm.totals.savings, sumOf(tm.saving, (r) => r.perMonth));
  assert.equal(tm.compare.totals.savings, sumOf(tm.saving, (r) => r.month));
  assert.ok(tm.saving.every((/** @type {any} */ r) => typeof r.month === 'number'));
  // T has a pair only in the compared month: a month-only account row.
  assert.deepEqual(row(tm, 'account:T'), {
    categoryId: 'account:T', name: 'T', budgetType: 'variable', perMonth: 0, perYear: 0, month: 7000, monthOnly: true, accountId: 'T',
  });
  assert.equal(row(tm, 'sav').month, 25000);
  assert.equal(tm.compare.totals.savings, 25000 + 15000 + 10000 + 7000);
  assert.equal(tm.totals.savings, 20000 + 15000 + 10000);
  // The one-off sits in oneOffs, outside the Savings total.
  assert.deepEqual(tm.oneOffs.map((/** @type {any} */ o) => [o.categoryId, o.amountMinor]), [['big', 100000]]);
  assert.deepEqual(tm.totals, { income: 250000, living: 90000, contributions: 30000, share: 60000, leftOver: 190000, savings: 45000 });
  assert.deepEqual(tm.compare.totals, { income: 250000, living: 90000, contributions: 30000, share: 60000, leftOver: 190000, savings: 57000 });
});

test('categoryDetail for a Saving category matches its row, pairs included; an account: id gives null', () => {
  const toSav = YEAR.map((m) => pair('A', 'S', `${m}-10`, 10000, 'tosav'));
  const plain = YEAR.map((m) => pair('A', 'S', `${m}-20`, 4000));
  const extra = monthly('A', YEAR, '02', -2000, 'tosav');
  const state = build({
    ...savingsAccounts,
    categories: [cat('sav', 'saving', 'variable')],
    buckets: [bucket('tosav', 'sav'), bucket('xfer')],
    transactions: [...paired([...toSav, ...plain]).transactions, ...extra],
    transferPairs: paired([...toSav, ...plain]).transferPairs,
  });
  const tm = /** @type {any} */ (typicalMonth(state, tuning));
  const d = /** @type {any} */ (categoryDetail(state, tuning, 'sav'));
  assert.deepEqual(d.row, row(tm, 'sav'));
  assert.equal(d.row.perMonth, 12000);
  assert.deepEqual([...d.transactionIds].sort(), [...toSav.map((p) => p.out.id), ...extra.map((t) => t.id)].sort());
  assert.equal(sumOf([...d.partMinor.values()], (v) => -v), 12000 * 12);
  assert.deepEqual(d.accounts.map((/** @type {any} */ a) => a.accountId), ['A']);
  assert.ok(row(tm, 'account:S'));
  assert.equal(categoryDetail(state, tuning, 'account:S'), null);
});
