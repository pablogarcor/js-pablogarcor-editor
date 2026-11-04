// @ts-check
/**
 * Inline Markdown <-> runs.
 *
 * The parser follows the CommonMark inline algorithm (delimiter runs for
 * emphasis, code spans, inline links and images, autolinks, raw inline HTML,
 * entities and backslash escapes). Reference links are not supported: the
 * blog does not use them, and the block parser keeps definitions as raw text.
 *
 * The serializer writes the minimum escaping that still parses back to the
 * same runs. block.js checks that by parsing its own output, and retries
 * with stronger escaping when the check fails.
 */

import { cleanMarks, normalizeRuns } from '../model/inline.js';

/**
 * @typedef {import('../model/inline.js').Run} Run
 * @typedef {import('../model/inline.js').Marks} Marks
 * @typedef {{ type: 'text', value: string } | { type: 'code', value: string } | { type: 'html', value: string }
 *   | { type: 'break' } | { type: 'em' | 'strong', children: Node[] }
 *   | { type: 'link', href: string, title?: string, children: Node[] }
 *   | { type: 'image', src: string, title?: string, alt: string }} Node
 * @typedef {{ node: { type: 'text', value: string }, char: string, count: number, origCount: number, canOpen: boolean, canClose: boolean }} Delimiter
 * @typedef {{ node: { type: 'text', value: string }, image: boolean, delimBottom: number, active: boolean }} Bracket
 */

const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const NAMED_ENTITIES = /** @type {Record<string, string>} */ ({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', euro: '€', iexcl: '¡', iquest: '¿',
});
const HTML_TAG =
  /^(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)/;
const AUTOLINK = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/;
const EMAIL_AUTOLINK = /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/;
const ENTITY = /^&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/;

/** @param {string | undefined} ch */
const isWhitespace = (ch) => ch === undefined || /\s/u.test(ch);
/** @param {string | undefined} ch */
const isPunct = (ch) => ch !== undefined && /[\p{P}\p{S}]/u.test(ch);

/**
 * @param {string} src paragraph content: lines joined with "\n", already
 *   stripped of block markers and of leading whitespace
 * @returns {Run[]}
 */
export function parseInline(src) {
  return normalizeRuns(toRuns(parseNodes(src), {}));
}

/**
 * @param {string} src
 * @returns {Node[]}
 */
