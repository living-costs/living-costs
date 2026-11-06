# Typical month: choose the window, compare one month

## Why

The owner is changing their standard of living to save more. They want to look at a recent month and see whether it shows the change they intended, compared with what was typical before.

Today Typical month always uses the latest `windowMonths` (12) complete months, and shows one figure per category. A recent month can't be seen next to the typical figure. The window can't be moved, for example to end before the change began.

Success means the owner can pick a month and see, row by row and in the summary, how far it sits above or below typical, without remembering figures or switching back and forth.

## Goals

- On Typical month, choose the first and last month of the window the typical figures use. The default is unchanged: the latest `windowMonths` complete months.
- On Typical month, optionally choose one month to compare. The summary and each table then show the typical figure, that month's figure, the change, and a pair of bars.
- Both controls work independently. The compared month may fall inside or outside the window. The owner said both uses should work, and the calculation supports both.

## Non-goals

- Comparing a range of months against typical. The owner decided that comparing a range isn't useful. The range control sets the window only.
- Saving either choice. Both last while the app is open and reset on reload. There is no data version change, and nothing new goes in backups.
- Changing the window on Categorise, Buckets, progress or anywhere else. Those keep the latest `windowMonths` complete months.
- A comparison inside the opened category view. Its Each month grid already shows every month.
- Comparing one-offs. They stay in their own list for the window.
- Charts beyond the paired bars.

## Anti-goals

- The month column must reconcile. In each table, the month figures add up to the month figure in the summary, as the typical column already does. The same holds for Change. A comparison whose numbers don't add up is worse than none.
- A missing statement must never look like a saving. If an account isn't covered in the compared month, the screen says so (see Missing statements).
- No colour-only meaning. The Change text says "less", "more" or "same". Bars are decorative, as today.
- With no choices made, the screen is unchanged apart from the two control rows.

## The approved layout

The owner approved the mockup `compare-combined.html` in `.superpowers/brainstorm/` (local only). It combines option A (month and Change columns) with option B (paired bars). It is described below, in screen order.

**Window line.** As now: "Based on 8 complete months, Nov 2025 to Jun 2026". It describes whichever window is in use.

**Window control row.** "Typical from [month] to [month]", then a secondary button, "Latest 12 months", which puts the default window back. The "12" comes from `windowMonths`. *Claude's call:* the button is only shown when the window differs from the default.

**Compare control row.** "Compare with [month]". The first option is "No month", which is the default.

**Summary.** Without a compared month, unchanged. With one, it gains column headings "Typical", the month name (for example "Oct 2026"), and "Change". Every line (Income, Living costs, the contribution lines when present, Left over) gets a month figure and a change.

**Tables (Living costs, Income, Contributions).** With a compared month, the columns are Category, Type, Typical, the month name, Change, and a bar cell. Per year is hidden while comparing. Without a compared month, the tables are as today, Per year included. The Type cell is unchanged, Variable range included.

**Paired bars.** Two bars per row: solid for typical and outlined for the month, with a small key above the table ("Typical", the month name). Both bars in a table are scaled against the largest typical or month figure in that table. They stay `aria-hidden`, as today.

**Change text.** "£73 less", "£55 more", or "same" when the two are equal. It is the month figure minus the typical figure, in the category's natural direction (money out for spend, money in for income and contribution). For Left over, more is more money left over. *Claude's call:* no colour coding, and the "less" and "more" text both get the same emphasis.

**Help line.** With a compared month, under the tables: "Annual categories use the typical figure in the month too, so a yearly bill doesn't skew it."

## How the figures work

### The window

- Both window pickers list complete months only, as `completeMonths` in `src/coverage.js` defines them. *Claude's call:* every month picker on this screen lists newest first.
- *Claude's call:* a chosen window doesn't move when new statements are imported during the session. Only the default window slides forward.
- "From" can't be after "to". A single-month window is allowed.
- The window is the complete months from "from" to "to" inclusive. Each account counts only the months it covers in that range, exactly as the default window does now (decision D1). Every budget type's formula is unchanged. They already divide by each account's own covered months, so any length works.
- The "Only N complete months so far. Yearly figures are scaled to 12 months." line is shown only for the default window. *Claude's call:* a window the user chose to shorten is not "so far".
- The stale-account notices measure from the end of the chosen window, as `staleAccounts` already does.
- When there are no complete months yet (the existing "No complete months yet" case), neither control row is shown.
- *Claude's call:* if a change of data (an undo, a deleted batch) leaves the chosen window with no complete months, the window goes back to the default. If some of its months remain, the window keeps its "from" and "to", and the window line reports what is counted.
- The chosen window is kept when the owner opens a category and comes back, and when they leave the screen through the nav and come back. It resets on reload.

