# Typical Month Window and Compare a Month: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Typical month, let the user choose the window's first and last month, and optionally compare one month against the typical figures, with month, Change and paired-bar columns.

**Architecture:** `analysisWindow` in `src/coverage.js` takes an optional month range. `typicalMonth` in `src/typical.js` takes `{range, compare}`. It runs the existing `collect` pass once over the window, and once more over a one-month window for the compared month, so both columns use the same resolution. `categoryDetail` takes the same range. The choices live in the unsaved `ui` object in `src/ui/typical.js` and are passed down to the category view.

**Tech Stack:** Plain ES modules with JSDoc types, no build step and no runtime dependencies. `node:test`, `tsc --checkJs`, Playwright with `@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-11-06-compare-month-design.md`

## Global Constraints

- Render all text with `textContent` (the `h()` helper in `src/dom.js`). Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `eval`. Set bar widths through `el.style.width`, as `bar()` in `src/ui/typical.js` does.
- No network code, no new links or external resources, and no runtime dependencies. Never run `npm install` or `npm ci`.
- Money is integer minor units, rounded only with `divRound`.
- Every threshold comes from `src/tuning.js`, never hard-coded. The "Latest N months" label uses `tuning.windowMonths`.
- No new stored data. Don't change `DATA_VERSION`, backups or `src/types.js`.
- Don't change the existing `Row` fields or the existing `TypicalMonth` fields. Only add new ones. With no choices made, `typicalMonth(state, tuning)` returns what it returns today, plus the new fields.
- Categorise, Buckets and progress keep calling `analysisWindow(state, tuning)` with no range, and their behaviour doesn't change.
- Copy, exactly as written:
  - `Typical from`, `to`, `Latest ${windowMonths} months`, `Compare with`, `No month`
  - Change cells: `£73.00 less`, `£55.00 more`, `same`
  - `Annual categories use the typical figure in the month too, so a yearly bill doesn't skew it.`
  - `${Mon YYYY} has no complete statement for ${account name}. Its spending that month isn't included.`
- No real statement data in code, tests, docs or commits. Use synthetic values only.
- Work in the worktree `/Users/oliver/git/budgie/.claude/worktrees/compare-month`. `node_modules` is a symlink there. Check that `git status` never lists it.
- `npm run check` (banned, unit, types, e2e) must pass at the end of every task.

## Review Focus

1. **The data changes under a choice.** If an undo removes the compared month or every month of the chosen window, the screen must fall back (to "No month", or to the default window) and not throw. *Test: Task 2, `settleChoices drops choices that are no longer complete`.*
2. **Comparing doesn't move the typical figures.** Comparing a month inside the window must leave every `perMonth`, `perYear`, `range` and total exactly as they are without comparing. *Test: Task 2, `comparing leaves the typical figures unchanged`.*
3. **Splits, overrides and transfers in the compared month.** A split part counts in its own category's month figure, and a confirmed transfer counts in none. *Test: Task 2, `month figures resolve splits and transfers like the typical ones`.*
4. **Income and a negative Left over.** For income, a lower month is "less". If the month's Left over is negative, the money shows as negative, and Change still reads correctly. *Test: Task 4, `changeText`.*
5. **320px with comparison on.** The wider summary and the six-column tables must not make the page scroll sideways. *Test: Task 4, `comparison fits 320px and passes axe`.*

---

### Task 1: Window range in coverage

**Files:**
- Modify: `src/coverage.js` (`Window` typedef, `analysisWindow`, new `coveringAccounts`)
- Test: `tests/unit/coverage.test.js`

