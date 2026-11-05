// @ts-check
/**
 * Entry point of the editor page.
 *
 * Start a new post or open one from a local copy of the blog, and edit it
 * with the keyboard and the toolbar. The Markdown panel shows, live, what
 * would be written. Nothing is saved or uploaded yet.
 *
 * To open a post, the user picks its .md file and, optionally, its images in
 * the same dialog. Images are shown through blob: URLs of those files.
 */

import { blocks, createDocument } from '../model/document.js';
import { parseMarkdown } from '../markdown/parse.js';
import { serializeMarkdown } from '../markdown/serialize.js';
import { referencedImages } from '../hugo/post.js';
import { mount } from './dom.js';
import { createEditor } from './editor.js';
import { createToolbar } from './toolbar.js';
import { renderMeta } from './view.js';

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const openInput = /** @type {HTMLInputElement} */ (byId('open'));
const newButton = byId('new');
const status = byId('status');
const empty = byId('empty');
const meta = byId('meta');
const surface = byId('editor');
const sourcePanel = byId('source-panel');
const sourceView = byId('source');

/** blob: URLs of the images of the open post, revoked when another post is opened. */
let imageUrls = new Map();
/** What the open post looked like on disk, or null for a new post. */
let opened = /** @type {{ name: string, source: string } | null} */ (null);
let dirty = false;

/** @param {string} src */
const localName = (src) => src.replace(/^\.\//, '');

const toolbar = createToolbar(document, () => editor, setStatus);
const editor = createEditor(surface, {
  imageUrl: (src) => imageUrls.get(localName(src)),
  onChange: (doc) => {
    dirty = opened ? serializeMarkdown(doc) !== opened.source : true;
    refresh();
  },
  onSelectionChange: (state) => toolbar.update(state),
  onLinkRequest: () => toolbar.openLink(),
});

/** @param {string} message @param {'info' | 'error'} [kind] */
function setStatus(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

let pending = 0;
function refresh() {
  const doc = editor.getDocument();
  const parts = [opened ? opened.name : 'Post nuevo', `${doc.blocks.length} ${doc.blocks.length === 1 ? 'bloque' : 'bloques'}`];
  const raw = doc.blocks.filter((b) => b.type === 'raw').length;
  if (raw) parts.push(`${raw} sin editar`);
  parts.push(dirty ? 'con cambios' : 'sin cambios');
  const missing = referencedImages(doc).filter((img) => !imageUrls.has(localName(img.src))).length;
  if (missing) parts.push(`${missing} ${missing === 1 ? 'imagen sin cargar' : 'imágenes sin cargar'}`);
  setStatus(parts.join(' · '));

  // Serializing the whole post on every key is cheap, but not needed more
  // than a few times per second.
  clearTimeout(pending);
  pending = window.setTimeout(() => {
    sourceView.textContent = serializeMarkdown(editor.getDocument());
  }, 150);
}

/** @param {boolean} hasMeta */
function show(hasMeta) {
  empty.hidden = true;
  meta.hidden = !hasMeta;
  surface.hidden = false;
  sourcePanel.hidden = false;
  toolbar.show(true);
}

function confirmDiscard() {
  return !dirty || window.confirm('Hay cambios sin guardar. ¿Descartarlos?');
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
  opened = { name: file.name, source };
  mount(meta, renderMeta(doc));
  editor.setDocument(doc);
  dirty = serializeMarkdown(editor.getDocument()) !== source;
  show(true);
  refresh();
  if (dirty) setStatus(`${file.name}: ATENCIÓN, este post no se guardaría idéntico aunque no lo toques.`, 'error');
  editor.focus();
}

openInput.addEventListener('change', () => {
  const files = [...(openInput.files ?? [])];
  openInput.value = '';
  if (!confirmDiscard()) return;
  open(files).catch((err) => setStatus(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`, 'error'));
});

newButton.addEventListener('click', () => {
  if (!confirmDiscard()) return;
  for (const url of imageUrls.values()) URL.revokeObjectURL(url);
  imageUrls = new Map();
  opened = null;
  dirty = false;
  editor.setDocument(createDocument({ blocks: [blocks.paragraph()] }));
  show(false);
  refresh();
  editor.focus();
});

window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});
