// @ts-check
/**
 * Minimal GitHub REST client over fetch. Works in the browser and in Node.
 *
 * The token is a fine-grained personal access token limited to the blog
 * repository, with "Contents: read and write" and "Pull requests: read and
 * write". Without the "Workflows" permission it cannot touch
 * .github/workflows. It lives only in this client: nothing here stores it.
 */

export class GitHubError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {unknown} body
   */
  constructor(message, status, body) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {{ token: string, owner: string, repo: string, fetch?: typeof fetch, apiBase?: string }} opts
 */
export function createGitHubClient({ token, owner, repo, fetch: doFetch = globalThis.fetch.bind(globalThis), apiBase = 'https://api.github.com' }) {
  const base = `${apiBase}/repos/${owner}/${repo}`;

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ body?: unknown, accept?: string, allow404?: boolean, text?: boolean }} [opts]
   * @returns {Promise<any>}
   */
  async function request(method, path, { body, accept = 'application/vnd.github+json', allow404 = false, text = false } = {}) {
    /** @type {Record<string, string>} */
    const headers = { Accept: accept, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await doFetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (allow404 && res.status === 404) return null;
    const isJson = !(text && res.ok) && (res.headers.get('content-type') ?? '').includes('json');
    const payload = res.status === 204 ? null : isJson ? await res.json() : await res.text();
    if (!res.ok) {
      const detail = payload && typeof payload === 'object' && 'message' in payload ? String(payload.message) : String(payload);
      throw new GitHubError(`GitHub ${method} ${path}: ${res.status} ${detail}`, res.status, payload);
    }
    return payload;
  }

  /** @param {string} path */
  const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

  return {
    owner,
    repo,
    /** @param {string} branch @returns {Promise<{ object: { sha: string } } | null>} */
    getBranchRef: (branch) => request('GET', `/git/ref/heads/${encodePath(branch)}`, { allow404: true }),
    /** @param {string} sha @returns {Promise<{ sha: string, tree: { sha: string } }>} */
    getCommit: (sha) => request('GET', `/git/commits/${sha}`),
    /** @param {string} sha @returns {Promise<{ tree: { path: string, type: string, sha: string }[], truncated: boolean }>} */
    getTree: (sha) => request('GET', `/git/trees/${sha}?recursive=1`),
    /** @param {string} path @param {string} ref @returns {Promise<string>} */
    getFileText: (path, ref) => request('GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, { accept: 'application/vnd.github.raw+json', text: true }),
    /** @param {{ content: string, encoding: 'utf-8' | 'base64' }} blob @returns {Promise<{ sha: string }>} */
    createBlob: (blob) => request('POST', '/git/blobs', { body: blob }),
    /** @param {{ base_tree: string, tree: { path: string, mode: string, type: string, sha: string | null }[] }} tree @returns {Promise<{ sha: string }>} */
    createTree: (tree) => request('POST', '/git/trees', { body: tree }),
    /** @param {{ message: string, tree: string, parents: string[] }} commit @returns {Promise<{ sha: string }>} */
    createCommit: (commit) => request('POST', '/git/commits', { body: commit }),
    /** @param {string} branch @param {string} sha */
    createBranch: (branch, sha) => request('POST', '/git/refs', { body: { ref: `refs/heads/${branch}`, sha } }),
    /** Fast-forward only: GitHub refuses if the branch moved meanwhile. @param {string} branch @param {string} sha */
    updateBranch: (branch, sha) => request('PATCH', `/git/refs/heads/${encodePath(branch)}`, { body: { sha, force: false } }),
    /** @param {string} branch @param {string} base @returns {Promise<{ number: number, html_url: string } | null>} */
    findOpenPullRequest: async (branch, base) => {
      const list = await request('GET', `/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(base)}`);
      return list[0] ?? null;
    },
    /** @param {{ title: string, head: string, base: string, body: string }} pr @returns {Promise<{ number: number, html_url: string }>} */
    createPullRequest: (pr) => request('POST', '/pulls', { body: pr }),
  };
}

/** @typedef {ReturnType<typeof createGitHubClient>} GitHubClient */
