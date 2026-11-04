import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, serializeInline } from '../src/markdown/inline.js';
import { checkBlock } from '../src/markdown/serialize.js';
import { blocks } from '../src/model/document.js';
import { text } from '../src/model/inline.js';

const t = (s, marks = {}) => text(s, marks);

test('bold, italic and nesting as the blog writes them', () => {
  assert.deepEqual(parseInline('a **b** *c* _d_'), [t('a '), t('b', { strong: true }), t(' '), t('c', { em: true }), t(' '), t('d', { em: true })]);
  assert.deepEqual(parseInline('_No lo quiero, **¡lo necesito!**_'), [
    t('No lo quiero, ', { em: true }),
    t('¡lo necesito!', { em: true, strong: true }),
  ]);
  assert.deepEqual(parseInline('**_la buganvilla_**'), [t('la buganvilla', { strong: true, em: true })]);
});

test('emphasis inside bold is written as **_x_**', () => {
  assert.equal(checkBlock(blocks.paragraph([t('x', { strong: true, em: true })])).markdown, '**_x_**');
  assert.equal(checkBlock(blocks.paragraph([t('a '), t('b', { em: true })])).markdown, 'a *b*');
});

test('code spans keep their content literally', () => {
  assert.deepEqual(parseInline('run `ssh <router_user>@<router_ip>` now'), [t('run '), t('ssh <router_user>@<router_ip>', { code: true }), t(' now')]);
  assert.deepEqual(parseInline('`` a ` b ``'), [t('a ` b', { code: true })]);
  assert.equal(serializeInline([t('a ` b', { code: true })]), '``a ` b``');
  assert.equal(serializeInline([t('`tick', { code: true })]), '`` `tick ``');
});

test('links, link titles and images', () => {
  assert.deepEqual(parseInline('[the **fix**](#update "Go")'), [
    t('the ', { link: { href: '#update', title: 'Go' } }),
    t('fix', { link: { href: '#update', title: 'Go' }, strong: true }),
  ]);
  assert.deepEqual(parseInline('see ![a cat](cat.webp)'), [t('see '), { type: 'image', src: 'cat.webp', alt: 'a cat', marks: {} }]);
  assert.equal(serializeInline([t('x', { link: { href: 'https://e.com/a b' } })]), '[x](<https://e.com/a b>)');
});

test('literal characters are escaped only when they would mean something', () => {
  const cases = ['5 * 3 = 15', 'snake_case_name', 'C:\\Users\\pablo', 'a *literal* star', '[not a link]', 'tom & jerry', '&amp; stays literal', '<not html'];
  for (const s of cases) {
    const md = checkBlock(blocks.paragraph([t(s)]));
    assert.ok(md.verified, s);
    assert.deepEqual(parseInline(md.markdown), [t(s)], `${s} -> ${md.markdown}`);
  }
  assert.equal(checkBlock(blocks.paragraph([t('5 * 3 = 15')])).markdown, '5 * 3 = 15');
  assert.equal(checkBlock(blocks.paragraph([t('snake_case_name')])).markdown, 'snake_case_name');
});

test('text that looks like a block start is escaped', () => {
  for (const s of ['# not a heading', '1. not a list', '- not a list', '> not a quote', 'line\n---']) {
    const md = checkBlock(blocks.paragraph([t(s)]));
    assert.ok(md.verified, `${s} -> ${md.markdown}`);
  }
  assert.equal(checkBlock(blocks.paragraph([t('2026. A year')])).markdown, '2026\\. A year');
});

test('whitespace at the edge of bold moves outside the delimiters', () => {
  const md = checkBlock(blocks.paragraph([t('word ', { strong: true }), t('next')]));
  assert.equal(md.markdown, '**word** next');
  assert.ok(md.verified);
});

test('soft and hard line breaks', () => {
  assert.deepEqual(parseInline('one\ntwo'), [t('one\ntwo')]);
  assert.deepEqual(parseInline('one  \ntwo'), [t('one'), { type: 'break', marks: {} }, t('two')]);
  assert.deepEqual(parseInline('one\\\ntwo'), [t('one'), { type: 'break', marks: {} }, t('two')]);
});
