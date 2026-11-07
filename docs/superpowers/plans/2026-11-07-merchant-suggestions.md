# Merchant Category Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suggest a spending category for uncategorised buckets whose keys contain a well-known merchant name. The suggestion is shown on the categorise card, on the Buckets screen and in the nav, and is applied only when the user accepts it.

**Architecture:** `src/merchants.js` is a data-only list of `{ name, defaultId }`. `src/suggest.js` squashes text, matches bucket keys against the list, and turns a match into the user's category. Nothing is stored. The nav, `src/ui/buckets.js` and `src/ui/categorise.js` all call `bucketSuggestions(state)`.

**Tech Stack:** Vanilla ES modules with no build step, JSDoc types checked by `tsc --checkJs`, `node:test`, and Playwright with `@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-11-07-merchant-suggestions-design.md`. Read it first. The label-to-category table and the drop rules in it are binding.

## Global Constraints

- No network code. No `innerHTML` and its relatives. Render with `textContent`, using `h()` from `src/dom.js`.
- No URL anywhere in `src/`, because `npm run banned` fails on `https://`. The dataset credit is a comment naming "EmmaExcel/merchant-categorizer on GitHub" without a URL.
- **Never read `fixtures/`.** No merchant name may be sourced from it. Tests use the synthetic `tests/fixtures/` data or made-up keys.
- `DATA_VERSION` does not change. Nothing new is stored or backed up.
- Only categories with `kind: 'spend'` are suggested. Suggestions are only for buckets the app treats as uncategorised: `categoryId` is undefined, or it points at a category that no longer exists.
- No new thresholds are expected. If one is needed, it goes in `src/tuning.js`.
- Every check passes: `npm run check` (banned, unit, types, e2e).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A short name inside a longer word.** `BA` must not match inside `BARCLAYS`, `EE` inside `FEES`, or `O2` inside `CO2`. Covered in Task 1 tests.
2. **A bucket whose category was deleted** counts as uncategorised elsewhere in the app, so it must get a suggestion. Covered in Task 2 tests.
3. **A renamed default category** must still be suggested, because matching is by `defaultId`. A default that was dismissed and never added gives no suggestion. Covered in Task 2 tests.
4. **A bucket whose signed total is zero**, for example a purchase fully refunded, gives no suggestion, because the total must be strictly negative. Covered in Task 2 tests.
5. **Accept on the Buckets screen while "Only uncategorised" is on.** The row disappears, so focus must move to a neighbour, and a second quick Accept must not be lost. Covered in Task 4 e2e.

---

### Task 1: Squash and match

**Files:**
- Create: `src/suggest.js`
- Test: `tests/unit/suggest.test.js`

**Interfaces:**
- Produces:
  - `squash(text: string): string`
  - `matchKeys(keys: string[], merchants: {name:string, defaultId:string}[]): string | null`, which returns the winning `defaultId`, or `null` for no match or a tie between different categories.

- [ ] **Step 1: Write the failing tests** in `tests/unit/suggest.test.js`, using a small inline list such as:

```js
const M = [
  { name: 'SAINSBURYS', defaultId: 'groceries' }, { name: 'AMAZON', defaultId: 'shopping' },
  { name: 'AMAZON PRIME', defaultId: 'subscriptions' }, { name: 'BA', defaultId: 'holidays' },
  { name: 'EE', defaultId: 'utilities' }, { name: 'O2', defaultId: 'utilities' },
  { name: 'JUST EAT', defaultId: 'takeaway' }, { name: 'DISNEY+', defaultId: 'subscriptions' },
  { name: 'M&S', defaultId: 'groceries' }, { name: 'APPLE.COM/BILL', defaultId: 'subscriptions' },
  { name: 'SHELL', defaultId: 'fuel' }, { name: 'TESCO', defaultId: 'groceries' },
];
```

