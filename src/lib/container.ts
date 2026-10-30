// Walks the structure of JPEG, PNG and WebP files to find everything stored
// besides the picture itself: metadata blocks, comments, embedded previews,
// and data left over after the end of the image.

import { decodeText, indexOfAscii, latin1, startsWithAscii, u16be, u16le, u32be, u32le, utf8 } from './bytes';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'gif' | 'unknown';

export type TrailingKind = 'video' | 'image' | 'leftover-image-data' | 'padding' | 'unknown';

export interface TextEntry {
  source: string;
  key: string;
  value: string;
}

export interface ContainerReport {
  format: ImageFormat;
  /** Byte offset just past the end of the picture, when the file has a clear end. */
  imageEnd: number | null;
  /** Bytes after the end of the picture. Viewers ignore them, but they travel with the file. */
  trailing: { offset: number; length: number; kind: TrailingKind } | null;
  /** Raw EXIF blocks (TIFF structure) found in the container. */
  exif: Uint8Array[];
  /** XMP packets found in the container. */
  xmp: string[];
  iptc: boolean;
  icc: boolean;
  /** Free text stored in the file, like JPEG comments and PNG text notes. */
  texts: TextEntry[];
  /** Compressed PNG text notes, decompressed later because that step is asynchronous. */
  compressedTexts: { key: string; data: Uint8Array }[];
  /** An old-style JFIF preview image. */
  jfifThumbnail: boolean;
  /** Extra pictures announced by a Multi-Picture Format block (depth maps, HDR gain maps). */
  extraImages: number;
  /** True when XMP marks this as a motion photo that carries a video clip. */
  motionPhoto: boolean;
  /** Metadata-bearing parts of the file, in order, for the technical view. */
  parts: string[];
  /** The file ends before the picture does. */
  truncated: boolean;
}

export function sniffFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && startsWithAscii(bytes, 'PNG\r\n', 1)) return 'png';
  if (bytes.length >= 12 && startsWithAscii(bytes, 'RIFF') && startsWithAscii(bytes, 'WEBP', 8)) return 'webp';
  if (bytes.length >= 6 && startsWithAscii(bytes, 'GIF8')) return 'gif';
  if (bytes.length >= 12 && startsWithAscii(bytes, 'ftyp', 4)) {
    const boxSize = Math.min(u32be(bytes, 0) || 32, 64, bytes.length);
    const brands = latin1(bytes, 8, boxSize - 8);
    if (/avif|avis/.test(brands)) return 'avif';
    if (/heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(brands)) return 'heic';
  }
  return 'unknown';
}

export function readContainer(bytes: Uint8Array): ContainerReport {
  const report: ContainerReport = {
    format: sniffFormat(bytes),
    imageEnd: null,
    trailing: null,
    exif: [],
    xmp: [],
    iptc: false,
    icc: false,
    texts: [],
    compressedTexts: [],
    jfifThumbnail: false,
    extraImages: 0,
    motionPhoto: false,
    parts: [],
    truncated: false,
  };
  if (report.format === 'jpeg') scanJpeg(bytes, report);
  else if (report.format === 'png') scanPng(bytes, report);
  else if (report.format === 'webp') scanWebp(bytes, report);

  if (report.imageEnd !== null && report.imageEnd < bytes.length) {
    const tail = bytes.subarray(report.imageEnd);
    report.trailing = { offset: report.imageEnd, length: tail.length, kind: classifyTrailing(tail) };
  }
  report.motionPhoto = report.xmp.some((packet) => MOTION_PHOTO.test(packet));
  return report;
}

