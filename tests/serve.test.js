import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { CSP, createEditorServer, resolvePath } from '../serve.js';

const root = join(import.meta.dirname, '..');
const server = createEditorServer({ root });
let port = 0;

before(() => new Promise((done) => server.listen(0, '127.0.0.1', () => { port = server.address().port; done(); })));
after(() => new Promise((done) => server.close(done)));

/**
 * Raw request, so the path reaches the server exactly as written.
 * @returns {Promise<{ status: number, headers: Record<string, any>, body: string }>}
 */
function get(path, { method = 'GET', host = `localhost:${port}` } = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

test('serves the page with a strict CSP', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.equal(res.headers['content-security-policy'], CSP);
  assert.match(CSP, /script-src 'self'(;|$)/);
  assert.match(CSP, /connect-src https:\/\/api\.github\.com(;|$)/, 'the only origin the page may talk to');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.body, /src\/editor\/app\.js/);
});

test('serves the modules under src/ as JavaScript', async () => {
  const res = await get('/src/editor/app.js?v=1');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/javascript/);
});

test('serves nothing outside index.html and src/', async () => {
  for (const path of ['/serve.js', '/tests/serve.test.js', '/.git/config', '/README.md', '/src/', '/src/editor/missing.js']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('path traversal and dot files are refused', async () => {
  for (const path of ['/src/../serve.js', '/src/%2e%2e/serve.js', '/src/%2e%2e%2fserve.js', '/src/.hidden.js', '/src/%E0%A4%A.js']) {
    assert.equal((await get(path)).status, 404, path);
  }
  assert.equal(resolvePath(root, '/src/a.js\0'), null);
});

test('only local Host names are answered', async () => {
  assert.equal((await get('/', { host: 'evil.example:8000' })).status, 403);
  assert.equal((await get('/', { host: `127.0.0.1:${port}` })).status, 200);
});

test('only GET and HEAD', async () => {
  assert.equal((await get('/', { method: 'POST' })).status, 405);
  const head = await get('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});
