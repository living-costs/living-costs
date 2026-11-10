// One of Remaining's parts opened from Typical month: one-offs, uncategorised or ignored. The
// buckets and transactions behind the figure, in the shared category explorer. Every figure comes
// from partContents, the same pass that makes the Typical month line.

/** @import {App} from '../main.js' */
/** @import {PartName} from '../typical.js' */
/** @import {MonthRange} from '../coverage.js' */
/** @import {CategoryContents} from '../explore.js' */
import { partContents } from '../typical.js';
import { formatMonth } from '../dates.js';
import { plural } from './form.js';
import { renderExplorer, outAndIn } from './category-explorer.js';

/** @type {Record<PartName, string>} */
export const PART_HEADINGS = { oneOffs: 'One-offs', uncategorised: 'Uncategorised', ignored: 'Ignored' };

/** @type {Record<PartName, string>} */
const LEADS = { oneOffs: 'One-off categories', uncategorised: 'Uncategorised', ignored: 'Ignore categories' };

/** @type {Record<PartName, string>} */
const NAMES = { oneOffs: 'one-offs', uncategorised: 'uncategorised', ignored: 'ignored' };

/** @type {Record<PartName, string>} */
const EMPTY = {
  oneOffs: 'Nothing is in one-offs in these months now.',
  uncategorised: 'Nothing is uncategorised in these months now.',
  ignored: 'Nothing is ignored in these months now.',
};

/**
 * The one summary line: the group, how many transactions in how many buckets, money out and in,
 * the months, and the figure the card shows.
 * @param {PartName} part
 * @param {CategoryContents} contents
 * @param {number} figure the part's typical figure, a month
 * @param {(minor: number) => string} money
 * @returns {string}
 */
export function partSummaryText(part, contents, figure, money) {
  const first = contents.months[0] ?? '';
  const last = contents.months[contents.months.length - 1] ?? '';
  const window = first === last ? formatMonth(first) : `${formatMonth(first)} to ${formatMonth(last)}`;
  const bucketCount = new Set(contents.buckets.map((b) => b.bucketId)).size;
  const counts = `${plural(contents.count, 'transaction', 'transactions')} in ${plural(bucketCount, 'bucket', 'buckets')}`;
  return `${LEADS[part]} · ${[counts, outAndIn(contents, money), window].filter(Boolean).join(', ')}. `
    + `That is ${money(figure)} a month on Typical month: each account's net out over its own months, added together.`;
}

/**
 * Render the opened part into `screen`, with Back to Typical month beside its name.
 * @param {HTMLElement} screen
 * @param {App} app
 * @param {PartName} part
 * @param {MonthRange|null} range the chosen window, as given to typicalMonth
 * @param {() => void} onBack
 * @returns {void}
 */
export function renderPartView(screen, app, part, range, onBack) {
  const found = partContents(app.store.state, app.tuning, part, range);
  renderExplorer(screen, app, {
    viewId: `part:${part}`, listKey: `part:${part}`, heading: PART_HEADINGS[part],
    backLabel: 'Back to Typical month', onBack, contents: found?.contents ?? null,
    summary: (money) => (found ? partSummaryText(part, found.contents, found.figure, money) : ''),
    emptyText: EMPTY[part],
    categoryName: NAMES[part], categoryColumn: part !== 'uncategorised',
  });
}
