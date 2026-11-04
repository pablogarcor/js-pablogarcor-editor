/**
 * Round-trip tests against the real posts of pablogarcor.com.
 *
 * Needs a checkout of the blog. By default it looks for it next to this
 * repo (../js-pablogarcor-web); set BLOG_DIR to point elsewhere. Without a
 * checkout these tests are skipped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseMarkdown } from '../src/markdown/parse.js';
import { blocksEqual, checkBlock, serializeMarkdown } from '../src/markdown/serialize.js';
import { fieldsOf } from '../src/markdown/frontmatter.js';

const blogDir = resolve(process.env.BLOG_DIR ?? join(import.meta.dirname, '..', '..', 'js-pablogarcor-web'));
const contentDir = join(blogDir, 'content');
const available = existsSync(contentDir);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const posts = available
  ? walk(contentDir)
      .filter((f) => /\/blog\/\d{4}\//.test(f) && f.endsWith('.md'))
      .sort()
      .map((f) => ({ name: relative(contentDir, f), source: readFileSync(f, 'utf8') }))
  : [];

test('blog checkout found', { skip: available ? false : `no blog checkout at ${blogDir} (set BLOG_DIR)` }, () => {
  assert.ok(posts.length > 0);
});

for (const post of posts) {
  test(`round trip: ${post.name}`, () => {
    const doc = parseMarkdown(post.source);

    // 1. Lossless: an untouched post is written back byte for byte.
    assert.equal(serializeMarkdown(doc), post.source);

    // 2. Every block rendered from the model parses back to the same block.
    for (const block of doc.blocks) {
      const { verified, markdown } = checkBlock(block);
      assert.ok(verified, `block not verified:\n${block.raw}\n---\n${markdown}`);
    }

    // 3. The whole post rendered from the model (no source snapshots) parses
    //    back to the same blocks and front matter.
    const canonical = serializeMarkdown(doc, { canonical: true });
    const again = parseMarkdown(canonical);
    assert.equal(again.blocks.length, doc.blocks.length);
    again.blocks.forEach((b, i) => assert.ok(blocksEqual(b, doc.blocks[i]), `block ${i} changed:\n${doc.blocks[i].raw}`));
    assert.deepEqual(fieldsOf(again.frontMatter), fieldsOf(doc.frontMatter));

    // 4. The house style is stable: rendering it again changes nothing.
    assert.equal(serializeMarkdown(again, { canonical: true }), canonical);
  });
}

// Informative: blocks the visual editor can only show as Markdown source.
test('blocks that stay as raw Markdown', { skip: !available }, (t) => {
  const raw = posts.flatMap((p) => parseMarkdown(p.source).blocks.filter((b) => b.type === 'raw').map((b) => `${p.name}: ${b.source.slice(0, 60)}`));
  t.diagnostic(`raw blocks: ${raw.length}`);
  for (const line of raw) t.diagnostic(line);
});

test('fidelity of the house style', { skip: !available }, (t) => {
  let identical = 0;
  let blocks = 0;
  let sameBlocks = 0;
  for (const p of posts) {
    const doc = parseMarkdown(p.source);
    if (serializeMarkdown(doc, { canonical: true }) === p.source) identical++;
    for (const b of doc.blocks) {
      blocks++;
      if (checkBlock(b).markdown === b.raw) sameBlocks++;
    }
  }
  t.diagnostic(`posts identical when rendered from the model: ${identical}/${posts.length}`);
  t.diagnostic(`blocks identical when rendered from the model: ${sameBlocks}/${blocks}`);
  assert.ok(sameBlocks / blocks > 0.95);
});
