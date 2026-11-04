// @ts-check
/**
 * Markdown -> document model.
 *
 * A CommonMark block parser reduced to what a blog post needs. Anything it
 * cannot represent as an editable block (tables, raw HTML, nested lists,
 * multi-paragraph quotes or list items, shortcodes, reference definitions)
 * becomes a `raw` block: its source is kept verbatim and the editor shows it
 * as a Markdown source block, like Gutenberg's "Custom HTML".
 *
 * Every block records the exact source it came from (`raw`) and the exact
 * text before it (`sep`), so serialize(parse(md)) === md for any input.
 */

import { createDocument, newId } from '../model/document.js';
import { parseInline } from './inline.js';
import { parseFrontMatter, splitFrontMatter } from './frontmatter.js';

/**
 * @typedef {import('../model/document.js').Block} Block
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {{ start: number, end: number, block: import('../model/document.js').BlockData }} Span
 * @typedef {{ ordered: boolean, marker: string, number: number, indent: number, markerWidth: number, spacing: string, content: string }} ItemStart
 */

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const BULLET = /^( {0,3})([*+-])([ \t]+|$)(.*)$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const SHORTCODE = /^ {0,3}\{\{[<%].*[%>]\}\}[ \t]*$/;
const REF_DEF = /^ {0,3}\[(?:[^\]\\]|\\.)+\]:/;
const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

