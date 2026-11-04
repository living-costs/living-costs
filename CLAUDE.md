# Budget categoriser

Browser-only web app that imports bank and credit card CSV statements, groups repeating transactions into buckets, lets the user categorise them, and builds a monthly picture of lifestyle costs.

Three users, on macOS and Chrome. Typical use: 12 months of statements from three or four accounts, then periodic updates. Keep it very simple and do not add features outside this file without asking.

The approved design is `docs/superpowers/specs/2026-11-04-budgie-design.md`. It holds the detail. This file holds the rules.

## Working rules

- The owner is an experienced programmer. Be direct.
- Do not install software with brew, npm, or anything else. Explain why it is needed and ask the owner to install it.
- Dev-only tooling is allowed and never ships: Playwright with `@axe-core/playwright`, `node:test`, and `tsc --checkJs --noEmit`. The owner runs `npm install`. Claude never does. Installs use `npm ci --ignore-scripts` from a committed lockfile.
- Any suggested library or application must be actively maintained, or clearly flagged if not.
- Real statements live in `fixtures/` (gitignored). Claude may read them locally with the owner's consent, to learn formats. Nothing from them (rows, names, merchants, amounts, account numbers or filenames) goes into code, tests, docs or commits. Committed test fixtures in `tests/fixtures/` are synthetic. Never request or commit backups.

## Privacy and security rules

Transaction data must never leave the browser.

- No network code: no `fetch`, XHR, WebSockets, `EventSource`, `sendBeacon`, or dynamic imports. Never build a URL from user data.
- No runtime dependencies. Use a small, tested in-house CSV parser.
- No external resources or links: no CDNs, analytics, remote fonts, or remote icons.
- Treat all CSV and backup content as untrusted. Render with `textContent`. Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, or `eval`.
- Validate backup files and their schema version on restore.
- App-level rules are the main protection. The CSP is a backstop.

### CSP

GitHub Pages cannot set response headers, so `index.html` must include this before any scripts in `<head>`:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'self';
  style-src 'self';
  img-src 'self';
  connect-src 'none';
  form-action 'none';
  base-uri 'none';
  require-trusted-types-for 'script'">
