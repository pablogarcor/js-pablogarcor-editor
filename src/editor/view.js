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
 *
 * Markers the editor relies on (see selection.js):
 *  - `data-field="<item>"` on every element holding a text field (item is 0
 *    except in lists), inside the element with `data-block-id`;
 *  - `data-atom` on inline images and HTML: one position in the model,
 *    whatever text they show, and not editable;
 *  - `data-filler` on a trailing <br> that only gives an empty field (or a
 *    field ending in a line break) its last line. It is not content;
 *  - contenteditable="false" on blocks that are not text.
 */

import { FIELD_ORDER, metaOf } from '../hugo/post.js';
import { serializeMarkdown } from '../markdown/serialize.js';

/**
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {import('../model/document.js').Block} Block
 * @typedef {import('../model/inline.js').Run} Run
 * @typedef {{ tag: string, attrs?: Record<string, string>, children?: VChild[] }} VNode
 * @typedef {VNode | string} VChild
 * @typedef {{ imageUrl?: (src: string) => string | undefined, editable?: boolean }} ViewOptions
 *   imageUrl: the URL to show for an image of the post (for example a blob:
 *   URL of a file the user opened); undefined shows a placeholder.
 *   editable: blocks that are not text get form controls to edit them
 *   (`data-control` says which property) and a remove button
 *   (`data-action="remove"`)
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
    else if (run.type === 'html') node = h('code', { class: 'inline-html', ...ATOM }, [run.html]);
    else node = renderImage(run.src, run.alt, opts, 'span', ATOM);
    const m = run.marks;
    if (m.code) node = h('code', {}, [node]);
    if (m.em) node = h('em', {}, [node]);
    if (m.strong) node = h('strong', {}, [node]);
    if (m.link) node = h('span', { class: 'link', title: m.link.href }, [node]);
    return node;
  });
}

const ATOM = { 'data-atom': '', contenteditable: 'false' };
const FIXED = { contenteditable: 'false' };

/**
 * An image, or a placeholder when its file is not available.
 * @param {string} src
 * @param {string} alt
 * @param {ViewOptions} opts
 * @param {string} placeholderTag
 * @param {Record<string, string>} [extra]
 * @returns {VNode}
 */
function renderImage(src, alt, opts, placeholderTag, extra = {}) {
  const url = opts.imageUrl?.(src);
  if (url) return h('img', { src: url, alt, ...extra });
  return h(placeholderTag, { class: 'image-missing', title: src, ...extra }, [`Imagen no cargada: ${alt || src}`]);
}

/**
 * The content of a text field, with a filler <br> when the browser would
 * otherwise not show its last line (empty field, or one ending in a break).
 * @param {Run[]} runs
 * @param {ViewOptions} opts
 * @returns {VChild[]}
 */
function fieldContent(runs, opts) {
  const children = renderRuns(runs, opts);
  const last = runs[runs.length - 1];
  if (!last || last.type === 'break' || (last.type === 'text' && last.text.endsWith('\n'))) children.push(h('br', { 'data-filler': '' }));
  return children;
}

/**
 * @param {Block} block
 * @param {ViewOptions} [opts]
 * @returns {VNode}
 */
export function renderBlock(block, opts = {}) {
  const attrs = { class: `block block-${block.type}`, 'data-block-id': block.id };
  const field = { 'data-field': '0' };
  switch (block.type) {
    case 'paragraph':
      return h('p', { ...attrs, ...field }, fieldContent(block.runs, opts));
    case 'heading':
      return h(`h${Math.min(Math.max(block.level, 1), 6)}`, { ...attrs, ...field }, fieldContent(block.runs, opts));
    case 'quote':
      return h('blockquote', attrs, [h('p', field, fieldContent(block.runs, opts))]);
    case 'list': {
      const items = block.items.map((item, i) => h('li', { 'data-field': String(i) }, fieldContent(item.runs, opts)));
      if (!block.ordered) return h('ul', attrs, items);
      return h('ol', { ...attrs, start: block.start === 1 ? undefined : String(block.start) }, items);
    }
    case 'code':
      if (opts.editable) {
        return h('div', { ...attrs, ...FIXED }, [
          tools([
            h('input', { 'data-control': 'info', value: block.info, placeholder: 'lenguaje', 'aria-label': 'Lenguaje del código', spellcheck: 'false', size: '10' }),
          ]),
          textArea('text', block.text, 'Código'),
        ]);
      }
      return h('pre', { ...attrs, ...FIXED, 'data-lang': block.info || undefined }, [h('code', {}, [block.text])]);
    case 'image':
      return h('figure', { ...attrs, ...FIXED }, [
        renderImage(block.src, block.alt, opts, 'div'),
        ...(block.title ? [h('figcaption', {}, [block.title])] : []),
        ...(opts.editable
          ? [tools([h('input', { 'data-control': 'alt', value: block.alt, placeholder: 'Texto alternativo: describe la imagen', 'aria-label': 'Texto alternativo', class: 'grow' })])]
          : []),
      ]);
    case 'hr':
      if (opts.editable) return h('div', { ...attrs, ...FIXED }, [h('hr'), tools([])]);
      return h('hr', { ...attrs, ...FIXED });
    case 'raw':
      if (opts.editable) {
        return h('div', { ...attrs, ...FIXED }, [tools([h('span', { class: 'raw-label' }, ['Markdown sin editar'])]), textArea('source', block.source, 'Markdown sin editar')]);
      }
      return h('div', { ...attrs, ...FIXED }, [h('div', { class: 'raw-label' }, ['Markdown sin editar']), h('pre', {}, [block.source])]);
  }
}

/**
 * The control row of a block that is not text, ending with its remove button.
 * @param {VChild[]} controls
 * @returns {VNode}
 */
function tools(controls) {
  return h('div', { class: 'block-tools' }, [
    ...controls,
    h('button', { type: 'button', class: 'block-remove', 'data-action': 'remove', title: 'Eliminar bloque', 'aria-label': 'Eliminar bloque' }, ['×']),
  ]);
}

/**
 * @param {string} control
 * @param {string} value
 * @param {string} label
 * @returns {VNode}
 */
function textArea(control, value, label) {
  const rows = String(Math.max(2, value.split('\n').length));
  return h('textarea', { 'data-control': control, rows, spellcheck: 'false', 'aria-label': label }, [value]);
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
