// @ts-check
/**
 * Editing commands: what typing, Enter, Backspace and Delete do to a
 * document. Pure functions over the immutable model, no DOM, so every key
 * the editor handles is tested in Node.
 *
 * Text lives in fields: the inline content of a paragraph, a heading or a
 * quote, or one item of a list. A position is a field plus a character
 * offset in it (offsets as in inline.js: atoms count as one). Other blocks
 * (code, image, separator, raw) are not fields: the caret never enters them,
 * and they are only removed when a selection spans across them.
 *
 * Every command takes the document and a selection and returns the new
 * document and selection. When nothing changes it returns the same document
 * object, so the history does not record an empty step.
 */

import { blockIndex, blocks as make, convertBlock, insertBlock, removeBlock, updateBlock } from './document.js';
import { deleteRange, insertText as insertRuns, normalizeRuns, runsLength, splitRuns } from './inline.js';

/**
 * @typedef {import('./document.js').Doc} Doc
 * @typedef {import('./document.js').Block} Block
 * @typedef {import('./document.js').ListBlock} ListBlock
 * @typedef {import('./document.js').ListItem} ListItem
 * @typedef {import('./inline.js').Run} Run
 * @typedef {{ block: string, item: number, offset: number }} Pos item is 0 except in lists
 * @typedef {{ anchor: Pos, focus: Pos }} Selection
 * @typedef {{ doc: Doc, selection: Selection }} EditResult
 * @typedef {'char' | 'word'} Unit
 */

/** @param {Block} block */
export function isTextBlock(block) {
  return block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' || block.type === 'list';
}

/** @param {Pos} pos @returns {Selection} */
export function caret(pos) {
  return { anchor: pos, focus: pos };
}

/** @param {Selection} sel */
export function isCollapsed(sel) {
  return samePos(sel.anchor, sel.focus);
}

/** @param {Pos} a @param {Pos} b */
function samePos(a, b) {
  return a.block === b.block && a.item === b.item && a.offset === b.offset;
}

/**
 * @param {Doc} doc
 * @param {Pos} a
 * @param {Pos} b
 */
export function comparePos(doc, a, b) {
  return blockIndex(doc, a.block) - blockIndex(doc, b.block) || a.item - b.item || a.offset - b.offset;
}

/**
 * @param {Doc} doc
 * @param {Selection} sel
 * @returns {[Pos, Pos]}
 */
function ordered(doc, sel) {
  return comparePos(doc, sel.anchor, sel.focus) <= 0 ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
}

/**
 * @param {Doc} doc
 * @param {string} id
 * @param {number} item
 * @returns {Run[]}
 */
export function fieldRuns(doc, id, item) {
  const block = doc.blocks[blockIndex(doc, id)];
  if (block.type === 'list') return block.items[item].runs;
  if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote') return block.runs;
  throw new Error(`A ${block.type} block has no text field`);
}

/**
 * The nearest text position from block `index` on, going forwards (start of
 * a field) or backwards (end of a field). Null when there is none.
 * @param {Doc} doc
 * @param {number} index
 * @param {1 | -1} step
 * @returns {Pos | null}
 */
function nearestField(doc, index, step) {
  for (let i = index; i >= 0 && i < doc.blocks.length; i += step) {
    const b = doc.blocks[i];
    if (!isTextBlock(b)) continue;
    if (step > 0) return { block: b.id, item: 0, offset: 0 };
    const item = b.type === 'list' ? b.items.length - 1 : 0;
    return { block: b.id, item, offset: runsLength(fieldRuns(doc, b.id, item)) };
  }
  return null;
}

/**
 * Headings are one line: line breaks become spaces.
 * @param {Block} block
 * @param {Run[]} runs
 * @returns {Run[]}
 */
function fit(block, runs) {
  if (block.type !== 'heading') return normalizeRuns(runs);
  return normalizeRuns(
    runs.map((r) =>
      /** @type {Run} */ (r.type === 'break' ? { type: 'text', text: ' ', marks: {} } : r.type === 'text' ? { ...r, text: r.text.replace(/\n/g, ' ') } : r),
    ),
  );
}

/**
 * @param {Doc} doc
 * @param {string} id
 * @param {number} item
 * @param {Run[]} runs
 * @returns {Doc}
 */
function setField(doc, id, item, runs) {
  const block = doc.blocks[blockIndex(doc, id)];
  if (block.type === 'list') {
    return updateBlock(doc, id, { items: block.items.map((it, i) => (i === item ? { runs: normalizeRuns(runs) } : it)) });
  }
  return updateBlock(doc, id, { runs: fit(block, runs) });
}