function parseNodes(src) {
  /** @type {Node[]} */
  const nodes = [];
  /** @type {Delimiter[]} */
  const delims = [];
  /** @type {Bracket[]} */
  const brackets = [];
  let text = '';
  const flush = () => {
    if (text) nodes.push({ type: 'text', value: text });
    text = '';
  };
  /** @param {string} value */
  const textNode = (value) => {
    flush();
    const node = /** @type {{ type: 'text', value: string }} */ ({ type: 'text', value });
    nodes.push(node);
    return node;
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '\n') {
        flush();
        nodes.push({ type: 'break' });
        i += 2;
        while (src[i] === ' ' || src[i] === '\t') i++;
      } else if (next !== undefined && ASCII_PUNCT.includes(next)) {
        text += next;
        i += 2;
      } else {
        text += '\\';
        i++;
      }
      continue;
    }

    if (ch === '`') {
      let n = 0;
      while (src[i + n] === '`') n++;
      const close = findBacktickRun(src, i + n, n);
      if (close < 0) {
        text += '`'.repeat(n);
        i += n;
        continue;
      }
      let content = src.slice(i + n, close).replace(/\n/g, ' ');
      if (content.length > 1 && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') content = content.slice(1, -1);
      flush();
      nodes.push({ type: 'code', value: content });
      i = close + n;
      continue;
    }

    if (ch === '*' || ch === '_') {
      let n = 0;
      while (src[i + n] === ch) n++;
      // Whole code points: an emoji next to a delimiter is one character.
      const before = i === 0 ? '\n' : codePointBefore(src, i);
      const after = i + n >= src.length ? '\n' : String.fromCodePoint(/** @type {number} */ (src.codePointAt(i + n)));
      const leftFlanking = !isWhitespace(after) && (!isPunct(after) || isWhitespace(before) || isPunct(before));
      const rightFlanking = !isWhitespace(before) && (!isPunct(before) || isWhitespace(after) || isPunct(after));
      const canOpen = ch === '*' ? leftFlanking : leftFlanking && (!rightFlanking || isPunct(before));
      const canClose = ch === '*' ? rightFlanking : rightFlanking && (!leftFlanking || isPunct(after));
      const node = textNode(ch.repeat(n));
      delims.push({ node, char: ch, count: n, origCount: n, canOpen, canClose });
      i += n;
      continue;
    }

    if (ch === '!' && src[i + 1] === '[') {
      brackets.push({ node: textNode('!['), image: true, delimBottom: delims.length, active: true });
      i += 2;
      continue;
    }

    if (ch === '[') {
      brackets.push({ node: textNode('['), image: false, delimBottom: delims.length, active: true });
      i++;
      continue;
    }

    if (ch === ']') {
      flush();
      const opener = brackets[brackets.length - 1];
      const dest = opener && opener.active ? parseLinkTail(src, i + 1) : null;
      if (!opener || !dest) {
        if (opener) brackets.pop();
        text += ']';
        i++;
        continue;
      }
      brackets.pop();
      const at = nodes.indexOf(opener.node);
      const children = nodes.splice(at + 1);
      nodes.splice(at, 1);
      processEmphasis(children, delims.splice(opener.delimBottom));
      if (opener.image) {
        nodes.push(dest.title === undefined ? { type: 'image', src: dest.href, alt: plainOf(children) } : { type: 'image', src: dest.href, title: dest.title, alt: plainOf(children) });
      } else {
        nodes.push(dest.title === undefined ? { type: 'link', href: dest.href, children } : { type: 'link', href: dest.href, title: dest.title, children });
        for (const b of brackets) if (!b.image) b.active = false;
      }
      i = dest.end;
      continue;
    }

    if (ch === '<') {
      const rest = src.slice(i);
      const url = AUTOLINK.exec(rest);
      const email = url ? null : EMAIL_AUTOLINK.exec(rest);
      const auto = url ?? email;
      if (auto) {
        flush();
        const href = email ? `mailto:${auto[1]}` : auto[1];
        nodes.push({ type: 'link', href, children: [{ type: 'text', value: auto[1] }] });
        i += auto[0].length;
        continue;
      }
      const tag = HTML_TAG.exec(rest);
      if (tag) {
        flush();
        nodes.push({ type: 'html', value: tag[0] });
        i += tag[0].length;
        continue;
      }
    }

    if (ch === '&') {
      const m = ENTITY.exec(src.slice(i));
      const decoded = m && decodeEntity(m);
      if (decoded !== null && m) {
        text += decoded;
        i += m[0].length;
        continue;
      }
    }

    if (ch === '\n') {
      const spaces = /[ \t]*$/.exec(text)?.[0].length ?? 0;
      text = text.slice(0, text.length - spaces);
      flush();
      nodes.push(spaces >= 2 ? { type: 'break' } : { type: 'text', value: '\n' });
      i++;
      while (src[i] === ' ' || src[i] === '\t') i++;
      continue;
    }

    text += ch;
    i++;
  }
  flush();
  processEmphasis(nodes, delims);
  return nodes;
}

/**
 * @param {string} s
 * @param {number} i
 */
function codePointBefore(s, i) {
  const low = s.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
    const high = s.charCodeAt(i - 2);
    if (high >= 0xd800 && high <= 0xdbff) return s.slice(i - 2, i);
  }
  return s[i - 1];
}

/**
 * @param {string} src
 * @param {number} from
 * @param {number} n
 */
function findBacktickRun(src, from, n) {
  let k = from;
  while (k < src.length) {
    if (src[k] === '`') {
      let m = 0;
      while (src[k + m] === '`') m++;
      if (m === n) return k;
      k += m;
    } else k++;
  }
  return -1;
}

/**
 * Parses "(destination "title")" right after a closing bracket.
 * @param {string} src
 * @param {number} pos index of the character after "]"
 * @returns {{ href: string, title?: string, end: number } | null}
 */
