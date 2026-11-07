# Category suggestions from merchant names

## Why

The first import produces a long list of uncategorised buckets, and many belong to obvious national chains such as supermarkets, streaming services and coffee chains. Categorising each by hand is a slog. The owner wants a bucket whose name contains a well-known merchant to show a category suggestion, so that most obvious buckets take one keypress or one click.

Success means a bucket like `SAINSBURYS S/MKTS` shows "Groceries" as suggested on the categorise card and on the Buckets screen, and the user confirms it. A wrong suggestion is worse than none.

## Goals

- A bundled, owner-editable list of merchant names, each mapped to a spending category's default ID.
- A matcher that suggests a category for an uncategorised bucket from its normalised key.
- On the categorise card, the suggested category's button is marked "Suggested", and one key accepts it.
- On the Buckets screen, a **Suggested** column with an **Accept** button. The Buckets nav button is highlighted with a count while suggestions remain, in the same way as Transfers.

## Non-goals

- Suggestions for income, contribution, transfer or ignore categories. Only spending categories (`kind: 'spend'`) are suggested. This is the owner's decision.
- Edit-distance or typo-tolerant matching.
- Learning from the user's own choices. Buckets already remember their category for future imports.
- An "Accept all" button. Each suggestion is accepted one at a time, so a bad match never categorises many buckets unseen. The owner agreed.
- A way to dismiss or reject a suggestion. A wrong suggestion is corrected by choosing another category. A bucket deliberately left uncategorised keeps its suggestion. The owner agreed.
- Storing suggestions. Nothing about them is saved or backed up.

## Anti-goals

- A suggestion must never be applied without the user choosing it. "Automatic suggestions never overwrite a user's choice" (CLAUDE.md) holds: categorised buckets get no suggestion at all.
- No suggestion from a word that could name several kinds of business. The owner's example: `UNIVERSITY` could be a coffee shop on campus, not education. Bare generic words (`UNIVERSITY`, `RENT`, `LANDLORD`, `DENTIST`, `ATM`, `CAFE`) never appear as entries on their own.
- No suggestion from a bank's name. In the local spike, bank names caught transfers, interest and card payments. Bank and building society names are left out of the list.
- No network. The list is a JavaScript module served with the app, like `src/default-categories.js`.

## The merchant list

`src/merchants.js` is a data-only, owner-editable module, with no logic, in the style of `src/default-categories.js`:

```js
/** @type {{name: string, defaultId: string}[]} */
export default [
  { name: 'SAINSBURYS', defaultId: 'groceries' },
  { name: 'COSTA COFFEE', defaultId: 'coffee-shops' },
  // …
];
```

`defaultId` is the `id` of an entry in `src/default-categories.js` whose `kind` is `spend`.

(Decided during the build.) An entry may have `defaultId: null`, a block entry that stops suggestions for a name. This is for names such as retailer banks and cards (for example a supermarket's bank), whose names contain a grocery or shop brand. When the longest matches include a block entry, there is no suggestion.

### Source

1. **The owner's dataset.** The `merchant_name` and `label` columns of `synthetic_uk_transactions.csv` from the GitHub repository EmmaExcel/merchant-categorizer. The repository has no licence file. The owner has checked with the author that using it is fine. The builder may download it, once, as `raw.githubusercontent.com/EmmaExcel/merchant-categorizer/main/data/raw/synthetic_uk_transactions.csv`, into the scratchpad. It has 2,400 rows, 234 distinct merchant names and exactly the 21 labels in the table below, and each merchant has exactly one label. Only those two columns are taken, and the rest of the data is discarded. The CSV itself is not committed. A one-line comment in `src/merchants.js` credits the source by name. It must contain no URL, because `npm run banned` fails on `https://`.
2. **Claude's additions from general knowledge.** UK chains first, then international chains likely to appear on UK statements. Examples are supermarkets, high-street shops, restaurant and coffee chains, delivery apps, streaming and software subscriptions, airlines, hotels, fuel brands, utilities and insurers. Common bank-statement spellings count as separate entries, for example `AMZN MKTP`.

**Never sourced from the owner's statements (owner's rule).** Any merchant name may be added, including local and independent businesses, as long as it comes from the dataset or Claude's own knowledge and never from `fixtures/`. A name that also happens to appear in the owner's statements is fine. The builder must not read `fixtures/` while writing the list. Claude's call: the session that designed this has seen the statements and so adds no local or independent businesses itself, because it couldn't be sure where such a name came from. National and international chains are fine.

### What is dropped from the dataset

