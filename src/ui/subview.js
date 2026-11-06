// Browser back closes an open sub-view (one bucket from Buckets, one category from Typical
// month), the same as its "Back to" button.
//
// While a sub-view shows, there is one extra history entry with the same URL, marked in its
// state. Nothing about what is open goes into the URL or the state. Leaving that entry (browser
// back, or the Back to button, which calls history.back()) closes the view. A draw that no
// longer shows the view (a nav click, or its subject went) removes the entry without closing
// anything, so the next browser back is not wasted.

const MARK = 'livingCostsSubview';

/** @type {(() => void)|null} closes the sub-view the current entry belongs to */
let closer = null;
/** Whether a sub-view called showing() during the draw in progress. */
let shown = false;

/** @returns {boolean} */
const marked = () => history.state?.[MARK] === true;

/**
 * Listen for browser back and forward. A marked entry left from before a reload, or reached
 * again by browser forward, belongs to no open view, so step back off it.
 */
export function install() {
  window.addEventListener('popstate', () => {
    const close = closer;
    closer = null;
    if (close) close();
    else if (marked()) history.back();
  });
  if (marked()) history.back();
}

/**
 * Run one draw of the screen. If no sub-view showed during it, drop the entry of one that
 * showed before.
 * @param {() => void} render
 */
export function draw(render) {
  shown = false;
  render();
  if (!shown && closer) {
    closer = null;
    history.back();
  }
}

/**
 * Called by a sub-view on every draw. The first call adds its history entry.
 * @param {() => void} close redraws without the view and places focus
 */
export function showing(close) {
  shown = true;
  if (!closer) history.pushState({ [MARK]: true }, '');
  closer = close;
}

/** The Back to button: leave the entry, and popstate closes the view. */
export function back() {
  if (closer) history.back();
}
