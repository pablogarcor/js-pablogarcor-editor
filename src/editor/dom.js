// @ts-check
/**
 * vnodes (view.js) -> DOM elements. The only part of the view that touches
 * `document`.
 *
 * Post content reaches the page only as text nodes and setAttribute values,
 * never through innerHTML, so a post cannot inject markup or scripts. On
 * top of that, tags are limited to the ones the view uses and event handler
 * attributes are refused.
 */

const TAGS = new Set([
  'article', 'blockquote', 'br', 'button', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 'span', 'strong',
  'textarea', 'ul',
]);

/**
 * @typedef {import('./view.js').VChild} VChild
 */

/**
 * @param {VChild} node
 * @param {Document} [doc]
 * @returns {Node}
 */
export function toDom(node, doc = document) {
  if (typeof node === 'string') return doc.createTextNode(node);
  if (!TAGS.has(node.tag)) throw new Error(`Unexpected tag in the view: <${node.tag}>`);
  const el = doc.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (/^on/i.test(name)) throw new Error(`Event handler attributes are not allowed: ${name}`);
    el.setAttribute(name, value);
  }
  for (const child of node.children ?? []) el.append(toDom(child, doc));
  return el;
}

/**
 * Replaces the content of `container` with `node`.
 * @param {Element} container
 * @param {VChild} node
 */
export function mount(container, node) {
  container.replaceChildren(toDom(node, container.ownerDocument));
}
