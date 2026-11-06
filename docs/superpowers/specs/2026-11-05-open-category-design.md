# Open a category from Typical month, a simpler Fixed, and type hints on Categorise

## Why

When a figure on Typical month looks too high or too low, there is no way to see what makes it up. The Buckets screen can't filter by category, the Categories screen doesn't list contents, and Typical month figures can't be opened. The owner wants to open a category from Typical month, see why its figure is what it is, and then go back. Opening a bucket on Buckets is the model: click the name, see its transactions, then go back.

While designing this, two everyday cases turned out to break the Fixed calculation:

- **Council tax paid over 10 months.** When the window ends in February or March, the last two months have no payment, so the bucket counts as ended and Council tax shows £0.
- **An employer's name changes on the statement.** The salary splits across two buckets. The old one counts as ended and the new one counts only its own few months, so Salary shows about a quarter of the real figure.

The same rule also zeroes any yearly charge in a Fixed category (Amazon Prime in Subscriptions, car tax in Car) unless it fell in the last two months. All of these come from one automatic rule: a bucket with no charge in the last `fixedActiveMonths` (2) complete months has ended and adds nothing. Without that rule, the Fixed formula already gives the right answer in each case. So this work removes the rule, and lets the user mark a bucket Stopped when something really has been cancelled.

Success means that, starting from a Salary figure that looks wrong, the user can see within a few seconds which month or bucket is unusual and which transactions make it up.

## Goals

- In Typical month, open any category in the Living costs, Income or Contributions tables.
- Explain the figure in one line, in terms of its budget type.
- Show the category's total for each month the figure used, with unusual months marked.
- For a Fixed category, show what each bucket adds, and allow marking a bucket Stopped.
- List every transaction that counts as the category in those months, and allow changing what each one counts as, as on the Transactions screen.
- On the Categorise card, hovering a category button shows its kind and budget type and what they mean.
- Fixed no longer drops buckets automatically. Council tax over 10 months, a renamed employer, and yearly charges in Fixed categories all come out right.

## Non-goals

- A category filter on Buckets or Transactions, or bucket lists on the Categories screen.
- Opening one-offs or the Uncategorised line.
- Charts beyond the row of monthly totals.
- Any change to how Variable, Annual or One-off are worked out.
- Automatic detection of cancelled charges, payment schedules or bucket renames.
- An automatic fix for a 13th salary in a 12-month window (an early payday). The user can move the extra payment to Ignore with the existing Counts as control. That is accepted as a manual fix. Because an override is permanent, the window may later need it undone, and the month cells make that visible.

## Anti-goals

- The opened view must not disagree with the figure it explains. Its monthly totals, bucket rows and list must come from the same transactions, months and resolution (overrides, splits, transfers) as `typicalMonth`. A view that shows a different number from the row the user clicked is worse than no view.
- No automatic guess may set or change a user's Stopped mark. The only automatic change is clearing it when a newer charge arrives, and the user is told.

## Part 1: Fixed without the "ended" rule

**Formula.** As now, for each account and each bucket with transactions counting in the Fixed category: the latest charge × the number of charges ÷ the account's covered months, plus refunds ÷ the account's covered months. The figure is the sum over buckets and accounts. A weekly standing order still counts as about 4.33 charges a month.

**Removed:** the `activeMonths` test in `src/typical.js` and `fixedActiveMonths` in `src/tuning.js`. Every bucket with at least one charge in the window counts.

**Kept, as Claude's call:**
- A bucket with no charges in the window (only refunds) adds nothing. It is never negative, as now.
- A bucket's contribution never goes below 0, so a large refund can't make it negative.

**Stopped.** A bucket gets an optional `stoppedAfter` field (an ISO date). Marking a bucket Stopped sets it to the date of that bucket's latest charge. In a Fixed calculation, a Stopped bucket adds nothing, refunds included.

