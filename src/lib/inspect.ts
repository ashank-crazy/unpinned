// Runs a photo through every check and makes the safer copy. Everything here
// happens in this browser tab; nothing is uploaded.

import { describeBarcode } from './barcode-text';
import { readContainer, sniffFormat, type ContainerReport, type ImageFormat } from './container';
import { formatBytes } from './format';
import { hiddenFindings, type ThumbnailCheck } from './hidden';
import { analysisCanvas, compareThumbnail, decodeImage, looksLikeSource, renderWithCovers } from './image';
import { readMetadata, type MetadataReport } from './metadata';
import type { OcrLine, OcrWord } from './ocr';
import { nearestPlace } from './places';
import { findInLines, type TextMatch } from './sensitive-text';
import { CleanError, stripLossless } from './strip';
import type { Box, Finding, Severity, VisibleKind } from './types';
import { verifyClean, type Verification } from './verify';

export const MAX_FILE_BYTES = 60 * 1024 * 1024;

/** A problem worth showing to the person as-is. */
export class PhotoError extends Error {}

export interface Photo {
  name: string;
  bytes: Uint8Array;
  format: ImageFormat;
  container: ContainerReport;
  meta: MetadataReport;
  /** The decoded picture, already turned the right way up. */
  bitmap: ImageBitmap | null;
  width: number;
  height: number;
  /** Why this browser couldn't open the picture, if it couldn't. */
  decodeProblem: string | null;
  previewUrl: string | null;
}

export const FORMAT_NAMES: Record<ImageFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  heic: 'HEIC',
  avif: 'AVIF',
  gif: 'GIF',
  unknown: 'Unknown',
};

function mimeFor(format: ImageFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : format === 'unknown' ? 'application/octet-stream' : `image/${format}`;
}

