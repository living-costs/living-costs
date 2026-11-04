// The six main synthetic fixture files loaded and set up as a user would: imported through the
// pipeline, buckets categorised as `expected.intendedCategories` says, two amount rules on
// PAYPAL PAYMENT, OTHER CARD PLC marked as a placeholder card, and every suggested pair confirmed.
// The re-export file is not loaded.
import { emptyState, applyToState, combine } from '../../../src/changes.js';
import { seedDefaults } from '../../../src/categories.js';
import DEFAULTS from '../../../src/default-categories.js';
import { setBucketCategory } from '../../../src/buckets.js';
import { createAmountRule } from '../../../src/rules.js';
import { suggestPairs, decidePair, markPlaceholder } from '../../../src/transfers.js';
import { monthOf, monthStart, monthEnd } from '../../../src/dates.js';
import tuning from '../../../src/tuning.js';
import {
  expected, BANK_A, SAVINGS, CARD, BANK_B, pick, accountA, accountS, accountC, accountB, run,
} from '../pipeline.js';

const OTHER_CARD = 'OTHER CARD PLC';
const PAYPAL = 'PAYPAL PAYMENT';

/**
 * Covered period: the whole months spanning the file's rows. For A, S and C that is the full year
 * (Nov 2025 to Oct 2026); for each Bank B file it is the "Whole month" choice.
 * @param {{coversFrom:string,coversTo:string,wholeMonth?:string}} f
 */
export function wholeMonths(f) {
  if (f.wholeMonth) return { coversFrom: monthStart(f.wholeMonth), coversTo: monthEnd(f.wholeMonth) };
  return { coversFrom: monthStart(monthOf(f.coversFrom)), coversTo: monthEnd(monthOf(f.coversTo)) };
}

/** @param {any} state @param {string} key */
function bucketByKey(state, key) {
  const b = state.buckets.find((x) => x.keys.includes(key));
  if (!b) throw new Error(`No bucket with key ${key}`);
  return b;
}

/** @param {any} state @param {string} name */
function categoryByName(state, name) {
  const c = state.categories.find((x) => x.name === name);
  if (!c) throw new Error(`No category named ${name}`);
  return c;
}

/** @returns {Promise<any>} State */
export async function fixtureState() {
  const state = emptyState();
  applyToState(state, seedDefaults(DEFAULTS, state));

  for (const [account, names] of [[accountA(), [BANK_A]], [accountS(), [SAVINGS]], [accountC(), [CARD]], [accountB(), BANK_B]]) {
    const { changes } = await run(state, account, names.map((n) => pick(n)), () => 'both', wholeMonths);
    applyToState(state, changes);
  }

  applyToState(state, markPlaceholder(state, {
    bucketId: bucketByKey(state, OTHER_CARD).id, cardName: 'Other Card', currency: 'GBP',
  }));
  for (const [key, name] of Object.entries(expected.intendedCategories)) {
    if (key === OTHER_CARD) continue;
    applyToState(state, setBucketCategory(state, bucketByKey(state, key).id, categoryByName(state, name).id));
  }

  const subscriptions = categoryByName(state, 'Subscriptions').id;
  for (const [amountMinor, displayName] of [[-299, 'Google One storage'], [-999, 'Streaming']]) {
    const made = createAmountRule(state, {
      sourceBucketId: bucketByKey(state, PAYPAL).id, amountMinor: Number(amountMinor),
      expected: { count: 1, period: 'month' }, displayName: String(displayName),
    });
    applyToState(state, made);
    applyToState(state, setBucketCategory(state, made.put.rules[0].bucketId, subscriptions));
  }

  const pairs = suggestPairs(state, tuning);
  applyToState(state, combine(...pairs.map((p) => decidePair(p.a, p.b, 'confirmed'))));
  return state;
}
