import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../src/markdown/parse.js';
import { checkBlock, serializeMarkdown } from '../src/markdown/serialize.js';
import {
  caret,
  deleteBackward,
  deleteForward,
  deleteSelection,
  insertLineBreak,
  insertParagraph,
  insertPlainText,
  insertText,
  nextBoundary,
  previousBoundary,
} from '../src/model/editing.js';

/** Position in block number `b` (and list item `item`). */
const at = (doc, b, offset, item = 0) => ({ block: doc.blocks[b].id, item, offset });
const md = (result) => serializeMarkdown(result.doc);
/** Where the caret ended up, as [block index, item, offset]. */
const where = ({ doc, selection }) => {
  const { block, item, offset } = selection.focus;
  return [doc.blocks.findIndex((b) => b.id === block), item, offset];
};
/** Every edited block must still serialize to Markdown that parses back to itself. */
const valid = ({ doc }) => doc.blocks.forEach((b) => assert.ok(checkBlock(b).verified, JSON.stringify(b)));

test('typing inserts at the caret and keeps the marks of the previous character', () => {
  const doc = parseMarkdown('Hello **bold** world\n');
  const r = insertText(doc, caret(at(doc, 0, 10)), 'er');
  assert.equal(md(r), 'Hello **bolder** world\n');
  assert.deepEqual(where(r), [0, 0, 12]);
});

test('typing replaces the selection', () => {
  const doc = parseMarkdown('Hello world\n');
  const r = insertText(doc, { anchor: at(doc, 0, 11), focus: at(doc, 0, 6) }, 'there');
  assert.equal(md(r), 'Hello there\n');
});

test('editing one block keeps every other block byte for byte', () => {
  const source = 'First  paragraph,   odd spacing.  \n\n\n* item\n- other list\n\nLast\n';
  const doc = parseMarkdown(source);
  const r = insertText(doc, caret(at(doc, 3, 4)), '!');
  assert.equal(md(r), source.replace('Last', 'Last!'));
});

test('Enter splits a paragraph', () => {
  const doc = parseMarkdown('Hello world\n');
  const r = insertParagraph(doc, caret(at(doc, 0, 5)));
  assert.equal(md(r), 'Hello\n\nworld\n', 'Markdown drops the leading space');
  assert.deepEqual(where(r), [1, 0, 0]);
});

test('Enter at the end of a heading or quote adds a paragraph', () => {
  for (const source of ['## Title\n', '> Quote\n']) {
    const doc = parseMarkdown(source);
    const r = insertParagraph(doc, caret(at(doc, 0, 5)));
    assert.deepEqual(r.doc.blocks.map((b) => b.type), [doc.blocks[0].type, 'paragraph']);
    assert.deepEqual(where(r), [1, 0, 0]);
  }
});

test('Enter in the middle of a heading splits it; at its start adds a paragraph before', () => {
  const doc = parseMarkdown('## Big title\n');
  assert.equal(md(insertParagraph(doc, caret(at(doc, 0, 3)))), '## Big\n\n## title\n');
  const before = insertParagraph(doc, caret(at(doc, 0, 0)));
  assert.deepEqual(before.doc.blocks.map((b) => b.type), ['paragraph', 'heading']);
  assert.deepEqual(where(before), [1, 0, 0]);
});

test('Enter in a list item splits the item', () => {
  const doc = parseMarkdown('* one two\n* three\n');
  const r = insertParagraph(doc, caret(at(doc, 0, 3)));
  assert.equal(md(r), '* one\n* two\n* three\n');
  assert.deepEqual(where(r), [0, 1, 0]);
});

test('Enter on an empty list item leaves the list', () => {
  const end = parseMarkdown('* one\n*\n');
  const out = insertParagraph(end, caret(at(end, 0, 0, 1)));
  assert.deepEqual(out.doc.blocks.map((b) => b.type), ['list', 'paragraph']);
  assert.deepEqual(where(out), [1, 0, 0]);

  const middle = parseMarkdown('1. one\n2.\n3. three\n');
  const split = insertParagraph(middle, caret(at(middle, 0, 0, 1)));
  assert.deepEqual(split.doc.blocks.map((b) => b.type), ['list', 'paragraph', 'list']);
  assert.equal(split.doc.blocks[2].start, 3, 'the second list keeps its numbering');

  const only = parseMarkdown('*\n');
  assert.deepEqual(insertParagraph(only, caret(at(only, 0, 0))).doc.blocks.map((b) => b.type), ['paragraph']);
});

test('Backspace deletes a whole character, not half of it', () => {
  const doc = parseMarkdown('ok 👍🏽\n');
  const r = deleteBackward(doc, caret(at(doc, 0, 7)));
  assert.equal(md(r), 'ok\n');
  const e = parseMarkdown('café\n');
  assert.equal(md(deleteBackward(e, caret(at(e, 0, 5)))), 'caf\n');
});

test('word boundaries skip spaces and punctuation, then one word', () => {
  assert.equal(previousBoundary('hola, mundo  ', 13, 'word'), 6);
  assert.equal(previousBoundary('hola, mundo', 4, 'word'), 0);
  assert.equal(nextBoundary('hola, mundo', 4, 'word'), 11);
  assert.equal(nextBoundary('hola', 0, 'char'), 1);
});

test('Backspace at the start of a paragraph joins the previous block', () => {
  const doc = parseMarkdown('One **two**\n\nthree\n');
  const r = deleteBackward(doc, caret(at(doc, 1, 0)));
  assert.equal(md(r), 'One **two**three\n');
  assert.deepEqual(where(r), [0, 0, 7]);
});

