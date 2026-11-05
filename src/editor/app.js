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

import { parseMarkdown } from '../markdown/parse.js';
import { serializeMarkdown } from '../markdown/serialize.js';
import { metaEdit, metaOf, newPost, referencedImages, updateMeta, validatePost } from '../hugo/post.js';
import { imageName, toWebp } from '../media/webp.js';
import { createEditor } from './editor.js';
import { createMetaForm } from './meta-form.js';
import { createToolbar } from './toolbar.js';

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const openInput = /** @type {HTMLInputElement} */ (byId('open'));
const newButton = byId('new');
const status = byId('status');
const empty = byId('empty');
const surface = byId('editor');
const sourcePanel = byId('source-panel');
const sourceView = byId('source');

/** blob: URLs of the images of the open post, revoked when another post is opened. */
let imageUrls = new Map();
/**
 * Images added in the editor, already converted to WebP, by file name. They
 * will be uploaded with the post; until then they only live here.
 * @type {Map<string, Uint8Array>}
 */
let newImages = new Map();
/** What the open post looked like on disk, or null for a new post. */
let opened = /** @type {{ name: string, source: string } | null} */ (null);
let dirty = false;
/** Language of a new post (an opened one keeps the folder it came from). */
let lang = 'es';
/** The slug of an opened post: published, so it must not change. */
let publishedSlug = /** @type {string | undefined} */ (undefined);
/** Whether slug and translationKey still follow the title (new posts only). */
const follow = { slugFollowsTitle: true, keyFollowsSlug: true };

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
  onImages: (files, at) => {
    addImages(files, at).catch((err) => setStatus(`No se ha podido añadir la imagen: ${err instanceof Error ? err.message : String(err)}`, 'error'));
  },
  onNotice: (message) => setStatus(message, 'error'),
});

/**
 * Converts images to WebP, names them after the post's slug (as the blog
 * does: hazme-casio.webp, wireguard-openwrt-2.webp) and inserts them.
 * @param {File[]} files
 * @param {import('../model/editing.js').Selection | null} at
 */
async function addImages(files, at) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  const doc = editor.getDocument();
  const slug = String(metaOf(doc).slug ?? '');
  const taken = [...imageUrls.keys(), ...referencedImages(doc).map((i) => localName(i.src))];
  /** @type {{ src: string, alt: string }[]} */
  const added = [];
  for (const [i, file] of images.entries()) {
    setStatus(`Convirtiendo ${file.name} a WebP${images.length > 1 ? ` (${i + 1} de ${images.length})` : ''}…`);
    const { bytes, width, height } = await toWebp(file);
    const name = imageName(slug || file.name, taken);
    taken.push(name);
    newImages.set(name, bytes);
    imageUrls.set(name, URL.createObjectURL(new Blob([bytes], { type: 'image/webp' })));
    added.push({ src: name, alt: '' });
    console.info(`${file.name} -> ${name}: ${width}x${height}, ${Math.round(bytes.length / 1024)} KB`);
  }
  editor.insertImages(added, at);
  setStatus(`${added.length === 1 ? 'Imagen añadida' : `${added.length} imágenes añadidas`}: ${added.map((a) => a.src).join(', ')}. Escribe el texto alternativo.`);
}

const imageInput = /** @type {HTMLInputElement} */ (byId('image-input'));
imageInput.addEventListener('change', () => {
  const files = [...(imageInput.files ?? [])];
  imageInput.value = '';
  addImages(files, null).catch((err) => setStatus(`No se ha podido añadir la imagen: ${err instanceof Error ? err.message : String(err)}`, 'error'));
});

const metaForm = createMetaForm(document, {
  onEdit(field, value) {
    // Typing a slug or key by hand stops it following; emptying it resumes.
    if (field === 'slug') follow.slugFollowsTitle = value === '';
    if (field === 'translationKey') follow.keyFollowsSlug = value === '';
    const changes = metaEdit(field, value, follow);
    if (publishedSlug !== undefined) {
      delete changes.slug;
      delete changes.translationKey;
    }
    editor.transform((doc) => updateMeta(doc, changes), `meta:${field}`);
  },
  onLang(value) {
    lang = value;
    refresh();
  },
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
  metaForm.sync(metaOf(doc), validatePost(doc, { images: [...imageUrls.keys()], publishedSlug }), lang);

  // Serializing the whole post on every key is cheap, but not needed more
  // than a few times per second.
  clearTimeout(pending);
  pending = window.setTimeout(() => {
    sourceView.textContent = serializeMarkdown(editor.getDocument());
  }, 150);
}

/** @param {'new' | 'published'} mode */
function show(mode) {
  empty.hidden = true;
  metaForm.show(mode);
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
  newImages = new Map();
  imageUrls = new Map(files.filter((f) => f.type.startsWith('image/')).map((f) => [f.name, URL.createObjectURL(f)]));

  const doc = parseMarkdown(source);
  opened = { name: file.name, source };
  publishedSlug = String(metaOf(doc).slug ?? '') || undefined;
  follow.slugFollowsTitle = false;
  follow.keyFollowsSlug = false;
  editor.setDocument(doc);
  dirty = serializeMarkdown(editor.getDocument()) !== source;
  show('published');
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
  newImages = new Map();
  imageUrls = new Map();
  opened = null;
  dirty = false;
  publishedSlug = undefined;
  follow.slugFollowsTitle = true;
  follow.keyFollowsSlug = true;
  editor.setDocument(newPost({ lang, title: '' }));
  show('new');
  refresh();
  byId('meta-title').focus();
});

window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});
