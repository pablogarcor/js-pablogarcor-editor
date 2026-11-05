// @ts-check
/**
 * Entry point of the editor page. Phase 1: open a post from a local copy of
 * the blog and show it, read only.
 *
 * The user picks the post's .md file and, optionally, its images in the same
 * dialog. Images are shown through blob: URLs of those files; nothing is
 * uploaded anywhere.
 */

import { parseMarkdown } from '../markdown/parse.js';
import { referencedImages } from '../hugo/post.js';
import { mount } from './dom.js';
import { renderDocument, summarize } from './view.js';

const input = /** @type {HTMLInputElement} */ (document.getElementById('open'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const main = /** @type {HTMLElement} */ (document.getElementById('post'));

/** blob: URLs of the images of the open post, revoked when another post is opened. */
let imageUrls = new Map();

/** @param {string} src */
const localName = (src) => src.replace(/^\.\//, '');

/** @param {string} message @param {'info' | 'error'} [kind] */
function setStatus(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

/** @param {File[]} files */
async function open(files) {
  const markdown = files.filter((f) => /\.(md|markdown)$/i.test(f.name));
  if (markdown.length !== 1) {
    setStatus('Elige un solo fichero .md y, si quieres verlas, sus imágenes.', 'error');
    return;
  }
  const [file] = markdown;
  let source;
  try {
    source = await file.text();
  } catch (err) {
    setStatus(`No se ha podido leer ${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return;
  }

  for (const url of imageUrls.values()) URL.revokeObjectURL(url);
  imageUrls = new Map(files.filter((f) => f.type.startsWith('image/')).map((f) => [f.name, URL.createObjectURL(f)]));

  const doc = parseMarkdown(source);
  mount(main, renderDocument(doc, { imageUrl: (src) => imageUrls.get(localName(src)) }));

  const facts = summarize(doc, source);
  const missing = referencedImages(doc).filter((img) => !imageUrls.has(localName(img.src))).length;
  const parts = [
    file.name,
    `${facts.blocks} bloques${facts.raw ? `, ${facts.raw} sin editar` : ''}`,
    facts.lossless ? 'se guardaría idéntico' : 'ATENCIÓN: no se guardaría idéntico',
  ];
  if (missing) parts.push(`${missing} ${missing === 1 ? 'imagen sin cargar' : 'imágenes sin cargar'}`);
  setStatus(parts.join(' · '), facts.lossless ? 'info' : 'error');
}

input.addEventListener('change', () => {
  const files = [...(input.files ?? [])];
  input.value = '';
  open(files).catch((err) => setStatus(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`, 'error'));
});
