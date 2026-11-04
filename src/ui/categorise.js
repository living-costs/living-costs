// Categorise screen: progress by value, then one card per bucket, largest first. The card offers
// every category as a button (number keys for the first ten), and shows related buckets, unusual
// amounts, repeating amounts and flagged rows for this bucket.

/** @import {App} from '../main.js' */
/** @import {Bucket, Category, Transaction, Changes} from '../types.js' */
/** @import {BucketCount} from '../progress.js' */
import { h } from '../dom.js';
import { analysisWindow } from '../coverage.js';
import { bucketCounts, cardQueue, progress } from '../progress.js';
import { relatedBuckets, unusualTransactions, repeatingAmounts } from '../insights.js';
import { createAmountRule, resolveFlag } from '../rules.js';
import { mergeBuckets, setBucketCategory } from '../buckets.js';
import { orderedCategories } from '../categories.js';
import { setCategoryOverride, dismissUnusual } from '../overrides.js';
import { combine } from '../changes.js';
import { formatMoney, divRound } from '../money.js';
import { formatDate } from '../dates.js';
import { whileSaving } from './saving.js';
import { focusKey, plural, valueOf, field, emptyDraft, categoryForm } from './form.js';

/**
 * Apply the Changes that `build` returns (built when the save starts), one save at a time. `after`
 * runs only once the save is accepted, so form input survives a failed or skipped save.
 * @typedef {(build: () => Changes, after?: () => void) => void} Save
 */

const PERIOD_ADVERB = { week: 'weekly', month: 'monthly', year: 'yearly' };

/**
 * Card state that is not saved: which inline form is showing, its values and any error.
 * It survives redraws, and resets when the card moves to another bucket.
 */
const ui = {
  /** @type {string|null} */
  bucketId: null,
  newOpen: false,
  draft: emptyDraft(),
  newError: '',
  /** @type {string|null} transaction id */
  moveId: null,
  moveTarget: '',
  moveError: '',
  /** @type {number|null} amountMinor */
  repeatAmount: null,
  repeatName: '',
  repeatCount: '1',
  /** @type {{field: 'name'|'count', message: string}|null} */
  repeatError: null,
};

/** @param {string} bucketId */
function resetUi(bucketId) {
  Object.assign(ui, {
    bucketId, newOpen: false, draft: emptyDraft(), newError: '',
    moveId: null, moveTarget: '', moveError: '', repeatAmount: null, repeatName: '', repeatCount: '1', repeatError: null,
  });
}

/**
 * The one currency of some transactions, or null when there are none or several.
 * @param {Transaction[]} txns
 * @returns {string|null}
 */
function soleCurrency(txns) {
  const set = new Set(txns.map((t) => t.currency));
  return set.size === 1 ? [...set][0] : null;
}

/**
 * @param {Transaction} t
 * @returns {string}
 */
const absMoney = (t) => formatMoney(Math.abs(t.amountMinor), t.currency);

/**
 * @param {HTMLElement} root
 * @param {App} app
 * @returns {void}
 */
export function render(root, app) {
  const state = app.store.state;
  root.append(h('h2', { tabindex: '-1' }, 'Categorise'));
  if (state.transactions.length === 0) {
    root.append(
      h('p', null, 'Nothing to categorise yet. Add your statements on the Accounts screen first.'),
      h('div', { class: 'actions' }, h('button', { type: 'button', onClick: () => app.navigate('accounts') }, 'Go to Accounts')));
    return;
  }
  const counts = bucketCounts(state, app.tuning);
  root.append(progressLine(app, counts));

  const queue = cardQueue(state, app.tuning, app.session.skipped);
  if (queue.length === 0) {
    root.append(finished(app));
    return;
  }
  // Stay on the current card while it is still in the queue, even if a change (such as making
  // an amount rule) moved it down; otherwise take the first.
  const bucket = queue.find((b) => b.id === ui.bucketId) ?? queue[0];
  if (ui.bucketId !== bucket.id) resetUi(bucket.id);
  root.append(card(app, bucket, counts));
}

/**
 * "£X of £Y categorised (Z%) · N buckets left". Amounts are left out when the counted
 * transactions use more than one currency, since they can't be added together.
 * @param {App} app
 * @param {Map<string, BucketCount>} counts
 * @returns {HTMLElement}
 */
