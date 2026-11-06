# Data Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One data version for stored data and backups. Stored data is upgraded silently on load, older backups upgrade on restore, a normaliser change is rematched without moving any transaction, and every backup includes transactions.

**Architecture:** `src/version.js` holds `DATA_VERSION`. `src/migrate.js` holds the ordered upgrade steps and a runner that works on a plain backup-shaped object. `validateBackup` gates the version, runs the steps, validates, then (if a step asks) rematches with `src/rematch.js` and validates again. On load, `openStore` reads raw rows. At the current version it builds State as today. When older, it turns the rows into a backup-shaped object, runs it through `validateBackup`, and writes the result back in one transaction. It returns a tagged result so `main.js` can show the app, a "newer version" message, or a failure screen.

**Tech Stack:** plain ES modules, IndexedDB, `node:test`, Playwright with `@axe-core/playwright`, `tsc --checkJs`.

**Spec:** `docs/superpowers/specs/2026-11-06-data-versioning-design.md`

## Global Constraints

- No network code, no dynamic imports, no runtime dependencies. Render with `textContent` via `h()` from `src/dom.js`. Never `innerHTML`.
- Backup and stored content is untrusted. Steps run on unvalidated JSON, so they must not throw on odd shapes (wrong types, `__proto__` keys). Use `Object.hasOwn`, and `Map` for anything keyed by data. `validateBackup` already catches a throw as "This backup could not be checked."
- Validation messages never repeat file content.
- `DATA_VERSION` starts at **2**. Stored data at version 1, or with no settings row but some data, is version 1.
- `DB_VERSION` in `src/db.js` stays 1 and separate.
- Synthetic data only in `tests/fixtures/`. Nothing from `fixtures/`.
- Exact copy:
  - Load, newer: `Your data was saved by a newer version of this app. Reload the page to get it.`
  - Restore, newer: `This backup is from a newer version of this app. Reload the page to get the latest version, then try again.`
  - Load, failed: `Your saved data couldn't be upgraded to this version of the app. Nothing was changed.`
  - Buttons: `Save a copy of your data`, `Delete all data and start afresh`
  - Backup help: `A backup holds everything you've set up and every transaction you've imported, so restoring it needs no re-importing.`
  - Warning: `A backup saved to Google Drive isn't encrypted. It holds every transaction you've imported: dates, amounts, descriptions and account details.`
  - Restore help: `Restoring replaces everything this app holds in this browser. Backups from older versions of this app are upgraded as they're restored.`
  - Confirm: `Replace all data in this browser with this backup?`
  - Notice: `Backup restored.`
  - Delete confirm (existing): `Delete all data in this browser? Save a backup first if you might want it.`
- Every check passes locally: `npm run check`. Claude never runs `npm install`.

## Review Focus

1. **Stored data that fails validation** (for example a batch whose `rowCount` no longer matches, from an old bug) shows the failure screen, and the stored rows are byte-for-byte unchanged. Owner: Task 7.
2. **A hostile or broken older backup** (`rules: "x"`, a `__proto__` key in a rule, `transactions: null`) is refused with the normal messages, never throws past `validateBackup`, and leaves `Object.prototype` clean. Owner: Task 3.
3. **A current-version load doesn't rewrite the data.** A sentinel extra field put on a stored transaction survives a reload, which proves no clear-and-refill happened. Owner: Task 6.
4. **No settings row but data present** counts as version 1 and is upgraded, not treated as a fresh install. Owner: Tasks 3 and 6.
5. **An upgrade on load keeps `helpDismissed` and `lastBackupAt`**, so the user still lands on Typical month and sees their last backup date. Owner: Task 6.

---

### Task 1: One data version, and rules lose `normaliserVersion`

**Files:**
- Create: `src/version.js`
- Modify: `src/changes.js` (`emptyState`), `src/backup.js` (`SCHEMA_VERSION`, `readRule`), `src/rules.js` (`createAmountRule`), `src/types.js` (`Rule`)
- Test: `tests/unit/backup.test.js`, `tests/unit/rules.test.js`, `tests/unit/buckets.test.js`, `tests/e2e/backup.spec.js`

