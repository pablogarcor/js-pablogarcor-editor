// @ts-check
/**
 * What the editor shows for a document, as a tree of plain objects (vnodes).
 *
 * No DOM here: `dom.js` turns vnodes into elements. Keeping the view pure
 * lets the Node tests check exactly what the editor shows, including for
 * every real post of the blog.
 *
 * Inline runs are rendered one by one, each wrapped in its marks (link >
 * strong > em > code, outermost first). Phase 2 maps DOM selections back to
 * run offsets, and one element per run keeps that mapping simple.
 *
 * Links are not rendered as <a>: inside an editor a click must not navigate.
 * The target is shown as the element's title.
 */

import { FIELD_ORDER, metaOf } from '../hugo/post.js';
import { serializeMarkdown } from '../markdown/serialize.js';

/**
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {import('../model/document.js').Block} Block
 * @typedef {import('../model/inline.js').Run} Run
 * @typedef {{ tag: string, attrs?: Record<string, string>, children?: VChild[] }} VNode
 * @typedef {VNode | string} VChild
 * @typedef {{ imageUrl?: (src: string) => string | undefined }} ViewOptions
 *   imageUrl: the URL to show for an image of the post (for example a blob:
 *   URL of a file the user opened); undefined shows a placeholder
 */

/**
 * @param {string} tag
 * @param {Record<string, string | undefined>} [attrs]
 * @param {VChild[]} [children]
 * @returns {VNode}
 */
export function h(tag, attrs = {}, children = []) {
  /** @type {Record<string, string>} */
  const clean = {};
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) clean[k] = v;
  /** @type {VNode} */
  const node = { tag };
  if (Object.keys(clean).length) node.attrs = clean;
  if (children.length) node.children = children;
  return node;
}

/**
 * @param {Run[]} runs
 * @param {ViewOptions} [opts]
 * @returns {VChild[]}
 */
export function renderRuns(runs, opts = {}) {
  return runs.map((run) => {
    /** @type {VChild} */
    let node;
    if (run.type === 'text') node = run.text;
    else if (run.type === 'break') node = h('br');
    else if (run.type === 'html') node = h('code', { class: 'inline-html' }, [run.html]);
    else node = renderImage(run.src, run.alt, opts, 'span');
    const m = run.marks;
    if (m.code) node = h('code', {}, [node]);
    if (m.em) node = h('em', {}, [node]);
    if (m.strong) node = h('strong', {}, [node]);
    if (m.link) node = h('span', { class: 'link', title: m.link.href }, [node]);
    return node;
  });
}

/**
 * An image, or a placeholder when its file is not available.
 * @param {string} src
 * @param {string} alt
 * @param {ViewOptions} opts
 * @param {string} placeholderTag
 * @returns {VNode}
 */
function renderImage(src, alt, opts, placeholderTag) {
  const url = opts.imageUrl?.(src);
  if (url) return h('img', { src: url, alt });
  return h(placeholderTag, { class: 'image-missing', title: src }, [`Imagen no cargada: ${alt || src}`]);
}

/**
 * @param {Block} block
 * @param {ViewOptions} [opts]
 * @returns {VNode}
 */
export function renderBlock(block, opts = {}) {
  const attrs = { class: `block block-${block.type}`, 'data-block-id': block.id };
  switch (block.type) {
    case 'paragraph':
      return h('p', attrs, renderRuns(block.runs, opts));
    case 'heading':
      return h(`h${Math.min(Math.max(block.level, 1), 6)}`, attrs, renderRuns(block.runs, opts));
    case 'quote':
      return h('blockquote', attrs, [h('p', {}, renderRuns(block.runs, opts))]);
    case 'list': {
      const items = block.items.map((item) => h('li', {}, renderRuns(item.runs, opts)));
      if (!block.ordered) return h('ul', attrs, items);
      return h('ol', { ...attrs, start: block.start === 1 ? undefined : String(block.start) }, items);
    }
    case 'code':
      return h('pre', { ...attrs, 'data-lang': block.info || undefined }, [h('code', {}, [block.text])]);
    case 'image':
      return h('figure', attrs, [
        renderImage(block.src, block.alt, opts, 'div'),
        ...(block.title ? [h('figcaption', {}, [block.title])] : []),
      ]);
    case 'hr':
      return h('hr', attrs);
    case 'raw':
      return h('div', attrs, [h('div', { class: 'raw-label' }, ['Markdown sin editar']), h('pre', {}, [block.source])]);
  }
}

/**
 * The front matter as a definition list: the blog's fields in their usual
 * order first, then any other field.
 * @param {Doc} doc
 * @returns {VNode}
 */
export function renderMeta(doc) {
  const meta = metaOf(doc);
  const keys = [...FIELD_ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !FIELD_ORDER.includes(k))];
  /** @type {VChild[]} */
  const rows = keys.flatMap((k) => {
    const v = meta[k];
    const value = Array.isArray(v) ? v.join(', ') : String(v);
    return [h('dt', {}, [k]), h('dd', {}, [value])];
  });
  return h('dl', { class: 'meta' }, rows);
}

/**
 * @param {Doc} doc
 * @param {ViewOptions} [opts]
 * @returns {VNode}
 */
export function renderDocument(doc, opts = {}) {
  return h('article', { class: 'post' }, [renderMeta(doc), ...doc.blocks.map((b) => renderBlock(b, opts))]);
}

/**
 * Facts about an opened post for the status line.
 * @param {Doc} doc
 * @param {string} source the file the document was parsed from
 */
export function summarize(doc, source) {
  return {
    blocks: doc.blocks.length,
    raw: doc.blocks.filter((b) => b.type === 'raw').length,
    lossless: serializeMarkdown(doc) === source,
  };
}