function progressLine(app, counts) {
  const { categorisedAbs, totalAbs, bucketsLeft } = progress(app.store.state, app.tuning);
  const left = `${plural(bucketsLeft, 'bucket', 'buckets')} left`;
  const currency = soleCurrency([...counts.values()].flatMap((c) => c.txns));
  // Rounded down, so 100% means everything is categorised.
  const text = currency && totalAbs > 0
    ? `${formatMoney(categorisedAbs, currency)} of ${formatMoney(totalAbs, currency)} categorised (${Math.floor((categorisedAbs * 100) / totalAbs)}%) · ${left}`
    : left;
  return h('p', { id: 'categorise-progress' }, text);
}

/**
 * Shown when no card is left: either everything is done, or the rest was skipped.
 * @param {App} app
 * @returns {HTMLElement}
 */
function finished(app) {
  const skipped = cardQueue(app.store.state, app.tuning, new Set()).length > 0;
  if (skipped) {
    return h('div', null,
      h('p', null, 'You skipped the buckets that are left.'),
      h('div', { class: 'actions' },
        h('button', {
          type: 'button', 'data-focus-key': 'show-skipped',
          onClick: () => { app.session.skipped.clear(); app.rerender(); },
        }, 'Show skipped buckets'),
        h('button', { type: 'button', class: 'secondary', onClick: () => app.navigate('typical') }, 'Stop here')));
  }
  return h('div', null,
    h('p', null, 'Every bucket has a category.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', onClick: () => app.navigate('typical') }, 'See your typical month')));
}

/**
 * @param {App} app
 * @param {Bucket} bucket
 * @param {Map<string, BucketCount>} counts
 * @returns {HTMLElement}
 */
function card(app, bucket, counts) {
  const state = app.store.state;
  const cats = orderedCategories(state);
  const all = state.transactions.filter((t) => t.bucketId === bucket.id);

  /** @type {Save} */
  const save = (build, after) => whileSaving(el, async () => {
    await app.store.apply(build());
    if (after) {
      after();
      app.rerender();
    }
  }, el);
  /** @param {string} categoryId */
  const assign = (categoryId) => save(() => setBucketCategory(app.store.state, bucket.id, categoryId));

  const el = h('section', {
    id: 'card', class: 'card', tabindex: '0', 'aria-labelledby': 'card-heading', 'data-focus-key': 'card',
    onKeydown: (/** @type {KeyboardEvent} */ e) => {
      if (!app.tuning.firstTenKeys || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!/^[0-9]$/.test(e.key)) return;
      const c = cats[e.key === '0' ? 9 : Number(e.key) - 1];
      if (!c) return;
      e.preventDefault();
      assign(c.id);
    },
  });

  const current = bucket.categoryId ? cats.find((c) => c.id === bucket.categoryId) : undefined;
  /** @type {(HTMLElement|null)[]} */
  const children = [
    h('h3', { id: 'card-heading' }, bucket.displayName),
    h('p', { id: 'card-summary' }, summaryText(app, counts.get(bucket.id))),
    current ? h('p', null, `Category: ${current.name}`) : null,
    examples(all),
    categoryGroup(app, cats, assign),
    ui.newOpen ? newCategoryForm(app, bucket, el) : null,
    related(app, bucket, counts, save),
    unusual(app, all, cats, save),
    repeating(app, bucket, all, save),
    flagged(app, all, save),
    h('div', { class: 'actions' },
      h('button', {
        type: 'button', class: 'secondary', 'data-focus-key': 'skip',
        onClick: () => { app.session.skipped.add(bucket.id); app.rerender(); },
      }, 'Skip for now'),
      h('button', { type: 'button', class: 'secondary', onClick: () => app.navigate('typical') }, 'Stop here')),
  ];
  for (const child of children) if (child) el.append(child);
  return el;
}

/**
 * "£X over N months · M transactions · about £Y a month", from the counted transactions.
 * @param {App} app
 * @param {BucketCount|undefined} count
 * @returns {string}
 */
function summaryText(app, count) {
  if (!count) return 'None of its transactions fall in the months being counted.';
  const n = analysisWindow(app.store.state, app.tuning).months.length;
  const months = `over ${plural(n, 'month', 'months')}`;
  const txns = plural(count.txns.length, 'transaction', 'transactions');
  const currency = soleCurrency(count.txns);
  if (!currency) return `${txns} ${months}`;
  const monthly = n > 0 ? ` · about ${formatMoney(divRound(count.absTotal, n), currency)} a month` : '';
  return `${formatMoney(count.absTotal, currency)} ${months} · ${txns}${monthly}`;
}

/**
 * Up to three of the bucket's rows, newest first, preferring different raw texts.
 * @param {Transaction[]} all
 * @returns {HTMLElement}
 */
