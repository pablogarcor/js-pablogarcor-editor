import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client, connect, disconnect, explain, isConnected } from '../src/github/connection.js';
import { GitHubError } from '../src/github/client.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('connect checks the token against the repository before keeping it', async () => {
  disconnect();
  const seen = [];
  const bad = async (url, init) => {
    seen.push([url, init.headers.Authorization]);
    return json(401, { message: 'Bad credentials' });
  };
  await assert.rejects(connect(' ghp_bad ', { remember: false, fetch: bad }), /no acepta el token/);
  assert.equal(isConnected(), false);
  assert.deepEqual(seen, [['https://api.github.com/repos/pablogarcor/js-pablogarcor-web/git/ref/heads/main', 'Bearer ghp_bad']]);

  await connect('github_pat_good', { remember: true, fetch: async () => json(200, { object: { sha: 'abc' } }) });
  assert.equal(isConnected(), true);
  assert.equal(client().repo, 'js-pablogarcor-web');
  disconnect();
  assert.equal(isConnected(), false);
  assert.throws(() => client(), /No estás conectado/);
});

test('an empty token is refused without asking GitHub', async () => {
  await assert.rejects(connect('   ', { remember: false, fetch: async () => assert.fail('no request') }), /Pega el token/);
});

test('GitHub errors in words', () => {
  assert.match(explain(new GitHubError('x', 404, null)), /no tiene acceso/);
  assert.match(explain(new GitHubError('x', 403, null)), /Read and write/);
  assert.match(explain(new TypeError('Failed to fetch')), /conexión a internet/);
});
