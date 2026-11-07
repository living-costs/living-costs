// Categorise screen: progress by value, then one card per bucket, largest first. The card offers
// every category as a button (number keys for the first ten), and shows related buckets, unusual
// amounts, repeating amounts and flagged rows for this bucket.

/** @import {App} from '../main.js' */
/** @import {Bucket, Category, Transaction, Changes} from '../types.js' */
/** @import {BucketCount} from '../progress.js' */
/** @import {PressedMonth} from './month-grid.js' */
/** @typedef {ReturnType<typeof bucketMonths>} BucketMonths */
import { h } from '../dom.js';
import { bucketCounts, cardQueue, progress, percentDone, monthlyFigure, bucketMonths } from '../progress.js';
import { relatedBuckets, unusualTransactions, repeatingAmounts } from '../insights.js';
import { createAmountRule, resolveFlag } from '../rules.js';
import { mergeBuckets, setBucketCategory } from '../buckets.js';
import { orderedCategories, sortedCategories } from '../categories.js';
import { setCategoryOverride, dismissUnusual } from '../overrides.js';
import { combine } from '../changes.js';
import { formatMoney, soleCurrency } from '../money.js';
import { cmp } from '../order.js';
import { formatDate, monthOf } from '../dates.js';
import { whileSaving } from './saving.js';
import { monthGrid } from './month-grid.js';
import { renderTransactionList } from './transactions.js';
import { suggestCategory } from '../suggest.js';
import { focusKey, plural, valueOf, field, emptyDraft, categoryForm, categoryHint } from './form.js';

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
  /** @type {PressedMonth|null} the Each month cell pressed, if any */
  month: null,
};

