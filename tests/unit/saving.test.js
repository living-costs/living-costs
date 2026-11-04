// The save queue in src/ui/saving.js. whileSaving is given a scope with no buttons, so no DOM is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueSave, whileSaving, isSaving } from '../../src/ui/saving.js';

const noButtons = /** @type {ParentNode} */ (/** @type {unknown} */ ({ querySelectorAll: () => [] }));

/** A promise with its resolve and reject. */
function deferred() {
  /** @type {(v?: unknown) => void} */
  let resolve = () => {};
  /** @type {(e: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

test('queued saves run one at a time, in order, each seeing the state when it runs', async () => {
  const state = { value: 'start' };
  /** @type {string[]} */
  const seen = [];
  const first = deferred();
  const a = queueSave(async () => {
    seen.push(`a saw ${state.value}`);
    await first.promise;
    state.value = 'a';
  });
  const b = queueSave(async () => {
    seen.push(`b saw ${state.value}`);
    state.value = 'b';
  });
  await tick();
  assert.deepEqual(seen, ['a saw start']);
  assert.equal(isSaving(), true);
  first.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(seen, ['a saw start', 'b saw a']);
  assert.equal(state.value, 'b');
  assert.equal(isSaving(), false);
});

test('a failed queued save rejects, and the next one still runs', async () => {
  /** @type {string[]} */
  const ran = [];
  const a = queueSave(async () => { ran.push('a'); throw new Error('boom'); });
  const b = queueSave(async () => { ran.push('b'); });
  await assert.rejects(a, /boom/);
  await b;
  assert.deepEqual(ran, ['a', 'b']);
  assert.equal(isSaving(), false);
});

test('a button save is dropped while a queued save is pending', async () => {
  const first = deferred();
  const a = queueSave(() => first.promise);
  let buttonRan = false;
  await whileSaving(noButtons, async () => { buttonRan = true; });
  assert.equal(buttonRan, false);
  first.resolve();
  await a;
  await whileSaving(noButtons, async () => { buttonRan = true; });
  assert.equal(buttonRan, true);
});

test('a queued save waits for a button save in flight', async () => {
  /** @type {string[]} */
  const order = [];
  const first = deferred();
  const button = whileSaving(noButtons, async () => { await first.promise; order.push('button'); });
  const queued = queueSave(async () => { order.push('queued'); });
  await tick();
  assert.deepEqual(order, []);
  first.resolve();
  await Promise.all([button, queued]);
  assert.deepEqual(order, ['button', 'queued']);
});
