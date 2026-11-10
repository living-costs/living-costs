# Category explorer: open any category from the Categories screen

## Why

Typical month lets the user open a category (`src/ui/category-view.js`), but only the categories it counts: Spend, Income, Contribution and Saving with a Fixed, Variable or Annual budget type, and only when something in the chosen window counts as them. Transfer and Ignore kinds, One-off budget types, and categories with nothing in the window can't be opened anywhere. The owner's example is a new Ignore category such as Work expenses, which is being added in a separate branch and must not be added here. It never appears on Typical month, so there is no way to see what has been put in it.

The goal is to check that a category holds the right things. Budget figures are not the goal. Success means the user can open any category from the Categories screen and see, within a few seconds, its total for each month, the buckets that feed it, and the transactions themselves. They can then fix a wrong one there.

This also covers the queued follow-up "a category's buckets on the Categories screen".

## Goals

- On the Categories screen, every category with something in it can be opened by clicking its name, as on Typical month.
- The opened category shows a summary line, its total for each month across all imported data, a table of the buckets that feed it, and its transactions.
- It works the same for every kind (Spend, Income, Contribution, Saving, Transfer, Ignore) and every budget type, One-off included.
- The transaction list keeps its Counts as control, so a wrong transaction can be moved out from the view.

## Non-goals

- Budget figures: no median, typical range, per-month figure, unusual-month marks or Stopped ticks. Those stay on Typical month's view, which is unchanged.
- Opening the Uncategorised line or one-offs from Typical month. That is a separate queued task.
- A category filter on Buckets or Transactions.
- Fixing the Typical month view's bucket filter that survives Back. That is a separate queued task. This view must not have the same problem, though (see Back).
- Charts, exports, or any new data stored.

## Anti-goals

- The view must not disagree with the Counts as cells in its own list. A transaction appears in the view exactly when its Counts as shows it in this category, wholly or as part of a split. Totals are sums of exactly those transactions (or parts).
- It must not look like a budget. No figure in it should read as "what this costs you a month".

## Decided with the owner

- **Entry:** each category name on the Categories screen becomes a button, like the category names on Typical month. The approved mockup is `explorer.html` in `.superpowers/brainstorm/` (local only).
- **Months:** every month the user has statements for, not tied to Typical month's window.
- **Purpose:** checking what is in a category. The By bucket table is shown for every budget type.

## What the view shows

The view replaces the Categories screen's content, as Typical month's opened category replaces its tables.

**Heading.** The category's name as an `h3`, which takes focus on opening, and a "Back to Categories" button beside it. This is the same `view-heading` pattern as `category-view.js`.

**Summary line.** One line, for example: "Ignore · 23 transactions in 9 buckets, £1,482.10 out and £1,310.00 in, Nov 2025 to Oct 2026." The kind word uses `KIND_LABELS`. "Out" is the sum of the negative amounts (or parts) and "in" the sum of the positive ones. A side with nothing in it is left out. The months are those of the earliest and latest transaction. *Claude's call:* the budget type is shown after the kind when the kind has one ("Spend · One-off · …"), since it costs nothing and tells the user why Typical month leaves the category out.

**Each month.** The shared `monthGrid` (`src/ui/month-grid.js`), one row per account that has anything in the category, labelled by account name when there are several. The label shows that account's out and in totals, in the same form as the summary.

- The months run from the earliest to the latest month in `accountsByMonth(state, tuning).months` (`src/coverage.js`), the same span as the Accounts table, widened to take in every month that has a transaction in this category. *Claude's call:* the statement period typed at import isn't checked against the row dates, so a transaction can fall outside every account's coverage. Widening the span keeps every amount in a cell. Every account row has a cell for every month, so the columns line up.
- Cells by the account's status for that month (`accountMonthStatus`): `covered` shows the net total. `partial` shows the net total and is marked as part covered, visibly and in its accessible name. `missing` shows "not covered", as now. *Claude's call:* partial months are included, so the cells add up to the summary and to the list. Typical month leaves them out because it builds figures, and this view doesn't.
- A covered month with nothing in the category shows £0.00.
- A cell's figure is the signed net (money in minus money out). *Claude's call:* signed, not Typical month's "natural direction", because the view spans every kind, and a Transfer or Ignore category has no natural direction.
- Pressing a cell narrows the transaction list to that month and account, as in `category-view.js`. Pressing it again clears that.
- No unusual marks.

`monthGrid` currently takes cells with `total: number|null`. It needs a way to show a part-covered cell. The builder chooses how, without changing what Typical month and the categorise card draw.

**By bucket.** A table with one row per bucket that has transactions (or split parts) counting as this category, across all accounts. Columns:

| Column | Content |
|---|---|
| Bucket | The bucket's display name, as a toggle button that narrows the list to that bucket, as in `category-view.js`'s By bucket table |
| Transactions | How many of its transactions count as this category |
| Total | Signed net of those transactions (or parts) |
| Last | Date of the latest one |

Sorted by the size of the total, largest first (absolute value), then by name. This matches Buckets' ranking by total value. When some of a bucket's transactions are here only because of a per-transaction override or a split, the row says so after the name, for example "(2 moved here)". When a bucket's own category is this one but some of its transactions have been moved out, nothing extra is shown. They don't count here.

*Claude's call:* one row per bucket, not per bucket and account, since the view is about what is in the category. The Account column in the list covers the rest.

**Transactions.** The existing `renderTransactionList` with an `only` filter: the ids that count here, the Bucket options limited to this category's buckets, and `partMinor` so a split row says how much of it counts here. This is all as in `category-view.js`. Search, From, To, the result cap and Counts as work as they do now. The month cell and the By bucket toggle narrow the list as they do in Typical month's view.

