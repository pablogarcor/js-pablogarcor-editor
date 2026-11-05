// @ts-check
/**
 * Drafts in IndexedDB. Browser only.
 *
 * They live in this browser, for this origin: http://localhost:8000 and
 * http://localhost:9000 are different origins and do not see each other's
 * drafts. Nothing here leaves the machine.
 */

/**
 * @typedef {import('./draft.js').Draft} Draft
 */

const DB_NAME = 'js-pablogarcor-editor';
const STORE = 'drafts';

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

function db() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

/**
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest<T>} run
 * @returns {Promise<T>}
 */
async function withStore(mode, run) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transacción cancelada'));
  });
}

/** @param {Draft} draft */
export async function saveDraft(draft) {
  await withStore('readwrite', (store) => store.put(draft));
}

/**
 * Every draft, most recent first.
 * @returns {Promise<Draft[]>}
 */
export async function listDrafts() {
  const all = /** @type {Draft[]} */ (await withStore('readonly', (store) => store.getAll()));
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** @param {string} id */
export async function deleteDraft(id) {
  await withStore('readwrite', (store) => store.delete(id));
}