**Interfaces:**
- Produces: `export const DATA_VERSION = 2;` in `src/version.js`. It's its own module, so `changes.js` can import it without a cycle (`backup.js` imports `changes.js`). `SCHEMA_VERSION` is removed and every user imports `DATA_VERSION`. `emptyState().settings.schemaVersion === DATA_VERSION`. `Rule` has no `normaliserVersion`. `NORMALISER_VERSION` stays in `normalise.js`, where it names frozen copies later, but nothing stores it.

- [ ] **Step 1: Update tests.** In `backup.test.js`, import `DATA_VERSION` from `../../src/version.js` in place of `SCHEMA_VERSION`. Add `assert.equal(DATA_VERSION, 2)`. In `restoreChanges writes the backup…`, expect `schemaVersion: 2`. Add `test('emptyState uses DATA_VERSION', …)`. Remove `normaliserVersion` from `base()` and from `rules.test.js:100` and `buckets.test.js:29`. Remove the `normaliserVersion = '1'` case at `backup.test.js:371`. Add `test('a rule with a normaliserVersion still validates, and the field is dropped', …)`, which asserts `'normaliserVersion' in data.rules[0] === false`. Add `test('createAmountRule stores no normaliserVersion', …)` in `rules.test.js`.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Create `src/version.js`. In `emptyState`, use `DATA_VERSION`. In `backup.js`, import `DATA_VERSION` (keep the version checks behaving as now, against `DATA_VERSION`). Make `readRule` stop reading or writing `normaliserVersion`. Make `createAmountRule` stop setting it, and drop the `NORMALISER_VERSION` import from `rules.js`. Remove the field from `Rule` in `types.js`. In `tests/e2e/backup.spec.js:305`, drop the field.
- [ ] **Step 4: Run** `npm test && npm run types`. Expected: PASS.
- [ ] **Step 5: Commit** `One data version shared by stored data and backups; rules drop normaliserVersion`

### Task 2: Every backup includes transactions and batches

**Files:**
- Modify: `src/backup.js` (`buildBackup`, `backupFileName`, `BackupData`, `validate`, `restoreChanges`), `src/ui/backup.js`
- Test: `tests/unit/backup.test.js`, `tests/e2e/backup.spec.js`

**Interfaces:**
- Produces:
  - `buildBackup(state: State, now: Date): Backup`, with `transactions` and `batches` always present.
  - `backupFileName(now: Date): string` → `living-costs-backup-YYYY-MM-DD.json`.
  - `BackupData.batches` and `BackupData.transactions` are required.
  - `restoreChanges(data: BackupData, current: Settings, { keepLastBackup = false } = {}): Changes` always puts transactions and batches. With `keepLastBackup`, it copies `current.lastBackupAt` when present (used by Task 6).
  - `writeFile(name: string, text: string)` in `src/ui/backup.js` becomes exported (used by Task 7).

- [ ] **Step 1: Update unit tests.**
  - Merge `fullBase()` into `base()`, so the small backup always has transactions and batches.
  - Delete the tests `buildBackup leaves out transactions…`, `a decisions-only backup validates…`, `restoreChanges for a decisions-only backup…` and `a full backup has its own file name`.
  - Rename `a full buildBackup also holds…` to `buildBackup holds every transaction and batch`. Rename `a full backup needs both lists, not one` to `a backup needs both lists`, adding a case with both missing: two messages.
  - In the first `buildBackup` test, the key list gains `batches` and `transactions`, and the regex drops `batchId|fileHash`.
  - Add `test('restoreChanges keeps lastBackupAt only when asked', …)`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement in `src/backup.js`.** Remove the `full` option and branch. `validate` always reads both lists and always runs `checkTransactionRefs`, with no `has(json, 'batches')` test. Update the header comment.
- [ ] **Step 4: Update the e2e tests** in `tests/e2e/backup.spec.js`:
  - Remove `includeBox`, `FULL_WARNING` and `FULL_CONFIRM`. Set `CONFIRM` and `WARNING` to the Global Constraints copy.
  - In `download fallback`, expect `saved.transactions` and `saved.batches` to be arrays.
  - Fold `full backup: ticking the box…` into `restore replaces`: restoring brings transactions back with no re-import, and the notice reads `Backup restored.`
  - `emptyBackup()` gains `batches: [], transactions: []`.