Assertions:
- `squash("SAINSBURY'S")` is `'SAINSBURYS'`, and so is `squash('Sainsbury’s')`.
- `squash('DISNEY+')` is `'DISNEY PLUS'`.
- `squash('M&S SIMPLY FOOD')` is `'M AND S SIMPLY FOOD'`.
- `squash('WWW.EXAMPLE.CO.UK')` is `'EXAMPLE'`.
- `squash('EXAMPLECOUK')` is `'EXAMPLE'`.
- `squash('NETFLIX.COM')` is `'NETFLIX'`.
- `squash('APPLE.COM/BILL')` is `'APPLE BILL'`.
- `squash('E.ON NEXT')` is `'EON NEXT'`.
- `squash('LV=')` is `'LV'`.
- `squash('SITCOM')` is `'SITCOM'`, because only `COUK` is stripped when glued.
- `matchKeys(['SAINSBURYS S/MKTS'], M)` is `'groceries'`.
- `matchKeys(['AMAZON.CO.UK'], M)` is `'shopping'`.
- `matchKeys(['AMAZON PRIME UK'], M)` is `'subscriptions'` (longest wins).
- `matchKeys(['BARCLAYS'], M)`, `matchKeys(['BANK FEES'], M)` and `matchKeys(['CO2 OFFSET'], M)` are all `null`.
- `matchKeys(['BA LONDON'], M)` is `'holidays'`.
- `matchKeys(['JUSTEAT'], M)` and `matchKeys(['JUSTEATCOUK'], M)` are `'takeaway'` (glued words).
- `matchKeys(['WWW.JUST-EAT.CO.UK'], M)` is `'takeaway'`.
- `matchKeys(['TESCO', 'SHELL'], M)` is `null` (equal length, different categories, across keys).
- `matchKeys(['TESCO', 'M&S'], M)` is `'groceries'` (longest across keys, same category).
- `matchKeys([], M)` is `null`.
- `matchKeys(['NOTHING HERE'], M)` is `null`.