**A newer charge clears the mark (owner's decision).** When an import brings a charge dated after `stoppedAfter` into a Stopped bucket (a resumed subscription), the import removes `stoppedAfter` from that bucket, so the mark never sits there being ignored. The import summary says so in one line, for example "NETFLIX was marked Stopped and has charged again, so it counts again." `assignBuckets` already returns changed buckets on import, which makes it the likely place. *Claude's call:* undoing that import doesn't restore the mark. The user can tick Stopped again. Nothing else changes `stoppedAfter` automatically.

`stoppedAfter` only affects Fixed. In any other budget type it is ignored, and kept.

**Where Stopped is saved and carried:**
- `src/types.js`: add `stoppedAfter?: string` to `Bucket`.
- Backup: `readBucket` in `src/backup.js` builds a new object field by field, so an unhandled field is silently dropped on restore. Add `stoppedAfter` there, validated as an ISO date when present. The app has no users yet, so compatibility with older backups doesn't constrain this. Schema versioning and backup compatibility are a separate later task (see Follow-up tasks).
- Merge: `mergeBuckets` in `src/buckets.js` also builds `next` field by field. *Claude's call:* the merged bucket is Stopped only if every bucket merged into it was, with `stoppedAfter` set to the latest of their dates. Otherwise the field is left off.
- Check every other place that rebuilds a bucket object (for example `assignBuckets` on import and any normaliser migration) and confirm it keeps the field.

**Help text.** The Categories screen's Fixed help (`src/ui/categories.js`) mentions `fixedActiveMonths`. Replace it with something like: "Regular charges such as rent or subscriptions. Uses each charge's latest amount, as often as it was charged. Open the category on Typical month to mark a charge Stopped."

## Part 2: Opening a category

The approved mockup is option B in `.superpowers/brainstorm/` (local only). It is described below.

**Entry.** In each Typical month table, the category name in the row header becomes a button. It is styled and behaves like a bucket name on Buckets (`class: 'secondary name'`). Clicking it replaces the screen's content with the category view. The view's heading takes focus.

**Heading and explanation line.** The category name, then one line built from the same `Row` the user clicked:

- Variable: "Income · Variable · £3,140 a month, the median of these 11 months. Typical range £3,140 to £3,553."
- Fixed: "Spending · Fixed · £X a month: each charge's latest amount, as often as it was charged in these N months."
- Annual: "Spending · Annual · £X a year over these N months, so £Y a month." When fewer than 12 complete months exist, add the existing "scaled to 12 months" wording.

The kind word uses the existing kind labels. The amounts are the Row's own `perMonth`, `perYear` and `range`. They are never recomputed separately.

*Claude's call:* when the category's transactions come from more than one account, the line says how the figure combines them instead of naming one month count. For example, Variable: "£X a month: each account's median month, added together. Typical range £a to £b." Annual: "£X a year: each account's yearly total, scaled to 12 months and added together." Each account row of month cells (below) then shows that account's own share next to its label (its median for Variable, its scaled yearly total for Annual), so the rows visibly add up to the figure.

**Each month.** One cell per month in the analysis window, oldest first, each showing that month's net total for the category in its natural direction (as `typicalMonth` sums it: refunds reduce spending).

A month is unusual when its total differs from its row's median by more than a new `tuning.unusualMonthPercent` (default 25). It is drawn bolder and carries an accessible label, such as "unusual". This applies to every budget type and is worked out per account row. When the median is 0, any month that isn't 0 is unusual. *Claude's call:* `variableRange` was considered and rejected, because at 25 and 75 it marks about half the months of any spread-out category and never marks anything in a row of three months or fewer.

When the category's transactions in the window come from more than one account, show one row of cells per account, labelled with the account name. Each row covers only that account's months (`window.accountMonths`). A month the account doesn't fully cover shows as "not covered", not as 0. This matches how `typicalMonth` works, and a missing statement shows up as a gap. With one account, show a single row without a label.

Each month cell is a toggle button (`aria-pressed`). Pressing it narrows the transaction list to that month (and that account, in the per-account layout). Pressing it again clears the filter, and pressing another month moves it.

**By bucket (Fixed only).** Between the month cells and the transaction list, a table with one row per bucket (and per account, when there are several) that adds to the Fixed figure:

| Column | Content |
|---|---|
| Bucket | The bucket's display name, as a toggle button that narrows the transaction list to that bucket, like the month cells. It does not open the bucket on Buckets (owner's choice, option A of the second mockup) |
| Latest charge | That bucket's latest charge in the window |
| Charges | How many charges in the window |
| Last charged | Date of the latest charge |
| Adds per month | Its contribution to the figure, refunds included. 0 when Stopped |
| Stopped | A checkbox, labelled "Stopped: <bucket name>" |