- [ ] **Step 5: Implement in `src/ui/backup.js`.** Remove the checkbox, `view.full`, `FULL_*`, and the `full` branches in `save` and `restore`. Use the Global Constraints copy for the help, warning, restore help, confirm and notice. Export `writeFile`.
- [ ] **Step 6: Run** `npm test && npm run types && npx playwright test tests/e2e/backup.spec.js`. Expected: PASS.
- [ ] **Step 7: Commit** `Every backup includes transactions and batches; remove the Include transactions option`

### Task 3: Upgrade steps and restoring older backups

**Files:**
- Create: `src/migrate.js`
- Modify: `src/backup.js` (`validate`)
- Test: `tests/unit/migrate.test.js`, `tests/unit/backup.test.js`, `tests/e2e/backup.spec.js`

**Interfaces:**
- Consumes: `DATA_VERSION` (Task 1).
- Produces, in `src/migrate.js`:
  - `@typedef {(rawText: string, rawType?: string) => string} Normaliser`
  - `@typedef {{to: number, run: (doc: Record<string, unknown>) => Record<string, unknown>, rematchFrom?: Normaliser}} Step`
  - `export const STEPS: Step[]`, where `STEPS[i].to === i + 2`. Today it holds one step, `{ to: 2, run }`, which returns a copy whose `rules` entries (when `rules` is an array of objects) lack `normaliserVersion`. Any other shape passes through unchanged.
  - `export function upgradeRaw(doc: Record<string, unknown>, from: number, steps = STEPS): {doc: Record<string, unknown>, rematchFrom?: Normaliser}`. It runs `steps[from - 1 …]` in order, sets `doc.schemaVersion = step.to` after each, and never mutates its input. `rematchFrom` is the `rematchFrom` of the **first** step in the run that has one, because the data's keys came from the oldest normaliser.
  - `export function storedVersion(rows: Record<StoreName, unknown[]>): number | null`. It returns `null` when every store is empty (a fresh install), 1 when there's no settings row but some data, and otherwise `settings.schemaVersion` when it's a safe integer of at least 1, or `NaN` when it isn't.
  - `export function rowsAsBackup(rows: Record<StoreName, unknown[]>, version: number, now: Date): Record<string, unknown>`. It returns `{app: 'living-costs', schemaVersion: version, exportedAt: now.toISOString(), accounts, batches, transactions, buckets, rules, categories, overrides, transferPairs, offeredDefaultIds}`. `offeredDefaultIds` comes from the settings row, or `[]` without one.

- [ ] **Step 1: Write `tests/unit/migrate.test.js`.**
  - `test('one step per version: STEPS[i].to is i + 2 and STEPS.length is DATA_VERSION - 1', …)`
  - `test('step to 2 drops normaliserVersion from rules and leaves other shapes alone', …)`, with `rules: 'x'` and `rules: [1, {id:'r', normaliserVersion: 1}]`.
  - `test('upgradeRaw runs steps in order, sets schemaVersion, and does not mutate', …)`, with three injected steps that each push their `to` onto `doc.trail`. From 2, expect the trail `[3, 4]` and `schemaVersion: 4`.
  - `test('upgradeRaw returns the oldest rematchFrom in the run', …)`, with injected steps where steps to 3 and to 4 carry normalisers `n3` and `n4`. From 2 gives `n3`. From 3 gives `n4`. From 4, at the last version, gives `undefined`.
  - `test('storedVersion: fresh, no settings row, a number, junk', …)`, expecting `null`, `1`, `2` and `NaN`.
  - `test('rowsAsBackup holds every store and the old version', …)`
- [ ] **Step 2: Add to `backup.test.js`.**
  - Replace `an older schema version is refused` with `test('a version 1 backup is upgraded and restores', …)`: `base()` with `schemaVersion: 1` and `normaliserVersion: 1` on its rule validates, `data.schemaVersion === 2`, and the rule has no `normaliserVersion`.
  - Update `a newer schema version is refused` to the new copy.
  - Add `test('a broken version 1 backup is refused, never throws, and pollutes nothing', …)` (Review Focus 2). Use `{ ...base(), schemaVersion: 1, rules: 'x' }` and a rule parsed from `'{"__proto__":{"polluted":1},"id":"r1",…}'` with `transactions: null`. Expect the normal list messages, and `({}).polluted === undefined`.
