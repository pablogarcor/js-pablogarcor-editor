/**
 * Local server for the editor. No dependencies.
 *
 *   node serve.js              -> http://localhost:8000
 *   PORT=9000 node serve.js
 *
 * ES modules do not load from file://, so the page needs a server. This one:
 *  - listens on 127.0.0.1 only and refuses requests whose Host is not a
 *    local name (a DNS rebinding page could otherwise read it);
 *  - serves index.html and src/ only: never .git, tests or anything else;
 *  - sends a strict Content-Security-Policy. The editor will hold a GitHub
 *    token, so no script may run unless it comes from this server, and no
 *    inline script or style is allowed.
 *
 * Plain Node (no DOM types), so it sits outside src/ and the tsc check.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

/**
 * The file a URL path maps to, or null when it must not be served.
 * @param {string} root
 * @param {string} urlPath
 */
export function resolvePath(root, urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  path = normalize(path === '/' ? '/index.html' : path).replaceAll('\\', '/');
  if (path !== '/index.html' && !path.startsWith('/src/')) return null;
  if (path.split('/').some((part) => part.startsWith('.'))) return null;
  if (!(extname(path) in TYPES)) return null;
  const file = join(root, path);
  return file.startsWith(root + sep) ? file : null;
}

/**
 * @param {{ root?: string }} [opts]
 */
export function createEditorServer({ root = dirname(fileURLToPath(import.meta.url)) } = {}) {
  return createServer(async (req, res) => {
    /** @param {number} status @param {string} body @param {Record<string, string>} [extra] */
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    const host = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (!LOCAL_HOSTS.has(host)) return send(403, 'Forbidden host\n');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed\n', { Allow: 'GET, HEAD' });

    const file = resolvePath(root, (req.url ?? '/').split('?')[0]);
    if (!file) return send(404, 'Not found\n');
    try {
      if (!(await stat(file)).isFile()) return send(404, 'Not found\n');
      const body = await readFile(file);
      res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[/** @type {keyof TYPES} */ (extname(file))] });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      send(404, 'Not found\n');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8000);
  createEditorServer().listen(port, '127.0.0.1', () => {
    console.log(`Editor en http://localhost:${port}`);
  });
}