function parseLinkTail(src, pos) {
  if (src[pos] !== '(') return null;
  let i = skipSpace(src, pos + 1);
  let href = '';
  if (src[i] === '<') {
    let j = i + 1;
    while (j < src.length && src[j] !== '>' && src[j] !== '\n' && src[j] !== '<') j += src[j] === '\\' ? 2 : 1;
    if (src[j] !== '>') return null;
    href = src.slice(i + 1, j);
    i = j + 1;
  } else {
    let depth = 0;
    let j = i;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\' && ASCII_PUNCT.includes(src[j + 1] ?? '')) {
        j += 2;
        continue;
      }
      if (/[\s\x00-\x1f]/.test(c)) break;
      if (c === '(') depth++;
      if (c === ')') {
        if (depth === 0) break;
        depth--;
      }
      j++;
    }
    if (depth !== 0) return null;
    href = src.slice(i, j);
    i = j;
  }
  const beforeTitle = i;
  i = skipSpace(src, i);
  /** @type {string | undefined} */
  let title;
  const q = src[i];
  if ((q === '"' || q === "'" || q === '(') && i > beforeTitle) {
    const closeQ = q === '(' ? ')' : q;
    let j = i + 1;
    while (j < src.length && src[j] !== closeQ) j += src[j] === '\\' ? 2 : 1;
    if (src[j] !== closeQ) return null;
    title = unescape(src.slice(i + 1, j));
    i = skipSpace(src, j + 1);
  }
  if (src[i] !== ')') return null;
  return title === undefined ? { href: unescape(href), end: i + 1 } : { href: unescape(href), title, end: i + 1 };
}

/**
 * @param {string} src
 * @param {number} i
 */
function skipSpace(src, i) {
  let newlines = 0;
  while (i < src.length && (src[i] === ' ' || src[i] === '\t' || (src[i] === '\n' && newlines++ < 1))) i++;
  return i;
}

