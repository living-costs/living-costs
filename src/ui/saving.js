// One save at a time. Two ways in:
// - whileSaving, for buttons: while any save is in flight, the buttons that change data are
//   disabled and further clicks are ignored, so a fast double-click or a repeated key can't apply
//   a change twice against stale state.
// - queueSave, for selects: a change made while another save is in flight is queued, not dropped,
//   so the last value chosen is the one saved (Chrome's type-ahead can fire two changes quickly).
// Either way, build the Changes inside the save, so they come from the state when it runs.

/** Saves started or queued that have not settled yet. */
let pending = 0;
/** Settles once every save started or queued so far has settled. Never rejects. */
let tail = Promise.resolve();

/** @returns {boolean} true while any save is in flight or queued */
export const isSaving = () => pending > 0;

/**
 * Run `save` unless another save is in flight or queued. Every `button[data-saves]` inside
 * `scope` is disabled until it settles. If focus was on one of those buttons, it moves to
 * `focusTo` first, so the redraw that follows the save can put it back (see App.rerender).
 * A rejected save still rejects, so the app's error handler reports it.
 * @param {ParentNode} scope
 * @param {() => Promise<unknown>} save
 * @param {HTMLElement} [focusTo]
 * @returns {Promise<void>}
 */
export async function whileSaving(scope, save, focusTo) {
  if (pending > 0) return;
  pending++;
  const buttons = [...scope.querySelectorAll('button[data-saves]')]
    .filter((b) => b instanceof HTMLButtonElement && !b.disabled);
  if (focusTo && buttons.some((b) => b === document.activeElement)) focusTo.focus();
  for (const b of buttons) /** @type {HTMLButtonElement} */ (b).disabled = true;
  // Started now, in this task, as before: an async wrapper so a throw becomes a rejection.
  const run = (async () => save())();
  tail = run.then(() => {}, () => {});
  try {
    await run;
  } finally {
    pending--;
    // Usually the save has redrawn the screen and these are gone; after a failure they are not.
    for (const b of buttons) /** @type {HTMLButtonElement} */ (b).disabled = false;
  }
}

/**
 * Run `save` once every save started or queued before it has settled. A failed save rejects its
 * own promise, so the app's error handler reports it, and the queue carries on.
 * @param {() => Promise<unknown>} save
 * @returns {Promise<void>}
 */
export async function queueSave(save) {
  pending++;
  const run = tail.then(save);
  tail = run.then(() => {}, () => {});
  try {
    await run;
  } finally {
    pending--;
  }
}