export async function loadPhoto(file: Blob, name: string): Promise<Photo> {
  if (file.size === 0) throw new PhotoError('This file is empty.');
  if (file.size > MAX_FILE_BYTES) throw new PhotoError(`This file is ${formatBytes(file.size)}. Unpinned handles pictures up to 60 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffFormat(bytes);
  if (format === 'unknown') {
    throw new PhotoError("This doesn't look like a photo or screenshot. Unpinned works with JPEG, PNG, WebP, HEIC, and AVIF pictures.");
  }
  if (format === 'gif') throw new PhotoError("GIF files aren't supported yet. Try a JPEG, PNG, or WebP picture.");

  const container = readContainer(bytes);
  const meta = await readMetadata(bytes, container);
  const typed = new Blob([bytes as BlobPart], { type: mimeFor(format) });
  let bitmap: ImageBitmap | null = null;
  let decodeProblem: string | null = null;
  try {
    bitmap = await decodeImage(typed);
  } catch {
    decodeProblem =
      format === 'heic'
        ? "This browser can't open HEIC photos, so it can't show the picture or make a copy. Unpinned can still list what's hidden in the file. To make a copy, open Unpinned in Safari, or export the photo as JPEG first."
        : "This browser couldn't open the picture. The file may be damaged or cut short. Unpinned can still list what's hidden in it.";
  }
  return {
    name,
    bytes,
    format,
    container,
    meta,
    bitmap,
    width: bitmap?.width ?? 0,
    height: bitmap?.height ?? 0,
    decodeProblem,
    previewUrl: bitmap ? URL.createObjectURL(typed) : null,
  };
}

export function releasePhoto(photo: Photo): void {
  photo.bitmap?.close();
  if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
}

export async function findHidden(photo: Photo): Promise<Finding[]> {
  const { meta, container } = photo;
  const place = meta.gps ? await nearestPlace(meta.gps.lat, meta.gps.lon) : null;
  let thumbnailCheck: ThumbnailCheck = 'unknown';
  if (meta.thumbnail && photo.bitmap) {
    thumbnailCheck = await compareThumbnail(meta.thumbnail, photo.bitmap, meta.orientation).catch(() => 'unknown' as const);
  }
  return hiddenFindings({ container, meta, place, thumbnailCheck });
}

export interface VisibleResult {
  findings: Finding[];
  textRead: boolean;
  codesRead: boolean;
}

export async function findVisible(photo: Photo, onProgress: (fraction: number) => void): Promise<VisibleResult> {
  if (!photo.bitmap) return { findings: [], textRead: false, codesRead: false };
  const { canvas, scale } = analysisCanvas(photo.bitmap);
  const toImage = (box: Box): Box => ({ x: box.x / scale, y: box.y / scale, w: box.w / scale, h: box.h / scale });
  const findings: Finding[] = [];

  let codesRead = true;
  try {
    const { detectBarcodes } = await import('./barcodes');
    for (const code of await detectBarcodes(canvas)) {
      findings.push({ id: '', ...describeBarcode(code.rawValue), boxes: [padBox(toImage(code.box), photo, 0.06)] });
    }
  } catch {
    codesRead = false;
  }

  let textRead = true;
  try {
    const { readText } = await import('./ocr');
    const lines = await readText(canvas, onProgress);
    findings.push(...textFindings(lines, toImage, photo));
  } catch {
    textRead = false;
  }
  canvas.width = canvas.height = 0;

  // Number findings in reading order, so the numbers on the picture run top to bottom.
  findings.sort((a, b) => (a.boxes?.[0]?.y ?? 0) - (b.boxes?.[0]?.y ?? 0) || (a.boxes?.[0]?.x ?? 0) - (b.boxes?.[0]?.x ?? 0));
  findings.forEach((finding, index) => (finding.id = `visible-${index + 1}`));
  return { findings, textRead, codesRead };
}

const TEXT_COPY: Record<string, { title: string; why: string }> = {
  address: { title: 'An address', why: 'Shows where someone lives or gets mail.' },
  email: { title: 'An email address', why: 'Can be used for spam and scams, or to look up your other accounts.' },
  phone: { title: 'A phone number', why: 'Can be used for scam calls and texts, or to find your other accounts.' },
  card: { title: 'A full card number', why: 'Someone could try to use it to buy things.' },
  ssn: { title: 'A Social Security number', why: 'It can be used to steal your identity.' },
  iban: { title: 'A bank account number', why: 'It can be used in payment scams and to pose as you.' },
  name: { title: 'A name', why: 'Ties the picture to a real person.' },
  reference: {
    title: 'A booking or order number',
    why: 'Together with your name, it can let someone look up or change a booking or order.',
  },
  account: { title: 'An account or member number', why: 'It helps someone pose as you when they contact a company.' },
  birthdate: { title: 'A date of birth', why: 'It is often used to check identity, so it helps someone pose as you.' },
};

/** Never repeat a full card, Social Security, or bank number on screen. */
export function maskValue(kind: VisibleKind, value: string): string {
  const digits = value.replace(/\D/g, '');
  if (kind === 'card') return `•••• •••• •••• ${digits.slice(-4)}`;
  if (kind === 'ssn') return `•••-••-${digits.slice(-4)}`;
  if (kind === 'iban') {
    const compact = value.replace(/\s/g, '');
    return `${compact.slice(0, 4)} •••• •••• ${compact.slice(-4)}`;
  }
  return value;
}

const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

function textFindings(lines: OcrLine[], toImage: (box: Box) => Box, photo: Photo): Finding[] {
  const matches = findInLines(lines.map((line) => line.text));
  // Consecutive address lines (street, then city) become one finding.
  const groups: TextMatch[][] = [];
  for (const match of matches) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && previous && match.kind === 'address' && previous.kind === 'address' && match.line === previous.line + 1) group.push(match);
    else groups.push([match]);
  }
  return groups.map((group) => {
    const kind = group[0].kind;
    const parts = group.map((match) => {
      const all = wordsIn(lines[match.line], match);
      const words = dropStrays(all);
      return { words, value: trimDropped(match.value, all, words) };
    });
    const words = parts.flatMap((part) => part.words);
    const boxes = parts
      .map((part) => unionBox(part.words.map((word) => word.box)))
      .filter((box): box is Box => box !== null)
      .map((box) => padBox(toImage(box), photo, 0.25));
    const confidence = words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : 100;
    const value = maskValue(kind, parts.map((part) => part.value).join(', '));
    const copy = TEXT_COPY[kind] ?? { title: 'Personal details', why: 'This can identify you.' };
    return {
      id: '',
      kind,
      severity: group.reduce<Severity>((best, match) => (RANK[match.severity] > RANK[best] ? match.severity : best), 'low'),
      title: copy.title,
      summary: `“${value}”`,
      why: copy.why,
      facts: [{ label: 'Read as', value }],
      boxes,
      unsure: confidence < 70,
    };
  });
}

/** The words of an OCR line that overlap a match (words are joined by single spaces). */
function wordsIn(line: OcrLine, match: TextMatch): OcrLine['words'] {
  let offset = 0;
  const words: OcrLine['words'] = [];
  for (const word of line.words) {
    const start = offset;
    const end = offset + word.text.length;
    if (start < match.end && match.start < end) words.push(word);
    offset = end + 1;
  }
  return words;
}

/**
 * Drops a lone character at either end of a match that sits far from the
 * rest of the line. The text reader sometimes reads a bit of a picture, like
 * a plant, as a letter, and it would stretch the box and the shown value.
 */
export function dropStrays(words: OcrWord[]): OcrWord[] {
  if (words.length < 2) return words;
  const heights = words.map((word) => word.box.h).sort((a, b) => a - b);
  const lineHeight = heights[Math.floor(heights.length / 2)];
  const gap = (left: OcrWord, right: OcrWord) => right.box.x - (left.box.x + left.box.w);
  const isStray = (word: OcrWord, neighbor: OcrWord, after: boolean) =>
    word.text.length === 1 && (after ? gap(neighbor, word) : gap(word, neighbor)) > lineHeight * 1.5;
  let start = 0;
  let end = words.length;
  while (end - start > 1 && isStray(words[end - 1], words[end - 2], true)) end--;
  while (end - start > 1 && isStray(words[start], words[start + 1], false)) start++;
  return words.slice(start, end);
}

/** Removes the text of dropped words from the ends of a matched value. */
export function trimDropped(value: string, all: OcrWord[], kept: OcrWord[]): string {
  let result = value;
  for (const word of all.slice(all.indexOf(kept.at(-1)!) + 1).reverse()) {
    if (result.endsWith(word.text)) result = result.slice(0, -word.text.length).trimEnd();
  }
  for (const word of all.slice(0, all.indexOf(kept[0]))) {
    if (result.startsWith(word.text)) result = result.slice(word.text.length).trimStart();
  }
  return result;
}

function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** Grows a box a little (text readers draw tight boxes) and keeps it inside the picture. */
function padBox(box: Box, photo: Photo, amount: number): Box {
  const pad = Math.max(3, Math.min(box.h, box.w) * amount);
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    w: Math.min(photo.width, box.x + box.w + pad) - x,
    h: Math.min(photo.height, box.y + box.h + pad) - y,
  };
}

export interface SaferCopy {
  blob: Blob;
  url: string;
  name: string;
  type: string;
  /** True when the picture data was kept exactly as it was (no re-compression). */
  lossless: boolean;
  /** Less than 1 when the picture had to be made smaller to fit this device. */
  scale: number;
  /** False when a browser privacy setting seems to have changed the saved picture. */
  looksRight: boolean;
  coverCount: number;
  verification: Verification;
}

export async function makeSaferCopy(photo: Photo, covers: Box[]): Promise<SaferCopy> {
  let bytes: Uint8Array | null = null;
  let type = mimeFor(photo.format);
  let lossless = false;
  let scale = 1;
  let looksRight = true;

  if (covers.length === 0) {
    try {
      bytes = stripLossless(photo.bytes, photo.format, photo.meta.orientation);
      lossless = bytes !== null;
    } catch (error) {
      if (!(error instanceof CleanError)) throw error;
    }
  }

  if (!bytes) {
    if (!photo.bitmap) {
      throw new PhotoError(photo.decodeProblem ?? "This browser can't open the picture, so it can't make a copy.");
    }
    type = photo.format === 'png' || photo.format === 'webp' ? 'image/png' : 'image/jpeg';
    const rendered = await renderWithCovers(photo.bitmap, covers, type as 'image/jpeg' | 'image/png').catch((error: unknown) => {
      throw new PhotoError(error instanceof Error ? error.message : 'This device could not save the picture.');
    });
    scale = rendered.scale;
    looksRight = await looksLikeSource(rendered.blob, photo.bitmap);
    const encoded = new Uint8Array(await rendered.blob.arrayBuffer());
    // A fresh canvas carries no metadata, but strip again in case a browser adds some.
    try {
      bytes = stripLossless(encoded, sniffFormat(encoded), 1) ?? encoded;
    } catch {
      bytes = encoded;
    }
  }

  const verification = await verifyClean(bytes);
  const blob = new Blob([bytes as BlobPart], { type });
  return {
    blob,
    url: URL.createObjectURL(blob),
    name: saferName(photo.name, type),
    type,
    lossless,
    scale,
    looksRight,
    coverCount: covers.length,
    verification,
  };
}

export function saferName(name: string, type: string): string {
  const base = name.replace(/\.[^./\\]+$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `${base}-unpinned.${extension}`;
}
