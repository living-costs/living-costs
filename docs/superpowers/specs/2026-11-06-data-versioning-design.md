# Data versioning: silent upgrades and restoring older backups

## Why

The app has no users yet, but it soon will. After that, any change to how data is stored could break the data in a user's browser, or a backup they rely on. Today:

- Backups carry `schemaVersion: 2`, and restore accepts only an exact match. Anything older is refused.
- Stored data has `settings.schemaVersion: 1`, which is written and never read. The IndexedDB version (`DB_VERSION`, 1) only creates stores and indexes.
- The normaliser has a version (`NORMALISER_VERSION`, 1, also copied onto each rule), but nothing acts on it.

The owner wants the app to upgrade stored data **cleanly and silently** whenever an update changes the format, including any rematching needed after a normaliser change. The owner would also like an older backup to restore, and asked how hard that is and what its limits should be. They don't expect format changes often.

## Decisions

- **One data version** for stored data and backup files, replacing the two numbers that disagree today. (Owner agreed.)
- **A chain of upgrade steps**, each taking data from version n to n+1. The same chain upgrades stored data on load and an older backup on restore. (Owner agreed.)
- **Every backup includes transactions and batches.** The Include transactions checkbox and the decisions-only backup are removed (owner's decision). With transactions always present, any upgrade step can use them, for example to recompute fingerprints and remap the decisions keyed to them. The cost is privacy: every backup on Google Drive then holds every transaction. The owner accepted this, because the CSVs are already on the same computer.
- **Steps are kept for good.** Each one is small, so there's no age limit on a restorable backup (Claude's call, owner agreed).
- **A normaliser change is rematched automatically**, without moving any transaction out of its bucket. (Owner asked for this.)

## Goals

- When the app loads data saved by an older version, it upgrades it without asking, writes it back in a single IndexedDB transaction, and carries on as normal.
- If an upgrade fails, nothing is written. The saved data stays exactly as it was, so a later fixed release can upgrade it. Meanwhile the user can save a copy of it, or delete it and start afresh.
- Restoring a backup from any supported older version works. It's upgraded, then checked by the current validation, then restored after the usual confirmation.
- After a normaliser change, every user decision is kept: bucket membership, categories, merges, names, overrides, splits, transfer decisions and Stopped marks. Future imports land in the same buckets as before wherever possible.
- Adding a format change costs one small step function, plus a synthetic fixture in the old format, and the tests fail if either is missing.

## Non-goals

