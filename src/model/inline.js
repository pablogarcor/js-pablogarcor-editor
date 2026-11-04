// @ts-check
/**
 * Inline content model: a flat list of runs, each carrying a set of marks.
 *
 * Flat runs (instead of a tree) keep editing operations simple: applying bold
 * to a selection is "split at the two offsets and add a mark to the runs in
 * between". The Markdown layer turns runs into nested syntax and back.
 *
 * Offsets count characters of text runs; every atom (image, html, break)
 * counts as one position.
 */

/**
 * @typedef {{ href: string, title?: string }} LinkMark
 * @typedef {{ strong?: boolean, em?: boolean, code?: boolean, link?: LinkMark }} Marks
 * @typedef {{ type: 'text', text: string, marks: Marks }} TextRun
 * @typedef {{ type: 'image', src: string, alt: string, title?: string, marks: Marks }} ImageRun
 * @typedef {{ type: 'html', html: string, marks: Marks }} HtmlRun
 * @typedef {{ type: 'break', marks: Marks }} BreakRun
 * @typedef {TextRun | ImageRun | HtmlRun | BreakRun} Run
 * @typedef {'strong' | 'em' | 'code' | 'link'} MarkName
 */

/** @type {MarkName[]} */
export const MARK_NAMES = ['link', 'strong', 'em', 'code'];

/**
 * @param {string} text
 * @param {Marks} [marks]
 * @returns {TextRun}
 */
export function text(text, marks = {}) {
  return { type: 'text', text, marks: cleanMarks(marks) };
}

/**
 * Canonical copy of a marks object: only set marks, in a fixed key order,
 * so that two equal mark sets also serialize to the same JSON.
 * @param {Marks | undefined} marks
 * @returns {Marks}
 */
export function cleanMarks(marks) {
  /** @type {Marks} */
  const out = {};
  if (!marks) return out;
  if (marks.link) {
    out.link = marks.link.title ? { href: marks.link.href, title: marks.link.title } : { href: marks.link.href };
  }
  if (marks.strong) out.strong = true;
  if (marks.em) out.em = true;
  if (marks.code) out.code = true;
  return out;
}

/**
 * @param {Marks} a
 * @param {Marks} b
 */
export function sameMarks(a, b) {
  return JSON.stringify(cleanMarks(a)) === JSON.stringify(cleanMarks(b));
}

/** @param {Run} run */
export function runLength(run) {
  return run.type === 'text' ? run.text.length : 1;
}

/** @param {Run[]} runs */
export function runsLength(runs) {
  return runs.reduce((n, r) => n + runLength(r), 0);
}

/**
 * Drops empty text runs and merges neighbours that share the same marks.
 * @param {Run[]} runs
 * @returns {Run[]}
 */
export function normalizeRuns(runs) {
  /** @type {Run[]} */
  const out = [];
  for (const run of runs) {
    const r = /** @type {Run} */ ({ ...run, marks: cleanMarks(run.marks) });
    if (r.type === 'break') r.marks = {};
    // Only text can be code: an image or an HTML tag inside backticks is text.
    if (r.type !== 'text') delete r.marks.code;
    if (r.type === 'text' && r.text === '') continue;
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && r.type === 'text' && sameMarks(prev.marks, r.marks)) {
      out[out.length - 1] = { ...prev, text: prev.text + r.text };
    } else {
      out.push(r);
    }
  }
  return out;
}

/** @param {Run[]} runs */
export function plainText(runs) {
  return runs
    .map((r) => (r.type === 'text' ? r.text : r.type === 'image' ? r.alt : r.type === 'break' ? '\n' : ''))
    .join('');
}

/**
 * Splits the runs at a character offset.
 * @param {Run[]} runs
 * @param {number} offset
 * @returns {[Run[], Run[]]}
 */
