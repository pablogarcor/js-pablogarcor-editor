// @ts-check
/**
 * Everything that knows how pablogarcor.com stores its posts. If the blog
 * changes its conventions, this is the only module to touch.
 *
 * Conventions (from the blog repo, Hugo with permalinks blog = "/:slug/"):
 *  - posts live in content/{en,es}/blog/yyyy/mm/dd/
 *  - a post with images is a leaf bundle: dd/index.md + dd/*.webp
 *  - a post without images may be a single file: dd/<slug>.md
 *  - front matter, in this order: title, date, lastmod, slug, translationKey,
 *    aliases, author, tags, description
 *  - slug is the public URL and must never change once published
 *  - translationKey pairs translations across languages; independent posts
 *    use different keys
 */

import { createDocument } from '../model/document.js';
import { fieldsOf, parseFrontMatter, setField, splitFrontMatter } from '../markdown/frontmatter.js';
import { serializeMarkdown } from '../markdown/serialize.js';

/**
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {import('../model/document.js').Block} Block
 * @typedef {{ path: string, lang: string, slug: string, translationKey: string, title: string, date: string }} PostRef
 * @typedef {{ errors: string[], warnings: string[] }} Report
 */

export const LANGS = /** @type {const} */ (['en', 'es']);
export const AUTHOR = 'Pablo Garcia Ortega';
export const FIELD_ORDER = ['title', 'date', 'lastmod', 'slug', 'translationKey', 'aliases', 'author', 'tags', 'description'];
export const TIME_ZONE = 'Europe/Madrid';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const POST_PATH = /^content\/(en|es)\/blog\/(\d{4})\/(\d{2})(?:\/(\d{2}))?\/(?:.+\/)?[^/]+\.md$/;

/**
 * Suggested slug for a title. Only a suggestion: published slugs are often
 * shorter than the title, and the author picks the final one.
 * @param {string} text
 */
export function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Today's date as YYYY-MM-DD in the blog's time zone.
 * @param {Date} [now]
 * @param {string} [timeZone]
 */
