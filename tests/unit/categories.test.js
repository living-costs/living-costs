import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyToState } from '../../src/changes.js';
import defaults from '../../src/default-categories.js';
import {
  seedDefaults, firstRunChanges, pendingDefaults, acceptDefaults, dismissDefaults,
  createCategory, updateCategory, deleteCategory, orderedCategories, sortedCategories, categoryUseCount,
} from '../../src/categories.js';

/** A fresh state seeded from the real defaults. */
function seeded(list = defaults) {
  const s = emptyState();
  applyToState(s, seedDefaults(list, s));
  return s;
}
const byName = (s, name) => s.categories.find((c) => c.name === name);
const extra = { id: 'pets', name: 'Pets', kind: 'spend', budgetType: 'variable' };

test('seeding gives every default once, with ids, defaultIds, positions and offered ids', () => {
  const s = seeded();
  assert.equal(s.categories.length, 25);
  assert.equal(s.settings.offeredDefaultIds.length, 25);
  assert.deepEqual(s.settings.offeredDefaultIds, defaults.map((d) => d.id));
  assert.deepEqual(s.categories.map((c) => c.defaultId), defaults.map((d) => d.id));
  assert.deepEqual(s.categories.map((c) => c.position), [...Array(25).keys()]);
  assert.equal(new Set(s.categories.map((c) => c.id)).size, 25);
  assert.ok(s.categories.every((c) => !defaults.some((d) => d.id === c.id)), 'ids are fresh, not default ids');
  assert.deepEqual(byName(s, 'Insurance'), { ...byName(s, 'Insurance'), kind: 'spend', budgetType: 'annual' });
  assert.equal('budgetType' in byName(s, 'Ignore'), false);
});

test('seeding does nothing when categories exist or anything was offered', () => {
  const s = seeded();
  assert.deepEqual(seedDefaults(defaults, s), {});
  const offeredOnly = emptyState();
  offeredOnly.settings.offeredDefaultIds = ['salary'];
  assert.deepEqual(seedDefaults(defaults, offeredOnly), {});
  const ownOnly = emptyState();
  ownOnly.categories = [{ id: 'x', name: 'Mine', kind: 'spend', budgetType: 'fixed', position: 0 }];
  assert.deepEqual(seedDefaults(defaults, ownOnly), {});
});

test('first-run changes are the seeding a first visit gets, from an empty state', () => {
  const changes = firstRunChanges(defaults);
  assert.deepEqual(Object.keys(changes), ['put']);
  assert.deepEqual(Object.keys(changes.put ?? {}).sort(), ['categories', 'settings']);
  assert.deepEqual(changes.put?.settings, [{ ...emptyState().settings, offeredDefaultIds: defaults.map((d) => d.id) }]);
  const s = emptyState();
  applyToState(s, changes);
  const first = seeded();
  /** @param {{id: string}[]} list */
  const withoutIds = (list) => list.map(({ id: _id, ...rest }) => rest);
  assert.deepEqual(withoutIds(s.categories), withoutIds(first.categories));
  assert.deepEqual(s.settings, first.settings);
  assert.equal('lastBackupAt' in s.settings, false);
  assert.equal(s.settings.helpDismissed, false);
});

test('a 26th default is pending; dismissing records it and adds nothing', () => {
  const s = seeded();
  assert.deepEqual(pendingDefaults(defaults, s.settings), []);
  const more = [...defaults, extra];
  assert.deepEqual(pendingDefaults(more, s.settings), [extra]);
  const changes = dismissDefaults(s, ['pets']);
  assert.equal(changes.put?.categories, undefined);
  applyToState(s, changes);
  assert.equal(s.categories.length, 25);
  assert.equal(s.settings.offeredDefaultIds.length, 26);
  assert.deepEqual(pendingDefaults(more, s.settings), []);
});

test('pending defaults keep file order', () => {
  const s = seeded();
  const a = { id: 'a', name: 'A', kind: 'spend', budgetType: 'fixed' };
  const b = { id: 'b', name: 'B', kind: 'ignore' };
  assert.deepEqual(pendingDefaults([b, ...defaults, a], s.settings), [b, a]);
});

test('accepting a default adds it after the last position and records it', () => {
  const s = seeded();
  applyToState(s, acceptDefaults(s, ['pets'], [...defaults, extra]));
  const pets = byName(s, 'Pets');
  assert.equal(pets.defaultId, 'pets');
  assert.equal(pets.kind, 'spend');
  assert.equal(pets.budgetType, 'variable');
  assert.equal(pets.position, 25);
  assert.notEqual(pets.id, 'pets');
  assert.ok(s.settings.offeredDefaultIds.includes('pets'));
  assert.equal(s.settings.offeredDefaultIds.length, 26);
});