- Downgrades. Data or a backup from a newer version than the running app is never read or changed.
- Merging a backup into existing data. Restore still replaces everything.
- An automatic copy of the data before an upgrade (Claude's call: the data is untouched if the upgrade fails, and the user can save backups).
- A user-facing upgrade screen, progress bar or changelog.
- Fuzzy matching during rematch.

## Anti-goals

- **Never lose or overwrite user data silently.** A failed or partial upgrade must leave the stored data intact, and a half-written state must never be possible.
- **Never move a user's transaction to a different bucket during a rematch,** and never drop a category, override or transfer decision. Automatic changes never overwrite the user's choices (CLAUDE.md).
- **An older copy of the app must never write to data it doesn't understand.**

## The data version

- One constant, `DATA_VERSION`, in a new `src/migrate.js` (the name and location are the builder's call). It replaces `SCHEMA_VERSION` in `src/backup.js` and the hard-coded `1` in `emptyState()`.
- It's stored as `settings.schemaVersion` and written into every backup as `schemaVersion`. The field names stay.
- **It starts at 2** (Claude's call). Stored data in development browsers is at 1, or has no settings row. Version 1 is today's stored shape, so a no-op step takes it to 2. Existing full backups at version 2 then still restore. Decisions-only backups from development fail validation, because transactions are now required (see Backup files).
- `DB_VERSION` stays separate. It changes only when stores or indexes change, and `onupgradeneeded` keeps creating them as now. A data upgrade that needs a new store or index bumps both.
- `Rule.normaliserVersion` is dropped (Claude's call), because one version now covers the normaliser too. The 1 to 2 step deletes it from stored rules. `readRule` stops reading it, and as unknown keys are already ignored, a version 2 backup that still holds it validates.

## Upgrade steps

- An ordered list, one entry per version: the step from n to n+1. Each step is a pure function over a plain data object (described next). It returns the upgraded object and doesn't mutate its input. A step may also declare that a rematch is needed.
- The **data object** is the same shape for stored data and for a backup's body: every store as an array (accounts, batches, transactions, buckets, rules, categories, overrides, transferPairs) plus `offeredDefaultIds` and the version. Browser-only settings (`helpDismissed`, `lastBackupAt`) aren't in it. They're carried around the upgrade unchanged. The exact layout, and whether the backup file's top level is restructured to match it, is the builder's call. There are no users, so the backup layout may change.
- **Runner:** given an object at version v, it runs steps v to `DATA_VERSION` in order. If any step asked for a rematch, it rematches once at the end with the current normaliser. Rematching is idempotent, so running it once covers several normaliser changes in a row.
- **After the steps, the result goes through the existing backup validation** (`validateBackup`'s checks), for stored data too (Claude's call). An upgrade bug is then caught before anything is written. The validator builds objects from known keys only, which also strips any field a step forgot to remove.
- Below `DATA_VERSION` the steps never need to be removed. A guard test checks that there's exactly one step per version from 1 to `DATA_VERSION`.

## On load

In `openStore` (or a function it calls), after the one-tab Web Lock is held:

1. Read every store's raw rows, as `loadAll` does now.
2. **Same version:** build State as now, with no extra work. This is the everyday path, and it must stay as fast as today.
3. **Older version:** build the data object, run the upgrade steps and the rematch, and validate. Then write everything back in **one** readwrite transaction that clears and refills every store (as `replaceAll` does), keeping `helpDismissed` and `lastBackupAt`. Only after that commits is State built and the app started. No notice is shown.
4. **Upgrade or validation fails:** write nothing. The app doesn't start on that data. Instead it shows a small failure screen in place of the normal screens (owner's decision, option C), without the nav:
   - The message: "Your saved data couldn't be upgraded to this version of the app. Nothing was changed." The technical detail goes in the secondary text, as other start-up errors do. Validation messages never repeat data, so they're safe to show.
   - **Save a copy of your data.** This writes the stored data, **as it was before the upgrade**, in backup format: `app`, its own old `schemaVersion`, `exportedAt`, and every store. It uses the same `showSaveFilePicker()` with download fallback, and the usual `living-costs-backup-YYYY-MM-DD.json` name, so the existing `.gitignore` pattern covers it. Because it's an ordinary backup at an older version, a fixed release can restore it through the normal Restore (Claude's call). The usual Google Drive warning is shown beside the button. It doesn't change `lastBackupAt`, as nothing is written.
   - **Delete all data and start afresh.** This uses the same confirmation as the Backup screen's delete ("Delete all data in this browser? Save a backup first if you might want it."). It then clears every store, settings included, and starts the app as a fresh install. Claude's call: it doesn't try to keep `helpDismissed`.
   - Both buttons follow the house style for actions that save (`data-saves`, focus handling), and the screen passes the axe check.
5. **Newer version** (a stale cached copy of the app, or a rollback): write nothing, and show "Your data was saved by a newer version of this app. Reload the page to get it." The same message applies when `indexedDB.open` fails with `VersionError` because `DB_VERSION` is higher than this copy knows.

No settings row and no data counts as a fresh install, so nothing is upgraded.

## Backup files

- **Always full.** `buildBackup` always includes `transactions` and `batches`. Validation requires both. The `full` option, the Include transactions checkbox and the `living-costs-full-backup-*.json` filename are removed. Every backup is `living-costs-backup-YYYY-MM-DD.json`. Keep both patterns in `.gitignore`, because old files may still be around (Claude's call).
- **Restore** checks the `app` field. Then:
  - **Version newer than the app:** refused, as now: "This backup is from a newer version of this app. Reload the page to get the latest version, then try again."
  - **Missing or not valid:** refused, as now.
  - **Older:** upgraded through the same runner, then validated.
  - **Current:** validated as now.
  - The confirmation and notice work as now. If an older backup fails during the upgrade, the existing "This backup can't be restored. Nothing was changed." panel lists the reason.
- **Restore no longer mentions re-importing.** Confirmation: "Replace all data in this browser with this backup?" Notice: "Backup restored."
- **Screen text** (`src/ui/backup.js`). The wording below is a starting point. Keep the house style.
  - Help: "A backup holds everything you've set up and every transaction you've imported, so restoring it needs no re-importing."
  - Warning (always shown): "A backup saved to Google Drive isn't encrypted. It holds every transaction you've imported: dates, amounts, descriptions and account details."
  - Restore help: "Restoring replaces everything this app holds in this browser. Backups from older versions of this app are upgraded as they're restored."

## Rematching after a normaliser change

This runs when a step declares it. Today no step does, so it's tested with an injected test normaliser.

**Guarantees:**

- No transaction's `bucketId` changes. No bucket is deleted or recategorised. Display names, examples, Stopped marks, overrides, splits, flag decisions and transfer pairs don't change. Fingerprints are built from raw text, not normalised text, so they're unaffected.
- Afterwards, each bucket's `keys` are the new-normaliser keys of the raw texts it represents, so a re-import or new import with the same text lands in the same bucket.
- A key still belongs to at most one bucket, as validation already requires.
- Each amount rule's `pattern` is the new-normaliser key of the transactions it routes.

**The old normaliser is kept (Claude's call).** The stored data can't say which old key a transaction came through. It doesn't record whether a rule routed a transaction, examples are capped at five and don't hold `rawType`, and undone batches leave keys with no transactions behind. So the step that brings in a new normaliser also freezes a copy of the one it replaces, for example `src/normalise-v1.js`, and passes both to the rematch. Old copies are kept for good, like the steps.

**How (a sketch; details are the builder's call within the guarantees):**

- **Map old keys to new keys.** For every transaction, its old key is the old normaliser's output and its new key is the new one's, both from `rawText` and `rawType`. The same goes for each bucket's examples, using the old and new normalisers on `rawText` alone. This gives an old-to-new key map.
- **Bucket keys.** Each bucket that owns old key K gains every new key that K maps to. Ownership comes from `bucket.keys`, not from `bucketId`, so routing by a rule and merging don't confuse it. A key that maps to nothing (no transactions or examples left) gets the new normaliser applied to the old key's own text, as a best effort.
- **Rule patterns.** A rule's pattern is an old key, so the new pattern is what that key maps to. If it maps to more than one, the new pattern is the most common among the transactions in the rule's bucket at the rule's amount. If nothing maps it, the new normaliser runs on the old pattern.
- **Conflict (Claude's call):** if the new normaliser gives the same key from more than one bucket (two descriptions the old normaliser kept apart now normalise alike), the key goes to the bucket with the most transactions producing it, then to the earliest in `state.buckets` order on a tie. The other buckets keep everything they have. Only future imports go to the winner. This happens silently, as the owner asked for silent upgrades, and the user can still merge buckets by hand.
- A bucket left with no keys after rematching keeps its transactions and stays valid, as rule buckets already do.

## Release tags (owner's request)

Each data version gets a git tag, so the app as it was at that version can be run again if needed. For example, run it locally and restore a backup into it. IndexedDB is per origin, so a local copy can't see the data stored at living-costs.org. A backup file is how data gets into it.

- **Tag name:** `data-vN`, on the merge commit on `main` of the PR that brought in version N (Claude's call on the name).
- **A reminder, not automation (Claude's call).** Automatic tagging would need a workflow with write access to the repo. The owner merges PRs, so the reminder goes in the PR. Any PR that changes `DATA_VERSION` ends its description with: "After merging, tag the merge commit: `git tag data-vN <merge-sha> && git push origin data-vN`".
- **This work's PR** carries that reminder for `data-v2`.

## Fingerprint changes (future)

No step is written now. Because every backup and all stored data now hold transactions, a future step that changes how fingerprints are built can recompute them from each transaction's fields, then remap `overrides` and `transferPairs` (including `pairKey`). Decisions held for transactions that aren't currently loaded (dormant after an undo) can't be remapped, and that step would drop them. This section is here so that limit is known, not to be built.

## Tests

- **Unit:** each step on a small hand-made object. The runner: step order, rematch called once, validation after. The guard: one step per version. Rematch, with an injected normaliser, covering a split key, a merged key (the conflict rule), a rule's pattern, a bucket with only examples, and the guarantees above (bucket membership and decisions unchanged).
- **Fixtures:** a synthetic backup at each supported version, from version 2 on, under `tests/fixtures/` (for example `tests/fixtures/backups/v2.json`), built from the existing synthetic statements. A test checks that each one upgrades, validates, and restores with the expected totals. When `DATA_VERSION` goes up, the previous version's fixture must exist. The guard test fails without it, which is the reminder to add one. Nothing from real statements goes in (CLAUDE.md).
- **Pinned output (Claude's call):** a committed file records `DATA_VERSION`, plus the normaliser's keys and the fingerprints for every row of the synthetic statements. The test fails if either output changes while `DATA_VERSION` stays the same. Its message says to bump the version and add a step, with a rematch for the normaliser, or a remap for fingerprints. This catches the most likely silent format change: a normaliser tweak with only `normalise.test.js` updated.
- **Backup round trip:** a state with every optional field set survives `buildBackup` then restore unchanged. This catches a new field that `read*` silently drops.
- **e2e:** seed IndexedDB with version 1 data (with `normaliserVersion` on a rule), load the app, and check that it starts normally with no notice, that the data now reads version 2, and that totals match. Seed data at a version above `DATA_VERSION`, and check the newer-version message and that the stored data is unchanged. Seed older data that fails validation after upgrading, and check three things: the failure screen appears and the data is unchanged; Save a copy produces a file at the old version; Delete clears everything and the app starts fresh. Restore the v2 fixture through the Backup screen. Update the existing backup specs for the removed checkbox and new text.

## Changes to CLAUDE.md and the main design

These go in with this work. Each is a departure the owner agreed to in this conversation:

1. **Backup:** remove the "Include transactions" checkbox bullet and the "Without the tick, transactions and batches are rebuilt by re-importing" bullet. Every backup holds every transaction and batch. Restoring needs no re-import, and undo by batch and the identical-file block still work.
2. **Backup warning:** the Google Drive warning always says the file holds every imported transaction.
3. **Data model:** `Rule` loses `normaliserVersion`. `Settings.schemaVersion` is the single data version, shared with backups.
4. **Privacy rules:** "Validate backup files and their schema version on restore" becomes: validate after upgrading older versions, and refuse newer ones.
5. **Normalisation:** add that a normaliser change rematches stored data on load and older backups on restore, keeping every bucket's transactions.
6. **Scope:** add "Upgrade stored data and older backups silently. If an upgrade fails, offer to save a copy or delete and start afresh" to In scope (a new feature the owner approved).
7. **Working rules:** add "A PR that changes `DATA_VERSION` reminds the owner, at the end of its description, to tag the merge commit `data-vN` on `main`."
8. **Main design** (`2026-11-04-living-costs-design.md`, Backup and restore): replace the "Transactions and batches", "Schema version 2" and "Restore" bullets to match. Keep the transaction-reference checks, which now always apply.

Afterwards, the "Backup versioning" entry in the follow-up tasks is done.

## Left to the builder

- Module names and where the runner is called from.
- The exact data object layout, and whether the backup's top level is restructured.
- The rematch algorithm, within the guarantees above.
- Wording, within the house style.
