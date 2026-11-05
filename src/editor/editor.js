// @ts-check
/**
 * The editing surface: one contenteditable element that holds every block.
 *
 * The model is the source of truth. The browser never edits the DOM: every
 * `beforeinput` is cancelled and turned into a command of model/editing.js
 * or model/formatting.js, then the blocks that changed are rendered again and
 * the caret is put back from the model selection. Unchanged blocks keep their
 * elements (blocks are immutable, so "changed" is "a different object").
 *
 * One editable root (rather than one per block) gives native caret movement
 * between blocks, selections across blocks and select-all for free.
 *
 * Two exceptions:
 *  - IME composition (dead keys, accents on some layouts, Asian input) cannot
 *    be cancelled. While it lasts the browser edits the DOM; when it ends its
 *    text is applied to the model and everything is rendered from the model.
 *  - Blocks that are not text (code, image, separator, raw) are edited
 *    through form controls (`data-control`). Those are ordinary inputs: their
 *    `input` event updates the model, and the block keeps its element so the
 *    control does not lose focus.
 */

import { blocks as make, createDocument, findBlock, insertBlock, updateBlock } from '../model/document.js';
import * as edit from '../model/editing.js';
import * as format from '../model/formatting.js';
import { canRedo, canUndo, createHistory, push, redo, undo } from '../model/history.js';
import { marksAt } from '../model/inline.js';
import { toDom } from './dom.js';
import { pointAt, positionOf } from './selection.js';
import { renderBlock } from './view.js';

/**
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {import('../model/document.js').Block} Block
 * @typedef {import('../model/inline.js').Marks} Marks
 * @typedef {import('../model/editing.js').Selection} Selection
 * @typedef {import('../model/editing.js').Pos} Pos
 * @typedef {import('../model/formatting.js').BlockKind} BlockKind
 * @typedef {import('../model/formatting.js').SimpleMark} SimpleMark
 * @typedef {{ doc: Doc, selection: Selection | null }} Result
 * @typedef {{ doc: Doc, selection: Selection | null, before: Selection | null }} State
 *   selection: after the change; before: where the caret was before it (undo puts it back there)
 * @typedef {{
 *   marks: { strong: boolean, em: boolean, code: boolean, link: string | null },
 *   block: BlockKind | null,
 *   collapsed: boolean,
 *   canUndo: boolean,
 *   canRedo: boolean,
 * }} ToolbarState
 * @typedef {{
 *   imageUrl?: (src: string) => string | undefined,
 *   onChange?: (doc: Doc) => void,
 *   onSelectionChange?: (state: ToolbarState) => void,
 *   onLinkRequest?: () => void,
 * }} EditorOptions
 */

/**
 * A document the caret can go into: one without any text block gets an
 * empty paragraph at the end.
 * @param {Doc} doc
 */
function editable(doc) {
  return doc.blocks.some(edit.isTextBlock) ? doc : insertBlock(doc, doc.blocks.length, make.paragraph());
}

/** @param {Pos} a @param {Pos} b */
const samePos = (a, b) => a.block === b.block && a.item === b.item && a.offset === b.offset;

/** @param {EventTarget | null} target */
const isControl = (target) => target instanceof Element && target.closest('input, textarea, button') !== null;

/**
 * @param {HTMLElement} root
 * @param {EditorOptions} [options]
 */