The rows add up to the figure. Under the table, one line of help: "Mark a charge Stopped only if it has ended and nothing replaced it. If another bucket took over, such as after a name change, leave both as they are, or merge them on Buckets so the latest amount is used." This matters: marking a renamed employer's old bucket Stopped would bring back the very undercount this work fixes.

Stopped buckets stay in the table, with their row muted, so the mark can be undone.

**Transactions.** Below is the existing transaction list (`renderTransactionList`), fixed to the transactions that count, in whole or in part, as this category in the covered months. A transaction counts if `resolve` gives it a part with this category, it is not a transfer, and its month is in its account's covered months. Search, the From and To dates, the result cap and the Counts as control work as they do now. The Bucket filter stays, because a category spans several buckets, and it lists only the buckets that appear in this category's transactions. If a split part belongs to this category, the Counts as cell should make clear which part (for example "Split: £412.60 Salary"). The builder can choose the exact wording within the existing Counts as cell.

Changing what a transaction counts as, or ticking Stopped, saves as elsewhere. The view then redraws, and the explanation line, month cells, bucket table and list all update together.

**Back.** A "Back to Typical month" button at the end of the view, as on Buckets. It returns to Typical month with focus on the category button the user came from. If that category no longer appears in the tables, focus goes to the Typical month heading.

*Claude's call:* the user's own edit in this view can empty the category. Changing Counts as on its last transaction drops it from Typical month while the view is still open. When that happens, the view stays open with its heading, the line "Nothing counts as <name> in these months now.", no month cells, bucket table or list, and the Back button. Focus moves to that line. It doesn't jump back to Typical month by itself.

The open category and its month and bucket filters are screen state that is not saved, like `ui.drillId` on Buckets. Leaving the screen through the nav and coming back behaves as Buckets does.

## Part 3: Kind and type on the Categorise card

On the Categorise screen, each category button on the card (`src/ui/categorise.js`) gets a hover tooltip with its kind and budget type and what that means. This is so the user sees the consequence of a choice, such as a garage repair put in Fixed Car adding its amount ÷ 12 every month. The owner approved the mockup and wording:

| Category | Tooltip |
|---|---|
| Fixed | "Spending · Fixed: each charge's latest amount, as often as charged, ÷ 12" (Income or Contribution in place of Spending as the kind requires) |
| Variable | "Spending · Variable: the median month" |
| Annual | "Spending · Annual: the year's total ÷ 12" |
| One-off | "Spending · One-off: shown separately, not in your typical month" |
| Transfer | "Transfer: not counted" |
| Ignore | "Ignore: not counted" |

Use the browser's own tooltip (`title`). Give each button the same text as its accessible description, for example via `aria-describedby` pointing at a visually hidden element, so screen readers get it too. The text is built from the category's current kind and type, using the existing kind and budget labels where they fit. Keep the wording in one place, so the Categories screen help and these tooltips don't drift apart. The New category… button gets no tooltip.

## Constraints

- All the CLAUDE.md rules: `textContent` only, no network code, integer minor units, thresholds from `src/tuning.js`. The new `unusualMonthPercent` goes in `src/tuning.js` with a one-line comment like its neighbours.
- Monthly totals and bucket rows come from `typicalMonth`, or a function it shares, not from a second implementation of the summing. The simplest route is likely for each `Row` to carry its per-account month series (already built in `AccountSums.months`) and, for Fixed, its per-bucket figures (already built in `AccountSums.buckets`). Keep the existing `Row` fields unchanged, because the table and tests use them.
- The transaction list must not run a separate category resolution that could drift from `typicalMonth`. Use `resolve` and `buildContext` and the same window.
- Mixed currencies: Typical month already shows only a message, so nothing opens.

