# Budgie

Budgie works out what your living costs look like in a typical month. You import CSV statements from your bank and credit card accounts. Budgie groups repeating transactions, you categorise them, and it builds a monthly budget from what you actually spent.

Everything happens in your browser. Budgie has no server and no account, and your statements are never uploaded.

## Using it

1. Download CSV statements from each bank and card account, ideally covering the last 12 months.
2. Open Budgie and import them on the **Accounts** screen. Budgie remembers each account's column layout for next time.
3. Work through the **Categorise** card. It shows the biggest uncategorised groups of transactions first.
4. Confirm transfers between your own accounts on the **Transfers** screen, so they don't count as spending.
5. Read your **Typical month**.
6. Save a backup on the **Backup** screen. It keeps your categories and decisions. To see everything again on another browser, restore the backup there and re-import your statements.

## Disclaimer and Terms of Use

**For informational and educational purposes only.**
Budgie is a budgeting tool. Its figures are estimates based on the statements
you import and the choices you make. They are not financial, investment, tax,
accounting, or legal advice, and nothing in this project is a recommendation
to take any particular course of action. Consult a qualified professional
before making financial decisions.

**No warranty.**
This software is provided "AS IS" and "AS AVAILABLE," without warranty of
any kind, express or implied, including but not limited to warranties of
accuracy, completeness, reliability, merchantability, fitness for a
particular purpose, and non-infringement. Calculations may contain errors or
rely on simplified assumptions. You are responsible for verifying any result
before relying on it.

**Limitation of liability.**
To the maximum extent permitted by applicable law, the authors and
contributors are not liable for any claim, damages, or losses (including
direct, indirect, incidental, special, consequential, or financial losses)
arising from the use of, or inability to use, this software or its outputs,
whether in contract, tort, or otherwise.

**Your responsibility.**
You use this software at your own risk. If you self-host or modify it, you
are responsible for your own deployment, its accuracy, and compliance with
the laws that apply to you.

**Privacy.**
Budgie runs entirely in your browser. Your statements and everything derived
from them are stored only in this browser's local storage, and are never sent
to or stored on any server. A backup is a plain, unencrypted JSON file that
you save yourself. It can include dates, amounts, transaction descriptions
and account details, so keep it somewhere private.

**License.**
Copyright (C) 2026 Oliver Gorwits.
This software is released under the AGPL 3.0 License.
See the [LICENSE](LICENSE) file. The license's warranty disclaimer and
limitation of liability apply in addition to this notice.

**Changes.**
These terms may be updated at any time. Continued use of the app constitutes
acceptance of the current terms.

## Development

Budgie is static HTML, CSS and JavaScript modules, with no build step and no runtime dependencies. The development tools (Playwright, axe and TypeScript for type checking) are only used for testing and never ship.

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run check    # banned-pattern scan, unit tests, type check, browser tests
npm run serve    # http://localhost:4173/
```

`CLAUDE.md` holds the project rules, including the privacy and security rules every change must follow. Test fixtures in `tests/fixtures/` are made up. Never commit real statements or backups.