/** @param {string} s */
function unescape(s) {
  return s.replace(/\\([!-/:-@[-`{-~])|&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (whole, esc, dec, hex, name) => {
    if (esc) return esc;
    const decoded = decodeEntity(/** @type {RegExpExecArray} */ (/** @type {unknown} */ ([whole, dec, hex, name])));
    return decoded ?? whole;
  });
}

/**
 * @param {RegExpExecArray} m
 * @returns {string | null}
 */
function decodeEntity(m) {
  if (m[1] !== undefined || m[2] !== undefined) {
    const code = m[1] !== undefined ? parseInt(m[1], 10) : parseInt(m[2], 16);
    return code === 0 || code > 0x10ffff ? '\ufffd' : String.fromCodePoint(code);
  }
  return NAMED_ENTITIES[m[3]] ?? null;
}

/**
 * CommonMark "process emphasis" over one list of sibling nodes.
 * @param {Node[]} list
 * @param {Delimiter[]} ds
 */
function processEmphasis(list, ds) {
  let ci = 0;
  while (ci < ds.length) {
    const closer = ds[ci];
    if (!closer.canClose) {
      ci++;
      continue;
    }
    let found = -1;
    for (let oi = ci - 1; oi >= 0; oi--) {
      const op = ds[oi];
      if (op.char !== closer.char || !op.canOpen) continue;
      const ruleOfThree =
        (op.canClose || closer.canOpen) && (op.origCount + closer.origCount) % 3 === 0 && !(op.origCount % 3 === 0 && closer.origCount % 3 === 0);
      if (!ruleOfThree) {
        found = oi;
        break;
      }
    }
    if (found < 0) {
      if (!closer.canOpen) ds.splice(ci, 1);
      else ci++;
      continue;
    }
    const opener = ds[found];
    const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const oIdx = list.indexOf(opener.node);
    const cIdx = list.indexOf(closer.node);
    const inner = list.slice(oIdx + 1, cIdx);
    list.splice(oIdx + 1, cIdx - oIdx - 1, { type: use === 2 ? 'strong' : 'em', children: inner });
    ds.splice(found + 1, ci - found - 1);
    ci = found + 1;
    opener.count -= use;
    opener.node.value = opener.node.value.slice(use);
    closer.count -= use;
    closer.node.value = closer.node.value.slice(use);
    if (opener.count === 0) {
      list.splice(list.indexOf(opener.node), 1);
      ds.splice(found, 1);
      ci--;
    }
    if (closer.count === 0) {
      list.splice(list.indexOf(closer.node), 1);
      ds.splice(ci, 1);
    }
  }
}

/**
 * @param {Node[]} nodes
 * @returns {string}
 */
function plainOf(nodes) {
  return nodes
    .map((n) => {
      if (n.type === 'text' || n.type === 'code') return n.value;
      if (n.type === 'image') return n.alt;
      if (n.type === 'break') return '\n';
      if ('children' in n) return plainOf(n.children);
      return '';
    })
    .join('');
}

/**
 * @param {Node[]} nodes
 * @param {Marks} marks
 * @returns {Run[]}
 */
function toRuns(nodes, marks) {
  return nodes.flatMap((n) => {
    switch (n.type) {
      case 'text':
        return [{ type: 'text', text: n.value, marks: cleanMarks(marks) }];
      case 'code':
        return [{ type: 'text', text: n.value, marks: cleanMarks({ ...marks, code: true }) }];
      case 'html':
        return [{ type: 'html', html: n.value, marks: cleanMarks(marks) }];
      case 'break':
        return [{ type: 'break', marks: {} }];
      case 'image':
        return [n.title === undefined ? { type: 'image', src: n.src, alt: n.alt, marks: cleanMarks(marks) } : { type: 'image', src: n.src, alt: n.alt, title: n.title, marks: cleanMarks(marks) }];
      case 'em':
      case 'strong':
        return toRuns(n.children, { ...marks, [n.type]: true });
      case 'link':
        return toRuns(n.children, { ...marks, link: n.title === undefined ? { href: n.href } : { href: n.href, title: n.title } });
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * @typedef {{ level: 0 | 1 | 2, em: '*' | '_', nested?: '*' | '_' }} InlineStyle
 * level 0: escape only what certainly breaks (backslashes before punctuation)
 * level 1: also escape characters that may open syntax (* _ ` [ ] < & ~)
 * level 2: escape every ASCII punctuation character
 * em: emphasis delimiter; nested: the one used right inside "**" ("**_x_**"
 *   reads better than "***x***"), defaults to `em`.
 */

/** @type {MarkNameOrder} */
const ORDER = ['link', 'strong', 'em', 'code'];
/** @typedef {('link' | 'strong' | 'em' | 'code')[]} MarkNameOrder */
/** @typedef {{ name: 'link' | 'strong' | 'em' | 'code', link?: import('../model/inline.js').LinkMark, delim?: string }} OpenMark */

/**
 * Moves leading and trailing whitespace out of strong/em spans, where it is
 * invisible anyway but would stop the delimiters from closing ("**word **").
 * Also used to compare models, so both sides normalize the same way.
 * @param {Run[]} input
 * @returns {Run[]}
 */
export function expelWhitespace(input) {
  let runs = normalizeRuns(input);
  for (let pass = 0; pass < 4; pass++) {
    /** @type {Run[]} */
    const out = [];
    let changed = false;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      if (run.type !== 'text' || run.marks.code || !(run.marks.strong || run.marks.em)) {
        out.push(run);
        continue;
      }
      const prev = runs[i - 1];
      const next = runs[i + 1];
      const startsSpan = (/** @type {'strong'|'em'} */ m) => run.marks[m] && !(prev && prev.marks[m]);
      const endsSpan = (/** @type {'strong'|'em'} */ m) => run.marks[m] && !(next && next.marks[m]);
      const lead = /^\s+/.exec(run.text)?.[0] ?? '';
      const trail = run.text.length > lead.length ? /\s+$/.exec(run.text)?.[0] ?? '' : '';
      /** @param {'start'|'end'} side */
      const stripped = (side) => {
        const m = { ...run.marks };
        for (const k of /** @type {const} */ (['strong', 'em'])) if (side === 'start' ? startsSpan(k) : endsSpan(k)) delete m[k];
        return m;
      };
      if (lead.length === run.text.length) {
        const m = { ...run.marks };
        for (const k of /** @type {const} */ (['strong', 'em'])) {
          if (startsSpan(k) || endsSpan(k)) {
            delete m[k];
            changed = true;
          }
        }
        out.push({ ...run, marks: m });
        continue;
      }
      const middle = run.text.slice(lead.length, run.text.length - trail.length);
      if (lead && (startsSpan('strong') || startsSpan('em'))) {
        out.push({ type: 'text', text: lead, marks: stripped('start') });
        changed = true;
      } else if (lead) out.push({ type: 'text', text: lead, marks: run.marks });
      out.push({ ...run, text: middle });
      if (trail && (endsSpan('strong') || endsSpan('em'))) {
        out.push({ type: 'text', text: trail, marks: stripped('end') });
        changed = true;
      } else if (trail) out.push({ type: 'text', text: trail, marks: run.marks });
    }
    runs = normalizeRuns(out);
    if (!changed) break;
  }
  return runs;
}

/**
 * @param {Run[]} input
 * @param {InlineStyle} [style]
 */
export function serializeInline(input, style = { level: 0, em: '*' }) {
  const runs = expelWhitespace(input);
  /** @type {Segment[]} */
  const segs = [];
  /** @type {OpenMark[]} */
  const active = [];
  /** @param {OpenMark} m @param {boolean} open @param {Run | undefined} run */
  const emitMark = (m, open, run) => {
    const s = open ? openMark(m, /** @type {Run} */ (run), style) : closeMark(m, run, style);
    segs.push(m.name === 'strong' || m.name === 'em' ? { kind: 'delim', s, open } : { kind: 'syntax', s });
  };
  const afterStrong = () => {
    const last = segs[segs.length - 1];
    return last?.kind === 'delim' && last.s === '**' && active.some((a) => a.name === 'strong');
  };
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (active.length && active[active.length - 1].name === 'code') emitMark(/** @type {OpenMark} */ (active.pop()), false, runs[i - 1]);
    const want = marksOf(run);
    let keep = 0;
    while (keep < active.length && want.some((m) => sameMark(m, active[keep]))) keep++;
    while (active.length > keep) emitMark(/** @type {OpenMark} */ (active.pop()), false, runs[i - 1]);
    const toOpen = want.filter((m) => !active.some((a) => sameMark(a, m)));
    toOpen.sort(
      (a, b) =>
        Number(a.name === 'code') - Number(b.name === 'code') || extent(runs, i, b) - extent(runs, i, a) || ORDER.indexOf(a.name) - ORDER.indexOf(b.name),
    );
    for (const m of toOpen) {
      const opened = m.name === 'em' ? { ...m, delim: afterStrong() ? style.nested ?? style.em : style.em } : m;
      emitMark(opened, true, run);
      active.push(opened);
    }
    const plain = run.type === 'text' && !run.marks.code;
    segs.push({ kind: plain ? 'text' : 'syntax', s: content(run, style, runs[i - 1], runs[i + 1]) });
  }
  while (active.length) emitMark(/** @type {OpenMark} */ (active.pop()), false, runs[runs.length - 1]);
  fixFlanking(segs);
  return segs.map((seg) => seg.s).join('');
}

/** @typedef {{ kind: 'text' | 'syntax', s: string } | { kind: 'delim', s: string, open: boolean }} Segment */

/**
 * CommonMark cannot open or close emphasis between punctuation and a letter
 * ("**"quoted"**word"). The way out, as remark does, is to write the
 * letter outside the delimiter as a character reference ("&#x77;"): it
 * renders the same and counts as punctuation for the flanking rules.
 * @param {Segment[]} segs
 */
function fixFlanking(segs) {
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.kind !== 'delim') continue;
    // Whitespace inside the delimiters ("_word _") stops them from working.
    // It can still happen when a mark has to close early because an outer
    // one ends (a link): move the whitespace outside, where it looks the same.
    if (!seg.open) moveWhitespace(segs, i, -1);
    else if (moveWhitespace(segs, i, 1) === true) i++;
    const before = charBefore(segs, i);
    const after = charAfter(segs, i);
    if (delimiterWorks(seg.s[0], before, after, seg.open)) continue;
    if (seg.open) encodeEdge(segs, i, -1);
    else encodeEdge(segs, i, 1);
  }
}

