import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NORMALISER_VERSION, PREFIXES, normalise } from '../../src/normalise.js';

const TABLE = [
  ['AMAZON.CO.UK*AB12CD34E', undefined, 'AMAZON.CO.UK'],
  ['PAYPAL *SPOTIFY*X9Q2W7', undefined, 'SPOTIFY'],
  ['CARD PURCHASE TESCO STORES 2041', undefined, 'TESCO STORES'],
  ['CARD PURCHASE SQ *CORNER CAFE', undefined, 'CORNER CAFE'],
  ['GAMESHOP CB1234567890', undefined, 'GAMESHOP'],
  ['REF-202601-99887766 ACME', undefined, 'REF ACME'],
  ['CHB 2025110612345678-&--&-CHILD BENEFIT', undefined, 'CHB CHILD BENEFIT'],
  ['TRANSFER FROM 12345678 27NOV25', undefined, 'TRANSFER FROM'],
  ['INTEREST 30NOV25', undefined, 'INTEREST'],
  ['PAYMENT 01/10/2026 SHOP 01OCT', undefined, 'PAYMENT SHOP'],
  ['TO 11-22-33 SAVER', undefined, 'TO SAVER'],
  ['PAYMENT RECEIVED - THANK YOU', undefined, 'PAYMENT RECEIVED THANK YOU'],
  ['THE VERY LONG NAMED GARDEN CEN...', undefined, 'THE VERY LONG NAMED GARDEN CEN'],
  ['ZETTLE_*FARM SHOP', undefined, 'FARM SHOP'],
  ['  sumup  *market   stall ', undefined, 'MARKET STALL'],
  ['INV83 3WGC SUPPLIES', undefined, 'INV83 3WGC SUPPLIES'],
  ['CARD PURCHASE <b>BOLD</b> SHOP', undefined, '<B>BOLD</B> SHOP'],
  ['', 'SO', 'SO (NO DESCRIPTION)'],
  ['', undefined, '(NO DESCRIPTION)'],
  ['1234567', 'DD', 'DD (NO DESCRIPTION)'],
];

test('normalise table', () => {
  for (const [raw, type, expected] of TABLE) assert.equal(normalise(raw, type), expected, raw);
});

test('type fallback trims, upper-cases, ignores null and blank', () => {
  assert.equal(normalise('', ' dd '), 'DD (NO DESCRIPTION)');
  assert.equal(normalise('', null), '(NO DESCRIPTION)');
  assert.equal(normalise('', '   '), '(NO DESCRIPTION)');
});

test('version and prefixes', () => {
  assert.equal(NORMALISER_VERSION, 1);
  assert.deepEqual(PREFIXES, ['PAYPAL *', 'SQ *', 'SP ', 'MOLLIE *', 'ZETTLE_*', 'SUMUP *', 'CARD PURCHASE ']);
});
