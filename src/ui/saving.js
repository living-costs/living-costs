// One save at a time. While a save is in flight, the buttons that change data are disabled and
// further saves are ignored, so a fast double-click or a repeated key can't apply a change twice
// against stale state.

let busy = false;

/** @returns {boolean} true while a save started by whileSaving is in flight */
export const isSaving = () => busy;

/**
 * Run `save` unless another save is in flight. Every `button[data-saves]` inside `scope` is
 * disabled until it settles. If focus was on one of those buttons, it moves to `focusTo` first,
 * so the redraw that follows the save can put it back (see App.rerender).
 * Build the Changes inside `save`, so they are computed from the state at that moment.
 * A rejected save still rejects, so the app's error handler reports it.
 * @param {ParentNode} scope
 * @param {() => Promise<unknown>} save
 * @param {HTMLElement} [focusTo]
 * @returns {Promise<void>}
 */
export async function whileSaving(scope, save, focusTo) {
  if (busy) return;
  busy = true;
  const buttons = [...scope.querySelectorAll('button[data-saves]')]
    .filter((b) => b instanceof HTMLButtonElement && !b.disabled);
  if (focusTo && buttons.some((b) => b === document.activeElement)) focusTo.focus();
  for (const b of buttons) /** @type {HTMLButtonElement} */ (b).disabled = true;
  try {
    await save();
  } finally {
    busy = false;
    // Usually the save has redrawn the screen and these are gone; after a failure they are not.
    for (const b of buttons) /** @type {HTMLButtonElement} */ (b).disabled = false;
  }
}