/**
 * @param {Segment[]} segs
 * @param {number} i delimiter index
 * @param {-1 | 1} dir side of the delimiter to clear
 */
function moveWhitespace(segs, i, dir) {
  const j = i + dir;
  const seg = segs[j];
  if (!seg || seg.kind !== 'text') return;
  const m = dir < 0 ? /\s+$/.exec(seg.s) : /^\s+/.exec(seg.s);
  if (!m) return;
  segs[j] = { ...seg, s: dir < 0 ? seg.s.slice(0, -m[0].length) : seg.s.slice(m[0].length) };
  // Move it past the whole group of delimiters ("_**" or "**_"), or it would
  // end up inside the outer one.
  let k = i;
  const sameSide = (/** @type {Segment | undefined} */ x) => x?.kind === 'delim' && x.open === (dir > 0);
  if (dir < 0) while (sameSide(segs[k + 1])) k++;
  else while (sameSide(segs[k - 1])) k--;
  if (dir < 0) segs.splice(k + 1, 0, { kind: 'text', s: m[0] });
  else segs.splice(k, 0, { kind: 'text', s: m[0] });
  return true;
}

/**
 * @param {string} ch
 * @param {string | undefined} before
 * @param {string | undefined} after
 * @param {boolean} open
 */
function delimiterWorks(ch, before, after, open) {
  const lf = !isWhitespace(after) && (!isPunct(after) || isWhitespace(before) || isPunct(before));
  const rf = !isWhitespace(before) && (!isPunct(before) || isWhitespace(after) || isPunct(after));
  if (open) return ch === '*' ? lf : lf && (!rf || isPunct(before));
  return ch === '*' ? rf : rf && (!lf || isPunct(after));
}

