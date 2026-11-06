# Open a Category, Simpler Fixed, Categorise Hints: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user open any Typical month category to see why its figure is what it is. Fix Fixed by removing the automatic "ended" rule in favour of a manual Stopped mark. Show each category's kind and type on hover on the Categorise card.

**Architecture:** `src/typical.js` is refactored so that one internal pass over the transactions feeds both `typicalMonth` (unchanged output) and a new `categoryDetail`, which returns the per-account month cells, the Fixed bucket lines and the counted transactions for one category. That way the view can't disagree with the figure. The view is a new module, `src/ui/category-view.js`, entered from `src/ui/typical.js`. It reuses `renderTransactionList` through a new `only` option. `stoppedAfter` lives on `Bucket` and is carried by backup, merge and import.

**Tech Stack:** Plain ES modules with JSDoc types, no build step and no runtime dependencies. `node:test`, `tsc --checkJs`, Playwright with `@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-11-05-open-category-design.md`

## Global Constraints

- Render all text with `textContent` (the `h()` helper in `src/dom.js`). Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `eval`.
- No network code and no new links or external resources. No runtime dependencies. Never run `npm install` or `npm ci`.
- Money is integer minor units, rounded only with `divRound`.
- Every threshold comes from `src/tuning.js`, never hard-coded. New key: `unusualMonthPercent: 25`. Removed key: `fixedActiveMonths`.
- Don't change the existing `Row` fields (`categoryId`, `name`, `budgetType`, `perMonth`, `perYear`, `range?`) or what `typicalMonth` returns.
- The app has no users yet. Don't bump `SCHEMA_VERSION`, and add no migration code.
- No real statement data in code, tests, docs or commits. Use synthetic values only.
- Work in the worktree `/Users/oliver/git/budgie/.claude/worktrees/open-category`. `node_modules` is a symlink there. Check that `git status` never lists it.
- `npm run check` (banned, unit, types, e2e) must pass at the end of every task.

## Review Focus

1. **320px width:** the month cells (12 per row, sometimes several rows) and the bucket table must not make the page scroll sideways. The month cells wrap, and the table sits in the existing `.scroll` region. *Test: Task 5, step 1 (`category view fits 320px`).*
2. **Negative or zero month totals:** a spend month made up only of refunds, or a month with nothing, must show as a negative amount or £0.00 and still get a sensible unusual mark. *Test: Task 2, step 1 (`unusualFlags handles zero and negative medians`).*
3. **A Fixed bucket with only refunds in the window:** it has no latest charge, so its row shows Charges 0, Adds per month £0.00 and no Stopped tickbox. *Test: Task 2, step 1 (`a refund-only bucket line has count 0`), and Task 5, step 1.*
4. **A bucket spanning two accounts:** Stopped must take the latest charge date across both accounts, and both lines must show as stopped. *Test: Task 2, step 1 (`stopped applies to every line of a bucket`), and Task 3, step 1 (`stoppedDateFor uses the latest charge across accounts`).*
5. **The month filter combined with search and dates:** pressing a month keeps the search text and the From and To dates, and the list shows only rows that pass all of them. *Test: Task 5, step 1 (`month filter combines with search`).*

---

### Task 1: Fixed without the "ended" rule, with Stopped

**Files:**
- Modify: `src/types.js:12` (Bucket)
- Modify: `src/tuning.js:7`
- Modify: `src/typical.js` (remove `activeMonths` and the ended test at lines 70 and 132-143, and change the `TypicalTuning` typedef at line 24)
- Modify: `src/ui/categories.js:89-100` (Fixed help)
- Test: `tests/unit/typical.test.js`, `tests/unit/tuning.test.js`

**Interfaces:**
- Produces: `Bucket.stoppedAfter?: string` (ISO date). Its presence means Stopped.
- Produces: `TypicalTuning` = `{windowMonths:number, coverageGapDays:number, variableRange:number[], unusualMonthPercent:number}`.
- Produces, for each account and bucket, the Fixed contribution: `count > 0 && !stopped ? Math.max(0, divRound(latest * count, n) + divRound(opposite, n)) : 0`. `n` is that account's covered months.

