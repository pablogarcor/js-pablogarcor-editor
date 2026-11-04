// @ts-check
/**
 * Document model -> Markdown.
 *
 * Two modes:
 *  - default: untouched blocks are written from their `raw` source and keep
 *    their original separators, so a pull request only shows real edits.
 *  - canonical: every block is rendered from the model in the blog's house
 *    style. Used by tests to prove the model holds everything the Markdown
 *    says, and by new posts (which have no `raw` anyway).
 *
 * Rendered blocks are verified: the output is parsed again and must give
 * back the same block. If it does not, rendering is retried with stronger
 * escaping, so minimal escaping never silently changes meaning.
 */

import { normalizeRuns, text as textRun } from '../model/inline.js';
import { expelWhitespace, serializeInline } from './inline.js';
import { serializeFrontMatter } from './frontmatter.js';
import { HTML_BLOCKS, parseBody } from './parse.js';

/**
 * @typedef {import('../model/document.js').Block} Block
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {import('../model/inline.js').Run} Run
 * @typedef {import('./inline.js').InlineStyle} InlineStyle
 */

/** @type {InlineStyle[]} */
const ATTEMPTS = [
  { level: 0, em: '*', nested: '_' },
  { level: 0, em: '*' },
  { level: 1, em: '*', nested: '_' },
  { level: 1, em: '*' },
  { level: 1, em: '_' },
  { level: 2, em: '*' },
  { level: 2, em: '_' },
];

/**
 * @param {Doc} doc
 * @param {{ canonical?: boolean }} [opts]
 */
export function serializeMarkdown(doc, { canonical = false } = {}) {
  const hasFm = doc.frontMatter !== null;
  let out = doc.frontMatter ? serializeFrontMatter(doc.frontMatter, { canonical }) : '';
  /** @type {Block | null} */
  let prev = null;
  for (const original of doc.blocks) {
    let b = original;
    if (prev && b.type === 'list' && prev.type === 'list' && prev.ordered === b.ordered && prev.marker === b.marker && b.raw === undefined) {
      // Two lists of the same kind in a row would merge into one: switch marker.
      b = { ...b, marker: alternateMarker(b) };
    }
    const md = !canonical && b.raw !== undefined ? b.raw : renderBlock(b);
    if (md === '') continue;
    out += separator(b, prev, hasFm, canonical);
    out += md;
    prev = b;
  }
  const empty = prev === null && !hasFm;
  out += canonical || doc.trailing === undefined ? (empty ? '' : '\n') : doc.trailing;
  return out;
}

/** @param {import('../model/document.js').ListBlock} b */
function alternateMarker(b) {
  if (b.ordered) return b.marker === '.' ? ')' : '.';
  return b.marker === '*' ? '-' : '*';
}

/**
 * @param {Block} b
 * @param {Block | null} prev
 * @param {boolean} hasFm
 * @param {boolean} canonical
 */
function separator(b, prev, hasFm, canonical) {
  const first = prev === null;
  const def = first ? (hasFm ? '\n\n' : '') : '\n\n';
  if (canonical || b.sep === undefined) return def;
  const untouched = b.raw !== undefined && (first || prev?.raw !== undefined);
  if (untouched) return b.sep;
  // Next to an edited block, keep at least one blank line so the edit
  // cannot merge with its neighbour (a paragraph followed by "---", etc.).
  return /\n[ \t]*\n/.test(b.sep) || (first && !hasFm) ? b.sep : def;
}

/** @param {Block} block */
export function renderBlock(block) {
  return checkBlock(block).markdown;
}

/**
 * Renders a block and reports whether the output parses back to it.
 * @param {Block} block
 * @returns {{ markdown: string, verified: boolean }}
 */
export function checkBlock(block) {
  if (block.type === 'raw') return { markdown: block.source, verified: true };
  if (isEmpty(block)) return { markdown: '', verified: true };
  let markdown = '';
  for (const style of ATTEMPTS) {
    markdown = renderWith(block, style);
    const parsed = parseBody(markdown).blocks;
    if (parsed.length === 1 && blocksEqual(parsed[0], block)) return { markdown, verified: true };
    if (!('runs' in block) && block.type !== 'list') break;
  }
  return { markdown, verified: false };
}

