# Synthetic fixtures

All data here is invented: names, account numbers, references and amounts. None of it comes from a real statement.

`node tests/fixtures/generate.js` rewrites the CSVs and `expected.json` in this folder. The output is deterministic, and both the CSVs and `expected.json` are committed. The generator imports nothing from `src/`. It computes `expected.json` from its own rows, and it throws if any self-check fails, or if two rows in different accounts look like an unintended transfer pair (equal and opposite amounts within 3 days).

`mappings.js` holds the column mapping for each format, plus `FILES`. The re-export is marked `reexport: true`. It is a test input for overlap, not one of the six main files.

## Files

| File | Format | Covers |
|---|---|---|
| `bank-a-current.csv` | Bank A current: CRLF, newest first, separate debit and credit, `'11-22-33` sort code | Nov 2025 to Oct 2026 |
| `bank-a-savings.csv` | Bank A savings: CRLF, oldest first, signed amount with explicit `+`, `null` type | Nov 2025 to Oct 2026 |
| `card.csv` | Card: BOM, all quoted, LF, purchases positive, minimal amounts, sorted by cleared date | Nov 2025 to Oct 2026 |
| `bank-b-2026-08.csv`, `-09`, `-10` | Bank B joint: LF, no BOM, oldest first, `In` then `Out`, 2 decimal places | one month each |
| `bank-a-current-2026-10-reexport.csv` | Bank A current | Oct 2026, plus 2 Nov 2026 |

## Rows

Amounts are signed minor units, as the app stores them. Day numbers are days of the month.

| Id | Description | Amount | When | Category |
|---|---|---|---|---|
| A1 | `EXAMPLE EMPLOYER LTD SALARY` | +250000 | 25th | Salary |
| A2 | `ACME LETTINGS` | −90000 | 1st | Housing (rent or mortgage) |
| A3 | `EXAMPLE COUNCIL 40012345678` | −15000 | 3rd | Council tax |
| A4 | `CARD PURCHASE TESCO STORES 2041` | −(4000 + k·731 mod 5000) | Saturdays | Groceries |
| A4u | same as A4 | −65000 | 2026-06-13 | Groceries (unusual) |
| A5 | `SQ *CORNER CAFE` | −350 | Wednesdays, twice on 2026-03-04 | Eating out |
| A6 | `PAYPAL PAYMENT` | −299 (8th), −999 (15th), extra −299 on 2026-10-20 | monthly | uncategorised; monthly rows count as Subscriptions |
| A7 | `NEWSAGENT J PATEL` | −1500 | Mondays | Subscriptions |
| A8 | `M JONES` | −4000 | 10th | Gifts |
| A9 | `CHB <YYYYMMDD><seq>-&--&-CHILD BENEFIT` | +10240 | 6th | Other income |
| A10 | `INTEREST PAID` | +51 (`.51`) | last day | Other income |
| A11 | `EXAMPLE CARD SERVICES` | −previous month's card net (Nov 2025: −30000) | 18th | transfer, pairs with C5 |
| A12 | `OTHER CARD PLC` | −(12000 + 500·i) | 22nd | Other Card (not itemised) |
| A13 | `TRANSFER TO SAVINGS` | −20000 | 26th | transfer, pairs with S1 |
| A14 | `FROM SAVINGS` | +50000 | 2026-07-15 | transfer, pairs with S3 |
| A15 | `J DOE JOINT` | −60000 | 28th, Aug to Oct 2026 | transfer, pairs with B5 |
| A16 | empty, type empty | −500 | 2026-02-11 | uncategorised |
| A17 | empty, type `SO` | −2500 | 2026-04-07 | uncategorised |
| A18 | `CARD PURCHASE <b>BOLD</b> SHOP` | −999 | 2026-05-09 | Entertainment |
| A19 | `CARD PURCHASE THE VERY LONG NAMED GARDEN CEN...` | −3200 | 12th | Household maintenance |
| A20 | `GAMESHOP CB<10 digits>` | −2000 | 20th | Entertainment |
| A21 | `SUMUP *MARKET STALL` / `ZETTLE_*FARM SHOP` / `MOLLIE *WEBSHOP` / `SP BOOKSHOP` | −1200 / −1850 / −2500 / −899 | 5th / 9th / 14th / 17th | Groceries / Groceries / Household maintenance / Entertainment |
| A22 | `CARD PURCHASE BIG BOILER CO` | −240000 | 2026-01-20 | Big one-offs |
| S1 | `TRANSFER FROM 12345678 <DDMONYY>` | +20000 | 27th | transfer |
| S2 | `INTEREST <DDMONYY>` | +123 | last day | Other income |
| S3 | `TRANSFER TO 12345678 14JUL26` | −50000 | 2026-07-14 | transfer |
| C1 | `AMAZON.CO.UK*<ref>` | −(2345 + k·317 mod 4000) | 3rd and 17th | Household maintenance |
| C1s | `AMAZON.CO.UK*<ref>` | −6069 | 2026-09-24 | Household maintenance |
| C2 | `PAYPAL *SPOTIFY*<ref>` | −1199 | 2nd | Subscriptions |
| C3 | `TRAINLINE` | −4600 (`46`) | 10th | Transport |
| C3r | `TRAINLINE`, Refund | +2340 | 2026-04-12 | Transport |
| C4 | `PARKING METER`, Not Available | −120 (`1.2`) | 21st | Transport |
| C5 | `PAYMENT RECEIVED - THANK YOU` | +A11 | 19th | transfer |
| B1 | `A N OTHER` | +55000 | 1st | Contributions from others |
| B2 | `EXAMPLE ENERGY` | −9500 | 5th | Utilities |
| B3 | `WATER CO` | −3800 | 12th | Utilities |
| B4 | `SAINSBURYS S/MKT` | −(6000 + 725·k) | Sundays | Groceries |
| B5 | `J DOE` | +60000 | 28th | transfer |

The re-export holds every Bank A row from October 2026, unchanged except that the A4 row on 2026-10-03 reads `CARD PURCHASE TESCO STORE 2041`. It adds one new row, `SQ *CORNER CAFE` at −350 on 2026-11-02.