- [ ] **Step 1: Rewrite the three old-rule tests and add new ones in `tests/unit/typical.test.js`.** Delete the `{ ...tuning, fixedActiveMonths: 4 }` assertion.

```js
test('fixed: a bucket that stopped charging still counts its charges in the window', () => {
  // the existing energy + gym state (gym 9 charges of 3000, Nov to Jul)
  assert.equal(row(typicalMonth(state, tuning), 'bills').perMonth, 9500 + 2250);
});
test('fixed: an old bucket and its refund still count', () => {
  // the existing new (12 × 3500) + old (3 × 3000, refund 4500) state
  assert.equal(row(tm, 'broadband').perMonth, 3500 + 750 - 375);
});
test("fixed: a bucket's refund lowers its figure but never below 0", () => {
  // old: 3 × 3000 and refund 4500 → 375. old2: 3 × 3000 and refund 12000 → 0, not -250
  assert.equal(row(tm, 'broadband').perMonth, 375);
});
test('fixed: council tax over 10 months, with the window ending in March', () => {
  // batches: batch('A', '2025-04-01', '2026-03-31'). 10 charges of -18000, Apr 2025 to Jan 2026
  assert.equal(row(tm, 'ctax').perMonth, 15000);
});
test('fixed: a renamed employer across two buckets gives the full salary', () => {
  // emp-old: 250000 Nov to Jul (9 charges). emp-new: 250000 Aug to Oct (3). Both in 'salary' (income, fixed)
  assert.equal(row(tm, 'salary').perMonth, 250000);
});
test('fixed: a yearly charge counts as a twelfth', () => {
  // one -9500 on 2026-01-15 in subs (fixed), alongside the monthly -1000 stream
  assert.equal(row(tm, 'subs').perMonth, 1000 + 792);
});
test('fixed: a Stopped bucket adds nothing, refunds included', () => {
  // the energy + gym state, with gym given stoppedAfter: '2026-07-05' and a refund of 1000 on 2026-08-01
  assert.equal(row(tm, 'bills').perMonth, 9500);
});
```

- [ ] **Step 2: Update `tests/unit/tuning.test.js`.** In both key lists, replace `'fixedActiveMonths'` with `'unusualMonthPercent'`.

- [ ] **Step 3: Run `npm test`.** Expected: the new and renamed tests FAIL, and the tuning test fails on the missing key.

- [ ] **Step 4: Implement.**
  - `src/tuning.js`: remove `fixedActiveMonths`. Add `unusualMonthPercent: 25,  // open category: a month this % away from its row's median is marked unusual`.
  - `src/types.js`: add `stoppedAfter?:string` to the Bucket typedef.
  - `src/typical.js`: delete `activeMonths`. Apply the Fixed contribution formula from the Interfaces block. A bucket is stopped when `ctx.buckets.get(bucketId)?.stoppedAfter !== undefined`. Update the typedef.
  - `src/ui/categories.js` `guide()`: drop `fixedActiveMonths`. Fixed text: `'Regular charges such as rent or subscriptions. Uses each charge\'s latest amount, as often as it was charged. Open the category on Typical month to mark a charge Stopped.'`

- [ ] **Step 5: Run `npm test && npm run types`.** Expected: PASS. Then `npm run e2e`. Expected: PASS with no figure changes. A scratch check showed that every fixture Typical month figure is the same without the rule. If any `tests/e2e/categories.spec.js` assertion quotes the old Fixed help, update it to the new text. Then run `grep -rn fixedActiveMonths src tests`. Expected: no output.

- [ ] **Step 6: Commit.** `git commit -m "Fixed: drop the automatic ended rule; a Stopped bucket adds nothing"`

---

### Task 2: `categoryDetail`, the data behind the opened view

**Files:**
- Modify: `src/typical.js`
- Test: `tests/unit/typical.test.js`

