import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../src/markdown/parse.js';
import { checkBlock, serializeMarkdown } from '../src/markdown/serialize.js';
import { createDocument } from '../src/model/document.js';
import { caret, insertBlocks } from '../src/model/editing.js';
import { htmlToBlocks } from '../src/model/from-html.js';

/** Fake element: el('p', { class: 'x' }, 'text', el('b', {}, 'bold')) */
const el = (tag, attrs = {}, ...children) => ({
  nodeType: 1,
  nodeName: tag.toUpperCase(),
  childNodes: children.map((c) => (typeof c === 'string' ? { nodeType: 3, nodeName: '#text', data: c, childNodes: [] } : c)),
  getAttribute: (name) => (name in attrs ? attrs[name] : null),
});
const body = (...children) => el('body', {}, ...children);
/** The pasted blocks as Markdown, to read the tests easily. */
const md = (root) => serializeMarkdown(createDocument({ blocks: htmlToBlocks(root).blocks }));

test('paragraphs, headings and inline marks', () => {
  const html = body(
    el('h1', {}, 'Title'),
    el('p', {}, 'Some ', el('strong', {}, 'bold'), ' and ', el('em', {}, 'italic'), ' and ', el('code', {}, 'code'), '.'),
    el('h3', {}, 'Sub'),
  );
  assert.equal(md(html), '## Title\n\nSome **bold** and *italic* and `code`.\n\n### Sub\n');
});

test('whitespace collapses like in a browser', () => {
  assert.equal(md(body(el('p', {}, '\n   lots   of\n  space  ', el('b', {}, ' here '), ' \n'))), 'lots of space **here**\n');
});

test('links keep only safe addresses', () => {
  const html = body(el('p', {}, el('a', { href: 'https://x.y/z' }, 'ok'), ' ', el('a', { href: 'javascript:alert(1)' }, 'bad')));
  assert.equal(md(html), '[ok](https://x.y/z) bad\n');
});

test('lists, nested items flattened, and start numbers', () => {
  const html = body(
    el('ul', {}, el('li', {}, 'one'), el('li', {}, 'two', el('ul', {}, el('li', {}, 'two.a'))), el('li', {}, el('p', {}, 'three'))),
    el('ol', { start: '4' }, el('li', {}, 'four'), el('li', {}, 'five')),
  );
  assert.equal(md(html), '* one\n* two\n* two.a\n* three\n\n4. four\n5. five\n');
});

test('quotes, code blocks with language, separators and line breaks', () => {
  const html = body(
    el('blockquote', {}, el('p', {}, 'Quoted ', el('i', {}, 'text'))),
    el('pre', {}, el('code', { class: 'language-sh' }, 'ls -la\n  cd x\n')),
    el('hr'),
    el('p', {}, 'line', el('br'), 'break'),
  );
  assert.equal(md(html), '> Quoted *text*\n\n```sh\nls -la\n  cd x\n```\n\n---\n\nline\\\nbreak\n');
});

test('images, scripts, styles and the editor controls are dropped', () => {
  const html = body(
    el('style', {}, 'p { color: red }'),
    el('p', {}, 'a', el('img', { src: 'https://x/y.png', alt: 'y' }), 'b'),
    el('script', {}, 'alert(1)'),
    el('figure', {}, el('img', { src: 'blob:z' }), el('input', { 'data-control': 'alt', value: 'z' })),
    el('p', {}, 'c', el('span', { 'data-atom': '' }, 'Imagen no cargada: x')),
  );
  const result = htmlToBlocks(html);
  assert.equal(result.skippedImages, 2);
  assert.equal(serializeMarkdown(createDocument({ blocks: result.blocks })), 'ab\n\nc\n');
});

test('Google Docs: the normal-weight <b> wrapper is not bold, styled spans are', () => {
  const html = body(
    el(
      'b',
      { style: 'font-weight:normal;', id: 'docs-internal-guid-1' },
      el('p', {}, el('span', { style: 'font-weight:400' }, 'Plain '), el('span', { style: 'font-weight:700' }, 'bold'), el('span', { style: 'font-style:italic' }, ' it')),
      el('p', {}, el('span', {}, 'Second')),
    ),
  );
  assert.equal(md(html), 'Plain **bold** *it*\n\nSecond\n');
});

test('loose inline content and table cells become paragraphs', () => {
  const html = body('loose text', el('div', {}, 'in a div'), el('table', {}, el('tr', {}, el('td', {}, 'a'), el('td', {}, 'b'))));
  assert.equal(md(html), 'loose text\n\nin a div\n\na\n\nb\n');
});

test('every pasted block serializes to verified Markdown', () => {
  const html = body(el('p', {}, '*not italic* 1. not a list # not a heading'), el('h2', {}, '**x**'));
  for (const b of htmlToBlocks(html).blocks) assert.ok(checkBlock(b).verified);
});

// insertBlocks

const at = (doc, b, offset, item = 0) => ({ block: doc.blocks[b].id, item, offset });
const pasteMd = (source, pos, html) => {
  const doc = parseMarkdown(source);
  const r = insertBlocks(doc, caret(pos(doc)), htmlToBlocks(html).blocks);
  return { md: serializeMarkdown(r.doc), r };
};
const where = ({ doc, selection }) => [doc.blocks.findIndex((b) => b.id === selection.focus.block), selection.focus.item, selection.focus.offset];

test('pasting one paragraph goes into the line, with its marks', () => {
  const { md: out, r } = pasteMd('Hello world\n', (d) => at(d, 0, 6), body(el('p', {}, el('b', {}, 'big'), ' new ')));
  assert.equal(out, 'Hello **big** newworld\n', 'trailing spaces of a pasted block are dropped, as a browser shows it');
  assert.deepEqual(where(r), [0, 0, 13]);
});

test('pasting several paragraphs splits the paragraph and joins both ends', () => {
  const { md: out, r } = pasteMd('Start end\n', (d) => at(d, 0, 6), body(el('p', {}, 'one'), el('p', {}, 'two')));
  assert.equal(out, 'Start one\n\ntwoend\n');
  assert.deepEqual(where(r), [1, 0, 3]);
});

test('pasting a heading in the middle of a paragraph', () => {
  const { md: out, r } = pasteMd('before after\n', (d) => at(d, 0, 7), body(el('h2', {}, 'Head')));
  assert.equal(out, 'before\n\n## Head\n\nafter\n');
  assert.deepEqual(where(r), [1, 0, 4]);
});

test('pasting a code block at the end adds a paragraph to keep writing', () => {
  const { md: out, r } = pasteMd('Text\n', (d) => at(d, 0, 4), body(el('p', {}, 'intro'), el('pre', {}, 'x')));
  assert.equal(out, 'Textintro\n\n```\nx\n```\n');
  assert.equal(r.doc.blocks.length, 3);
  assert.deepEqual(where(r), [2, 0, 0]);
});

test('pasting several blocks inside a list puts them after it', () => {
  const { md: out } = pasteMd('* a\n* b\n', (d) => at(d, 0, 1, 0), body(el('p', {}, 'x'), el('p', {}, 'y')));
  assert.equal(out, '* a\n* b\n\nx\n\ny\n');
});