export function createEditor(root, { imageUrl, onChange = () => {}, onSelectionChange = () => {}, onLinkRequest = () => {} } = {}) {
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.spellcheck = true;

  /** @type {WeakMap<Block, Element>} */
  let rendered = new WeakMap();
  let history = createHistory(/** @type {State} */ ({ doc: editable(createDocument()), selection: null, before: null }));
  /** Set between compositionstart and compositionend. */
  let composition = /** @type {{ selection: Selection | null } | null} */ (null);
  /** The last caret position in the text, kept while a toolbar control has the focus. */
  let lastSelection = /** @type {Selection | null} */ (null);
  /** Marks for the next characters typed at `at` (Ctrl+B with nothing selected). */
  let stored = /** @type {{ marks: Marks, at: Pos } | null} */ (null);

  const hasFocus = () => root.ownerDocument.activeElement === root;

  /** @param {boolean} [force] render every block again, even unchanged ones */
  function render(force = false) {
    if (force) rendered = new WeakMap();
    const els = history.present.doc.blocks.map((block) => {
      let el = rendered.get(block);
      if (!el) {
        el = /** @type {Element} */ (toDom(renderBlock(block, { imageUrl, editable: true }), root.ownerDocument));
        rendered.set(block, el);
      }
      return el;
    });
    els.forEach((el, i) => {
      if (root.childNodes[i] !== el) root.insertBefore(el, root.childNodes[i] ?? null);
    });
    while (root.childNodes.length > els.length) /** @type {ChildNode} */ (root.lastChild).remove();
  }

  /** @returns {Selection | null} */
  function readSelection() {
    const sel = root.ownerDocument.getSelection();
    if (!sel || !sel.rangeCount || !sel.anchorNode || !sel.focusNode) return null;
    const anchor = positionOf(root, sel.anchorNode, sel.anchorOffset);
    const focus = positionOf(root, sel.focusNode, sel.focusOffset);
    return anchor && focus ? { anchor, focus } : null;
  }

  /** @param {Selection | null} sel a selection that still points into the document */
  function valid(sel) {
    const { doc } = history.present;
    return sel && findBlock(doc, sel.anchor.block) && findBlock(doc, sel.focus.block) ? sel : null;
  }

  /** The selection a toolbar command acts on. */
  function currentSelection() {
    return (hasFocus() && readSelection()) || valid(lastSelection);
  }

  /** @param {InputEvent} event @returns {Selection | null} */
  function targetOf(event) {
    const range = event.getTargetRanges?.()[0];
    if (!range) return null;
    const anchor = positionOf(root, range.startContainer, range.startOffset);
    const focus = positionOf(root, range.endContainer, range.endOffset);
    return anchor && focus ? { anchor, focus } : null;
  }

  /** @param {string} id */
  const blockElement = (id) => [...root.children].find((el) => el.getAttribute('data-block-id') === id) ?? null;

  /** @param {Pos} pos */
  function pointFor(pos) {
    const block = blockElement(pos.block);
    if (!block) return null;
    const field = block.hasAttribute('data-field') ? block : block.querySelector(`[data-field="${pos.item}"]`);
    return field ? pointAt(field, pos.offset) : null;
  }

  /** @param {Selection | null} selection null: start of the first text block */
  function writeSelection(selection) {
    if (!selection) {
      const first = history.present.doc.blocks.find(edit.isTextBlock);
      if (!first) return;
      selection = edit.caret({ block: first.id, item: 0, offset: 0 });
    }
    lastSelection = selection;
    const anchor = pointFor(selection.anchor);
    const focus = pointFor(selection.focus);
    const sel = root.ownerDocument.getSelection();
    if (!anchor || !focus || !sel) return;
    sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    const node = focus.node.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (focus.node) : focus.node.parentElement;
    node?.scrollIntoView({ block: 'nearest' });
  }

  /** @returns {ToolbarState} */
  function toolbarState() {
    const { doc } = history.present;
    const sel = valid(lastSelection);
    const base = { canUndo: canUndo(history), canRedo: canRedo(history) };
    if (!sel) return { ...base, marks: { strong: false, em: false, code: false, link: null }, block: null, collapsed: true };
    const marks = format.activeMarks(doc, sel);
    if (stored && edit.isCollapsed(sel) && samePos(stored.at, sel.focus)) {
      Object.assign(marks, { strong: Boolean(stored.marks.strong), em: Boolean(stored.marks.em), code: Boolean(stored.marks.code) });
    }
    return { ...base, marks, block: format.blockKindAt(doc, sel), collapsed: edit.isCollapsed(sel) };
  }

  /**
   * @param {Result} result
   * @param {Selection | null} before
   * @param {{ group?: string | null, force?: boolean, select?: boolean }} [opts]
   *   group: consecutive changes with the same group are one undo step;
   *   select: put the caret back in the text (false while a control is being edited)
   */
  function apply(result, before, { group = null, force = false, select = true } = {}) {
    if (result.doc !== history.present.doc) {
      const doc = editable(result.doc);
      const sameStep = group !== null && group === history.group;
      history = push(history, { doc, selection: result.selection, before: sameStep ? history.present.before : before }, { group });
      render(force);
      onChange(doc);
    } else if (force) {
      render(true);
    }
    if (select) writeSelection(result.selection);
    onSelectionChange(toolbarState());
  }

  /**
   * Runs a toolbar command on the current selection and gives the focus back
   * to the text.
   * @param {(doc: Doc, sel: Selection) => Result} command
   */
  function exec(command) {
    const sel = currentSelection();
    if (!sel) return null;
    const result = command(history.present.doc, sel);
    root.focus();
    apply(result, sel);
    return result;
  }

  function undoStep() {
    if (!canUndo(history)) return;
    const undone = history.present;
    history = undo(history);
    render();
    writeSelection(valid(undone.before));
    onChange(history.present.doc);
    onSelectionChange(toolbarState());
  }

  function redoStep() {
    if (!canRedo(history)) return;
    history = redo(history);
    render();
    writeSelection(valid(history.present.selection));
    onChange(history.present.doc);
    onSelectionChange(toolbarState());
  }

  /** @param {SimpleMark} name */
  function toggleMark(name) {
    const sel = currentSelection();
    if (!sel) return;
    if (!edit.isCollapsed(sel)) {
      exec((doc, s) => format.toggleMark(doc, s, name));
      return;
    }
    // Nothing selected: the mark applies to what is typed next, here.
    const { doc } = history.present;
    const base = stored && samePos(stored.at, sel.focus) ? stored.marks : marksAt(edit.fieldRuns(doc, sel.focus.block, sel.focus.item), sel.focus.offset);
    const marks = { ...base };
    if (marks[name]) delete marks[name];
    else marks[name] = true;
    stored = { marks, at: sel.focus };
    root.focus();
    writeSelection(sel);
    onSelectionChange(toolbarState());
  }

  /**
   * Marks for text typed at `sel`, if Ctrl+B and friends were pressed there.
   * @param {Selection} sel
   */
  function marksFor(sel) {
    return stored && edit.isCollapsed(sel) && samePos(stored.at, sel.focus) ? stored.marks : undefined;
  }

  root.addEventListener('beforeinput', (event) => {
    if (isControl(event.target)) return;
    if (composition || event.isComposing) return;
    const type = event.inputType;
    event.preventDefault();
    if (type === 'historyUndo') return undoStep();
    if (type === 'historyRedo') return redoStep();
    if (type === 'formatBold') return toggleMark('strong');
    if (type === 'formatItalic') return toggleMark('em');
    const selection = readSelection();
    if (!selection) return;
    const { doc } = history.present;
    const key = `${selection.focus.block}:${selection.focus.item}`;
    switch (type) {
      case 'insertText': {
        const result = edit.insertText(doc, selection, event.data ?? '', marksFor(selection));
        stored = null;
        return apply(result, selection, { group: `text:${key}` });
      }
      case 'insertReplacementText': {
        const text = event.dataTransfer?.getData('text/plain') ?? event.data ?? '';
        return apply(edit.insertText(doc, targetOf(event) ?? selection, text), selection);
      }
      case 'insertParagraph':
        return apply(edit.insertParagraph(doc, selection), selection);
      case 'insertLineBreak':
        return apply(edit.insertLineBreak(doc, selection), selection);
      case 'deleteContentBackward':
        return apply(edit.deleteBackward(doc, selection), selection, { group: `delete:${key}` });
      case 'deleteWordBackward':
        return apply(edit.deleteBackward(doc, selection, 'word'), selection);
      case 'deleteContentForward':
        return apply(edit.deleteForward(doc, selection), selection, { group: `delete:${key}` });
      case 'deleteWordForward':
        return apply(edit.deleteForward(doc, selection, 'word'), selection);
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
      case 'deleteByCut':
      case 'deleteContent': {
        const target = targetOf(event);
        const range = target && !edit.isCollapsed(target) ? target : selection;
        if (edit.isCollapsed(range)) return;
        return apply(edit.deleteSelection(doc, range), selection);
      }
      default:
        // Drops and anything else are ignored so the DOM never drifts from
        // the model.
        return;
    }
  });

  root.addEventListener('keydown', (event) => {
    if (isControl(event.target)) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    /** @type {(() => void) | null} */
    let action = null;
    if (key === 'z' && !event.shiftKey) action = undoStep;
    else if ((key === 'z' && event.shiftKey) || key === 'y') action = redoStep;
    else if (key === 'b' && !event.shiftKey) action = () => toggleMark('strong');
    else if (key === 'i' && !event.shiftKey) action = () => toggleMark('em');
    else if (key === 'e' && !event.shiftKey) action = () => toggleMark('code');
    else if (key === 'k' && !event.shiftKey) action = onLinkRequest;
    if (!action) return;
    event.preventDefault();
    action();
  });

  root.addEventListener('paste', (event) => {
    if (isControl(event.target)) return;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const selection = readSelection();
    if (text && selection) apply(edit.insertPlainText(history.present.doc, selection, text), selection);
  });

  root.addEventListener('drop', (event) => {
    if (!isControl(event.target)) event.preventDefault();
  });

  root.addEventListener('compositionstart', (event) => {
    if (isControl(event.target)) return;
    composition = { selection: readSelection() };
  });

  root.addEventListener('compositionend', (event) => {
    if (isControl(event.target)) return;
    const start = composition?.selection ?? null;
    composition = null;
    if (!start) return render(true);
    const key = `${start.focus.block}:${start.focus.item}`;
    const result = edit.insertText(history.present.doc, start, event.data ?? '', marksFor(start));
    stored = null;
    apply(result, start, { group: `text:${key}`, force: true });
  });

  root.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      controlInput(target);
      return;
    }
    // An input that was not cancelled (should not happen outside
    // composition): throw the browser's change away and show the model.
    if (composition || /** @type {InputEvent} */ (event).isComposing) return;
    const selection = readSelection();
    render(true);
    if (selection) writeSelection(selection);
  });

  /** @param {HTMLInputElement | HTMLTextAreaElement} control */
  function controlInput(control) {
    const name = control.getAttribute('data-control');
    const el = control.closest('[data-block-id]');
    const id = el?.getAttribute('data-block-id');
    const { doc } = history.present;
    const block = id ? findBlock(doc, id) : undefined;
    if (!name || !el || !block) return;
    /** @type {Partial<Block> | null} */
    let patch = null;
    if (block.type === 'code' && name === 'info') patch = { info: control.value.trim() };
    else if (block.type === 'code' && name === 'text') patch = { text: control.value };
    else if (block.type === 'image' && name === 'alt') patch = { alt: control.value };
    else if (block.type === 'raw' && name === 'source') patch = { source: control.value };
    if (!patch) return;
    const next = updateBlock(doc, block.id, patch);
    // The control already shows the new value: keep its element, and forget
    // the old block's element so that undo renders the old value again.
    const updated = /** @type {Block} */ (findBlock(next, block.id));
    rendered.delete(block);
    rendered.set(updated, el);
    if (control instanceof HTMLTextAreaElement) control.rows = Math.max(2, control.value.split('\n').length);
    apply({ doc: next, selection: valid(lastSelection) }, valid(lastSelection), { group: `control:${block.id}:${name}`, select: false });
  }

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-action="remove"]') : null;
    const id = button?.closest('[data-block-id]')?.getAttribute('data-block-id');
    if (!id) return;
    event.preventDefault();
    const result = format.removeFixedBlock(history.present.doc, id);
    root.focus();
    apply(result, valid(lastSelection));
  });

  root.ownerDocument.addEventListener('selectionchange', () => {
    if (composition || !hasFocus()) return;
    const sel = readSelection();
    if (!sel) return;
    lastSelection = sel;
    if (stored && !(edit.isCollapsed(sel) && samePos(stored.at, sel.focus))) stored = null;
    onSelectionChange(toolbarState());
  });

  return {
    /** @param {Doc} doc */
    setDocument(doc) {
      history = createHistory(/** @type {State} */ ({ doc: editable(doc), selection: null, before: null }));
      lastSelection = null;
      stored = null;
      render(true);
      onSelectionChange(toolbarState());
    },
    getDocument() {
      return history.present.doc;
    },
    focus() {
      root.focus();
      writeSelection(valid(history.present.selection));
    },
    undo: undoStep,
    redo: redoStep,
    toggleMark,
    /** @param {BlockKind} kind */
    setBlockType(kind) {
      exec((doc, sel) => format.setBlockType(doc, sel, kind));
    },
    /**
     * What the link panel needs: the link at the selection, and whether
     * there is anything to link.
     */
    linkInfo() {
      const sel = currentSelection();
      if (!sel) return { href: null, canLink: false };
      const { doc } = history.present;
      const href = format.activeMarks(doc, sel).link;
      return { href, canLink: !edit.isCollapsed(sel) || href !== null };
    },
    /** @param {string} href */
    setLink(href) {
      exec((doc, sel) => format.setLink(doc, sel, href));
    },
    removeLink() {
      exec((doc, sel) => format.removeLink(doc, sel));
    },
    /** @param {'hr' | 'code'} kind */
    insertBlock(kind) {
      const block = kind === 'hr' ? make.hr() : make.code('', '');
      const result = exec((doc, sel) => format.insertBlockAfter(doc, sel, block));
      if (result && kind === 'code') blockElement(block.id)?.querySelector('textarea')?.focus();
    },
    /** Gives the focus back to the text, where it was. */
    restoreFocus() {
      root.focus();
      writeSelection(valid(lastSelection));
    },
    toolbarState,
  };
}
