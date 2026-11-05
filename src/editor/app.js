// @ts-check
/**
 * Entry point of the editor page.
 *
 * Start a new post, open one from a local copy of the blog or pick up a
 * draft, and edit it with the keyboard and the toolbar. The Markdown panel
 * shows, live, what would be written.
 *
 * Every change is saved as a draft in this browser (IndexedDB) a moment
 * later, images included, so closing the tab or switching posts loses
 * nothing. Nothing is uploaded yet.
 *
 * To open a post, the user picks its .md file and, optionally, its images in
 * the same dialog. Images are shown through blob: URLs.
 */

import { parseMarkdown } from '../markdown/parse.js';
import { serializeMarkdown } from '../markdown/serialize.js';
import { metaEdit, metaOf, newPost, referencedImages, updateMeta, validatePost } from '../hugo/post.js';
import { imageName, toWebp } from '../media/webp.js';
import { describeWhen, fromDraft, toDraft, worthSaving } from '../storage/draft.js';
import { deleteDraft, listDrafts, saveDraft } from '../storage/drafts.js';
import { createEditor } from './editor.js';
import { createMetaForm } from './meta-form.js';
import { createToolbar } from './toolbar.js';

/**
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {import('../storage/draft.js').Draft} Draft
 * @typedef {import('../storage/draft.js').Session} Session
 * @typedef {{ blob: Blob, isNew: boolean, url: string }} PostImage
 *   isNew: added in the editor, to upload with the post
 */

/** @param {string} id */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {unknown} err */
const message = (err) => (err instanceof Error ? err.message : String(err));

const openInput = /** @type {HTMLInputElement} */ (byId('open'));
const status = byId('status');
const empty = byId('empty');
const surface = byId('editor');
const sourcePanel = byId('source-panel');
const sourceView = byId('source');
const draftsButton = byId('drafts');
const draftsPanel = byId('drafts-panel');
const draftsList = byId('drafts-list');

/** The images of the post being edited, by file name. */
let images = /** @type {Map<string, PostImage>} */ (new Map());
/** What the open post looked like on disk, or null for a new post. */
let opened = /** @type {{ name: string, source: string } | null} */ (null);
let dirty = false;
/** Language of a new post (an opened one keeps the folder it came from). */
let lang = 'es';
/** The slug of an opened post: published, so it must not change. */
let publishedSlug = /** @type {string | null} */ (null);
/** Whether slug and translationKey still follow the title (new posts only). */
let follow = { slugFollowsTitle: true, keyFollowsSlug: true };

/** The draft this session saves to, and its state. */
let draftId = /** @type {string | null} */ (null);
let draftStored = false;
let unsaved = false;
let savedAt = /** @type {Date | null} */ (null);
let saveTimer = 0;

/** @param {string} src */
const localName = (src) => src.replace(/^\.\//, '');

const toolbar = createToolbar(document, () => editor, setStatus);
const editor = createEditor(surface, {
  imageUrl: (src) => images.get(localName(src))?.url,
  onChange: (doc) => {
    dirty = opened ? serializeMarkdown(doc) !== opened.source : true;
    scheduleSave();
    refresh();
  },
  onSelectionChange: (state) => toolbar.update(state),
  onLinkRequest: () => toolbar.openLink(),
  onImages: (files, at) => {
    addImages(files, at).catch((err) => setStatus(`No se ha podido añadir la imagen: ${message(err)}`, 'error'));
  },
  onNotice: (text) => setStatus(text, 'error'),
});

const metaForm = createMetaForm(document, {
  onEdit(field, value) {
    // Typing a slug or key by hand stops it following; emptying it resumes.
    if (field === 'slug') follow.slugFollowsTitle = value === '';
    if (field === 'translationKey') follow.keyFollowsSlug = value === '';
    const changes = metaEdit(field, value, follow);
    if (publishedSlug !== null) {
      delete changes.slug;
      delete changes.translationKey;
    }
    editor.transform((doc) => updateMeta(doc, changes), `meta:${field}`);
  },
  onLang(value) {
    lang = value;
    scheduleSave();
    refresh();
  },
});

/** @param {string} text @param {'info' | 'error'} [kind] */
function setStatus(text, kind = 'info') {
  status.textContent = text;
  status.dataset.kind = kind;
}

let pendingSource = 0;
function refresh() {
  const doc = editor.getDocument();
  const parts = [opened ? opened.name : 'Post nuevo', `${doc.blocks.length} ${doc.blocks.length === 1 ? 'bloque' : 'bloques'}`];
  const raw = doc.blocks.filter((b) => b.type === 'raw').length;
  if (raw) parts.push(`${raw} sin editar`);
  if (opened) parts.push(dirty ? 'con cambios' : 'sin cambios');
  const missing = referencedImages(doc).filter((img) => !images.has(localName(img.src))).length;
  if (missing) parts.push(`${missing} ${missing === 1 ? 'imagen sin cargar' : 'imágenes sin cargar'}`);
  if (unsaved) parts.push('guardando borrador…');
  else if (draftStored && savedAt) parts.push(`borrador guardado ${describeWhen(savedAt.toISOString())}`);
  setStatus(parts.join(' · '));
  metaForm.sync(metaOf(doc), validatePost(doc, { images: [...images.keys()], publishedSlug: publishedSlug ?? undefined }), lang);

  // Serializing the whole post on every key is cheap, but not needed more
  // than a few times per second.
  clearTimeout(pendingSource);
  pendingSource = window.setTimeout(() => {
    sourceView.textContent = serializeMarkdown(editor.getDocument());
  }, 150);
}

// Drafts

/** @returns {Session | null} */
function currentSession() {
  if (!draftId) return null;
  return {
    id: draftId,
    doc: editor.getDocument(),
    lang,
    opened,
    publishedSlug,
    follow: { ...follow },
    images: [...images].map(([name, img]) => ({ name, blob: img.blob, isNew: img.isNew })),
  };
}

function scheduleSave() {
  if (!draftId) return;
  unsaved = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), 800);
}

