import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../src/markdown/parse.js';
import { checkBlock, serializeMarkdown } from '../src/markdown/serialize.js';
import { blocks } from '../src/model/document.js';
import { caret } from '../src/model/editing.js';
import {
  activeMarks,
  blockKindAt,
  insertBlockAfter,
  linkAt,
  normalizeHref,
  removeFixedBlock,
  removeLink,
  setBlockType,
  setLink,
  toggleMark,
} from '../src/model/formatting.js';

const at = (doc, b, offset, item = 0) => ({ block: doc.blocks[b].id, item, offset });
const range = (doc, [b1, o1, i1 = 0], [b2, o2, i2 = 0]) => ({ anchor: at(doc, b1, o1, i1), focus: at(doc, b2, o2, i2) });
const md = (r) => serializeMarkdown(r.doc);
const types = (r) => r.doc.blocks.map((b) => (b.type === 'heading' ? `h${b.level}` : b.type === 'list' ? (b.ordered ? 'ol' : 'ul') : b.type));
const valid = (r) => r.doc.blocks.forEach((b) => assert.ok(checkBlock(b).verified, JSON.stringify(b)));
/** Text of the field a position points to, from its offset: checks a remapped selection. */
const textFrom = (doc, pos) => {
  const b = doc.blocks.find((x) => x.id === pos.block);
  const runs = b.type === 'list' ? b.items[pos.item].runs : b.runs;
  return runs.map((r) => r.text ?? '').join('').slice(pos.offset);
};

test('bold toggles on a selection, and off when all of it is bold', () => {
  const doc = parseMarkdown('Some plain text\n');
  const on = toggleMark(doc, range(doc, [0, 5], [0, 10]), 'strong');
  assert.equal(md(on), 'Some **plain** text\n');
  const off = toggleMark(on.doc, range(on.doc, [0, 5], [0, 10]), 'strong');
  assert.equal(md(off), 'Some plain text\n');
});

test('a mark across blocks applies to each part', () => {
  const doc = parseMarkdown('one two\n\n* three\n* four five\n');
  const r = toggleMark(doc, range(doc, [0, 4], [1, 4, 1]), 'em');
  assert.equal(md(r), 'one *two*\n\n* *three*\n* *four* five\n');
  valid(r);
});

test('partly bold selection becomes all bold first', () => {
  const doc = parseMarkdown('a **b** c\n');
  assert.equal(md(toggleMark(doc, range(doc, [0, 0], [0, 5]), 'strong')), '**a b c**\n');
});

test('a collapsed selection does not change the document', () => {
  const doc = parseMarkdown('text\n');
  assert.equal(toggleMark(doc, caret(at(doc, 0, 2)), 'strong').doc, doc);
});

test('active marks at a caret and over a range', () => {
  const doc = parseMarkdown('a **bold** and [link](https://x.y)\n');
  assert.deepEqual(activeMarks(doc, caret(at(doc, 0, 4))), { strong: true, em: false, code: false, link: null });
  assert.deepEqual(activeMarks(doc, range(doc, [0, 0], [0, 6])), { strong: false, em: false, code: false, link: null });
  assert.equal(activeMarks(doc, caret(at(doc, 0, 13))).link, 'https://x.y');
  assert.equal(activeMarks(doc, range(doc, [0, 11], [0, 15])).link, 'https://x.y');
});

test('setting a link on a selection, and changing it from the caret', () => {
  const doc = parseMarkdown('see the docs here\n');
  const linked = setLink(doc, range(doc, [0, 8], [0, 12]), 'https://example.com');
  assert.equal(md(linked), 'see the [docs](https://example.com) here\n');
  const changed = setLink(linked.doc, caret(at(linked.doc, 0, 10)), 'https://other.org');
  assert.equal(md(changed), 'see the [docs](https://other.org) here\n');
  const removed = removeLink(changed.doc, caret(at(changed.doc, 0, 10)));
  assert.equal(md(removed), 'see the docs here\n');
});

test('linkAt finds the whole link, across differently marked runs', () => {
  const doc = parseMarkdown('x [a **b** c](https://u.v) y\n');
  assert.deepEqual(linkAt(doc, at(doc, 0, 3)), { from: 2, to: 7, href: 'https://u.v' });
  assert.equal(linkAt(doc, at(doc, 0, 0)), null);
});

test('link addresses: web, mail and relative only', () => {
  assert.equal(normalizeHref(' https://example.com/a?b#c '), 'https://example.com/a?b#c');
  assert.equal(normalizeHref('example.com/page'), 'https://example.com/page');
  assert.equal(normalizeHref('mailto:yo@example.com'), 'mailto:yo@example.com');
  assert.equal(normalizeHref('/es/otro-post/'), '/es/otro-post/');
  assert.equal(normalizeHref('#seccion'), '#seccion');
  for (const bad of ['javascript:alert(1)', 'JavaScript:x', 'data:text/html,x', 'vbscript:x', 'not a url', '', 'http://']) {
    assert.equal(normalizeHref(bad), null, bad);
  }
});

