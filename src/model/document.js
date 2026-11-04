// @ts-check
/**
 * Block document model: the single source of truth of the editor.
 *
 * Documents are immutable: every operation returns a new document and shares
 * the blocks it did not touch. That keeps undo/redo cheap (history.js) and
 * makes "what changed" explicit.
 *
 * Blocks parsed from an existing post carry two layout fields:
 *  - `raw`: the exact Markdown they came from. While a block keeps `raw`, the
 *    serializer writes it back untouched, so editing one paragraph of an old
 *    post produces a one-paragraph diff in the pull request.
 *  - `sep`: the exact text between the previous block and this one.
 * Any edit goes through `updateBlock`/`replaceBlock`, which drop `raw`.
 */

import { normalizeRuns, plainText, text as textRun } from './inline.js';

/**
 * @typedef {import('./inline.js').Run} Run
 * @typedef {{ id: string, raw?: string, sep?: string }} BlockBase
 * @typedef {BlockBase & { type: 'paragraph', runs: Run[] }} ParagraphBlock
 * @typedef {BlockBase & { type: 'heading', level: number, runs: Run[] }} HeadingBlock
 * @typedef {BlockBase & { type: 'quote', runs: Run[] }} QuoteBlock
 * @typedef {{ runs: Run[] }} ListItem
 * @typedef {BlockBase & { type: 'list', ordered: boolean, start: number, marker: string, loose: boolean, items: ListItem[] }} ListBlock
 * @typedef {BlockBase & { type: 'code', info: string, text: string }} CodeBlock
 * @typedef {BlockBase & { type: 'image', src: string, alt: string, title?: string }} ImageBlock
 * @typedef {BlockBase & { type: 'hr' }} HrBlock
 * @typedef {BlockBase & { type: 'raw', source: string }} RawBlock
 * @typedef {ParagraphBlock | HeadingBlock | QuoteBlock | ListBlock | CodeBlock | ImageBlock | HrBlock | RawBlock} Block
 * @typedef {Block extends infer B ? (B extends Block ? Omit<B, 'id'> : never) : never} BlockData a block without its id
 * @typedef {import('../markdown/frontmatter.js').FrontMatter} FrontMatter
 * @typedef {{ frontMatter: FrontMatter | null, blocks: Block[], trailing?: string }} Doc
 */

let counter = 0;

export function newId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `b${Date.now().toString(36)}${(counter++).toString(36)}`;
}

/**
 * Block factories. `marker` is the list bullet (`*`, `-`, `+`) or, for ordered
 * lists, the delimiter after the number (`.` or `)`).
 */
export const blocks = {
  /** @param {Run[]} [runs] @returns {ParagraphBlock} */
  paragraph: (runs = []) => ({ id: newId(), type: 'paragraph', runs: normalizeRuns(runs) }),
  /** @param {number} level @param {Run[]} [runs] @returns {HeadingBlock} */
  heading: (level, runs = []) => ({ id: newId(), type: 'heading', level, runs: normalizeRuns(runs) }),
  /** @param {Run[]} [runs] @returns {QuoteBlock} */
  quote: (runs = []) => ({ id: newId(), type: 'quote', runs: normalizeRuns(runs) }),
  /**
   * @param {{ ordered?: boolean, start?: number, marker?: string, loose?: boolean, items?: Run[][] }} [opts]
   * @returns {ListBlock}
   */
  list: ({ ordered = false, start = 1, marker = ordered ? '.' : '*', loose = false, items = [[]] } = {}) => ({
    id: newId(),
    type: 'list',
    ordered,
    start,
    marker,
    loose,
    items: items.map((runs) => ({ runs: normalizeRuns(runs) })),
  }),
  /** @param {string} [info] @param {string} [text] @returns {CodeBlock} */
  code: (info = '', text = '') => ({ id: newId(), type: 'code', info, text }),
  /** @param {{ src: string, alt?: string, title?: string }} img @returns {ImageBlock} */
  image: ({ src, alt = '', title }) => (title ? { id: newId(), type: 'image', src, alt, title } : { id: newId(), type: 'image', src, alt }),
  /** @returns {HrBlock} */
  hr: () => ({ id: newId(), type: 'hr' }),
  /** @param {string} source @returns {RawBlock} */
  raw: (source) => ({ id: newId(), type: 'raw', source }),
};

/**
 * @param {{ frontMatter?: FrontMatter | null, blocks?: Block[], trailing?: string }} [init]
 * @returns {Doc}
 */
export function createDocument({ frontMatter = null, blocks: list = [], trailing = '\n' } = {}) {
  return { frontMatter, blocks: list, trailing };
}

/**
 * @param {Doc} doc
 * @param {string} id
 */
export function findBlock(doc, id) {
  return doc.blocks.find((b) => b.id === id);
}

/**
 * @param {Doc} doc
 * @param {string} id
 */
export function blockIndex(doc, id) {
  const index = doc.blocks.findIndex((b) => b.id === id);
  if (index < 0) throw new Error(`Block ${id} not found`);
  return index;
}

/**
 * Removes the source snapshot of a block: from now on it is serialized from
 * the model. The separator is layout, not content, so it stays.
 * @template {Block} T
 * @param {T} block
 * @returns {T}
 */
export function touch(block) {
  const { raw, ...rest } = block;
  return /** @type {T} */ (rest);
}

/**
 * @param {Doc} doc
 * @param {string} id
 * @param {Partial<Block> | ((block: Block) => Partial<Block>)} patch
 * @returns {Doc}
 */
