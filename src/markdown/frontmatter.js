// @ts-check
/**
 * YAML front matter, limited to the subset Hugo posts use:
 *   key: "double quoted"   key: 'single'   key: 2026-07-31
 *   key: ["flow", "list"]
 *   key:
 *     - block list item
 *
 * Every entry keeps the exact lines it came from (`raw`). Untouched entries
 * are written back byte for byte; only edited ones are re-rendered. Lines the
 * parser does not understand become opaque entries and are never rewritten.
 */

/**
 * @typedef {'double' | 'single' | 'plain' | 'flow' | 'block' | 'opaque'} FieldStyle
 * @typedef {{ key: string | null, value: any, style: FieldStyle, raw?: string }} Entry
 * @typedef {{ fence: string, entries: Entry[], raw?: string }} FrontMatter
 */

const KEY_LINE = /^([A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const DATE_KEYS = new Set(['date', 'lastmod', 'publishDate', 'expiryDate']);

/**
 * Splits a document into its front matter block (fences included) and the
 * rest. The rest starts with the line break that ends the closing fence.
 * @param {string} source
 * @returns {{ frontMatter: string | null, body: string }}
 */
export function splitFrontMatter(source) {
  const m = /^(---)[ \t]*\r?\n/.exec(source);
  if (!m) return { frontMatter: null, body: source };
  const close = /\r?\n(---|\.\.\.)[ \t]*(?=\r?\n|$)/g;
  close.lastIndex = m[0].length - 1;
  const c = close.exec(source);
  if (!c) return { frontMatter: null, body: source };
  const end = c.index + c[0].length;
  return { frontMatter: source.slice(0, end), body: source.slice(end) };
}

/**
 * @param {string} raw front matter including both fences
 * @returns {FrontMatter}
 */
export function parseFrontMatter(raw) {
  const lines = raw.split('\n');
  const fence = lines[0].trim();
  const inner = lines.slice(1, -1);
  /** @type {{ key: string | null, lines: string[], head: string }[]} */
  const groups = [];
  for (const line of inner) {
    const m = KEY_LINE.exec(line);
    if (m) groups.push({ key: m[1], lines: [line], head: m[2] ?? '' });
    else if (groups.length && (line.trim() === '' || /^[ \t]/.test(line))) groups[groups.length - 1].lines.push(line);
    else groups.push({ key: null, lines: [line], head: '' });
  }
  const entries = groups.map((g) => ({ ...parseValue(g.key, g.head, g.lines.slice(1)), raw: g.lines.join('\n') }));
  return { fence, entries, raw };
}

/**
 * @param {string | null} key
 * @param {string} head text after "key:" on the first line
 * @param {string[]} rest continuation lines
 * @returns {Entry}
 */
function parseValue(key, head, rest) {
  const opaque = () => ({ key, value: [head, ...rest].join('\n'), style: /** @type {FieldStyle} */ ('opaque') });
  if (key === null) return opaque();
  const tail = rest.filter((l) => l.trim() !== '');
  if (head === '' && tail.length && tail.every((l) => /^[ \t]+-[ \t]+\S/.test(l))) {
    const items = tail.map((l) => scalar(l.replace(/^[ \t]+-[ \t]+/, '').trim()));
    return items.every((v) => v !== undefined) ? { key, value: items, style: 'block' } : opaque();
  }
  if (tail.length) return opaque();
  if (head.startsWith('[')) {
    const items = flowList(head);
    return items ? { key, value: items, style: 'flow' } : opaque();
  }
  if (head.startsWith('"')) {
    try {
      const value = JSON.parse(head);
      if (typeof value === 'string') return { key, value, style: 'double' };
    } catch {
      /* not JSON-compatible YAML escapes: keep it opaque */
    }
    return opaque();
  }
  if (head.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'$/.exec(head);
    return m ? { key, value: m[1].replace(/''/g, "'"), style: 'single' } : opaque();
  }
  if (/^[|>{&*!%@`]/.test(head) || /\s#/.test(head)) return opaque();
  return { key, value: head, style: 'plain' };
}

/**
 * @param {string} s
 * @returns {string | undefined}
 */
function scalar(s) {
  if (s.startsWith('"')) {
    try {
      const v = JSON.parse(s);
      return typeof v === 'string' ? v : undefined;
    } catch {
      return undefined;
    }
  }
  if (s.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'$/.exec(s);
    return m ? m[1].replace(/''/g, "'") : undefined;
  }
  if (/^[\[{|>&*!%@`#]/.test(s) || /\s#/.test(s)) return undefined;
  return s;
}

/**
 * @param {string} s
 * @returns {string[] | null}
 */
function flowList(s) {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
  } catch {
    /* fall through to the plain-scalar form */
  }
  const m = /^\[(.*)\]$/.exec(s);
  if (!m) return null;
  if (m[1].trim() === '') return [];
  const items = m[1].split(',').map((x) => scalar(x.trim()));
  return items.every((x) => x !== undefined && x !== '') ? /** @type {string[]} */ (items) : null;
}

/**
 * @param {FrontMatter} fm
 * @param {{ canonical?: boolean }} [opts]
 */
export function serializeFrontMatter(fm, { canonical = false } = {}) {
  const body = fm.entries.map((e) => (!canonical && e.raw !== undefined ? e.raw : renderEntry(e)));
  return [fm.fence || '---', ...body, fm.fence === '...' ? '...' : '---'].join('\n');
}

/** @param {Entry} e */
function renderEntry(e) {
  if (e.style === 'opaque') return e.raw ?? (e.key === null ? String(e.value) : `${e.key}: ${e.value}`);
  const key = /** @type {string} */ (e.key);
  switch (e.style) {
    case 'double':
      return `${key}: ${JSON.stringify(e.value)}`;
    case 'single':
      return `${key}: '${String(e.value).replace(/'/g, "''")}'`;
    case 'plain':
      return `${key}: ${e.value}`;
    case 'flow':
      return `${key}: [${e.value.map((/** @type {string} */ v) => JSON.stringify(v)).join(', ')}]`;
    case 'block':
      return [`${key}:`, ...e.value.map((/** @type {string} */ v) => `  - ${plainSafe(v) ? v : JSON.stringify(v)}`)].join('\n');
  }
  return `${key}: ${e.value}`;
}

/** @param {string} v */
function plainSafe(v) {
  return v !== '' && !/^[\s\[\]{}&*!|>'"%@`#,?:-]|[:#]\s|\s$/.test(v) && !/^(true|false|null|~|yes|no|on|off)$/i.test(v);
}

/**
 * @param {FrontMatter | null} fm
 * @param {string} key
 */
export function getField(fm, key) {
  return fm?.entries.find((e) => e.key === key)?.value;
}

/**
 * Sets a field, keeping the original lines of every other field. New fields
 * are placed according to `order` (the order the blog's posts use).
 * @param {FrontMatter | null} fm
 * @param {string} key
 * @param {any} value
 * @param {{ order?: string[], style?: FieldStyle }} [opts]
 * @returns {FrontMatter}
 */
export function setField(fm, key, value, { order = [], style } = {}) {
  const base = fm ?? { fence: '---', entries: [] };
  const index = base.entries.findIndex((e) => e.key === key);
  const current = index >= 0 ? base.entries[index] : undefined;
  if (current && current.style !== 'opaque' && JSON.stringify(current.value) === JSON.stringify(value)) return base;
  /** @type {Entry} */
  const entry = { key, value, style: style ?? pickStyle(key, value, current) };
  const entries = [...base.entries];
  if (index >= 0) entries[index] = entry;
  else entries.splice(insertionIndex(entries, key, order), 0, entry);
  return { fence: base.fence, entries };
}

/**
 * @param {FrontMatter | null} fm
 * @param {string} key
 * @returns {FrontMatter | null}
 */
export function removeField(fm, key) {
  if (!fm) return fm;
  return { fence: fm.fence, entries: fm.entries.filter((e) => e.key !== key) };
}

/**
 * @param {string} key
 * @param {any} value
 * @param {Entry} [current]
 * @returns {FieldStyle}
 */
function pickStyle(key, value, current) {
  if (Array.isArray(value)) {
    if (current && (current.style === 'flow' || current.style === 'block')) return current.style;
    return key === 'aliases' ? 'block' : 'flow';
  }
  if (typeof value !== 'string') return 'plain';
  if (DATE_KEYS.has(key) && /^\d{4}-\d{2}-\d{2}([T ][\d:.+-]+Z?)?$/.test(value)) return 'plain';
  return 'double';
}

/**
 * @param {Entry[]} entries
 * @param {string} key
 * @param {string[]} order
 */
function insertionIndex(entries, key, order) {
  const rank = order.indexOf(key);
  if (rank < 0) return entries.length;
  const after = entries.findIndex((e) => e.key !== null && order.indexOf(e.key) > rank);
  return after < 0 ? entries.length : after;
}

/**
 * Plain object view of the fields (opaque entries excluded).
 * @param {FrontMatter | null} fm
 * @returns {Record<string, any>}
 */
export function fieldsOf(fm) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const e of fm?.entries ?? []) if (e.key !== null && e.style !== 'opaque') out[e.key] = e.value;
  return out;
}