- [ ] **Step 2: Run** `node --test tests/unit/suggest.test.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `squash` and `matchKeys` in `src/suggest.js`.** The algorithm for `squash`, which the tests don't fully pin:

```
upper-case
& → " AND ", + → " PLUS "
split into tokens on every run of characters other than A–Z, 0–9, "." and apostrophes (' ’)
for each token:
  strip a leading "WWW." or "WWW"
  strip a trailing ".CO.UK", ".COM", ".UK", ".NET" or ".ORG"
  delete the remaining "." and apostrophes
  strip a trailing glued "COUK" when something is left before it
drop empty tokens, join with one space
```

`matchKeys`:
- Squash each key and pad it with spaces.
- A merchant hits when its padded squashed name is contained in the padded key. A multi-word merchant also hits when its squashed words, joined without spaces, equal one whole token of the key.
- Across every key, keep the hits with the greatest squashed-name length. Return their `defaultId` if they all agree, and `null` otherwise.
- Cache each list's squashed names in a `WeakMap` keyed by the array.

- [ ] **Step 4: Run** `node --test tests/unit/suggest.test.js`. Expected: PASS.

- [ ] **Step 5: Run** `npm run types`. Expected: no errors.

- [ ] **Step 6: Commit**: `git add src/suggest.js tests/unit/suggest.test.js && git commit -m "Merchant matcher: squash text and match bucket keys"`

### Task 2: Suggestions over the app state

**Files:**
- Modify: `src/suggest.js`
- Create: `src/merchants.js`, as a stub with a header comment and `export default []` (Task 3 fills it).
- Test: `tests/unit/suggest.test.js`

**Interfaces:**
- Consumes: `matchKeys` from Task 1.
- Produces:
  - `suggestCategory(state: State, bucket: Bucket, merchants = MERCHANTS): Category | null`
  - `bucketSuggestions(state: State, merchants = MERCHANTS): Map<string, Category>`, keyed by bucket id, with an entry only for buckets that have a suggestion.

  `MERCHANTS` is the default export of `src/merchants.js`.

- [ ] **Step 1: Write the failing tests.** Build the state with `emptyState`, `applyToState`, `assignBuckets` from `src/changes.js` and `src/buckets.js`, and categories from `seedDefaults(DEFAULTS, state)` or `firstRunChanges`, as `tests/unit/categories.test.js` does. Use the inline `M` list from Task 1. Assertions:
  - A bucket `TESCO STORES` with transactions −500 and −700 suggests the category whose `defaultId` is `'groceries'`.
  - The same bucket with `categoryId` set to an existing category gives `null`.
  - The same bucket with `categoryId: 'gone'`, a category that doesn't exist, suggests groceries.
  - Rename the groceries category with `updateCategory(state, id, { name: 'Food shop' })`. The suggestion is still that category.
  - Delete the groceries category. The result is `null`.
  - Retype the groceries category to `kind: 'income'`. The result is `null`.
  - Transactions −500 and +500, a net of zero, give `null`. A net of +300 gives `null`.
  - `bucketSuggestions(state, M)` has `size` 1, and its key is the Tesco bucket's id.
  - A bucket created by an amount rule (`keys: []`), with displayName `TESCO`, gives `null`.

- [ ] **Step 2: Run** `node --test tests/unit/suggest.test.js`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement both functions in `src/suggest.js`.**
  - A bucket is uncategorised when `categoryId` is undefined or not found in `state.categories`. This mirrors `isCategorised` in `src/ui/buckets.js`.
  - The total is the sum of `amountMinor` over `state.transactions` with that `bucketId`, and it must be `< 0`.
  - The category is the first one in `state.categories` with `defaultId === match` and `kind === 'spend'`.
  - `bucketSuggestions` sums totals in a single pass over the transactions.

- [ ] **Step 4: Run** `npm test && npm run types`. Expected: PASS.

- [ ] **Step 5: Commit**: `git add src/suggest.js src/merchants.js tests/unit/suggest.test.js && git commit -m "Suggest the user's spending category for uncategorised buckets"`

### Task 3: The merchant list

**Files:**
- Modify: `src/merchants.js`
- Create: `tests/unit/merchants.test.js`
- Modify: `tests/unit/suggest.test.js`, adding the synthetic-fixture test.

**Interfaces:**
- Consumes: `squash` and `bucketSuggestions` from Tasks 1 and 2, and `fixtureState()` from `tests/unit/helpers/fixture-state.js`.
- Produces: `src/merchants.js`, whose default export is `{name: string, defaultId: string}[]`.

- [ ] **Step 1: Write `tests/unit/merchants.test.js`:**
  - Every `defaultId` exists in `src/default-categories.js` with `kind === 'spend'`.
  - `squash(name)` is non-empty for every entry.
  - No two entries share a `squash(name)`.
  - No `squash(name)` is in `DENY`. The denylist lives in the test: `UNIVERSITY`, `RENT`, `LANDLORD`, `MONTHLY RENT`, `MORTGAGE PAYMENT`, `DENTIST`, `DENTAL`, `OPTICIANS`, `ATM`, `CAFE`, `CAFE LOCAL`, `HAIRDRESSERS`, `SCHOOL FEES`, `NURSERY FEES`, `NEXT`, `THREE`, `JL`, `LV`, `PRUDENTIAL`, `BARCLAYS`, `HSBC`, `LLOYDS`, `LLOYDS BANK`, `HALIFAX`, `NATIONWIDE`, `SANTANDER`, `NATWEST`, `MONZO`, `STARLING`, `METRO BANK`, `TSB`, `FIRST DIRECT`, `CO OPERATIVE BANK`, `VIRGIN MONEY`, and every invented employer listed in the spec.
  - `merchants.length >= 400`.

- [ ] **Step 2: Add a synthetic-fixture test to `tests/unit/suggest.test.js`.** Run `bucketSuggestions(await fixtureState())` with the real list, and map the result to `displayName → category name`. It must deep-equal exactly:

  `{ 'TESCO STORES': 'Groceries', 'SAINSBURYS S/MKT': 'Groceries', 'AMAZON.CO.UK': 'Shopping', 'SPOTIFY': 'Subscriptions', 'TRAINLINE': 'Transport' }`

  If another synthetic bucket legitimately matches a real chain, stop and report it rather than editing the fixtures.

- [ ] **Step 3: Run** `npm test`. Expected: the new tests FAIL, because the list is empty.

- [ ] **Step 4: Build the list.**
  - Download the dataset once into the session scratchpad, with `curl -sSL -o <scratchpad>/merchants-src/tx.csv` from `raw.githubusercontent.com/EmmaExcel/merchant-categorizer/main/data/raw/synthetic_uk_transactions.csv`.
  - Take `merchant_name` and `label`, then apply the spec's drop rules and label table.
  - Add UK chains, then international ones, from general knowledge. Aim for 500 to 800 entries in total, and favour precision over coverage.
  - Group entries by category, with one comment line per group.
  - The header comment says the file is owner-editable and data-only, how entries match (whole words, squashed, longest wins), that only spending defaults may be used, and the dataset credit without a URL.
  - Do not commit the CSV, and do not commit any script.

- [ ] **Step 5: Run** `npm test && npm run types && npm run banned`. Expected: PASS.

- [ ] **Step 6: Commit**: `git add src/merchants.js tests/unit/merchants.test.js tests/unit/suggest.test.js && git commit -m "Merchant list for category suggestions"`

### Task 4: Buckets screen column and nav highlight

**Files:**
- Modify: `src/ui/nav.js` (`updateNav`), `src/ui/buckets.js` (`drawList`, `bucketRow`), and `styles.css` only if the new column needs it.
- Test: `tests/e2e/suggestions.spec.js` (new). Adjust any existing e2e test whose assertions break on the new column or the nav name.

**Interfaces:**
- Consumes: `bucketSuggestions(state)` from Task 2.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/suggestions.spec.js`, using `setupFixtureApp`, `navButton`, `openScreen` and `expectNoAxeViolations` from `tests/e2e/helpers.js`. Start from a fresh fixture import, with nothing categorised:
  - `navButton(page, 'Buckets')` has the accessible name `'Buckets, 5 suggestions'` and the class `attention`.
  - On Buckets, the column header `Suggested` is last. The `TESCO STORES` row shows `Groceries` and a button named `Accept Groceries for TESCO STORES`. A bucket with no match, such as `PARKING METER`, has an empty Suggested cell.
  - Click Accept for Tesco. The `Category for TESCO STORES` select shows `Groceries`, and IndexedDB has it (use `readStore`). The nav name becomes `'Buckets, 4 suggestions'`, and the Tesco Suggested cell is empty.
  - Set Spotify to Entertainment with the select. The nav count drops to 3.
  - With "Only uncategorised" on, click Accept for Amazon, then immediately Accept for Trainline. Both are saved. Focus lands on a neighbouring row's Category select, and is not lost to `body`.
  - Once every suggestion has been accepted, the nav button has no `attention` class and its name is `'Buckets'`.
  - `expectNoAxeViolations(page)` passes on Buckets while suggestions are shown.

- [ ] **Step 2: Run** `npx playwright test tests/e2e/suggestions.spec.js`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`updateNav`:** call `bucketSuggestions(state).size` and treat Buckets exactly as Transfers is treated: the `attention` class, a `.count` span, and `aria-label` `Buckets, N suggestions` (`1 suggestion` when singular). Update the file's header comment.
  - **`drawList`:** compute `bucketSuggestions` once and pass it to `bucketRow`. Add a final `h('th', { scope: 'col' }, 'Suggested')`. It is not sortable.
  - **`bucketRow`:** move the select's `onChange` body into a local `choose(value)`, and call it from both the select and Accept. The cell contains the category name plus `h('button', { type: 'button', class: 'secondary', 'aria-label': \`Accept ${cat.name} for ${b.displayName}\`, 'data-focus-key': \`bucket-accept-${b.id}\`, 'data-saves': true }, 'Accept')`. The cell is empty when there's no suggestion.
  - **Focus when the filter is off:** after Accept, focus goes to `categoryKey(b.id)`, the same row's select (Claude's call).

