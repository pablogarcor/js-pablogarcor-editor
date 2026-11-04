import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../src/markdown/parse.js';
import { checkBlock, serializeMarkdown } from '../src/markdown/serialize.js';
import { blocks, createDocument, insertBlock, removeBlock, updateBlock } from '../src/model/document.js';
import { text } from '../src/model/inline.js';

const types = (md) => parseMarkdown(md).blocks.map((b) => b.type);

test('the block types the blog uses', () => {
  const md = [
    '## Heading',
    'A paragraph with **bold**.',
    '* one\n* two',
    '1. first\n2. second',
    '> **Note:** careful.',
    '```sh\nsudo update-grub\n```',
    '![Alt text](image.webp)',
  ].join('\n\n');
  assert.deepEqual(types(md), ['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'image']);
});

test('a fence right after a list item ends the list (no blank line needed)', () => {
  const doc = parseMarkdown('- Clone the project.\n- Execute this command:\n```bash\npython3 run.py\n```\n');
  assert.deepEqual(doc.blocks.map((b) => b.type), ['list', 'code']);
  assert.equal(doc.blocks[1].sep, '\n');
});

test('ordered lists keep their start number', () => {
  const [list] = parseMarkdown('5. **Set the permissions**.\n').blocks;
  assert.equal(list.type, 'list');
  assert.equal(list.start, 5);
  assert.equal(checkBlock(list).markdown, '5. **Set the permissions**.');
});

test('lazy continuation lines stay in their list item', () => {
  const [list] = parseMarkdown('1. Assign a port.\n2. Add a range.\nEnsure there is no overlap.\n').blocks;
  assert.equal(list.items.length, 2);
  assert.equal(list.items[1].runs[0].text, 'Add a range.\nEnsure there is no overlap.');
});

test('"3." cannot interrupt a paragraph, "1." can', () => {
  assert.deepEqual(types('Some text\n3. still text\n'), ['paragraph']);
  assert.deepEqual(types('Some text\n1. a list\n'), ['paragraph', 'list']);
});

test('setext headings and thematic breaks', () => {
  assert.deepEqual(types('Title\n=====\n\n---\n'), ['heading', 'hr']);
});

test('what the editor cannot edit stays as raw Markdown', () => {
  const cases = [
    '| a | b |\n|---|---|\n| 1 | 2 |',
    '<div class="note">\nhello\n</div>',
    '* parent\n  * nested',
    '> one\n>\n> two',
    '{{< figure src="x.webp" >}}',
    '[ref]: https://example.com',
  ];
  for (const md of cases) assert.deepEqual(types(md), ['raw'], md);
});

test('untouched blocks are written back byte for byte', () => {
  const src = '---\ntitle: "T"\n---\n\n\nTrailing space here. \n\n* a\n- b\n\n\n## H ##\n';
  const doc = parseMarkdown(src);
  assert.equal(serializeMarkdown(doc), src);
});

test('editing one block only rewrites that block', () => {
  const src = '---\ntitle: "T"\n---\n\nKeep  this   spacing. \n\nEdit me.\n\n*  odd   list*\n';
  const doc = parseMarkdown(src);
  const edited = updateBlock(doc, doc.blocks[1].id, { runs: [text('Edited.')] });
  assert.equal(serializeMarkdown(edited), '---\ntitle: "T"\n---\n\nKeep  this   spacing. \n\nEdited.\n\n*  odd   list*\n');
});

test('an edited block never glues to its neighbour', () => {
  const doc = parseMarkdown('- item\n```\ncode\n```\n');
  const edited = updateBlock(doc, doc.blocks[0].id, (b) => ({ items: [...b.items, { runs: [text('new')] }] }));
  assert.equal(serializeMarkdown(edited), '- item\n- new\n\n```\ncode\n```\n');
});

test('inserted and removed blocks', () => {
  let doc = parseMarkdown('First.\n\nSecond.\n');
  doc = insertBlock(doc, 1, blocks.heading(2, [text('Middle')]));
  assert.equal(serializeMarkdown(doc), 'First.\n\n## Middle\n\nSecond.\n');
  doc = removeBlock(doc, doc.blocks[0].id);
  assert.equal(serializeMarkdown(doc), '## Middle\n\nSecond.\n');
});

test('two lists of the same kind in a row stay two lists', () => {
  const doc = createDocument({ blocks: [blocks.list({ items: [[text('a')]] }), blocks.list({ items: [[text('b')]] })] });
  const md = serializeMarkdown(doc);
  assert.equal(md, '* a\n\n- b\n');
  assert.equal(parseMarkdown(md).blocks.length, 2);
});

test('code blocks pick a fence longer than any inside them', () => {
  const block = blocks.code('md', 'Use ```js fences```');
  assert.equal(checkBlock(block).markdown, '````md\nUse ```js fences```\n````');
});

test('empty paragraphs are dropped', () => {
  const doc = createDocument({ blocks: [blocks.paragraph([text('a')]), blocks.paragraph([]), blocks.paragraph([text('b')])] });
  assert.equal(serializeMarkdown(doc), 'a\n\nb\n');
});
