// @ts-check
/**
 * Pasted HTML -> blocks.
 *
 * Works on a parsed tree through a small part of the DOM API (nodeType,
 * nodeName, childNodes, data, getAttribute), so it runs on what DOMParser
 * gives in the browser and on a fake tree in the Node tests. Nothing from the
 * paste reaches the page as HTML: it only becomes model runs and blocks.
 *
 * What it keeps: paragraphs, headings (h1 becomes h2: the post title is the
 * page's h1), quotes, lists (nested items are flattened), code blocks,
 * separators, bold, italic, inline code, links (only safe addresses, see
 * normalizeHref) and line breaks. It drops images (a pasted image must go
 * through the image flow and become a file of the post), scripts, styles,
 * forms and the editor's own controls. Google Docs' quirks are handled: its
 * whole-document <b style="font-weight:normal"> wrapper is not bold, and its
 * styled <span>s are.
 */

import { blocks as make } from './document.js';
import { normalizeRuns, text as textRun } from './inline.js';
import { normalizeHref } from './formatting.js';

/**
 * @typedef {import('./document.js').Block} Block
 * @typedef {import('./inline.js').Run} Run
 * @typedef {import('./inline.js').Marks} Marks
 * @typedef {{
 *   nodeType: number,
 *   nodeName: string,
 *   childNodes: ArrayLike<HtmlNode>,
 *   data?: string,
 *   getAttribute?: (name: string) => string | null,
 * }} HtmlNode
 * @typedef {{ blocks: Block[], skippedImages: number }} HtmlResult
 */

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'FORM']);
const BLOCKS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'ADDRESS',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'DL', 'DT', 'DD', 'BODY', 'HTML',
]);

/** @param {HtmlNode} node @param {string} name */
const attr = (node, name) => node.getAttribute?.(name) ?? null;

/**
 * @param {HtmlNode} node
 * @param {Marks} marks the marks of the parent
 * @returns {Marks}
 */
function marksOf(node, marks) {
  const next = { ...marks };
  const name = node.nodeName;
  const style = (attr(node, 'style') ?? '').toLowerCase();
  const weight = /font-weight\s*:\s*([a-z0-9]+)/.exec(style)?.[1];
  const notBold = weight === 'normal' || weight === '400' || (weight !== undefined && Number(weight) < 600);
  if ((name === 'B' || name === 'STRONG') && !notBold) next.strong = true;
  if (weight === 'bold' || weight === 'bolder' || (weight !== undefined && Number(weight) >= 600)) next.strong = true;
  if (notBold && name !== 'B' && name !== 'STRONG') delete next.strong;
  if (name === 'EM' || name === 'I' || /font-style\s*:\s*italic/.test(style)) next.em = true;
  if (/font-style\s*:\s*normal/.test(style)) delete next.em;
  if (name === 'CODE' || name === 'KBD' || name === 'SAMP' || name === 'TT') next.code = true;
  if (name === 'A') {
    const href = normalizeHref(attr(node, 'href') ?? '');
    if (href) next.link = { href };
  }
  return next;
}

/** @param {HtmlNode} node */
function textOf(node) {
  if (node.nodeType === 3) return node.data ?? '';
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeName === 'BR') out += '\n';
    else out += textOf(child);
  }
  return out;
}

/**
 * Collapses whitespace like a browser would, and trims the ends of a field.
 * @param {Run[]} runs
 * @returns {Run[]}
 */
function tidyRuns(runs) {
  /** @type {Run[]} */
  const out = [];
  for (const run of runs) {
    if (run.type !== 'text') {
      out.push(run);
      continue;
    }
    let text = run.marks.code ? run.text.replace(/\s+/g, ' ') : run.text.replace(/[ \t\n\r\f]+/g, ' ');
    const prev = out[out.length - 1];
    if ((!prev || prev.type === 'break' || (prev.type === 'text' && prev.text.endsWith(' '))) && text.startsWith(' ')) text = text.slice(1);
    if (text) out.push({ ...run, text });
  }
  // Trailing spaces and breaks are invisible at the end of a block.
  while (out.length) {
    const last = out[out.length - 1];
    if (last.type === 'break') out.pop();
    else if (last.type === 'text' && last.text.endsWith(' ')) {
      const trimmed = last.text.replace(/ +$/, '');
      if (trimmed) {
        out[out.length - 1] = { ...last, text: trimmed };
        break;
      }
      out.pop();
    } else break;
  }
  // Spaces right before a break are not shown either.
  return normalizeRuns(out.map((r, i) => (r.type === 'text' && out[i + 1]?.type === 'break' ? { ...r, text: r.text.replace(/ +$/, '') } : r)));
}