**Interfaces:**
- Produces: `/** @typedef {{from:string,to:string}} MonthRange */`, exported from `src/coverage.js`. Both values are `YYYY-MM`.
- Produces: `Window` = `{months:string[], complete:boolean, isDefault:boolean, accountMonths:Map<string,Set<string>>}`.
- Produces: `analysisWindow(state, tuning, range = null): Window`. With a range, `months` is the complete months with `from <= m <= to`. If that is empty, or `range` is null, it is the default, `complete.slice(-tuning.windowMonths)`. `isDefault` is true when `months` equals the default months element by element, and always true in the no-complete-months fallback. `accountMonths` is built from `months` exactly as today.
- Produces: `coveringAccounts(state, tuning, month): Set<string>`, the ids of the non-placeholder accounts whose `accountMonthStatus` for `month` is `'covered'`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/coverage.test.js`, using the file's `build`, `acct` and `batch` helpers:

```js
test('a range keeps only its complete months, per account', () => {
  const s = build([acct('A'), acct('B')], [batch('A', '2025-11-01', '2026-10-31'), batch('B', '2026-08-01', '2026-10-31')]);
  const w = analysisWindow(s, tuning, { from: '2026-02', to: '2026-08' });
  assert.deepEqual(w.months, monthRange('2026-02', '2026-08'));
  assert.equal(w.isDefault, false);
  assert.deepEqual([...(w.accountMonths.get('B') ?? [])], ['2026-08']);
});
test('a single-month range works', () => {
  const s = build([acct('A')], [batch('A', '2025-11-01', '2026-10-31')]);
  assert.deepEqual(analysisWindow(s, tuning, { from: '2026-03', to: '2026-03' }).months, ['2026-03']);
});
test('a range with no complete months, or no range, gives the default window', () => {
  const s = build([acct('A')], [batch('A', '2025-11-01', '2026-10-31')]);
  for (const range of [null, { from: '2024-01', to: '2024-06' }]) {
    const w = analysisWindow(s, tuning, range);
    assert.deepEqual(w.months, monthRange('2025-11', '2026-10'));
    assert.equal(w.isDefault, true);
  }
  assert.equal(analysisWindow(s, tuning, { from: '2025-11', to: '2026-10' }).isDefault, true);
});
test('coveringAccounts lists accounts that cover the month, never placeholders', () => {
  const s = build([acct('A'), acct('B'), acct('P', 'placeholder')],
    [batch('A', '2025-11-01', '2026-10-31'), batch('B', '2026-08-01', '2026-10-31')]);
  assert.deepEqual([...coveringAccounts(s, tuning, '2026-06')], ['A']);
  assert.deepEqual([...coveringAccounts(s, tuning, '2026-09')].sort(), ['A', 'B']);
});
```

Import `coveringAccounts` from `src/coverage.js` and `monthRange` from `src/dates.js`.

- [ ] **Step 2: Run them and check they fail**

Run: `node --test tests/unit/coverage.test.js`
Expected: FAIL. `coveringAccounts` is not exported, and `isDefault` is undefined.

- [ ] **Step 3: Implement** `MonthRange`, `isDefault`, the `range` parameter and `coveringAccounts` in `src/coverage.js`. Use the existing `intervalsByAccount` and `accountMonthStatus`.

- [ ] **Step 4: Run the unit tests and types**

Run: `npm test && npm run types`
Expected: PASS. The other callers of `analysisWindow` are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/coverage.js tests/unit/coverage.test.js
git commit -m "Window range and covering accounts in coverage"
```

---

### Task 2: Typical figures for a chosen window and a compared month

**Files:**
- Modify: `src/typical.js` (`collect`, `typicalMonth`, `categoryDetail`, typedefs, new `settleChoices`)
- Test: `tests/unit/typical.test.js`

