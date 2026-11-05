// @ts-check
/**
 * The publish panel: connect with a token, check the post against what is in
 * main, show what would be sent, and send it (a branch with one commit and a
 * pull request; never main).
 *
 * Publishing always goes through "Comprobar" first, and the plan it shows is
 * exactly what is sent. If the post changes after the check, it has to be
 * checked again.
 */

import { preparePublish } from '../hugo/post.js';
import { connect, client, disconnect, explain, isConnected, OWNER, REPO } from '../github/connection.js';
import { loadPosts, publishFiles } from '../github/publish.js';

/**
 * @typedef {import('../model/document.js').Doc} Doc
 * @typedef {{ doc: Doc, lang: string, original: string | null, images: { name: string, blob: Blob }[] }} PublishInput
 *   images: the images added in the editor (the ones to upload)
 */

/**
 * @param {ParentNode} scope
 * @param {{
 *   current: () => PublishInput,
 *   beforeCheck: () => Promise<void>,
 *   setStatus: (text: string, kind?: 'info' | 'error') => void,
 * }} hooks
 */
export function createPublishPanel(scope, { current, beforeCheck, setStatus }) {
  /** @param {string} selector */
  const q = (selector) => /** @type {HTMLElement} */ (scope.querySelector(selector));
  const panel = q('#publish-panel');
  const connectForm = q('#connect-form');
  const connected = q('#publish-connected');
  const tokenInput = /** @type {HTMLInputElement} */ (q('#token'));
  const remember = /** @type {HTMLInputElement} */ (q('#token-remember'));
  const connectButton = /** @type {HTMLButtonElement} */ (q('#connect'));
  const connectError = q('#connect-error');
  const checkButton = /** @type {HTMLButtonElement} */ (q('#check'));
  const report = q('#publish-report');
  const planBox = q('#publish-plan');
  const summary = q('#plan-summary');
  const fileList = q('#plan-files');
  const goButton = /** @type {HTMLButtonElement} */ (q('#publish-go'));
  const result = q('#publish-result');

  /** The document and plan of the last check. */
  let checked = /** @type {{ doc: Doc, plan: NonNullable<ReturnType<typeof preparePublish>['plan']> } | null} */ (null);

  function render() {
    connectForm.hidden = isConnected();
    connected.hidden = !isConnected();
  }

  function reset() {
    checked = null;
    report.replaceChildren();
    planBox.hidden = true;
    result.replaceChildren();
  }

  /** @param {string} text @param {'error' | 'warning' | 'info'} kind */
  function item(text, kind) {
    const li = document.createElement('li');
    li.dataset.kind = kind;
    li.textContent = text;
    return li;
  }

  async function doConnect() {
    connectButton.disabled = true;
    connectError.textContent = 'Comprobando el token…';
    try {
      await connect(tokenInput.value, { remember: remember.checked });
      connectError.textContent = '';
      render();
      void check();
    } catch (err) {
      connectError.textContent = explain(err);
    } finally {
      // The token is not left in the page, connected or not.
      tokenInput.value = '';
      connectButton.disabled = false;
    }
  }

  async function check() {
    reset();
    checkButton.disabled = true;
    try {
      await beforeCheck();
      report.append(item('Leyendo los posts de main…', 'info'));
      const input = current();
      const repo = await loadPosts(client());
      const images = await Promise.all(input.images.map(async (i) => ({ name: i.name, bytes: new Uint8Array(await i.blob.arrayBuffer()) })));
      const r = preparePublish({ doc: input.doc, lang: input.lang, original: input.original, images, repo });
      report.replaceChildren(...r.errors.map((e) => item(e, 'error')), ...r.warnings.map((w) => item(w, 'warning')));
      if (!r.plan) return;
      if (!r.errors.length && !r.warnings.length) report.append(item('Todo en orden.', 'info'));
      checked = { doc: input.doc, plan: r.plan };
      summary.textContent = `Se creará o actualizará la rama ${r.plan.branch} con un commit («${r.plan.message}») y se abrirá un PR contra main: «${r.plan.pullRequest.title}».`;
      fileList.replaceChildren(
        ...r.plan.files.map((f) => {
          const size = typeof f.content === 'string' ? new TextEncoder().encode(f.content).length : f.content.length;
          return item(`${f.path} (${size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`})`, 'info');
        }),
      );
      planBox.hidden = false;
    } catch (err) {
      report.replaceChildren(item(explain(err), 'error'));
    } finally {
      checkButton.disabled = false;
    }
  }

  async function publish() {
    if (!checked) return;
    if (current().doc !== checked.doc) {
      reset();
      report.append(item('El post ha cambiado desde la comprobación: vuelve a comprobarlo.', 'error'));
      return;
    }
    const { plan } = checked;
    goButton.disabled = true;
    checkButton.disabled = true;
    result.textContent = 'Publicando…';
    try {
      const sent = await publishFiles(client(), {
        branch: plan.branch,
        files: plan.files,
        message: plan.message,
        pullRequest: plan.pullRequest,
      });
      result.replaceChildren();
      const text = sent.changed ? `Subido a la rama ${sent.branch}. ` : `La rama ${sent.branch} ya tenía este contenido. `;
      result.append(text);
      if (sent.pullRequest) {
        const link = document.createElement('a');
        link.href = sent.pullRequest.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `PR #${sent.pullRequest.number}`;
        result.append(link, ': revisa la vista previa de Azure y haz merge para publicarlo. Si sigues editando, vuelve a publicar y se actualizará el mismo PR.');
      }
      setStatus(sent.pullRequest ? `Publicado en el PR #${sent.pullRequest.number}.` : 'Publicado.');
      planBox.hidden = true;
      checked = null;
    } catch (err) {
      result.textContent = `No se ha podido publicar: ${explain(err)}`;
    } finally {
      goButton.disabled = false;
      checkButton.disabled = false;
    }
  }

  connectButton.addEventListener('click', () => void doConnect());
  tokenInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void doConnect();
    }
  });
  q('#disconnect').addEventListener('click', () => {
    disconnect();
    reset();
    render();
  });
  checkButton.addEventListener('click', () => void check());
  goButton.addEventListener('click', () => void publish());
  q('#repo-name').textContent = `${OWNER}/${REPO}`;

  return {
    toggle() {
      panel.hidden = !panel.hidden;
      if (panel.hidden) return;
      render();
      reset();
      if (isConnected()) void check();
      else tokenInput.focus();
    },
    hide() {
      panel.hidden = true;
      reset();
    },
  };
}