**Interfaces:**
- Consumes: Task 1's `TypicalTuning` and Fixed formula.
- Produces (all exported from `src/typical.js`):

```js
/** @typedef {{month:string, total:number|null, unusual:boolean}} MonthCell  total null = the account doesn't fully cover that month */
/** @typedef {{accountId:string, share:number, cells:MonthCell[]}} AccountSeries
 *  share: variable → that account's median; annual → its scaled yearly total; fixed → the sum of its bucket lines */
/** @typedef {{bucketId:string, accountId:string, latest:number, count:number, latestDate:string, perMonth:number, stopped:boolean}} BucketLine
 *  latestDate '' and latest 0 when count is 0 */
/** @typedef {{row:Row, currency:string, months:string[], accounts:AccountSeries[], buckets:BucketLine[],
 *   transactionIds:Set<string>, partMinor:Map<string,number>}} CategoryDetail
 *  buckets: [] unless fixed, ordered perMonth desc, then display name. accounts: in state.accounts order, only those with
 *  transactions counted in this category. cells: one per window month, oldest first.
 *  partMinor: txn id → the signed sum of this transaction's parts in this category (transaction direction, not natural). */

export function unusualFlags(totals /* number[] */, percent /* number */) /* : boolean[] */
// median m = median(totals). flag[i] = m === 0 ? totals[i] !== 0 : Math.abs(totals[i] - m) * 100 > percent * Math.abs(m)

export function categoryDetail(state, tuning, categoryId) /* : CategoryDetail | null */
// null when there are mixed currencies, or the category has no Row in typicalMonth's spend, income or contribution tables
```

The refactor is the point of this task. Move the existing transaction loop (window, resolve, net per category, one-offs, uncategorised) into one internal `collect(state, tuning)`. Also record, per category, the counted transaction ids and `partMinor`. Move per-category Row building into an internal `buildRow(category, byAccount, monthsOf)` that also returns the bucket lines. `typicalMonth` and `categoryDetail` must both go through these. Unusual flags are worked out over each row's covered months only, and `null` cells are never unusual.

- [ ] **Step 1: Write the failing tests.**

```js
test('unusualFlags: exactly the percent is not unusual', () => {
  assert.deepEqual(unusualFlags([100, 100, 0, 200, 100, 125], 25), [false, false, true, true, false, false]);
});
test('unusualFlags handles zero and negative medians', () => {
  assert.deepEqual(unusualFlags([0, 0, 5], 25), [false, false, true]);
  assert.deepEqual(unusualFlags([-100, -100, -300], 25), [false, false, true]);
  assert.deepEqual(unusualFlags([], 25), []);
});
test('categoryDetail: variable over two accounts with different coverage', () => {
  // A: full year of groc, monthly amounts varying. S: batch('S', '2026-08-01', '2026-10-31'), groc Aug to Oct
  const d = categoryDetail(state, tuning, 'groc');
  assert.equal(d.accounts.length, 2);
  assert.equal(d.accounts[1].cells.length, 12);
  assert.deepEqual(d.accounts[1].cells.slice(0, 9).map((c) => c.total), Array(9).fill(null));
  assert.equal(d.accounts[0].share + d.accounts[1].share, d.row.perMonth);
  assert.deepEqual(d.row, row(typicalMonth(state, tuning), 'groc'));
});
test('categoryDetail: fixed bucket lines add up to perMonth, and a stopped line is 0', () => {
  // energy 12 × -9500, gym 9 × -3000 with stoppedAfter set
  const d = categoryDetail(state, tuning, 'bills');
  assert.equal(d.buckets.reduce((s, b) => s + b.perMonth, 0), d.row.perMonth);
  assert.deepEqual(d.buckets.map((b) => [b.bucketId, b.count, b.latest, b.perMonth, b.stopped]),
    [['energy', 12, 9500, 9500, false], ['gym', 9, 3000, 0, true]]);
});
test('a refund-only bucket line has count 0', () => {
  // old bucket: only a +4500 refund in the window, category fixed
  assert.deepEqual(pick(d.buckets[0], ['count', 'latest', 'latestDate', 'perMonth']), { count: 0, latest: 0, latestDate: '', perMonth: 0 });
});
test('stopped applies to every line of a bucket', () => {
  // bucket 'gym' charged in accounts A and C, stoppedAfter set → both lines stopped: true, perMonth 0
});
test('categoryDetail: counted transactions include overrides and split parts, not transfers or uncovered months', () => {
  // a txn moved in by override; a -10000 split with -4000 in 'home'; a confirmed transfer pair in the same bucket;
  // a txn in a month the account doesn't fully cover
  assert.ok(d.transactionIds.has(movedIn.id));
  assert.equal(d.partMinor.get(split.id), -4000);
  assert.ok(!d.transactionIds.has(transfer.id));
  assert.ok(!d.transactionIds.has(uncovered.id));
});
test('categoryDetail returns null for one-off, transfer and unknown categories', () => {
  assert.equal(categoryDetail(state, tuning, 'big'), null);
  assert.equal(categoryDetail(state, tuning, 'nope'), null);
});
test('typicalMonth is unchanged by the refactor', () => {
  // the existing tests in this file cover it. Run them all; none may change.
});
```

