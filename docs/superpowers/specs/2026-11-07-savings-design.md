# Savings

## Why

Some of the owner's transfers are card repayments, and some move money into savings. Today the only way to keep savings out of living costs is a Transfer-kind category, and Typical month skips those entirely. So the app never says how much is being saved. If the savings account's statements are imported too and the pair is confirmed, the transaction becomes a plain transfer and its category is dropped.

The owner wants savings counted as its own thing: not living costs, not contributions, not income, shown separately on Typical month as a total.

Success means the owner can see "we put about £X a month into savings" next to Income, Living costs and Left over. That holds whether the money goes to an account whose statements are loaded, or leaves by direct debit or standing order to an account that isn't imported.

## Goals

- A new category kind, **Saving**, for money set aside, such as a direct debit or standing order to a savings account that isn't imported.
- A new account kind, **Savings**, for an imported savings account. Confirmed transfers into or out of it count as saving.
- Savings are **net**. Money taken back out of savings reduces the figure. **Owner's decision.**
- Typical month gets a fourth table, **Savings**, and a **separate summary line**. Savings are not taken off Left over. **Owner's decision.**

## Non-goals

- Interest, growth or balances. Unpaired transactions inside a savings account, such as interest, are categorised as usual.
- Savings goals, targets or forecasts.
- Changes to transfer suggestions, the Transfers screen or card repayment handling.
- Changes to Categorise, Buckets or progress counts, beyond the new kind being one of the choices.

## Anti-goals

- **Never count a pair twice, and never let its two sides cancel out.** This is why direction comes from the account kind, not the category. If both sides were in Saving, a payment into savings and its arrival would cancel, and a withdrawal would look like a deposit. **Owner's decision:** mark the savings account once.
- **Savings never change Income, Living costs, Contributions, your share or Left over.**
- **Totals reconcile.** The Savings table's figures add up to the summary's Savings line, in both the typical and the compared-month columns. An opened Saving category matches its row, as every other category does (the open-category anti-goal).
- **No silent data loss.** Older stored data and backups upgrade with no change to their figures, apart from the Savings conversion in Data and versions.

## How it counts

### The Saving category kind

- `CategoryKind` gains `saving`. It is a counted kind, like spend, income and contribution, and takes a budget type: Fixed, Variable, Annual or One-off. The budget types behave exactly as they do elsewhere.
- **Natural direction is money out of your other accounts into savings.** On a bank or card account, a saving figure is `-amountMinor`, so a payment out is a positive saving and money coming back in is a negative one.
- *Claude's call:* inside a **Savings** account, only confirmed pairs count as saving. An unpaired transaction there that you put in a Saving category counts for nothing, like a Transfer. Otherwise a deposit would count twice until its pair is confirmed: once leaving the bank account, once arriving in savings. The cost is that a deposit from an account you don't import isn't counted. Put that bucket in a Saving category on the paying side instead, if it's ever imported.
- **Budget types and withdrawals.** Fixed works exactly as elsewhere: the current recurring amount, counted per bucket and never below zero. A withdrawal bucket therefore doesn't reduce a Fixed Saving category's typical figure, though it does reduce that month's figure when comparing. Fixed spending with refunds already behaves this way. Variable and Annual are net, so withdrawals reduce them. *Claude's call:* the default Savings category is Variable (below), so the owner's net rule holds out of the box.
- Overrides and splits into a Saving category work as for any other category.
- *Claude's call:* a One-off Saving category goes in the existing One-offs list, outside the Savings total, just as One-off spending sits outside Living costs.

### The Savings account kind

- `Account.kind` gains `savings`, alongside `bank`, `card` and `placeholder`.
- For a **confirmed** transfer pair:
  - **One side is in a Savings account and the other isn't:** the pair counts once, as saving. It is counted on the non-savings side, in that account's month, and only if that account fully covers the month, as every Typical month figure is. The amount is that side's `-amountMinor`. Money into savings is positive, and a withdrawal back out is negative.
  - **Both sides are in Savings accounts:** a plain transfer that counts for nothing.
  - **Neither side is:** a plain transfer, as today.
