import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseMarkdown } from '../src/markdown/parse.js';
import { runsLength } from '../src/model/inline.js';
import { caret, fieldRuns, insertLineBreak, isTextBlock } from '../src/model/editing.js';
import { renderBlock } from '../src/editor/view.js';
import { fieldLength, pointAt, positionOf } from '../src/editor/selection.js';

/**
 * A fake DOM built from vnodes, with just what selection.js uses.
 * @returns {any}
 */
function build(vnode, parent = null) {
  if (typeof vnode === 'string') return { nodeType: 3, nodeName: '#text', data: vnode, childNodes: [], parentNode: parent };
  const attrs = vnode.attrs ?? {};
  const el = {
    nodeType: 1,
    nodeName: vnode.tag.toUpperCase(),
    childNodes: [],
    parentNode: parent,
    hasAttribute: (k) => k in attrs,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
  };
  el.childNodes = (vnode.children ?? []).map((c) => build(c, el));
  return el;
}

/** Root element holding the rendered blocks of a document. */
function surface(doc) {
  const root = { nodeType: 1, nodeName: 'DIV', childNodes: [], parentNode: null, hasAttribute: () => false, getAttribute: () => null };
  root.childNodes = doc.blocks.map((b) => build(renderBlock(b), root));
  return root;
}

/** Every field element under a node, in order. */
function fields(node, out = []) {
  if (node.nodeType === 1 && node.hasAttribute('data-field')) out.push(node);
  else node.childNodes.forEach((c) => fields(c, out));
  return out;
}

/** Each field of the document with its element, checked against the model. */
function* fieldPairs(doc) {
  const root = surface(doc);
  const els = fields(root);
  let k = 0;
  for (const block of doc.blocks.filter(isTextBlock)) {
    const count = block.type === 'list' ? block.items.length : 1;
    for (let item = 0; item < count; item++) yield { root, el: els[k++], block, item };
  }
  assert.equal(k, els.length, 'one element per field');
}

/** Offset -> DOM point -> offset must be the identity, for every offset. */
function assertRoundTrip(doc, label = '') {
  for (const { root, el, block, item } of fieldPairs(doc)) {
    const length = runsLength(fieldRuns(doc, block.id, item));
    assert.equal(fieldLength(el), length, `${label} length of ${block.type}`);
    for (let offset = 0; offset <= length; offset++) {
      const point = pointAt(el, offset);
      assert.deepEqual(positionOf(root, point.node, point.offset), { block: block.id, item, offset }, `${label} ${block.type} @${offset}`);
    }
  }
}

test('offsets round-trip through text, marks, breaks and atoms', () => {
  const doc = parseMarkdown(
    [
      'Plain **bold *both*** and `code` [link](https://x.y "t") end',
      'Line one\\\nline two  \nthree',
      'Image ![alt text](a.webp) and <span>html</span> inline',
      '## Heading **with** marks',
      '> Quoted *text*',
      '1. first\n2. second **item**\n3. ![x](b.webp)',
    ].join('\n\n'),
  );
  assertRoundTrip(doc);
});

test('an empty field and one ending in a break have a filler that is not content', () => {
  const base = parseMarkdown('ends with break\n\n*\n');
  const { doc } = insertLineBreak(base, caret({ block: base.blocks[0].id, item: 0, offset: 15 }));
  const [{ el }] = fieldPairs(doc);
  const filler = el.childNodes[el.childNodes.length - 1];
  assert.ok(filler.hasAttribute('data-filler'));
  assert.deepEqual(pointAt(el, fieldLength(el)), { node: el, offset: el.childNodes.length - 1 }, 'the end is before the filler');
  assertRoundTrip(doc);
});

test('a point inside an atom counts as just before it', () => {
  const doc = parseMarkdown('a ![alt](missing.webp) b\n');
  const { root, el, block } = [...fieldPairs(doc)][0];
  const atom = el.childNodes.find((n) => n.nodeType === 1 && n.hasAttribute('data-atom'));
  const inner = atom.childNodes[0];
  assert.deepEqual(positionOf(root, inner, 3), { block: block.id, item: 0, offset: 2 });
});

test('points outside fields snap to the next field, or the end of the previous one', () => {
  const doc = parseMarkdown('First\n\n![img](a.webp)\n\nSecond\n');
  const root = surface(doc);
  const [first, , second] = doc.blocks;
  // At the root, just before the image block.
  assert.deepEqual(positionOf(root, root, 1), { block: second.id, item: 0, offset: 0 });
  // Inside the image block (not editable).
  const figure = root.childNodes[1];
  assert.deepEqual(positionOf(root, figure, 0), { block: second.id, item: 0, offset: 0 });
  // After the last block.
  assert.deepEqual(positionOf(root, root, 3), { block: second.id, item: 0, offset: 6 });
  // Before everything.
  assert.deepEqual(positionOf(root, root, 0), { block: first.id, item: 0, offset: 0 });
});

test('points outside the root are ignored', () => {
  const doc = parseMarkdown('Text\n');
  const other = build('elsewhere');
  assert.equal(positionOf(surface(doc), other, 0), null);
});

const blogDir = resolve(process.env.BLOG_DIR ?? join(import.meta.dirname, '..', '..', 'js-pablogarcor-web'));
const contentDir = join(blogDir, 'content');
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

test('offsets round-trip in every field of every post of the blog', { skip: !existsSync(contentDir) && 'blog not found' }, () => {
  const posts = walk(contentDir).filter((f) => /\/blog\/\d{4}\//.test(f) && f.endsWith('.md'));
  assert.ok(posts.length > 0);
  for (const file of posts) assertRoundTrip(parseMarkdown(readFileSync(file, 'utf8')), file);
});