const MOTION_PHOTO = /(?:MotionPhoto|MicroVideo)\s*=\s*["']?1|<(?:\w+:)?(?:MotionPhoto|MicroVideo)>\s*1|Semantic\s*=\s*["']MotionPhoto/;

function classifyTrailing(tail: Uint8Array): TrailingKind {
  if (tail.every((byte) => byte === 0x00) || tail.every((byte) => byte === 0xff)) return 'padding';
  if (indexOfAscii(tail, 'ftyp') >= 0) return 'video';
  if (tail.length >= 3 && tail[0] === 0xff && tail[1] === 0xd8 && tail[2] === 0xff) return 'image';
  if (indexOfAscii(tail, 'IDAT') >= 0 || indexOfAscii(tail, 'IEND') >= 0) return 'leftover-image-data';
  return 'unknown';
}

// ------------------------------------------------------------------- JPEG

const XMP_ID = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXTENSION_ID = 'http://ns.adobe.com/xmp/extension/\0';

/** Visits each JPEG segment. Returns the offset just past EOI, or null if the file ends early. */
export function walkJpeg(
  bytes: Uint8Array,
  visit: (marker: number, start: number, end: number, payload: Uint8Array) => void,
): number | null {
  const n = bytes.length;
  let i = 2;
  while (i + 1 < n) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1];
    while (marker === 0xff && i + 2 < n) {
      i++;
      marker = bytes[i + 1];
    }
    if (marker === 0xd9) return i + 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 4 > n) return null;
    const length = u16be(bytes, i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > n) return null;
    if (marker === 0xda) {
      const dataEnd = skipEntropyCodedData(bytes, end);
      visit(marker, i, dataEnd, bytes.subarray(i + 4, end));
      if (dataEnd >= n) return null;
      i = dataEnd;
      continue;
    }
    visit(marker, i, end, bytes.subarray(i + 4, end));
    i = end;
  }
  return null;
}

function skipEntropyCodedData(bytes: Uint8Array, start: number): number {
  const n = bytes.length;
  let j = start;
  while (j + 1 < n) {
    if (bytes[j] === 0xff) {
      const next = bytes[j + 1];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        j += 2;
        continue;
      }
      if (next === 0xff) {
        j += 1;
        continue;
      }
      return j;
    }
    j++;
  }
  return n;
}

function scanJpeg(bytes: Uint8Array, report: ContainerReport): void {
  const end = walkJpeg(bytes, (marker, _start, _end, payload) => {
    const name = describeJpegSegment(marker, payload, report);
    if (name) report.parts.push(name);
  });
  if (end === null) report.truncated = true;
  else report.imageEnd = end;
}

function describeJpegSegment(marker: number, payload: Uint8Array, report: ContainerReport): string | null {
  if (marker === 0xe0) {
    if (startsWithAscii(payload, 'JFIF\0')) {
      if (payload.length >= 14 && payload[12] > 0 && payload[13] > 0) report.jfifThumbnail = true;
      return 'JFIF';
    }
    if (startsWithAscii(payload, 'JFXX\0')) {
      report.jfifThumbnail = true;
      return 'JFIF preview';
    }
    return 'APP0';
  }
  if (marker === 0xe1) {
    if (startsWithAscii(payload, 'Exif\0')) {
      report.exif.push(payload.subarray(6));
      return 'EXIF';
    }
    if (startsWithAscii(payload, XMP_ID)) {
      report.xmp.push(utf8(payload.subarray(XMP_ID.length)));
      return 'XMP';
    }
    if (startsWithAscii(payload, XMP_EXTENSION_ID)) {
      // Extended XMP: a 32-byte GUID, total length, and offset precede each piece.
      report.xmp.push(utf8(payload.subarray(XMP_EXTENSION_ID.length + 40)));
      return 'XMP (extended)';
    }
    return 'APP1';
  }
  if (marker === 0xe2) {
    if (startsWithAscii(payload, 'ICC_PROFILE\0')) {
      report.icc = true;
      return 'ICC color profile';
    }
    if (startsWithAscii(payload, 'MPF\0')) {
      report.extraImages = Math.max(report.extraImages, multiPictureCount(payload.subarray(4)) - 1);
      return 'Multi-Picture';
    }
    return 'APP2';
  }
  if (marker === 0xed) {
    if (indexOfAscii(payload, '8BIM\u0004\u0004') >= 0) report.iptc = true;
    return 'Photoshop/IPTC';
  }
  if (marker === 0xee && startsWithAscii(payload, 'Adobe')) return 'Adobe';
  if (marker === 0xfe) {
    const value = decodeText(payload).replace(/\0+$/, '').trim();
    if (value) report.texts.push({ source: 'JPEG comment', key: 'Comment', value });
    return 'Comment';
  }
  if (marker >= 0xe0 && marker <= 0xef) return `APP${marker - 0xe0}`;
  return null;
}

/** Reads NumberOfImages from a Multi-Picture Format index (a TIFF-style IFD). */
function multiPictureCount(tiff: Uint8Array): number {
  if (tiff.length < 8) return 0;
  const little = tiff[0] === 0x49;
  const r16 = (offset: number) => (little ? u16le(tiff, offset) : u16be(tiff, offset));
  const r32 = (offset: number) => (little ? u32le(tiff, offset) : u32be(tiff, offset));
  const ifd = r32(4);
  const count = r16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > tiff.length) break;
    if (r16(entry) === 0xb001) return r32(entry + 8);
  }
  return 0;
}

