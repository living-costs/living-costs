// Each month: one grid of month cells, a row per account, shared by the opened category on
// Typical month and the categorise card. A covered month is a toggle button; the caller keeps
// which one is pressed and what pressing it shows.

/** @import {MonthCell} from '../typical.js' */
import { h } from '../dom.js';
import { formatMonth } from '../dates.js';

/** @typedef {{month: string, accountId: string}} PressedMonth */

/**
 * The section's grid. With several accounts, each account's cells follow a label from `label`.
 * Ids and focus keys start with `prefix`; the cells of a single account are labelled by the
 * section heading, whose id is `${prefix}-each-month`.
 * @param {{prefix: string, series: {accountId: string, cells: MonthCell[]}[], label: (accountId: string) => string,
 *   money: (minor: number) => string, pressed: PressedMonth|null, onToggle: (next: PressedMonth|null) => void}} o
 * @returns {HTMLElement}
 */
export function monthGrid(o) {
  const several = o.series.length > 1;
  // One grid for every account, so a month's cells line up down the page. Every account has a
  // cell for each month in the window; the CSS reads the column count from data-months.
  return h('div', { class: 'month-grid', 'data-months': String(o.series[0]?.cells.length ?? 0) },
    ...o.series.flatMap((a) => {
      const labelId = several ? `${o.prefix}-account-${a.accountId}` : `${o.prefix}-each-month`;
      const cells = h('div', { class: 'month-cells', role: 'group', 'aria-labelledby': labelId }, ...a.cells.map((c) => {
        if (c.total === null) return h('span', { class: 'muted uncovered' }, formatMonth(c.month), h('br'), 'not covered');
        const on = o.pressed?.month === c.month && o.pressed.accountId === a.accountId;
        return h('button', {
          type: 'button', class: c.unusual ? 'secondary unusual' : 'secondary', 'aria-pressed': String(on),
          'data-focus-key': `${o.prefix}-month-${a.accountId}-${c.month}`,
          onClick: () => o.onToggle(on ? null : { month: c.month, accountId: a.accountId }),
        }, formatMonth(c.month), h('br'), o.money(c.total), c.unusual ? h('span', { class: 'visually-hidden' }, ', unusual') : null);
      }));
      if (!several) return [cells];
      return [h('p', { id: labelId, class: 'account-share' }, o.label(a.accountId)), cells];
    }));
}
