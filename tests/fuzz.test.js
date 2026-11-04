/**
 * Property test: whatever inline content the editor produces, rendering it
 * to Markdown and parsing it back gives the same content. Random runs with
 * random marks and the characters that usually break Markdown.
 * Seeded, so a failure is reproducible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocks } from '../src/model/document.js';
import { text } from '../src/model/inline.js';
import { checkBlock } from '../src/markdown/serialize.js';

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ['word', 'otra', ' ', ' ', '   ', '\t', '*', '_', '**', '`', '``', '[', ']', '(', ')', '!', '![', '#', '>', '-', '1.', '<', '<b>', '&amp;', '&', '\\', '~', 'ñ', '¡', '?', '.', ',', '\n', 'http://x.y', '<http://a.b>', '"', "'", '|', '+', '=', '😀'];
const HREFS = ['https://example.com/a_b', '#x', 'a b', 'x(y)', '(z'];

function randomRuns(rand) {
  const runs = [];
  const n = 1 + Math.floor(rand() * 6);
  for (let i = 0; i < n; i++) {
    let s = '';
    const len = 1 + Math.floor(rand() * 6);
    for (let j = 0; j < len; j++) s += PIECES[Math.floor(rand() * PIECES.length)];
    const marks = {};
    if (rand() < 0.3) marks.strong = true;
    if (rand() < 0.3) marks.em = true;
    if (rand() < 0.15) marks.code = true;
    if (rand() < 0.15) marks.link = { href: HREFS[Math.floor(rand() * HREFS.length)], ...(rand() < 0.2 ? { title: 't "q"' } : {}) };
    if (marks.code) s = s.replace(/\n/g, ' ');
    runs.push(rand() < 0.05 ? { type: 'image', src: 'p q.webp', alt: 'a [b]', marks } : text(s, marks));
  }
  return runs;
}

test('random paragraphs, headings, quotes and list items round-trip', () => {
  const rand = prng(20261103);
  const failures = [];
  for (let i = 0; i < 3000; i++) {
    const runs = randomRuns(rand);
    const kind = i % 4;
    const block =
      kind === 0
        ? blocks.paragraph(runs)
        : kind === 1
          ? blocks.heading(1 + Math.floor(rand() * 6), runs)
          : kind === 2
            ? blocks.quote(runs)
            : blocks.list({ ordered: rand() < 0.5, start: 1 + Math.floor(rand() * 12), items: [runs, randomRuns(rand)] });
    const result = checkBlock(block);
    if (!result.verified) failures.push({ runs: JSON.stringify(runs), markdown: result.markdown });
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} of 3000 did not round-trip`);
});
