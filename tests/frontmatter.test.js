import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldsOf, parseFrontMatter, serializeFrontMatter, setField, splitFrontMatter } from '../src/markdown/frontmatter.js';
import { FIELD_ORDER } from '../src/hugo/post.js';

const SAMPLE = `---
title: "Hazme CASIO"
date: 2026-06-18
lastmod: 2026-06-19
slug: "hazme-casio"
translationKey: "hazme-casio"
aliases:
  - /hacedme-casio/
author: "Pablo Garcia Ortega"
tags: ["Tecnología", "Smartwatches", "Vida Personal", "Reflexión"]
description: "Una \\"reflexión\\" sobre relojes."
---`;

test('reads every field style the blog uses', () => {
  const fields = fieldsOf(parseFrontMatter(SAMPLE));
  assert.deepEqual(fields, {
    title: 'Hazme CASIO',
    date: '2026-06-18',
    lastmod: '2026-06-19',
    slug: 'hazme-casio',
    translationKey: 'hazme-casio',
    aliases: ['/hacedme-casio/'],
    author: 'Pablo Garcia Ortega',
    tags: ['Tecnología', 'Smartwatches', 'Vida Personal', 'Reflexión'],
    description: 'Una "reflexión" sobre relojes.',
  });
});

test('untouched front matter is written back as it was, canonical form too', () => {
  const fm = parseFrontMatter(SAMPLE);
  assert.equal(serializeFrontMatter(fm), SAMPLE);
  assert.equal(serializeFrontMatter(fm, { canonical: true }), SAMPLE);
});

test('setting a field rewrites only that line and keeps the order', () => {
  const fm = setField(parseFrontMatter('---\ntitle:   "Old"\ndate: 2026-01-01\nslug: "s"\ntags: ["a"]\n---'), 'lastmod', '2026-02-02', { order: FIELD_ORDER });
  assert.equal(serializeFrontMatter(fm), '---\ntitle:   "Old"\ndate: 2026-01-01\nlastmod: 2026-02-02\nslug: "s"\ntags: ["a"]\n---');
  const fm2 = setField(fm, 'tags', ['a', 'b c'], { order: FIELD_ORDER });
  assert.equal(serializeFrontMatter(fm2).split('\n')[5], 'tags: ["a", "b c"]');
});

test('lines it does not understand are kept and never rewritten', () => {
  const raw = '---\ntitle: "T"\nparams:\n  toc: true\n# a comment\n---';
  const fm = parseFrontMatter(raw);
  assert.equal(serializeFrontMatter(setField(fm, 'title', 'U')), '---\ntitle: "U"\nparams:\n  toc: true\n# a comment\n---');
});

test('splitFrontMatter leaves the line break after the closing fence in the body', () => {
  assert.deepEqual(splitFrontMatter('---\na: 1\n---\n\nText\n'), { frontMatter: '---\na: 1\n---', body: '\n\nText\n' });
  assert.deepEqual(splitFrontMatter('No front matter'), { frontMatter: null, body: 'No front matter' });
});