/**
 * @param {HtmlNode} root a parsed document or fragment (its body, ideally)
 * @returns {HtmlResult}
 */
export function htmlToBlocks(root) {
  /** @type {Block[]} */
  const out = [];
  let skippedImages = 0;
  /** @type {Run[]} */
  let inline = [];

  function flush() {
    const runs = tidyRuns(inline);
    inline = [];
    if (runs.length) out.push(make.paragraph(runs));
  }

  /**
   * Inline content of a node, as runs.
   * @param {HtmlNode} node
   * @param {Marks} marks
   * @param {Run[]} into
   */
  function collect(node, marks, into) {
    if (node.nodeType === 3) {
      if (node.data) into.push(textRun(node.data, marks));
      return;
    }
    if (node.nodeType !== 1 || SKIP.has(node.nodeName) || attr(node, 'data-atom') !== null || attr(node, 'data-control') !== null) return;
    if (node.nodeName === 'IMG') {
      skippedImages++;
      return;
    }
    if (node.nodeName === 'BR') {
      into.push({ type: 'break', marks: {} });
      return;
    }
    const next = marksOf(node, marks);
    for (const child of Array.from(node.childNodes)) {
      // A block inside inline content (a <p> inside an <a>...) still ends the line.
      if (child.nodeType === 1 && BLOCKS.has(child.nodeName) && child.nodeName !== 'BODY') {
        if (into.length) into.push({ type: 'break', marks: {} });
        collect(child, next, into);
      } else collect(child, next, into);
    }
  }

  /** @param {HtmlNode} list @param {Run[][]} items */
  function listItems(list, items) {
    for (const li of Array.from(list.childNodes)) {
      if (li.nodeType !== 1) continue;
      if (li.nodeName === 'UL' || li.nodeName === 'OL') {
        listItems(li, items);
        continue;
      }
      /** @type {Run[]} */
      const runs = [];
      /** @type {HtmlNode[]} */
      const nested = [];
      for (const child of Array.from(li.childNodes)) {
        if (child.nodeName === 'UL' || child.nodeName === 'OL') nested.push(child);
        else collect(child, {}, runs);
      }
      const tidy = tidyRuns(runs);
      if (tidy.length) items.push(tidy);
      for (const n of nested) listItems(n, items);
    }
  }

  /** @param {HtmlNode} node */
  function walk(node) {
    if (node.nodeType === 3) {
      collect(node, {}, inline);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    const name = node.nodeName;
    if (SKIP.has(name) || attr(node, 'data-control') !== null) return;
    if (!BLOCKS.has(name) && node.nodeType === 1) {
      // Inline element: Google Docs wraps the whole document in a <b>, so an
      // inline element that contains blocks is walked as a container.
      if (Array.from(node.childNodes).some((c) => c.nodeType === 1 && BLOCKS.has(c.nodeName))) {
        for (const child of Array.from(node.childNodes)) walk(child);
      } else collect(node, {}, inline);
      return;
    }
    if (/^H[1-6]$/.test(name)) {
      flush();
      /** @type {Run[]} */
      const runs = [];
      collect(node, {}, runs);
      const tidy = tidyRuns(runs).map((r) => (r.type === 'break' ? textRun(' ') : r));
      if (tidy.length) out.push(make.heading(Math.min(Math.max(Number(name[1]), 2), 4), normalizeRuns(tidy)));
      return;
    }
    if (name === 'BLOCKQUOTE') {
      flush();
      /** @type {Run[]} */
      const runs = [];
      collect(node, {}, runs);
      const tidy = tidyRuns(runs);
      if (tidy.length) out.push(make.quote(tidy));
      return;
    }
    if (name === 'UL' || name === 'OL') {
      flush();
      /** @type {Run[][]} */
      const items = [];
      listItems(node, items);
      const start = Number(attr(node, 'start') ?? '1');
      if (items.length) out.push(make.list({ ordered: name === 'OL', start: Number.isInteger(start) && start >= 0 ? start : 1, items }));
      return;
    }
    if (name === 'PRE') {
      flush();
      const code = Array.from(node.childNodes).find((c) => c.nodeName === 'CODE');
      const lang = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(attr(code ?? node, 'class') ?? '')?.[1] ?? '';
      const text = textOf(node).replace(/\n$/, '');
      if (text.trim()) out.push(make.code(lang, text));
      return;
    }
    if (name === 'HR') {
      flush();
      out.push(make.hr());
      return;
    }
    // Any other block container: its own paragraphs, one per inline run.
    flush();
    for (const child of Array.from(node.childNodes)) walk(child);
    flush();
  }

  walk(root);
  flush();
  return { blocks: out, skippedImages };
}