## What counts as being in the category

A transaction is in the view when `resolve(t, buildContext(state))` (`src/resolve.js`) gives it at least one part with this category's id. Its amount in the view is the sum of those parts. This is exactly what its Counts as cell shows.

Consequences, to make visible in tests:

- A **confirmed transfer pair** resolves as a transfer with no category, so it is never in any category's view, even if its bucket belongs to a Transfer category. A Transfer category whose transactions are all confirmed pairs is therefore empty and can't be opened. *Owner's decision:* pairs are checked on the Transfers screen, and the view keeps to what counts as the category.
- A transaction moved in by an override counts. One moved out does not.
- A split counts only its parts in this category.
- Every account counts, including Savings accounts. Typical month's Savings special cases (pairs into a Savings account counted as saving, Saving-category rows inside a Savings account skipped) don't apply, because they are about not counting money twice in a figure.
- All of a transaction's data is used, whatever months are covered. A transaction in a month marked `missing` for its account (possible when batches have gaps) still appears in the list and the totals. The builder should show its cell's total too, rather than "not covered", when it has transactions. *Claude's call.*

The data comes from one new pure function, for example `categoryContents(state, tuning, categoryId)`. Its location is the builder's choice. It returns the summary figures, per-account month cells, bucket rows, ids and `partMinor`, and returns `null` when nothing counts as the category. It does not reuse `categoryDetail`, which is about the budget figure. It uses `resolve` and the coverage helpers, so the two views can't disagree about which transactions belong to a category.

**Currencies.** When the category's transactions are in more than one currency, the summary, month cells and bucket totals are left out and one line says "Totals need a single currency." The bucket table keeps its Transactions and Last columns. The list still shows. *Claude's call*, matching Typical month's single-currency limit without hiding the contents.

## The Categories screen

- In each row of "Your categories", the name becomes a button (`class: 'secondary name'`, as on Typical month and Buckets) when something counts as the category. A category with nothing in it stays plain text. *Claude's call:* the mockup's "(nothing in it)" note is left out unless it fits without crowding the table.
- While a row is being renamed, its name cell shows the rename form as now, not the button.
- The guide's first line gains a sentence, for example "Open a category to see what is in it."
- The New category form, the delete panel and the guide are hidden while a category is open. Only the view shows.

## Back, leaving, and edits

- **Back to Categories** returns to the table with focus on the name button of the category that was open. If it is no longer a button (now empty, or deleted), focus goes to the Categories heading.
- Back, and leaving the screen through the nav, reset the view: no category open, no month pressed, and the list's search, bucket and date filters cleared for this view's list key. The cleared filters are the difference from Typical month's view, whose bucket filter survives Back.
- **An edit that empties the category.** If a Counts as change in the view moves the last transaction out, the view stays open with its heading, Back, and the line "Nothing counts as <name> now." Focus moves to that line, as `category-view.js` does.
- **Edits elsewhere** need no handling beyond redrawing from the store. Only one tab can be open (see `one-tab.spec.js`).
- **Deleting or renaming** can't happen while the view is open, because the table is hidden. A rename shows on the next open.

## Constraints

- All CLAUDE.md rules: `textContent` only, no network code, integer minor units with currency, thresholds from `src/tuning.js`. No new thresholds are expected.
- No change to stored data, backups or `DATA_VERSION`.
- Keep `category-view.js` and `categoryDetail` unchanged, apart from any shared helper the builder extracts (for example the view heading or the empty-view focus handling). Typical month's behaviour must not change.
- The Categories screen's use count check must stay cheap. Resolving every transaction once per render is fine at this app's scale (a few thousand rows). Work out which categories can be opened in one pass, not one pass per category.

## Changes to CLAUDE.md

1. **Scope, In scope:** add "Open any category from the Categories screen to see its month totals, buckets and transactions." This is a new feature, so the owner is asked to agree to the line.

No data model change.

## Testing

- **Unit (`node:test`)** for the new data function, with synthetic state:
  - a Spend category over two accounts with different coverage: month cells per account, `covered`, `partial` and `missing` statuses, £0 for a covered empty month
  - an Ignore category and a Transfer category: both open, with signed totals and out/in sums
  - a One-off Spend category
  - an override moving a transaction in (counts, and its bucket row shows "moved here") and one moving a transaction out (doesn't count)
  - a split with one part in the category: only that part counts, and `partMinor` has it
  - a confirmed transfer pair whose bucket is in a Transfer category: not included
  - bucket rows sorted by absolute total, then name
  - the cells, the bucket rows and the summary all add up to the same net total
  - mixed currencies
  - an empty category returns `null`
- **E2E (Playwright)** in a new `tests/e2e/category-explorer.spec.js`, with the synthetic fixtures:
  - open an Ignore or Transfer category from Categories, and check the summary and a month cell
  - a category with nothing in it is not a button
  - press a month cell, then a bucket, and the list narrows
  - move a transaction out with Counts as, and the summary and cells update
  - move the last one out, and the empty line takes focus
  - Back returns focus to the name button, and reopening shows no filters
  - add the view to the axe checks in `a11y.spec.js`

## Left to the builder

- Module and function names, and where the data function lives.
- How `monthGrid` shows a part-covered cell.
- Exact wording of the summary line, the "moved here" note and the help sentence, within the shapes above.
- The view's list key and how it clears its `listView` entry.
- Any small helper shared with `category-view.js`.
- How a part-covered cell and the reset on leaving are wired (for example through `main.js`, as the Typical month view's reset is).
- Whether month cells still narrow the list when totals are hidden for mixed currencies.