// ------------------------------------------------------------------- PNG

/** Visits each PNG chunk. Returns the offset just past IEND, or null if the file ends early. */
export function walkPng(
  bytes: Uint8Array,
  visit: (type: string, start: number, end: number, data: Uint8Array) => void,
): number | null {
  const n = bytes.length;
  let i = 8;
  while (i + 12 <= n) {
    const length = u32be(bytes, i);
    const type = latin1(bytes, i + 4, 4);
    const dataStart = i + 8;
    const chunkEnd = dataStart + length + 4;
    if (length > n || chunkEnd > n) return null;
    visit(type, i, chunkEnd, bytes.subarray(dataStart, dataStart + length));
    if (type === 'IEND') return chunkEnd;
    i = chunkEnd;
  }
  return null;
}

function scanPng(bytes: Uint8Array, report: ContainerReport): void {
  let lastPart = '';
  const end = walkPng(bytes, (type, _start, _end, data) => {
    if (type === 'tEXt') {
      const split = data.indexOf(0);
      if (split > 0) report.texts.push({ source: 'PNG text', key: latin1(data, 0, split), value: latin1(data, split + 1) });
    } else if (type === 'zTXt') {
      const split = data.indexOf(0);
      if (split > 0) report.compressedTexts.push({ key: latin1(data, 0, split), data: data.subarray(split + 2) });
    } else if (type === 'iTXt') {
      readInternationalText(data, report);
    } else if (type === 'eXIf') {
      report.exif.push(stripExifPrefix(data));
    } else if (type === 'tIME' && data.length === 7) {
      const pad = (value: number) => String(value).padStart(2, '0');
      const value = `${u16be(data, 0)}-${pad(data[2])}-${pad(data[3])} ${pad(data[4])}:${pad(data[5])} UTC`;
      report.texts.push({ source: 'PNG', key: 'Last changed', value });
    } else if (type === 'iCCP') {
      report.icc = true;
    }
    if (type !== lastPart && type !== 'IDAT') report.parts.push(type);
    lastPart = type;
  });
  if (end === null) report.truncated = true;
  else report.imageEnd = end;
}

function readInternationalText(data: Uint8Array, report: ContainerReport): void {
  const keyEnd = data.indexOf(0);
  if (keyEnd <= 0 || keyEnd + 3 > data.length) return;
  const key = latin1(data, 0, keyEnd);
  const compressed = data[keyEnd + 1] === 1;
  const languageEnd = data.indexOf(0, keyEnd + 3);
  if (languageEnd < 0) return;
  const translatedEnd = data.indexOf(0, languageEnd + 1);
  if (translatedEnd < 0) return;
  const text = data.subarray(translatedEnd + 1);
  if (compressed) {
    report.compressedTexts.push({ key, data: text });
    return;
  }
  const value = utf8(text);
  if (key === 'XML:com.adobe.xmp') report.xmp.push(value);
  else report.texts.push({ source: 'PNG text', key, value });
}

// ------------------------------------------------------------------- WebP

export function walkWebp(
  bytes: Uint8Array,
  visit: (id: string, start: number, end: number, data: Uint8Array) => void,
): number | null {
  const riffEnd = 8 + u32le(bytes, 4);
  const end = Math.min(riffEnd, bytes.length);
  let i = 12;
  while (i + 8 <= end) {
    const id = latin1(bytes, i, 4);
    const size = u32le(bytes, i + 4);
    const dataEnd = i + 8 + size;
    if (dataEnd > end) return null;
    const padded = Math.min(dataEnd + (size & 1), end);
    visit(id, i, padded, bytes.subarray(i + 8, dataEnd));
    i = padded;
  }
  return riffEnd <= bytes.length ? riffEnd : null;
}

function scanWebp(bytes: Uint8Array, report: ContainerReport): void {
  const end = walkWebp(bytes, (id, _start, _end, data) => {
    if (id === 'EXIF') report.exif.push(stripExifPrefix(data));
    else if (id === 'XMP ') report.xmp.push(utf8(data));
    else if (id === 'ICCP') report.icc = true;
    report.parts.push(id.trim());
  });
  if (end === null) report.truncated = true;
  else report.imageEnd = end;
}

/** Some writers keep the "Exif\0\0" prefix inside PNG and WebP EXIF blocks; the TIFF data starts after it. */
function stripExifPrefix(data: Uint8Array): Uint8Array {
  return startsWithAscii(data, 'Exif\0') ? data.subarray(6) : data;
}
