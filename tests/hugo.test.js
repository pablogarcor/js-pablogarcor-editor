import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIdentity, newPost, planPublish, postLocation, postRef, slugify, todayISO, updateMeta, validatePost } from '../src/hugo/post.js';
import { blocks, insertBlock } from '../src/model/document.js';
import { text } from '../src/model/inline.js';
import { serializeMarkdown } from '../src/markdown/serialize.js';
import { imageName } from '../src/media/webp.js';

test('slug suggestions from titles', () => {
  assert.equal(slugify('Esto marcará un AIntes y un después'), 'esto-marcara-un-aintes-y-un-despues');
  assert.equal(slugify('Recovering Ubuntu from an \'Unable to Mount Root FS\' Kernel Panic'), 'recovering-ubuntu-from-an-unable-to-mount-root-fs-kernel-panic');
  assert.equal(slugify('¿Qué pasó en 2026?'), 'que-paso-en-2026');
});

test('today in Madrid, not in UTC', () => {
  assert.equal(todayISO(new Date('2026-11-03T23:30:00Z')), '2026-11-04');
});

test('a new post has the blog front matter, in the blog order', () => {
  let doc = newPost({ lang: 'es', title: 'Escribir a mano', date: '2026-11-03', tags: ['Reflexión'], description: 'Sobre escribir.' });
  doc = insertBlock(doc, 0, blocks.paragraph([text('Hola.')]));
  assert.equal(
    serializeMarkdown(doc),
    '---\ntitle: "Escribir a mano"\ndate: 2026-11-03\nslug: "escribir-a-mano"\ntranslationKey: "escribir-a-mano"\nauthor: "Pablo Garcia Ortega"\ntags: ["Reflexión"]\ndescription: "Sobre escribir."\n---\n\nHola.\n',
  );
});

test('where a new post goes', () => {
  const base = { lang: 'en', date: '2026-11-03', slug: 'my-post' };
  assert.equal(postLocation({ ...base, bundle: true, existingPaths: [] }).path, 'content/en/blog/2026/11/03/index.md');
  assert.equal(postLocation({ ...base, bundle: false, existingPaths: [] }).path, 'content/en/blog/2026/11/03/my-post.md');
});

test('a second post on the same day never ends up as a hidden resource of the first', () => {
  const bundleDay = ['content/en/blog/2026/11/03/index.md', 'content/en/blog/2026/11/03/photo.webp'];
  const singleDay = ['content/en/blog/2026/11/03/other.md'];
  const base = { lang: 'en', date: '2026-11-03', slug: 'my-post' };
  assert.equal(postLocation({ ...base, bundle: false, existingPaths: bundleDay }).path, 'content/en/blog/2026/11/03/my-post/index.md');
  assert.equal(postLocation({ ...base, bundle: true, existingPaths: bundleDay }).path, 'content/en/blog/2026/11/03/my-post/index.md');
  assert.equal(postLocation({ ...base, bundle: true, existingPaths: singleDay }).path, 'content/en/blog/2026/11/03/my-post/index.md');
  assert.throws(() => postLocation({ ...base, bundle: false, existingPaths: ['content/en/blog/2026/11/03/my-post.md'] }));
});

test('slug and translationKey conflicts', () => {
  const posts = [
    postRef('content/en/blog/2026/06/03/index.md', '---\ntitle: "Writing"\nslug: "writing"\ntranslationKey: "writing"\n---\n'),
    postRef('content/es/blog/2026/06/03/index.md', '---\ntitle: "Escribir"\nslug: "escribir"\ntranslationKey: "escribir"\n---\n'),
  ];
  assert.deepEqual(checkIdentity(posts, { lang: 'en', slug: 'writing', translationKey: 'new' }).errors.length, 1);
  assert.deepEqual(checkIdentity(posts, { lang: 'es', slug: 'otro', translationKey: 'escribir' }).errors.length, 1);
  const translation = checkIdentity(posts, { lang: 'es', slug: 'escribir-2', translationKey: 'writing' });
  assert.equal(translation.errors.length, 0);
  assert.equal(translation.translationOf?.title, 'Writing');
});

test('validation before publishing', () => {
  let doc = newPost({ lang: 'en', title: 'A post', date: '2026-11-03', tags: ['Linux'], description: 'Short.' });
  doc = insertBlock(doc, 0, blocks.image({ src: 'screenshot.png', alt: '' }));
  const report = validatePost(doc, { images: [] });
  assert.ok(report.errors.some((e) => e.includes('screenshot.png')));
  assert.ok(report.warnings.some((w) => w.includes('WebP')));
  assert.ok(report.warnings.some((w) => w.includes('alternativo')));
  const renamed = updateMeta(doc, { slug: 'another-slug' });
  assert.ok(validatePost(renamed, { images: ['screenshot.png'], publishedSlug: 'a-post' }).errors.some((e) => e.includes('slug')));
});

test('publish plan for a new post with an image', () => {
  let doc = newPost({ lang: 'en', title: 'Fixing things', date: '2026-11-03', tags: ['DIY'], description: 'How.' });
  doc = insertBlock(doc, 0, blocks.image({ src: 'broken-part.webp', alt: 'The broken part' }));
  const plan = planPublish({ doc, lang: 'en', existingPaths: [], images: [{ name: 'broken-part.webp', bytes: new Uint8Array([1, 2, 3]) }] });
  assert.equal(plan.path, 'content/en/blog/2026/11/03/index.md');
  assert.deepEqual(plan.files.map((f) => f.path), ['content/en/blog/2026/11/03/index.md', 'content/en/blog/2026/11/03/broken-part.webp']);
  assert.equal(plan.branch, 'post/en/fixing-things');
  assert.equal(plan.message, 'content: add post "Fixing things"');
});

test('publish plan for an edit can stamp lastmod', () => {
  const doc = newPost({ lang: 'es', title: 'Viejo', date: '2026-01-01' });
  const plan = planPublish({ doc, lang: 'es', existingPaths: [], path: 'content/es/blog/2026/01/01/viejo.md', lastmod: '2026-11-03' });
  assert.match(String(plan.files[0].content), /\ndate: 2026-01-01\nlastmod: 2026-11-03\n/);
  assert.equal(plan.message, 'content: update post "Viejo"');
});

test('image file names in the blog style', () => {
  assert.equal(imageName('IMG_2041.HEIC'), 'img-2041.webp');
  assert.equal(imageName('Rear label of my LG OLED65CX5LB', ['rear-label-of-my-lg-oled65cx5lb.webp']), 'rear-label-of-my-lg-oled65cx5lb-2.webp');
});
