import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squash, matchKeys } from '../../src/suggest.js';

const M = [
  { name: 'SAINSBURYS', defaultId: 'groceries' }, { name: 'AMAZON', defaultId: 'shopping' },
  { name: 'AMAZON PRIME', defaultId: 'subscriptions' }, { name: 'BA', defaultId: 'holidays' },
  { name: 'EE', defaultId: 'utilities' }, { name: 'O2', defaultId: 'utilities' },
  { name: 'JUST EAT', defaultId: 'takeaway' }, { name: 'DISNEY+', defaultId: 'subscriptions' },
  { name: 'M&S', defaultId: 'groceries' }, { name: 'APPLE.COM/BILL', defaultId: 'subscriptions' },
  { name: 'SHELL', defaultId: 'fuel' }, { name: 'TESCO', defaultId: 'groceries' },
];

test('squash: apostrophes, symbols, domains', () => {
  assert.equal(squash("SAINSBURY'S"), 'SAINSBURYS');
  assert.equal(squash('Sainsbury’s'), 'SAINSBURYS');
  assert.equal(squash('DISNEY+'), 'DISNEY PLUS');
  assert.equal(squash('M&S SIMPLY FOOD'), 'M AND S SIMPLY FOOD');
  assert.equal(squash('WWW.EXAMPLE.CO.UK'), 'EXAMPLE');
  assert.equal(squash('EXAMPLECOUK'), 'EXAMPLE');
  assert.equal(squash('NETFLIX.COM'), 'NETFLIX');
  assert.equal(squash('APPLE.COM/BILL'), 'APPLE BILL');
  assert.equal(squash('E.ON NEXT'), 'EON NEXT');
  assert.equal(squash('LV='), 'LV');
  assert.equal(squash('SITCOM'), 'SITCOM');
});

test('matchKeys: whole-word hits, longest wins', () => {
  assert.equal(matchKeys(['SAINSBURYS S/MKTS'], M), 'groceries');
  assert.equal(matchKeys(['AMAZON.CO.UK'], M), 'shopping');
  assert.equal(matchKeys(['AMAZON PRIME UK'], M), 'subscriptions');
  assert.equal(matchKeys(['BA LONDON'], M), 'holidays');
});

test('matchKeys: short names do not match inside longer words', () => {
  assert.equal(matchKeys(['BARCLAYS'], M), null);
  assert.equal(matchKeys(['BANK FEES'], M), null);
  assert.equal(matchKeys(['CO2 OFFSET'], M), null);
});

test('matchKeys: glued words', () => {
  assert.equal(matchKeys(['JUSTEAT'], M), 'takeaway');
  assert.equal(matchKeys(['JUSTEATCOUK'], M), 'takeaway');
  assert.equal(matchKeys(['WWW.JUST-EAT.CO.UK'], M), 'takeaway');
});

test('matchKeys: across keys', () => {
  assert.equal(matchKeys(['TESCO', 'SHELL'], M), null);
  assert.equal(matchKeys(['TESCO', 'M&S'], M), 'groceries');
  assert.equal(matchKeys([], M), null);
  assert.equal(matchKeys(['NOTHING HERE'], M), null);
});
