# Category Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open any category from the Categories screen to see its total for each month, the buckets that feed it, and its transactions.

**Architecture:** A new pure module `src/explore.js` resolves every transaction with `resolve()` and builds the view's data. A new UI module `src/ui/category-explorer.js` draws it, reusing `monthGrid` and `renderTransactionList`. `src/ui/categories.js` turns names into buttons and swaps the table for the view, using the same sub-view history handling (`src/ui/subview.js`) as Typical month.

**Tech Stack:** Vanilla ES modules with JSDoc types (`tsc --checkJs`), `node:test`, Playwright with `@axe-core/playwright`. No build step, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-category-explorer-design.md`

## Global Constraints

- Render with `textContent` only (the `h()` helper in `src/dom.js`). No `innerHTML`, no network code, no new dependencies.
- Money is integer minor units with a currency. Format with `formatMoney(minor, currency)`.
- No change to stored data, backups or `DATA_VERSION`.
- `src/ui/category-view.js`, `categoryDetail` and Typical month's behaviour must not change.
- In the view, a transaction is in the category exactly when `resolve(t, buildContext(state))` gives it a part with the category's id. A confirmed transfer pair is never in any category (owner's decision).
- Copy, verbatim: "Back to Categories", "Nothing counts as <name> now.", "Totals need a single currency.", "Each month", "By bucket", "Transactions".
- Work in the worktree `/Users/oliver/git/budgie/.claude/worktrees/category-explorer` on branch `worktree-category-explorer`. Never run `npm install`.
- Every check: `npm run check` (banned, unit, types, e2e).

## Review Focus

1. **Moving the last transaction out from the view.** The view stays open, says "Nothing counts as <name> now." and focus lands on that line, not the page heading. Pinned in Task 3's e2e.
2. **A transaction outside its account's coverage** (a statement period typed too short). It still has a cell, marked part covered, and every total adds up. Pinned in Task 1 (April cell).
3. **A Transfer category whose transactions are all confirmed pairs** can't be opened, and one with an unpaired repayment shows only that. Pinned in Task 1.
4. **Browser back while the view is open** closes it, as Back does, and the filters are cleared. Pinned in Task 3.
5. **A narrow window (320px) with 12 months and several accounts** doesn't scroll the page sideways. Pinned in Task 3.

---

### Task 1: The data: `src/explore.js`

**Files:**
- Create: `src/explore.js`
- Modify: `src/coverage.js:70` (export `intervalsByAccount`, no other change)
- Test: `tests/unit/explore.test.js`

**Interfaces:**
- Consumes: `buildContext`, `resolve` (`src/resolve.js`); `accountsByMonth`, `accountMonthStatus`, `intervalsByAccount` (`src/coverage.js`); `monthOf`, `monthRange` (`src/dates.js`); `currenciesOf` (`src/money.js`); `cmp`, `compareNames` (`src/order.js`).
- Produces:

```js
/**
 * total: the signed net (in minus out) of the category's transactions that month, or null when
 * the account doesn't cover the month and has nothing in it. partial: the account covers the
 * month only in part, or not at all but has something in it.
 * @typedef {{month:string,total:number|null,partial:boolean}} ContentsCell
 */
/** out and in: positive sums of the account's negative and positive amounts. @typedef {{accountId:string,out:number,in:number,cells:ContentsCell[]}} ContentsAccount */
/**
 * count: transactions with a part here. total: their signed net. latestDate: ISO date of the latest.
 * moved: how many are here through an override or split while the bucket's own category is another.
 * @typedef {{bucketId:string,count:number,total:number,latestDate:string,moved:number}} ContentsBucket
 */
/**
 * currency: null when the category's transactions use more than one. from and to: YYYY-MM of the
 * earliest and latest transaction. months: every month shown, oldest first. accounts: in
 * state.accounts order, only those with something here. partMinor: transaction id → signed sum of
 * its parts here (every id in transactionIds has an entry).
 * @typedef {{currency:string|null,count:number,out:number,in:number,from:string,to:string,months:string[],
 *   accounts:ContentsAccount[],buckets:ContentsBucket[],transactionIds:Set<string>,partMinor:Map<string,number>}} CategoryContents
 */

