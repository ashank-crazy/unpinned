// Browser-only picture helpers: decoding, comparing the hidden preview with
// the real picture, and drawing solid covers into a new copy.

import type { ThumbnailCheck } from './hidden';
import type { Box } from './types';

/** Big enough for phone cameras; past this, some phones can't allocate the canvas. */
const MAX_PIXELS = 40_000_000;
const FALLBACK_PIXELS = 16_000_000;

/** Decodes a picture the right way up (browsers apply EXIF orientation by default). */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** A scaled copy for reading text and codes: large enough for small print, small enough to be quick. */
export function analysisCanvas(bitmap: ImageBitmap): { canvas: HTMLCanvasElement; scale: number } {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > 2400 ? 2400 / longest : longest < 1200 ? Math.min(3, 1200 / longest) : 1;
  const canvas = createCanvas(bitmap.width * scale, bitmap.height * scale);
  const context = canvas.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

/** Draws a picture stored without rotation (like an EXIF preview) the way the photo is shown. */
function drawOriented(context: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number, orientation: number): void {
  const transforms: Record<number, [number, number, number, number, number, number]> = {
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  const transform = transforms[orientation];
  if (transform) context.transform(...transform);
  context.drawImage(image, 0, 0, width, height);
}

/** A tiny grayscale fingerprint of a picture, for comparing two versions. Covers are drawn first, as in a copy. */
function fingerprint(image: CanvasImageSource, width: number, height: number, orientation = 1, covers: Box[] = []): Float64Array {
  const rotated = orientation >= 5;
  const full = createCanvas(rotated ? height : width, rotated ? width : height);
  const fullContext = full.getContext('2d')!;
  drawOriented(fullContext, image, width, height, orientation);
  fullContext.fillStyle = '#111111';
  for (const box of covers) fullContext.fillRect(box.x, box.y, box.w, box.h);
  const small = createCanvas(24, 24);
  const context = small.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(full, 0, 0, 24, 24);
  const { data } = context.getImageData(0, 0, 24, 24);
  const values = new Float64Array(24 * 24);
  for (let i = 0; i < values.length; i++) values[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return values;
}

function correlation(a: Float64Array, b: Float64Array): number {
  const mean = (values: Float64Array) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanA = mean(a);
  const meanB = mean(b);
  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < a.length; i++) {
    numerator += (a[i] - meanA) * (b[i] - meanB);
    varianceA += (a[i] - meanA) ** 2;
    varianceB += (b[i] - meanB) ** 2;
  }
  if (varianceA === 0 || varianceB === 0) return varianceA === varianceB ? 1 : 0;
  return numerator / Math.sqrt(varianceA * varianceB);
}

/**
 * Compares the embedded preview with the real picture. A different shape means
 * the photo was cropped after the preview was made; different content means it
 * was edited. Either way the preview may show what the person meant to remove.
 */
export async function compareThumbnail(thumbnail: Uint8Array, main: ImageBitmap, orientation: number): Promise<ThumbnailCheck> {
  let preview: ImageBitmap;
  try {
    preview = await createImageBitmap(new Blob([thumbnail as BlobPart], { type: 'image/jpeg' }));
  } catch {
    return 'unknown';
  }
  const rotated = orientation >= 5;
  const previewAspect = rotated ? preview.height / preview.width : preview.width / preview.height;
  const mainAspect = main.width / main.height;
  if (Math.abs(previewAspect - mainAspect) / mainAspect > 0.05) {
    preview.close();
    return 'different-crop';
  }
  const similarity = correlation(fingerprint(main, main.width, main.height), fingerprint(preview, preview.width, preview.height, orientation));
  preview.close();
  return similarity < 0.8 ? 'different-content' : 'same';
}

/** The embedded preview as a picture the right way up, so people can see it for themselves. */
export async function previewUrl(thumbnail: Uint8Array, orientation: number): Promise<string | null> {
  try {
    const preview = await createImageBitmap(new Blob([thumbnail as BlobPart], { type: 'image/jpeg' }));
    const rotated = orientation >= 5;
    const canvas = createCanvas(rotated ? preview.height : preview.width, rotated ? preview.width : preview.height);
    drawOriented(canvas.getContext('2d')!, preview, preview.width, preview.height, orientation);
    preview.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

export interface CoveredImage {
  blob: Blob;
  /** Less than 1 when the picture had to be made smaller to fit this device. */
  scale: number;
}

/**
 * Re-draws the picture with solid boxes. Solid fills are used instead of blur or
 * pixelation, because blurred or pixelated text can sometimes be recovered.
 */
export async function renderWithCovers(bitmap: ImageBitmap, covers: Box[], type: 'image/jpeg' | 'image/png'): Promise<CoveredImage> {
  for (const limit of [MAX_PIXELS, FALLBACK_PIXELS]) {
    const scale = Math.min(1, Math.sqrt(limit / (bitmap.width * bitmap.height)));
    const canvas = createCanvas(bitmap.width * scale, bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) continue;
    if (type === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    for (const box of covers) {
      const x = Math.floor(box.x * scale);
      const y = Math.floor(box.y * scale);
      context.fillRect(x, y, Math.ceil((box.x + box.w) * scale) - x, Math.ceil((box.y + box.h) * scale) - y);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
    canvas.width = canvas.height = 0;
    if (blob) return { blob, scale };
  }
  throw new Error('This device ran out of memory while saving the picture. Try a smaller photo.');
}

/**
 * Some privacy settings (like Firefox's fingerprinting protection) quietly
 * change what a canvas saves. Compare the copy with the source, drawn with the
 * same covers, so we can warn. Without the covers, a few large ones would look
 * like a changed picture.
 */
export async function looksLikeSource(copy: Blob, source: ImageBitmap, covers: Box[] = []): Promise<boolean> {
  try {
    const decoded = await createImageBitmap(copy);
    const expected = fingerprint(source, source.width, source.height, 1, covers);
    const similarity = correlation(fingerprint(decoded, decoded.width, decoded.height), expected);
    decoded.close();
    return similarity > 0.6;
  } catch {
    return false;
  }
}