### The compared month

- The picker lists complete months only.
- Each counted transaction in that month is resolved exactly as `typicalMonth` resolves it: overrides, splits, transfers and uncategorised are all treated the same way. An account counts in the month only if it covers that month.
- Month figure by budget type:
  - **Fixed** and **Variable:** the category's actual net total in that month, in its natural direction. Refunds reduce spending.
  - **Annual:** the category's typical figure, not the month's total. The Change is "same".
  - **One-off:** not compared. One-offs stay in their own list.
- *Claude's call:* a category with transactions in the compared month but none in the window gets a row, with £0 typical. Without that row the month column wouldn't reconcile with the summary. Rows still sort by the typical figure, largest first.
- The summary's month figures are built the same way as the typical ones: Living costs is the sum of the Living costs month column, and so on through contributions, your share and Left over.
- The Uncategorised line stays about the window. It does not get a month figure. **Owner's decision:** the gap is accepted, because the owner expects to compare after categorising. Uncategorised money in the compared month is left out of its figures, as it is from the typical ones, with no separate notice.
- **Owner's decision:** a row that has a month figure but no transactions in the window (£0 typical) shows its category name as plain text, not a button. Opening it would show an empty view, because the category view uses the window only.
- The compared month is kept while the app is open, like the window, and resets on reload.
- *Claude's call:* if a change of data leaves the compared month no longer complete, the choice goes back to "No month".

### Missing statements

If an account that has transactions counted in the window isn't covered in the compared month, a banner says so. For example: "Oct 2026 has no complete statement for Joint account. Its spending that month isn't included." It uses the same style as the existing stale-account banners. *Claude's call:* the comparison is still shown, with the banner explaining the gap.

### The opened category view

Opening a category from a table uses the chosen window. Its explanation line, Each month cells, Fixed bucket lines and transaction list all come from that window. They must still match the row the owner clicked (the open-category anti-goal). `categoryDetail` and `typicalMonth` therefore take the same window. The compared month doesn't appear in the view.

## Constraints

- Every rule in CLAUDE.md applies: `textContent` only, no network code, integer minor units, `divRound` for rounding, and thresholds from `src/tuning.js` only.
- No new stored data and no `DATA_VERSION` change.
- Widths are set through the CSSOM, as the existing bar is, so the CSP's `style-src 'self'` still holds.
- The controls are labelled `<select>`s and a `<button>`, keyboard reachable, and pass the existing axe checks.

## Changes to CLAUDE.md

1. **Scope, In scope:** add "Typical month: choose the window's first and last month, and compare one month against it".
2. **`windowMonths`:** it becomes the default window, not a fixed one. Update its comment in `src/tuning.js` to "typical month: default window, the latest N complete months".

## Left to the builder

- How `analysisWindow` (or a new function beside it) takes a chosen range, and how `typicalMonth` and `categoryDetail` take the window and the compared month. One pass over the transactions, or two, as long as the anti-goals hold.
- Where the unsaved screen state lives. The existing `ui` object in `src/ui/typical.js` is the likely place.
- Focus after changing a control. The redraw should keep focus on the control that changed.
- CSS for the paired bars and the wider summary grid, in `styles.css`.

## Verification

- Unit tests (`node:test`) on synthetic fixtures:
  - A custom window counts only its months, per account. A single-month window works. "From" after "to" is impossible.
  - The month figures for Fixed and Variable are that month's net totals. Annual uses the typical figure.
  - Totals reconcile: each table's month column sums to the summary's month figure, and Change matches month minus typical on every line.
  - A category with transactions only in the compared month appears, with £0 typical, and its name is not a button.
  - An account not covered in the compared month is reported.
  - `categoryDetail` with a custom window matches the row `typicalMonth` gives for it.
- e2e (Playwright with axe): set a window, compare a month, check the column headings and one row's figures. Open a category and go back, and check the choices are kept. Reset with "Latest 12 months".
- `npm run check` passes.
