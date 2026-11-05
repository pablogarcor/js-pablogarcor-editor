// @ts-check
/**
 * DOM points <-> model positions.
 *
 * A model position is a field and an offset (see model/editing.js). In the
 * DOM, a field is the element with `data-field`; inside it, text nodes count
 * their characters, a <br> counts one (a break run), an element with
 * `data-atom` counts one whatever it contains, and the `data-filler` <br> is
 * not content. Those markers come from view.js.
 *
 * Only a small part of the DOM API is used (nodeType, nodeName, childNodes,
 * parentNode, data, hasAttribute, getAttribute), so the tests run this code
 * on a fake tree in Node.
 */

/**
 * @typedef {import('../model/editing.js').Pos} Pos
 * @typedef {{ node: Node, offset: number }} Point
 */

const ELEMENT = 1;
const TEXT = 3;

/** @param {Node} node @returns {node is Element} */
const isElement = (node) => node.nodeType === ELEMENT;
/** @param {Node} node */
const isFiller = (node) => isElement(node) && node.hasAttribute('data-filler');
/** @param {Node} node */
const isAtom = (node) => isElement(node) && node.hasAttribute('data-atom');
/** @param {Node} node */
const isBreak = (node) => isElement(node) && node.nodeName === 'BR' && !isFiller(node);
/** @param {Node} node */
const isField = (node) => isElement(node) && node.hasAttribute('data-field');

/**
 * @param {Node} node
 * @param {Node} ancestor
 */
function within(node, ancestor) {
  for (let n = /** @type {Node | null} */ (node); n; n = n.parentNode) if (n === ancestor) return true;
  return false;
}

/**
 * The field element that contains `node` (or is it), below `root`.
 * @param {Node} root
 * @param {Node} node
 * @returns {Element | null}
 */
export function fieldOf(root, node) {
  for (let n = /** @type {Node | null} */ (node); n && n !== root; n = n.parentNode) if (isField(n)) return /** @type {Element} */ (n);
  return null;
}

/**
 * @param {Element} field
 * @param {number} offset
 * @returns {Pos}
 */
function fieldPos(field, offset) {
  let block = /** @type {Node | null} */ (field);
  while (block && !(isElement(block) && block.hasAttribute('data-block-id'))) block = block.parentNode;
  if (!block) throw new Error('Field outside a block');
  return {
    block: /** @type {string} */ (/** @type {Element} */ (block).getAttribute('data-block-id')),
    item: Number(field.getAttribute('data-field')),
    offset,
  };
}

/**
 * Model offset of a DOM point inside a field. A point inside an atom counts
 * as just before it.
 * @param {Element} field
 * @param {Node} target
 * @param {number} targetOffset
 */
export function measure(field, target, targetOffset) {
  let count = 0;
  /** @param {Node} node @returns {boolean} true once the target is reached */
  function walk(node) {
    if (node === target) {
      if (node.nodeType === TEXT) count += targetOffset;
      else if (isAtom(node) || isBreak(node)) count += targetOffset > 0 ? 1 : 0;
      else {
        const kids = node.childNodes;
        for (let i = 0; i < targetOffset && i < kids.length; i++) walk(kids[i]);
      }
      return true;
    }
    if (node.nodeType === TEXT) {
      count += /** @type {Text} */ (node).data.length;
      return false;
    }
    if (!isElement(node) || isFiller(node)) return false;
    if (isBreak(node)) {
      count += 1;
      return false;
    }
    if (isAtom(node)) {
      if (within(target, node)) return true;
      count += 1;
      return false;
    }
    for (const child of node.childNodes) if (walk(child)) return true;
    return false;
  }
  walk(field);
  return count;
}

/** @param {Element} field */
export function fieldLength(field) {
  return measure(field, field, field.childNodes.length);
}

/**
 * The DOM point for a model offset inside a field. Positions inside text are
 * preferred to element boundaries, and the end of the field is before its
 * filler <br>.
 * @param {Element} field
 * @param {number} offset
 * @returns {Point}
 */
export function pointAt(field, offset) {
  let remaining = offset;
  /** @type {Point | null} */
  let found = null;
  /** @param {Node} node @returns {boolean} */
  function walk(node) {
    if (node.nodeType === TEXT) {
      const len = /** @type {Text} */ (node).data.length;
      if (remaining <= len) {
        found = { node, offset: remaining };
        return true;
      }
      remaining -= len;
      return false;
    }
    if (!isElement(node) || isFiller(node)) return false;
    if (isBreak(node) || isAtom(node)) {
      if (remaining === 0) {
        found = before(node);
        return true;
      }
      remaining -= 1;
      return false;
    }
    for (const child of node.childNodes) if (walk(child)) return true;
    return false;
  }
  for (const child of field.childNodes) if (walk(child)) return /** @type {Point} */ (/** @type {unknown} */ (found));
  const kids = field.childNodes;
  let end = kids.length;
  if (end && isFiller(kids[end - 1])) end--;
  return { node: field, offset: end };
}

/** @param {Node} node @returns {Point} */
function before(node) {
  const parent = /** @type {Node} */ (node.parentNode);
  return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) };
}

/**
 * The model position of a DOM point under `root`. Points outside any field
 * (between blocks, inside an image block...) snap to the start of the next
 * field, or the end of the previous one. Null when there is no field at all
 * or the point is not under root.
 * @param {Node} root
 * @param {Node} node
 * @param {number} offset
 * @returns {Pos | null}
 */
export function positionOf(root, node, offset) {
  if (!within(node, root)) return null;
  const field = fieldOf(root, node);
  if (field) return fieldPos(field, measure(field, node, offset));

  /** @type {Element | null} */
  let previous = null;
  /** @type {Element | null} */
  let next = null;
  let passed = false;
  /** @param {Node} n */
  function visit(n) {
    if (n === node && n.nodeType === TEXT) passed = true;
    if (isField(n)) {
      if (passed) next = /** @type {Element} */ (n);
      else previous = /** @type {Element} */ (n);
      return;
    }
    const kids = n.childNodes;
    for (let i = 0; i < kids.length && !next; i++) {
      if (n === node && i === offset) passed = true;
      visit(kids[i]);
    }
    if (n === node && offset >= kids.length) passed = true;
  }
  visit(root);
  if (next) return fieldPos(next, 0);
  if (previous) return fieldPos(previous, fieldLength(previous));
  return null;
}
