# Living Costs design

Date: 2026-11-04
Status: approved by the owner, 2026-11-04

This document builds on `CLAUDE.md`, which stays the source of truth for the privacy and security rules, CSP, hosting and verification. Where this design changes `CLAUDE.md`, the change is listed in [Changes to CLAUDE.md](#changes-to-claudemd). Updating `CLAUDE.md` to match is the first task of the plan.

Items marked **(Claude's call)** were decided by Claude during design. The owner didn't specify them, and they can be revisited.

## Intent

Three people each use the app in their own Chrome on macOS. Each has their own data, and nothing is shared or synced. Each imports about 12 months of statements from three or four accounts (current, savings, credit cards), then adds new statements every so often.

The question the app answers: **what does my standard of living actually cost per month, broken down by category?** That covers essentials and the things that make life good, such as holidays, eating out, takeaways, and household items like a new vacuum cleaner. With that figure, a person can decide how much income to keep for living and what's free for anything else. The app stops at the cost picture. It doesn't plan what the rest is spent on.

## Goals

- A **typical month** view: income, regular spending and what remains, with one row per category, monthly and yearly figures, and irregular spending spread fairly.
- A quick picture early on. You can stop categorising once most of the money is covered and see a useful result. Then you can work through the long tail later.
- Correct totals: transfers excluded, card spending counted at purchase, refunds offsetting spending, and no double counting.
- Statement data never leaves the browser, and users can trust that without taking the owner's word for it.

## Non-goals

Everything listed as out of scope in `CLAUDE.md`, plus:

- Planning or tracking what left-over money is spent on.
- PayPal statement import. PayPal isn't used enough to justify it.
- Sharing data between the three users.

## Anti-goals

- **Silent miscounting.** When the app is unsure, it leaves the item uncategorised or flagged, never guessed. Examples are an amount rule that matches more often than expected, or a near-duplicate row.
- **A complete-looking picture that isn't.** The typical month always shows how much spending is still uncategorised.
- **Any code path that could send data out**, including through a compromised package.

## Trust and how it gets made

Two threats drive the stack: a **compromised package**, and **keeping users' trust**. The code in the repo must be exactly what users run.

- **No build step and no runtime dependencies.** The site is `index.html`, plain ES modules under `src/`, one stylesheet, and `favicon.svg`. The CSV parser, normaliser and a small DOM-building helper are written in-house. The banned-pattern check in CI covers every line that ships.
- **Dev tooling never reaches users.** (Claude's call)
  - Tests: Playwright with `@axe-core/playwright` for end-to-end and accessibility, and `node:test` for unit tests. `node:test` is built into Node, so it needs no package.
  - Types: JSDoc annotations checked by `tsc --checkJs --noEmit`. `tsc` reports errors only and never writes files.
  - Installs: `npm ci --ignore-scripts` from a committed lockfile.
  - The owner runs `npm install`. Claude never does.
- **The deploy job never runs `npm`.** (Claude's call) It checks out the commit, copies the site files (`index.html`, `styles.css`, `favicon.svg`, `src/`) into the Pages artifact, and publishes them. Tests, type checks and the banned-pattern check run in separate jobs, which the deploy depends on and branch protection requires. A compromised dev package can break CI, but it can't change what ships. Third-party GitHub Actions are pinned by commit SHA.
- **Hosting comes later (owner's decision).** Development happens locally first, with no git remote. The dedicated origin, GitHub repo, `CNAME`, branch protection and deploy job are a final phase, started when the owner is ready. Until then:
  - Every check runs locally from `package.json` scripts: unit tests, `tsc`, the banned-pattern check (a dev-only Node script), and Playwright.
  - The GitHub Actions workflows are written but first run once the remote exists.
  - The owner tries the app at `http://localhost` using the same dev static server Playwright uses.
- **Look and accessibility follow Mortgage Split** (`~/git/shared-amortization-calculator`, https://mortgage-split.org/):
  - Style: system font stack, `#0b3d91` accent, white cards on a `#f4f4f2` page, and its colour tokens.
  - Interaction: 3px focus outlines, 32px minimum targets (WCAG 2.2 AA asks for 24px; owner's decision, as all users are on macOS with a mouse), and reflow at 320px without horizontal scroll. One exception (owner's decision): the six small nav buttons in the Explore and Set up groups are at least 24px, the WCAG 2.2 AA minimum.
  - Tests: axe against the WCAG 2.x A and AA tags, run on every screen and state the e2e tests reach.
  - Charts: decorative bars are `aria-hidden`, and the table is the data.
- **Single-key shortcuts**, such as the category number keys, are active only while focus is inside the categorise card. This meets WCAG 2.1.4.
- **Playwright runs on Chromium only (Claude's call)**, because all users are on Chrome. A tiny dev-only static file server in `tests/` (Node standard library) serves the site to Playwright, since ES modules don't load over `file://`.

## Concepts

- **Account:** a bank, savings or card account. It has a currency and a saved column mapping. A **placeholder account** stands in for a card whose statements aren't imported (see [Transfers and card repayments](#transfers-and-card-repayments)).
- **Import batch:** one imported file. Every transaction records its batch, and a batch can be undone.
- **Transaction:** one row, with raw text kept alongside normalised values.
- **Bucket:** transactions whose normalised text is the same. A bucket belongs to at most one category.
- **Category:** has a **kind** (`spend`, `income`, `contribution`, `transfer` or `ignore`). Spend, income and contribution categories also have a **budget type** (`fixed`, `variable`, `annual` or `oneoff`). Budget type lives **only** on the category.
- **Override:** a per-transaction exception. It either moves the transaction to another category or splits it across several categories. Overrides never change budget type.
- **Rule:** routes transactions to a bucket on import. A rule matches text and, optionally, an exact amount with an expected frequency.

Category resolution for a transaction, first match wins:

1. Confirmed transfer pair → treated as a transfer.
2. Split → each part counts in its own category.
3. Category override.
4. The bucket's category.
5. Otherwise, uncategorised.

## Data model

This replaces the starter model in `CLAUDE.md`. The builder may adjust field names.

```
Account        { id, name, currency, kind: bank | card | placeholder, mappingId?, repaymentBucketIds[] }
Mapping        { id, headerSignature, dateColumn, dateFormat, descriptionColumn, typeColumn?,
                 accountIdColumn?,
                 amount: { single: column, signFlipped: bool } | { debit: column, credit: column } }
Batch          { id, importId, accountId, fileName, fileHash, importedAt, rowCount, coversFrom, coversTo }
Transaction    { id, fingerprint, accountId, batchId, date, amountMinor, currency,
                 rawText, rawType?, bucketId }
Bucket         { id, key, displayName, categoryId?, categorySource, exampleRawTexts[], stoppedAfter? }
Rule           { id, pattern, matchType, amountMinor?, expected?: { count, period: week | month | year },
                 bucketId }
Category       { id, name, kind, budgetType?, defaultId? }
Override       { fingerprint, categoryId? , splits?: [{ amountMinor, categoryId }], unusualDismissed? }
TransferPair   { fingerprintA, fingerprintB, status: confirmed | rejected }
Settings       { offeredDefaultIds[], lastBackupAt?, schemaVersion }
```

- **Money:** `amountMinor` is an integer. Debits are negative and credits positive, whatever the source file's convention. Minor units come from the currency's exponent (GBP is 2), and no floats are used anywhere in parsing or arithmetic.
- **Fingerprint (Claude's call):** a stable identity that survives undoing an import, re-importing, and restoring a backup. It's built from `accountId | date | amountMinor | rawText | n`, where `n` is the ordinal among otherwise identical rows in that account. Overrides, transfer decisions and flagged-item decisions are keyed by fingerprint, not by transaction ID. Undoing a batch leaves them dormant, and re-importing the same rows reattaches them.
- **Storage:** IndexedDB with a single data version and upgrade steps (see `2026-11-06-data-versioning-design.md`). Request `navigator.storage.persist()` on first import.

## Import

- **Several files at once (owner's request):** the file picker and drop zone accept several files, as long as they're all for **one account**.
  - **Separate batches:** each file is still its own batch, with its own hash check, covered period and undo. The batches share an `importId`, so "Undo this import" can remove them all together, which helps if the account was wrong.
  - **One account per pick:** every file must have the same header signature. If any differs, the whole pick is refused, naming the odd file, and the user re-picks.
  - **Account check (Claude's call):** two accounts at the same bank share a header row, so the mapping can name an optional account-identifier column, such as Account Number. The value seen in the account's first import is remembered, and any file whose rows show a different value is refused. Formats without such a column rely on the user's account choice.
  - **Order:** files are processed in date order. Each is checked against what's already imported **and** the files before it in the same pick, so overlapping exports in one pick are handled like any other overlap.
  - **Confirming:** one table lists every file with its prefilled covered period to confirm or edit. One summary covers the whole pick, per file and in total: "N new, M already imported, K to review". Files that are blocked as already imported are named, and the rest proceed.
- **Choosing the account:** the user **always confirms the account**. The app suggests accounts whose saved mapping has the same header signature, which is the header row trimmed and lower-cased, with a BOM ignored. A new header opens the mapping form.
- **Mapping form:** the user picks:
  - the date column and date format (default `DD/MM/YYYY`)
  - the description column
  - an optional type column, kept as `rawType`
  - the amount style:
    - **single signed column**, with a "purchases are positive" switch for card files that flip the sign
    - **separate debit and credit columns**

  A preview of the first rows, as the app will read them, updates live.
- **Covered period (Claude's call):** every import asks "This file covers from … to …", prefilled from the first and last row dates, and the user can edit it. If every row falls in one calendar month, a one-click "Whole month (*Mon YYYY*)" choice is offered, because some banks export by month and the last transaction is rarely on the last day. This is stored on the batch. Savings accounts have few transactions, so first-to-last row dates understate what a file really covers. Without this, real coverage would look patchy and the typical-month window would shrink.
- **Parser:** must handle a BOM, quoted and unquoted fields, commas and quotes inside quotes, and CRLF or LF line endings. Amounts can look like `46`, `1.2`, `.51`, `+12.58` or `-1234.56`, and a literal `null` or empty value in an optional column counts as missing. Rows can appear out of date order, and the description can be empty. All four known formats use `DD/MM/YYYY` dates. Amounts may use UK style (`1,234.56`) or continental style (`1.234,56`), with or without thousands separators. Each value is read on its own, and the currency's decimal places settle values such as `1,234` that fit both styles. Where both styles still give different values, as `1,234` does in a 3-decimal currency, it is a parse error. Badly placed separators, spaces, apostrophes, currency symbols and parentheses are parse errors too, never a guess. Rows that fail to parse are listed with their row number, and the import can't continue until the user cancels or skips them.
- **Card files** with transaction and cleared dates use the **transaction date**, so card spending counts at purchase.
- **Accidental re-import** is caught in two layers:
  1. **The same file:** The app computes the SHA-256 of the file's bytes with `crypto.subtle` and checks it against every batch in every account, before parsing. A match is blocked with "This file was already imported on *date* into *account*". Nothing is changed. Undoing that batch removes its hash, so the file can be imported again deliberately.
  2. **The same rows in a different file**, for example a re-download, or an export whose dates overlap one already imported:
     - Rows whose fingerprint exactly matches an existing transaction in that account are skipped as already imported.
     - Rows that match an existing row on amount within the transaction-match window, but not exactly, are held for review. Candidates are ranked by text similarity, and the user chooses "same transaction" or "both are real".
     - Because the fingerprint includes the ordinal `n`, three identical same-day purchases match three existing ones. If a re-export has four, only the fourth is new.
     - Before anything is saved, the import summary says "N new, M already imported, K to review". If N is 0 and K is 0, nothing is saved and no batch is created.
- **Identical rows within one file** are always kept, because they're genuine repeat purchases.
- **Nothing is ever deleted automatically.**
- **Wrong account:** if the file's header signature doesn't match the chosen account's saved mapping, the app warns before importing.
- **Undo** removes a batch's transactions, or every batch from one multi-file import. Fingerprint-keyed decisions stay dormant.
- **Accounts-by-month table:** accounts as rows and months as columns. Each cell shows covered, partial or missing, with the transaction count. Placeholder accounts show "not itemised". Coverage comes from each batch's declared covered period. Coverage comes from each file's first and last transaction dates, so a quiet spell where two files meet looks like a gap. A gap of up to `coverageGapDays` between consecutive batches in one account counts as covered. A partial month whose previous and next months are both covered also counts as covered (owner's decision, 2026-11-06). A missing statement that runs across a month boundary leaves both months partial, so it is still shown.

## Extending formats

Import has two stages with a plain boundary between them:

1. **Reading the file:** the CSV parser turns bytes into a header row plus string rows. It knows nothing about banks.
2. **Mapping the rows:** the saved mapping turns string rows into transactions. Each bank's format is **data** (a mapping the user makes in the UI), not code.

How new formats fit in:

- **A new bank with ordinary CSV** needs no code change.
- **A new quirk** needs a new option in the mapping, a synthetic fixture that reproduces it, and tests. Examples are another date format, amounts written like `(12.00)`, or a separate DR/CR column. Each such option is a small, separate parse function, so adding one doesn't touch the others.
- **PDF, if ever needed,** would be another reader at stage 1, feeding the same mapping step. Nothing is built for it now, and PDF stays out of scope as in `CLAUDE.md`. Reading PDFs in the browser would probably need a third-party library, which would collide with the no-runtime-dependencies rule, so it would be a separate decision.

## Tuning values

Every window and threshold lives in one data-only module, `src/tuning.js`, which the owner edits and pushes in the same way as `src/default-categories.js`. Code reads these names and never hard-codes the numbers. The values below are the starting ones (Claude's call).

```js
export default {
  windowMonths: 12,           // typical month: latest N complete months
  variableRange: [25, 75],    // variable: typical range as percentiles
  unusualMonthPercent: 25,    // open category: a month this % away from its row's median is marked unusual
  transactionMatchDays: 3,    // transfer pairs and overlapping-row matches: ± days
  coverageGapDays: 21,        // gap between batches in one account still counted as covered
  unusualMultiple: 5,         // unusual amount: more than N × the bucket median…
  unusualMinMajor: 100,       // …and at least this many major currency units
  relatedMinWordLength: 3,    // "Looks related": shared whole word of at least N letters
  relatedStopWords: ['THE', 'LTD', 'LIMITED', 'STORES', 'UK', 'CO', 'AND'],
  relatedMaxShown: 3,
  repeatingMinCount: 3,       // "Repeating amounts": same amount at least N times
  firstTenKeys: true,         // number-key shortcuts on the categorise card
};
```

- **Validation:** a unit test checks every key is present, typed correctly and in a sensible range, so a typo can't ship.
- **Effect on stored data:** changing a value only changes how results are calculated and suggested. It never rewrites stored data or user decisions.
- **Not included:** the normaliser's prefix and token lists stay in the normaliser module, because changing them changes bucket keys and needs a normaliser version bump.
- **No in-app settings screen.** The values are for the owner to edit, like the category list.

## Normalisation and buckets

Normaliser v1 works in this order. Prefer too many buckets over wrong merges.

1. Upper-case the text and collapse whitespace.
2. Strip processor and bank prefixes, keeping the merchant. The list lives in one module so it's easy to extend: `PAYPAL *`, `SQ *`, `SP `, `MOLLIE *`, `ZETTLE_*`, `SUMUP *`, and the bank-added `CARD PURCHASE `.
3. Strip a trailing `*` reference token, for example `AMAZON.CO.UK*AB12CD34E` → `AMAZON.CO.UK` and `PAYPAL *SPOTIFY*X9Q2W7` → `SPOTIFY`.
4. Remove date tokens such as `05MAR26`, `01/10/2026` and `01OCT`, sort-code patterns, and card fragments. Then split on whitespace and hyphens and drop every piece containing a run of 4 or more digits. This removes store numbers, account numbers, and references like `CB1234567890` or `REF-202601-99887766` whole, rather than leaving fragments such as `CB`. Pieces with fewer digits, like `3WGC` or `INV83`, stay.
5. Trim trailing `...` and stray punctuation, including lone `&` and `-`. Leave truncated words as they are.
6. If nothing is left, use the type column, for example `SO (NO DESCRIPTION)` (Claude's call).

The result is the bucket key. The normaliser is versioned, and buckets keep up to five raw example texts so rules can be migrated.

## Categorising

### The categorise card (the main way of working)

The card shows uncategorised buckets **one at a time, largest absolute total first**, so a salary bucket comes up as early as a big spending bucket (Claude's call). Progress at the top is by value: "£X of £Y categorised (Z%)", plus the count of buckets left. It counts debits and credits by absolute value over the typical-month window, excluding confirmed transfers. "Skip for now" and "Stop here" are always available, beside the bucket name.

Each card shows:

- The bucket name, its total over the window, its transaction count, and an approximate monthly amount.
- Two or three raw example rows.
- **Every category as a button**, wrapping as needed, in the same order on every card. Keys 1–9 and 0 cover the first ten, and Tab or click covers the rest. "New category…" sits at the end.
- **Looks related:** up to `relatedMaxShown` other buckets, categorised or not, that share a whole word of at least `relatedMinWordLength` letters with this bucket, each with "Merge into this". This is plain word matching, not fuzzy matching. Common words in `relatedStopWords` are excluded.
- **Unusual amounts:** transactions above `unusualMultiple` × the bucket's median that are also at least `unusualMinMajor` major currency units. Each offers "Move to another category…" or "It's normal".
- **Repeating amounts:** shown when a bucket mixes amounts and one exact amount repeats at least `repeatingMinCount` times at a regular interval, for example "£2.99, 12 times, monthly". "Make this its own bucket" creates an amount rule (see below). This is mainly for masked buckets such as `PAYPAL PAYMENT`.
- **Flagged rows** from amount rules (see below), waiting for confirmation.

### All buckets

A searchable, sortable list of every bucket. Show narrows it to uncategorised buckets, or to those with a suggested category. This list also covers `CLAUDE.md`'s "simple list of uncategorised items".

- **Uses:** working through the long tail, changing a category later, and merging buckets the card didn't link. For example, `AMAZON.CO.UK` and `AMZNMKTPLACE` share no word.
- **Merging:** select buckets, choose "Merge selected…", then pick the name and category to keep. Merged keys and rules point to the surviving bucket. Overrides survive.
- **Drilling in:** opening a bucket shows its transactions.

### Transactions and overrides

Any list of transactions has a **Counts as** column. It shows the category and where it came from (bucket, override, split, or transfer), and it can be changed there.

- **Move to another category:** a category override for that one transaction. For example, an annual insurance payment inside the Tesco bucket can move to Insurance.
- **Split:** divides one transaction into parts, each with an amount and a category, and the parts must sum to the total. It's meant for Amazon orders and is available on any transaction.
- **Reset:** the Counts as menu always offers "Use bucket's category (*name*)". This clears a category move or a split.
- **Precedence:** overrides always beat the bucket's category, even after the bucket is recategorised.

**Finding one transaction (owner's request).** For opaque buckets like Amazon, the expected workflow is categorising by exception:

1. Put the whole bucket in its most common category, for example Household.
2. Read through the Amazon order history.
3. For each order that belongs elsewhere, find its charge in the app and move or split it.

To make step 3 quick:

- **Search** on the Transactions screen, and inside an opened bucket, matches any of:
  - description text
  - an amount, typed as it appears on the order, such as `60.69` or `£60.69`, ignoring sign
  - a date, such as `24/09` or `24/09/2026`
- **Filters:** a bucket filter and a date range narrow the list.
- **Nearby dates:** a typed date matches anything within ±`transactionMatchDays` of it, nearest first. Amazon charges per shipment, often a day or two after the order, so the charge may not match the order date. It may not match the order total either, so searching by date within the bucket is the fallback.

Results show date, raw text, amount and Counts as, so the change can be made right there.

There is no "mark as one-off" action. Something that truly sits outside the typical year, such as a boiler replacement, is moved to a category whose type is One-off.

### Amount rules

For masked text such as `PAYPAL PAYMENT`:

- **Creating one:** "Make this its own bucket" on a repeating amount creates a bucket named by the user, for example "Google One storage (via PayPal)", and a rule `{ pattern, amountMinor, expected }`. The expected frequency comes from the history, for example once a month, and the user can edit it.
- **On import:** the rule routes up to the expected count per period to its bucket. Extra matches stay in the source bucket, flagged "Matched *Google One storage*, but it already had a payment this month". They appear on the card until the user confirms or reassigns them.
- **When the price changes:** the rule stops matching, so new payments land back in the source bucket as uncategorised.

This check is deliberately narrow: it only runs at import, and only for amount rules. General recurring-charge alerts stay out of scope.

### Suggestions

Uncategorised spending buckets can show a suggested category, taken from a bundled list of merchant names in `src/merchants.js`. A suggestion is only applied when the user accepts it; see `2026-11-07-merchant-suggestions-design.md` for the design.

### Categories and defaults

Categories can be created, renamed, deleted (with reassignment) and retyped on a Categories screen. The kind and budget type can be changed at any time, and the typical month recalculates.

**Default categories** live in `src/default-categories.js`. It's a data-only module the owner edits and pushes, with no build step. It isn't a YAML or JSON file, because CSP `connect-src 'none'` blocks loading one. Each entry looks like `{ id, name, kind, budgetType? }`.

- **Validation:** a unit test checks that IDs and names are unique and that kinds and budget types are valid.
- **First run:** all defaults are copied into the user's categories, and their IDs are recorded in `offeredDefaultIds`.
- **Later runs:** IDs missing from `offeredDefaultIds` are offered once in a notice, "New suggested categories: …", with Add and Dismiss. Either choice records them as offered.
- **Edits to the file:** renames or type changes in the file never touch an existing user's category. Removing an entry from the file does nothing to existing categories.

**Starting list, which the owner can edit.** The first 25 were Claude's call. On 2026-11-07 the owner added Coffee shops, Fuel and Hobbies, and approved Shopping, Charity, Bank fees, Cash withdrawals, Income tax and Education, after a comparison with a public synthetic UK transaction dataset. The first ten categories get the number keys on the Categorise card, so rarely used entries go after Big one-offs.

| Kind | Name | Budget type |
|---|---|---|
| Income | Salary | Fixed |
| Income | Other income | Variable |
| Contribution | Contributions from others | Fixed |
| Spend | Housing (rent or mortgage) | Fixed |
| Spend | Council tax | Fixed |
| Spend | Utilities | Fixed |
| Spend | Insurance | Annual |
| Spend | Groceries | Variable |
| Spend | Eating out | Variable |
| Spend | Takeaway | Variable |
| Spend | Coffee shops | Variable |
| Spend | Transport | Variable |
| Spend | Car | Fixed |
| Spend | Fuel | Variable |
| Spend | Subscriptions | Fixed |
| Spend | Health | Variable |
| Spend | Personal care | Variable |
| Spend | Clothing | Annual |
| Spend | Entertainment | Variable |
| Spend | Hobbies | Variable |
| Spend | Gifts | Annual |
| Spend | Holidays | Annual |
| Spend | Household maintenance | Annual |
| Spend | Joint household | Fixed |
| Spend | Big one-offs | One-off |
| Spend | Shopping | Variable |
| Spend | Charity | Variable |
| Spend | Bank fees | Variable |
| Spend | Cash withdrawals | Variable |
| Spend | Income tax | Annual |
| Spend | Education | Annual |
| Transfer | Between my accounts | (none) |
| Transfer | Card repayments | (none) |
| Ignore | Ignore | (none) |

## Transfers and card repayments

- **Suggested pairs:** equal and opposite amounts in two different accounts within ±`transactionMatchDays`. They appear on a Transfers screen, and the user confirms or rejects each one. "Confirm all" is available.
  - Confirmed pairs are excluded from all totals.
  - A rejected pair is never suggested again.
  - A card's "payment received" row and the bank's repayment row are paired the same way.
- **Transfers to an account that isn't imported:** the user decides. Putting the bucket in a Transfer-kind category excludes it, and putting it in a spend category counts it.
- **Repayments to a card that isn't imported:**
  - The user marks the repayment bucket (for example `EXAMPLE CARD PLC`) as "repays a card I'm not importing". The app creates a **placeholder account** for that card, plus a spend category "*Card name* (not itemised)" of type Variable. It links the bucket to both.
  - Each repayment in that bucket counts as spending in the not-itemised category **unless** it's part of a confirmed transfer pair.
  - When the card's statements are imported later, the user attaches them to the placeholder account, which then becomes a normal card account. The repayments for those months get suggested transfer pairs. Once they're confirmed, the itemised purchases count instead. Earlier months stay as lumped spending. No manual reclassification is needed.
  - **Known edge:** in the first itemised month, a repayment usually pays for purchases made before card coverage starts, so that month can be slightly under-counted. The accounts-by-month table shows where coverage starts.
- **Joint accounts (owner's decision):** the people sharing a joint account agree which one of them imports it. Nothing is shared or synced between browsers, so this is a human agreement, not a feature.
  - **The person who imports it (A):** A's own payments into it pair with A's other accounts as transfers. Another person's payments into it go in a **contribution** category, such as "Contributions from others". All the joint account's spending counts in A's categories as usual, and the typical month shows A's own share: living costs, less contributions, gives your share.
  - **Anyone who doesn't import it (B):** B's payments to the joint account go in a spend category such as "Joint household", with type Fixed. That's B's share of household living costs, and it counts as such. There's no offsetting income, and no synthetic transactions on either side.
- **Debits and credits** are tracked separately. A credit in a spend category is a refund and offsets that category in its month. It never counts as income.

## Typical month

This is the payoff screen.

### Window

The window is up to the latest **`windowMonths` complete months** (12 to start), stated in the heading, for example "Based on 12 complete months, Nov 2025 to Oct 2026".

A month is complete when at least one non-placeholder account covers the whole of it, by the table's rule above. A gap in one account doesn't remove the month for the others: each account counts only the months it covers itself (D1). (Owner's decision, 2026-11-06. It replaces Claude's earlier rule, under which one account's partial month removed that month for every account.) If fewer than `windowMonths` complete months exist, the heading says so, and annual figures are scaled by 12 ÷ n.

### Layout

- **Summary:** figures at the top: **Income**, **Regular spending**, and **Remaining** (income minus regular spending). When any contribution-kind category has transactions, Regular spending expands to three lines: "Regular spending £X", "less contributions from others £Y", and "your share £Z". Remaining is then income minus your share. Remaining is the same size as Regular spending, under a solid rule. (Owner's decision, 2026-11-07: "Regular spending" and "Remaining" replace "Living costs" and "Left over", which no longer described the figures once savings were counted. The main table's heading follows. The app is still called Living Costs.)
- **Remaining's parts:** under Remaining, always shown, each net money out per month:
  - **saved:** the Savings table's total
  - **one-offs:** One-off categories, net of one-off income
  - **uncategorised:** uncategorised spending minus uncategorised income
  - **ignored:** Ignore-kind categories
  - **not accounted for:** Remaining minus the four parts above. It can be negative. Help text below the card explains it: "not accounted for: typical month vs actual months, and money in accounts not tracked". (Owner's decision, 2026-11-10: a note inside the card made it look cluttered.)

  A part with no transactions shows a dash, read as "none", not £0.00. One-offs, uncategorised and ignored follow D1: each account's total over its own months, added up. When comparing a month, each part shows that month's figure and the change. A part with no transactions in either counts as 0 against the other, and with none in both, every column shows a dash. Transfers are in no part. A transfer to an account that isn't tracked counts under "ignored" only when it's in an Ignore category. Otherwise it falls into "not accounted for". The owner checks by eye that "not accounted for" isn't large, and there's no warning. (Owner's decision, 2026-11-07. It replaces the separate Savings line, which counted saving outside Left over.)
- **Main table:** one row per spend category, largest first, with:
  - the budget type, plus the typical range for Variable or the yearly total for Annual
  - **Per month** and **Per year**
  - a decorative proportional bar

  Income categories go in their own table, using the same types. Contribution categories go in a third small table, also using the same types. The three tables' columns line up: each column takes the width of its widest cell across all three.
- **Ticked total:** each row starts with a tick box. Ticked is the same size as Regular spending, set apart by a dashed accent rule. While any are ticked, the summary ends with "Ticked (n categories)", the plain sum of the ticked rows' per-month figures, whichever table they are in (and their month figure and change when comparing a month). A ticked category that isn't in the tables for the current window isn't counted. Ticks aren't saved: like the window, they survive opening a category, changing the window and the nav, and clear when the page reloads. (Owner's request, 2026-11-06.)
- **One-offs:** a separate list below the main table. Each row shows the transaction, its category, its month and its amount. One-offs are excluded from Regular spending, and shown as a part of Remaining.
- **Uncategorised line:** "Uncategorised: £X spending and £Y income over the window are not included", linking to the categorise card. It covers income too, so "Remaining" never looks complete while income is missing.
- **Excluded:** transfers and incomplete months. Ignore-kind categories are left out of the tables and shown only as a part of Remaining.

### Calculation per category

Category totals are net of refunds. Each type is worked out as follows (Claude's call on the details):

- **Fixed:** the sum over the category's buckets of each bucket's monthly equivalent: its most recent charge × its charges per year ÷ 12. Charges per year come from the bucket's history in the window. A weekly £90 standing order counts as £390 a month, not as £360 or £450, depending on whether the last month had four or five Mondays. Every bucket with a charge in the window counts. A bucket the user marks Stopped adds nothing, and a newer charge on import clears the mark. Each bucket's figure is never below 0. Transactions moved into a fixed category by override are grouped by bucket in the same way. The opened category view is described in `2026-11-05-open-category-design.md`.
- **Variable:** the median of the category's monthly totals across the window. The typical range is the `variableRange` percentiles, which start as the lower and upper quartiles.
- **Annual:** the window total ÷ the number of months in the window. Per year is the window total, scaled to 12 months.
- **One-off:** excluded from the table and listed below it.

**Currency:** if accounts use more than one currency, the typical month shows a warning and doesn't add them together (Claude's call). Converting between currencies is out of scope.

## Backup and restore

As in `CLAUDE.md`, with these additions:

- **Contents:** accounts and mappings, buckets, rules (including amount rules), categories, `offeredDefaultIds`, transfer decisions, all fingerprint-keyed overrides (category moves, splits, dismissed unusual-amount flags, and decisions on flagged amount-rule rows), and every transaction and import batch.
- **Transactions and batches (changed 2026-11-06, owner's decision):** every backup holds both lists, in the one `living-costs-backup-YYYY-MM-DD.json` file. Restoring needs no re-import, and they're restored as saved, without re-bucketing. Undo by batch and the identical-file block still work. Validation checks that every transaction's account, batch, bucket and flagged rule exist, that it's in its batch's account and currency, and that each batch's row count matches the transactions it holds. Repeated fingerprints are allowed, because overlapping imports can legitimately repeat one.
- **Data version:** backups carry the same `DATA_VERSION` as stored data (`src/version.js`). The version 2 format is the first; no earlier backups existed. See `2026-11-06-data-versioning-design.md`.
- **Restore:** upgrades an older backup to the current version, using the same steps as stored data, then validates the structure. A backup from a newer version is refused. It then **replaces** all data after an explicit confirmation (Claude's call: no merging).
- **Saving:** uses `showSaveFilePicker()`, with a download as the fallback. The UI shows the last backup date and warns that a Google Drive copy isn't encrypted and holds every imported transaction, with dates, amounts and descriptions.

## Screens

There's a simple top navigation (owner's design). The three main screens, Help, Typical month and Categorise, are full-size tabs along the bottom of the header. The other six are smaller buttons in two labelled groups on the title row: **Explore** (Buckets, Transactions, Transfers, Categories) and **Set up** (Accounts, Backup). The owner chose the Explore name and moved Categories into it. Only the current screen is highlighted. While transfer suggestions remain, the Transfers button is yellow and shows their count, read as "Transfers, 3 suggestions". The Categorise tab shows the categorised percent from the Categorise screen, as "Categorise (at 56%)". It's hidden whenever that screen hides it. Both are refreshed on every redraw.


- **Help:** the first panel (owner's request). It's a short, plain page covering:
  - **What this app is for:** the typical month.
  - **What you'll need:** about 12 months of CSV statements from each current, savings and card account, and where to download them.
  - **Privacy:** everything stays in this browser.
  - **The steps:**
    1. Import each account.
    2. Confirm transfers.
    3. Categorise the biggest buckets until progress looks good enough.
    4. Read the typical month.
    5. Back up.
    6. Later, import new statements and work through the long tail.

  Help shows on first launch, with a "Got it" button that dismisses it. After that it's always available from the navigation. It shows again automatically whenever there's no data, for example after undoing every import or deleting all data (Claude's call). The dismissed state is stored in Settings and isn't backed up. The text is static and lives in `index.html` or a module, not in data.
- **Typical month:** the home screen once data exists and Help has been dismissed.
- **Categorise:** the card.
- **Buckets:** the all-buckets list.
- **Transactions:** a searchable list with Counts as.
- **Transfers:** suggested pairs and placeholder cards.
- **Accounts:** the accounts list, the accounts-by-month table, and Import and Undo.
- **Categories.**
- **Backup:** backup and restore.

Before any data exists, the app opens on Help, which leads to Import.

Rough mockups from the design conversation are in `.superpowers/brainstorm/` (gitignored, local only).

## Test data

- **Real statements stay local.** They live in `fixtures/`, which is gitignored. With the owner's consent, Claude may read them to learn formats. Nothing from them (rows, names, merchants, amounts, account numbers or filenames) may appear in code, tests, docs or commits.
- **`.gitignore`** blocks real downloads by pattern (Claude's call):
  - `*.csv` everywhere except `tests/fixtures/*.csv`
  - backup files, `living-costs-backup*.json` and `living-costs-full-backup*.json` (the second is the older full-backup name)

  This covers the four real export naming styles: account-number-and-date names, card-digits-and-date names, a generic `Statements.csv`, and `Transactions_Export_<Mon>_<YYYY>_<digits>.csv`.
- **Committed fixtures are synthesized from scratch** in `tests/fixtures/`. All use `DD/MM/YYYY` dates. Together they reproduce every quirk of the four real formats:
  - **Bank current account:** headers `Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance`. Separate debit and credit columns, the sort code with a leading `'`, decimals like `.51`, and blank types and descriptions.
  - **Bank savings account:** headers `Transaction Date,Transaction Type,Transaction Description,Amount,Balance`. A signed amount with explicit `+`, a literal `null` type, and descriptions that include a date token and an account number.
  - **Credit card:** a UTF-8 BOM, every field quoted, and headers `"Transaction Date","Transaction Cleared Date","Transaction Type","Transaction Description","Transaction Amount"`. Purchases are positive and payments and refunds negative, amounts look like `46` and `1.2`, rows are ordered by cleared date, and some types are `Not Available`.
  - **Second bank's current account (exported by month):** headers `Date,Details,Transaction Type,In,Out,Balance`. No BOM, unquoted, LF line endings, and amounts always to 2 decimal places. Credit (`In`) comes before debit (`Out`), the reverse of the first bank. There's no account-identifier column, and types are long phrases such as `Card Transaction`, `Standing Order` and `BACS Payment Received`.
  - **Descriptions:**
    - processor prefixes, the bank-added `Card Purchase ` prefix, `*REF` suffixes, and store numbers
    - space-separated references like `GAMESHOP CB1234567890` that differ on every row
    - long hyphenated benefit-style references with `&--&` and digits that change each month
    - personal payee names on standing orders
    - truncated text ending in `...`, and HTML in a description
  - **Transactions:** a refund, identical same-day purchases, masked `PAYPAL PAYMENT` subscriptions, an extra masked payment in one month to trigger the amount-rule flag, and a **weekly** standing order (to test the fixed monthly equivalent).
  - **Across files:** a same-day transfer pair between the two banks' current accounts, a monthly contribution from another person into the second bank's (joint) account, a savings-to-current transfer pair a day apart, a card payment matching a bank repayment a day apart, repayments to an untracked card, an overlapping re-export of one month, and an unusually large purchase in a grocery bucket.
- **Reconciliation:** the expected totals per category and per month are written down alongside the fixtures, so the reconciliation tests have a known answer.
- **Unit tests** (`node:test`) cover:
  - the parser and amount parsing
  - the normaliser
  - fingerprints
  - duplicate and overlap detection
  - transfer suggestion
  - amount rules and frequency flags
  - the typical-month calculations
  - backup validation
  - `default-categories.js`
- **End-to-end tests** (Playwright and axe) cover:
  - importing the three fixtures
  - categorising
  - a merge, a split, and an override
  - confirming transfers
  - the typical-month figures
  - backup and restore
  - axe checks, 320px reflow, 32px targets, and focus outlines
  - **no requests after the initial page load**, using Playwright request interception

## Changes to CLAUDE.md

These were agreed with the owner during design:

1. Budget type lives **only** on the category. It isn't set on a bucket, and it isn't overridden per transaction.
2. A per-transaction override changes the **category only**, or splits the transaction.
3. **New:** splitting a transaction across categories, for example an Amazon order. Splits are backed up.
4. Rules can match **text plus an exact amount**, with an **expected frequency**. Extra matches are flagged, not assigned.
5. Default categories come from an editable module, `src/default-categories.js`. New entries are offered once to existing users, and existing users' choices are never overwritten.
6. Dev-only tooling is allowed: Playwright with axe, `node:test`, and `tsc --checkJs`. The deploy job never runs `npm`.
7. Repayments to a card whose statements aren't imported count as spending in a "not itemised" category, until that card's statements are imported and the repayments are paired as transfers.
8. Real statements in `fixtures/` (gitignored) may be read locally with the owner's consent. Committed test fixtures are synthetic.
9. Hosting is a final phase. Build and check everything locally first. The dedicated origin, remote, branch protection and deploy come when the owner is ready.
10. All windows and thresholds live in an owner-editable module, `src/tuning.js`.
11. **New category kind, `contribution`,** for money another person pays into an account you track, such as a partner's share into a joint account. It reduces your share of living costs instead of counting as income.

These were decided by Claude, and the owner can revisit them:

12. The data model above replaces the starter model, adding Mapping, Batch (with a declared covered period), fingerprint-keyed Override, TransferPair, Settings and placeholder accounts.
13. Budget-type key `annual` covers "Irregular or annual", and the one-off type is a category.

The plan's first task updates `CLAUDE.md` to reflect all of the above.

## Left to the builder

- Module layout under `src/`, IndexedDB store layout and indexes, and how the DOM helper looks.
- The text-similarity measure used to rank overlap candidates, and the exact stop-list, prefix list and date-token patterns. All must be covered by fixtures.
- How the repeating-amount detector decides "regular interval".
- Visual details beyond the Mortgage Split look, within the accessibility rules.
- The wording of all UI text, which should be short and plain.