/** Ids of every category that at least one transaction has a part in. One pass. */
export function openableCategoryIds(state) /* : Set<string> */
/** null when nothing counts as the category. */
export function categoryContents(state, tuning, categoryId) /* : CategoryContents|null */
```

Rules the code must follow:
- `months`: `accountsByMonth(state, tuning).months`, widened to take in the months of this category's transactions, then filled to a continuous `monthRange(first, last)`.
- A cell's status comes from `accountMonthStatus(intervalsByAccount(state, tuning).get(accountId) ?? [], month)`, with placeholder accounts treated as `missing`. `covered`: total (0 when empty), partial false. `partial`: total, partial true. `missing`: null and partial false if nothing is there, otherwise total and partial true.
- A transaction's amount here is the sum of its parts with this id. Count it in `out` or `in` by the sign of that sum.
- Buckets are sorted by `Math.abs(total)` descending, then `compareNames` of display name, then `cmp` of id.
- `moved` counts transactions whose `resolve` source is `'override'` or `'split'` and whose bucket's `categoryId` isn't this id.

- [ ] **Step 1: Write the failing tests**

Build state the way `tests/unit/typical.test.js:11-37` does (copy its `acct`, `batch`, `cat`, `bucket`, `txn` and `build` helpers, and `pair` from lines 704-716). The shared state, `S`:
- Accounts `A` (bank) and `B` (card). Batches: `A` from 2026-01-01 to 2026-03-31, `B` from 2026-02-10 to 2026-03-31.
- Categories: `work` (ignore), `other` (spend, variable), `xfer` (transfer), `empty` (spend, variable).
- Buckets: `trainline`, `hotel` and `employer` → `work`; `cafe` → `other`; `repay` → `xfer`.
- Transactions:
  - `t1`: A, 2026-01-05, −1000, trainline
  - `t2`: A, 2026-03-05, −2000, trainline
  - `t3`: B, 2026-02-15, −5000, hotel
  - `t4`: A, 2026-02-20, +7000, employer
  - `t5`: A, 2026-01-10, −300, cafe, with an override `{fingerprint: t5.fingerprint, categoryId: 'work'}`
  - `t6`: A, 2026-01-12, −400, trainline, with an override to `other`
  - `t7`: A, 2026-03-10, −1000, cafe, split `[{amountMinor: -600, categoryId: 'work'}, {amountMinor: -400, categoryId: 'other'}]`
  - `t8`: A, 2026-04-02, −500, trainline (after A's coverage ends)
- A confirmed pair from A to B of 1500 on 2026-02-01, both sides in bucket `repay`, and an unpaired `t9`: A, 2026-03-01, −800, repay.

```js
test('categoryContents: an Ignore category with overrides, a split and a transaction outside coverage', () => {
  const c = categoryContents(S, tuning, 'work');
  assert.equal(c.currency, 'GBP');
  assert.equal(c.count, 7);
  assert.equal(c.out, 9400);
  assert.equal(c.in, 7000);
  assert.equal(c.from, '2026-01');
  assert.equal(c.to, '2026-04');
  assert.deepEqual(c.months, ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.deepEqual(c.accounts.map((a) => [a.accountId, a.out, a.in]), [['A', 4400, 7000], ['B', 5000, 0]]);
  assert.deepEqual(c.accounts[0].cells, [
    { month: '2026-01', total: -1300, partial: false }, { month: '2026-02', total: 7000, partial: false },
    { month: '2026-03', total: -2600, partial: false }, { month: '2026-04', total: -500, partial: true }]);
  assert.deepEqual(c.accounts[1].cells, [
    { month: '2026-01', total: null, partial: false }, { month: '2026-02', total: -5000, partial: true },
    { month: '2026-03', total: 0, partial: false }, { month: '2026-04', total: null, partial: false }]);
  assert.deepEqual(c.buckets, [
    { bucketId: 'employer', count: 1, total: 7000, latestDate: '2026-02-20', moved: 0 },
    { bucketId: 'hotel', count: 1, total: -5000, latestDate: '2026-02-15', moved: 0 },
    { bucketId: 'trainline', count: 3, total: -3500, latestDate: '2026-04-02', moved: 0 },
    { bucketId: 'cafe', count: 2, total: -900, latestDate: '2026-03-10', moved: 2 }]);
  assert.equal(c.partMinor.get(t7.id), -600);
  assert.equal(c.transactionIds.has(t6.id), false);
});

test('categoryContents: cells, bucket totals and in minus out all add up to the same net', () => {
  // For 'work' and 'other': sum of non-null cells === sum of bucket totals === in - out === sum of partMinor.
});

test('categoryContents: a split part elsewhere counts there; an override out counts there', () => {
  const o = categoryContents(S, tuning, 'other');
  // t6 (−400, moved: bucket trainline is work) and t7's −400 part (moved: bucket cafe is other, so 0 moved for it)
  assert.equal(o.count, 2);
  assert.deepEqual(o.buckets.map((b) => [b.bucketId, b.moved]), [['cafe', 0], ['trainline', 1]]);
});

test('categoryContents: a confirmed pair is never in a category', () => {
  const x = categoryContents(S, tuning, 'xfer');
  assert.equal(x.count, 1);
  assert.equal(x.out, 800);
  // The same state without t9: nothing counts as xfer.
  assert.equal(categoryContents(withoutT9, tuning, 'xfer'), null);
});

test('categoryContents: an empty category is null, and mixed currencies give currency null', () => {
  assert.equal(categoryContents(S, tuning, 'empty'), null);
  // S plus one EUR transaction in trainline: currency null, counts and buckets still there.
});

test('openableCategoryIds: categories with a part, and nothing else', () => {
  assert.deepEqual([...openableCategoryIds(S)].sort(), ['other', 'work', 'xfer']);
  assert.deepEqual([...openableCategoryIds(withoutT9)].sort(), ['other', 'work']);
});
```

Fill in the second and fifth tests' bodies with the assertions their comments state. The comment-only lines are the assertions to write, not placeholders.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test tests/unit/explore.test.js`
Expected: FAIL, cannot find module `../../src/explore.js`.

- [ ] **Step 3: Export `intervalsByAccount` from `src/coverage.js`, and write `src/explore.js` to the interface above**

One pass over `state.transactions` with one `buildContext`. Give the module a top comment in the style of `src/typical.js:1-3`, saying it serves the Categories screen's explorer and isn't a budget figure.

- [ ] **Step 4: Run them and see them pass, with types**

Run: `node --test tests/unit/explore.test.js && npm run types`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/explore.js src/coverage.js tests/unit/explore.test.js
git commit -m "Category explorer: contents of a category across all months"
```

---

### Task 2: The view: `src/ui/category-explorer.js`

**Files:**
- Create: `src/ui/category-explorer.js`
- Modify: `src/ui/month-grid.js` (part-covered cells)
- Modify: `src/ui/transactions.js` (add `forgetListView`)
- Modify: `styles.css` (`.category-explorer h4` alongside `.category-view h4`, and `.month-cells .partial`)
- Test: `tests/unit/category-explorer.test.js`

**Interfaces:**
- Consumes: `categoryContents`, `CategoryContents` (Task 1); `monthGrid` and `PressedMonth` (`src/ui/month-grid.js`); `renderTransactionList`, `listView` (`src/ui/transactions.js`); `KIND_LABELS`, `BUDGET_LABELS`, `plural`, `focusKey`, `help` (`src/ui/form.js`); `isBudgeted` (`src/categories.js`); `formatMonth`, `formatDate`, `monthOf` (`src/dates.js`).
- Produces:

```js
// src/ui/category-explorer.js
/** The one summary line. money formats minor units in the contents' currency. */
export function summaryText(contents, category, money) /* : string */
/** Draw the view into screen, with "Back to Categories" calling onBack. */
export function renderCategoryExplorer(screen, app, categoryId, onBack) /* : void */
/** Forget the pressed month and this view's list filters. Called on Back, browser back and nav. */
export function reset() /* : void */
/** The focus key of a category's name button on the Categories table. */
export const openKey = (id) => `category-open-${id}`;

// src/ui/transactions.js
/** Drop a list's stored search and filters, so it next opens empty. */
export function forgetListView(key) /* : void */

// src/ui/month-grid.js: series cells accept an optional partial flag
// {month:string,total:number|null,unusual?:boolean,partial?:boolean}
```

Rules:
- Ids, focus keys and the `monthGrid` prefix all start with `explore` (`explore-heading`, `explore-back`, `explore-empty`, `explore-each-month`, `explore-by-bucket`, `explore-transactions`). The root is `h('div', {class: 'category-explorer'})`, not `category-view`, so `category-view.js`'s focus tracking ignores it.
- The list key is `explore:${categoryId}`.
- The heading row follows `category-view.js:104-107`: `h3` with `tabindex -1`, then the Back button.
- When `categoryContents` is null, follow `category-view.js:111-124`: the line "Nothing counts as <name> now.", and focus on it after a redraw that emptied the view.
- When `contents.currency` is null: no summary line and no Each month section. The bucket table has no Total column. Under the heading goes the line "Totals need a single currency."
- The month grid's per-account label (shown only with several accounts) is the account name, a colon, then the same "£X out and £Y in" phrase as the summary.
- A part-covered cell is drawn like a covered one (a toggle button), with class `partial` and a visible second line "part covered". Its accessible name says "part covered" too. Cells without `partial` draw exactly as before, so Typical month and the categorise card don't change.
- By bucket columns: Bucket (a toggle button `class: 'secondary name'`, `aria-pressed`, setting `listView(key).bucketId`, as `category-view.js:192-200` does), Transactions, Total, Last (`formatDate`). When `moved > 0`, add `h('span', {class: 'muted'}, ' (N moved here)')` after the button in the same cell.
- Pressing a month cell narrows the list's `ids` to that account and month, as `category-view.js:146-149`.
- `reset()` clears the module's view state and calls `forgetListView` for the open category's key.

- [ ] **Step 1: Write the failing test for `summaryText`**

```js
const m = (minor) => (minor / 100).toFixed(2);
const base = { currency: 'GBP', count: 23, out: 148210, in: 131000, from: '2025-11', to: '2026-10', buckets: Array(9).fill({}) };

test('summaryText: kind, counts, out and in, and the months', () => {
  assert.equal(summaryText(base, { kind: 'ignore' }, m),
    'Ignore · 23 transactions in 9 buckets, 1482.10 out and 1310.00 in, Nov 2025 to Oct 2026.');
});
test('summaryText: a budget type follows the kind, an empty side is left out, one month is named once', () => {
  assert.equal(summaryText({ ...base, count: 1, in: 0, out: 240000, from: '2026-01', to: '2026-01', buckets: [{}] },
    { kind: 'spend', budgetType: 'oneoff' }, m),
    'Spend · One-off · 1 transaction in 1 bucket, 2400.00 out, Jan 2026.');
  assert.equal(summaryText({ ...base, out: 0 }, { kind: 'income', budgetType: 'fixed' }, m),
    'Income · Fixed · 23 transactions in 9 buckets, 1310.00 in, Nov 2025 to Oct 2026.');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/unit/category-explorer.test.js`
Expected: FAIL, cannot find the module.

- [ ] **Step 3: Write `summaryText`, `renderCategoryExplorer`, `reset` and `openKey`, `forgetListView`, the `monthGrid` partial cell, and the CSS**

`summaryText` shows the budget type only when `isBudgeted(category.kind)` and `budgetType` is set. Style `.month-cells .partial` with a dotted border, distinct from `.uncovered`'s dashed one, within the existing tokens.

- [ ] **Step 4: Run unit tests and types**

Run: `npm test && npm run types`
Expected: all pass. The existing `category-view` and `typical` unit tests are unchanged and pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/category-explorer.js src/ui/month-grid.js src/ui/transactions.js styles.css tests/unit/category-explorer.test.js
git commit -m "Category explorer: the view"
```

---

### Task 3: Open it from Categories, end to end

**Files:**
- Modify: `src/ui/categories.js` (name buttons, open state, guide sentence, `reset`)
- Modify: `src/main.js:48-53` (add `categories: categories.reset` to `RESETS`)
- Modify: `CLAUDE.md` (one In scope line)
- Create: `tests/e2e/category-explorer.spec.js`

**Interfaces:**
- Consumes: `openableCategoryIds` (Task 1); `renderCategoryExplorer`, `reset as resetExplorer`, `openKey` (Task 2); `showing`, `back` (`src/ui/subview.js`); `keyed`, `focusKey`.
- Produces: `export function reset()` in `src/ui/categories.js`. It closes any open category and calls `resetExplorer()`.

Rules:
- `ui.openId: string|null` joins the screen's `ui` state. When it is set and the category still exists, `render` appends the `h2` "Categories" (keep it the screen heading for focus and a11y), then calls `showing(close)` and `renderCategoryExplorer(root, app, openId, back)`, and returns. The guide, the table, the delete panel and the New category form are not drawn. Follow `src/ui/typical.js:54-66` for `close`: clear `openId`, `resetExplorer()`, `app.rerender()`, then focus `openKey(openId)` if `keyed()` finds it, else the `h2`.
- If `openId` names a category that no longer exists, clear it and draw the table.
- In `row()`, the name cell is the rename form while renaming. Otherwise it is a button `{type:'button', class:'secondary name', 'data-focus-key': openKey(c.id)}` when `openableCategoryIds` has the id, and plain text otherwise. Compute the set once per render.
- Clicking a name: set `ui.openId`, close any rename or delete in progress, `app.rerender()`, `focusKey('explore-heading')`.
- The guide's first line becomes: "Kind decides how a category counts. Budget type decides how it shows in your typical month. Open a category to see what is in it."
- CLAUDE.md, In scope, after the "A simple list of uncategorised items" line: "- Open any category from the Categories screen to see its month totals, buckets and transactions".

- [ ] **Step 1: Write the failing e2e spec**

Set up as `tests/e2e/category-explorer.spec.js` with the same serial, shared-page shape as `tests/e2e/category-view.spec.js:1-69` (`trackCspViolations`, `setupFixtureApp`, CSP check in `afterAll`). Tests, in order:

```js
test('a category with nothing in it is plain text; one with something is a button', async () => {
  await openScreen(page, 'Categories');
  // 'Ignore' has nothing yet: no button. 'Big one-offs' has the boiler: a button.
  await expect(table().getByRole('button', { name: 'Ignore', exact: true })).toHaveCount(0);
  await expect(table().getByRole('button', { name: 'Big one-offs', exact: true })).toBeVisible();
});

test('Big one-offs opens with its summary, 12 months and its bucket', async () => {
  await table().getByRole('button', { name: 'Big one-offs', exact: true }).click();
  await expect(viewHeading('Big one-offs')).toBeFocused();
  await expectBesideHeading(viewHeading('Big one-offs'), back());
  await expect(page.getByText('Spend · One-off · 1 transaction in 1 bucket, £2,400.00 out, Jan 2026.', { exact: true })).toBeVisible();
  await expect(page.locator('#screen .month-cells')).toHaveCount(1);
  await expect(page.locator('#screen .month-cells button')).toHaveCount(12);
  await expect(bucketRow('BIG BOILER CO')).toContainText('-£2,400.00');
  await expect(bucketRow('BIG BOILER CO')).toContainText('20/01/2026');
  await expect(listRows()).toHaveCount(1);
  await expectNoAxeViolations(page);
});

test('pressing a month, then the bucket, narrows the list', async () => {
  // Press Dec 2025 (£0.00): 0 rows, "No transactions match." Press Jan 2026: 1 row. Unpress. Press the bucket: 1 row.
});

test('Back returns focus to the name; reopening shows no filters', async () => {
  // After Back: the 'Big one-offs' button is focused. Reopen: no month or bucket pressed, list has 1 row. Close with Back.
});

test('browser back closes the view, as Back does', async () => {
  // Open Big one-offs, press Jan 2026, page.goBack(): the Categories table shows and the name button is focused.
  // Reopen: no month is pressed.
});

test('moving the last transaction out empties the view, and it shows in Ignore as moved here', async () => {
  // Open Big one-offs; select the row's Counts as (label /^Counts as for .*BIG BOILER CO.* on 20\/01\/2026$/) → 'Ignore'.
  // 'Nothing counts as Big one-offs now.' is visible and focused.
  // Back: 'Big one-offs' is plain text and focus is on the Categories h2.
  // Open 'Ignore': 'Ignore · 1 transaction in 1 bucket, £2,400.00 out, Jan 2026.' and bucket row contains '(1 moved here)'.
});

test('Groceries over two accounts: labelled rows, not covered months, 320px with no sideways scroll', async () => {
  // Back, open Groceries: two .month-cells; group /^Bank B joint: / has 9 .uncovered.
  // At 320×640: documentElement.scrollWidth <= 320, and no axe violations. Restore 1280×720.
});
```

Helper locators as in `category-view.spec.js:16-52`: `table()` is `page.getByRole('table', { name: 'Your categories' })`, `viewHeading`, `back()` named "Back to Categories", `bucketRow` within the table named "By bucket", and `listRows`. Comment-only test bodies list the exact steps and assertions to write.

- [ ] **Step 2: Run it and see it fail**

Run: `npx playwright test tests/e2e/category-explorer.spec.js`
Expected: FAIL in the first test. No 'Big one-offs' button.

- [ ] **Step 3: Wire up `src/ui/categories.js` and `src/main.js` to the rules above, and add the CLAUDE.md line**

- [ ] **Step 4: Run every check**

Run: `npm run check`
Expected: banned, unit, types and e2e all pass, including the unchanged `category-view.spec.js`, `categories.spec.js` and `a11y.spec.js`. If `categories.spec.js` finds category names by `rowheader` text, those still match, because the button's text is the name. Any test that breaks there points to a real change. Fix the code, not the test, unless the test asserted the name was plain text.

- [ ] **Step 5: Commit**

```bash
git add src/ui/categories.js src/main.js CLAUDE.md tests/e2e/category-explorer.spec.js
git commit -m "Category explorer: open a category from the Categories screen"
```

---

## After the last task

- Open the PR from `worktree-category-explorer` to `main`. The description lists the CLAUDE.md change (the In scope line). There is no `DATA_VERSION` change, so no tag reminder.
- Once merged, remove "a category's buckets on the Categories screen" from the follow-up tasks memory.
