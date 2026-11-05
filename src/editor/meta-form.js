// @ts-check
/**
 * The form for the post's front matter: title, language, date, slug,
 * translationKey, tags and description, plus the checks validatePost
 * reports. It only shows values and reports edits: the rules (the slug
 * following the title, tags as a list...) live in hugo/post.js.
 */

/**
 * @typedef {import('../hugo/post.js').Report} Report
 * @typedef {'new' | 'published'} Mode
 *   new: everything editable, plus the language;
 *   published: slug and translationKey are fixed (the slug is the post's URL)
 */

const DESCRIPTION_LIMIT = 160;

/**
 * @param {ParentNode} scope
 * @param {{ onEdit: (field: string, value: string) => void, onLang: (lang: string) => void }} handlers
 */
export function createMetaForm(scope, { onEdit, onLang }) {
  /** @param {string} selector */
  const q = (selector) => /** @type {HTMLElement} */ (scope.querySelector(selector));
  const form = q('#meta-form');
  const lang = /** @type {HTMLSelectElement} */ (q('#meta-lang'));
  const langLabel = q('#meta-lang-label');
  const slug = /** @type {HTMLInputElement} */ (q('#meta-slug'));
  const key = /** @type {HTMLInputElement} */ (q('#meta-key'));
  const count = q('#meta-count');
  const note = q('#meta-note');
  const report = q('#meta-report');
  const fields = /** @type {(HTMLInputElement | HTMLTextAreaElement)[]} */ ([...form.querySelectorAll('[data-field]')]);

  form.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    const field = target.getAttribute('data-field');
    if (field) onEdit(field, target.value);
  });
  lang.addEventListener('change', () => onLang(lang.value));

  /** @param {number} length */
  function showCount(length) {
    count.textContent = `${length}/${DESCRIPTION_LIMIT}`;
    count.dataset.kind = length > DESCRIPTION_LIMIT ? 'error' : 'info';
  }

  return {
    /** @param {Mode | null} mode null hides the form */
    show(mode) {
      form.hidden = mode === null;
      if (!mode) return;
      const published = mode === 'published';
      slug.readOnly = published;
      key.readOnly = published;
      langLabel.hidden = published;
      note.textContent = published
        ? 'Post publicado: el slug es su URL y no se puede cambiar.'
        : 'El slug sigue al título hasta que lo escribas a mano; el translationKey sigue al slug.';
    },
    /**
     * Shows the document's values. The field being typed in is left alone,
     * so its text (a trailing comma in the tags, say) is not rewritten.
     * @param {Record<string, any>} meta
     * @param {Report} checks
     * @param {string} currentLang
     */
    sync(meta, checks, currentLang) {
      for (const input of fields) {
        if (input === document.activeElement) continue;
        const field = /** @type {string} */ (input.getAttribute('data-field'));
        const value = meta[field];
        const text = Array.isArray(value) ? value.join(', ') : value === undefined || value === null ? '' : String(value);
        if (input.value !== text) input.value = text;
      }
      lang.value = currentLang;
      showCount(String(meta.description ?? '').length);
      report.replaceChildren(
        ...checks.errors.map((m) => item(m, 'error')),
        ...checks.warnings.map((m) => item(m, 'warning')),
      );
    },
  };
}

/**
 * @param {string} message
 * @param {'error' | 'warning'} kind
 */
function item(message, kind) {
  const li = document.createElement('li');
  li.dataset.kind = kind;
  li.textContent = message;
  return li;
}
