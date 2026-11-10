# Open Remaining's parts, and a Category filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one-offs, uncategorised and ignored on Typical month open to the buckets and transactions behind them, and add a Category filter (category, kind, budget type, Uncategorised) to Transactions and Buckets.

**Architecture:** PR 37's `categoryContents` (`src/explore.js`) is split into a finder and a shared summariser, `summariseContents`. Typical month's `collect` records each part's transactions in the same pass that makes the figure, and `partContents` summarises them with the shared summariser. PR 37's view (`src/ui/category-explorer.js`) is generalised into `renderExplorer`, used by both the Categories explorer and a new part view. The filter is a pure matcher module (`src/category-filter.js`) plus a select builder (`src/ui/category-filter.js`) used by Transactions and Buckets.

**Tech Stack:** Browser ES modules, no build step, JSDoc types checked by `tsc`. `node:test` for unit tests, Playwright with `@axe-core/playwright` for e2e.

**Spec:** `docs/superpowers/specs/2026-11-10-remaining-explore-and-category-filter-design.md`. Read it first. Approved mockups are local only, in the main checkout: `.superpowers/brainstorm/remaining-explore/opened-ignored-v2.html` and `global-filter.html`.

**Base:** branch `worktree-remaining-explore`, which starts at PR 37's head (`worktree-category-explorer`). Work in `/Users/oliver/git/budgie/.claude/worktrees/remaining-explore`. Never `npm install`; `node_modules` is a symlink.

## Global Constraints

- CLAUDE.md rules apply: `textContent` only (build DOM with `h()` from `src/dom.js`), no `innerHTML`, no network code, integer minor units, thresholds only from `src/tuning.js`.
- No change to stored data, backups or `DATA_VERSION`.
- Typical month's figures, `categoryDetail`, `category-view.js`, and PR 37's view opened from Categories keep their behaviour. Every existing unit and e2e test passes unchanged, except tests this plan edits on purpose (named in their task).
- The opened part view reconciles with the clicked figure: its transactions come from the same `collect` pass as `totals`.
- Option labels are exactly `All categories`, `Uncategorised`, `By kind: <KIND_LABELS[k]>`, `By type: <BUDGET_LABELS[t]>`, then category names.
- Headings: `One-offs`, `Uncategorised`, `Ignored`. Back button: `Back to Typical month`.
- `npm run check` (banned, unit, types, e2e) passes at the end of every task.

## Review Focus

1. **A transaction with two parts in the same group** (a split into two Ignore categories, or two parts of one): counted once in the summary's transaction count, once per category in By bucket, and its `partMinor` is the sum. Pinned in Task 1.
2. **Opening a part, then changing the window on return:** the view uses `ui.range` at open time and redraws with it; Back then shows the card for the same range. Pinned in Task 4 (e2e: change window, open, Back, window unchanged).
3. **A filter value pointing at a deleted category** (Transactions remembers its filters across screens): it falls back to All categories rather than showing nothing. Pinned in Task 5 (`isValidFilter`) and Task 6.
4. **Category filter plus a chosen bucket that no longer matches:** the Bucket filter clears, rather than silently showing "No transactions match." Pinned in Task 6.
5. **Buckets: changing a row's category so the Category filter hides it** keeps focus on a neighbour, as Show does. Pinned in Task 7.

---

### Task 1: Shared summariser in `src/explore.js`

**Files:**
- Modify: `src/explore.js`
- Test: `tests/unit/explore.test.js`