/**
 * Patch that drops the first `n` items of a list, keeping the numbering of
 * the rest.
 * @param {ListBlock} list
 * @param {number} n
 */
function dropLeadingItems(list, n) {
  return { items: list.items.slice(n), start: list.ordered ? list.start + n : list.start };
}

/**
 * @param {Doc} doc
 * @param {Selection} selection
 * @returns {EditResult}
 */
export function deleteSelection(doc, selection) {
  const [s, e] = ordered(doc, selection);
  if (s.block === e.block && s.item === e.item) {
    if (s.offset === e.offset) return { doc, selection: caret(s) };
    const runs = deleteRange(fieldRuns(doc, s.block, s.item), s.offset, e.offset);
    return { doc: setField(doc, s.block, s.item, runs), selection: caret(s) };
  }

  const merged = [...splitRuns(fieldRuns(doc, s.block, s.item), s.offset)[0], ...splitRuns(fieldRuns(doc, e.block, e.item), e.offset)[1]];
  const si = blockIndex(doc, s.block);
  const ei = blockIndex(doc, e.block);
  const start = doc.blocks[si];
  const end = doc.blocks[ei];

  if (si === ei) {
    const list = /** @type {ListBlock} */ (start);
    const items = [...list.items.slice(0, s.item), { runs: normalizeRuns(merged) }, ...list.items.slice(e.item + 1)];
    return { doc: updateBlock(doc, list.id, { items }), selection: caret(s) };
  }

  let next = doc;
  for (const b of doc.blocks.slice(si + 1, ei)) next = removeBlock(next, b.id);
  if (end.type === 'list' && e.item < end.items.length - 1) next = updateBlock(next, end.id, dropLeadingItems(end, e.item + 1));
  else next = removeBlock(next, end.id);
  if (start.type === 'list') {
    next = updateBlock(next, start.id, { items: [...start.items.slice(0, s.item), { runs: normalizeRuns(merged) }] });
  } else {
    next = setField(next, start.id, 0, merged);
  }
  return { doc: next, selection: caret(s) };
}

/**
 * Typing. Replaces the selection; the new text takes the marks of the
 * character before the caret (see marksAt).
 * @param {Doc} doc
 * @param {Selection} selection
 * @param {string} text
 * @returns {EditResult}
 */
export function insertText(doc, selection, text) {
  const cleared = deleteSelection(doc, selection);
  if (text === '') return cleared;
  const pos = cleared.selection.focus;
  const runs = insertRuns(fieldRuns(cleared.doc, pos.block, pos.item), pos.offset, text);
  return {
    doc: setField(cleared.doc, pos.block, pos.item, runs),
    selection: caret({ ...pos, offset: pos.offset + text.length }),
  };
}

/**
 * Plain text with line breaks (a paste): blank lines start new blocks, single
 * line breaks become spaces, as Markdown would render them.
 * @param {Doc} doc
 * @param {Selection} selection
 * @param {string} text
 * @returns {EditResult}
 */
export function insertPlainText(doc, selection, text) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n\s*/)
    .map((p) => p.replace(/\s*\n\s*/g, ' '));
  let result = insertText(doc, selection, paragraphs[0]);
  for (const p of paragraphs.slice(1)) {
    result = insertParagraph(result.doc, result.selection);
    result = insertText(result.doc, result.selection, p);
  }
  return result;
}

/**
 * Enter.
 *  - Paragraph: splits it in two.
 *  - Heading or quote: splits it in two of the same type; at the end it
 *    adds an empty paragraph after it, at the start one before it.
 *  - List item: splits the item. On an empty item, leaves the list: the item
 *    becomes a paragraph (splitting the list in two if needed).
 * @param {Doc} doc
 * @param {Selection} selection
 * @returns {EditResult}
 */
export function insertParagraph(doc, selection) {
  const cleared = deleteSelection(doc, selection);
  const d = cleared.doc;
  const pos = cleared.selection.focus;
  const index = blockIndex(d, pos.block);
  const block = d.blocks[index];
  const runs = fieldRuns(d, pos.block, pos.item);
  const [left, right] = splitRuns(runs, pos.offset);

  if (block.type === 'list') {
    if (runs.length === 0) return leaveList(d, block, index, pos.item);
    const items = [
      ...block.items.slice(0, pos.item),
      { runs: normalizeRuns(left) },
      { runs: normalizeRuns(right) },
      ...block.items.slice(pos.item + 1),
    ];
    return { doc: updateBlock(d, block.id, { items }), selection: caret({ block: block.id, item: pos.item + 1, offset: 0 }) };
  }

  if (block.type !== 'paragraph' && left.length === 0 && right.length > 0) {
    return { doc: insertBlock(d, index, make.paragraph()), selection: caret(pos) };
  }
  /** @type {Block} */
  let created;
  if (block.type === 'paragraph' || right.length === 0) created = make.paragraph(right);
  else if (block.type === 'heading') created = make.heading(block.level, right);
  else created = make.quote(right);
  const next = insertBlock(setField(d, block.id, 0, left), index + 1, created);
  return { doc: next, selection: caret({ block: created.id, item: 0, offset: 0 }) };
}