## Impact and gotchas

Found by reading the current code. The builder should confirm each one.

1. **Backups:** see Part 1. Make sure `readBucket` keeps `stoppedAfter`, and add a unit test that it round-trips.
2. **Merging drops fields:** `mergeBuckets` builds the merged bucket by hand. Add `stoppedAfter` there, with the rule above, and a unit test.
3. **Existing unit tests that encode the old rule** in `tests/unit/typical.test.js` must be rewritten, not deleted: "a bucket with no charge in the last fixedActiveMonths contributes 0", "a refund counts only from a bucket that is still active" and "an ended bucket with a refund gives 0". The new expectations: the gym counts (£30 × 9 ÷ 12), the old broadband bucket counts, and a bucket with only refunds still gives 0. Add tests for council tax over 10 months with the window ending in March, a renamed employer across two buckets, a yearly charge, Stopped, and a charge after `stoppedAfter`.
4. **Tuning test:** `tests/unit/tuning.test.js` lists `fixedActiveMonths`. Remove it and add `unusualMonthPercent`.
5. **E2E figures:** `tests/e2e/typical.spec.js` hard-codes Typical month figures for the synthetic fixtures. The fixture generator doesn't compute them. Any Fixed bucket in the fixtures that stops before the last two months will change its category's figure. Recompute affected values by hand from `tests/fixtures/generate.js` and say in the PR which ones moved and why.
6. **A one-off purchase in a Fixed category** (for example a repair in Car) now always adds its amount ÷ 12, where before it added nothing once two months had passed. That is the intended trade, and Stopped removes it. Note it in the Categories help only if it fits in one sentence.
7. **Cancelled items fade rather than vanish** unless marked Stopped: each newer import drops one old charge from the window, so the item reaches 0 within 12 months.
8. **The categorise card** (`monthlyFigure` in `src/progress.js`) isn't budget-type aware and isn't affected. Confirm nothing else reads `fixedActiveMonths` or the ended rule.

## Documents to update

- `docs/superpowers/specs/2026-11-04-living-costs-design.md`: the Fixed paragraph under "Calculation per category", and the `tuning.js` block (remove `fixedActiveMonths`, add `unusualMonthPercent`).
- `CLAUDE.md`: add `stoppedAfter?` to the `Bucket` line in the data model. The budget table's "Current recurring amount" for Fixed still holds. List every CLAUDE.md change in the PR description, because the owner treats CLAUDE.md as a shared plan.

## Testing

- Unit (`node:test`): the Part 1 cases above. Also the per-account monthly series, per-bucket figures and unusual-month marks for variable, fixed and annual categories, including a category spanning two accounts with different coverage, a refund in a spend category, a split transaction with one part in the category, and a transaction moved in by an override. Check that the view's data matches the Row: for variable, the sum of per-account medians equals `perMonth`. For fixed, the bucket rows add up to `perMonth`.
- Unit: a newer charge on import clears `stoppedAfter` and reports it. An older or same-day charge doesn't.
- E2E: the Categorise card's category buttons carry the tooltip and accessible description for each kind and type.
- E2E (Playwright): open a category from Typical month and check the explanation line and month cells. Filter by a month and by a bucket. Move a transaction out and see everything update. Tick Stopped on a Fixed bucket and see the figure drop, both in the view and back on Typical month. Go back and check focus. Add the view to the axe checks.

## Follow-up tasks (separate, not part of this work)

- **Backup versioning and compatibility.** Decide how schema version bumps work and whether older backups can be restored or migrated. Today restore rejects every version but the current one. Until users exist, formats may change freely.
- **Dark mode.** Make the app readable in macOS dark mode.

## Left to the builder

- Exact layout and CSS of the month row and bucket table, within the existing stylesheet's patterns.
- Exact explanation and help wording, within the shapes above.
- How the fixed transaction set is passed to `renderTransactionList` (for example a predicate or a set of ids in `filters`), and its view key.
- Whether Help needs a sentence. If Help describes Typical month, add one saying names can be opened.
