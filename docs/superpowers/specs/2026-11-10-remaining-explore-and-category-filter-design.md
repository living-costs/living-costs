# Open Remaining's parts, and a Category filter on Transactions and Buckets

## Why

Typical month's Remaining is split into saved, one-offs, uncategorised, ignored and "not accounted for". The owner looked at "ignored £919.70" and had no way to see which buckets and transactions make it up. The same is true of one-offs and uncategorised. (Opening one-offs and the Uncategorised line was already queued as a follow-up, and is folded in here.)

The owner also wants the same kind of question answered globally, not tied to Typical month's window: "show me everything that is Ignore", "everything One-off". That is the queued follow-up "a category filter on Buckets and Transactions", folded in here, and extended with groups: by kind and by budget type.

Success: from Typical month, clicking "ignored" shows within seconds the buckets and transactions behind £919.70, and they add up to it. On Transactions and Buckets, one dropdown narrows the list to a category, a kind, a budget type, or (on Transactions) Uncategorised.

## Base

This work builds on PR 37 ("Categories: open any category to see what is in it", branch `worktree-category-explorer`, design `docs/superpowers/specs/2026-11-10-category-explorer-design.md`), which is open and not yet merged. This branch, `worktree-remaining-explore`, starts at PR 37's head. Reuse its explorer view (`src/ui/category-explorer.js`) and its data function (`src/explore.js`) rather than Typical month's older `category-view.js`. If PR 37 merges first, rebase onto `main`; otherwise open this PR against PR 37's branch and retarget once it merges.

## Goals

1. On Typical month's summary card, **one-offs**, **uncategorised** and **ignored** become buttons. Each opens a view of the buckets and transactions behind its figure, within the window.
2. A **Category** filter on the Transactions screen, with groups: Uncategorised, by kind, by budget type, and each category.
3. The same **Category** filter on the Buckets screen, without Uncategorised.

## Non-goals

- Opening "saved" (its parts already have rows in the Savings table) or "not accounted for" (no transactions make it up).
- Opening the "Uncategorised: … over the window" line under the card. Its Categorise button stays as it is.
- Any change to Typical month's figures, to `category-view.js`, or to PR 37's view when opened from Categories.
- The queued fix "By bucket filter survives Back" in `category-view.js`. Still a separate task.
- A Category filter inside opened views (see below).
- New stored data. No `DATA_VERSION` change.

## Anti-goals

- **The opened view must never disagree with the figure clicked.** Its transactions, and their amounts, are exactly those that made that figure, by Typical month's own rules (see "What counts"). Not PR 37's rules, which differ on Savings accounts.
- The filter must never disagree with the Counts as cell of the rows it shows.

## Decided with the owner