/**
 * Enter on an empty list item.
 * @param {Doc} doc
 * @param {ListBlock} list
 * @param {number} index
 * @param {number} item
 * @returns {EditResult}
 */
function leaveList(doc, list, index, item) {
  const before = list.items.slice(0, item);
  const after = list.items.slice(item + 1);
  if (!before.length && !after.length) {
    const next = convertBlock(doc, list.id, 'paragraph');
    return { doc: next, selection: caret({ block: next.blocks[index].id, item: 0, offset: 0 }) };
  }
  const paragraph = make.paragraph();
  let next;
  if (!before.length) {
    next = insertBlock(updateBlock(doc, list.id, dropLeadingItems(list, 1)), index, paragraph);
  } else {
    next = insertBlock(updateBlock(doc, list.id, { items: before }), index + 1, paragraph);
    if (after.length) {
      const rest = make.list({
        ordered: list.ordered,
        start: list.start + item + 1,
        marker: list.marker,
        loose: list.loose,
        items: after.map((i) => i.runs),
      });
      next = insertBlock(next, index + 2, rest);
    }
  }
  return { doc: next, selection: caret({ block: paragraph.id, item: 0, offset: 0 }) };
}

/**
 * Shift+Enter: a line break inside the block. Headings are one line, so
 * there it does nothing.
 * @param {Doc} doc
 * @param {Selection} selection
 * @returns {EditResult}
 */
export function insertLineBreak(doc, selection) {
  const [s] = ordered(doc, selection);
  if (doc.blocks[blockIndex(doc, s.block)].type === 'heading') return { doc, selection };
  const cleared = deleteSelection(doc, selection);
  const pos = cleared.selection.focus;
  const [left, right] = splitRuns(fieldRuns(cleared.doc, pos.block, pos.item), pos.offset);
  /** @type {Run} */
  const br = { type: 'break', marks: {} };
  return {
    doc: setField(cleared.doc, pos.block, pos.item, [...left, br, ...right]),
    selection: caret({ ...pos, offset: pos.offset + 1 }),
  };
}

/**
 * The field as a string with one character per offset (atoms become U+FFFC),
 * to find character and word boundaries.
 * @param {Run[]} runs
 */