**Interfaces:**
- Consumes: `MonthRange`, `analysisWindow(state, tuning, range)`, `coveringAccounts(state, tuning, month)` and `completeMonths(state, tuning)` from Task 1 and `src/coverage.js`.
- Produces: `/** @typedef {{range:MonthRange|null, compare:string|null}} TypicalChoices */`
- Produces: `Row` gains `month?: number` (the compared month's figure, natural direction, present on every row when comparing) and `monthOnly?: true` (the category has no transactions in the window).
- Produces: `/** @typedef {{month:string, missing:Account[], totals:Totals}} Comparison */`
- Produces: `TypicalMonth` gains `isDefault: boolean` and `compare: Comparison|null`.
- Produces: `typicalMonth(state, tuning, choices = {range: null, compare: null})`.
- Produces: `categoryDetail(state, tuning, categoryId, range = null)`. It uses `analysisWindow(state, tuning, range)`.
- Produces: `settleChoices(complete: string[], choices: TypicalChoices): TypicalChoices`. `range` becomes null when `from > to` or no month in `complete` falls within it. `compare` becomes null when `complete` doesn't include it. Otherwise each is returned unchanged.

How the comparison is built:
- `collect` takes the `Window` as a parameter instead of building it. `typicalMonth` and `categoryDetail` build the window and pass it in.
- For the compared month `M`, call `collect` a second time with `{months: [M], complete: true, isDefault: false, accountMonths}`. Each account maps to `new Set([M])` if `coveringAccounts` has it, or to an empty set if not. Then a category's month figure is the sum, over its accounts in that second pass, of `months.get(M)`.
- The month figure per budget type: for Fixed and Variable, the summed figure (0 when absent). For Annual, the row's `perMonth`. One-offs are never compared, and the second pass's `oneOffs` and `uncategorised` are discarded.
- A category that has month figures but no window sums gets a row with `perMonth: 0`, `perYear: 0`, no `range`, `monthOnly: true`, and its `month` figure. *Plan's call:* Annual categories never get a month-only row, since their month figure is their typical one, 0.
- `compare.totals` uses the same formulas as `totals`, with `month` in place of `perMonth`.
- `compare.missing`: the accounts, in `state.accounts` order, that appear in any window category's `byAccount` but aren't in `coveringAccounts(M)`.
- `compare` is null when `choices.compare` is null, when the window has no complete months, or when `M` isn't in `completeMonths`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/typical.test.js`, with the file's helpers (`build`, `acct`, `batch`, `yearBatch`, `cat`, `bucket`, `txn`, `monthly`, `row`, `YEAR`):

```js
test('a chosen range gives the typical figures over its months only', () => {
  // groceries variable: 10000 a month Nov to Jun, 6000 Jul to Oct
  const tm = typicalMonth(state, tuning, { range: { from: '2025-11', to: '2026-06' }, compare: null });
  assert.equal(row(tm, 'groceries').perMonth, 10000);
  assert.equal(tm.isDefault, false);
  assert.equal(tm.compare, null);
});
test('compare: fixed and variable use the month total, annual its typical figure', () => {
  // same state, plus rent fixed 90000 every month, gifts annual 48000 in Dec only
  const tm = typicalMonth(state, tuning, { range: { from: '2025-11', to: '2026-06' }, compare: '2026-10' });
  assert.equal(row(tm, 'groceries').month, 6000);
  assert.equal(row(tm, 'rent').month, 90000);
  assert.equal(row(tm, 'gifts').month, row(tm, 'gifts').perMonth);
  assert.equal(tm.compare?.totals.living, 6000 + 90000 + row(tm, 'gifts').perMonth);
});
test('comparing leaves the typical figures unchanged', () => {
  const plain = typicalMonth(state, tuning);
  const compared = typicalMonth(state, tuning, { range: null, compare: '2026-03' });
  const strip = (/** @type {any[]} */ rows) => rows.map(({ month, ...r }) => r);
  assert.deepEqual(strip(compared.spend), plain.spend);
  assert.deepEqual(compared.totals, plain.totals);
});
test('a category only in the compared month gets a month-only row; annual does not', () => {
  // account B covers Aug to Oct only; contrib fixed 55000 monthly on B; window Nov to Jun
  const tm = typicalMonth(state, tuning, { range: { from: '2025-11', to: '2026-06' }, compare: '2026-10' });
  assert.deepEqual(row(tm, 'contrib'), {
    categoryId: 'contrib', name: 'contrib', budgetType: 'fixed', perMonth: 0, perYear: 0, month: 55000, monthOnly: true,
  });
  // an annual category with a charge only in Oct has no row
});
test('compare.missing lists window accounts that do not cover the month', () => {
  // default window; B covers Aug to Oct and has counted transactions
  assert.deepEqual(typicalMonth(state, tuning, { range: null, compare: '2026-06' }).compare?.missing.map((a) => a.id), ['B']);
});
test('month figures resolve splits and transfers like the typical ones', () => {
  // in Oct: a -10000 transaction split 7000 groceries / 3000 household; a confirmed transfer pair
  // groceries month 7000, household month 3000, and the transfer adds to no category
});
test('month columns reconcile with the compare totals', () => {
  // for every table, the sum of month equals compare.totals.living / income / contributions,
  // and share and leftOver follow from them
});
test('settleChoices drops choices that are no longer complete', () => {
  const complete = monthRange('2026-01', '2026-06');
  assert.deepEqual(settleChoices(complete, { range: { from: '2026-02', to: '2026-04' }, compare: '2026-05' }),
    { range: { from: '2026-02', to: '2026-04' }, compare: '2026-05' });
  assert.deepEqual(settleChoices(complete, { range: { from: '2025-01', to: '2025-06' }, compare: '2026-09' }),
    { range: null, compare: null });
  assert.deepEqual(settleChoices(complete, { range: { from: '2026-04', to: '2026-02' }, compare: null }),
    { range: null, compare: null });
});
test('categoryDetail with a range matches the row typicalMonth gives', () => {
  const range = { from: '2025-11', to: '2026-06' };
  const tm = typicalMonth(state, tuning, { range, compare: null });
  const d = categoryDetail(state, tuning, 'groceries', range);
  assert.deepEqual(d?.row, row(tm, 'groceries'));
  assert.deepEqual(d?.months, monthRange('2025-11', '2026-06'));
});
```

Build each `state` with `build(...)` as the comments describe, and fill in the commented assertions with exact numbers from those states. Import `settleChoices` from `src/typical.js`, and `monthRange` from `src/dates.js` (the file already imports it).

- [ ] **Step 2: Run them and check they fail**

Run: `node --test tests/unit/typical.test.js`
Expected: FAIL. `settleChoices` is not exported, and `month` and `isDefault` are undefined.

- [ ] **Step 3: Implement** the changes above in `src/typical.js`.

- [ ] **Step 4: Run the unit tests and types**

Run: `npm test && npm run types`
Expected: PASS. Every existing `typical.test.js` test passes unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/typical.js tests/unit/typical.test.js
git commit -m "Typical figures for a chosen window and a compared month"
```

---

### Task 3: Window controls on Typical month

**Files:**
- Modify: `src/ui/typical.js` (`ui` state, the control row, the "Only N" line, passing `range` to the category view)
- Modify: `src/ui/category-view.js:88-99` (`renderCategoryView` takes `range`)
- Modify: `styles.css` (Typical month section: the control rows)
- Modify: `src/tuning.js:6` (comment) and `CLAUDE.md` (scope line)
- Create: `tests/e2e/typical-compare.spec.js`

**Interfaces:**
- Consumes: `typicalMonth(state, tuning, choices)`, `settleChoices`, `TypicalChoices` and `categoryDetail(..., range)` from Task 2, and `completeMonths` from `src/coverage.js`.
- Produces: `ui` in `src/ui/typical.js` gains `range: MonthRange|null` and `compare: string|null`, both null at load. `reset()` still clears only `openId` and the category view, so the choices survive the nav.
- Produces: `renderCategoryView(screen, app, categoryId, onBack, range = null)`. It passes `range` to `categoryDetail`.
- Produces, for Task 4: a second control row, `div.typical-controls`, holding the Compare select, which Task 4 fills in.

Behaviour:
- At the top of `render`, after the empty-state check: `Object.assign(ui, settleChoices(completeMonths(state, app.tuning), ui))`, then `typicalMonth(state, app.tuning, ui)`.
- The control rows are drawn after the hgroup, and only when `tm.complete`. Row 1: label `Typical from`, a select (`data-focus-key: 'typical-from'`), label `to`, a select (`'typical-to'`), and, only when `!tm.isDefault`, a secondary button `Latest ${app.tuning.windowMonths} months` (`'typical-latest'`). Each select has its own `<label for>`.
- The option values are `YYYY-MM`, the text is `formatMonth`, and options are newest first. "From" lists the complete months up to the current "to". "To" lists those from the current "from". The selected options are `tm.months[0]` and the last of `tm.months`.
- Changing either select sets `ui.range` to `{from, to}` and calls `app.rerender()`, which keeps focus through the `data-focus-key`. The button sets `ui.range = null`, calls `app.rerender()`, then `focusKey('typical-from')`.
- The "Only N complete months so far…" line is shown only when `tm.isDefault`.
- `renderCategoryView(root, app, openId, back, ui.range)`.
- CSS: `.typical-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; margin: 0 0 0.5rem; }`, with labels at weight 600.
- `src/tuning.js:6` comment: `// typical month: default window, the latest N complete months`.
- `CLAUDE.md`, under Scope, In scope, after "Monthly budget view": `- Typical month: choose the window's first and last month, and compare one month against it`.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/typical-compare.spec.js`. Use serial mode and one shared page set up with `setupFixtureApp`, as `tests/e2e/typical.spec.js` does. Copy its `table`, `row` and `summary` helpers.

```js
test('default: the window pickers show the latest 12 months, with no reset button', async () => {
  await expect(page.getByLabel('Typical from')).toHaveValue('2025-11');
  await expect(page.getByLabel('to', { exact: true })).toHaveValue('2026-10');
  await expect(page.getByRole('button', { name: 'Latest 12 months' })).toHaveCount(0);
  await expect(page.getByLabel('Typical from').locator('option').first()).toHaveText('Oct 2026'); // newest first
});
test('a chosen window recalculates and keeps focus', async () => {
  await page.getByLabel('to', { exact: true }).selectOption('2026-06');
  await expect(page.locator('#typical-window')).toHaveText('Based on 8 complete months, Nov 2025 to Jun 2026');
  await expect(page.getByLabel('to', { exact: true })).toBeFocused();
  await expect(page.getByText('complete months so far')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Contributions', exact: true })).toHaveCount(0); // Bank B starts in Aug
  await expect(page.getByLabel('Typical from').locator('option[value="2026-07"]')).toHaveCount(0);
});
test('the window is kept through a category view and the nav', async () => {
  // open Groceries: its month cells include Jun 2026 and no Jul 2026; press Back
  // openScreen Categorise, then Typical month: the window text is still the 8-month one
});
test('Latest 12 months puts the default back', async () => {
  await page.getByRole('button', { name: 'Latest 12 months' }).click();
  await expect(page.locator('#typical-window')).toHaveText('Based on 12 complete months, Nov 2025 to Oct 2026');
  await expect(page.getByLabel('Typical from')).toBeFocused();
});
```

Find the month cells in the category view with the same locators `tests/e2e/category-view.spec.js` uses.

- [ ] **Step 2: Run them and check they fail**

Run: `npx playwright test tests/e2e/typical-compare.spec.js`
Expected: FAIL. No control is labelled "Typical from".

- [ ] **Step 3: Implement** the behaviour above.

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: PASS, including the existing `typical.spec.js`, `typical-states.spec.js` and `a11y.spec.js`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/typical.js src/ui/category-view.js styles.css src/tuning.js CLAUDE.md tests/e2e/typical-compare.spec.js
git commit -m "Choose the Typical month window"
```

---

### Task 4: Compare a month

**Files:**
- Modify: `src/ui/typical.js` (the Compare select, summary, tables, bars, banner, help, new `changeText`)
- Modify: `styles.css` (paired bars, bar key, summary table)
- Modify: `tests/e2e/typical-compare.spec.js`
- Create: `tests/unit/typical-ui.test.js`

**Interfaces:**
- Consumes: `tm.compare`, `Row.month` and `Row.monthOnly` from Task 2, and `ui.compare` and `.typical-controls` from Task 3.
- Produces: `export function changeText(diff: number, money: (minor:number)=>string): string` in `src/ui/typical.js`. It returns `'same'` for 0, `` `${money(-diff)} less` `` for a negative diff and `` `${money(diff)} more` `` for a positive one. The caller passes `month - perMonth`, or for summary lines, month total minus typical total.

Behaviour:
- **Compare row:** the second `.typical-controls` row has the label `Compare with` and a select (`data-focus-key: 'typical-compare'`). Its first option is `No month` (value `''`), then the complete months, newest first. Changing it sets `ui.compare` to the value or null, then calls `app.rerender()`.
- **With no compared month**, everything below the controls is exactly as today.
- **With a compared month `M`** (`tm.compare` is not null):
  - After the stale banners, there is one `p.banner` per `tm.compare.missing` account, with the copy from Global Constraints.
  - The summary is a `table` with `class: 'summary-compare'` and `aria-label: 'Summary per month'`, in place of the `dl`. Its column headings are an empty cell, `Typical`, `formatMonth(M)` and `Change`. Its rows are the same lines and `sub` classes as `summaryList`, each with a `th scope="row"` and three cells. Values come from `tm.totals` and `tm.compare.totals`.
  - In each table the columns are `Category`, `Type`, `Typical`, `formatMonth(M)`, `Change` and the hidden `Share of largest`. Per year is not shown.
  - A row with `monthOnly` shows its name as plain text in the `th`, with no button.
  - The bar cell is `div.bars` (`aria-hidden`), holding `span.bar` (typical) and `span.bar.month` (outlined), both scaled against the table's largest `perMonth` or `month`. Above each table, under its `h3`, an `aria-hidden` `p.bar-key` shows a short solid and outlined swatch labelled `Typical` and `formatMonth(M)`.
  - After the last table and before the one-offs, show `help('Annual categories use the typical figure in the month too, so a yearly bill doesn\'t skew it.')`.
- CSS, under the Typical month section, matching `compare-combined.html`: `.bars { display: grid; gap: 2px; }`, `.bar.month { background: transparent; border: 2px solid var(--accent); }`, both bars `height: 0.75rem` inside `.bars`, the `.bar-key` swatches, and `table.summary-compare` styled like `dl.summary` (numbers right-aligned and tabular, the `sub` rows indented).

- [ ] **Step 1: Write the failing unit test** in `tests/unit/typical-ui.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeText } from '../../src/ui/typical.js';

const m = (/** @type {number} */ minor) => (minor / 100).toFixed(2);
test('changeText', () => {
  assert.equal(changeText(0, m), 'same');
  assert.equal(changeText(-7300, m), '73.00 less');
  assert.equal(changeText(5500, m), '55.00 more');
  // a negative Left over that got worse: -20000 typical, -50000 month
  assert.equal(changeText(-50000 - -20000, m), '300.00 less');
});
```

- [ ] **Step 2: Add the failing e2e tests** to `tests/e2e/typical-compare.spec.js`, after the Task 3 tests. Read `expected.json` with `fs` and `fixturePath`, as `tests/e2e/helpers.js` does, and format money with `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })`.

```js
test('comparing Oct 2026 against Nov 2025 to Jun 2026', async () => {
  await page.getByLabel('to', { exact: true }).selectOption('2026-06');
  await page.getByLabel('Compare with').selectOption('2026-10');
  await expect(page.getByLabel('Compare with')).toBeFocused();
  // Living costs headings: Category, Type, Typical, Oct 2026, Change; no Per year
  // Housing (rent or mortgage): £900.00, £900.00, same
  // Groceries: Oct 2026 cell = gbp(-expected.monthlyTotals.Groceries['2026-10'])
  // Gifts (Annual): Oct 2026 cell equals its Typical cell, Change "same"
  // Contributions from others: £0.00, £550.00, "£550.00 more"; its rowheader holds no button
  // the help line about Annual categories is visible
});
test('the month and Change columns reconcile with the summary', async () => {
  // for Living costs, Income and Contributions: the parsed sum of the Oct 2026 column equals the
  // summary table's Oct 2026 cell for that line, and likewise for Change
});
test('a month an account does not cover shows a banner', async () => {
  // Latest 12 months, compare Jun 2026: banner
  // `Jun 2026 has no complete statement for ${FIXTURE_ACCOUNTS bank B name}. Its spending that month isn't included.`
  // Contributions from others: £550.00, £0.00, "£550.00 less"
});
test('comparison fits 320px and passes axe', async () => {
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expectNoAxeViolations(page);
  await page.setViewportSize({ width: 1280, height: 800 });
});
test('the choices survive the nav and reset on reload', async () => {
  // openScreen Categorise, then Typical month: Compare with still Jun 2026
  // page.reload(): Compare with is "No month", the window is the default one, and the tables have Per year again
});
test('No month puts the tables back', async () => {
  // choose a month, then No month: headings are Category, Type, Per month, Per year; dl.summary is back; no help line
});
```

Fill in the commented assertions as concrete `expect` calls, using the helpers copied in Task 3.

- [ ] **Step 3: Run them and check they fail**

Run: `node --test tests/unit/typical-ui.test.js && npx playwright test tests/e2e/typical-compare.spec.js`
Expected: FAIL. `changeText` is not exported, and there is no "Compare with" control.

- [ ] **Step 4: Implement** the behaviour above.

- [ ] **Step 5: Run the full check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/typical.js styles.css tests/unit/typical-ui.test.js tests/e2e/typical-compare.spec.js
git commit -m "Compare a month on Typical month"
```
