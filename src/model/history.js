// @ts-check
/**
 * Undo/redo over immutable documents. Each entry is a whole document, which
 * is cheap because unchanged blocks are shared between versions.
 *
 * `group` lets consecutive edits of the same kind collapse into one undo
 * step (typing in the same block, for instance): a push with the same group
 * as the previous one replaces the present instead of adding a step.
 */

/**
 * @template T
 * @typedef {{ past: T[], present: T, future: T[], group: string | null, limit: number }} History
 */

/**
 * @template T
 * @param {T} initial
 * @param {{ limit?: number }} [opts]
 * @returns {History<T>}
 */
export function createHistory(initial, { limit = 200 } = {}) {
  return { past: [], present: initial, future: [], group: null, limit };
}

/**
 * @template T
 * @param {History<T>} h
 * @param {T} next
 * @param {{ group?: string | null }} [opts]
 * @returns {History<T>}
 */
export function push(h, next, { group = null } = {}) {
  if (next === h.present) return h;
  if (group !== null && group === h.group) return { ...h, present: next, future: [] };
  const past = [...h.past, h.present].slice(-h.limit);
  return { ...h, past, present: next, future: [], group };
}

/**
 * @template T
 * @param {History<T>} h
 * @returns {History<T>}
 */
export function undo(h) {
  if (!h.past.length) return h;
  const previous = h.past[h.past.length - 1];
  return { ...h, past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future], group: null };
}

/**
 * @template T
 * @param {History<T>} h
 * @returns {History<T>}
 */
export function redo(h) {
  if (!h.future.length) return h;
  const [next, ...future] = h.future;
  return { ...h, past: [...h.past, h.present], present: next, future, group: null };
}

/** @param {History<unknown>} h */
export const canUndo = (h) => h.past.length > 0;

/** @param {History<unknown>} h */
export const canRedo = (h) => h.future.length > 0;
