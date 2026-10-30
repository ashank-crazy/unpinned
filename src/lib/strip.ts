// Removes hidden information from JPEG, PNG and WebP files without
// re-compressing the picture, so the clean copy keeps its full quality.

import { concatBytes, startsWithAscii } from './bytes';
import { walkJpeg, walkPng, walkWebp, type ImageFormat } from './container';

export class CleanError extends Error {}

const SOI = Uint8Array.from([0xff, 0xd8]);
const EOI = Uint8Array.from([0xff, 0xd9]);

/**
 * A tiny EXIF block that holds only the orientation, so the copy still shows
 * the right way up. It contains nothing about the person or the device.
 */
export function orientationSegment(orientation: number): Uint8Array {
  // prettier-ignore
  return Uint8Array.from([
    0xff, 0xe1, 0x00, 0x22,             // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header, IFD at 8
    0x00, 0x01,                         // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT
    0x00, 0x00, 0x00, 0x00,             // no next IFD
  ]);
}

/** A JFIF header copied from the original, minus any preview image. */
function cleanJfif(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(18);
  out.set([0xff, 0xe0, 0x00, 0x10]);
  out.set(payload.subarray(0, 12), 4);
  return out;
}

export function stripJpeg(bytes: Uint8Array, orientation = 1): Uint8Array {
  const kept: { jfif: Uint8Array | null; adobe: Uint8Array | null } = { jfif: null, adobe: null };
  const icc: Uint8Array[] = [];
  const body: Uint8Array[] = [];
  const end = walkJpeg(bytes, (marker, start, segmentEnd, payload) => {
    if (marker === 0xe0) {
      if (!kept.jfif && startsWithAscii(payload, 'JFIF\0') && payload.length >= 12) kept.jfif = cleanJfif(payload);
      return;
    }
    // Color profiles and the Adobe color-transform flag are needed to show colors correctly.
    if (marker === 0xe2 && startsWithAscii(payload, 'ICC_PROFILE\0')) {
      icc.push(bytes.subarray(start, segmentEnd));
      return;
    }
    if (marker === 0xee && startsWithAscii(payload, 'Adobe')) {
      kept.adobe = bytes.subarray(start, segmentEnd);
      return;
    }
    // Every other application segment (EXIF, XMP, IPTC, MPF, ...) and every comment is dropped.
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) return;
    body.push(bytes.subarray(start, segmentEnd));
  });
  if (end === null) {
    throw new CleanError("This JPEG ends early, so it can't be cleaned without re-saving the picture.");
  }
  const head: Uint8Array[] = [SOI];
  if (kept.jfif) head.push(kept.jfif);
  if (orientation >= 2 && orientation <= 8) head.push(orientationSegment(orientation));
  if (kept.adobe) head.push(kept.adobe);
  // Anything after the end-of-image marker (videos, extra pictures, leftovers) is left behind.
  return concatBytes([...head, ...icc, ...body, EOI]);
}

// Chunks needed to draw the picture correctly, including animation and color.
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'bKGD', 'hIST', 'pHYs', 'sPLT',
  'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCv', 'cLLi', 'CgBI',
]);

export function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const end = walkPng(bytes, (type, start, chunkEnd) => {
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(start, chunkEnd));
  });
  if (end === null) throw new CleanError("This PNG ends early, so it can't be cleaned without re-saving the picture.");
  return concatBytes(parts);
}

export function stripWebp(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  const end = walkWebp(bytes, (id, start, chunkEnd) => {
    if (id === 'EXIF' || id === 'XMP ') return;
    if (id === 'VP8X') {
      const copy = bytes.slice(start, chunkEnd);
      copy[8] &= ~(0x08 | 0x04); // clear the "has EXIF" and "has XMP" flags
      chunks.push(copy);
      return;
    }
    chunks.push(bytes.subarray(start, chunkEnd));
  });
  if (end === null) throw new CleanError("This WebP ends early, so it can't be cleaned without re-saving the picture.");
  const body = concatBytes(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return concatBytes([header, body]);
}

/** Lossless cleaning for the formats that support it; null means "re-save the picture instead". */
export function stripLossless(bytes: Uint8Array, format: ImageFormat, orientation: number): Uint8Array | null {
  if (format === 'jpeg') return stripJpeg(bytes, orientation);
  if (format === 'png') return stripPng(bytes);
  if (format === 'webp') return stripWebp(bytes);
  return null;
}