export function splitRuns(runs, offset) {
  /** @type {Run[]} */
  const left = [];
  /** @type {Run[]} */
  const right = [];
  let pos = 0;
  for (const run of runs) {
    const len = runLength(run);
    if (pos + len <= offset) left.push(run);
    else if (pos >= offset) right.push(run);
    else if (run.type === 'text') {
      const cut = offset - pos;
      left.push({ ...run, text: run.text.slice(0, cut) });
      right.push({ ...run, text: run.text.slice(cut) });
    }
    pos += len;
  }
  return [left, right];
}

/**
 * @param {Run[]} runs
 * @param {number} from
 * @param {number} to
 */
export function sliceRuns(runs, from, to) {
  return splitRuns(splitRuns(runs, to)[0], from)[1];
}

/**
 * Marks at a caret position: those of the character just before it, so that
 * typing after a bold word continues in bold, as in most editors. Code and
 * links do not extend past their end.
 * @param {Run[]} runs
 * @param {number} offset
 * @returns {Marks}
 */
export function marksAt(runs, offset) {
  if (offset <= 0) return {};
  const [left, right] = splitRuns(runs, offset);
  const before = left[left.length - 1];
  if (!before || before.type === 'break') return {};
  const after = right[0];
  /** @type {Marks} */
  const marks = { ...before.marks };
  if (marks.link && !(after && after.marks.link && after.marks.link.href === marks.link.href)) delete marks.link;
  if (marks.code && !(after && after.marks.code)) delete marks.code;
  return marks;
}

/**
 * @param {Run[]} runs
 * @param {number} offset
 * @param {string} str
 * @param {Marks} [marks]
 */
export function insertText(runs, offset, str, marks = marksAt(runs, offset)) {
  const [left, right] = splitRuns(runs, offset);
  return normalizeRuns([...left, text(str, marks), ...right]);
}

/**
 * @param {Run[]} runs
 * @param {number} from
 * @param {number} to
 */
export function deleteRange(runs, from, to) {
  const [left] = splitRuns(runs, from);
  const [, right] = splitRuns(runs, to);
  return normalizeRuns([...left, ...right]);
}

/**
 * @param {Run[]} runs
 * @param {number} from
 * @param {number} to
 * @param {(marks: Marks) => Marks} change
 */
function mapMarks(runs, from, to, change) {
  const [left, rest] = splitRuns(runs, from);
  const [middle, right] = splitRuns(rest, to - from);
  const changed = middle.map((r) => (r.type === 'break' ? r : { ...r, marks: cleanMarks(change({ ...r.marks })) }));
  return normalizeRuns([...left, ...changed, ...right]);
}

/**
 * @param {Run[]} runs
 * @param {number} from
 * @param {number} to
 * @param {MarkName} name
 * @param {LinkMark} [link] required when name is 'link'
 */
export function addMark(runs, from, to, name, link) {
  return mapMarks(runs, from, to, (m) => {
    if (name === 'link') m.link = link;
    else m[name] = true;
    return m;
  });
}

/**
 * @param {Run[]} runs
 * @param {number} from
 * @param {number} to
 * @param {MarkName} name
 */
export function removeMark(runs, from, to, name) {
  return mapMarks(runs, from, to, (m) => {
    delete m[name];
    return m;
  });
}

/**
 * @param {Run[]} runs
 * @param {number} from
 * @param {number} to
 * @param {MarkName} name
 */
export function hasMark(runs, from, to, name) {
  const middle = sliceRuns(runs, from, to).filter((r) => r.type !== 'break');
  return middle.length > 0 && middle.every((r) => Boolean(r.marks[name]));
}

/**
 * Adds the mark to the whole range, or removes it when the whole range
 * already has it (toolbar "B" button behaviour).
 * @param {Run[]} runs
 * @param {number} from
 * @param {number} to
 * @param {MarkName} name
 * @param {LinkMark} [link]
 */
export function toggleMark(runs, from, to, name, link) {
  return hasMark(runs, from, to, name) ? removeMark(runs, from, to, name) : addMark(runs, from, to, name, link);
}