export function updateBlock(doc, id, patch) {
  const index = blockIndex(doc, id);
  const current = doc.blocks[index];
  const changes = typeof patch === 'function' ? patch(current) : patch;
  const merged = /** @type {Block} */ (/** @type {unknown} */ ({ ...current, ...changes, id: current.id, type: changes.type ?? current.type }));
  const next = touch(merged);
  if ('runs' in next) next.runs = normalizeRuns(next.runs);
  return withBlocks(doc, [...doc.blocks.slice(0, index), next, ...doc.blocks.slice(index + 1)]);
}

/**
 * @param {Doc} doc
 * @param {string} id
 * @param {Block} block
 * @returns {Doc}
 */
export function replaceBlock(doc, id, block) {
  const index = blockIndex(doc, id);
  const sep = doc.blocks[index].sep;
  const next = touch({ ...block, ...(sep === undefined ? {} : { sep }) });
  return withBlocks(doc, [...doc.blocks.slice(0, index), next, ...doc.blocks.slice(index + 1)]);
}

/**
 * @param {Doc} doc
 * @param {number} index
 * @param {Block} block
 * @returns {Doc}
 */
export function insertBlock(doc, index, block) {
  const { sep, ...clean } = touch(block);
  return withBlocks(doc, [...doc.blocks.slice(0, index), /** @type {Block} */ (clean), ...doc.blocks.slice(index)]);
}

/**
 * @param {Doc} doc
 * @param {string} id
 * @returns {Doc}
 */
export function removeBlock(doc, id) {
  const index = blockIndex(doc, id);
  const list = [...doc.blocks.slice(0, index), ...doc.blocks.slice(index + 1)];
  // The next block's separator was measured against the removed block.
  if (list[index]) list[index] = dropSep(list[index]);
  return withBlocks(doc, list);
}

/**
 * @param {Doc} doc
 * @param {string} id
 * @param {number} toIndex position in the resulting list
 * @returns {Doc}
 */
export function moveBlock(doc, id, toIndex) {
  const index = blockIndex(doc, id);
  const list = [...doc.blocks];
  const [moved] = list.splice(index, 1);
  if (list[index]) list[index] = dropSep(list[index]);
  list.splice(toIndex, 0, dropSep(moved));
  if (list[toIndex + 1]) list[toIndex + 1] = dropSep(list[toIndex + 1]);
  return withBlocks(doc, list);
}

/**
 * @param {Block} block
 * @returns {Block}
 */
function dropSep(block) {
  const { sep, ...rest } = block;
  return /** @type {Block} */ (rest);
}

/**
 * Turns a text block into another type, keeping its inline content.
 * Paragraph, heading, quote and list convert into each other; a list becomes
 * one block per item when converted to anything else.
 * @param {Doc} doc
 * @param {string} id
 * @param {'paragraph' | 'heading' | 'quote' | 'list'} type
 * @param {{ level?: number, ordered?: boolean }} [opts]
 * @returns {Doc}
 */
export function convertBlock(doc, id, type, opts = {}) {
  const index = blockIndex(doc, id);
  const current = doc.blocks[index];
  /** @type {Run[][]} */
  let contents;
  if (current.type === 'list') contents = current.items.map((i) => i.runs);
  else if ('runs' in current) contents = [current.runs];
  else if (current.type === 'code' || current.type === 'raw') contents = [[textRun(current.type === 'code' ? current.text : current.source)]];
  else throw new Error(`Cannot convert a ${current.type} block`);

  /** @type {Block[]} */
  let next;
  if (type === 'list') {
    next = [blocks.list({ ordered: opts.ordered ?? false, items: contents })];
  } else {
    next = contents.map((runs) => {
      if (type === 'heading') return blocks.heading(opts.level ?? 2, flattenBreaks(runs));
      if (type === 'quote') return blocks.quote(runs);
      return blocks.paragraph(runs);
    });
  }
  if (current.sep !== undefined) next[0] = { ...next[0], sep: current.sep };
  return withBlocks(doc, [...doc.blocks.slice(0, index), ...next, ...doc.blocks.slice(index + 1)]);
}

/**
 * @param {Run[]} runs
 * @returns {Run[]}
 */
function flattenBreaks(runs) {
  return runs.map((r) => /** @type {Run} */ (r.type === 'break' ? textRun(' ') : r.type === 'text' ? { ...r, text: r.text.replace(/\n/g, ' ') } : r));
}

/**
 * @param {Doc} doc
 * @param {FrontMatter | null} frontMatter
 * @returns {Doc}
 */
export function setFrontMatter(doc, frontMatter) {
  return { ...doc, frontMatter };
}

/**
 * @param {Doc} doc
 * @param {Block[]} list
 * @returns {Doc}
 */
function withBlocks(doc, list) {
  return { ...doc, blocks: list };
}

/** @param {Doc} doc */
export function isPristine(doc) {
  return doc.blocks.every((b) => b.raw !== undefined) && (!doc.frontMatter || doc.frontMatter.entries.every((e) => e.raw !== undefined));
}

/** @param {Doc} doc */
export function documentText(doc) {
  return doc.blocks
    .map((b) => {
      if (b.type === 'list') return b.items.map((i) => plainText(i.runs)).join('\n');
      if ('runs' in b) return plainText(b.runs);
      if (b.type === 'code') return b.text;
      if (b.type === 'image') return b.alt;
      if (b.type === 'raw') return b.source;
      return '';
    })
    .join('\n\n');
}
