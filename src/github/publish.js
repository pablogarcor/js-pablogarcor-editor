// @ts-check
/**
 * Publishing = one commit with the post and its images on a post branch,
 * plus a pull request against main. Azure Static Web Apps builds a preview
 * for the PR; merging it publishes the post.
 *
 * The commit is built with the Git Data API (blobs -> tree -> commit -> ref)
 * so the Markdown and every image land in a single commit. The Contents API
 * would make one commit per file.
 *
 * Nothing here pushes to main. Protect main with a rule that requires a pull
 * request and this token can only ever create branches and PRs.
 */

import { isPostPath, postRef } from '../hugo/post.js';

/**
 * @typedef {import('./client.js').GitHubClient} GitHubClient
 * @typedef {{ path: string, content: string | Uint8Array }} FileChange
 */

/**
 * @param {GitHubClient} client
 * @param {{
 *   branch: string,
 *   base?: string,
 *   files: FileChange[],
 *   message: string,
 *   pullRequest?: { title: string, body: string },
 * }} opts
 */
export async function publishFiles(client, { branch, base = 'main', files, message, pullRequest }) {
  if (branch === base) throw new Error(`Refusing to commit straight to ${base}: use a post branch.`);
  const baseRef = await client.getBranchRef(base);
  if (!baseRef) throw new Error(`Branch ${base} not found`);
  const existing = await client.getBranchRef(branch);
  const parentSha = existing ? existing.object.sha : baseRef.object.sha;
  const parent = await client.getCommit(parentSha);

  const blobs = await Promise.all(
    files.map((f) =>
      typeof f.content === 'string'
        ? client.createBlob({ content: f.content, encoding: 'utf-8' })
        : client.createBlob({ content: toBase64(f.content), encoding: 'base64' }),
    ),
  );
  const tree = await client.createTree({
    base_tree: parent.tree.sha,
    tree: files.map((f, i) => ({ path: f.path, mode: '100644', type: 'blob', sha: blobs[i].sha })),
  });

  let commitSha = parentSha;
  const changed = tree.sha !== parent.tree.sha;
  if (changed) {
    const commit = await client.createCommit({ message, tree: tree.sha, parents: [parentSha] });
    commitSha = commit.sha;
    if (existing) await client.updateBranch(branch, commitSha);
    else await client.createBranch(branch, commitSha);
  }

  let pr = await client.findOpenPullRequest(branch, base);
  if (!pr && pullRequest && (changed || existing)) {
    pr = await client.createPullRequest({ title: pullRequest.title, body: pullRequest.body, head: branch, base });
  }
  return { changed, branch, commitSha, pullRequest: pr ? { number: pr.number, url: pr.html_url } : null };
}

/**
 * Lists the posts on a branch: paths of every file, plus the identity of
 * each post (slug, translationKey...) read from its front matter.
 * @param {GitHubClient} client
 * @param {{ ref?: string }} [opts]
 */
export async function loadPosts(client, { ref = 'main' } = {}) {
  const head = await client.getBranchRef(ref);
  if (!head) throw new Error(`Branch ${ref} not found`);
  const commit = await client.getCommit(head.object.sha);
  const tree = await client.getTree(commit.tree.sha);
  if (tree.truncated) throw new Error('The repository tree is too large to list in one request.');
  const paths = tree.tree.filter((e) => e.type === 'blob').map((e) => e.path);
  const postPaths = paths.filter(isPostPath);
  const posts = await Promise.all(
    postPaths.map(async (path) => {
      const source = await client.getFileText(path, head.object.sha);
      return { ref: postRef(path, source), source };
    }),
  );
  return {
    sha: head.object.sha,
    paths,
    posts: posts.flatMap((p) => (p.ref ? [{ ...p.ref, source: p.source }] : [])),
  };
}

/**
 * Base64 without Buffer, so it also runs in the browser.
 * @param {Uint8Array} bytes
 */
export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