/** @param {Segment[]} segs @param {number} i */
function charBefore(segs, i) {
  for (let j = i - 1; j >= 0; j--) if (segs[j].s) return Array.from(segs[j].s).pop();
  return undefined;
}

/** @param {Segment[]} segs @param {number} i */
function charAfter(segs, i) {
  for (let j = i + 1; j < segs.length; j++) if (segs[j].s) return Array.from(segs[j].s)[0];
  return undefined;
}

/**
 * Replaces the character next to segment i (dir -1: the one before it, +1:
 * the one after it) with a numeric character reference, if that character
 * is plain text and not whitespace or punctuation.
 * @param {Segment[]} segs
 * @param {number} i
 * @param {-1 | 1} dir
 */
function encodeEdge(segs, i, dir) {
  let j = i + dir;
  while (j >= 0 && j < segs.length && !segs[j].s) j += dir;
  const seg = segs[j];
  if (!seg || seg.kind !== 'text') return;
  const chars = Array.from(seg.s);
  const at = dir < 0 ? chars.length - 1 : 0;
  const c = chars[at];
  if (isWhitespace(c) || isPunct(c)) return;
  let slashes = 0;
  while (at - 1 - slashes >= 0 && chars[at - 1 - slashes] === '\\') slashes++;
  // An unpaired backslash before "&" would escape the reference: pair it.
  chars[at] = `${slashes % 2 ? '\\' : ''}&#x${/** @type {number} */ (c.codePointAt(0)).toString(16).toUpperCase()};`;
  segs[j] = { ...seg, s: chars.join('') };
}

/** @param {Run} run @returns {OpenMark[]} */
function marksOf(run) {
  /** @type {OpenMark[]} */
  const out = [];
  if (run.type === 'break') return out;
  if (run.marks.link) out.push({ name: 'link', link: run.marks.link });
  if (run.marks.strong) out.push({ name: 'strong' });
  if (run.marks.em) out.push({ name: 'em' });
  if (run.marks.code && run.type === 'text') out.push({ name: 'code' });
  return out;
}