/** @param {string} bucketId */
function resetUi(bucketId) {
  Object.assign(ui, {
    bucketId, month: null, newOpen: false, draft: emptyDraft(), newError: '',
    moveId: null, moveTarget: '', moveError: '', repeatAmount: null, repeatName: '', repeatCount: '1', repeatError: null,
  });
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
  root.append(h('h2', { tabindex: '-1', class: 'visually-hidden' }, 'Categorise'));
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
  // The nav's Categorise tab shows the same percent, under the same conditions (categorisedPercent).
  const text = currency && totalAbs > 0
    ? `${formatMoney(categorisedAbs, currency)} of ${formatMoney(totalAbs, currency)} categorised (${percentDone(categorisedAbs, totalAbs)}%) · ${left}`
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

  const suggested = suggestCategory(state, bucket);

  const el = h('section', {
    id: 'card', class: 'card', tabindex: '0', 'aria-labelledby': 'card-heading', 'data-focus-key': 'card',
    onKeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Enter' && e.target === el && suggested && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        assign(suggested.id);
        return;
      }
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
  const count = counts.get(bucket.id);
  const months = count ? bucketMonths(state, app.tuning, count) : undefined;
  /** @type {(HTMLElement|null)[]} */
  const children = [
    h('h3', { id: 'card-heading' }, bucket.displayName),
    h('p', { id: 'card-summary' }, summaryText(count, months)),
    count && months ? eachMonth(app, bucket, count, months) : null,
    current ? h('p', null, `Category: ${current.name}`) : null,
    examples(all),
    categoryGroup(app, cats, assign, suggested),
    ui.newOpen ? newCategoryForm(app, bucket, el) : null,
    related(app, bucket, counts, save),
    unusual(app, all, sortedCategories(state), save),
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
 * "£X over N months · M transactions · about £Y a month", from the counted transactions not
 * moved to another category. Each account counts over its own months (D1), so "over N months" is
 * left out when the bucket's accounts count different numbers of months.
 * @param {BucketCount|undefined} count
 * @param {BucketMonths|undefined} months
 * @returns {string}
 */
function summaryText(count, months) {
  if (!count || !months) return 'None of its transactions fall in the months being counted.';
  const kept = months.kept;
  if (!kept) return 'Every one of its transactions in the months being counted is moved to another category.';
  const { perMonth, months: n } = monthlyFigure(kept, months.accountMonths);
  const over = n === null ? '' : ` over ${plural(n, 'month', 'months')}`;
  const txns = plural(kept.txns.length, 'transaction', 'transactions');
  const currency = soleCurrency(kept.txns);
  if (!currency) return `${txns}${over}`;
  const monthly = n !== 0 ? ` · about ${formatMoney(perMonth, currency)} a month` : '';
  return `${formatMoney(kept.absTotal, currency)}${over} · ${txns}${monthly}`;
}

/**
 * Each month: the bucket's monthly totals, without transactions moved to another category.
 * Pressing a month lists its transactions, moved ones included, each with Counts as. Amounts are
 * shown only when the bucket's counted transactions share one currency.
 * @param {App} app
 * @param {Bucket} bucket
 * @param {BucketCount} count
 * @param {BucketMonths} months
 * @returns {HTMLElement|null}
 */
function eachMonth(app, bucket, count, months) {
  const currency = soleCurrency(count.txns);
  if (!currency) return null;
  const pressed = ui.month;
  if (pressed && !months.accounts.some((a) => a.accountId === pressed.accountId
    && a.cells.some((c) => c.month === pressed.month && c.total !== null))) ui.month = null;
  const accountNames = new Map(app.store.state.accounts.map((a) => [a.id, a.name]));
  const section = h('section', { 'aria-labelledby': 'card-each-month' },
    h('h4', { id: 'card-each-month' }, 'Each month'),
    monthGrid({
      prefix: 'card', series: months.accounts, pressed: ui.month,
      money: (minor) => formatMoney(minor, currency),
      label: (accountId) => accountNames.get(accountId) ?? '',
      onToggle: (next) => { ui.month = next; app.rerender(); },
    }));
  const month = ui.month;
  if (month) {
    const ids = new Set(count.txns.filter((t) => t.accountId === month.accountId && monthOf(t.date) === month.month).map((t) => t.id));
    renderTransactionList(section, app, {
      bucketId: bucket.id,
      only: { key: `card:${bucket.id}`, ids, bucketIds: [bucket.id], categoryName: '', partMinor: new Map() },
    });
  }
  return section;
}

/**
 * Up to three of the bucket's rows, newest first, preferring different raw texts.
 * @param {Transaction[]} all
 * @returns {HTMLElement}
 */
function examples(all) {
  const newest = [...all].sort((a, b) => cmp(b.date, a.date));
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
 * @param {Category|null} suggested the category suggested from the merchant name, marked on its button
 * @returns {HTMLElement}
 */
function categoryGroup(app, cats, assign, suggested) {
  return h('div', null,
    h('h4', { id: 'card-categories' }, 'Category'),
    h('div', { role: 'group', 'aria-labelledby': 'card-categories', class: 'category-buttons' },
      ...cats.map((c, i) => {
        const key = app.tuning.firstTenKeys && i < 10 ? String((i + 1) % 10) : null;
        return h('button', {
          type: 'button', class: 'secondary', 'data-saves': true, 'data-focus-key': `cat-${c.id}`,
          'aria-keyshortcuts': key, title: categoryHint(c), 'aria-describedby': `cat-hint-${c.id}`,
          onClick: () => assign(c.id),
        }, key ? h('span', { class: 'key' }, key) : null, key ? ' ' : null, c.name,
          suggested && c.id === suggested.id ? ' ' : null,
          suggested && c.id === suggested.id ? h('span', { class: 'suggested' }, 'Suggested') : null);
      }),
      ...cats.map((c) => h('span', { class: 'visually-hidden', id: `cat-hint-${c.id}` }, categoryHint(c))),
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
 * @param {Category[]} cats in name order, for Move to
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
 * @param {Category[]} cats in name order
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
    .sort((a, b) => cmp(a.date, b.date));
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
