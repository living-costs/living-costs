import { test } from 'node:test';
import assert from 'node:assert/strict';
import tuning from '../../src/tuning.js';
import { emptyState, applyToState } from '../../src/changes.js';
import { addDays } from '../../src/dates.js';
import { categoryContents, openableCategoryIds } from '../../src/explore.js';

let seq = 0;
/** @param {string} id @param {'bank'|'card'|'savings'|'placeholder'} [kind] */
const acct = (id, kind = 'bank') => ({ id, name: id, currency: 'GBP', kind, repaymentBucketIds: [] });
/** @param {string} accountId @param {string} from @param {string} to */
const batch = (accountId, from, to) => ({
  id: `b${++seq}`, importId: `i${seq}`, accountId, fileName: 'x.csv', fileHash: `h${seq}`,
  importedAt: '2026-11-04T00:00:00Z', rowCount: 1, coversFrom: from, coversTo: to,
});
/** @param {string} id @param {string} kind @param {string} [budgetType] */
const cat = (id, kind, budgetType) => ({ id, name: id, kind, ...(budgetType ? { budgetType } : {}), position: 0 });
/** @param {string} id @param {string} [categoryId] */
const bucket = (id, categoryId) => ({ id, keys: [id], displayName: id, exampleRawTexts: [], ...(categoryId ? { categoryId } : {}) });
/** @param {string} accountId @param {string} date @param {number} amountMinor @param {string} bucketId */
const txn = (accountId, date, amountMinor, bucketId, currency = 'GBP') => ({
  id: `t${++seq}`, fingerprint: `f${seq}`, accountId, batchId: 'b', date, amountMinor, currency,
  rawText: bucketId, bucketId,
});

/** @param {{accounts?:any[],batches?:any[],categories?:any[],buckets?:any[],transactions?:any[],overrides?:any[],transferPairs?:any[]}} p */
function build({ accounts = [], batches = [], categories = [], buckets = [], transactions = [], overrides = [], transferPairs = [] }) {
  const s = emptyState();
  applyToState(s, { put: { accounts, batches, categories, buckets, transactions, overrides, transferPairs } });
  return /** @type {any} */ (s);
}

/**
 * A confirmed pair: `amountMinor` leaves `from` and arrives in `to` the next day.
 * @param {string} from @param {string} to @param {string} date @param {number} amountMinor @param {string} bucketId
 */
function pair(from, to, date, amountMinor, bucketId) {
  const out = txn(from, date, -amountMinor, bucketId);
  const into = txn(to, addDays(date, 1), amountMinor, bucketId);
  const [a, b] = [out.fingerprint, into.fingerprint].sort();
  return { txns: [out, into], link: { key: `${a}\n${b}`, fingerprintA: a, fingerprintB: b, status: 'confirmed' } };
}

const t1 = txn('A', '2026-01-05', -1000, 'trainline');
const t2 = txn('A', '2026-03-05', -2000, 'trainline');
const t3 = txn('B', '2026-02-15', -5000, 'hotel');
const t4 = txn('A', '2026-02-20', 7000, 'employer');
const t5 = txn('A', '2026-01-10', -300, 'cafe');
const t6 = txn('A', '2026-01-12', -400, 'trainline');
const t7 = txn('A', '2026-03-10', -1000, 'cafe');
const t8 = txn('A', '2026-04-02', -500, 'trainline');
const t9 = txn('A', '2026-03-01', -800, 'repay');
const repayment = pair('A', 'B', '2026-02-01', 1500, 'repay');

/** The shared state, with or without `t9`, and with any extra transactions. */
const state = ({ withT9 = true, extra = /** @type {any[]} */ ([]) } = {}) => build({
  accounts: [acct('A'), acct('B', 'card')],
  batches: [batch('A', '2026-01-01', '2026-03-31'), batch('B', '2026-02-10', '2026-03-31')],
  categories: [cat('work', 'ignore'), cat('other', 'spend', 'variable'), cat('xfer', 'transfer'), cat('empty', 'spend', 'variable')],
  buckets: [bucket('trainline', 'work'), bucket('hotel', 'work'), bucket('employer', 'work'), bucket('cafe', 'other'), bucket('repay', 'xfer')],
  transactions: [t1, t2, t3, t4, t5, t6, t7, t8, ...(withT9 ? [t9] : []), ...repayment.txns, ...extra],
  overrides: [
    { fingerprint: t5.fingerprint, categoryId: 'work' },
    { fingerprint: t6.fingerprint, categoryId: 'other' },
    { fingerprint: t7.fingerprint, splits: [{ amountMinor: -600, categoryId: 'work' }, { amountMinor: -400, categoryId: 'other' }] },
  ],
  transferPairs: [repayment.link],
});
const S = state();
const withoutT9 = state({ withT9: false });

