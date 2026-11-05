// @ts-check
/**
 * Toolbar commands: marks (bold, italic, code, link), block type, and
 * inserting or removing blocks. Pure functions over the immutable model,
 * like editing.js, with the same `(doc, selection) -> { doc, selection }`
 * shape.
 */

import { blockIndex, blocks as make, touch } from './document.js';
import { addMark, hasMark, marksAt, normalizeRuns, removeMark, runsLength } from './inline.js';
import { caret, fieldRuns, isCollapsed, isTextBlock, ordered } from './editing.js';

/**
 * @typedef {import('./document.js').Doc} Doc
 * @typedef {import('./document.js').Block} Block
 * @typedef {import('./document.js').ListBlock} ListBlock
 * @typedef {import('./inline.js').Run} Run
 * @typedef {import('./inline.js').Marks} Marks
 * @typedef {import('./editing.js').Pos} Pos
 * @typedef {import('./editing.js').Selection} Selection
 * @typedef {import('./editing.js').EditResult} EditResult
 * @typedef {'strong' | 'em' | 'code'} SimpleMark
 * @typedef {{ type: 'paragraph' } | { type: 'heading', level: number } | { type: 'quote' } | { type: 'list', ordered: boolean }} BlockKind
 * @typedef {{ block: string, item: number, from: number, to: number }} Segment
 */

/**
 * The part of each text field a selection covers, in document order.
 * Fields that are only touched at a boundary (an empty segment) are kept, so
 * a collapsed selection gives one segment.
 * @param {Doc} doc
 * @param {Selection} selection
 * @returns {Segment[]}
 */
export function segments(doc, selection) {
  const [s, e] = ordered(doc, selection);
  const si = blockIndex(doc, s.block);
  const ei = blockIndex(doc, e.block);
  /** @type {Segment[]} */
  const out = [];
  for (let i = si; i <= ei; i++) {
    const block = doc.blocks[i];
    if (!isTextBlock(block)) continue;
    const count = block.type === 'list' ? block.items.length : 1;
    const first = i === si ? s.item : 0;
    const last = i === ei ? e.item : count - 1;
    for (let item = first; item <= last; item++) {
      const length = runsLength(fieldRuns(doc, block.id, item));
      const from = i === si && item === s.item ? s.offset : 0;
      const to = i === ei && item === e.item ? e.offset : length;
      out.push({ block: block.id, item, from, to });
    }
  }
  return out;
}

/**
 * Replaces the runs of several fields at once.
 * @param {Doc} doc
 * @param {Map<string, Run[]>} changes keyed by `${block}:${item}`
 * @returns {Doc}
 */
function setFields(doc, changes) {
  const blocks = doc.blocks.map((block) => {
    if (!isTextBlock(block)) return block;
    if (block.type === 'list') {
      if (!block.items.some((_, i) => changes.has(`${block.id}:${i}`))) return block;
      const items = block.items.map((it, i) => {
        const runs = changes.get(`${block.id}:${i}`);
        return runs ? { runs: normalizeRuns(runs) } : it;
      });
      return touch({ ...block, items });
    }
    const runs = changes.get(`${block.id}:0`);
    return runs ? touch({ ...block, runs: normalizeRuns(runs) }) : block;
  });
  return { ...doc, blocks };
}

/**
 * Marks active at the selection, for the toolbar: at a caret, the marks
 * typing would use; over a range, the marks the whole range has.
 * @param {Doc} doc
 * @param {Selection} selection
 * @returns {{ strong: boolean, em: boolean, code: boolean, link: string | null }}
 */
export function activeMarks(doc, selection) {
  const pos = selection.focus;
  if (isCollapsed(selection)) {
    const m = marksAt(fieldRuns(doc, pos.block, pos.item), pos.offset);
    const link = linkAt(doc, pos);
    return { strong: Boolean(m.strong), em: Boolean(m.em), code: Boolean(m.code), link: link ? link.href : null };
  }
  const parts = segments(doc, selection).filter((s) => s.to > s.from);
  /** @param {import('./inline.js').MarkName} name */
  const all = (name) => parts.length > 0 && parts.every((s) => hasMark(fieldRuns(doc, s.block, s.item), s.from, s.to, name));
  const link = all('link') ? linkAt(doc, { ...ordered(doc, selection)[0], offset: ordered(doc, selection)[0].offset + 1 }) : null;
  return { strong: all('strong'), em: all('em'), code: all('code'), link: link ? link.href : null };
}

