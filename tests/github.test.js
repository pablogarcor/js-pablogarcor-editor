import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../src/github/client.js';
import { loadPosts, publishFiles, toBase64 } from '../src/github/publish.js';

/**
 * A tiny in-memory GitHub: enough of the Git Data and Pulls API to follow
 * a publish from start to end.
 */
function fakeGitHub({ branches = { main: 'c0' }, files = {} } = {}) {
  const calls = [];
  const commits = { c0: { sha: 'c0', tree: { sha: 't0' } } };
  const pulls = [];
  let n = 0;
  const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace('/repos/pablogarcor/js-pablogarcor-web', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body, auth: init.headers.Authorization });
    let m;
    if (init.method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(path))) {
      const sha = branches[decodeURIComponent(m[1])];
      return sha ? json(200, { object: { sha } }) : json(404, { message: 'Not Found' });
    }
    if (init.method === 'GET' && (m = /^\/git\/commits\/(.+)$/.exec(path))) return json(200, commits[m[1]]);
    if (init.method === 'GET' && /^\/git\/trees\//.test(path)) {
      return json(200, { truncated: false, tree: Object.keys(files).map((p) => ({ path: p, type: 'blob', sha: `s-${p}` })) });
    }
    if (init.method === 'GET' && (m = /^\/contents\/(.+)$/.exec(path))) {
      return new Response(files[decodeURIComponent(m[1])], { status: 200, headers: { 'content-type': 'application/vnd.github.raw+json; charset=utf-8' } });
    }
    if (init.method === 'POST' && path === '/git/blobs') return json(201, { sha: `blob${++n}` });
    if (init.method === 'POST' && path === '/git/trees') return json(201, { sha: `tree${++n}` });
    if (init.method === 'POST' && path === '/git/commits') {
      const sha = `c${++n}`;
      commits[sha] = { sha, tree: { sha: body.tree } };
      return json(201, { sha });
    }
    if (init.method === 'POST' && path === '/git/refs') {
      branches[body.ref.replace('refs/heads/', '')] = body.sha;
      return json(201, {});
    }
    if (init.method === 'PATCH' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(path))) {
      branches[decodeURIComponent(m[1])] = body.sha;
      return json(200, {});
    }
    if (init.method === 'GET' && path === '/pulls') {
      const head = searchParams.get('head').split(':')[1];
      return json(200, pulls.filter((p) => p.head === head));
    }
    if (init.method === 'POST' && path === '/pulls') {
      const pr = { number: pulls.length + 1, html_url: `https://github.com/pr/${pulls.length + 1}`, head: body.head };
      pulls.push(pr);
      return json(201, pr);
    }
    return json(500, { message: `unexpected ${init.method} ${path}` });
  };
  return { fetch, calls, branches };
}

const client = (gh) => createGitHubClient({ token: 'github_pat_x', owner: 'pablogarcor', repo: 'js-pablogarcor-web', fetch: gh.fetch });

test('first publish: one commit with every file, a new branch and a PR', async () => {
  const gh = fakeGitHub();
  const result = await publishFiles(client(gh), {
    branch: 'post/en/fixing-things',
    files: [
      { path: 'content/en/blog/2026/11/03/index.md', content: '# hi\n' },
      { path: 'content/en/blog/2026/11/03/part.webp', content: new Uint8Array([82, 73, 70, 70]) },
    ],
    message: 'content: add post "Fixing things"',
    pullRequest: { title: 'New post', body: '' },
  });
  const blobs = gh.calls.filter((c) => c.path === '/git/blobs');
  assert.deepEqual(blobs.map((c) => c.body.encoding), ['utf-8', 'base64']);
  assert.equal(blobs[1].body.content, 'UklGRg==');
  const tree = gh.calls.find((c) => c.path === '/git/trees');
  assert.equal(tree.body.base_tree, 't0');
  assert.equal(tree.body.tree.length, 2);
  const commit = gh.calls.find((c) => c.path === '/git/commits' && c.method === 'POST');
  assert.deepEqual(commit.body.parents, ['c0']);
  assert.equal(gh.branches['post/en/fixing-things'], result.commitSha);
  assert.equal(gh.branches.main, 'c0', 'main is never touched');
  assert.equal(result.pullRequest.number, 1);
  assert.ok(gh.calls.every((c) => c.auth === 'Bearer github_pat_x'));
});

test('publishing again updates the same branch and reuses the PR', async () => {
  const gh = fakeGitHub();
  const opts = { branch: 'post/es/x', files: [{ path: 'content/es/blog/2026/11/03/x.md', content: 'v1\n' }], message: 'm', pullRequest: { title: 't', body: '' } };
  const first = await publishFiles(client(gh), opts);
  const second = await publishFiles(client(gh), { ...opts, files: [{ path: 'content/es/blog/2026/11/03/x.md', content: 'v2\n' }] });
  const lastCommit = gh.calls.filter((c) => c.path === '/git/commits' && c.method === 'POST').pop();
  assert.deepEqual(lastCommit.body.parents, [first.commitSha]);
  assert.ok(gh.calls.some((c) => c.method === 'PATCH'));
  assert.equal(second.pullRequest.number, 1);
  assert.equal(gh.calls.filter((c) => c.path === '/pulls' && c.method === 'POST').length, 1);
});

test('refuses to commit to main', async () => {
  await assert.rejects(publishFiles(client(fakeGitHub()), { branch: 'main', base: 'main', files: [], message: 'x' }), /post branch/);
});

test('loadPosts reads paths and post identities from the repo', async () => {
  const gh = fakeGitHub({
    files: {
      'config.toml': 'x',
      'content/en/blog/_index.md': '---\ntitle: "Blog"\n---\n',
      'content/en/blog/2026/06/02/index.md': '---\ntitle: "A"\nslug: "a"\ntranslationKey: "a"\n---\n\nText\n',
      'content/en/blog/2026/06/02/pic.webp': 'bin',
    },
  });
  const { paths, posts } = await loadPosts(client(gh));
  assert.equal(paths.length, 4);
  assert.deepEqual(posts.map((p) => [p.path, p.lang, p.slug]), [['content/en/blog/2026/06/02/index.md', 'en', 'a']]);
  assert.equal(posts[0].source.endsWith('Text\n'), true);
});

test('toBase64 handles large binaries', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
  assert.equal(Buffer.from(toBase64(bytes), 'base64').equals(Buffer.from(bytes)), true);
});

test('getPullRequest reads the state of a pull request, or null when it does not exist', async () => {
  const fetch = async (url) =>
    url.endsWith('/pulls/7')
      ? new Response(JSON.stringify({ number: 7, html_url: 'h', state: 'closed', merged: true }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const client = createGitHubClient({ token: 't', owner: 'pablogarcor', repo: 'js-pablogarcor-web', fetch });
  assert.deepEqual(await client.getPullRequest(7), { number: 7, html_url: 'h', state: 'closed', merged: true });
  assert.equal(await client.getPullRequest(8), null);
});