/** @type {{ start: RegExp, end: RegExp | 'blank', interrupts: boolean }[]} */
export const HTML_BLOCKS = [
  { start: /^ {0,3}<(?:script|pre|style|textarea)(?:\s|>|$)/i, end: /<\/(?:script|pre|style|textarea)>/i, interrupts: true },
  { start: /^ {0,3}<!--/, end: /-->/, interrupts: true },
  { start: /^ {0,3}<\?/, end: /\?>/, interrupts: true },
  { start: /^ {0,3}<![A-Za-z]/, end: />/, interrupts: true },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/, interrupts: true },
  { start: new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?:\\s|/?>|$)`, 'i'), end: 'blank', interrupts: true },
  {
    start: /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*$/,
    end: 'blank',
    interrupts: false,
  },
];

/**
 * @param {string} source a whole post, front matter included
 * @returns {Doc}
 */
export function parseMarkdown(source) {
  const { frontMatter, body } = splitFrontMatter(source);
  const { blocks, trailing } = parseBody(body);
  return createDocument({ frontMatter: frontMatter === null ? null : parseFrontMatter(frontMatter), blocks, trailing });
}

/**
 * @param {string} body Markdown without front matter
 * @returns {{ blocks: Block[], trailing: string }}
 */
export function parseBody(body) {
  const lines = body.split('\n');
  /** @type {Block[]} */
  const out = [];
  let prevEnd = -1;
  for (const span of scanBlocks(lines)) {
    const between = lines.slice(prevEnd + 1, span.start);
    const sep = prevEnd < 0 ? between.join('\n') + (between.length ? '\n' : '') : `\n${between.join('\n')}${between.length ? '\n' : ''}`;
    out.push(/** @type {Block} */ ({ ...span.block, id: newId(), raw: lines.slice(span.start, span.end + 1).join('\n'), sep }));
    prevEnd = span.end;
  }
  const trailing = prevEnd < 0 ? body : prevEnd + 1 < lines.length ? `\n${lines.slice(prevEnd + 1).join('\n')}` : '';
  return { blocks: out, trailing };
}

/**
 * @param {string[]} lines
 * @returns {Span[]}
 */
function scanBlocks(lines) {
  /** @type {Span[]} */
  const spans = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i++;
      continue;
    }
    const span =
      fence(lines, i) ??
      atx(lines, i) ??
      hr(lines, i) ??
      html(lines, i) ??
      shortcode(lines, i) ??
      indentedCode(lines, i) ??
      quote(lines, i) ??
      list(lines, i) ??
      paragraph(lines, i);
    spans.push(span);
    i = span.end + 1;
  }
  return spans;
}

/** @param {string} line */
const isBlank = (line) => /^[ \t]*$/.test(line);

/** @param {string} line leading whitespace width, tabs to the next multiple of 4 */
function indentWidth(line) {
  let w = 0;
  for (const c of line) {
    if (c === ' ') w++;
    else if (c === '\t') w += 4 - (w % 4);
    else break;
  }
  return w;
}

/**
 * Removes `n` columns of leading whitespace.
 * @param {string} line
 * @param {number} n
 */
function stripColumns(line, n) {
  let w = 0;
  let i = 0;
  while (i < line.length && w < n) {
    if (line[i] === ' ') w++;
    else if (line[i] === '\t') w += 4 - (w % 4);
    else break;
    i++;
  }
  return ' '.repeat(Math.max(0, w - n)) + line.slice(i);
}

/** @param {string} line */
function isFenceOpen(line) {
  const m = FENCE_OPEN.exec(line);
  return Boolean(m && !(m[2][0] === '`' && m[3].includes('`')));
}

/**
 * Lines that end a paragraph without a blank line before them.
 * @param {string} line
 */
export function interruptsParagraph(line) {
  if (isBlank(line) || isFenceOpen(line) || ATX.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  if (HTML_BLOCKS.some((h) => h.interrupts && h.start.test(line))) return true;
  const b = BULLET.exec(line);
  if (b && b[4].trim() !== '') return true;
  const o = ORDERED.exec(line);
  return Boolean(o && o[2] === '1' && o[5].trim() !== '');
}

/**
 * Text that would start something other than paragraph text.
 * @param {string} line
 */
function startsBlock(line) {
  return (
    isFenceOpen(line) ||
    ATX.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    /^ {0,3}=+[ \t]*$/.test(line) ||
    HTML_BLOCKS.some((h) => h.start.test(line)) ||
    indentWidth(line) >= 4
  );
}

/** @param {string[]} lines @param {number} i @returns {Span | null} */
function fence(lines, i) {
  const m = FENCE_OPEN.exec(lines[i]);
  if (!m || (m[2][0] === '`' && m[3].includes('`'))) return null;
  const [, indent, marker, info] = m;
  const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
  let k = i + 1;
  while (k < lines.length && !close.test(lines[k])) k++;
  const closed = k < lines.length;
  let end = closed ? k : lines.length - 1;
  if (!closed) while (end > i && isBlank(lines[end])) end--;
  const content = lines.slice(i + 1, closed ? k : end + 1).map((l) => stripColumns(l, indent.length));
  return { start: i, end, block: { type: 'code', info: info.trim(), text: content.join('\n') } };
}

/** @param {string[]} lines @param {number} i @returns {Span | null} */
function atx(lines, i) {
  const m = ATX.exec(lines[i]);
  if (!m) return null;
  const content = m[2]
    .replace(/^[ \t]+/, '')
    .replace(/(^|[ \t]+)#+[ \t]*$/, '')
    .replace(/[ \t]+$/, '');
  return { start: i, end: i, block: { type: 'heading', level: m[1].length, runs: parseInline(content) } };
}

/** @param {string[]} lines @param {number} i @returns {Span | null} */
function hr(lines, i) {
  return HR.test(lines[i]) ? { start: i, end: i, block: { type: 'hr' } } : null;
}

/** @param {string[]} lines @param {number} i @returns {Span | null} */
function html(lines, i) {
  const def = HTML_BLOCKS.find((h) => h.start.test(lines[i]));
  if (!def) return null;
  let k = i;
  if (def.end === 'blank') {
    while (k + 1 < lines.length && !isBlank(lines[k + 1])) k++;
  } else {
    const end = def.end;
    while (k < lines.length && !end.test(lines[k])) k++;
    if (k === lines.length) {
      k = lines.length - 1;
      while (k > i && isBlank(lines[k])) k--;
    }
  }
  return rawSpan(lines, i, k);
}

/** @param {string[]} lines @param {number} i @returns {Span | null} */
function shortcode(lines, i) {
  return SHORTCODE.test(lines[i]) ? rawSpan(lines, i, i) : null;
}

/** @param {string[]} lines @param {number} i @returns {Span | null} */
function indentedCode(lines, i) {
  if (indentWidth(lines[i]) < 4) return null;
  let k = i;
  while (k + 1 < lines.length && (isBlank(lines[k + 1]) || indentWidth(lines[k + 1]) >= 4)) k++;
  while (isBlank(lines[k])) k--;
  const text = lines
    .slice(i, k + 1)
    .map((l) => stripColumns(l, 4))
    .join('\n');
  return { start: i, end: k, block: { type: 'code', info: '', text } };
}

/** @param {string[]} lines @param {number} i @returns {Span | null} */
function quote(lines, i) {
  if (!QUOTE.test(lines[i])) return null;
  /** @type {string[]} */
  const inner = [];
  let k = i;
  while (k < lines.length) {
    const line = lines[k];
    if (QUOTE.test(line)) {
      inner.push(line.replace(/^ {0,3}> ?/, ''));
    } else if (!isBlank(line) && !isBlank(inner[inner.length - 1]) && !interruptsParagraph(line)) {
      inner.push(line);
    } else break;
    k++;
  }
  const end = k - 1;
  const complex = inner.some((l) => isBlank(l)) || inner.some((l, j) => (j === 0 ? startsBlock(l) : startsBlock(l) && !lazyOk(l)));
  if (complex) return rawSpan(lines, i, end);
  return { start: i, end, block: { type: 'quote', runs: parseInline(joinParagraph(inner)) } };
}

/**
 * A continuation line inside a paragraph that looks like a block start but
 * cannot interrupt a paragraph (e.g. "2. text" or an indented line).
 * @param {string} line
 */
function lazyOk(line) {
  return !interruptsParagraph(line) && !/^ {0,3}=+[ \t]*$/.test(line) && !SETEXT.test(line);
}

/** @param {string} line @returns {ItemStart | null} */
function itemStart(line) {
  if (HR.test(line)) return null;
  const b = BULLET.exec(line);
  if (b) return { ordered: false, marker: b[2], number: 1, indent: b[1].length, markerWidth: 1, spacing: b[3], content: b[4] };
  const o = ORDERED.exec(line);
  if (o) return { ordered: true, marker: o[3], number: parseInt(o[2], 10), indent: o[1].length, markerWidth: o[2].length + 1, spacing: o[4], content: o[5] };
  return null;
}

/** @param {ItemStart} it */
function contentIndent(it) {
  const spacing = indentWidth(it.spacing + 'x');
  if (it.content.trim() === '' || spacing >= 5) return it.indent + it.markerWidth + 1;
  return it.indent + it.markerWidth + spacing;
}

/** @param {string[]} lines @param {number} i @returns {Span | null} */
function list(lines, i) {
  const first = itemStart(lines[i]);
  if (!first) return null;
  /** @type {string[][]} */
  const items = [];
  let complex = false;
  let loose = false;
  let end = i;
  let k = i;
  for (;;) {
    const it = /** @type {ItemStart} */ (itemStart(lines[k]));
    const width = contentIndent(it);
    if (indentWidth(it.spacing + 'x') >= 5 && it.content.trim() !== '') complex = true;
    if (it.content.trim() !== '' && startsBlock(it.content)) complex = true;
    const itemLines = [it.content];
    end = k;
    k++;
    let sawBlank = false;
    let listEnded = false;
    while (k < lines.length) {
      const line = lines[k];
      if (isBlank(line)) {
        sawBlank = true;
        k++;
        continue;
      }
      if (indentWidth(line) >= width) {
        const stripped = stripColumns(line, width);
        if (sawBlank || startsBlock(stripped)) complex = true;
        itemLines.push(stripped);
        end = k;
        k++;
        sawBlank = false;
        continue;
      }
      const next = itemStart(line);
      if (next && next.ordered === first.ordered && next.marker === first.marker) {
        if (sawBlank) loose = true;
        break;
      }
      if (!sawBlank && !interruptsParagraph(line)) {
        itemLines.push(line);
        end = k;
        k++;
        continue;
      }
      listEnded = true;
      break;
    }
    items.push(itemLines);
    if (listEnded || k >= lines.length) break;
  }
  if (complex) return rawSpan(lines, i, end);
  return {
    start: i,
    end,
    block: {
      type: 'list',
      ordered: first.ordered,
      start: first.number,
      marker: first.marker,
      loose,
      items: items.map((l) => ({ runs: parseInline(joinParagraph(l)) })),
    },
  };
}

/** @param {string[]} lines @param {number} i @returns {Span} */
function paragraph(lines, i) {
  let k = i + 1;
  while (k < lines.length) {
    const line = lines[k];
    if (isBlank(line)) break;
    if (SETEXT.test(line)) {
      const level = line.trim()[0] === '=' ? 1 : 2;
      return { start: i, end: k, block: { type: 'heading', level, runs: parseInline(joinParagraph(lines.slice(i, k))) } };
    }
    if (interruptsParagraph(line)) break;
    k++;
  }
  const end = k - 1;
  const own = lines.slice(i, end + 1);
  if (REF_DEF.test(own[0])) return rawSpan(lines, i, end);
  if (own.length >= 2 && own[0].includes('|') && TABLE_DELIM.test(own[1])) return rawSpan(lines, i, end);
  const runs = parseInline(joinParagraph(own));
  const only = runs.length === 1 ? runs[0] : null;
  if (only && only.type === 'image' && Object.keys(only.marks).length === 0) {
    const block = only.title === undefined ? { type: 'image', src: only.src, alt: only.alt } : { type: 'image', src: only.src, alt: only.alt, title: only.title };
    return { start: i, end, block: /** @type {import('../model/document.js').BlockData} */ (block) };
  }
  return { start: i, end, block: { type: 'paragraph', runs } };
}

/** @param {string[]} lines */
function joinParagraph(lines) {
  return lines
    .map((l) => l.replace(/^[ \t]+/, ''))
    .join('\n')
    .replace(/[ \t]+$/, '');
}

/** @param {string[]} lines @param {number} start @param {number} end @returns {Span} */
function rawSpan(lines, start, end) {
  return { start, end, block: { type: 'raw', source: lines.slice(start, end + 1).join('\n') } };
}