- **Labels that aren't spending:** `Salary`, `Transfers`, `Other`.
- **Invented employer names** used for salary rows: `ACME LIMITED`, `ACME LTD`, `GLOBEX CORP`, `INNOTECH LTD`, `NORTHWIND SERVICES`, `HALCYON GROUP`, `BLUEFIN SOLUTIONS`, `PRIME HIRE LTD`, and any similar names.
- **Bank and building society names**, such as `BARCLAYS`, `HSBC`, `LLOYDS`, `HALIFAX`, `NATIONWIDE` and `SANTANDER`. Named products such as `HALIFAX MORTGAGE` are kept.
- **Bare generic words**, as in the anti-goals.
- **Blank merchant names.**

### Label to category

Agreed with the owner on 2026-11-07. Where a starred question was left open, the dataset's label stands (Claude's call).

| Dataset label | `defaultId` | Notes |
|---|---|---|
| Groceries | `groceries` | M&S stays here. |
| Shopping | `shopping` | |
| Coffee Shops | `coffee-shops` | Greggs stays here. `CAFE LOCAL` is dropped. |
| Dining | `eating-out` | Except Domino's and delivery apps (Just Eat, Deliveroo, Uber Eats), which go to `takeaway`. |
| Transport | `transport` | |
| Fuel | `fuel` | |
| Charity | `charity` | |
| Subscriptions | `subscriptions` | |
| Travel | `holidays` | |
| Utilities | `utilities` | Includes broadband and mobile. Bare `THREE` is dropped. |
| Insurance | `insurance` | `PRUDENTIAL`, `LV` and `LV=` are dropped. |
| Healthcare | `health` | Boots and Superdrug stay here. `DENTAL`, `DENTIST` and `OPTICIANS` are dropped as generic words. |
| Entertainment | `entertainment` | Games stores stay here. |
| Education | `education` | Named institutions only. `UNIVERSITY`, `SCHOOL FEES` and `NURSERY FEES` are dropped. |
| Rent/Mortgage | `housing` | Named housing associations and mortgages only. `RENT`, `LANDLORD`, `MONTHLY RENT` and `MORTGAGE PAYMENT` are dropped. |
| Taxes | `income-tax`, `council-tax`, `car` | `HMRC` and `HM REVENUE & CUSTOMS` go to `income-tax`, `COUNCIL TAX` to `council-tax`, and `DVLA` to `car`. |
| Cash Withdrawal | `cash-withdrawals` | `LINK ATM` and `CASH MACHINE` only. Bare `ATM` is dropped. |
| Fees | `bank-fees` | Every entry is a bank name, so all of them are dropped. |
| Other | dropped | |
| Salary, Transfers | dropped | |

Also dropped: bare `NEXT` (use `NEXT RETAIL` and `NEXT DIRECTORY` instead) and `JL`.

The builder may move an individual entry to a better category where the dataset's label is plainly wrong. For example, a dataset `Entertainment` entry that is a subscription could become `subscriptions`.

## Matching

The matcher works on the bucket's keys (`Bucket.keys`), each one the output of `normalise()`. Dates, references, card fragments and processor prefixes such as `SQ *` are already gone from them.