function fieldString(runs) {
  return runs.map((r) => (r.type === 'text' ? r.text : r.type === 'break' ? '\n' : '￼')).join('');
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/**
 * Where Backspace (unit char) or Ctrl+Backspace (unit word) stops.
 * @param {string} str
 * @param {number} offset
 * @param {Unit} unit
 */
export function previousBoundary(str, offset, unit) {
  const segments = [...(unit === 'word' ? words : graphemes).segment(str)].filter((s) => s.index < offset);
  if (unit === 'char') return segments.length ? segments[segments.length - 1].index : 0;
  let i = segments.length - 1;
  while (i >= 0 && !segments[i].isWordLike) i--;
  return i >= 0 ? segments[i].index : 0;
}

/**
 * Where Delete (unit char) or Ctrl+Delete (unit word) stops.
 * @param {string} str
 * @param {number} offset
 * @param {Unit} unit
 */
export function nextBoundary(str, offset, unit) {
  const segments = [...(unit === 'word' ? words : graphemes).segment(str)].filter((s) => s.index + s.segment.length > offset);
  if (unit === 'char') return segments.length ? segments[0].index + segments[0].segment.length : str.length;
  let i = 0;
  while (i < segments.length && !segments[i].isWordLike) i++;
  return i < segments.length ? segments[i].index + segments[i].segment.length : str.length;
}

/**
 * Backspace.
 * @param {Doc} doc
 * @param {Selection} selection
 * @param {Unit} [unit]
 * @returns {EditResult}
 */
export function deleteBackward(doc, selection, unit = 'char') {
  if (!isCollapsed(selection)) return deleteSelection(doc, selection);
  const pos = selection.focus;
  if (pos.offset > 0) {
    const from = previousBoundary(fieldString(fieldRuns(doc, pos.block, pos.item)), pos.offset, unit);
    return deleteSelection(doc, { anchor: { ...pos, offset: from }, focus: pos });
  }
  return joinBackward(doc, pos);
}

/**
 * Delete (the forward one).
 * @param {Doc} doc
 * @param {Selection} selection
 * @param {Unit} [unit]
 * @returns {EditResult}
 */
export function deleteForward(doc, selection, unit = 'char') {
  if (!isCollapsed(selection)) return deleteSelection(doc, selection);
  const pos = selection.focus;
  const runs = fieldRuns(doc, pos.block, pos.item);
  if (pos.offset < runsLength(runs)) {
    const to = nextBoundary(fieldString(runs), pos.offset, unit);
    return deleteSelection(doc, { anchor: pos, focus: { ...pos, offset: to } });
  }
  return joinForward(doc, pos);
}

/**
 * Backspace at the start of a field.
 *  - List item: joins the previous item; the first item leaves the list
 *    as a paragraph.
 *  - Heading or quote: becomes a paragraph.
 *  - Paragraph: joins the end of the previous text block. After a block
 *    that is not text (image, code...) it does nothing, unless the paragraph
 *    is empty: then it is removed.
 * @param {Doc} doc
 * @param {Pos} pos
 * @returns {EditResult}
 */
function joinBackward(doc, pos) {
  const index = blockIndex(doc, pos.block);
  const block = doc.blocks[index];
  const unchanged = { doc, selection: caret(pos) };

  if (block.type === 'list') {
    if (pos.item > 0) {
      const prev = block.items[pos.item - 1].runs;
      const items = [
        ...block.items.slice(0, pos.item - 1),
        { runs: normalizeRuns([...prev, ...block.items[pos.item].runs]) },
        ...block.items.slice(pos.item + 1),
      ];
      return { doc: updateBlock(doc, block.id, { items }), selection: caret({ block: block.id, item: pos.item - 1, offset: runsLength(prev) }) };
    }
    if (block.items.length === 1) {
      const next = convertBlock(doc, block.id, 'paragraph');
      return { doc: next, selection: caret({ block: next.blocks[index].id, item: 0, offset: 0 }) };
    }
    const paragraph = make.paragraph(block.items[0].runs);
    const next = insertBlock(updateBlock(doc, block.id, dropLeadingItems(block, 1)), index, paragraph);
    return { doc: next, selection: caret({ block: paragraph.id, item: 0, offset: 0 }) };
  }

  if (block.type === 'heading' || block.type === 'quote') {
    const next = convertBlock(doc, block.id, 'paragraph');
    return { doc: next, selection: caret({ block: next.blocks[index].id, item: 0, offset: 0 }) };
  }

  if (block.type !== 'paragraph' || index === 0) return unchanged;
  const prev = doc.blocks[index - 1];
  if (isTextBlock(prev)) {
    const item = prev.type === 'list' ? prev.items.length - 1 : 0;
    const prevRuns = fieldRuns(doc, prev.id, item);
    const next = removeBlock(setField(doc, prev.id, item, [...prevRuns, ...block.runs]), block.id);
    return { doc: next, selection: caret({ block: prev.id, item, offset: runsLength(prevRuns) }) };
  }
  if (block.runs.length === 0) {
    const target = nearestField(doc, index - 1, -1) ?? nearestField(doc, index + 1, 1);
    if (target) return { doc: removeBlock(doc, block.id), selection: caret(target) };
  }
  return unchanged;
}

/**
 * Delete at the end of a field: joins the next list item, or the first field
 * of the next block when it is text.
 * @param {Doc} doc
 * @param {Pos} pos
 * @returns {EditResult}
 */
function joinForward(doc, pos) {
  const index = blockIndex(doc, pos.block);
  const block = doc.blocks[index];
  const runs = fieldRuns(doc, pos.block, pos.item);
  const unchanged = { doc, selection: caret(pos) };

  if (block.type === 'list' && pos.item < block.items.length - 1) {
    const items = [
      ...block.items.slice(0, pos.item),
      { runs: normalizeRuns([...runs, ...block.items[pos.item + 1].runs]) },
      ...block.items.slice(pos.item + 2),
    ];
    return { doc: updateBlock(doc, block.id, { items }), selection: caret(pos) };
  }
  const following = doc.blocks[index + 1];
  if (!following || !isTextBlock(following)) return unchanged;
  const taken = following.type === 'list' ? following.items[0].runs : fieldRuns(doc, following.id, 0);
  let next = setField(doc, block.id, pos.item, [...runs, ...taken]);
  if (following.type === 'list' && following.items.length > 1) next = updateBlock(next, following.id, dropLeadingItems(following, 1));
  else next = removeBlock(next, following.id);
  return { doc: next, selection: caret(pos) };
}
