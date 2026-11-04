import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMark, deleteRange, hasMark, insertText, marksAt, normalizeRuns, plainText, text, toggleMark } from '../src/model/inline.js';
import { blocks, convertBlock, createDocument, moveBlock, updateBlock } from '../src/model/document.js';
import { createHistory, push, redo, undo } from '../src/model/history.js';
import { parseMarkdown } from '../src/markdown/parse.js';

test('bold over a selection splits runs and merges them back', () => {
  let runs = [text('Hello brave world')];
  runs = addMark(runs, 6, 11, 'strong');
  assert.deepEqual(runs, [text('Hello '), text('brave', { strong: true }), text(' world')]);
  runs = toggleMark(runs, 6, 11, 'strong');
  assert.deepEqual(runs, [text('Hello brave world')]);
});

test('toggle adds the mark when only part of the range has it', () => {
  const runs = addMark([text('abcdef')], 0, 3, 'em');
  assert.equal(hasMark(runs, 0, 6, 'em'), false);
  assert.deepEqual(toggleMark(runs, 0, 6, 'em'), [text('abcdef', { em: true })]);
});

test('typing continues the marks before the caret, except code and links', () => {
  const runs = [text('bold', { strong: true }), text(' code', { code: true })];
  assert.deepEqual(marksAt(runs, 4), { strong: true });
  assert.deepEqual(insertText(runs, 4, '!'), [text('bold!', { strong: true }), text(' code', { code: true })]);
  assert.deepEqual(marksAt(runs, 9), {});
});

test('delete across runs', () => {
  const runs = [text('ab'), text('cd', { em: true }), text('ef')];
  assert.deepEqual(deleteRange(runs, 1, 5), [text('af')]);
  assert.equal(plainText(normalizeRuns(runs)), 'abcdef');
});

test('editing a block drops its source snapshot, its neighbours keep theirs', () => {
  const doc = parseMarkdown('One.\n\nTwo.\n');
  const edited = updateBlock(doc, doc.blocks[0].id, { runs: [text('Uno.')] });
  assert.equal(edited.blocks[0].raw, undefined);
  assert.equal(edited.blocks[1].raw, 'Two.');
  assert.equal(edited.blocks[1], doc.blocks[1]);
});

test('convert a paragraph to a heading and a list into paragraphs', () => {
  let doc = createDocument({ blocks: [blocks.paragraph([text('Title')]), blocks.list({ items: [[text('a')], [text('b')]] })] });
  doc = convertBlock(doc, doc.blocks[0].id, 'heading', { level: 3 });
  doc = convertBlock(doc, doc.blocks[1].id, 'paragraph');
  assert.deepEqual(
    doc.blocks.map((b) => [b.type, plainText(b.runs)]),
    [['heading', 'Title'], ['paragraph', 'a'], ['paragraph', 'b']],
  );
});

test('moving a block resets the separators around it', () => {
  const doc = parseMarkdown('A.\n\nB.\n\nC.\n');
  const moved = moveBlock(doc, doc.blocks[2].id, 0);
  assert.deepEqual(moved.blocks.map((b) => b.raw), ['C.', 'A.', 'B.']);
  assert.equal(moved.blocks[0].sep, undefined);
  assert.equal(moved.blocks[1].sep, undefined);
});

test('undo/redo, with typing grouped into one step', () => {
  let h = createHistory('a');
  h = push(h, 'ab', { group: 'typing:b1' });
  h = push(h, 'abc', { group: 'typing:b1' });
  h = push(h, 'abc!');
  assert.equal(h.present, 'abc!');
  h = undo(h);
  assert.equal(h.present, 'abc');
  h = undo(h);
  assert.equal(h.present, 'a');
  h = redo(h);
  assert.equal(h.present, 'abc');
});