function examples(all) {
  const newest = [...all].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const seen = new Set();
  const distinct = newest.filter((t) => !seen.has(t.rawText) && seen.add(t.rawText));
  const picked = [...distinct, ...newest.filter((t) => !distinct.includes(t))].slice(0, 3);
  return h('ul', { class: 'plain-list', 'aria-label': 'Example transactions' },
    ...picked.map((t) => h('li', null,
      `${formatDate(t.date)} · `, h('span', { class: 'raw' }, t.rawText), ` · ${absMoney(t)}`)));
}

/**
 * One button per category, in order, with number keys for the first ten; then New category….
 * @param {App} app
 * @param {Category[]} cats
 * @param {(categoryId: string) => void} assign
 * @returns {HTMLElement}
 */
function categoryGroup(app, cats, assign) {
  return h('div', null,
    h('h4', { id: 'card-categories' }, 'Category'),
    h('div', { role: 'group', 'aria-labelledby': 'card-categories', class: 'category-buttons' },
      ...cats.map((c, i) => {
        const key = app.tuning.firstTenKeys && i < 10 ? String((i + 1) % 10) : null;
        return h('button', {
          type: 'button', class: 'secondary', 'data-saves': true, 'data-focus-key': `cat-${c.id}`,
          'aria-keyshortcuts': key, onClick: () => assign(c.id),
        }, key ? h('span', { class: 'key' }, key) : null, key ? ' ' : null, c.name);
      }),
      h('button', {
        type: 'button', class: 'secondary', 'data-focus-key': 'card-new', 'aria-expanded': ui.newOpen ? 'true' : 'false',
        onClick: () => {
          ui.newOpen = !ui.newOpen;
          app.rerender();
          if (ui.newOpen) focusKey('card-new-name');
        },
      }, 'New category…')));
}

/**
 * Create a category and put this bucket in it, in one save.
 * @param {App} app
 * @param {Bucket} bucket
 * @param {HTMLElement} el the card
 * @returns {HTMLElement}
 */
function newCategoryForm(app, bucket, el) {
  const cancel = () => {
    ui.newOpen = false;
    ui.newError = '';
    app.rerender();
    focusKey('card-new');
  };
  return categoryForm(app, {
    draft: ui.draft, error: ui.newError, keyPrefix: 'card-new', submitLabel: 'Add and use',
    formProps: { class: 'card-form', 'aria-label': 'New category' },
    buttons: [h('button', { type: 'button', class: 'secondary', onClick: cancel }, 'Cancel')],
    scope: el, focusTo: el,
    setError: (message) => { ui.newError = message; },
    save: async (changes, category) => {
      await app.store.apply(combine(changes, setBucketCategory(app.store.state, bucket.id, category.id)));
      Object.assign(ui, { newOpen: false, draft: emptyDraft(), newError: '' });
      app.rerender();
    },
  });
}

/**
 * A titled part of the card, or null when it has nothing to show.
 * @param {string} id
 * @param {string} title
 * @param {HTMLElement[]} items list items
 * @returns {HTMLElement|null}
 */
function part(id, title, items) {
  if (items.length === 0) return null;
  return h('section', { 'aria-labelledby': id },
    h('h4', { id }, title),
    h('ul', { class: 'plain-list' }, ...items));
}

/**
 * Looks related: other buckets sharing a whole word, each with Merge into this.
 * @param {App} app
 * @param {Bucket} bucket
 * @param {Map<string, BucketCount>} counts
 * @param {Save} save
 * @returns {HTMLElement|null}
 */
function related(app, bucket, counts, save) {
  const state = app.store.state;
  const absTotals = new Map([...counts].map(([id, c]) => [id, c.absTotal]));
  const list = relatedBuckets(bucket, state.buckets, absTotals, app.tuning);
  return part('card-related', 'Looks related', list.map((other) => {
    const id = `related-${other.id}`;
    const count = counts.get(other.id);
    const currency = count ? soleCurrency(count.txns) : null;
    const category = state.categories.find((c) => c.id === other.categoryId)?.name ?? 'Uncategorised';
    const text = [other.displayName, count && currency ? formatMoney(count.absTotal, currency) : '', category]
      .filter(Boolean).join(' · ');
    return h('li', null,
      h('span', { id }, text),
      h('div', { class: 'row-actions' }, h('button', {
        type: 'button', class: 'secondary', 'aria-describedby': id, 'data-saves': true, 'data-focus-key': `merge-${other.id}`,
        onClick: () => save(() => {
          const now = app.store.state;
          const me = now.buckets.find((b) => b.id === bucket.id) ?? bucket;
          const them = now.buckets.find((b) => b.id === other.id) ?? other;
          return mergeBuckets(now, me.id, [them.id], { displayName: me.displayName, categoryId: me.categoryId ?? them.categoryId });
        }),
      }, 'Merge into this')));
  }));
}