test('accepting skips a default whose name exists, ignoring case, but still records it', () => {
  const s = seeded();
  const clash = { id: 'gifts-2', name: 'GIFTS', kind: 'spend', budgetType: 'annual' };
  applyToState(s, acceptDefaults(s, ['gifts-2', 'pets'], [...defaults, clash, extra]));
  assert.equal(s.categories.length, 26);
  assert.equal(s.categories.filter((c) => c.name.toLowerCase() === 'gifts').length, 1);
  assert.ok(s.settings.offeredDefaultIds.includes('gifts-2'));
  assert.ok(s.settings.offeredDefaultIds.includes('pets'));
  assert.equal(byName(s, 'Pets').position, 25);
});

test('a renamed or retyped default in the file does not change the user\'s category', () => {
  const s = seeded();
  const before = structuredClone(s.categories);
  const changed = defaults.map((d) => (d.id === 'gifts' ? { ...d, name: 'Presents', budgetType: 'variable' } : d));
  assert.deepEqual(seedDefaults(changed, s), {});
  assert.deepEqual(pendingDefaults(changed, s.settings), []);
  assert.deepEqual(s.categories, before);
  assert.equal(byName(s, 'Gifts').budgetType, 'annual');
  // Removing an entry from the file does nothing either.
  const removed = defaults.filter((d) => d.id !== 'gifts');
  assert.deepEqual(seedDefaults(removed, s), {});
  assert.deepEqual(pendingDefaults(removed, s.settings), []);
  assert.ok(byName(s, 'Gifts'));
});

test('createCategory adds at the end with a trimmed name', () => {
  const s = seeded();
  const changes = createCategory(s, { name: '  Pets ', kind: 'spend', budgetType: 'variable' });
  assert.ok(!('error' in changes));
  applyToState(s, changes);
  const pets = byName(s, 'Pets');
  assert.equal(pets.position, 25);
  assert.equal(pets.defaultId, undefined);
  assert.equal(orderedCategories(s).at(-1).name, 'Pets');
  const t = createCategory(s, { name: 'Savings pot', kind: 'transfer' });
  assert.ok(!('error' in t));
  applyToState(s, t);
  assert.equal(byName(s, 'Savings pot').position, 26);
  assert.equal('budgetType' in byName(s, 'Savings pot'), false);
});

test('createCategory refuses bad input', () => {
  const s = seeded();
  const err = (input) => {
    const r = createCategory(s, input);
    assert.ok('error' in r, JSON.stringify(input));
    assert.equal(typeof r.error, 'string');
  };
  err({ name: '   ', kind: 'spend', budgetType: 'fixed' });
  err({ name: 'gifts', kind: 'spend', budgetType: 'fixed' });
  err({ name: 'Pets', kind: 'spend' });
  err({ name: 'Pets', kind: 'income' });
  err({ name: 'Pets', kind: 'contribution' });
  err({ name: 'Pets', kind: 'transfer', budgetType: 'fixed' });
  err({ name: 'Pets', kind: 'ignore', budgetType: 'variable' });
  err({ name: 'Pets', kind: 'nonsense', budgetType: 'fixed' });
  err({ name: 'Pets', kind: 'spend', budgetType: 'weekly' });
});

test('createCategory on an empty state starts at position 0', () => {
  const s = emptyState();
  applyToState(s, createCategory(s, { name: 'First', kind: 'ignore' }));
  assert.equal(s.categories[0].position, 0);
});

test('updateCategory validates the merged result', () => {
  const s = seeded();
  const ins = byName(s, 'Insurance');
  applyToState(s, updateCategory(s, ins.id, { budgetType: 'variable' }));
  assert.equal(byName(s, 'Insurance').budgetType, 'variable');
  assert.equal(byName(s, 'Insurance').position, ins.position);
  assert.equal(byName(s, 'Insurance').defaultId, 'insurance');

  assert.ok('error' in updateCategory(s, ins.id, { name: 'gifts' }));
  assert.ok('error' in updateCategory(s, ins.id, { name: ' ' }));
  assert.ok('error' in updateCategory(s, 'missing', { name: 'X' }));
  const between = byName(s, 'Between my accounts');
  assert.ok('error' in updateCategory(s, between.id, { budgetType: 'fixed' }));
  assert.ok('error' in updateCategory(s, between.id, { kind: 'spend' }), 'spend needs a budget type');

  // Same name in a different case is a rename of itself, not a clash.
  applyToState(s, updateCategory(s, ins.id, { name: ' INSURANCE ' }));
  assert.equal(s.categories.find((c) => c.id === ins.id).name, 'INSURANCE');

  // Changing to transfer or ignore drops the budget type.
  applyToState(s, updateCategory(s, ins.id, { kind: 'ignore' }));
  const now = s.categories.find((c) => c.id === ins.id);
  assert.equal(now.kind, 'ignore');
  assert.equal('budgetType' in now, false);
  applyToState(s, updateCategory(s, ins.id, { kind: 'income', budgetType: 'fixed' }));
  assert.equal(s.categories.find((c) => c.id === ins.id).budgetType, 'fixed');
});

