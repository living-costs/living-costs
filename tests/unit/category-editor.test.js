import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import defaults from '../../src/default-categories.js';
import { slug, validate, header, render, clean } from '../../tools/category-editor/format.js';

const source = fs.readFileSync(new URL('../../src/default-categories.js', import.meta.url), 'utf8');

test('rendering the current list reproduces the file byte for byte', () => {
  assert.equal(render(header(source), defaults.map(clean)), source);
});

test('the current list passes validation', () => {
  assert.deepEqual(validate(defaults, { groceries: 3 }), []);
});

test('render escapes quotes and backslashes in names', () => {
  const out = render('export default [\n', [{ id: 'kids', name: "Kids' club \\ fees", kind: 'spend', budgetType: 'annual' }]);
  assert.equal(out, "export default [\n  { id: 'kids', name: 'Kids\\' club \\\\ fees', kind: 'spend', budgetType: 'annual' },\n];\n");
});

test('header refuses a file without the opening line', () => {
  assert.throws(() => header('export const x = [];\n'), /export default \[/);
});

test('slug', () => {
  assert.equal(slug('Housing (rent or mortgage)'), 'housing-rent-or-mortgage');
  assert.equal(slug('Bits & Bobs'), 'bits-and-bobs');
  assert.equal(slug('Café'), 'cafe');
  assert.equal(slug('  !! '), '');
});

test('clean keeps known fields and drops a Type on transfer and ignore', () => {
  assert.deepEqual(clean(/** @type {any} */ ({ id: 'a', name: 'A', kind: 'transfer', budgetType: 'fixed', uid: 3 })),
    { id: 'a', name: 'A', kind: 'transfer' });
  assert.deepEqual(clean(/** @type {any} */ ({ id: 'a', name: 'A', kind: 'spend', budgetType: 'fixed', isNew: true })),
    { id: 'a', name: 'A', kind: 'spend', budgetType: 'fixed' });
});

/** @param {ReturnType<typeof validate>} errors */
const messages = (errors) => errors.map((e) => `${e.index}: ${e.message}`);

test('validate catches each problem', () => {
  const list = [
    { id: 'food', name: 'Food', kind: 'spend', budgetType: 'variable' },
    { id: 'food', name: 'food', kind: 'spend' },
    { id: 'Bad Id', name: ' Padded', kind: 'nope' },
    { id: 'moves', name: 'Moves', kind: 'transfer', budgetType: 'fixed' },
    { id: 'shops', name: 'Shops', kind: 'income', budgetType: 'fixed' },
  ];
  assert.deepEqual(messages(validate(list, { shops: 2, gone: 5 })), [
    '1: id "food" is already used by row 1',
    '1: Name is the same as row 1',
    '1: Choose a Type',
    '2: id "Bad Id" must be lower-case letters, digits and hyphens',
    '2: Name has spaces at the start or end',
    '2: Kind "nope" is not one of spend, income, contribution, saving, transfer, ignore',
    '3: A transfer category has no Type',
    '4: 2 merchant suggestions point here, so it must stay spend',
    '-1: "gone" is deleted, but 5 merchant suggestions point at it',
  ]);
});