/**
 * Bold, italic or code over the selection: added to all of it, or removed
 * when all of it already has it. A collapsed selection changes nothing here
 * (the editor remembers the mark for the next characters typed).
 * @param {Doc} doc
 * @param {Selection} selection
 * @param {SimpleMark} name
 * @returns {EditResult}
 */
export function toggleMark(doc, selection, name) {
  const parts = segments(doc, selection).filter((s) => s.to > s.from);
  if (!parts.length) return { doc, selection };
  const remove = parts.every((s) => hasMark(fieldRuns(doc, s.block, s.item), s.from, s.to, name));
  const changes = new Map();
  for (const s of parts) {
    const runs = fieldRuns(doc, s.block, s.item);
    changes.set(`${s.block}:${s.item}`, remove ? removeMark(runs, s.from, s.to, name) : addMark(runs, s.from, s.to, name));
  }
  return { doc: setFields(doc, changes), selection };
}

/**
 * The link around a caret position: the run before or after the caret, and
 * every neighbour with the same href.
 * @param {Doc} doc
 * @param {Pos} pos
 * @returns {{ from: number, to: number, href: string } | null}
 */
export function linkAt(doc, pos) {
  const runs = fieldRuns(doc, pos.block, pos.item);
  let start = 0;
  /** @type {{ from: number, to: number, href: string }[]} */
  const spans = [];
  for (const r of runs) {
    const len = runsLength([r]);
    const href = r.marks.link?.href;
    const last = spans[spans.length - 1];
    if (href && last && last.to === start && last.href === href) last.to = start + len;
    else if (href) spans.push({ from: start, to: start + len, href });
    start += len;
  }
  return spans.find((s) => s.from < pos.offset && pos.offset < s.to) ?? spans.find((s) => s.from <= pos.offset && pos.offset <= s.to) ?? null;
}

/**
 * The selection a link command acts on: the selection itself, or, at a
 * caret, the whole link around it.
 * @param {Doc} doc
 * @param {Selection} selection
 * @returns {Selection | null}
 */
function linkTarget(doc, selection) {
  if (!isCollapsed(selection)) return selection;
  const pos = selection.focus;
  const link = linkAt(doc, pos);
  if (!link) return null;
  return { anchor: { ...pos, offset: link.from }, focus: { ...pos, offset: link.to } };
}

/**
 * Makes the selection a link (or changes the target of the link at the
 * caret). Images inside it are linked too.
 * @param {Doc} doc
 * @param {Selection} selection
 * @param {string} href
 * @returns {EditResult}
 */
export function setLink(doc, selection, href) {
  const target = linkTarget(doc, selection);
  if (!target) return { doc, selection };
  const changes = new Map();
  for (const s of segments(doc, target).filter((p) => p.to > p.from)) {
    changes.set(`${s.block}:${s.item}`, addMark(fieldRuns(doc, s.block, s.item), s.from, s.to, 'link', { href }));
  }
  return { doc: setFields(doc, changes), selection: target };
}

/**
 * @param {Doc} doc
 * @param {Selection} selection
 * @returns {EditResult}
 */
export function removeLink(doc, selection) {
  const target = linkTarget(doc, selection);
  if (!target) return { doc, selection };
  const changes = new Map();
  for (const s of segments(doc, target).filter((p) => p.to > p.from)) {
    changes.set(`${s.block}:${s.item}`, removeMark(fieldRuns(doc, s.block, s.item), s.from, s.to, 'link'));
  }
  return { doc: setFields(doc, changes), selection };
}

/**
 * What a link field typed by the user should be, or null when it is not
 * acceptable. Web, mail and relative links only: no javascript: or data:.
 * A bare domain gets https://.
 * @param {string} input
 */