/** Saves the session now. Keeps nothing for an empty new post, and removes the draft of a post that is back to its original. */
async function saveNow() {
  clearTimeout(saveTimer);
  const session = currentSession();
  if (!session || !unsaved) return;
  try {
    if (worthSaving(session)) {
      await saveDraft(toDraft(session));
      draftStored = true;
      savedAt = new Date();
    } else if (draftStored) {
      await deleteDraft(session.id);
      draftStored = false;
    }
    unsaved = false;
    refresh();
  } catch (err) {
    setStatus(`No se ha podido guardar el borrador: ${message(err)}`, 'error');
  }
  if (!draftsPanel.hidden) void showDrafts();
}

/**
 * Switches to another post. The current one is saved first.
 * @param {Session} session
 * @param {{ stored: boolean, savedAt?: string }} draft whether the session already has a stored draft
 */
async function startSession(session, draft) {
  await saveNow();
  for (const img of images.values()) URL.revokeObjectURL(img.url);
  images = new Map(session.images.map((img) => [img.name, { blob: img.blob, isNew: img.isNew, url: URL.createObjectURL(img.blob) }]));
  opened = session.opened;
  lang = session.lang;
  publishedSlug = session.publishedSlug;
  follow = { ...session.follow };
  draftId = session.id;
  draftStored = draft.stored;
  savedAt = draft.savedAt ? new Date(draft.savedAt) : null;
  unsaved = false;
  editor.setDocument(session.doc);
  const doc = editor.getDocument();
  dirty = opened ? serializeMarkdown(doc) !== opened.source : worthSaving({ ...session, doc });
  empty.hidden = true;
  draftsPanel.hidden = true;
  metaForm.show(opened ? 'published' : 'new');
  surface.hidden = false;
  sourcePanel.hidden = false;
  toolbar.show(true);
  refresh();
}

async function showDrafts() {
  let drafts;
  try {
    drafts = await listDrafts();
  } catch (err) {
    setStatus(`No se pueden leer los borradores: ${message(err)}`, 'error');
    return;
  }
  draftsList.replaceChildren(...drafts.map(draftItem));
  if (!drafts.length) {
    const li = document.createElement('li');
    li.className = 'hint';
    li.textContent = 'No hay borradores.';
    draftsList.append(li);
  }
  draftsPanel.hidden = false;
}

/** @param {Draft} draft */
function draftItem(draft) {
  const li = document.createElement('li');
  const info = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = draft.title.trim() || '(sin título)';
  const detail = document.createElement('span');
  detail.className = 'hint';
  const kind = draft.opened ? `cambios en ${draft.publishedSlug ?? draft.opened.name}` : 'post nuevo';
  const count = draft.images.filter((i) => i.isNew).length;
  detail.textContent = ` · ${kind} · ${describeWhen(draft.updatedAt)}${count ? ` · ${count} ${count === 1 ? 'imagen nueva' : 'imágenes nuevas'}` : ''}${draft.id === draftId ? ' · abierto' : ''}`;
  info.append(title, detail);

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'button';
  openButton.textContent = 'Abrir';
  openButton.disabled = draft.id === draftId;
  openButton.addEventListener('click', () => {
    startSession(fromDraft(draft), { stored: true, savedAt: draft.updatedAt }).catch((err) => setStatus(message(err), 'error'));
  });

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'button';
  removeButton.textContent = 'Borrar';
  // Two clicks instead of a confirm() dialog.
  removeButton.addEventListener('click', async () => {
    if (removeButton.dataset.armed !== 'true') {
      removeButton.dataset.armed = 'true';
      removeButton.textContent = '¿Seguro? Pulsa otra vez';
      return;
    }
    try {
      await deleteDraft(draft.id);
      if (draft.id === draftId) {
        draftStored = false;
        unsaved = false;
        clearTimeout(saveTimer);
        // The open post keeps going; its next change creates the draft again.
      }
      refresh();
      await showDrafts();
    } catch (err) {
      setStatus(`No se ha podido borrar el borrador: ${message(err)}`, 'error');
    }
  });

  li.append(info, openButton, removeButton);
  return li;
}