- All three lines open, in one piece of work, together with the global filter.
- The opened view is PR 37's explorer layout (approved mockup `.superpowers/brainstorm/remaining-explore/opened-ignored-v2.html` in the main checkout, local only), with these differences: Back to Typical month; a summary line that ties the totals to the figure; a Category column in By bucket for one-offs and ignored; limited to the window.
- The global part is a filter on Transactions and Buckets (approved mockup `.superpowers/brainstorm/remaining-explore/global-filter.html` in the main checkout, local only). Option labels use the prefixes **"By kind: …"** and **"By type: …"** (the owner's wording). The prefix also keeps "By kind: Ignore" apart from the default category named Ignore.
- "By kind: Transfer" on Transactions includes confirmed transfer pairs (Claude's guess, which the owner accepted).

## Part 1: opening Remaining's parts from Typical month

### The card

In `summaryList` (`src/ui/typical.js`), the labels "one-offs", "uncategorised" and "ignored" become buttons styled as the category name buttons in the tables (`class: 'secondary name'`), with a focus key each. This applies both with and without a compare month. A part whose figure is the dash (no transactions) stays plain text.

Clicking opens the view in place of the screen's content, as a category opened from a table does now. Typical month's `ui` state records which is open, alongside `openId`. Only one of a category or a part can be open at once.

### What the view shows

Heading: "One-offs", "Uncategorised" or "Ignored" as the `h3`, which takes focus on opening, and a "Back to Typical month" button beside it (PR 37's `view-heading` pattern).

**Summary line.** PR 37's shape, plus the clicked figure. For example: "Ignore categories · 45 transactions in 3 buckets, £11,236.40 out and £200.00 in, Nov 2025 to Oct 2026. That is £919.70 a month on Typical month: each account's net out over its own months, added together." The leading words are "Ignore categories", "One-off categories" and "Uncategorised". The figure in it is the one from `typicalMonth(...).totals`, not recomputed. Exact wording is the builder's within that shape. The months named are the window's first and last.

**Each month.** PR 37's `monthGrid`, one row per account with anything in the part, with PR 37's per-account label ("Current account: £X out and £Y in"). Columns are the window's months only. A month that the account does not count in this window (not in `window.accountMonths` for that account) shows as not covered. No part-covered cells, because Typical month counts only complete months. Cell figures are signed net totals, as in PR 37. Pressing a cell narrows the list to that account and month, as in PR 37.

**By bucket.** PR 37's table: Bucket (toggle button that narrows the list, with "(N moved here)"), Transactions, Total, Last. For one-offs and ignored there is also a **Category** column after Bucket, and rows are one per bucket and category, so a bucket whose transactions sit in two Ignore categories shows twice. Uncategorised has no Category column and one row per bucket. "Moved here" means: in this group through an override or split while the bucket's own category is outside the group. Uncategorised rows never show it, since an override or split part always names a category. The bucket toggle narrows by bucket only. *Claude's call:* when a bucket appears on two rows, either row's toggle narrows to the whole bucket, which is what the list's Bucket filter can express.

*Claude's call:* no "per month" column. Per-account division with rounding means per-bucket monthly figures would not add up exactly to the clicked figure. The summary line carries the monthly figure.

**Transactions.** PR 37's use of `renderTransactionList` with `only`: ids, Bucket options limited to the part's buckets, and `partMinor` so a split row says how much of it counts here. Search, Bucket, From and To work as now. Counts as stays, so a transaction can be fixed in place.

### What counts

Exactly what Typical month's `collect` (`src/typical.js`) adds to `out.oneOffs`, `out.uncategorised` and `out.ignored`, for the same window (`ui.range`). In short:

- Only transactions in their account's counted months for the window.
- Confirmed transfer pairs are skipped, except savings pairs, which take the side's Saving category (or the Savings account's row). Those are never ignored or uncategorised, but **can be a one-off**: when the side's Saving category has budget type `oneoff`, `collect` puts the pair in one-offs. The view must include it, and its Counts as reads Transfer. (So on Transactions, "By type: One-off" won't match that row, which is consistent with the filter following Counts as.)
- **Ignored:** parts in a category of kind `ignore`, in every account, Savings accounts included.
- **One-offs:** a transaction's net per category, for counted categories (spend, income, contribution, saving) with budget type `oneoff`, except Saving-category parts inside a Savings account, which `collect` skips before the one-off check.
- **Uncategorised:** parts with no category, or whose category id is not a known category.

*Constraint for the builder:* get the view's transactions from the same pass that makes the figure, as `categoryDetail` does for categories. For example, have `collect` record per part each transaction's signed amount and category, and pass that list to a summarising function shared with PR 37's `categoryContents` (which today both finds and summarises). Do not re-derive the rules in a second place. A unit test must show that, for each part, each account's net out divided by its month count (with `divRound`), summed, equals the figure in `totals`.

The view ignores the compare month. It always shows the window.

### Back, leaving, edits

As PR 37's view, adapted:

- Back to Typical month returns to the card with focus on the button that opened it. If that part is now a dash (plain text), focus goes to the screen heading.
- Browser back closes the view too (Typical month's existing `showing()` handling).
- Back, browser back and leaving through the nav clear the view's pressed month and its list filters (PR 37's `forgetListView`), unlike `category-view.js`.
- A Counts as change that empties the part leaves the view open with "Nothing is <ignored|in one-offs|uncategorised> in these months now." (wording the builder's), and focus moves to that line, as in PR 37.

Typical month already refuses mixed currencies, so the view never needs PR 37's "Totals need a single currency" case. The builder may keep the code path shared.

## Part 2: the Category filter

### Options

One `<select>` labelled **Category**, options in this order:

1. All categories (no filter)
2. Uncategorised (Transactions only)
3. By kind: Spend, By kind: Income, By kind: Contribution, By kind: Saving, By kind: Transfer, By kind: Ignore (labels from `KIND_LABELS`)
4. By type: Fixed, By type: Variable, By type: Annual, By type: One-off (labels from `BUDGET_LABELS`)
5. Every category, in `sortedCategories` order, by name

*Claude's call:* every kind and type is always listed, even with no categories of it, so the list is the same each time; an empty result says "No transactions match." as now. *Claude's call:* separators between the groups are optional; the prefixes carry the grouping.

"By type" matches only categories whose kind is budgeted (`isBudgeted`), whatever stray `budgetType` a non-budgeted category may hold.

### Transactions screen

The select sits after Search, before Bucket (mockup). A transaction matches when `resolve(t, buildContext(state))` gives it any part in the chosen group. That is the same thing its Counts as cell shows:

- A category: any part with that id.
- By kind / By type: any part whose category has that kind / budget type.
- **By kind: Transfer** also matches confirmed transfer pairs (resolve source `transfer`), whose parts carry no category.
- **Uncategorised**: any part with no category, or with a category id that is not a known category, and not a confirmed pair. It must match exactly the rows whose Counts as reads uncategorised.

It combines with search, Bucket and the dates. While a group is chosen, the Bucket options narrow to buckets with at least one matching transaction; if the chosen bucket drops out, the Bucket filter clears (as it does now when a bucket disappears). The choice is kept in the list's `View`, so it survives leaving the screen like the other filters there.

The Category filter appears only on the Transactions screen's own list. Every other use of `renderTransactionList` has none: opened views (a category from Typical month, a category from Categories, a Remaining part), whose contents are already fixed, and a bucket drilled into on Buckets, which is already one bucket. *Claude's call.*

A matching split row in the main list shows no "£X of this counts as …" note. *Claude's call:* that note belongs to opened views.

### Buckets screen

The select sits after Show (mockup), with the same options except Uncategorised (Show already has one). A bucket matches on its own category (`bucket.categoryId`), the one in its row's select, not on per-transaction overrides. It combines with search and Show. Totals, counts and the window line are unchanged.

Changing a row's category can now hide that row. Use the same focus hand-off the Show filter already uses when a change hides a row (`src/ui/buckets.js`, around the `ui.show !== 'all'` check). The choice is kept in Buckets' `ui` state like Show.

## Constraints

- All CLAUDE.md rules: `textContent` only, no network code, integer minor units, thresholds from `src/tuning.js`. No new thresholds expected.
- Typical month's figures, `categoryDetail` and `category-view.js` do not change behaviour. PR 37's view from Categories does not change behaviour.
- One resolve pass per render on Transactions and Buckets is fine at this scale (a few thousand rows).

## Changes to CLAUDE.md

Under **Scope, In scope**, add:

1. "Open one-offs, uncategorised and ignored on Typical month to see the buckets and transactions behind them."
2. "A Category filter on Transactions and Buckets: by category, kind or budget type, and Uncategorised on Transactions."

Both are new features the owner asked for in this design. No data model change.

## Testing

**Unit (`node:test`)**, synthetic state:

- For each of the three parts: the recorded transactions reconcile with `totals` (per-account net out ÷ month count with `divRound`, summed).
- Ignored includes a Savings-account transaction in an Ignore category. One-offs excludes a Saving one-off part inside a Savings account. A confirmed non-savings pair is in none of the three. A savings pair whose side is in a Saving One-off category is in one-offs.
- A split with one part in an Ignore category and one in Spend: only that part is in ignored, with `partMinor` set.
- An override moving a transaction into an Ignore category: counted, and "moved here".
- A bucket with transactions in two Ignore categories: two By bucket rows.
- A transaction outside its account's counted months: excluded.
- The filter predicate: each option kind, including By kind: Transfer with a confirmed pair, By type ignoring a non-budgeted category's `budgetType`, and Uncategorised matching exactly the rows whose Counts as source is `none` (and unknown category ids).

**E2E (Playwright)**, synthetic fixtures:

- Open ignored from the card: the summary line names the card's figure; press a bucket, then a month, and the list narrows; Back returns focus to "ignored"; reopening shows no filters.
- Open uncategorised, categorise one transaction with Counts as, and it leaves the view; categorise the last, and the empty line takes focus.
- A part with no transactions shows a dash and is not a button.
- Transactions: choose By kind: Ignore, then a single category, then Uncategorised; the rows and Bucket options narrow. Buckets: choose By type: One-off; change a row's category so it hides, and focus is kept.
- Add the opened part view to the axe checks and the 320px check.

## Left to the builder

- Function and module names; how `collect` records parts; how `categoryContents` is split so both views share the summarising code.
- How Typical month's `ui` state records an open part.
- Exact wording of headings' focus-empty lines, the summary line and the split note in part views, within the shapes above.
- Whether the select uses `<optgroup>` or separators.
- Whether to open this PR against PR 37's branch or wait and rebase on `main`.
