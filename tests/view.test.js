import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseMarkdown } from '../src/markdown/parse.js';
import { h, renderBlock, renderDocument, renderMeta, renderRuns, summarize } from '../src/editor/view.js';
import { toDom } from '../src/editor/dom.js';
import { text } from '../src/model/inline.js';

const first = (md, opts) => renderBlock(parseMarkdown(md).blocks[0], opts);

/** Drops the block attributes, which carry random ids. */
const shape = (node) =>
  typeof node === 'string'
    ? node
    : { tag: node.tag, ...(node.children ? { children: node.children.map(shape) } : {}) };

test('h drops undefined attributes and empty lists', () => {
  assert.deepEqual(h('p', { a: undefined }), { tag: 'p' });
  assert.deepEqual(h('ol', { start: '3' }, ['x']), { tag: 'ol', attrs: { start: '3' }, children: ['x'] });
});

test('marks nest link > strong > em > code, one element per run', () => {
  const runs = [
    text('plain '),
    text('all', { strong: true, em: true, code: true, link: { href: 'https://example.com' } }),
  ];
  assert.deepEqual(renderRuns(runs), [
    'plain ',
    h('span', { class: 'link', title: 'https://example.com' }, [
      h('strong', {}, [h('em', {}, [h('code', {}, ['all'])])]),
    ]),
  ]);
});

test('each block type maps to its element', () => {
  assert.deepEqual(shape(first('## Title')), { tag: 'h2', children: ['Title'] });
  assert.deepEqual(shape(first('> **Note:** careful.')), {
    tag: 'blockquote',
    children: [{ tag: 'p', children: [{ tag: 'strong', children: ['Note:'] }, ' careful.'] }],
  });
  assert.deepEqual(shape(first('* one\n* two')), {
    tag: 'ul',
    children: [{ tag: 'li', children: ['one'] }, { tag: 'li', children: ['two'] }],
  });
  assert.deepEqual(shape(first('```sh\nls -la\n```')), { tag: 'pre', children: [{ tag: 'code', children: ['ls -la'] }] });
  assert.equal(first('```sh\nls\n```').attrs['data-lang'], 'sh');
  assert.equal(first('---').tag, 'hr');
});

test('ordered lists keep their start number', () => {
  assert.equal(first('5. five\n6. six').attrs.start, '5');
  assert.equal(first('1. one').attrs.start, undefined);
});

test('blocks carry their id and type', () => {
  const block = parseMarkdown('Hello').blocks[0];
  const node = renderBlock(block);
  assert.equal(node.attrs['data-block-id'], block.id);
  assert.equal(node.attrs.class, 'block block-paragraph');
});

test('raw blocks show their Markdown source as text', () => {
  const md = '| a | b |\n| - | - |\n| 1 | 2 |';
  const node = first(md);
  assert.equal(node.attrs.class, 'block block-raw');
  assert.deepEqual(shape(node.children[1]), { tag: 'pre', children: [md] });
});

test('raw HTML is shown as text, never as markup', () => {
  const block = first('<div onclick="alert(1)">x</div>');
  assert.equal(block.attrs.class, 'block block-raw');
  const inline = first('a <span onclick="x()">b</span>');
  assert.deepEqual(shape(inline).children[1], { tag: 'code', children: ['<span onclick="x()">'] });
});

test('images use the URL the page provides, or a placeholder', () => {
  const urls = new Map([['photo.webp', 'blob:local/1']]);
  const opts = { imageUrl: (src) => urls.get(src.replace(/^\.\//, '')) };
  assert.deepEqual(first('![A photo](./photo.webp)', opts).children[0], h('img', { src: 'blob:local/1', alt: 'A photo' }));
  const missing = first('![Gone](gone.webp)', opts).children[0];
  assert.equal(missing.attrs.class, 'image-missing');
  assert.deepEqual(missing.children, ['Imagen no cargada: Gone']);
});

test('front matter: blog fields in their order, then the rest', () => {
  const doc = parseMarkdown('---\nextra: "x"\ntags: ["a", "b"]\ntitle: "T"\n---\nBody\n');
  assert.deepEqual(shape(renderMeta(doc)).children.map((c) => c.children[0]), ['title', 'T', 'tags', 'a, b', 'extra', 'x']);
});

test('summarize counts blocks and checks the round trip', () => {
  const md = '# A\n\nText\n\n| a |\n| - |\n';
  assert.deepEqual(summarize(parseMarkdown(md), md), { blocks: 3, raw: 1, lossless: true });
});

/** Minimal stand-in for `document`: enough for toDom. */
function fakeDocument() {
  const el = (tag) => ({ tag, attrs: {}, kids: [], setAttribute(k, v) { this.attrs[k] = v; }, append(c) { this.kids.push(c); } });
  return { createElement: el, createTextNode: (data) => ({ data }) };
}

test('toDom builds elements with text nodes and attributes', () => {
  const node = toDom(h('p', { class: 'x' }, ['a', h('strong', {}, ['<b>'])]), fakeDocument());
  assert.equal(node.tag, 'p');
  assert.deepEqual(node.attrs, { class: 'x' });
  assert.deepEqual(node.kids[0], { data: 'a' });
  assert.deepEqual(node.kids[1].kids[0], { data: '<b>' });
});

test('toDom refuses unknown tags and event handler attributes', () => {
  assert.throws(() => toDom(h('script', {}, ['x']), fakeDocument()), /Unexpected tag/);
  assert.throws(() => toDom(h('img', { onerror: 'x()' }), fakeDocument()), /not allowed/);
});

const blogDir = resolve(process.env.BLOG_DIR ?? join(import.meta.dirname, '..', '..', 'js-pablogarcor-web'));
const contentDir = join(blogDir, 'content');

/** @param {string} dir @returns {string[]} */
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

test('every post of the blog renders, and only with allowed tags', { skip: !existsSync(contentDir) && 'blog not found' }, () => {
  const posts = walk(contentDir).filter((f) => /\/blog\/\d{4}\//.test(f) && f.endsWith('.md'));
  assert.ok(posts.length > 0);
  for (const file of posts) {
    const tree = renderDocument(parseMarkdown(readFileSync(file, 'utf8')));
    assert.doesNotThrow(() => toDom(tree, fakeDocument()), file);
  }
});