/** @param {any} c */
const contents = (c) => /** @type {any} */ (c);

test('categoryContents: an Ignore category with overrides, a split and a transaction outside coverage', () => {
  const c = contents(categoryContents(S, tuning, 'work'));
  assert.equal(c.currency, 'GBP');
  assert.equal(c.count, 7);
  assert.equal(c.out, 9400);
  assert.equal(c.in, 7000);
  assert.equal(c.from, '2026-01');
  assert.equal(c.to, '2026-04');
  assert.deepEqual(c.months, ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.deepEqual(c.accounts.map((/** @type {any} */ a) => [a.accountId, a.out, a.in]), [['A', 4400, 7000], ['B', 5000, 0]]);
  assert.deepEqual(c.accounts[0].cells, [
    { month: '2026-01', total: -1300, partial: false }, { month: '2026-02', total: 7000, partial: false },
    { month: '2026-03', total: -2600, partial: false }, { month: '2026-04', total: -500, partial: true }]);
  assert.deepEqual(c.accounts[1].cells, [
    { month: '2026-01', total: null, partial: false }, { month: '2026-02', total: -5000, partial: true },
    { month: '2026-03', total: 0, partial: false }, { month: '2026-04', total: null, partial: false }]);
  assert.deepEqual(c.buckets, [
    { bucketId: 'employer', count: 1, total: 7000, latestDate: '2026-02-20', moved: 0 },
    { bucketId: 'hotel', count: 1, total: -5000, latestDate: '2026-02-15', moved: 0 },
    { bucketId: 'trainline', count: 3, total: -3500, latestDate: '2026-04-02', moved: 0 },
    { bucketId: 'cafe', count: 2, total: -900, latestDate: '2026-03-10', moved: 2 }]);
  assert.equal(c.partMinor.get(t7.id), -600);
  assert.equal(c.transactionIds.has(t6.id), false);
});

test('categoryContents: cells, bucket totals and in minus out all add up to the same net', () => {
  for (const id of ['work', 'other']) {
    const c = contents(categoryContents(S, tuning, id));
    const net = c.in - c.out;
    const cells = c.accounts.flatMap((/** @type {any} */ a) => a.cells).reduce((s, /** @type {any} */ x) => s + (x.total ?? 0), 0);
    const buckets = c.buckets.reduce((s, /** @type {any} */ b) => s + b.total, 0);
    const parts = [...c.partMinor.values()].reduce((s, v) => s + v, 0);
    assert.equal(cells, net, `${id} cells`);
    assert.equal(buckets, net, `${id} buckets`);
    assert.equal(parts, net, `${id} parts`);
    assert.equal(c.partMinor.size, c.transactionIds.size, `${id} every id has a part`);
  }
});

test('categoryContents: a split part elsewhere counts there; an override out counts there', () => {
  const o = contents(categoryContents(S, tuning, 'other'));
  assert.equal(o.count, 2);
  assert.equal(o.out, 800);
  assert.deepEqual(o.buckets.map((/** @type {any} */ b) => [b.bucketId, b.total, b.moved]), [['cafe', -400, 0], ['trainline', -400, 1]]);
  assert.equal(o.partMinor.get(t7.id), -400);
  assert.equal(o.transactionIds.has(t5.id), false);
});

test('categoryContents: a confirmed pair is never in a category', () => {
  const x = contents(categoryContents(S, tuning, 'xfer'));
  assert.equal(x.count, 1);
  assert.equal(x.out, 800);
  assert.equal(x.in, 0);
  assert.deepEqual([...x.transactionIds], [t9.id]);
  assert.equal(categoryContents(withoutT9, tuning, 'xfer'), null);
});

test('categoryContents: an empty category is null', () => {
  assert.equal(categoryContents(S, tuning, 'empty'), null);
  assert.equal(categoryContents(S, tuning, 'no-such-category'), null);
});

test('categoryContents: mixed currencies give currency null, with counts and buckets kept', () => {
  const euro = txn('A', '2026-02-03', -900, 'trainline', 'EUR');
  const c = contents(categoryContents(state({ extra: [euro] }), tuning, 'work'));
  assert.equal(c.currency, null);
  assert.equal(c.count, 8);
  assert.equal(c.buckets.find((/** @type {any} */ b) => b.bucketId === 'trainline').count, 4);
});

test('openableCategoryIds: categories with a part, and nothing else', () => {
  assert.deepEqual([...openableCategoryIds(S)].sort(), ['other', 'work', 'xfer']);
  assert.deepEqual([...openableCategoryIds(withoutT9)].sort(), ['other', 'work']);
});
