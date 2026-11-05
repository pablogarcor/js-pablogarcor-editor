import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postRef, preparePublish } from '../src/hugo/post.js';
import { parseMarkdown } from '../src/markdown/parse.js';
import { caret, insertText } from '../src/model/editing.js';
import { blocks, insertBlock } from '../src/model/document.js';

const fm = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : `"${v}"`}`).join('\n')}\n---\n`;
const published = fm({ title: 'Hazme CASIO', slug: 'hazme-casio', translationKey: 'hazme-casio', tags: ['a'], description: 'd' }).replace('---\n', '---\ndate: 2026-06-18\n') + '\nTexto.\n\n![Reloj](hazme-casio.webp)\n';
const files = {
  'content/es/blog/2026/06/18/index.md': published,
  'content/es/blog/2026/06/18/hazme-casio.webp': '',
  'content/en/blog/2026/06/18/index.md': fm({ title: 'Make me CASIO', slug: 'make-me-casio', translationKey: 'hazme-casio' }),
};
const repo = {
  paths: Object.keys(files),
  posts: Object.entries(files)
    .filter(([p]) => p.endsWith('.md'))
    .map(([p, source]) => ({ ...postRef(p, source), source })),
};
const image = (name) => ({ name, bytes: new Uint8Array([1, 2, 3]) });

const newDoc = (fields, body = 'Hola.') => {
  const doc = parseMarkdown(`${fm(fields).replace('---\n', '---\ndate: 2026-11-05\n')}\n${body}\n`);
  return doc;
};

test('a new post: checks pass and the plan puts it on its own branch', () => {
  const doc = newDoc({ title: 'Nuevo', slug: 'nuevo', translationKey: 'nuevo', tags: ['x'], description: 'd' }, 'Hola.\n\n![Foto](nuevo.webp)');
  const r = preparePublish({ doc, lang: 'es', original: null, images: [image('nuevo.webp'), image('sobra.webp')], repo });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, ['Una imagen añadida ya no se usa y no se subirá.']);
  assert.equal(r.plan.branch, 'post/es/nuevo');
  assert.deepEqual(r.plan.files.map((f) => f.path), ['content/es/blog/2026/11/05/index.md', 'content/es/blog/2026/11/05/nuevo.webp']);
});

test('a new post with a slug that already exists is blocked', () => {
  const doc = newDoc({ title: 'Otro', slug: 'hazme-casio', translationKey: 'otro', tags: ['x'], description: 'd' });
  const r = preparePublish({ doc, lang: 'es', original: null, images: [], repo });
  assert.equal(r.plan, null);
  assert.match(r.errors.join(' '), /El slug "hazme-casio" ya lo usa/);
});

test('a translation is recognised', () => {
  const doc = newDoc({ title: 'Make me CASIO again', slug: 'make-me-casio-2', translationKey: 'hazme-casio', tags: ['x'], description: 'd' });
  assert.match(preparePublish({ doc, lang: 'es', original: null, images: [], repo }).errors.join(' '), /translationKey "hazme-casio" ya lo usa/);
  const r = preparePublish({ doc, lang: 'en', original: null, images: [], repo: { ...repo, posts: repo.posts.filter((p) => p.lang === 'es') } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.translationOf.slug, 'hazme-casio');
});

test('an edited post is found by its original file and gets lastmod', () => {
  const doc = parseMarkdown(published);
  const edited = insertText(doc, caret({ block: doc.blocks[0].id, item: 0, offset: 6 }), ' Más.').doc;
  const r = preparePublish({ doc: edited, lang: 'en', original: published, images: [], repo, today: '2026-11-06' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.lang, 'es', 'the language comes from the path, not the form');
  assert.equal(r.path, 'content/es/blog/2026/06/18/index.md');
  assert.equal(r.plan.branch, 'post/es/hazme-casio');
  assert.match(r.plan.files[0].content, /lastmod: 2026-11-06\n/);
  assert.match(r.plan.files[0].content, /Texto. Más.\n/);
  assert.equal(r.plan.files.length, 1, 'the existing image is not uploaded again');
});

test('an edited post that is not in main as opened, or has no changes, is blocked', () => {
  const doc = parseMarkdown(published);
  assert.match(preparePublish({ doc, lang: 'es', original: published, images: [], repo }).errors.join(' '), /No hay cambios/);
  const stale = published.replace('Texto.', 'Texto viejo.');
  assert.match(preparePublish({ doc: parseMarkdown(stale), lang: 'es', original: stale, images: [], repo }).errors.join(' '), /git pull/);
});

test('validatePost errors block the plan', () => {
  const doc = insertBlock(newDoc({ title: '', slug: 'x', translationKey: 'x' }, ''), 0, blocks.paragraph());
  const r = preparePublish({ doc, lang: 'es', original: null, images: [], repo });
  assert.equal(r.plan, null);
  assert.ok(r.errors.includes('Falta el título.'));
  assert.ok(r.errors.includes('El post está vacío.'));
});