**Interfaces:**
- Produces:
  - `/** @typedef {{t:Transaction, categoryId:string|null, amount:number, moved:boolean}} ContentsEntry */` — one transaction's signed net in one category (null: none), and whether it is here by override or split while its bucket's own category is outside the group.
  - `ContentsBucket` gains `categoryId: string|null` (always set; `null` when rows aren't split by category).
  - `export function summariseContents(state, entries, opts)` with `opts: {months: string[], cell: (accountId: string, month: string, total: number|undefined) => ContentsCell, byCategory: boolean}` → `CategoryContents|null` (null for no entries).
  - `categoryContents(state, tuning, categoryId)` keeps its signature and output (bucket rows now carry `categoryId: null`).

- [ ] **Step 1: Write the failing tests** in `tests/unit/explore.test.js`, using the file's existing `acct`, `txn`, `bucket`, `build` helpers:

```js
test('summariseContents: one row per bucket and category when byCategory', () => {
  const s = build({ accounts: [acct('A')], buckets: [bucket('b1')] });
  const x = txn('A', '2026-01-05', -1000, 'b1'), y = txn('A', '2026-02-05', -500, 'b1');
  const c = summariseContents(s, [
    { t: x, categoryId: 'ign1', amount: -600, moved: false },
    { t: x, categoryId: 'ign2', amount: -400, moved: true },
    { t: y, categoryId: 'ign1', amount: -500, moved: false },
  ], { months: ['2026-01', '2026-02'], cell: (_a, month, total) => ({ month, total: total ?? 0, partial: false }), byCategory: true });
  assert.equal(c.count, 2);                                   // distinct transactions
  assert.equal(c.partMinor.get(x.id), -1000);                 // summed across categories
  assert.deepEqual(c.buckets.map((b) => [b.categoryId, b.count, b.total, b.moved]),
    [['ign1', 2, -1100, 0], ['ign2', 1, -400, 1]]);
  assert.deepEqual(c.accounts[0].cells.map((cell) => cell.total), [-1000, -500]);
});

test('summariseContents: rows merge across categories when not byCategory, and no entries is null', () => {
  // same entries as above with byCategory: false → one row, categoryId null, count 2, total -1500, moved 1
  // summariseContents(s, [], {...}) === null
});

test('categoryContents bucket rows carry categoryId null', () => {
  // with the file's shared state: every row of categoryContents(state(), tuning, 'work').buckets has categoryId === null
});
```

- [ ] **Step 2: Run** `node --test tests/unit/explore.test.js`. Expected: FAIL, `summariseContents` is not exported.

- [ ] **Step 3: Implement.** Move everything after "find" in `categoryContents` into `summariseContents`. `categoryContents` builds entries with `eachPart` (`moved` = source is override or split and the bucket's own category isn't `categoryId`), computes its months span as now, and passes a `cell` that reproduces today's covered / partial / missing logic. In the summariser: `count` = distinct transactions; bucket rows keyed by `bucketId` (plus `categoryId` when `byCategory`); `count` per row = entries in it; `moved` per row = entries with `moved`. Sort is unchanged, then by category name (`compareNames`) when the totals and bucket names tie.

- [ ] **Step 4: Run** `node --test tests/unit/explore.test.js tests/unit/category-explorer.test.js`. Expected: PASS, including every PR 37 test unchanged.

- [ ] **Step 5: Commit** `git commit -am "Explore: a shared summariser, with rows by bucket and category"`

---

### Task 2: `partContents` in `src/typical.js`

**Files:**
- Modify: `src/typical.js`
- Test: `tests/unit/typical.test.js`

**Interfaces:**
- Consumes: `summariseContents`, `ContentsEntry`, `CategoryContents` from Task 1.
- Produces:
  - `/** @typedef {keyof Parts} PartName */` ('oneOffs' | 'uncategorised' | 'ignored')
  - `Collected` gains `entries: Record<PartName, ContentsEntry[]>`.
  - `export function partContents(state, tuning, part, range = null)` → `{contents: CategoryContents, figure: number, currency: string}|null`. Null when currencies are mixed or the part has no entries. `figure` is `partsOf(out, monthsOf)[part]`, the same value as `typicalMonth(...).totals[part]`. `contents.months` is `window.months`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/typical.test.js`, after the "Remaining parts" tests, using the shared `parts` state there plus small `build({...})` states:

```js
/** Each account's net out over its own month count, summed: the figure's own rule. */
const reconcile = (c, monthsOf) => c.accounts.reduce((sum, a) => sum + divRound(-(a.cells.reduce((s, x) => s + (x.total ?? 0), 0)), monthsOf(a.accountId)), 0);

test('partContents reconciles with totals for every part', () => {
  const tm = typicalMonth(parts, tuning);
  for (const part of ['oneOffs', 'uncategorised', 'ignored']) {
    const p = partContents(parts, tuning, part);
    assert.equal(p.figure, tm.totals[part]);
    assert.equal(reconcile(p.contents, (id) => (id === 'B' ? 3 : 12)), tm.totals[part]);
    assert.deepEqual(p.contents.months, tm.months);
  }
});
test('partContents: ignored includes a Savings-account transaction in an Ignore category');
test('partContents: one-offs excludes a Saving one-off part inside a Savings account');
test('partContents: a confirmed non-savings pair is in no part');
test('partContents: a savings pair whose side is in a Saving One-off category is in one-offs');
test('partContents: a split with one Ignore part counts only that part, in partMinor');
test('partContents: an override into an Ignore category counts and is moved');
test('partContents: a transaction outside its account\'s counted months is left out, and that month\'s cell is null');
test('partContents: null for a part with no transactions, and for mixed currencies');
```

Each named test asserts membership in `contents.transactionIds` (or its absence), and the amount in `partMinor`, against a `build({...})` state. Reuse the savings-pair setup from the existing savings tests in this file (`paired`, Savings `acct(..., 'savings')`).

- [ ] **Step 2: Run** `node --test tests/unit/typical.test.js`. Expected: FAIL, `partContents` is not exported.

- [ ] **Step 3: Implement.** In `collect`, beside each `addOut(...)`, record a `ContentsEntry`, netted per transaction and category (null for uncategorised), so two parts in the same category make one entry. `moved` = `res.source` is `'override'` or `'split'`, and the bucket's own category (`ctx.buckets.get(t.bucketId)?.categoryId`, looked up in `rowCategories`) is outside the group. For ignored, outside means kind isn't `ignore`. For one-offs, it means not counted with budget type `oneoff`. For uncategorised, `moved` is always false. `partContents` runs `analysisWindow` and `collect` exactly as `typicalMonth` does, and calls `summariseContents` with `byCategory: part !== 'uncategorised'`. Its `cell` returns `{month, total: total ?? 0, partial: false}` when `monthsOf(accountId).has(month)`, else `{month, total: null, partial: false}`.

- [ ] **Step 4: Run** `node --test tests/unit/typical.test.js`. Expected: PASS, and every existing typical test is unchanged.

- [ ] **Step 5: Commit** `git commit -am "Typical month: partContents, from the pass that makes the figure"`

---

### Task 3: Generalise PR 37's view into `renderExplorer`

**Files:**
- Modify: `src/ui/category-explorer.js`
- Test: `tests/unit/category-explorer.test.js`, `tests/e2e/category-explorer.spec.js` (must pass unchanged)

**Interfaces:**
- Consumes: `CategoryContents` with `ContentsBucket.categoryId` (Task 1).
- Produces:
  - `export function outAndIn(sums, money)` (now exported).
  - `export function renderExplorer(screen, app, o)` with `o: {viewId: string, heading: string, backLabel: string, onBack: () => void, contents: CategoryContents|null, summary: (money: (minor:number)=>string) => string, emptyText: string, listKey: string, categoryName: string, categoryColumn: boolean}`.
  - `export function reset()`. It now forgets the list view of whichever `viewId`/`listKey` was last shown.
  - `renderCategoryExplorer(screen, app, categoryId, onBack)` keeps its signature and behaviour, and calls `renderExplorer`.

- [ ] **Step 1: Write the failing test** in `tests/unit/category-explorer.test.js`: `outAndIn({out: 500, in: 0}, m)` returns `'£5.00 out'`, and `outAndIn({out: 0, in: 0}, m)` returns `''`.
- [ ] **Step 2: Run** `node --test tests/unit/category-explorer.test.js`. Expected: FAIL, `outAndIn` is not exported.
- [ ] **Step 3: Implement.** Move the body of `renderCategoryExplorer` into `renderExplorer`, parameterised by `o`. The view state keys on `o.viewId` where it keyed on `categoryId`. The By bucket table adds a **Category** column after Bucket when `o.categoryColumn` (the name from `state.categories`, or the id if missing). Its toggle's focus key gets `-${categoryId}` appended when `categoryId` isn't null, so duplicate bucket rows have distinct keys. Focus keys and ids keep the `explore-` prefix.
- [ ] **Step 4: Run** `node --test tests/unit/category-explorer.test.js && npx playwright test tests/e2e/category-explorer.spec.js`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Category explorer: renderExplorer, shared by other views"`

---

### Task 4: Open one-offs, uncategorised and ignored from Typical month

**Files:**
- Create: `src/ui/part-view.js`
- Modify: `src/ui/typical.js`, `CLAUDE.md`
- Test: `tests/unit/part-view.test.js` (new), `tests/e2e/typical-parts.spec.js` (new), `tests/e2e/a11y.spec.js`

**Interfaces:**
- Consumes: `partContents`, `PartName` (Task 2); `renderExplorer`, `outAndIn`, `reset` (Task 3).
- Produces:
  - `export const PART_HEADINGS = {oneOffs: 'One-offs', uncategorised: 'Uncategorised', ignored: 'Ignored'}`
  - `export function partSummaryText(part, contents, figure, money)` → string
  - `export function renderPartView(screen, app, part, range, onBack)`
  - Typical month's `ui.openPart: PartName|null`. Focus key of each card button: `typical-part-${part}`.

- [ ] **Step 1: Write the failing unit test** `tests/unit/part-view.test.js`:

```js
test('partSummaryText names the group, counts, out and in, the window and the figure', () => {
  const contents = { count: 45, buckets: [{}, {}, {}], out: 1123640, in: 20000, months: ['2025-11', /* … */ '2026-10'] };
  assert.equal(partSummaryText('ignored', contents, 91970, m),
    'Ignore categories · 45 transactions in 3 buckets, £11,236.40 out and £200.00 in, Nov 2025 to Oct 2026. '
    + 'That is £919.70 a month on Typical month: each account\'s net out over its own months, added together.');
});
// one-offs lead with 'One-off categories', uncategorised with 'Uncategorised'; a one-month window names one month.
```

- [ ] **Step 2: Run** `node --test tests/unit/part-view.test.js`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement `src/ui/part-view.js`.** `renderPartView` calls `partContents(state, app.tuning, part, range)` and `renderExplorer` with: `viewId` and `listKey` set to `part:${part}`; `heading: PART_HEADINGS[part]`; `backLabel: 'Back to Typical month'`; `categoryColumn: part !== 'uncategorised'`; `categoryName` set to `'one-offs'`, `'uncategorised'` or `'ignored'`. `emptyText` is `Nothing is in one-offs in these months now.`, `Nothing is uncategorised in these months now.` or `Nothing is ignored in these months now.`
- [ ] **Step 4: Wire `src/ui/typical.js`.**
  - `summaryList` takes an `onOpenPart(part)` callback. The one-offs, uncategorised and ignored labels become `h('button', {type: 'button', class: 'secondary name', 'data-focus-key': `typical-part-${part}`, onClick})` when the typical figure isn't null. They stay plain text otherwise. This applies in both the `dl` and the compare table.
  - `render`: when `ui.openPart` is set, it mirrors the `openId` branch. It uses `showing(...)` to close (set `openPart` to null, reset the explorer, rerender), then focuses `typical-part-${part}` if keyed, else the `h2`. Then it calls `renderPartView(root, app, ui.openPart, ui.range, back)`.
  - Opening a part sets `openId` to null, and opening a category sets `openPart` to null.
  - `reset()` also clears `openPart` and calls the explorer's `reset`.
- [ ] **Step 5: Add the CLAUDE.md line** under Scope › In scope: "Open one-offs, uncategorised and ignored on Typical month to see the buckets and transactions behind them."
- [ ] **Step 6: Write the e2e spec** `tests/e2e/typical-parts.spec.js`, serial, one shared page, `setupFixtureApp` (pattern: `category-explorer.spec.js`):
  - `one-offs and uncategorised are buttons; ignored is a dash and plain text`. The fixture has no Ignore transactions.
  - `one-offs opens with its summary naming the card's figure`. Read the card's one-offs figure first, then expect `#explore-summary` to contain `That is ${figure} a month on Typical month`. Expect a Category column showing `Big one-offs`, and `BIG BOILER CO` in By bucket. Run axe and the 320px no-horizontal-scroll check (copy the check from `category-explorer.spec.js`).
  - `Back returns focus to one-offs; reopening shows no filters` (press a bucket first). Browser back also closes the view.
  - `ignored opens after a bucket is set to Ignore`. Use `setBucketCategory(page, 'GAMESHOP', 'Ignore')`, then return to Typical month. The ignored line is now a button, and its summary names its figure. Pressing a month cell and then the bucket narrows the list.
  - `uncategorised: categorise a transaction in place and it leaves; the last one leaves the empty line focused`. Use the row's Counts as control, as `category-explorer.spec.js` does.
  - `changing the window, opening and Back keep the window`.
  - Edit `tests/e2e/typical.spec.js` only if its text assertions break on the label buttons. Text content is unchanged, so they should pass.
  - Add the opened part view to `tests/e2e/a11y.spec.js` beside PR 37's view.
- [ ] **Step 7: Run** `npm run check`. Expected: all pass.
- [ ] **Step 8: Commit** `git add -A && git commit -m "Typical month: open one-offs, uncategorised and ignored"`

---

### Task 5: Category filter matchers

**Files:**
- Create: `src/category-filter.js`
- Test: `tests/unit/category-filter.test.js`

**Interfaces:**
- Produces:
  - Filter values (strings): `''` (all), `'none'` (Uncategorised), `kind:<CategoryKind>`, `type:<BudgetType>`, `category:<id>`.
  - `export function isValidFilter(state, filter)` → boolean. False for a malformed value, an unknown kind or type, or a category id not in `state.categories`.
  - `export function categoryMatcher(state, filter)` → `(categoryId: string|null|undefined) => boolean`. `''` matches anything. `'none'` matches a missing or unknown id. `type:` matches only budgeted kinds (`isBudgeted`).
  - `export function transactionMatcher(state, filter)` → `(t: Transaction) => boolean`. It builds `buildContext(state)` once and calls `resolve` per transaction. `'none'` is `source === 'none'`. `kind:transfer` is `source === 'transfer'` or any part matching. Every other value is any part with a category matching.

- [ ] **Step 1: Write the failing tests:** each value against a small `build` state:
  - a category: a split matches on either part
  - `kind:ignore`
  - `kind:transfer`: with a confirmed pair, and with a bucket in a Transfer category
  - `type:fixed`: an Ignore category with a stray `budgetType: 'fixed'` does not match
  - `type:oneoff`: a savings pair in a One-off Saving category does not match (Counts as reads Transfer)
  - `none`: a bucket with no category matches; an override to a deleted category matches; a split doesn't
  - `isValidFilter` for each malformed or stale value
- [ ] **Step 2: Run** `node --test tests/unit/category-filter.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the three functions in `src/category-filter.js`.
- [ ] **Step 4: Run** it again. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Category filter: matchers for category, kind, type and Uncategorised"`

---

### Task 6: Category filter on Transactions

**Files:**
- Create: `src/ui/category-filter.js`
- Modify: `src/ui/transactions.js`, `CLAUDE.md`
- Test: `tests/e2e/transactions.spec.js`

**Interfaces:**
- Consumes: Task 5.
- Produces: `export function categoryFilterField(state, {value, uncategorised, focusKey, onChange})` → the `field('Category', select)` element. Options, in order:
  - `All categories` (`''`)
  - `Uncategorised` (`'none'`), only when `uncategorised` is true
  - `By kind: …` for each of `KINDS`
  - `By type: …` for each of `BUDGET_TYPES`
  - every category from `sortedCategories(state)`, by name, with value `category:<id>`

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/transactions.spec.js`:
  - The Category select sits between Search and Bucket. Its first options are `All categories` and `Uncategorised`, then `By kind: Spend`.
  - Choose `Uncategorised`: every row's source reads `uncategorised`. Choose `By kind: Income`: the Bucket options narrow to income buckets (for example `EXAMPLE EMPLOYER LTD SALARY` is present and `TESCO STORES` is absent).
  - Choose bucket `TESCO STORES`, then `By kind: Income`: the Bucket filter clears to All buckets.
  - Choose `Groceries`, leave for Buckets and come back: still `Groceries`.
  - An opened bucket on Buckets, and PR 37's opened category, have no Category select.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/transactions.spec.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `View` gains `category: string` (default `''`).
  - In `renderTransactionList`, when neither `fixed` nor `only` is set:
    - reset `v.category` to `''` if `!isValidFilter`
    - add the field after Search
    - narrow the Bucket options to buckets with a matching transaction, and clear `v.bucketId` if it falls out
  - A category change sets `v.category` and calls `app.rerender()`, then `focusKey('txns-category')`, because the Bucket options change. Search and dates still only redraw the results.
  - `drawResults` applies `transactionMatcher` after the search.
- [ ] **Step 4: Add the CLAUDE.md line** under Scope › In scope: "A Category filter on Transactions and Buckets: by category, kind or budget type, and Uncategorised on Transactions."
- [ ] **Step 5: Run** `npm run check`. Expected: all pass.
- [ ] **Step 6: Commit** `git add -A && git commit -m "Transactions: a Category filter"`

---

### Task 7: Category filter on Buckets

**Files:**
- Modify: `src/ui/buckets.js`
- Test: `tests/e2e/buckets.spec.js`

**Interfaces:**
- Consumes: `categoryFilterField` (Task 6), `categoryMatcher`, `isValidFilter` (Task 5).
- Produces: Buckets `ui.category: string` (default `''`), kept across leaving the screen like `show`.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/buckets.spec.js`:
  - The Category select follows Show and has no `Uncategorised` option.
  - `By type: One-off` shows only `BIG BOILER CO`.
  - `Groceries` combined with search `farm` shows only `FARM SHOP`.
  - With `Groceries` chosen, set `FARM SHOP` to Eating out. The row hides, and focus goes to the next row's category select (as Show's hand-off test does). Restore it afterwards.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/buckets.spec.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add the field after `showFilter(...)`, with `uncategorised: false` and focus key `buckets-category`. A change calls `app.rerender()`.
  - `shownRows` also filters with `categoryMatcher(state, ui.category)(bucket.categoryId)`. Reset `ui.category` when `!isValidFilter`.
  - In `bucketRow`, replace the two `ui.show` checks with one `hides(value)`. It's true when Show isn't All and `value !== ''`, or when the matcher rejects `value || undefined`.
- [ ] **Step 4: Run** `npm run check`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -am "Buckets: a Category filter"`
