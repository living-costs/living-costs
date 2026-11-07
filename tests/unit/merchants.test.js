import { test } from 'node:test';
import assert from 'node:assert/strict';
import merchants from '../../src/merchants.js';
import defaults from '../../src/default-categories.js';
import { squash, matchKeys } from '../../src/suggest.js';

// Generic words, bank names and invented employers that must never be entries.
const DENY = new Set([
  'UNIVERSITY', 'RENT', 'LANDLORD', 'MONTHLY RENT', 'MORTGAGE PAYMENT', 'DENTIST', 'DENTAL',
  'OPTICIANS', 'ATM', 'CAFE', 'CAFE LOCAL', 'HAIRDRESSERS', 'SCHOOL FEES', 'NURSERY FEES',
  'NEXT', 'THREE', 'JL', 'LV', 'PRUDENTIAL',
  'BARCLAYS', 'HSBC', 'LLOYDS', 'LLOYDS BANK', 'HALIFAX', 'NATIONWIDE', 'SANTANDER', 'NATWEST',
  'MONZO', 'STARLING', 'METRO BANK', 'TSB', 'FIRST DIRECT', 'CO OPERATIVE BANK', 'VIRGIN MONEY',
  'ACME LIMITED', 'ACME LTD', 'GLOBEX CORP', 'INNOTECH LTD', 'NORTHWIND SERVICES', 'HALCYON GROUP',
  'BLUEFIN SOLUTIONS', 'PRIME HIRE LTD',
]);

test('every defaultId is a spending default, or null for a block entry', () => {
  const spend = new Set(defaults.filter((c) => c.kind === 'spend').map((c) => c.id));
  for (const m of merchants) assert.ok(m.defaultId === null || spend.has(m.defaultId), `${m.name}: ${m.defaultId}`);
});

test('every name squashes to something', () => {
  for (const m of merchants) assert.notEqual(squash(m.name), '', m.name);
});

test('no two entries share a squashed name', () => {
  const seen = new Map();
  for (const m of merchants) {
    const s = squash(m.name);
    assert.ok(!seen.has(s), `${m.name} duplicates ${seen.get(s)}`);
    seen.set(s, m.name);
  }
});

test('no entry is a generic word, a bank or an invented employer', () => {
  for (const m of merchants) assert.ok(!DENY.has(squash(m.name)), m.name);
});

test('the list has at least 400 entries', () => {
  assert.ok(merchants.length >= 400, `${merchants.length}`);
});

test('every entry matches itself, not shadowed into another category', () => {
  for (const m of merchants) {
    if (m.defaultId !== null) assert.equal(matchKeys([m.name], merchants), m.defaultId, m.name);
  }
});

test('named guards and block entries', () => {
  const cases = {
    'TESCO PFS': 'fuel', 'UBER EATS': 'takeaway', 'SHELL ENERGY': 'utilities', 'TESCO BANK': null,
    'COSTA DEL SOL HOTEL': null, 'COSTA COFFEE': 'coffee-shops', 'SSE ARENA WEMBLEY': null,
    'EMIRATES STADIUM': null, 'CO-OP FUNERALCARE': null, 'TESCO INSURANCE': 'insurance',
    'COOP BANK': null, 'CO-OP BANK': null, 'TESCO BANK INSURANCE': 'insurance',
  };
  for (const [key, want] of Object.entries(cases)) assert.equal(matchKeys([key], merchants), want, key);
});