test('paragraph to heading and back, keeping the caret', () => {
  const doc = parseMarkdown('Intro\n\nTitle\n');
  const h = setBlockType(doc, caret(at(doc, 1, 2)), { type: 'heading', level: 2 });
  assert.equal(md(h), 'Intro\n\n## Title\n');
  assert.equal(textFrom(h.doc, h.selection.focus), 'tle');
  assert.deepEqual(blockKindAt(h.doc, h.selection), { type: 'heading', level: 2 });
  const back = setBlockType(h.doc, h.selection, { type: 'heading', level: 2 });
  assert.equal(md(back), 'Intro\n\nTitle\n', 'pressing the same type again goes back to paragraph');
});

test('several paragraphs become one list, and back', () => {
  const doc = parseMarkdown('one\n\ntwo\n\nthree\n');
  const list = setBlockType(doc, range(doc, [0, 1], [2, 2]), { type: 'list', ordered: false });
  assert.equal(md(list), '* one\n* two\n* three\n');
  assert.equal(textFrom(list.doc, list.selection.focus), 'ree');
  const back = setBlockType(list.doc, list.selection, { type: 'list', ordered: false });
  assert.deepEqual(types(back), ['paragraph', 'paragraph', 'paragraph']);
});

test('only the selected items of a list change type; the list is split around them', () => {
  const doc = parseMarkdown('1. a\n2. b\n3. c\n4. d\n');
  const r = setBlockType(doc, range(doc, [0, 0, 1], [0, 1, 2]), { type: 'paragraph' });
  assert.deepEqual(types(r), ['ol', 'paragraph', 'paragraph', 'ol']);
  assert.equal(r.doc.blocks[3].start, 4, 'the rest keeps its numbers');
  valid(r);
});

test('a paragraph next to a list of the same kind joins it', () => {
  const doc = parseMarkdown('* a\n* b\n\nc\n');
  const r = setBlockType(doc, caret(at(doc, 1, 0)), { type: 'list', ordered: false });
  assert.deepEqual(types(r), ['ul']);
  assert.equal(r.doc.blocks[0].items.length, 3);
  assert.deepEqual(r.selection.focus, { block: r.doc.blocks[0].id, item: 2, offset: 0 });
});

test('blocks that are not text stay where they are', () => {
  const doc = parseMarkdown('a\n\n![i](x.webp)\n\nb\n');
  const r = setBlockType(doc, range(doc, [0, 0], [2, 1]), { type: 'list', ordered: true });
  assert.deepEqual(types(r), ['ol', 'image', 'ol']);
});

test('headings turn line breaks into spaces', () => {
  const doc = parseMarkdown('line\\\nbreak\n');
  const r = setBlockType(doc, caret(at(doc, 0, 0)), { type: 'heading', level: 3 });
  assert.equal(md(r), '### line break\n');
});

test('inserting a block after the caret block, or in place of an empty paragraph', () => {
  const doc = parseMarkdown('text\n\n* a\n* b\n');
  const r = insertBlockAfter(doc, caret(at(doc, 1, 0, 0)), blocks.hr());
  assert.deepEqual(types(r), ['paragraph', 'ul', 'hr', 'paragraph'], 'after the whole list, with a paragraph to keep writing');
  assert.equal(r.selection.focus.block, r.doc.blocks[3].id);

  const empty = parseMarkdown('text\n\n\n');
  const withEmpty = { ...empty, blocks: [...empty.blocks, blocks.paragraph()] };
  const c = insertBlockAfter(withEmpty, caret({ block: withEmpty.blocks[1].id, item: 0, offset: 0 }), blocks.code('js', ''));
  assert.deepEqual(types(c), ['paragraph', 'code', 'paragraph']);

  const before = parseMarkdown('one\n\ntwo\n');
  const d = insertBlockAfter(before, caret(at(before, 0, 3)), blocks.hr());
  assert.deepEqual(types(d), ['paragraph', 'hr', 'paragraph']);
  assert.equal(d.selection.focus.block, before.blocks[1].id, 'the caret goes to the existing next paragraph');
});

test('removing an image or a code block', () => {
  const doc = parseMarkdown('a\n\n![i](x.webp)\n\nb\n');
  const r = removeFixedBlock(doc, doc.blocks[1].id);
  assert.equal(md(r), 'a\n\nb\n');
  assert.equal(r.selection.focus.block, doc.blocks[2].id);
  const last = parseMarkdown('a\n\n```\nx\n```\n');
  const r2 = removeFixedBlock(last, last.blocks[1].id);
  assert.deepEqual(r2.selection.focus, { block: last.blocks[0].id, item: 0, offset: 1 });
});