- [ ] **Step 3: Run** `npm test`. Expected: FAIL.
- [ ] **Step 4: Implement** `src/migrate.js`. In `backup.js`, `validate` does three things after the `app` check. An invalid version keeps its current message. A version above `DATA_VERSION` gets the newer copy. A version below runs `upgradeRaw(json, version)`, and the existing structural checks then run on the result. Keep the `rematchFrom` value in a variable for Task 4. Delete the "older version can't be restored" message.
- [ ] **Step 5: Add an e2e test** in `backup.spec.js`: `test('restoring a version 1 backup upgrades it', …)`. Save a backup from the fixture app as in `restore replaces`, edit its JSON in the test to `schemaVersion: 1`, adding `normaliserVersion: 1` to each rule, and restore it in a fresh context. Expect `Backup restored.`, the same Subscriptions per-month figure, and settings `schemaVersion` 2.
- [ ] **Step 6: Run** `npm test && npm run types && npx playwright test tests/e2e/backup.spec.js`. Expected: PASS.
- [ ] **Step 7: Commit** `Upgrade steps: older backups are upgraded on restore`

### Task 4: Rematch after a normaliser change

**Files:**
- Create: `src/rematch.js`
- Modify: `src/backup.js` (`validate`)
- Test: `tests/unit/rematch.test.js`, `tests/unit/backup.test.js`

**Interfaces:**
- Consumes: `Normaliser` and `upgradeRaw(...).rematchFrom` (Task 3). `BackupData` (Task 2). `normalise` from `src/normalise.js`.
- Produces: `export function rematch(data: BackupData, oldN: Normaliser, newN: Normaliser): BackupData`. It's pure, and only `buckets[].keys` and `rules[].pattern` may differ in the result.