/** @param {Block} block */
function isEmpty(block) {
  if (block.type === 'paragraph' || block.type === 'quote') return tidy(block.runs).length === 0;
  return false;
}

/**
 * @param {Block} block
 * @param {InlineStyle} style
 * @returns {string}
 */
function renderWith(block, style) {
  switch (block.type) {
    case 'paragraph':
      return escapeLines(serializeInline(tidy(block.runs), style));
    case 'heading': {
      const inline = escapeHeadingEnd(serializeInline(tidy(flatten(block.runs)), style));
      return inline ? `${'#'.repeat(block.level)} ${inline}` : '#'.repeat(block.level);
    }
    case 'quote':
      return escapeLines(serializeInline(tidy(block.runs), style))
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'list':
      return block.items
        .map((item, idx) => {
          const marker = block.ordered ? `${block.start + idx}${block.marker}` : block.marker;
          const pad = ' '.repeat(marker.length + 1);
          return escapeLines(serializeInline(tidy(item.runs), style))
            .split('\n')
            .map((l, j) => (j === 0 ? (l ? `${marker} ${l}` : marker) : l ? pad + l : ''))
            .join('\n');
        })
        .join(block.loose ? '\n\n' : '\n');
    case 'code': {
      const useTilde = block.info.includes('`');
      const ch = useTilde ? '~' : '`';
      const longest = Math.max(0, ...(block.text.match(useTilde ? /~+/g : /`+/g) ?? []).map((s) => s.length));
      const fence = ch.repeat(Math.max(3, longest + 1));
      return `${fence}${block.info}\n${block.text === '' ? '' : `${block.text}\n`}${fence}`;
    }
    case 'image':
      return serializeInline([{ type: 'image', src: block.src, alt: block.alt, ...(block.title === undefined ? {} : { title: block.title }), marks: {} }], style);
    case 'hr':
      return '---';
    case 'raw':
      return block.source;
  }
}

/**
 * Escapes the first character of lines that would otherwise start a block
 * (a heading, a list item, a quote, a fence, a setext underline...).
 * @param {string} md
 */
function escapeLines(md) {
  return md
    .split('\n')
    .map((line) => {
      // ":" + space after a line is a definition list in Hugo (goldmark).
      if (/^(#{1,6}(\s|$)|>|[*+-](\s|$)|~{3,}|(=+|-+)\s*$|:\s)/.test(line)) return `\\${line}`;
      // Three backticks open a fence, unless the line has more backticks
      // after them (then it is an inline code span: fence info cannot hold "`").
      const ticks = /^`{3,}/.exec(line);
      if (ticks && !line.slice(ticks[0].length).includes('`')) return `\\${line}`;
      const n = /^(\d{1,9})([.)])(\s|$)/.exec(line);
      if (n) return `${n[1]}\\${line.slice(n[1].length)}`;
      if (HTML_BLOCKS.some((h) => h.interrupts && h.start.test(line))) return `\\${line}`;
      return line;
    })
    .join('\n');
}

/** @param {string} md */
function escapeHeadingEnd(md) {
  return md.replace(/(^|[ \t])(#+)$/, (_, sp, hashes) => `${sp}\\${hashes}`);
}

/**
 * Paragraph-level whitespace rules: no leading or trailing whitespace, no
 * spaces around line breaks, no hard break at the very end.
 * @param {Run[]} input
 * @returns {Run[]}
 */
export function tidy(input) {
  const runs = normalizeRuns(input);
  const isWs = (/** @type {Run} */ r) => r.type === 'text' && !r.marks.code && /^\s*$/.test(r.text);
  let afterNewline = true;
  /** @type {Run[]} */
  const forward = runs.map((r) => {
    if (r.type === 'break') {
      afterNewline = true;
      return r;
    }
    if (r.type !== 'text' || r.marks.code) {
      afterNewline = false;
      return r;
    }
    // A blank line would split the block in two: inline content keeps at
    // most one line break in a row.
    let t = r.text.replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n');
    if (afterNewline) t = t.replace(/^\s+/, '');
    if (t !== '') afterNewline = t.endsWith('\n');
    return { ...r, text: t };
  });
  let beforeNewline = true;
  const backward = forward
    .reverse()
    .map((r) => {
      if (r.type === 'break') {
        beforeNewline = true;
        return r;
      }
      if (r.type !== 'text' || r.marks.code) {
        beforeNewline = false;
        return r;
      }
      let t = r.text.replace(/[ \t]+\n/g, '\n');
      if (beforeNewline) t = t.replace(/[ \t]+$/, '');
      if (t !== '') beforeNewline = t.startsWith('\n');
      return { ...r, text: t };
    })
    .reverse();
  let result = normalizeRuns(backward);
  while (result.length && (result[0].type === 'break' || isWs(result[0]))) result = result.slice(1);
  while (result.length && (result[result.length - 1].type === 'break' || isWs(result[result.length - 1]))) result = result.slice(0, -1);
  if (result[0]?.type === 'text' && !result[0].marks.code) result[0] = { ...result[0], text: result[0].text.replace(/^\s+/, '') };
  const last = result[result.length - 1];
  if (last?.type === 'text' && !last.marks.code) result[result.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') };
  return normalizeRuns(result);
}

/**
 * Headings are a single line: soft and hard breaks become spaces.
 * @param {Run[]} runs
 * @returns {Run[]}
 */
function flatten(runs) {
  return runs.map((r) => /** @type {Run} */ (r.type === 'break' ? textRun(' ') : r.type === 'text' ? { ...r, text: r.text.replace(/\n/g, ' ') } : r));
}

/**
 * The part of a block that its Markdown determines: no id, no source
 * snapshot, and inline content in normal form.
 * @param {Block} block
 */
export function semanticBlock(block) {
  const { id, raw, sep, ...rest } = /** @type {Block & { raw?: string, sep?: string }} */ (block);
  /** @param {Run[]} runs */
  const norm = (runs) => plainWhitespace(expelWhitespace(tidy(runs)));
  switch (rest.type) {
    case 'paragraph': {
      const runs = norm(rest.runs);
      const only = runs.length === 1 ? runs[0] : null;
      if (only && only.type === 'image' && Object.keys(only.marks).length === 0) {
        return { type: 'image', src: only.src, alt: only.alt, title: only.title };
      }
      return { type: 'paragraph', runs };
    }
    case 'quote':
      return { type: 'quote', runs: norm(rest.runs) };
    case 'heading':
      return { type: 'heading', level: rest.level, runs: norm(flatten(rest.runs)) };
    case 'list':
      return {
        type: 'list',
        ordered: rest.ordered,
        start: rest.ordered ? rest.start : 1,
        marker: rest.marker,
        loose: rest.loose,
        items: rest.items.map((it) => ({ runs: norm(it.runs) })),
      };
    case 'image':
      return { type: 'image', src: rest.src, alt: rest.alt, title: rest.title };
    case 'code':
      return { type: 'code', info: rest.info, text: rest.text };
    case 'hr':
      return { type: 'hr' };
    case 'raw':
      return { type: 'raw', source: rest.source };
  }
}

/**
 * Bold or italic on a space is invisible, so for comparison whitespace never
 * carries those marks ("**a b**" and "**a** **b**" look the same).
 * @param {Run[]} runs
 * @returns {Run[]}
 */
function plainWhitespace(runs) {
  return normalizeRuns(
    runs.flatMap((r) => {
      if (r.type !== 'text' || r.marks.code || !(r.marks.strong || r.marks.em)) return [r];
      return /** @type {Run[]} */ (r.text
        .split(/(\s+)/)
        .filter((part) => part !== '')
        .map((part) => {
          if (!/^\s+$/.test(part)) return { ...r, text: part };
          const { strong, em, ...rest } = r.marks;
          return { ...r, text: part, marks: rest };
        }));
    }),
  );
}

/**
 * @param {Block} a
 * @param {Block} b
 */
export function blocksEqual(a, b) {
  return stableStringify(semanticBlock(a)) === stableStringify(semanticBlock(b));
}

/** @param {unknown} value @returns {string} */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
