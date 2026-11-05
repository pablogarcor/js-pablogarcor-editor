// @ts-check
/**
 * The connection to the blog repository, and the only place that keeps the
 * token.
 *
 * The token lives in memory. If the user asks, it is also kept in
 * sessionStorage, so reloading the tab does not ask for it again; it goes
 * away when the tab is closed. Never in localStorage: it would stay on disk
 * and be readable by any page of this origin for good.
 */

import { createGitHubClient, GitHubError } from './client.js';

export const OWNER = 'pablogarcor';
export const REPO = 'js-pablogarcor-web';
const KEY = 'github-token';

/** @type {string | null} */
let token = null;
try {
  token = sessionStorage.getItem(KEY);
} catch {
  // No sessionStorage (blocked storage, Node): memory only.
}

export function isConnected() {
  return token !== null;
}

/**
 * Checks the token against the repository and keeps it.
 * @param {string} value
 * @param {{ remember: boolean, fetch?: typeof globalThis.fetch }} opts
 *   fetch: only for tests
 */
export async function connect(value, { remember, fetch: doFetch }) {
  const candidate = value.trim();
  if (!candidate) throw new Error('Pega el token.');
  const client = createGitHubClient({ token: candidate, owner: OWNER, repo: REPO, ...(doFetch ? { fetch: doFetch } : {}) });
  try {
    if (!(await client.getBranchRef('main'))) throw new Error(`${OWNER}/${REPO} no tiene rama main.`);
  } catch (err) {
    throw new Error(explain(err));
  }
  token = candidate;
  try {
    if (remember) sessionStorage.setItem(KEY, candidate);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Memory only.
  }
}

export function disconnect() {
  token = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

/** A client for the blog repository. Throws when not connected. */
export function client() {
  if (token === null) throw new Error('No estás conectado a GitHub.');
  return createGitHubClient({ token, owner: OWNER, repo: REPO });
}

/**
 * A GitHub error in words the user can act on.
 * @param {unknown} err
 */
export function explain(err) {
  if (err instanceof GitHubError) {
    if (err.status === 401) return 'GitHub no acepta el token: puede que haya caducado o esté mal copiado.';
    if (err.status === 403 || err.status === 404) {
      return `El token no tiene acceso a ${OWNER}/${REPO}, o le falta un permiso (Contents y Pull requests: Read and write).`;
    }
    if (err.status === 409 || err.status === 422) return `GitHub ha rechazado el cambio: ${err.message}`;
    return err.message;
  }
  if (err instanceof TypeError) return 'No se puede conectar con GitHub: ¿hay conexión a internet?';
  return err instanceof Error ? err.message : String(err);
}
