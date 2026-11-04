import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, formatDate, addDays, daysBetween, monthOf, monthStart, monthEnd, monthRange, formatMonth, periodKey } from '../../src/dates.js';

test('parseDate', () => {
  assert.equal(parseDate('24/09/2026', 'DD/MM/YYYY'), '2026-09-24');
  assert.equal(parseDate('29/02/2028', 'DD/MM/YYYY'), '2028-02-29');
  for (const t of ['31/02/2026', '2026-09-24', '1/9/2026', '']) assert.equal(parseDate(t, 'DD/MM/YYYY'), null, t);
});

test('formatDate', () => assert.equal(formatDate('2026-09-24'), '24/09/2026'));

test('day arithmetic', () => {
  assert.equal(addDays('2026-02-27', 3), '2026-03-02');
  assert.equal(addDays('2026-03-02', -3), '2026-02-27');
  assert.equal(daysBetween('2026-10-30', '2026-11-02'), 3);
  assert.equal(daysBetween('2026-11-02', '2026-10-30'), -3);
});

test('months', () => {
  assert.equal(monthOf('2026-10-08'), '2026-10');
  assert.equal(monthStart('2026-10'), '2026-10-01');
  assert.equal(monthEnd('2028-02'), '2028-02-29');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(monthEnd('2026-12'), '2026-12-31');
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthRange('2026-02', '2025-11'), []);
  assert.equal(formatMonth('2026-10'), 'Oct 2026');
});

test('periodKey', () => {
  assert.equal(periodKey('2026-10-08', 'week'), '2026-10-05');
  assert.equal(periodKey('2026-10-04', 'week'), '2026-09-28');
  assert.equal(periodKey('2026-10-05', 'week'), '2026-10-05');
  assert.equal(periodKey('2026-10-08', 'month'), '2026-10');
  assert.equal(periodKey('2026-10-08', 'year'), '2026');
});
