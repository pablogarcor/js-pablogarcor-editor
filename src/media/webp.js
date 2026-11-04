// @ts-check
/**
 * Converts an image the user drops into the editor to WebP, in the browser,
 * with no library: decode with createImageBitmap, draw on an OffscreenCanvas,
 * encode with convertToBlob. The blog stores every post image as WebP.
 *
 * Browser only (Node has no canvas). Not covered by the Node tests.
 */

import { slugify } from '../hugo/post.js';

/**
 * @param {Blob} file
 * @param {{ maxWidth?: number, quality?: number }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, width: number, height: number }>}
 */
export async function toWebp(file, { maxWidth = 1600, quality = 0.82 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el lienzo para convertir la imagen.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
  // Browsers that cannot encode WebP silently fall back to PNG.
  if (blob.type !== 'image/webp') throw new Error('Este navegador no sabe codificar WebP.');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/**
 * File name for a post image, in the blog's style: descriptive, kebab-case,
 * .webp ("lg-oled65cx5lb-model-label.webp").
 * @param {string} description alt text or original file name
 * @param {string[]} [taken] names already used in the bundle
 */
export function imageName(description, taken = []) {
  const base = slugify(description.replace(/\.[a-z0-9]+$/i, '')).split('-').slice(0, 8).join('-') || 'image';
  let name = `${base}.webp`;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}.webp`;
  return name;
}