/**
 * Unusual amounts, each with Move to another category… and It's normal.
 * @param {App} app
 * @param {Transaction[]} all the whole bucket
 * @param {Category[]} cats
 * @param {Save} save
 * @returns {HTMLElement|null}
 */
function unusual(app, all, cats, save) {
  const list = unusualTransactions(all, app.store.state.overrides, app.tuning);
  return part('card-unusual', 'Unusual amounts', list.map((t) => {
    const id = `unusual-${t.id}`;
    const item = h('li', null,
      h('span', { id }, `${formatDate(t.date)} · `, h('span', { class: 'raw' }, t.rawText), ` · ${absMoney(t)}`),
      h('div', { class: 'row-actions' },
        h('button', {
          type: 'button', class: 'secondary', 'aria-describedby': id, 'data-focus-key': `move-${t.id}`,
          'aria-expanded': ui.moveId === t.id ? 'true' : 'false',
          onClick: () => {
            Object.assign(ui, { moveId: ui.moveId === t.id ? null : t.id, moveTarget: '', moveError: '' });
            app.rerender();
            if (ui.moveId) focusKey(`move-target-${t.id}`);
          },
        }, 'Move to another category…'),
        h('button', {
          type: 'button', class: 'secondary', 'aria-describedby': id, 'data-saves': true, 'data-focus-key': `normal-${t.id}`,
          onClick: () => save(() => dismissUnusual(app.store.state, t.fingerprint)),
        }, "It's normal")));
    if (ui.moveId === t.id) item.append(moveForm(app, t, cats, save));
    return item;
  }));
}

/**
 * Pick a category for one transaction.
 * @param {App} app
 * @param {Transaction} t
 * @param {Category[]} cats
 * @param {Save} save
 * @returns {HTMLElement}
 */
function moveForm(app, t, cats, save) {
  return h('form', {
    class: 'inline-form', novalidate: true,
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      if (!cats.some((c) => c.id === ui.moveTarget)) {
        ui.moveError = 'Choose a category.';
        app.rerender();
        focusKey(`move-target-${t.id}`);
        return;
      }
      const target = ui.moveTarget;
      save(() => setCategoryOverride(app.store.state, t.fingerprint, target),
        () => Object.assign(ui, { moveId: null, moveTarget: '', moveError: '' }));
    },
  },
  field('Move to', h('select', {
    'data-focus-key': `move-target-${t.id}`,
    onChange: (/** @type {Event} */ e) => { ui.moveTarget = valueOf(e); },
  },
  h('option', { value: '', selected: ui.moveTarget === '' }, 'Choose a category'),
  ...cats.map((c) => h('option', { value: c.id, selected: c.id === ui.moveTarget }, c.name))), { error: ui.moveError }),
  h('div', { class: 'row-actions' },
    h('button', { type: 'submit', 'data-saves': true }, 'Move'),
    h('button', {
      type: 'button', class: 'secondary',
      onClick: () => {
        Object.assign(ui, { moveId: null, moveError: '' });
        app.rerender();
        focusKey(`move-${t.id}`);
      },
    }, 'Cancel')));
}

/**
 * Repeating amounts, each with Make this its own bucket.
 * @param {App} app
 * @param {Bucket} bucket
 * @param {Transaction[]} all the whole bucket
 * @param {Save} save
 * @returns {HTMLElement|null}
 */
function repeating(app, bucket, all, save) {
  const list = repeatingAmounts(all, app.tuning);
  return part('card-repeating', 'Repeating amounts', list.map((r) => {
    const id = `repeating-${bucket.id}-${r.amountMinor}`;
    const sample = /** @type {Transaction} */ (all.find((t) => t.amountMinor === r.amountMinor));
    const item = h('li', null,
      h('span', { id }, `${absMoney(sample)}, ${r.count} times, ${PERIOD_ADVERB[r.period]}`),
      h('div', { class: 'row-actions' }, h('button', {
        type: 'button', class: 'secondary', 'aria-describedby': id, 'data-focus-key': `repeat-${r.amountMinor}`,
        'aria-expanded': ui.repeatAmount === r.amountMinor ? 'true' : 'false',
        onClick: () => {
          const opening = ui.repeatAmount !== r.amountMinor;
          Object.assign(ui, { repeatAmount: opening ? r.amountMinor : null, repeatName: '', repeatCount: '1', repeatError: null });
          app.rerender();
          if (opening) focusKey('repeat-name');
        },
      }, 'Make this its own bucket')));
    if (ui.repeatAmount === r.amountMinor) item.append(repeatForm(app, bucket, r, save));
    return item;
  }));
}