**Several keys or none (Claude's call).** A merged bucket has several keys. Every key is matched, and longest-wins applies across all of them. If the longest matches point at different categories, there is no suggestion. `displayName` is never matched, so a bucket made by an amount rule (`keys: []`) gets no suggestion.

1. **Squash both sides** the same way:
   - Upper-case.
   - Drop apostrophes and full stops inside words: `SAINSBURY'S` becomes `SAINSBURYS`, and `M.S` becomes `MS`.
   - `&` becomes `AND`, and `+` becomes `PLUS`: `DISNEY+` becomes `DISNEY PLUS`, and `M&S` becomes `M AND S`.
   - Strip web prefixes and suffixes from each word: a leading `WWW.` or `WWW`, and a trailing `.CO.UK`, `.COM`, `.UK`, `.NET`, `.ORG`, or the same glued without dots (`COUK`). Examples: `WWW.EXAMPLE.CO.UK` becomes `EXAMPLE`, `EXAMPLECOUK` becomes `EXAMPLE`, and `NETFLIX.COM` becomes `NETFLIX`.
   - Every other non-alphanumeric run becomes one space.
2. **Whole words.** A merchant matches when its squashed words appear consecutively, as whole words, in the squashed key. `BA` matches `BA LONDON`, but not `BARCLAYS`.
3. **Glued words.** A merchant of two or more words also matches when its words joined without spaces equal one whole word of the key. For example, `JUST EAT` matches `JUSTEAT`.
4. **Longest wins.** When several merchants match, the one with the longest squashed name wins, so `AMAZON PRIME` beats `AMAZON`. If the longest matches point at different categories, there is no suggestion. (Decided during the build.) A block entry (`defaultId: null`) among the longest matches also gives no suggestion.
5. **Money out only.** A suggestion is offered only when the bucket's signed total over all its transactions is negative.
6. **The user's category.** The suggestion is the user's category whose `defaultId` equals the entry's `defaultId`. If the user has deleted that category, there is no suggestion. If the user has changed its kind away from `spend`, there is also no suggestion.
7. **Uncategorised only.** A bucket gets a suggestion only when the rest of the app treats it as uncategorised. That includes a bucket whose `categoryId` points at a deleted category, as in the existing code.

Suggestions are worked out when needed, and never stored. Editing `src/merchants.js` and pushing changes suggestions for every user straight away, including for buckets imported earlier. `DATA_VERSION` does not change, and backups are unaffected.

One module, for example `src/suggest.js`, does the matching. The card, the Buckets screen and the nav all use it, so they always agree. The builder decides how to index the list for speed. A few hundred buckets against under a thousand entries is small.

## The categorise card

- When the current bucket has a suggestion, its category button is visibly marked with the text "Suggested", next to or inside the button, not by colour alone. Its accessible name includes "suggested".
- **Enter accepts it** while focus is on the card itself (Claude's call). Number keys and clicks work as now. Enter on a focused button inside the card keeps its normal meaning.
- Accepting it does exactly what pressing that category's button does.

## The Buckets screen

- A new last column, **Suggested**, after Category. For an uncategorised bucket with a suggestion, it shows the category name and an **Accept** button whose accessible name is "Accept *category* for *bucket*". For every other row, the cell is blank. The column is shown whether or not the "uncategorised" filter is on. It is not sortable.
- Accept sets the bucket's category exactly as the Category select does, including the existing focus hand-off when the uncategorised filter will hide the row.
- Choosing a category in the select also removes the suggestion, because the bucket is no longer uncategorised.

## The nav

- While any uncategorised bucket has a suggestion, the Buckets button gets the `attention` style and a count, as Transfers does. Its accessible name is "Buckets, 12 suggestions" ("1 suggestion" when singular).
- The count is refreshed on every redraw. Clicking it opens Buckets as usual, with no filter change.

## Help

The Help screen gets a short paragraph explaining:
- where suggestions appear
- that they are only for spending
- that they come from a built-in list of well-known merchants
- that nothing is categorised until you accept

## Constraints

- All CLAUDE.md privacy and security rules apply. The list is static data. Render with `textContent`. No network.
- Nothing from `fixtures/` goes into code, tests, docs or commits. Tests use synthetic keys.
- Any new thresholds go in `src/tuning.js`, for example the minimum length for the glued-words rule if one is needed.

## Changes to CLAUDE.md

1. **In scope**, add: "Category suggestions for spending buckets, from a bundled list of merchant names (`src/merchants.js`). They are shown on the categorise card and the Buckets screen, and only applied when accepted."
2. **Out of scope**: change "Fuzzy matching" to "Edit-distance or typo-tolerant matching". Whole-word merchant matching with punctuation and web-prefix and suffix squashing is now in scope.
3. **Working rules, real statements:** clarify that the rule is about the source. Nothing *sourced from* `fixtures/` goes into code, tests, docs or commits. A merchant name that comes from somewhere else is fine, even if it also appears in a statement.

The main design spec, `2026-11-04-living-costs-design.md`, gets a short Suggestions subsection under Categorising, pointing here.

## Left to the builder

- The exact merchant entries, within the rules above. Aim for roughly 500 to 800, and favour precision over coverage.
- The squash implementation and indexing.
- The exact placement and styling of the "Suggested" mark on the card. It must work in light and dark themes and must not rely on colour alone.
- Whether `src/suggest.js` caches per redraw.

## Verification

- **Unit tests** (`node:test`) for squashing and matching, with synthetic keys. Cover whole words, short names such as `BA` and `EE` not matching inside words, apostrophes, `&`, `+`, `www.` prefixes, `.co.uk`, `.com` and glued `COUK` suffixes, glued multi-word names, longest-wins, ties giving nothing, money-in buckets giving nothing, categorised buckets giving nothing, a deleted category giving nothing, and a retyped category giving nothing.
- **A unit test validating `src/merchants.js`:**
  - every `defaultId` exists in `src/default-categories.js` with `kind: 'spend'`
  - no two entries have the same squashed name
  - no entry is in a small denylist of generic words and bank names, kept in the test
- **e2e (Playwright with axe):**
  - import a synthetic CSV containing known merchants
  - see the Buckets nav count, the Suggested column and Accept
  - accept one, and check that the count drops
  - see the Suggested mark on the card, press Enter, and check that the bucket is categorised
- **Local, not committed:** with the owner's consent, re-run a count-only check against `fixtures/`, reporting buckets matched and any that look wrong, with no names.
- `npm run check` passes.