Build each state with the file's existing helpers (`build`, `cat`, `bucket`, `txn`, `monthly`, `batch`, `acct`). `pick` is a tiny local helper. Unusual flags in each test take their percent from `tuning.unusualMonthPercent`.

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, because `categoryDetail` and `unusualFlags` aren't exported.
- [ ] **Step 3: Implement the refactor and the two exports** as described in the Interfaces block.
- [ ] **Step 4: Run `npm test && npm run types`.** Expected: PASS, with every existing typical test unchanged.
- [ ] **Step 5: Commit.** `git commit -m "typical: categoryDetail shares one pass with typicalMonth"`

---

### Task 3: Carrying `stoppedAfter` through backup, merge and import

**Files:**
- Modify: `src/backup.js:273-295` (`readBucket`)
- Modify: `src/buckets.js` (`mergeBuckets`, `assignBuckets`, and new `setBucketStopped`, `stoppedDateFor` and `resumedBuckets`)
- Modify: `src/ui/import.js:741-765` (`onImport`)
- Test: `tests/unit/backup.test.js`, `tests/unit/buckets.test.js`

**Interfaces:**
- Consumes: `BucketLine` (Task 2).
- Produces, in `src/buckets.js`:

```js
export function setBucketStopped(state, bucketId, stoppedAfter /* string|undefined */) /* : Changes */  // undefined removes the field
export function stoppedDateFor(lines /* BucketLine[] */, bucketId) /* : string|undefined */             // latest latestDate among this bucket's lines with count > 0
export function resumedBuckets(state, changes) /* : Bucket[] */  // buckets in changes.put.buckets that had stoppedAfter in state and don't now
```

- `assignBuckets` rule: when an incoming transaction lands in a bucket with `stoppedAfter`, is dated after it, and is a charge, remove `stoppedAfter` and add the bucket to `changedBuckets`. A charge is `amountMinor > 0` if the bucket's category kind is `income` or `contribution`, and `amountMinor < 0` otherwise.
- `mergeBuckets` rule: across the survivor and every merged bucket, if all have `stoppedAfter`, the result's `stoppedAfter` is the latest of them. Otherwise the field is left off.
- Import message, added to `restart`'s message list after the "Imported …" line, one per resumed bucket: `` `${b.displayName} was marked Stopped and has charged again, so it counts again.` `` Work it out with `resumedBuckets(state, changes)` before `app.store.apply`.

- [ ] **Step 1: Write the failing tests.**