- [ ] **Step 4: Run** `npm run e2e`. Expected: PASS, after fixing any existing spec that asserted the old column set or nav names.

- [ ] **Step 5: Commit**: `git add src/ui/nav.js src/ui/buckets.js styles.css tests/e2e && git commit -m "Buckets: Suggested column with Accept, and a nav count"`

### Task 5: Suggested mark and Enter on the categorise card

**Files:**
- Modify: `src/ui/categorise.js` (the card's `onKeydown`, and `categoryGroup`), plus `styles.css` for the mark.
- Test: `tests/e2e/suggestions.spec.js`

**Interfaces:**
- Consumes: `suggestCategory(state, bucket)` from Task 2.

- [ ] **Step 1: Write the failing e2e tests:**
  - Use `skipToCard(page, 'TESCO STORES')`. The Groceries button's accessible name contains `suggested`, and the button contains the visible text `Suggested`.
  - On a card with no match (`PARKING METER`), no button contains `Suggested`.
  - Focus the card section (`#card`) and press Enter. The Tesco bucket is saved as Groceries, and the card moves on.
  - Focus the Shopping button on the Amazon card, which suggests Shopping, and press Enter. Amazon is saved as Shopping. Then focus the Eating out button on the Spotify card and press Enter. Spotify is saved as Eating out, not Subscriptions, so Enter on a button keeps its own meaning.
  - `expectNoAxeViolations` passes with the mark shown, in both light and dark themes (set the theme as `tests/e2e/theme.spec.js` does).

- [ ] **Step 2: Run** `npx playwright test tests/e2e/suggestions.spec.js`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement.**
  - Pass the suggested category id into `categoryGroup`.
  - The suggested button gets a visible `h('span', { class: 'suggested' }, 'Suggested')` after its name. Its `aria-describedby` also points at a visually hidden "suggested" span, or append it to the name. Use whichever axe accepts, and keep the existing hint.
  - In `onKeydown`, add before the digit check: `if (e.key === 'Enter' && e.target === el && suggested) { e.preventDefault(); assign(suggested.id); return; }`. This works whatever `firstTenKeys` is set to.
  - Style `.suggested` with existing tokens only, and don't rely on colour alone.

- [ ] **Step 4: Run** `npm run e2e`. Expected: PASS.

- [ ] **Step 5: Commit**: `git add src/ui/categorise.js styles.css tests/e2e/suggestions.spec.js && git commit -m "Categorise card: mark the suggested category; Enter accepts it"`

### Task 6: Help, CLAUDE.md and the main spec

**Files:**
- Modify: `index.html` (`#help-content`), `CLAUDE.md`, and `docs/superpowers/specs/2026-11-04-living-costs-design.md` (under "## Categorising").

- [ ] **Step 1: Add one Help paragraph** after the list that mentions categorising the biggest buckets (around `index.html:45`). Text:

  "Some buckets show a suggested category, on the categorise card and on the Buckets screen. Suggestions come from a built-in list of well-known merchants, and only cover spending. Nothing is categorised until you accept: press Enter on the card, or Accept on Buckets."

- [ ] **Step 2: Make the CLAUDE.md edits** exactly as the spec's "Changes to CLAUDE.md" lists them:
  - In scope, add the suggestions line.
  - Out of scope, change "Fuzzy matching" to "Edit-distance or typo-tolerant matching".
  - In the working rule on real statements, change "Nothing from them (…) goes into" to "Nothing sourced from them (…) goes into", and add "A merchant name from another source is fine, even if it also appears in a statement."

- [ ] **Step 3: Add a short "### Suggestions" subsection** to the main design spec, after "### Amount rules". Two sentences that point to `2026-11-07-merchant-suggestions-design.md`.

- [ ] **Step 4: Run** `npm run check`. Expected: every check passes.

- [ ] **Step 5: Commit**: `git add index.html CLAUDE.md docs/superpowers/specs/2026-11-04-living-costs-design.md && git commit -m "Help and docs for merchant suggestions"`