/** A state where Gifts is used by a bucket, an override and a split part. */
function withGiftsUsed() {
  const s = seeded();
  const gifts = byName(s, 'Gifts').id;
  const groceries = byName(s, 'Groceries').id;
  s.buckets = [
    { id: 'b1', keys: ['card shop'], displayName: 'Card shop', categoryId: gifts, exampleRawTexts: [] },
    { id: 'b2', keys: ['tesco'], displayName: 'Tesco', categoryId: groceries, exampleRawTexts: [] },
  ];
  s.overrides.set('f1', { fingerprint: 'f1', categoryId: gifts, unusualDismissed: true });
  s.overrides.set('f2', { fingerprint: 'f2', splits: [{ amountMinor: -500, categoryId: groceries }, { amountMinor: -700, categoryId: gifts }] });
  s.overrides.set('f3', { fingerprint: 'f3', categoryId: groceries });
  return { s, gifts, groceries };
}

/** Every category id still referenced anywhere. */
function referenced(s) {
  const ids = [];
  for (const b of s.buckets) if (b.categoryId) ids.push(b.categoryId);
  for (const o of s.overrides.values()) {
    if (o.categoryId) ids.push(o.categoryId);
    for (const p of o.splits ?? []) ids.push(p.categoryId);
  }
  return ids;
}

test('Review Focus 4: deleting Gifts into Entertainment leaves nothing pointing at Gifts', () => {
  const { s, gifts, groceries } = withGiftsUsed();
  const ent = byName(s, 'Entertainment').id;
  assert.deepEqual(categoryUseCount(s, gifts), { buckets: 1, transactions: 2 });
  const changes = deleteCategory(s, gifts, ent);
  assert.ok(!('error' in changes));
  applyToState(s, changes);
  assert.equal(byName(s, 'Gifts'), undefined);
  assert.ok(!referenced(s).includes(gifts));
  assert.equal(s.buckets.find((b) => b.id === 'b1').categoryId, ent);
  assert.equal(s.buckets.find((b) => b.id === 'b2').categoryId, groceries);
  assert.deepEqual(s.overrides.get('f1'), { fingerprint: 'f1', categoryId: ent, unusualDismissed: true });
  assert.deepEqual(s.overrides.get('f2').splits, [{ amountMinor: -500, categoryId: groceries }, { amountMinor: -700, categoryId: ent }]);
  assert.equal(s.overrides.get('f3').categoryId, groceries);
  // Gifts was a default: it stays offered, so it is not suggested again.
  assert.deepEqual(pendingDefaults(defaults, s.settings), []);
});

test('deleting a referenced category needs a valid, different target', () => {
  const { s, gifts } = withGiftsUsed();
  assert.ok('error' in deleteCategory(s, gifts));
  assert.ok('error' in deleteCategory(s, gifts, gifts));
  assert.ok('error' in deleteCategory(s, gifts, 'no-such-id'));
  assert.ok('error' in deleteCategory(s, 'no-such-id', byName(s, 'Health').id));
  assert.ok(byName(s, 'Gifts'));
});

test('deleting an unused category needs no target', () => {
  const s = seeded();
  const health = byName(s, 'Health').id;
  assert.deepEqual(categoryUseCount(s, health), { buckets: 0, transactions: 0 });
  const changes = deleteCategory(s, health);
  assert.deepEqual(changes, { del: { categories: [health] } });
  applyToState(s, changes);
  assert.equal(byName(s, 'Health'), undefined);
});

test('orderedCategories sorts by position without changing state', () => {
  const s = emptyState();
  s.categories = [
    { id: 'c', name: 'C', kind: 'ignore', position: 5 },
    { id: 'a', name: 'A', kind: 'ignore', position: 1 },
    { id: 'b', name: 'B', kind: 'ignore', position: 3 },
  ];
  assert.deepEqual(orderedCategories(s).map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(s.categories.map((c) => c.id), ['c', 'a', 'b']);
});

test('sortedCategories sorts by name, ignoring case and accents, without changing state', () => {
  const s = emptyState();
  s.categories = [
    { id: 'x', name: 'groceries', kind: 'spend', position: 1 },
    { id: 'y', name: 'Café', kind: 'spend', position: 2 },
    { id: 'z', name: 'Bills', kind: 'spend', position: 3 },
    { id: 'w', name: 'cafe', kind: 'spend', position: 4 },
  ];
  assert.deepEqual(sortedCategories(s).map((c) => c.id), ['z', 'w', 'y', 'x']);
  assert.deepEqual(s.categories.map((c) => c.id), ['x', 'y', 'z', 'w']);
});