export function todayISO(now = new Date(), timeZone = TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * A new, empty post with its front matter in the blog's field order.
 * @param {{ lang: string, title: string, slug?: string, date?: string, translationKey?: string, author?: string, tags?: string[], description?: string }} meta
 * @returns {Doc}
 */
export function newPost({ lang, title, slug = slugify(title), date = todayISO(), translationKey = slug, author = AUTHOR, tags = [], description = '' }) {
  if (!LANGS.includes(/** @type {any} */ (lang))) throw new Error(`Idioma desconocido: ${lang}`);
  const fields = { title, date, slug, translationKey, author, tags, description };
  /** @type {import('../markdown/frontmatter.js').FrontMatter | null} */
  let fm = null;
  for (const [key, value] of Object.entries(fields)) fm = setField(fm, key, value, { order: FIELD_ORDER });
  return createDocument({ frontMatter: fm, blocks: [] });
}

/**
 * Tags typed as text: comma separated, trimmed, without empties or repeats
 * (repeats compared ignoring case and accents; the first spelling wins).
 * @param {string} text
 * @returns {string[]}
 */
export function parseTags(text) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const raw of text.split(',')) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    const key = slugify(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/**
 * Front matter changes for one edit in the metadata form. While the author
 * has not typed a slug of their own, it follows the title; translationKey
 * follows the slug until it is typed by hand. Published posts never change
 * slug or translationKey here.
 * @param {string} field title, date, slug, translationKey, tags (as text) or description
 * @param {string} value as typed
 * @param {{ slugFollowsTitle: boolean, keyFollowsSlug: boolean }} follow
 * @returns {Record<string, any>}
 */
export function metaEdit(field, value, follow) {
  if (field === 'tags') return { tags: parseTags(value) };
  if (field === 'title') {
    if (!follow.slugFollowsTitle) return { title: value };
    const slug = slugify(value);
    return follow.keyFollowsSlug ? { title: value, slug, translationKey: slug } : { title: value, slug };
  }
  if (field === 'slug') return follow.keyFollowsSlug ? { slug: value, translationKey: value } : { slug: value };
  return { [field]: value };
}

/**
 * Updates front matter fields, keeping the original lines of the others.
 * @param {Doc} doc
 * @param {Record<string, any>} changes
 * @returns {Doc}
 */
export function updateMeta(doc, changes) {
  let fm = doc.frontMatter;
  for (const [key, value] of Object.entries(changes)) fm = setField(fm, key, value, { order: FIELD_ORDER });
  return { ...doc, frontMatter: fm };
}

/**
 * @param {Doc} doc
 * @returns {Record<string, any>}
 */
export function metaOf(doc) {
  return fieldsOf(doc.frontMatter);
}

/**
 * Reads the identity of an existing post from its path and front matter.
 * @param {string} path
 * @param {string} source
 * @returns {PostRef | null}
 */
export function postRef(path, source) {
  const m = POST_PATH.exec(path);
  if (!m) return null;
  const { frontMatter } = splitFrontMatter(source);
  const meta = frontMatter ? fieldsOf(parseFrontMatter(frontMatter)) : {};
  return {
    path,
    lang: m[1],
    slug: String(meta.slug ?? ''),
    translationKey: String(meta.translationKey ?? ''),
    title: String(meta.title ?? ''),
    date: String(meta.date ?? ''),
  };
}

/** @param {string} path */
export function isPostPath(path) {
  return POST_PATH.test(path) && !/\/_index\.md$/.test(path);
}

/**
 * Where a new post goes. Hugo turns a folder with index.md into a leaf
 * bundle and treats any other .md inside it as a resource (it would never
 * be published), and the other way round: an index.md added next to a
 * single-file post would swallow it. When the day folder is taken, the post
 * goes one level deeper (dd/<slug>/index.md): the URL comes from the slug,
 * so the extra folder is invisible.
 * @param {{ lang: string, date: string, slug: string, bundle: boolean, existingPaths: string[] }} opts
 * @returns {{ path: string, dir: string, bundle: boolean, nested: boolean }}
 */
export function postLocation({ lang, date, slug, bundle, existingPaths }) {
  if (!DATE.test(date)) throw new Error(`Fecha no válida: ${date}`);
  const [y, mo, d] = date.split('-');
  const day = `content/${lang}/blog/${y}/${mo}/${d}`;
  const inDay = existingPaths.filter((p) => p.startsWith(`${day}/`)).map((p) => p.slice(day.length + 1));
  const dayIsBundle = inDay.includes('index.md');
  const dayHasPages = inDay.some((p) => !p.includes('/') && p.endsWith('.md') && p !== 'index.md');
  const nestedDir = `${day}/${slug}`;
  const nested = () => {
    if (existingPaths.some((p) => p.startsWith(`${nestedDir}/`))) throw new Error(`Ya existe ${nestedDir}/`);
    return { path: `${nestedDir}/index.md`, dir: nestedDir, bundle: true, nested: true };
  };
  if (bundle) {
    if (!dayIsBundle && !dayHasPages) return { path: `${day}/index.md`, dir: day, bundle: true, nested: false };
    return nested();
  }
  if (dayIsBundle) return nested();
  const single = `${day}/${slug}.md`;
  if (existingPaths.includes(single)) throw new Error(`Ya existe ${single}`);
  return { path: single, dir: day, bundle: false, nested: false };
}

/**
 * Slug and translation conflicts against the posts already in the repo.
 * @param {PostRef[]} posts
 * @param {{ path?: string, lang: string, slug: string, translationKey: string }} post
 * @returns {Report & { translationOf: PostRef | null }}
 */
export function checkIdentity(posts, post) {
  const others = posts.filter((p) => p.path !== post.path);
  const errors = [];
  const warnings = [];
  const sameSlug = others.find((p) => p.lang === post.lang && p.slug === post.slug);
  if (sameSlug) errors.push(`El slug "${post.slug}" ya lo usa ${sameSlug.path}: los dos posts tendrían la misma URL.`);
  const sameKey = others.filter((p) => p.translationKey === post.translationKey);
  const sameLang = sameKey.find((p) => p.lang === post.lang);
  if (sameLang) errors.push(`El translationKey "${post.translationKey}" ya lo usa ${sameLang.path} en el mismo idioma.`);
  const translationOf = sameKey.find((p) => p.lang !== post.lang) ?? null;
  if (translationOf) warnings.push(`Se enlazará como traducción de "${translationOf.title}" (${translationOf.lang}).`);
  return { errors, warnings, translationOf };
}

/**
 * Relative image paths a post points to (block images and inline images).
 * @param {Doc} doc
 */
export function referencedImages(doc) {
  /** @type {{ src: string, alt: string }[]} */
  const found = [];
  /** @param {import('../model/inline.js').Run[]} runs */
  const fromRuns = (runs) => {
    for (const r of runs) if (r.type === 'image') found.push({ src: r.src, alt: r.alt });
  };
  for (const b of doc.blocks) {
    if (b.type === 'image') found.push({ src: b.src, alt: b.alt });
    else if (b.type === 'list') b.items.forEach((i) => fromRuns(i.runs));
    else if ('runs' in b) fromRuns(b.runs);
  }
  return found.filter((i) => !/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(i.src));
}

/**
 * Checks a post before publishing.
 * @param {Doc} doc
 * @param {{ images?: string[], publishedSlug?: string }} [opts]
 *   images: file names that will be in the bundle (already there or new);
 *   publishedSlug: the slug the post had when it was opened, if it was
 *   already published
 * @returns {Report}
 */
export function validatePost(doc, { images = [], publishedSlug } = {}) {
  const meta = metaOf(doc);
  const errors = [];
  const warnings = [];
  if (!meta.title || !String(meta.title).trim()) errors.push('Falta el título.');
  if (!DATE.test(String(meta.date ?? ''))) errors.push('La fecha debe tener el formato AAAA-MM-DD.');
  if (meta.lastmod !== undefined && !DATE.test(String(meta.lastmod))) errors.push('lastmod debe tener el formato AAAA-MM-DD.');
  if (!SLUG.test(String(meta.slug ?? ''))) errors.push('El slug solo admite minúsculas, números y guiones.');
  if (publishedSlug && meta.slug !== publishedSlug) errors.push(`No se puede cambiar el slug de un post publicado (era "${publishedSlug}"): es su URL.`);
  if (!meta.translationKey) errors.push('Falta el translationKey.');
  if (!Array.isArray(meta.tags) || meta.tags.length === 0) warnings.push('El post no tiene etiquetas.');
  const description = String(meta.description ?? '');
  if (!description) warnings.push('Falta la descripción (se usa en buscadores y al compartir).');
  else if (description.length > 160) warnings.push(`La descripción tiene ${description.length} caracteres; los buscadores suelen cortar hacia los 160.`);
  // The editor always keeps one paragraph to type in: empty paragraphs are not content.
  if (doc.blocks.every((b) => b.type === 'paragraph' && b.runs.length === 0)) errors.push('El post está vacío.');

  const available = new Set(images);
  for (const img of referencedImages(doc)) {
    const name = img.src.replace(/^\.\//, '');
    if (!available.has(name)) errors.push(`La imagen "${img.src}" no está en el post.`);
    if (!/\.webp$/i.test(name)) warnings.push(`"${img.src}" no es WebP; el resto del blog usa WebP.`);
    if (!img.alt.trim()) warnings.push(`La imagen "${img.src}" no tiene texto alternativo.`);
  }
  return { errors, warnings };
}

/**
 * The files a publish has to write, with the branch and commit message.
 * @param {{
 *   doc: Doc,
 *   lang: string,
 *   existingPaths: string[],
 *   path?: string,
 *   images?: { name: string, bytes: Uint8Array }[],
 *   lastmod?: string,
 * }} opts
 *   path: set when editing a post that already exists;
 *   images: new image files to add to the bundle;
 *   lastmod: when given on an edit, stored as the post's lastmod
 */
export function planPublish({ doc, lang, existingPaths, path, images = [], lastmod }) {
  const isUpdate = path !== undefined;
  let finalDoc = doc;
  if (isUpdate && lastmod) finalDoc = updateMeta(doc, { lastmod });
  const meta = metaOf(finalDoc);
  const needsBundle = images.length > 0 || referencedImages(finalDoc).length > 0;
  const location = isUpdate
    ? { path, dir: path.replace(/\/[^/]+$/, ''), bundle: /\/index\.md$/.test(path), nested: false }
    : postLocation({ lang, date: meta.date, slug: meta.slug, bundle: needsBundle, existingPaths });
  if (needsBundle && !location.bundle) {
    throw new Error(`${location.path} es un post de un solo fichero: para añadirle imágenes hay que convertirlo en bundle (carpeta con index.md).`);
  }
  /** @type {{ path: string, content: string | Uint8Array }[]} */
  const files = [{ path: location.path, content: serializeMarkdown(finalDoc) }];
  for (const img of images) files.push({ path: `${location.dir}/${img.name}`, content: img.bytes });
  return {
    doc: finalDoc,
    path: location.path,
    files,
    branch: `post/${lang}/${meta.slug}`,
    message: `content: ${isUpdate ? 'update' : 'add'} post "${meta.title}"`,
    pullRequest: {
      title: `${isUpdate ? 'Update' : 'New'} post (${lang}): ${meta.title}`,
      body: [`Post: \`${location.path}\``, `URL: /${lang === 'en' ? '' : `${lang}/`}${meta.slug}/`].join('\n'),
    },
  };
}
