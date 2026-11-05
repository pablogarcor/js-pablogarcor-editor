import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaEdit, newPost, updateMeta } from '../src/hugo/post.js';
import { parseMarkdown } from '../src/markdown/parse.js';
import { serializeMarkdown } from '../src/markdown/serialize.js';
import { caret, insertParagraph, insertText } from '../src/model/editing.js';
import { describeWhen, fromDraft, toDraft, worthSaving } from '../src/storage/draft.js';
import { insertBlock, blocks } from '../src/model/document.js';

const follow = { slugFollowsTitle: true, keyFollowsSlug: true };
const session = (doc, extra = {}) => ({ id: 'd1', doc, lang: 'es', opened: null, publishedSlug: null, follow, images: [], ...extra });

test('a draft keeps the post as Markdown and comes back the same', () => {
  let doc = insertBlock(newPost({ lang: 'en', title: '', date: '2026-11-05' }), 0, blocks.paragraph());
  doc = updateMeta(doc, metaEdit('title', 'Hello drafts', follow));
  let r = insertText(doc, caret({ block: doc.blocks[0].id, item: 0, offset: 0 }), 'First *line*');
  r = insertParagraph(r.doc, r.selection);
  r = insertText(r.doc, r.selection, 'Second');
  const image = { name: 'hello-drafts.webp', blob: new Blob([new Uint8Array([1, 2, 3])]), isNew: true };

  const draft = toDraft(session(r.doc, { lang: 'en', images: [image] }), new Date('2026-11-05T10:00:00Z'));
  assert.equal(draft.title, 'Hello drafts');
  assert.equal(draft.updatedAt, '2026-11-05T10:00:00.000Z');
  assert.match(draft.markdown, /^---\ntitle: "Hello drafts"\n[\s\S]*---\n\n?First \\\*line\\\*\n\nSecond\n$/);

  const back = fromDraft(structuredClone(draft));
  assert.equal(serializeMarkdown(back.doc), serializeMarkdown(r.doc));
  assert.equal(back.lang, 'en');
  assert.equal(back.images[0].name, 'hello-drafts.webp');
  assert.ok(!('markdown' in back) && !('updatedAt' in back));
});

test('an opened post restored from a draft still compares with its original file', () => {
  const source = '---\ntitle: "T"\nslug: "t"\n---\nOne  \n\n\nTwo\n';
  const doc = parseMarkdown(source);
  const edited = insertText(doc, caret({ block: doc.blocks[1].id, item: 0, offset: 3 }), '!').doc;
  const back = fromDraft(toDraft(session(edited, { opened: { name: 'index.md', source }, publishedSlug: 't' })));
  assert.equal(serializeMarkdown(back.doc), source.replace('Two', 'Two!'), 'untouched blocks keep their exact layout');
});

test('only sessions with something in them are worth saving', () => {
  const empty = insertBlock(newPost({ lang: 'es', title: '' }), 0, blocks.paragraph());
  assert.equal(worthSaving(session(empty)), false);
  assert.equal(worthSaving(session(updateMeta(empty, { title: 'Algo' }))), true);
  const typed = insertText(empty, caret({ block: empty.blocks[0].id, item: 0, offset: 0 }), 'x').doc;
  assert.equal(worthSaving(session(typed)), true);
  assert.equal(worthSaving(session(empty, { images: [{ name: 'a.webp', blob: new Blob([]), isNew: true }] })), true);

  const source = 'Text\n';
  const opened = parseMarkdown(source);
  assert.equal(worthSaving(session(opened, { opened: { name: 'a.md', source } })), false, 'an opened post without changes');
});

test('when a draft was saved, in words', () => {
  const now = new Date('2026-11-05T12:00:00');
  assert.equal(describeWhen(new Date('2026-11-05T11:59:40').toISOString(), now), 'ahora mismo');
  assert.equal(describeWhen(new Date('2026-11-05T11:45:00').toISOString(), now), 'hace 15 min');
  assert.match(describeWhen(new Date('2026-11-05T08:05:00').toISOString(), now), /^hoy, 08:05$/);
  assert.match(describeWhen(new Date('2026-11-04T18:02:00').toISOString(), now), /^ayer, 18:02$/);
});