```js
// backup.test.js: extend 'round trip: every field of every backed-up type is copied' so its sample bucket has
// stoppedAfter: '2026-07-05', and add:
test('a bucket stoppedAfter that is not an ISO date is rejected', () => { /* stoppedAfter: '5 July' → ok: false */ });

// buckets.test.js
test('setBucketStopped sets and clears', () => { /* put.buckets[0].stoppedAfter === '2026-07-05'; then undefined → no key */ });
test('stoppedDateFor uses the latest charge across accounts', () => {
  // full BucketLine objects; `line(bucketId, count, latestDate)` fills accountId, latest, perMonth and stopped
  assert.equal(stoppedDateFor([line('g', 2, '2026-06-05'), line('g', 1, '2026-07-01'), line('g', 0, ''), line('x', 1, '2026-09-01')], 'g'),
    '2026-07-01');
});
test('merge keeps stoppedAfter only when every merged bucket was stopped', () => { /* all stopped → latest date; one not → no key */ });
test('a newer charge on import clears stoppedAfter and is reported', () => {
  // spend bucket stopped after 2026-07-05; incoming -3000 on 2026-08-05 → no stoppedAfter; resumedBuckets → [that bucket]
});
test('an older or same-day charge, or a newer refund, leaves stoppedAfter alone', () => {
  // incoming -3000 on 2026-07-05, and +500 on 2026-08-10 → stoppedAfter kept; resumedBuckets → []
});
test('an income bucket counts a credit as a charge', () => { /* category kind income; +250000 after the date → cleared */ });
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** In `readBucket`: `if (has(o, 'stoppedAfter')) c.need(isIsoDate(stoppedAfter), 'stopped date')`, and copy it when valid. Then add the three functions and the two rules above, and the import message.
- [ ] **Step 4: Run `npm test && npm run types`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Stopped mark survives backup and merge; a newer charge clears it on import"`

---

### Task 4: Restricting the transaction list to a category

**Files:**
- Modify: `src/ui/transactions.js:40-140`
- Test: covered end to end in Task 5. This task's check is types plus the existing `tests/e2e/transactions.spec.js` and `buckets.spec.js` passing unchanged.

**Interfaces:**
- Produces: `renderTransactionList(root, app, filters)`, where `filters` is `{bucketId?: string, only?: Only}`:

```js
/** @typedef {{key:string, ids:Set<string>, bucketIds:string[], categoryName:string, partMinor:Map<string,number>}} Only
 *  key: the view key (stored in `views`), ids: the transactions allowed, bucketIds: the Bucket filter's options */
export function listView(key /* string */) /* : View */  // the stored View for key, created empty if missing
```

- With `only`: results are `searchTransactions(...)` limited to `only.ids`. The Bucket select lists only `only.bucketIds`, in name order. The view key is `only.key`.
- With `only`, a row whose `resolve` source is `split` gets, inside its Counts as cell after `countsAsCell`, `h('span', { class: 'muted' }, `${formatMoney(only.partMinor.get(t.id), t.currency)} of this counts as ${only.categoryName}`)`.
- Without `only`, behaviour is unchanged.

- [ ] **Step 1: Implement** the typedef, `listView`, and the `only` branch in `renderTransactionList` and `drawResults`.
- [ ] **Step 2: Run `npm run types && npm run e2e -- transactions buckets`.** Expected: PASS.
- [ ] **Step 3: Commit.** `git commit -m "Transaction list can be limited to a set of transactions"`

---

### Task 5: The opened category view

**Files:**
- Create: `src/ui/category-view.js`
- Modify: `src/ui/typical.js` (category name button, `reset`, and the open-view branch in `render`)
- Modify: `src/main.js:47` (register `typical: typical.reset` in the resets)
- Modify: `src/ui/form.js` (add `KIND_WORDS`)
- Modify: `styles.css` (month cells, unusual, stopped row)
- Create: `tests/e2e/category-view.spec.js`
- Modify: `tests/e2e/typical-states.spec.js` (Stopped cleared by import)

**Interfaces:**
- Consumes: `categoryDetail`, `CategoryDetail`, `BucketLine` (Task 2). `setBucketStopped` and `stoppedDateFor` (Task 3). `renderTransactionList` with `only`, and `listView` (Task 4).
- Produces:

```js
// src/ui/form.js
export const KIND_WORDS = { spend: 'Spending', income: 'Income', contribution: 'Contribution', transfer: 'Transfer', ignore: 'Ignore' };
// src/ui/category-view.js
export function renderCategoryView(root /* HTMLElement */, app /* App */, categoryId /* string */, onBack /* () => void */) /* : void */
export function explanation(detail /* CategoryDetail */, kind /* CategoryKind */, money /* (minor:number)=>string */) /* : string */
// src/ui/typical.js
export function reset() /* : void */  // closes an open category
```

**Behaviour (from the spec, with values fixed):**
- In `rowsTable`, the row header holds `h('button', { type: 'button', class: 'secondary name', 'data-focus-key': `typical-open-${r.categoryId}` }, r.name)`. Clicking it sets `ui.openId` and calls `app.rerender()`, then focuses `category-heading`.
- In `render`, after the hidden `h2`, if `ui.openId` is set, call `renderCategoryView` and return.
- `onBack`: clear `ui.openId`, `app.rerender()`, then `focusKey(`typical-open-${id}`)`. If no element has that key, focus `#screen h2`.
- Heading: `h('h3', { tabindex: '-1', 'data-focus-key': 'category-heading' }, name)`.
- `explanation`. Here `n` is the single account's covered month count, and `plural` comes from `form.js`:
  - one account, variable: `${K} · Variable · ${m(perMonth)} a month, the median of these ${plural(n,'month','months')}. Typical range ${m(lo)} to ${m(hi)}.`
  - one account, fixed: `${K} · Fixed · ${m(perMonth)} a month: each charge's latest amount, as often as it was charged in these ${plural(n,'month','months')}.`
  - one account, annual: `${K} · Annual · ${m(perYear)} a year over these ${plural(n,'month','months')}, so ${m(perMonth)} a month.` When `n < 12`, add ` Yearly figures are scaled to 12 months.`
  - several accounts, variable: `${K} · Variable · ${m(perMonth)} a month: each account's median month, added together. Typical range ${m(lo)} to ${m(hi)}.`
  - several accounts, fixed: `${K} · Fixed · ${m(perMonth)} a month: each charge's latest amount, as often as it was charged in its account's months.`
  - several accounts, annual: `${K} · Annual · ${m(perYear)} a year: each account's yearly total, scaled to 12 months and added together, so ${m(perMonth)} a month.`
  - `K = KIND_WORDS[kind]`.
