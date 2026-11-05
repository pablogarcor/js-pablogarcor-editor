// @ts-check
/**
 * The formatting toolbar and the link panel. Buttons never take the focus
 * from the text (mousedown is cancelled), so the selection they act on is
 * still there. The block type <select> and the link field do take it; the
 * editor keeps the last selection for them.
 */

import { normalizeHref } from '../model/formatting.js';

/**
 * @typedef {import('../model/formatting.js').BlockKind} BlockKind
 * @typedef {import('./editor.js').ToolbarState} ToolbarState
 * @typedef {ReturnType<typeof import('./editor.js').createEditor>} Editor
 */

/**
 * The <select> value for a block kind ('' when it is none of the options).
 * @param {BlockKind | null} kind
 */
export function kindValue(kind) {
  if (!kind) return '';
  if (kind.type === 'heading') return `h${kind.level}`;
  if (kind.type === 'list') return kind.ordered ? 'ol' : 'ul';
  return kind.type;
}

/**
 * @param {string} value
 * @returns {BlockKind | null}
 */
export function valueKind(value) {
  if (value === 'paragraph' || value === 'quote') return { type: value };
  if (value === 'ul' || value === 'ol') return { type: 'list', ordered: value === 'ol' };
  const m = /^h([2-4])$/.exec(value);
  return m ? { type: 'heading', level: Number(m[1]) } : null;
}

/**
 * @param {ParentNode} scope the element that holds the toolbar and the link panel
 * @param {() => Editor} getEditor
 * @param {(message: string, kind?: 'info' | 'error') => void} setStatus
 */
export function createToolbar(scope, getEditor, setStatus) {
  /** @param {string} selector */
  const q = (selector) => /** @type {HTMLElement} */ (scope.querySelector(selector));
  const select = /** @type {HTMLSelectElement} */ (q('#block-type'));
  const linkButton = q('#link-button');
  const panel = q('#link-panel');
  const input = /** @type {HTMLInputElement} */ (q('#link-url'));
  const linkError = q('#link-error');
  const linkRemove = q('#link-remove');
  const undoButton = /** @type {HTMLButtonElement} */ (q('#undo'));
  const redoButton = /** @type {HTMLButtonElement} */ (q('#redo'));
  const toolbar = q('#toolbar');

  toolbar.addEventListener('mousedown', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
  });

  toolbar.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;
    const editor = getEditor();
    const mark = button.getAttribute('data-mark');
    const insert = button.getAttribute('data-insert');
    if (mark === 'strong' || mark === 'em' || mark === 'code') editor.toggleMark(mark);
    else if (insert === 'hr' || insert === 'code') editor.insertBlock(insert);
    else if (button === linkButton) openLink();
    else if (button === undoButton) editor.undo();
    else if (button === redoButton) editor.redo();
  });

  select.addEventListener('change', () => {
    const kind = valueKind(select.value);
    if (kind) getEditor().setBlockType(kind);
  });

  function closeLink() {
    panel.hidden = true;
    linkError.textContent = '';
  }

  function openLink() {
    const info = getEditor().linkInfo();
    if (!info.canLink) {
      setStatus('Selecciona el texto que quieres enlazar.', 'error');
      return;
    }
    panel.hidden = false;
    linkError.textContent = '';
    input.value = info.href ?? '';
    linkRemove.hidden = info.href === null;
    input.focus();
    input.select();
  }

  function applyLink() {
    const href = normalizeHref(input.value);
    if (!href) {
      linkError.textContent = 'Dirección no válida: usa https://…, mailto: o una ruta del blog (/…).';
      input.focus();
      return;
    }
    closeLink();
    getEditor().setLink(href);
  }

  q('#link-apply').addEventListener('click', applyLink);
  linkRemove.addEventListener('click', () => {
    closeLink();
    getEditor().removeLink();
  });
  q('#link-cancel').addEventListener('click', () => {
    closeLink();
    getEditor().restoreFocus();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyLink();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeLink();
      getEditor().restoreFocus();
    }
  });

  return {
    /** @param {boolean} visible */
    show(visible) {
      toolbar.hidden = !visible;
      if (!visible) closeLink();
    },
    openLink,
    /** @param {ToolbarState} state */
    update(state) {
      for (const button of toolbar.querySelectorAll('[data-mark]')) {
        const name = /** @type {'strong' | 'em' | 'code'} */ (button.getAttribute('data-mark'));
        button.setAttribute('aria-pressed', String(state.marks[name]));
      }
      linkButton.setAttribute('aria-pressed', String(state.marks.link !== null));
      if (document.activeElement !== select) select.value = kindValue(state.block);
      undoButton.disabled = !state.canUndo;
      redoButton.disabled = !state.canRedo;
    },
  };
}
