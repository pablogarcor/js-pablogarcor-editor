import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindValue, valueKind } from '../src/editor/toolbar.js';

test('block type <select> values map to block kinds and back', () => {
  for (const value of ['paragraph', 'h2', 'h3', 'h4', 'quote', 'ul', 'ol']) assert.equal(kindValue(valueKind(value)), value);
  assert.equal(kindValue(null), '');
  assert.equal(valueKind('h1'), null);
  assert.equal(valueKind(''), null);
});
