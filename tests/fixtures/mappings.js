// Column mappings for the synthetic fixtures. Each omits headerSignature; tests fill it in
// from the parsed header.

const dateFormat = 'DD/MM/YYYY';

export const MAPPINGS = {
  bankA: {
    dateColumn: 'Transaction Date', dateFormat, descriptionColumn: 'Transaction Description',
    typeColumn: 'Transaction Type', accountIdColumn: 'Account Number',
    amount: { debit: 'Debit Amount', credit: 'Credit Amount' },
  },
  savings: {
    dateColumn: 'Transaction Date', dateFormat, descriptionColumn: 'Transaction Description',
    typeColumn: 'Transaction Type', amount: { single: 'Amount', signFlipped: false },
  },
  card: {
    dateColumn: 'Transaction Date', dateFormat, descriptionColumn: 'Transaction Description',
    typeColumn: 'Transaction Type', amount: { single: 'Transaction Amount', signFlipped: true },
  },
  bankB: {
    dateColumn: 'Date', dateFormat, descriptionColumn: 'Details',
    typeColumn: 'Transaction Type', amount: { debit: 'Out', credit: 'In' },
  },
};

/** The six main files, plus the October re-export (`reexport: true`), a test input for overlap. */
export const FILES = [
  { name: 'bank-a-current.csv', mapping: MAPPINGS.bankA, account: 'A' },
  { name: 'bank-a-savings.csv', mapping: MAPPINGS.savings, account: 'S' },
  { name: 'card.csv', mapping: MAPPINGS.card, account: 'C' },
  { name: 'bank-b-2026-08.csv', mapping: MAPPINGS.bankB, account: 'B' },
  { name: 'bank-b-2026-09.csv', mapping: MAPPINGS.bankB, account: 'B' },
  { name: 'bank-b-2026-10.csv', mapping: MAPPINGS.bankB, account: 'B' },
  { name: 'bank-a-current-2026-10-reexport.csv', mapping: MAPPINGS.bankA, account: 'A', reexport: true },
];
