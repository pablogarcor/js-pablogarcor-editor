// @ts-check
/**
 * The editing surface: one contenteditable element that holds every block.
 *
 * The model is the source of truth. The browser never edits the DOM: every
 * `beforeinput` is cancelled and turned into a command of model/editing.js,
 * then the blocks that changed are rendered again and the caret is put back
 * from the model selection. Unchanged blocks keep their elements (blocks are
 * immutable, so "changed" is "a different object").
 *
 * One editable root (rather than one per block) gives native caret movement
 * between blocks, selections across blocks and select-all for free.
 *
 * The one exception is IME composition (dead keys, accents on some layouts,
 * Asian input): it cannot be cancelled. While it lasts the browser edits the
 * DOM; when it ends its text is applied to the model and everything is
 * rendered again from the model.
 */

import { blocks as make, createDocument, insertBlock } from '../model/document.js';
import * as edit from '../model/editing.js';
import { canRedo, canUndo, createHistory, push, redo, undo } from '../model/history.js';
import { toDom } from './dom.js';
import { pointAt, positionOf } from './selection.js';
import { renderBlock } from './view.js';

/**
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {import('../model/document.js').Block} Block
 * @typedef {import('../model/editing.js').Selection} Selection
 * @typedef {import('../model/editing.js').Pos} Pos
 * @typedef {import('../model/editing.js').EditResult} EditResult
 * @typedef {{ doc: Doc, selection: Selection | null, before: Selection | null }} State
 *   selection: after the change; before: where the caret was before it (undo puts it back there)
 * @typedef {{ imageUrl?: (src: string) => string | undefined, onChange?: (doc: Doc) => void }} EditorOptions
 */

/**
 * A document the caret can go into: one without any text block gets an
 * empty paragraph at the end.
 * @param {Doc} doc
 */
function editable(doc) {
  return doc.blocks.some(edit.isTextBlock) ? doc : insertBlock(doc, doc.blocks.length, make.paragraph());
}

/**
 * @param {HTMLElement} root
 * @param {EditorOptions} [options]
 */
export function createEditor(root, { imageUrl, onChange = () => {} } = {}) {
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  root.spellcheck = true;

  /** @type {WeakMap<Block, Element>} */
  let rendered = new WeakMap();
  let history = createHistory(/** @type {State} */ ({ doc: editable(createDocument()), selection: null, before: null }));
  /** Set between compositionstart and compositionend. */
  let composition = /** @type {{ selection: Selection | null } | null} */ (null);

  /** @param {boolean} [force] render every block again, even unchanged ones */
  function render(force = false) {
    if (force) rendered = new WeakMap();
    const els = history.present.doc.blocks.map((block) => {
      let el = rendered.get(block);
      if (!el) {
        el = /** @type {Element} */ (toDom(renderBlock(block, { imageUrl }), root.ownerDocument));
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

  /** @param {InputEvent} event @returns {Selection | null} */
  function targetOf(event) {
    const range = event.getTargetRanges?.()[0];
    if (!range) return null;
    const anchor = positionOf(root, range.startContainer, range.startOffset);
    const focus = positionOf(root, range.endContainer, range.endOffset);
    return anchor && focus ? { anchor, focus } : null;
  }

  /** @param {Pos} pos */
  function pointFor(pos) {
    const block = [...root.children].find((el) => el.getAttribute('data-block-id') === pos.block);
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
    const anchor = pointFor(selection.anchor);
    const focus = pointFor(selection.focus);
    const sel = root.ownerDocument.getSelection();
    if (!anchor || !focus || !sel) return;
    sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    const node = focus.node.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (focus.node) : focus.node.parentElement;
    node?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * @param {EditResult} result
   * @param {Selection} before
   * @param {string | null} [group] consecutive changes with the same group are one undo step
   * @param {boolean} [force]
   */
  function apply(result, before, group = null, force = false) {
    if (result.doc === history.present.doc) {
      if (force) render(true);
      writeSelection(result.selection);
      return;
    }
    const sameStep = group !== null && group === history.group;
    history = push(history, { doc: result.doc, selection: result.selection, before: sameStep ? history.present.before : before }, { group });
    render(force);
    writeSelection(result.selection);
    onChange(result.doc);
  }

  function undoStep() {
    if (!canUndo(history)) return;
    const undone = history.present;
    history = undo(history);
    render();
    writeSelection(undone.before);
    onChange(history.present.doc);
  }

  function redoStep() {
    if (!canRedo(history)) return;
    history = redo(history);
    render();
    writeSelection(history.present.selection);
    onChange(history.present.doc);
  }

  root.addEventListener('beforeinput', (event) => {
    if (composition || event.isComposing) return;
    const type = event.inputType;
    event.preventDefault();
    if (type === 'historyUndo') return undoStep();
    if (type === 'historyRedo') return redoStep();
    const selection = readSelection();
    if (!selection) return;
    const { doc } = history.present;
    const key = `${selection.focus.block}:${selection.focus.item}`;
    switch (type) {
      case 'insertText':
        return apply(edit.insertText(doc, selection, event.data ?? ''), selection, `text:${key}`);
      case 'insertReplacementText': {
        const text = event.dataTransfer?.getData('text/plain') ?? event.data ?? '';
        return apply(edit.insertText(doc, targetOf(event) ?? selection, text), selection);
      }
      case 'insertParagraph':
        return apply(edit.insertParagraph(doc, selection), selection);
      case 'insertLineBreak':
        return apply(edit.insertLineBreak(doc, selection), selection);
      case 'deleteContentBackward':
        return apply(edit.deleteBackward(doc, selection), selection, `delete:${key}`);
      case 'deleteWordBackward':
        return apply(edit.deleteBackward(doc, selection, 'word'), selection);
      case 'deleteContentForward':
        return apply(edit.deleteForward(doc, selection), selection, `delete:${key}`);
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
        // Formatting (Ctrl+B...) comes with the toolbar; drops and anything
        // else are ignored so the DOM never drifts from the model.
        return;
    }
  });

  root.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoStep();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      redoStep();
    }
  });

  root.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const selection = readSelection();
    if (text && selection) apply(edit.insertPlainText(history.present.doc, selection, text), selection);
  });

  root.addEventListener('drop', (event) => event.preventDefault());

  root.addEventListener('compositionstart', () => {
    composition = { selection: readSelection() };
  });

  root.addEventListener('compositionend', (event) => {
    const start = composition?.selection ?? null;
    composition = null;
    if (!start) return render(true);
    const key = `${start.focus.block}:${start.focus.item}`;
    apply(edit.insertText(history.present.doc, start, event.data ?? ''), start, `text:${key}`, true);
  });

  // An input that was not cancelled (should not happen outside composition):
  // throw the browser's change away and show the model again.
  root.addEventListener('input', (event) => {
    if (composition || /** @type {InputEvent} */ (event).isComposing) return;
    const selection = readSelection();
    render(true);
    if (selection) writeSelection(selection);
  });

  return {
    /** @param {Doc} doc */
    setDocument(doc) {
      history = createHistory(/** @type {State} */ ({ doc: editable(doc), selection: null, before: null }));
      render(true);
    },
    getDocument() {
      return history.present.doc;
    },
    focus() {
      root.focus();
      writeSelection(history.present.selection);
    },
    undo: undoStep,
    redo: redoStep,
  };
}