- Each month (`h4` "Each month"): one `div.month-cells` per account. With several accounts, each gets a label `${account name}: ${m(share)}` (for annual, `${m(share)} a year`). Each covered cell is a `button` with `aria-pressed`, the text `${formatMonth(month)}`, a line break, and `m(total)`. When unusual, it gets the class `unusual` and a visually hidden `, unusual`. An uncovered cell is a plain `span.muted` reading `${formatMonth(month)}` and `not covered`. Pressing a cell sets the view's `{month, accountId}`. Pressing the same cell again clears it. The list's `only.ids` is then narrowed to that account's transactions dated in that month.
- By bucket (fixed only, `h4` "By bucket"): a table in `.scroll` with the columns Bucket, (Account, when there are several accounts), Latest charge, Charges, Last charged, Adds per month, Stopped. The Bucket cell holds a toggle button (`aria-pressed` = `listView(key).bucketId === bucketId`). It sets or clears `listView(key).bucketId`, then calls `app.rerender()`. A row with `count > 0` gets a checkbox labelled `Stopped: ${displayName}`. Ticking it saves `setBucketStopped(state, id, stoppedDateFor(detail.buckets, id))`, and unticking saves `setBucketStopped(state, id, undefined)`, both through `whileSaving`, as other screens do. A stopped row gets the class `stopped`. Under the table, `help("Mark a charge Stopped only if it has ended and nothing replaced it. If another bucket took over, such as after a name change, leave both as they are, or merge them on Buckets so the latest amount is used.")`
- Transactions (`h4` "Transactions"): `renderTransactionList(root, app, { only: { key: `category:${id}`, ids, bucketIds, categoryName, partMinor } })`. `bucketIds` holds the distinct `bucketId`s of the counted transactions.
- When `categoryDetail` returns null: the heading (the category name from state, or "Category" if it's gone), `h('p', { tabindex: '-1', 'data-focus-key': 'category-empty' }, `Nothing counts as ${name} in these months now.`)`, then Back. If focus was inside the view before the redraw, focus `category-empty`.
- Back: `h('div', { class: 'actions' }, h('button', { type: 'button', class: 'secondary', 'data-focus-key': 'category-back' }, 'Back to Typical month'))`.
- View state (`{categoryId, month: null | {month, accountId}}`) is local to the module. Opening a different category resets it. `typical.reset()` clears `ui.openId`.
- CSS: `.month-cells { display: flex; flex-wrap: wrap; gap: … }`, `.month-cells .unusual { font-weight: 700; border-width: 2px; }`, `tr.stopped { opacity: .6; }`. Reuse the existing tokens and button styles. Don't use inline styles, because the CSP is `style-src 'self'`.

- [ ] **Step 1: Write the failing E2E tests** in `tests/e2e/category-view.spec.js`. Use the serial shared-page pattern and `setupFixtureApp` from `typical.spec.js`.

```js
test('Salary opens from Typical month with the Fixed explanation', async () => {
  await openScreen(page, 'Typical month');
  await row('Income', 'Salary').getByRole('button', { name: 'Salary' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Salary' })).toBeFocused();
  await expect(page.getByText("Income · Fixed · £2,500.00 a month: each charge's latest amount, as often as it was charged in these 12 months.")).toBeVisible();
});
test('the bucket lines add up to the figure', async () => { /* sum of "Adds per month" cells === 250000 minor */ });
test('Groceries shows one row of month cells per account, with not covered months', async () => {
  /* two .month-cells groups; the Bank B group has 9 "not covered" cells; the shares add up to £737.84 */
});
test('month filter combines with search', async () => {
  /* open Groceries, type a search term, press one month cell → every row's date is in that month and matches the search;
     the search box still holds the text; press again → aria-pressed false */
});
test('a bucket name filters the list and toggles off', async () => { /* Subscriptions: press SPOTIFY → all rows SPOTIFY; press again → all */ });
test('Stopped lowers the figure here and on Typical month, and unticking restores it', async () => {
  /* Subscriptions £89.97; tick Stopped: SPOTIFY → explanation figure = 89.97 − that row's Adds per month; Back →
     Subscriptions row shows the same; reopen, untick → £89.97 */
});
test('Back returns focus to the category button', async () => { /* toBeFocused on the Salary button */ });
test('leaving through the nav closes the category', async () => { /* open Salary, go to Buckets, back to Typical month → tables showing */ });
test('category view passes axe and fits 320px', async () => {
  /* open Groceries and Subscriptions in turn: expectNoAxeViolations(page); at 320 × 640 scrollWidth ≤ 320 */
});
```

In `tests/e2e/typical-states.spec.js`, add a test with CSVs written at test time. Import one CSV with a monthly charge from Jan to Mar. Put its bucket in a Fixed category. Open the category on Typical month and tick Stopped. Import a second CSV with an April charge. Expect the banner text `${bucket} was marked Stopped and has charged again, so it counts again.`, and expect the Stopped tickbox to be unticked.

Add a second test there. Import a one-row CSV and put its bucket in a category, then open that category from Typical month. Set the row's Counts as to Ignore. Expect `Nothing counts as ${name} in these months now.` to be focused, and Back to focus the Typical month heading.

- [ ] **Step 2: Run `npm run e2e -- category-view typical-states`.** Expected: FAIL.
- [ ] **Step 3: Implement** everything in the Behaviour list.
- [ ] **Step 4: Run `npm run check`.** Expected: PASS, including the existing `typical.spec.js` row lookups. The row header's accessible name is still the category name.
- [ ] **Step 5: Commit.** `git commit -m "Open a category from Typical month"`

---

### Task 6: Kind and type tooltips on the Categorise card

**Files:**
- Modify: `src/ui/form.js` (add `categoryHint`)
- Modify: `src/ui/categorise.js:242-248`
- Test: `tests/e2e/categorise.spec.js`

**Interfaces:**
- Consumes: `KIND_WORDS` (Task 5) and `BUDGET_LABELS`.
- Produces: `export function categoryHint(category /* Category */) /* : string */` in `src/ui/form.js`:
  - spend, income or contribution: `${KIND_WORDS[kind]} · ${BUDGET_LABELS[type]}: ${HINT[type]}`, where `type` falls back to `'variable'` as `typicalMonth` does. `HINT` is `{ fixed: "each charge's latest amount, as often as charged, ÷ 12", variable: 'the median month', annual: "the year's total ÷ 12", oneoff: 'shown separately, not in your typical month' }`.
  - transfer: `'Transfer: not counted'`. Ignore: `'Ignore: not counted'`.
- Each category button gets `title: categoryHint(c)` and `'aria-describedby': `cat-hint-${c.id}``. A `span.visually-hidden` with that id and the same text is appended once, inside the card, next to the buttons. New category… gets neither.

- [ ] **Step 1: Write the failing test** in `tests/e2e/categorise.spec.js`.

```js
test('category buttons describe their kind and type', async () => {
  const salary = page.getByRole('button', { name: /Salary$/ });
  await expect(salary).toHaveAttribute('title', "Income · Fixed: each charge's latest amount, as often as charged, ÷ 12");
  await expect(salary).toHaveAccessibleDescription("Income · Fixed: each charge's latest amount, as often as charged, ÷ 12");
  await expect(page.getByRole('button', { name: /Groceries$/ })).toHaveAttribute('title', 'Spending · Variable: the median month');
  await expect(page.getByRole('button', { name: /Ignore$/ })).toHaveAttribute('title', 'Ignore: not counted');
  await expect(page.getByRole('button', { name: 'New category…' })).not.toHaveAttribute('title', /.+/);
});
```

- [ ] **Step 2: Run `npm run e2e -- categorise`.** Expected: FAIL.
- [ ] **Step 3: Implement** `categoryHint` and the button attributes.
- [ ] **Step 4: Run `npm run check`.** Expected: PASS, including the axe checks on Categorise.
- [ ] **Step 5: Commit.** `git commit -m "Categorise: kind and type on hover"`

---

### Task 7: Documents and the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-11-04-living-costs-design.md:157,336`
- Modify: `CLAUDE.md` (the Bucket line in the data model)

- [ ] **Step 1: Update the main design.** In the `tuning.js` block, remove `fixedActiveMonths` and add `unusualMonthPercent: 25`. In the Fixed paragraph, replace the "Only buckets with a transaction in the last `fixedActiveMonths`…" sentence with: "Every bucket with a charge in the window counts. A bucket the user marks Stopped adds nothing, and a newer charge on import clears the mark. Each bucket's figure is never below 0." Add one line pointing to `2026-11-05-open-category-design.md` for the opened category view.
- [ ] **Step 2: Update CLAUDE.md.** Change the Bucket line to `Bucket         { id, key, displayName, categoryId?, categorySource, exampleRawTexts[], stoppedAfter? }`.
- [ ] **Step 3: Check Help.** `src/ui/help.js` has no Typical month or Fixed text (checked while planning), so it needs no change. Confirm with `grep -n -i "typical\|fixed" src/ui/help.js`. Expected: no output.
- [ ] **Step 4: Run `npm run check`.** Expected: PASS.
- [ ] **Step 5: Commit, push over SSH and open the PR** with `gh pr create`. The PR description lists every CLAUDE.md change (the Bucket line only) and says that no fixture Typical month figure changed. End it with the attribution line. Don't merge: the owner merges.