draftsButton.addEventListener('click', () => {
  if (draftsPanel.hidden) void showDrafts();
  else draftsPanel.hidden = true;
});

// Images

/**
 * Converts images to WebP, names them after the post's slug (as the blog
 * does: hazme-casio.webp, wireguard-openwrt-2.webp) and inserts them.
 * @param {File[]} files
 * @param {import('../model/editing.js').Selection | null} at
 */
async function addImages(files, at) {
  const picked = files.filter((f) => f.type.startsWith('image/'));
  if (!picked.length) return;
  const doc = editor.getDocument();
  const slug = String(metaOf(doc).slug ?? '');
  const taken = [...images.keys(), ...referencedImages(doc).map((i) => localName(i.src))];
  /** @type {{ src: string, alt: string }[]} */
  const added = [];
  for (const [i, file] of picked.entries()) {
    setStatus(`Convirtiendo ${file.name} a WebP${picked.length > 1 ? ` (${i + 1} de ${picked.length})` : ''}…`);
    const { bytes, width, height } = await toWebp(file);
    const name = imageName(slug || file.name, taken);
    taken.push(name);
    const blob = new Blob([bytes], { type: 'image/webp' });
    images.set(name, { blob, isNew: true, url: URL.createObjectURL(blob) });
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
  addImages(files, null).catch((err) => setStatus(`No se ha podido añadir la imagen: ${message(err)}`, 'error'));
});

// New and open

/** @param {File[]} files */
async function open(files) {
  const markdown = files.filter((f) => /\.(md|markdown)$/i.test(f.name));
  if (markdown.length !== 1) {
    setStatus('Elige un solo fichero .md y, si quieres verlas, sus imágenes.', 'error');
    return;
  }
  const [file] = markdown;
  const source = await file.text();
  const doc = parseMarkdown(source);
  const slug = String(metaOf(doc).slug ?? '') || null;
  await startSession(
    {
      id: crypto.randomUUID(),
      doc,
      lang,
      opened: { name: file.name, source },
      publishedSlug: slug,
      follow: { slugFollowsTitle: false, keyFollowsSlug: false },
      images: files.filter((f) => f.type.startsWith('image/')).map((f) => ({ name: f.name, blob: f, isNew: false })),
    },
    { stored: false },
  );
  if (dirty) {
    setStatus(`${file.name}: ATENCIÓN, este post no se guardaría idéntico aunque no lo toques.`, 'error');
  } else {
    // A draft of this same post (same original file) would be lost from sight otherwise.
    const earlier = (await listDrafts()).find((d) => d.opened?.source === source && d.id !== draftId);
    if (earlier) setStatus(`Tienes un borrador de este post de ${describeWhen(earlier.updatedAt)}: está en Borradores.`);
  }
  editor.focus();
}

openInput.addEventListener('change', () => {
  const files = [...(openInput.files ?? [])];
  openInput.value = '';
  open(files).catch((err) => setStatus(`No se ha podido abrir el post: ${message(err)}`, 'error'));
});

byId('new').addEventListener('click', () => {
  const session = {
    id: crypto.randomUUID(),
    doc: newPost({ lang, title: '' }),
    lang,
    opened: null,
    publishedSlug: null,
    follow: { slugFollowsTitle: true, keyFollowsSlug: true },
    images: [],
  };
  startSession(session, { stored: false })
    .then(() => byId('meta-title').focus())
    .catch((err) => setStatus(message(err), 'error'));
});

window.addEventListener('beforeunload', (event) => {
  if (!unsaved) return;
  void saveNow();
  event.preventDefault();
});

// The start page lists the drafts, if there are any.
listDrafts()
  .then((drafts) => {
    if (drafts.length) void showDrafts();
  })
  .catch(() => {
    // Without IndexedDB (a private window in some browsers) the editor still works, without drafts.
  });