/** @param {OpenMark} a @param {OpenMark} b */
function sameMark(a, b) {
  return a.name === b.name && (a.name !== 'link' || JSON.stringify(a.link) === JSON.stringify(b.link));
}

/** @param {Run[]} runs @param {number} i @param {OpenMark} m */
function extent(runs, i, m) {
  let n = 0;
  while (runs[i + n] && marksOf(runs[i + n]).some((x) => sameMark(x, m))) n++;
  return n;
}

/** @param {string} code */
function codeFence(code) {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((s) => s.length));
  return '`'.repeat(longest + 1 === 1 ? 1 : longest + 1);
}

/** @param {OpenMark} m @param {Run} run @param {InlineStyle} style */
function openMark(m, run, style) {
  if (m.name === 'link') return '[';
  if (m.name === 'strong') return '**';
  if (m.name === 'em') return m.delim ?? style.em;
  const code = run.type === 'text' ? run.text : '';
  const fence = codeFence(code);
  return fence + (needsCodePadding(code) ? ' ' : '');
}

/** @param {OpenMark} m @param {Run | undefined} run @param {InlineStyle} style */
function closeMark(m, run, style) {
  if (m.name === 'link') return `](${destination(m.link?.href ?? '')}${m.link?.title !== undefined ? ` ${quoteTitle(m.link.title)}` : ''})`;
  if (m.name === 'strong') return '**';
  if (m.name === 'em') return m.delim ?? style.em;
  const code = run && run.type === 'text' ? run.text : '';
  return (needsCodePadding(code) ? ' ' : '') + codeFence(code);
}

/** @param {string} code */
function needsCodePadding(code) {
  return code.startsWith('`') || code.endsWith('`') || (code.length > 1 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '');
}

/**
 * @param {Run} run
 * @param {InlineStyle} style
 * @param {Run | undefined} prev
 * @param {Run | undefined} next
 */
function content(run, style, prev, next) {
  switch (run.type) {
    case 'break':
      return '\\\n';
    case 'html':
      return run.html;
    case 'image':
      return `![${escapeLabel(run.alt)}](${destination(run.src)}${run.title !== undefined ? ` ${quoteTitle(run.title)}` : ''})`;
    case 'text':
      if (run.marks.code) return run.text;
      return escapeText(run.text, style.level, prev, next);
  }
}

/**
 * @param {string} s
 * @param {0 | 1 | 2} level
 * @param {Run | undefined} prev
 * @param {Run | undefined} next
 */
export function escapeText(s, level, prev, next) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const before = i > 0 ? s[i - 1] : prev ? 'x' : ' ';
    const after = i + 1 < s.length ? s[i + 1] : next ? 'x' : ' ';
    let esc = false;
    if (c === '\\') esc = ASCII_PUNCT.includes(after) || after === ' ' || after === '\n' || i === s.length - 1;
    else if (c === '~') esc = after === '~' || before === '~';
    else if (level === 2) esc = ASCII_PUNCT.includes(c);
    else if (level === 1) {
      if (c === '`' || c === '[' || c === ']') esc = true;
      else if (c === '*') esc = !(isWhitespace(before) && isWhitespace(after));
      else if (c === '_') esc = !(isWhitespace(before) && isWhitespace(after)) && !(/[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after));
      else if (c === '<') esc = /[A-Za-z/!?]/.test(after);
      else if (c === '&') esc = /^&#?[A-Za-z0-9]+;/.test(s.slice(i));
      else if (c === '!') esc = after === '[';
    }
    out += esc ? `\\${c}` : c;
  }
  return out;
}

/** @param {string} s */
function escapeLabel(s) {
  return s.replace(/[\\[\]`*_<&]/g, (c) => `\\${c}`);
}

/** @param {string} href */
function destination(href) {
  if (href === '') return '<>';
  if (/[\s<>]/.test(href) || !balancedParens(href)) return `<${href.replace(/[<>\\]/g, (c) => `\\${c}`)}>`;
  return href.replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\');
}

/** @param {string} s */
function balancedParens(s) {
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** @param {string} title */
function quoteTitle(title) {
  return `"${title.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}
