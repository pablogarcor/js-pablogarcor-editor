// @ts-check
/**
 * What a draft holds, and how it becomes an editor session again. Pure: no
 * IndexedDB here (that is drafts.js), so the Node tests cover it.
 *
 * The document is stored as the Markdown it would publish. Markdown is what
 * the editor round-trips without loss, it survives changes to the model's
 * internals between versions of the editor, and a draft can be read by eye.
 * The undo history is not kept.
 */

import { metaOf } from '../hugo/post.js';
import { parseMarkdown } from '../markdown/parse.js';
import { serializeMarkdown } from '../markdown/serialize.js';

/**
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {{ name: string, blob: Blob, isNew: boolean }} DraftImage
 *   isNew: added in the editor (to upload); otherwise opened with the post
 * @typedef {{
 *   id: string,
 *   updatedAt: string,
 *   title: string,
 *   markdown: string,
 *   lang: string,
 *   opened: { name: string, source: string } | null,
 *   publishedSlug: string | null,
 *   follow: { slugFollowsTitle: boolean, keyFollowsSlug: boolean },
 *   images: DraftImage[],
 *   published?: Published | null,
 * }} Draft
 * @typedef {{ number: number, url: string, branch: string, markdown: string, at: string }} Published
 *   the pull request the post was last published to, and the Markdown sent
 * @typedef {Omit<Draft, 'updatedAt' | 'title' | 'markdown'> & { doc: Doc }} Session
 */

/**
 * @param {Session} session
 * @param {Date} [now]
 * @returns {Draft}
 */
export function toDraft({ doc, ...rest }, now = new Date()) {
  return { ...rest, updatedAt: now.toISOString(), title: String(metaOf(doc).title ?? ''), markdown: serializeMarkdown(doc) };
}

/**
 * @param {Draft} draft
 * @returns {Session}
 */
export function fromDraft({ updatedAt, title, markdown, ...rest }) {
  return { ...rest, doc: parseMarkdown(markdown) };
}

/**
 * Whether a session has anything worth keeping: an opened post with changes,
 * or a new post with a title, text or images.
 * @param {Session} session
 */
export function worthSaving(session) {
  const markdown = serializeMarkdown(session.doc);
  if (session.opened) return markdown !== session.opened.source;
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  return Boolean(String(metaOf(session.doc).title ?? '').trim() || body || session.images.length);
}

/**
 * Where a draft stands with its pull request: never published, published
 * as it is now, or edited after publishing.
 * @param {Pick<Draft, 'markdown' | 'published'>} draft
 * @returns {'draft' | 'published' | 'changed'}
 */
export function publishState(draft) {
  if (!draft.published) return 'draft';
  return draft.published.markdown === draft.markdown ? 'published' : 'changed';
}

/**
 * A draft can go once its pull request is merged, unless it was edited
 * after publishing: those edits are only in the draft.
 * @param {Pick<Draft, 'markdown' | 'published'>} draft
 * @param {{ merged: boolean }} pullRequest
 */
export function canForget(draft, pullRequest) {
  return pullRequest.merged && publishState(draft) === 'published';
}

/**
 * "hace 5 min", "ayer, 18:02"... for the drafts list.
 * @param {string} iso
 * @param {Date} [now]
 */
export function describeWhen(iso, now = new Date()) {
  const then = new Date(iso);
  const minutes = Math.round((now.getTime() - then.getTime()) / 60000);
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const time = then.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const day = (/** @type {Date} */ d) => d.toLocaleDateString('es-ES');
  if (day(then) === day(now)) return `hoy, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(then) === day(yesterday)) return `ayer, ${time}`;
  return `${then.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
}
