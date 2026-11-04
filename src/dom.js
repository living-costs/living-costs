// A tiny DOM builder. Text always goes in as text nodes, never as markup.

/** @typedef {Node | string | number | null | false | undefined} Child */

/**
 * Build an element.
 * - `on<Event>` props must be functions and become listeners (`onClick` → `click`).
 * - Every other prop goes through `setAttribute`; `true` sets an empty attribute,
 *   and `false`, `null` or `undefined` skips it.
 * - A `style` prop, or any prop matching /html/i, throws. Use `el.style.prop` instead.
 * @param {string} tag
 * @param {Record<string, unknown> | null} [props]
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key.toLowerCase() === 'style' || /html/i.test(key)) throw new Error(`h(): prop not allowed: ${key}`);
    if (/^on/i.test(key)) {
      if (typeof value !== 'function') throw new Error(`h(): ${key} must be a function`);
      el.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
      continue;
    }
    if (value === false || value === null || value === undefined) continue;
    el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === false || child === undefined) continue;
    el.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return el;
}

/**
 * Remove every child of `el`.
 * @param {Element} el
 * @returns {void}
 */
export function clear(el) {
  el.replaceChildren();
}