export function normalizeHref(input) {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  if (/^(https?:\/\/[^/]|mailto:[^@\s]+@)/i.test(value)) return value;
  if (/^(\/|#|\.\.?\/)/.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(value)) return `https://${value}`;
  return null;
}

/**
 * The type of the block with the caret, for the toolbar.
 * @param {Doc} doc
 * @param {Selection} selection
 * @returns {BlockKind | null} null for headings outside 2-4 and non-text blocks
 */
export function blockKindAt(doc, selection) {
  const block = doc.blocks[blockIndex(doc, selection.focus.block)];
  if (block.type === 'paragraph' || block.type === 'quote') return { type: block.type };
  if (block.type === 'list') return { type: 'list', ordered: block.ordered };
  if (block.type === 'heading' && block.level >= 2 && block.level <= 4) return { type: 'heading', level: block.level };
  return null;
}

/**
 * @param {Block} block
 * @param {BlockKind} kind
 */
function isKind(block, kind) {
  if (block.type !== kind.type) return false;
  if (block.type === 'heading' && kind.type === 'heading') return block.level === kind.level;
  if (block.type === 'list' && kind.type === 'list') return block.ordered === kind.ordered;
  return true;
}

/**
 * Headings are one line: line breaks become spaces (same length, so offsets
 * do not move).
 * @param {Run[]} runs
 * @returns {Run[]}
 */
function oneLine(runs) {
  return runs.map((r) =>
    /** @type {Run} */ (r.type === 'break' ? { type: 'text', text: ' ', marks: {} } : r.type === 'text' ? { ...r, text: r.text.replace(/\n/g, ' ') } : r),
  );
}

/**
 * Changes the type of the text the selection touches: each paragraph, heading
 * or quote, and only the selected items of a list. Turning text into a list
 * makes one list of all of it, joined to a list of the same kind right
 * before or after. When everything is already of that type, it goes back to
 * paragraphs (pressing "list" twice undoes it).
 * @param {Doc} doc
 * @param {Selection} selection
 * @param {BlockKind} requested
 * @returns {EditResult}
 */
export function setBlockType(doc, selection, requested) {
  const [s, e] = ordered(doc, selection);
  const si = blockIndex(doc, s.block);
  const ei = blockIndex(doc, e.block);
  const touched = doc.blocks.slice(si, ei + 1).filter(isTextBlock);
  /** @type {BlockKind} */
  const kind = touched.every((b) => isKind(b, requested)) && requested.type !== 'paragraph' ? { type: 'paragraph' } : requested;

  /** @type {Block[]} */
  const out = [];
  /** Where each touched field ends up: `${block}:${item}` -> position without offset. */
  const moved = new Map();
  /** Lists created here (the only ones that may be joined to a neighbour). */
  const created = new Set();
  /** @type {{ runs: Run[], from: string }[]} */
  let pending = [];

  const flush = () => {
    if (!pending.length) return;
    const list = make.list({ ordered: kind.type === 'list' && kind.ordered, items: pending.map((p) => p.runs) });
    pending.forEach((p, i) => moved.set(p.from, { block: list.id, item: i }));
    created.add(list.id);
    out.push(list);
    pending = [];
  };

  /** @param {Run[]} runs @param {string} from */
  const convert = (runs, from) => {
    if (kind.type === 'list') {
      pending.push({ runs, from });
      return;
    }
    const block =
      kind.type === 'heading' ? make.heading(kind.level, oneLine(runs)) : kind.type === 'quote' ? make.quote(runs) : make.paragraph(runs);
    moved.set(from, { block: block.id, item: 0 });
    out.push(block);
  };

  for (let i = si; i <= ei; i++) {
    const block = doc.blocks[i];
    if (!isTextBlock(block)) {
      flush();
      out.push(block);
      continue;
    }
    if (block.type !== 'list') {
      convert(block.runs, `${block.id}:0`);
      continue;
    }
    const first = i === si ? s.item : 0;
    const last = i === ei ? e.item : block.items.length - 1;
    if (first > 0) out.push(touch({ ...block, items: block.items.slice(0, first) }));
    for (let item = first; item <= last; item++) convert(block.items[item].runs, `${block.id}:${item}`);
    if (last < block.items.length - 1) {
      flush();
      const rest = block.items.slice(last + 1);
      out.push(make.list({ ordered: block.ordered, start: block.ordered ? block.start + last + 1 : 1, marker: block.marker, loose: block.loose, items: rest.map((r) => r.runs) }));
    }
  }
  flush();

  const original = doc.blocks[si];
  if (original.sep !== undefined && out[0] && out[0].sep === undefined) out[0] = { ...out[0], sep: original.sep };
  let blocks = [...doc.blocks.slice(0, si), ...out, ...doc.blocks.slice(ei + 1)];

  // A new list right next to a list of the same kind would be read back as
  // one list anyway: make it one.
  for (let i = Math.max(1, si); i < Math.min(blocks.length, si + out.length + 1); i++) {
    const a = blocks[i - 1];
    const b = blocks[i];
    if (a.type !== 'list' || b.type !== 'list' || a.ordered !== b.ordered || !(created.has(a.id) || created.has(b.id))) continue;
    const joined = /** @type {ListBlock} */ (touch({ ...a, items: [...a.items, ...b.items] }));
    for (const [key, to] of moved) if (to.block === b.id) moved.set(key, { block: a.id, item: to.item + a.items.length });
    if (created.has(b.id)) created.add(a.id);
    blocks = [...blocks.slice(0, i - 1), joined, ...blocks.slice(i + 1)];
    i--;
  }

  /** @param {Pos} pos @returns {Pos} */
  const remap = (pos) => {
    const to = moved.get(`${pos.block}:${pos.item}`);
    return to ? { ...to, offset: pos.offset } : pos;
  };
  return { doc: { ...doc, blocks }, selection: { anchor: remap(selection.anchor), focus: remap(selection.focus) } };
}

/**
 * Inserts a block after the one with the caret (after the whole list, in a
 * list). If the caret is in an empty paragraph, the new block takes its
 * place. A paragraph follows the new block when nothing editable would.
 * @param {Doc} doc
 * @param {Selection} selection
 * @param {Block} block
 * @returns {EditResult}
 */
export function insertBlockAfter(doc, selection, block) {
  const pos = selection.focus;
  const index = blockIndex(doc, pos.block);
  const current = doc.blocks[index];
  const replace = current.type === 'paragraph' && current.runs.length === 0;
  const after = doc.blocks[index + 1];
  const list = [...doc.blocks.slice(0, replace ? index : index + 1), block];
  /** @type {Pos} */
  let next;
  if (after && isTextBlock(after)) {
    next = { block: after.id, item: 0, offset: 0 };
  } else {
    const paragraph = make.paragraph();
    list.push(paragraph);
    next = { block: paragraph.id, item: 0, offset: 0 };
  }
  list.push(...doc.blocks.slice(index + 1));
  return { doc: { ...doc, blocks: list }, selection: caret(next) };
}

/**
 * Removes a block that is not text (image, code, separator, raw). The caret
 * goes to the start of the next text block, or the end of the previous one.
 * @param {Doc} doc
 * @param {string} id
 * @returns {{ doc: Doc, selection: Selection | null }}
 */
export function removeFixedBlock(doc, id) {
  const index = blockIndex(doc, id);
  const blocks = [...doc.blocks.slice(0, index), ...doc.blocks.slice(index + 1)];
  if (blocks[index]) blocks[index] = dropSep(blocks[index]);
  for (let i = index; i < blocks.length; i++) {
    if (isTextBlock(blocks[i])) return { doc: { ...doc, blocks }, selection: caret({ block: blocks[i].id, item: 0, offset: 0 }) };
  }
  for (let i = index - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!isTextBlock(b)) continue;
    const item = b.type === 'list' ? b.items.length - 1 : 0;
    return { doc: { ...doc, blocks }, selection: caret({ block: b.id, item, offset: runsLength(fieldRuns({ ...doc, blocks }, b.id, item)) }) };
  }
  return { doc: { ...doc, blocks }, selection: null };
}

/** @param {Block} block @returns {Block} */
function dropSep(block) {
  const { sep, ...rest } = block;
  return /** @type {Block} */ (rest);
}