- **Which row a pair lands in.** If the non-savings side would resolve to a Saving category (through its override, or its bucket's category), the pair goes in that category's row. The owner asked for the category to be kept when the pair matches. Otherwise, *Claude's call:* the pair goes in a row named after the savings account. If there are several savings accounts, each gets its own row.
- *Claude's call:* an account row is always Variable: median month, with the typical range. To have a pair treated as Fixed, put the non-savings side's bucket in a Fixed Saving category.
- *Claude's call:* if a split is on the non-savings side of such a pair, it is ignored, as splits on confirmed pairs are today. The whole amount is saving.
- *Claude's call:* a Saving category on a pair where neither account is a Savings account is still dropped, as today. The help text tells you to mark the account.

### What doesn't change

- Uncategorised money, transfer suggestions, the identical-file block, duplicate detection and progress counts. Confirmed pairs, savings pairs included, still count as transfers for progress.
- In the Counts as control, a confirmed pair still shows "Transfer" and can't be changed.
- **Clear categorisation** keeps account kinds. A Savings account is account setup, not a categorisation decision.

## Screens

### Accounts

- The Kind select in the import flow's "Set up columns" step lists Bank, Card and Savings.
- *Claude's call:* an existing account's kind can be changed from its card under "Your accounts", with a small Kind select (Bank, Card or Savings). This is needed because an account that already has a mapping never shows "Set up columns" again. Placeholder accounts have no select and stay as they are.
- The card's muted line shows the kind as it does now, for example "Savings · GBP".

### Categories

- The kind choices gain **Saving** (`KIND_LABELS.saving = 'Saving'`, `KIND_WORDS.saving = 'Saving'`).
- The Kinds guide gains a line, worded by the builder in the app's voice. For example: "Money set aside in savings, such as a standing order to a savings account. Shown as its own total, not a living cost. If you import the savings account, mark it as Savings on Accounts so transfers to it count."
- The Transfer line's wording stays.
- The Budget types guide's subtitle becomes "Spend, Income, Contribution and Saving only".

### Defaults

- `src/default-categories.js` gains `{ id: 'savings', name: 'Savings', kind: 'saving', budgetType: 'variable' }`, placed after "Contributions from others". Existing users are offered it once, through the existing mechanism. *Claude's call:* Variable, so withdrawals reduce the typical figure (see Budget types and withdrawals). The owner can edit it.
- **Owner's decision:** the owner already has a category named "Savings", a Transfer. The v3 upgrade step converts it (see Data and versions). Because the names match, the offer then skips the new default, as `acceptDefaults` already does for any matching name.

### Typical month

- A fourth table, **Savings**, after Contributions, built by the same `rowsTable` as the other three. It has the same columns, ticking, bars and compare columns, and its columns line up with the other tables through `alignColumns`.
- Rows are Saving categories and savings-account rows (above), sorted as the other tables are.
- Saving category rows open the category view. *Claude's call:* savings-account rows show their name as plain text, not a button, like a month-only row. They can be ticked, and their tick key is `account:<id>`, which never clashes with a category UUID.
- **Summary:** a separate **Savings** line after Left over, shown only when the Savings table has rows. When comparing, it gets a month figure and a Change like every other line. Left over is unchanged.
- The Ticked total can include Savings rows, as a plain sum like today.
- *Claude's call:* the Change text for Savings reads "£50 more" when more was saved. That follows the natural direction, as for income.

## Data and versions

- `DATA_VERSION` goes from 2 to 3. **Owner's decision:** a version bump is fine. It means an older app refuses a backup or a stored database that may hold `saving` or `savings`.
- The v3 step does one thing. A category whose trimmed name is "Savings", compared case-insensitively, and whose kind is `transfer` becomes kind `saving` with budget type `variable`. Nothing else changes. **Owner's decision:** convert the existing Savings category. It runs on stored data at load and on older backups at restore. Like every step, it must never throw on odd shapes. Its transactions' figures change from not counted to Savings, which is the intent. Every other figure is unchanged.
- Follow the checklist at the top of `src/migrate.js`. There's no normaliser change and no store or index change, so `DB_VERSION` stays. Update `PINNED`, and freeze the v3 backup fixture last.
- Backup validation accepts `savings` as an account kind (`isAccountKind` in `src/backup.js`) and `saving` as a category kind (through `KINDS`).
- The PR description ends with the `data-v3` tag reminder.

## Constraints

- Every rule in CLAUDE.md applies: `textContent` only, no network code, integer minor units, `divRound`, and thresholds from `src/tuning.js` only.
- The new select is labelled and keyboard reachable, and passes the axe checks.

## Changes to CLAUDE.md

1. **Scope, In scope:** add "Savings: a Saving category kind and a Savings account kind, shown as a separate total on Typical month".
2. **Data model:** `Account.kind` becomes `bank | card | savings | placeholder`. `Category.kind` becomes `spend | income | contribution | saving | transfer | ignore`.
3. **Correctness:** add "Money moved into savings, by a Saving category or a confirmed transfer into a Savings account, is saving: net of withdrawals, never living costs or income."

## Left to the builder

- Where the pair-to-savings logic lives. Likely places are `resolve()` (a new `source: 'saving'`, with the row's category or account) or `collect()` in `src/typical.js`. Either is fine, as long as `typicalMonth`, `monthFigures` and `categoryDetail` all see the same result.
- How `Totals` and `TypicalMonth` carry the savings rows and total. `totalsOf` needs a `saving` table.
- How the category view lists a pair-based transaction. It shows the non-savings side, and its part sum must match the row.
- The wording of the help lines and the account-card select.

## Verification

- Unit tests (`node:test`) on synthetic fixtures:
  - A Saving-category direct debit counts as positive saving. Money back into the same bucket reduces it.
  - A confirmed pair from a bank account to a Savings account counts once, positive, in the bank side's month. A withdrawal pair counts negative. A pair between two Savings accounts counts nothing.
  - Such a pair takes the bank side's Saving category when it has one, and the account row otherwise.
  - An unpaired transaction in a Savings account, in a Saving category, counts nothing.
  - A Fixed Saving category ignores a withdrawal-only bucket in its typical figure. A Variable one nets it.
  - Savings never change Income, Living costs, Contributions, your share or Left over.
  - The Savings table sums to the summary's Savings line, typical and compared month.
  - `categoryDetail` for a Saving category matches its row, pairs included.
  - A v2 backup restores as v3 with identical figures, except that a Transfer-kind "Savings" category becomes a Variable Saving category. A Spend-kind "Savings" is left alone. Backups with `saving` and `savings` round-trip.
- e2e (Playwright with axe): mark an account as Savings from its card, confirm a pair, and check the Savings table and summary line on Typical month.
- `npm run check` passes.