/**
 * Name the new bucket and say how often the amount is expected, then create the amount rule.
 * @param {App} app
 * @param {Bucket} bucket
 * @param {{amountMinor:number, period:'week'|'month'|'year'}} r
 * @param {Save} save
 * @returns {HTMLElement}
 */
function repeatForm(app, bucket, r, save) {
  /**
   * @param {'name'|'count'} which
   * @param {string} message
   */
  const fail = (which, message) => {
    ui.repeatError = { field: which, message };
    app.rerender();
    focusKey(`repeat-${which}`);
  };
  const errorFor = (/** @type {'name'|'count'} */ which) => (ui.repeatError?.field === which ? ui.repeatError.message : '');
  return h('form', {
    class: 'card-form', novalidate: true, 'aria-label': 'Make this its own bucket',
    onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      const displayName = ui.repeatName.trim();
      if (!displayName) return fail('name', 'Enter a bucket name.');
      const text = ui.repeatCount.trim();
      const count = /^\d+$/.test(text) ? Number(text) : 0;
      if (!(count >= 1 && Number.isSafeInteger(count))) return fail('count', 'Enter a whole number, 1 or more.');
      save(() => createAmountRule(app.store.state, {
        sourceBucketId: bucket.id, amountMinor: r.amountMinor, expected: { count, period: r.period }, displayName,
      }), () => Object.assign(ui, { repeatAmount: null, repeatName: '', repeatCount: '1', repeatError: null }));
    },
  },
  field('Bucket name', h('input', {
    type: 'text', value: ui.repeatName, autocomplete: 'off', 'data-focus-key': 'repeat-name',
    onInput: (/** @type {Event} */ e) => { ui.repeatName = valueOf(e); },
  }), { error: errorFor('name') }),
  field(`Times per ${r.period}`, h('input', {
    type: 'text', class: 'short', inputmode: 'numeric', value: ui.repeatCount, autocomplete: 'off', 'data-focus-key': 'repeat-count',
    onInput: (/** @type {Event} */ e) => { ui.repeatCount = valueOf(e); },
  }), { error: errorFor('count') }),
  h('div', { class: 'row-actions' },
    h('button', { type: 'submit', 'data-saves': true }, 'Make bucket'),
    h('button', {
      type: 'button', class: 'secondary',
      onClick: () => {
        Object.assign(ui, { repeatAmount: null, repeatError: null });
        app.rerender();
        focusKey(`repeat-${r.amountMinor}`);
      },
    }, 'Cancel')));
}

/**
 * Rows an amount rule flagged as extra, each with It belongs there and Keep it here.
 * @param {App} app
 * @param {Transaction[]} all the whole bucket
 * @param {Save} save
 * @returns {HTMLElement|null}
 */
function flagged(app, all, save) {
  const state = app.store.state;
  const list = all.filter((t) => t.flaggedRuleId)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return part('card-flagged', 'Flagged', list.map((t) => {
    const id = `flagged-${t.id}`;
    const rule = state.rules.find((r) => r.id === t.flaggedRuleId);
    const target = rule ? state.buckets.find((b) => b.id === rule.bucketId)?.displayName : undefined;
    const had = rule && rule.expected.count > 1 ? `${rule.expected.count} payments` : 'a payment';
    const reason = `Matched ${target ?? 'an amount rule'}, but it already had ${had} this ${rule?.expected.period ?? 'month'}.`;
    return h('li', null,
      h('div', { id },
        h('span', null, `${formatDate(t.date)} · `, h('span', { class: 'raw' }, t.rawText), ` · ${absMoney(t)}`),
        h('p', null, reason)),
      h('div', { class: 'row-actions' },
        h('button', {
          type: 'button', class: 'secondary', 'aria-describedby': id, 'data-saves': true, 'data-focus-key': `flag-rule-${t.id}`,
          onClick: () => save(() => resolveFlag(app.store.state, t.fingerprint, 'rule')),
        }, 'It belongs there'),
        h('button', {
          type: 'button', class: 'secondary', 'aria-describedby': id, 'data-saves': true, 'data-focus-key': `flag-source-${t.id}`,
          onClick: () => save(() => resolveFlag(app.store.state, t.fingerprint, 'source')),
        }, 'Keep it here')));
  }));
}