<meta name="referrer" content="no-referrer">
```

Known limits: this does not stop data leaving through navigation, and meta-tag CSP does not support `frame-ancestors`.

### Hosting

- Hosting is the final phase. Build and check everything locally first. The dedicated origin, remote, branch protection and deploy come when the owner is ready.
- Static files on GitHub Pages: `index.html`, ES modules under `src/`, one stylesheet, and no build step.
- Use a dedicated origin (a custom subdomain, or a GitHub organisation hosting only this app). Project sites under one `username.github.io` share an origin and could read this app's IndexedDB.
- Protect `main` and limit write access, because anyone who can push changes the code all users run.
- Add real statement and backup filename patterns to `.gitignore`.
- Add a GitHub Actions source check that fails on banned patterns, including `fetch(`, `XMLHttpRequest`, `innerHTML`, `eval(`, `http://`, and `https://`. Allow documented exceptions only, such as the CSP or test fixtures.
- The deploy job never runs `npm`. It copies `index.html`, `styles.css` and `src/` and publishes them. Checks run in separate jobs that the deploy depends on. Third-party Actions are pinned by commit SHA.

## Scope

### In scope

- CSV import with a saved column mapping per account or bank
- Import batches with undo
- A basic table of accounts by month, to show missing statements
- Basic duplicate detection
- Text normalisation and buckets, ranked by total value
- Manual bucket merging
- User-assigned categories, remembered for future imports
- Transfer and card repayment handling, including cards whose statements aren't imported
- Per-transaction overrides: move to another category, or split across several categories (for example an Amazon order)
- Amount rules: text plus an exact amount, with an expected frequency. Extra matches are flagged, not assigned
- Default categories from the owner-editable `src/default-categories.js`. New entries are offered once to existing users, and their choices are never overwritten
- Monthly budget view
- Plain JSON backup and restore
- A simple list of uncategorised items for later updates

### Out of scope for now

- Encryption, passkeys, 1Password integration, and recovery keys
- Multi-device handling and sync
- PDF import, OCR, and ML
- Fuzzy matching, and scheduled or rotating backups
- Recurring-charge alerts

## Design decisions

### Data

- Store data in IndexedDB. Request `navigator.storage.persist()`.
- Store money as integer minor units with a currency. Do not assume two decimal places.
- Keep the raw transaction text alongside normalised values.
- Every transaction records its import batch ID.

```
Account        { id, name, currency, kind: bank | card | placeholder, mappingId?, repaymentBucketIds[] }
Mapping        { id, headerSignature, dateColumn, dateFormat, descriptionColumn, typeColumn?,
                 accountIdColumn?,
                 amount: { single: column, signFlipped: bool } | { debit: column, credit: column } }
Batch          { id, importId, accountId, fileName, fileHash, importedAt, rowCount, coversFrom, coversTo }
Transaction    { id, fingerprint, accountId, batchId, date, amountMinor, currency,
                 rawText, rawType?, bucketId }
Bucket         { id, key, displayName, categoryId?, categorySource, exampleRawTexts[] }
Rule           { id, pattern, matchType, amountMinor?, expected?: { count, period: week | month | year },
                 bucketId, normaliserVersion }
Category       { id, name, kind: spend | income | contribution | transfer | ignore, budgetType?, defaultId? }
Override       { fingerprint, categoryId? , splits?: [{ amountMinor, categoryId }], unusualDismissed? }
TransferPair   { fingerprintA, fingerprintB, status: confirmed | rejected }
Settings       { offeredDefaultIds[], lastBackupAt?, schemaVersion }
```

Field names may change. `src/types.js` is the current model.

All windows and thresholds live in the owner-editable `src/tuning.js`. Code never hard-codes them.

### Normalisation

- Standardise case and remove dates, card fragments, reference numbers, and long digit strings.
- Treat processor prefixes such as `SQ *` and `PAYPAL *` as noise and keep the merchant name.
- Prefer too many buckets over wrongly merged ones. The user can merge them manually.
- Version the normaliser, and keep raw examples so rules can be migrated.

### Correctness

- Exclude transfers from spending. Count card spending at purchase, and treat card repayments as transfers.
- Suggest transfer pairs from equal and opposite amounts across accounts within a few days, and let the user confirm them. A transfer to an account not imported has no matching side, so the user decides how to treat it.
- Track debits and credits separately. Refunds offset their spending category and do not count as income.
- Block re-importing an identical file by hash.
- For overlapping date ranges, match on account, amount, and a date window of a few days, then rank by text similarity. Ask the user about ambiguous matches and never delete automatically. Identical purchases can be genuine.
- Changing a bucket's category applies to past transactions but preserves manual overrides.
- Automatic suggestions never overwrite a user's choice.
- Repayments to a card whose statements aren't imported count as spending in a '*Card* (not itemised)' category, until that card's statements are imported and the repayments are confirmed as transfer pairs.
- Money another person pays into an account you track goes in a `contribution` category. It reduces your share of living costs and isn't income.

### Budget

Budget type is set by hand on the category only. A per-transaction override changes the category or splits the transaction, and never changes budget type.

| Type | Treatment |
|---|---|
| `fixed`: Fixed monthly | Current recurring amount |
| `variable`: Variable | Median month, plus typical range |
| `annual`: Irregular or annual | Annual total divided by 12 |
| `oneoff`: One-off (a category of this type) | Shown separately, outside the baseline |

Exclude incomplete months from calculations.

### Backup

- Back up only the work that is hard to recreate: account setup and CSV mappings, buckets, amount rules, categories and offered defaults, transfer decisions, and fingerprint-keyed overrides, including splits and flag decisions.
- Everything else can be rebuilt by re-importing the original CSVs.
- Use plain JSON with a schema version.
- Save with `showSaveFilePicker()`, falling back to a normal download. Chrome may block a Google Drive folder under `~/Library/CloudStorage`, so test this on macOS.
- Show the date of the last backup in the UI.
- Tell users that a backup saved to Google Drive is unencrypted and may include dates, amounts, and transaction descriptions.

## Build order

1. Import CSVs per account with saved column mappings and undo by batch.
2. Normalise transactions into buckets, ranked by total value.
3. Label buckets, exclude transfers, and add per-transaction overrides.
4. Build the monthly budget view.
5. Add JSON export and restore.

## Verification

- Test the CSV parser and normaliser against made-up fixtures, including quoted fields, commas, BOMs, and HTML in descriptions.
- Check that the totals reconcile with the made-up input.
- In DevTools, load the app, import a sample CSV, and create a backup. After the initial page load, the Network tab should show no requests.
- Load the page, switch DevTools to offline, and confirm the app still works.
- Every check runs locally: `npm test`, `npm run types`, `npm run banned` and `npm run e2e`, or all of them with `npm run check`.

## Needed from the owner

The CSV header row and two or three made-up rows for each bank.