Algorithm (the spec fixes the rules, which the tests alone don't determine):

```
targets: Map<oldKey, Map<newKey, count>>
  each transaction: oldN(rawText, rawType) → newN(rawText, rawType), count += 1
  each bucket example: oldN(raw) → newN(raw), count += 0 (entry exists, adds no weight)
claims: Map<newKey, Map<bucketIndex, count>>
  for each bucket i, for each oldKey K in bucket.keys:
    ts = targets.get(K); if none or empty → claim newN(K) with count 0
    else claim every newKey in ts with its count
winner(newKey) = bucket with the highest count, then the lowest index
bucket.keys = its claimed newKeys that it won, in first-claimed order, without repeats
rule.pattern: ts = targets.get(pattern)
  one newKey → it; several → most common newN over transactions in rule.bucketId with
  amountMinor === rule.amountMinor (then first in ts order); none → newN(pattern)
```

- [ ] **Step 1: Write `tests/unit/rematch.test.js`**, with small hand-made `BackupData` and injected normalisers.
  - `test('a split key: the bucket gains both new keys', …)`
  - `test('a merged key goes to the bucket with more transactions; the other keeps its transactions', …)`
  - `test('a tie goes to the earlier bucket', …)`
  - `test('a rule pattern follows its key; the source bucket gains it and the rule bucket stays keyless', …)`: source bucket keys `['PAYPAL PAYMENT']`, rule bucket keys `[]`, new normaliser maps to `'PAYPAL'`.
  - `test('a bucket with only examples gets keys from them', …)`
  - `test('a key with no transactions or examples is normalised as text', …)`
  - `test('nothing else changes', …)`: deepEqual on accounts, batches, transactions, categories, overrides, transferPairs and offeredDefaultIds, and on each bucket apart from `keys`.
  - `test('the current normaliser on both sides changes nothing on the fixture data', …)`: `fixtureState()` → `buildBackup` → `dataOf` → `rematch(d, normalise, normalise)` deepEquals `d`.
- [ ] **Step 2: Add to `backup.test.js`:** `test('a step with rematchFrom rematches once, then validates again', …)`. Use the `options` argument of `validateBackup` (below) to inject `{steps, normalise}`, with a step whose `rematchFrom` maps `'SHOP 123'` to an old key that `base()` uses. Assert the new keys. Add a case where the rematch makes two buckets share a key (an injected faulty rematch), and assert it's refused with `shares a key`.
- [ ] **Step 3: Run** `npm test`. Expected: FAIL.
- [ ] **Step 4: Implement.** Write `src/rematch.js`. Change the signature to `validateBackup(json: unknown, options: {steps?: Step[], normalise?: Normaliser, rematch?: typeof rematch} = {})`. The options exist for tests only. The defaults are `STEPS`, `normalise` and `rematch`. After the structural checks pass and `rematchFrom` is set, run `rematch(data, rematchFrom, normalise)`. Then run the structural checks again on `{app, schemaVersion, exportedAt, ...rematched}`, and return those errors if any.
- [ ] **Step 5: Run** `npm test && npm run types`. Expected: PASS.
- [ ] **Step 6: Commit** `Rematch bucket keys and rule patterns after a normaliser change`

### Task 5: Version fixtures and pinned normaliser and fingerprint output

**Files:**
- Create: `tests/fixtures/backups/make.js`, `tests/fixtures/backups/v2.json` (generated), `tests/unit/versions.test.js`
- Modify: `tests/fixtures/README.md`

**Interfaces:**
- Consumes: `fixtureState()` from `tests/unit/helpers/fixture-state.js`, `buildBackup` (Task 2), `DATA_VERSION` (Task 1), `validateBackup`, `restoreChanges`.

- [ ] **Step 1: Write `make.js`.** It runs `fixtureState()`, then `buildBackup(state, new Date('2026-11-04T10:00:00.000Z'))`, and writes compact JSON to `tests/fixtures/backups/v${DATA_VERSION}.json`. It **refuses to overwrite** an existing file, because an old version's fixture is frozen. Run it once: `node tests/fixtures/backups/make.js`.
- [ ] **Step 2: Write `tests/unit/versions.test.js`.**
  - `test('a frozen backup exists for every version from 2 to DATA_VERSION', …)`. Its failure message: `Add one with node tests/fixtures/backups/make.js`.
  - `test('every frozen backup upgrades, validates and restores to the same typical month', …)`. For each file, `validateBackup` is ok, `data.schemaVersion === DATA_VERSION`, and after `restoreChanges` into `emptyState()`, `typicalMonth(after, tuning)` deepEquals `typicalMonth(await fixtureState(), tuning)`. The fixtures' totals don't depend on IDs.
  - `test('normaliser and fingerprint output is pinned to DATA_VERSION', …)`. Over `(await fixtureState()).transactions`, sorted by fingerprint, take SHA-256 (`node:crypto`) of `JSON.stringify(rows.map((t) => [t.fingerprint, normalise(t.rawText, t.rawType)]))`. Compare it with a constant `PINNED = { dataVersion: 2, sha256: '<value>' }` in the test file. On a mismatch while `PINNED.dataVersion === DATA_VERSION`, fail with: `Normaliser or fingerprint output changed. Bump DATA_VERSION and add a step (rematchFrom for the normaliser, a remap for fingerprints), then update PINNED to <new hash>.` When `DATA_VERSION` has moved on, fail with: `Update PINNED for version <n>: <new hash>.` Fill in `<value>` from the first run.
- [ ] **Step 3: Run** `npm test`. Expected: PASS once `PINNED` is filled in. Check that the guard bites: temporarily change `DATA_VERSION` to 3, see the missing-fixture and step-count tests fail, then revert.
- [ ] **Step 4: Update `tests/fixtures/README.md`** with a short "Backups" section: what `backups/vN.json` is, that it's frozen, and when to run `make.js`.
- [ ] **Step 5: Commit** `Frozen backup per data version, and pinned normaliser and fingerprint output`

### Task 6: Upgrade stored data on load

**Files:**
- Modify: `src/db.js` (split `loadAll`), `src/store.js` (`openStore`), `src/main.js` (`start`)
- Test: `tests/e2e/upgrade.spec.js` (new), `tests/e2e/helpers.js`

**Interfaces:**
- Consumes: `storedVersion` and `rowsAsBackup` (Task 3), `validateBackup` (Tasks 3 and 4), `restoreChanges(..., { keepLastBackup: true })` (Task 2), `write` and `STORE_NAMES` from `db.js`.
- Produces:
  - `db.js`: `loadRows(db): Promise<Record<StoreName, any[]>>` and `rowsToState(rows): State`. `loadAll` is removed, or becomes their composition.
  - `store.js`: `@typedef {{kind:'ready', store: Store} | {kind:'newer'} | {kind:'failed', errors: string[], copy: Record<string, unknown>, deleteAll: () => Promise<void>}} Opened`, and `openStore(now = new Date()): Promise<Opened>`.
    - `openDb` rejecting with `err.name === 'VersionError'` → `{kind:'newer'}`.
    - `storedVersion` gives `null` or `DATA_VERSION` → the rows become State as today, with nothing written.
    - Above `DATA_VERSION` → `newer`.
    - Older, or `NaN` → `validateBackup(rowsAsBackup(rows, version, now))`.
      - If ok: `write(db, restoreChanges(data, settingsRow ?? emptyState().settings, { keepLastBackup: true }), STORE_NAMES)`, then `applyToState(emptyState(), changes)` gives State, then `ready`.
      - If not ok: `failed`, with `copy = rowsAsBackup(rows, version, now)`, and `deleteAll = () => write(db, {}, STORE_NAMES)`. For `NaN`, use `schemaVersion: 1` in the copy.
    - Any other error still throws.
  - `main.js`: `start()` switches on `kind`. `ready` does what `start()` does today. `newer` clears `#screen` and shows `h2` `The app could not start` with the newer-version copy. `failed` calls Task 7's screen, which this task stubs as the `failed()` screen with the failure copy.
  - `helpers.js`: `writeStore(page, name, rows)`, which puts rows into one store through its own connection and closes it, and `patchSettings(page, patch)`.

- [ ] **Step 1: Write `tests/e2e/upgrade.spec.js`.** Each test sets up with `setupFixtureApp(page)`, then changes stored rows with `writeStore` and `patchSettings`, then `page.reload()`.
  - `test('version 1 data upgrades silently on load', …)`: settings `schemaVersion: 1`, `normaliserVersion: 1` on each rule, and `helpDismissed` plus a `lastBackupAt` kept (Review Focus 5). After reload, check:
    - the Typical month heading shows, with no banner in `#notices`;
    - the Subscriptions figure is unchanged;
    - settings `schemaVersion === 2`, and `lastBackupAt` is the same;
    - no rule has `normaliserVersion`;
    - the CSP list is empty.
  - `test('data with no settings row is treated as version 1', …)` (Review Focus 4): delete the settings row and reload. The app starts on Help, as `helpDismissed` is gone, the transactions are still there, and the settings row now reads `schemaVersion: 2`.
  - `test('a current-version load does not rewrite the data', …)` (Review Focus 3): put `{ ...firstTransaction, sentinel: 1 }` and reload. The row still has `sentinel`.
  - `test('newer data is refused and left alone', …)`: settings `schemaVersion: 99`, then reload. The newer-version copy shows, there's no nav button, and `readStore` of transactions and settings deepEquals the rows before the reload.
  - `test('a newer IndexedDB version is refused', …)`: in `page.evaluate`, open `living-costs` at version 5. The app's connection closes on `versionchange`. Close it, then reload: the newer-version copy shows.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/upgrade.spec.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the `db.js`, `store.js` and `main.js` changes above.
- [ ] **Step 4: Run** `npm run types && npx playwright test tests/e2e/upgrade.spec.js tests/e2e/one-tab.spec.js tests/e2e/shell.spec.js`. Expected: PASS.
- [ ] **Step 5: Commit** `Upgrade stored data silently on load, and refuse newer data`

### Task 7: The upgrade failure screen

**Files:**
- Create: `src/ui/upgrade-failed.js`
- Modify: `src/main.js` (the `failed` branch)
- Test: `tests/e2e/upgrade.spec.js`

**Interfaces:**
- Consumes: the `Opened` `failed` variant (Task 6), `writeFile` (Task 2), `backupFileName` (Task 2), `whileSaving` from `src/ui/saving.js`, and `h` and `clear` from `src/dom.js`.
- Produces: `export function renderUpgradeFailed(root: HTMLElement, opened: {errors: string[], copy: object, deleteAll: () => Promise<void>}, restart: () => void): void`.

Layout, in order:
- `h2` (`tabindex -1`, focused) `The app could not start`
- `p` with the failure copy
- `p.muted` `Details:`, followed by a `ul` of `errors`
- the warning banner (Global Constraints copy)
- `.actions` holding a `Save a copy of your data` button (`data-saves`)
- `p[role=status]`
- `.actions` holding a `Delete all data and start afresh` button (`data-saves`)

Save writes `JSON.stringify(copy, null, 2)` to `backupFileName(new Date())` through `writeFile`. The status reads `Copy saved.`, or `Copy saved to your Downloads folder instead.` on fallback, and nothing on cancel. Delete asks for confirmation with the delete-confirm copy, then runs `whileSaving(root, deleteAll)`, then `restart()`. `main.js` passes `restart = () => { clear(screenEl); start().catch(failed); }`. After a delete, the first-run seed runs, as for a new user.

- [ ] **Step 1: Add e2e tests** to `upgrade.spec.js`, with no picker (`noPicker` init script, as in `backup.spec.js`). Set up with settings `schemaVersion: 1` and the first batch's `rowCount` plus 1, then reload.
  - `test('an upgrade that fails shows the failure screen and changes nothing', …)` (Review Focus 1):
    - the copy and a `Details` list item containing `row` show;
    - there's no nav;
    - every store's rows deepEqual those before the reload;
    - axe passes and the CSP list is empty.
  - `test('save a copy writes the data at its old version', …)`: the download is `living-costs-backup-<today>.json`, with `schemaVersion: 1`, the altered `rowCount`, and transactions present.
  - `test('delete all data starts afresh', …)`: dismissing the confirmation changes nothing. Accepting it brings up Help with the nav, settings `schemaVersion: 2`, no transactions, and the default categories seeded.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/upgrade.spec.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `src/ui/upgrade-failed.js` and wire it in `main.js`.
- [ ] **Step 4: Run** `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `Upgrade failure screen: save a copy, or delete and start afresh`

### Task 8: Docs, and the PR with the tag reminder

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-11-04-living-costs-design.md`
- Memory (outside the repo): `follow-up-tasks.md`, `no-users-yet.md`

- [ ] **Step 1: Edit `CLAUDE.md`** for the spec's "Changes to CLAUDE.md and the main design", items 1 to 7:
  - Backup bullets: replace the checkbox and "without the tick" bullets with one bullet. Every backup holds every transaction and batch, restoring needs no re-import, and undo by batch and the identical-file block still work.
  - The Google Drive warning bullet.
  - The data model: `Rule` without `normaliserVersion`, and `Settings.schemaVersion` as the single data version.
  - The privacy rule on validating the schema version.
  - The Normalisation bullet on rematching.
  - The In scope line.
  - The new working rule: "A PR that changes `DATA_VERSION` reminds the owner, at the end of its description, to tag the merge commit `data-vN` on `main`."
- [ ] **Step 2: Edit the main design's Backup and restore section** (item 8): replace the "Transactions and batches", "Schema version 2" and "Restore" bullets, and keep the reference checks. Also update its `.gitignore` list (around line 389), which keeps both patterns.
- [ ] **Step 3:** In memory, remove the "Backup versioning" entry from `follow-up-tasks.md`. Update `no-users-yet.md`: data changes now go through `DATA_VERSION` steps.
- [ ] **Step 4: Run** `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `Docs: data versioning in CLAUDE.md and the main design`
- [ ] **Step 6: Push and open the PR.** Push over SSH and open it with `gh pr create`. The description ends with `After merging, tag the merge commit: git tag data-v2 <merge-sha> && git push origin data-v2`, then the Claude Code attribution line. Don't merge it, because the owner merges.