test('Backspace at the start of a paragraph joins the last item of a list', () => {
  const doc = parseMarkdown('* a\n* b\n\nc\n');
  const r = deleteBackward(doc, caret(at(doc, 1, 0)));
  assert.equal(md(r), '* a\n* bc\n');
  assert.deepEqual(where(r), [0, 1, 1]);
});

test('Backspace at the start of a heading or quote turns it into a paragraph', () => {
  for (const source of ['Intro\n\n## Title\n', 'Intro\n\n> Quote\n']) {
    const doc = parseMarkdown(source);
    const r = deleteBackward(doc, caret(at(doc, 1, 0)));
    assert.deepEqual(r.doc.blocks.map((b) => b.type), ['paragraph', 'paragraph']);
    assert.deepEqual(where(r), [1, 0, 0]);
  }
});

test('Backspace at the start of a list item joins the previous item; the first one leaves the list', () => {
  const doc = parseMarkdown('1. a\n2. b\n3. c\n');
  const joined = deleteBackward(doc, caret(at(doc, 0, 0, 1)));
  assert.equal(md(joined), '1. ab\n2. c\n');
  assert.deepEqual(where(joined), [0, 0, 1]);

  const lifted = deleteBackward(doc, caret(at(doc, 0, 0, 0)));
  assert.deepEqual(lifted.doc.blocks.map((b) => b.type), ['paragraph', 'list']);
  assert.equal(md(lifted), 'a\n\n2. b\n3. c\n', 'the rest of the list keeps its numbers');
});

test('Backspace after an image does not delete it, but removes an empty paragraph', () => {
  const doc = parseMarkdown('Text\n\n![Alt](a.webp)\n\nAfter\n');
  const kept = deleteBackward(doc, caret(at(doc, 2, 0)));
  assert.equal(kept.doc, doc, 'nothing changes');

  const empty = insertParagraph(doc, caret(at(doc, 2, 0))); // empty paragraph at index 2
  const r = deleteBackward(empty.doc, caret(at(empty.doc, 2, 0)));
  assert.deepEqual(r.doc.blocks.map((b) => b.type), ['paragraph', 'image', 'paragraph']);
  assert.deepEqual(where(r), [0, 0, 4]);
});

test('Backspace at the very start does nothing', () => {
  const doc = parseMarkdown('Text\n');
  assert.equal(deleteBackward(doc, caret(at(doc, 0, 0))).doc, doc);
});

test('Delete at the end of a field joins the next one', () => {
  const doc = parseMarkdown('One\n\n* two\n* three\n');
  const r = deleteForward(doc, caret(at(doc, 0, 3)));
  assert.equal(md(r), 'Onetwo\n\n* three\n');
  const items = parseMarkdown('* a\n* b\n');
  assert.equal(md(deleteForward(items, caret(at(items, 0, 1, 0)))), '* ab\n');
  const last = parseMarkdown('Last\n');
  assert.equal(deleteForward(last, caret(at(last, 0, 4))).doc, last);
});

test('a selection across blocks removes everything in between, images included', () => {
  const doc = parseMarkdown('Start here\n\n![Alt](a.webp)\n\n```\ncode\n```\n\nand end here\n');
  const r = deleteSelection(doc, { anchor: at(doc, 3, 4), focus: at(doc, 0, 6) });
  assert.equal(md(r), 'Start end here\n');
  assert.deepEqual(where(r), [0, 0, 6]);
});

test('a selection across list items and out of a list', () => {
  const doc = parseMarkdown('1. one\n2. two\n3. three\n4. four\n');
  assert.equal(md(deleteSelection(doc, { anchor: at(doc, 0, 1, 0), focus: at(doc, 0, 2, 2) })), '1. oree\n2. four\n');

  const out = parseMarkdown('Para\n\n1. one\n2. two\n3. three\n');
  const r = deleteSelection(out, { anchor: at(out, 0, 2), focus: at(out, 1, 1, 1) });
  assert.equal(md(r), 'Pawo\n\n3. three\n');
});

test('joining text into a heading turns line breaks into spaces', () => {
  const doc = parseMarkdown('## Title\n\nline\\\nbreak\n');
  const r = deleteForward(doc, caret(at(doc, 0, 5)));
  assert.equal(md(r), '## Titleline break\n');
  valid(r);
});

test('Shift+Enter adds a line break, except in headings', () => {
  const doc = parseMarkdown('ab\n\n## h\n');
  const r = insertLineBreak(doc, caret(at(doc, 0, 1)));
  assert.equal(r.doc.blocks[0].runs[1].type, 'break');
  assert.deepEqual(where(r), [0, 0, 2]);
  valid(r);
  assert.equal(insertLineBreak(doc, caret(at(doc, 1, 1))).doc, doc);
});

test('pasting plain text: blank lines make paragraphs, single line breaks make spaces', () => {
  const doc = parseMarkdown('AB\n');
  const r = insertPlainText(doc, caret(at(doc, 0, 1)), 'one\ntwo\r\n\r\nthree');
  assert.equal(md(r), 'Aone two\n\nthreeB\n');
  assert.deepEqual(where(r), [1, 0, 5]);
});

test('text typed into a new paragraph serializes with the house style', () => {
  let r = { doc: parseMarkdown('Intro\n'), selection: null };
  r.selection = caret(at(r.doc, 0, 5));
  r = insertParagraph(r.doc, r.selection);
  r = insertText(r.doc, r.selection, '*not* a list, 1. not a number');
  assert.equal(md(r), 'Intro\n\n\\*not\\* a list, 1. not a number\n');
  valid(r);
});
