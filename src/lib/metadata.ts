// Reads the hidden information a photo carries (EXIF, XMP, IPTC, text notes)
// and sorts it into groups a person can understand.

import exifr from 'exifr';
import { concatBytes, decodeText } from './bytes';
import type { ContainerReport } from './container';
import { clip, formatDateTime } from './format';
import type { Fact } from './types';

export interface GpsInfo {
  lat: number;
  lon: number;
  altitude?: number;
  /** Horizontal accuracy the device reported, in meters. */
  accuracy?: number;
  /** Compass direction the camera faced, in degrees. */
  direction?: number;
}

export interface MetadataReport {
  gps: GpsInfo | null;
  /** GPS fields are present but hold 0,0, which usually means "no fix". */
  emptyGps: boolean;
  taken: { date: Date | null; text: string; offset?: string } | null;
  device: Fact[];
  identifiers: Fact[];
  people: Fact[];
  places: Fact[];
  notes: Fact[];
  history: Fact[];
  /** Settings like exposure and resolution: harmless, but still removed. */
  technical: Fact[];
  /** EXIF orientation, 1 to 8. */
  orientation: number;
  /** An embedded preview image (JPEG bytes), if the file has one. */
  thumbnail: Uint8Array | null;
  /** The file mentions AI image-generation settings. */
  aiSettings: boolean;
}

const OPTIONS = {
  tiff: true,
  ifd1: true,
  exif: true,
  gps: true,
  interop: false,
  xmp: true,
  iptc: true,
  icc: false,
  jfif: false,
  ihdr: false,
  makerNote: false,
  userComment: true,
  translateKeys: true,
  translateValues: false,
  reviveValues: true,
  sanitize: true,
  mergeOutput: false,
  silentErrors: true,
  multiSegment: true,
};

type Block = Record<string, unknown>;
type Parsed = Record<string, Block>;

const DEVICE: Record<string, string> = {
  Make: 'Maker',
  Model: 'Model',
  LensMake: 'Lens maker',
  LensModel: 'Lens',
  Lens: 'Lens',
  Software: 'Software',
  HostComputer: 'Device',
};

const IDENTIFIERS: Record<string, string> = {
  SerialNumber: 'Camera serial number',
  BodySerialNumber: 'Camera serial number',
  CameraSerialNumber: 'Camera serial number',
  InternalSerialNumber: 'Serial number',
  LensSerialNumber: 'Lens serial number',
  ImageUniqueID: 'Unique photo ID',
};

const PEOPLE: Record<string, string> = {
  Artist: 'Artist',
  Copyright: 'Copyright',
  OwnerName: 'Camera owner',
  CameraOwnerName: 'Camera owner',
  XPAuthor: 'Author',
  creator: 'Creator',
  rights: 'Rights',
  Byline: 'By-line',
  Credit: 'Credit',
  Writer: 'Writer',
  CaptionWriter: 'Caption writer',
  AuthorsPosition: 'Job title',
  Owner: 'Owner',
  Contact: 'Contact',
};

const PLACES = /^(city|state|country|countrycode|province|provincestate|province-state|sublocation|sub-location|location|locationcreated|locationshown|country-primarylocationname)$/i;

const NOTES: Record<string, string> = {
  ImageDescription: 'Description',
  UserComment: 'Comment',
  XPComment: 'Comment',
  XPKeywords: 'Keywords',
  XPSubject: 'Subject',
  XPTitle: 'Title',
  description: 'Description',
  title: 'Title',
  subject: 'Keywords',
  Caption: 'Caption',
  Keywords: 'Keywords',
  Headline: 'Headline',
  ObjectName: 'Title',
  SpecialInstructions: 'Instructions',
  DocumentName: 'Document name',
};

const HISTORY: Record<string, string> = {
  CreatorTool: 'Made with',
  History: 'Editing history',
  DerivedFrom: 'Made from another file',
  DocumentAncestors: 'Earlier versions',
  Ingredients: 'Combined from',
  RawFileName: 'Original file name',
  OriginalFileName: 'Original file name',
  PreservedFileName: 'Original file name',
};

const TIME_KEYS = new Set([
  'DateTimeOriginal',
  'CreateDate',
  'DateCreated',
  'ModifyDate',
  'MetadataDate',
  'DigitalCreationDate',
  'OffsetTimeOriginal',
  'OffsetTime',
  'OffsetTimeDigitized',
  'TimeCreated',
  'DigitalCreationTime',
  'SubSecTimeOriginal',
  'SubSecTime',
  'SubSecTimeDigitized',
]);

// Pointers and bookkeeping fields that say nothing about the person.
const SKIP = new Set([
  'ThumbnailOffset',
  'ThumbnailLength',
  'Orientation',
  'latitude',
  'longitude',
  'parseType',
  'about',
  'ApplicationRecordVersion',
  'GPSVersionID',
  'ExifVersion',
  'FlashpixVersion',
  'InteropIndex',
  'InteropVersion',
]);

const XMP_ID = 'http://ns.adobe.com/xap/1.0/\0';

export async function readMetadata(bytes: Uint8Array, container: ContainerReport): Promise<MetadataReport> {
  const parsed = await parseAll(bytes, container);
  const report: MetadataReport = {
    gps: null,
    emptyGps: false,
    taken: null,
    device: [],
    identifiers: [],
    people: [],
    places: [],
    notes: [],
    history: [],
    technical: [],
    orientation: 1,
    thumbnail: null,
    aiSettings: false,
  };

  const seen = new Set<string>();
  const add = (list: Fact[], label: string, value: string) => {
    const clean = clip(value, 400);
    const key = `${label}\u0000${clean.toLowerCase()}`;
    if (!clean || seen.has(key)) return;
    seen.add(key);
    list.push({ label, value: clean });
  };

  for (const [blockName, block] of Object.entries(parsed)) {
    if (!block || typeof block !== 'object') continue;
    for (const [key, value] of Object.entries(block)) {
      if (SKIP.has(key) || value === undefined || value === null) continue;
      if (blockName === 'gps' || key.startsWith('GPS')) continue;
      if (TIME_KEYS.has(key)) continue;
      if (blockName === 'ifd1') continue;
      const text = stringify(key, value);
      if (!text) continue;
      if (key in DEVICE) add(report.device, DEVICE[key], text);
      else if (key in IDENTIFIERS) add(report.identifiers, IDENTIFIERS[key], text);
      else if (key in PEOPLE) add(report.people, PEOPLE[key], text);
      else if (PLACES.test(key)) add(report.places, humanize(key), text);
      else if (key in NOTES) add(report.notes, NOTES[key], text);
      else if (key in HISTORY) add(report.history, HISTORY[key], text);
      else if (['ifd0', 'exif', 'interop', 'tiff', 'aux', 'exifEX'].includes(blockName)) add(report.technical, humanize(key), text);
    }
  }

  for (const entry of container.texts) addText(report, add, entry.key, entry.value, entry.source);
  for (const entry of await decompressTexts(container.compressedTexts)) addText(report, add, entry.key, entry.value, 'PNG text');

  report.gps = readGps(parsed, container.xmp);
  report.emptyGps = !report.gps && hasZeroGps(parsed);
  report.taken = readTaken(parsed);
  report.orientation = readOrientation(parsed);
  report.thumbnail = await readThumbnail(bytes, container);
  return report;
}

async function parseAll(bytes: Uint8Array, container: ContainerReport): Promise<Parsed> {
  const merged: Parsed = {};
  const merge = (out: unknown) => {
    if (!out || typeof out !== 'object') return;
    for (const [name, block] of Object.entries(out as Parsed)) {
      if (name === 'errors' || !block || typeof block !== 'object') continue;
      merged[name] = { ...(merged[name] ?? {}), ...block };
    }
  };

  if (container.format === 'jpeg' || container.format === 'heic' || container.format === 'avif') {
    merge(await safeParse(bytes));
    return merged;
  }
  // exifr can't read PNG or WebP containers fully, so hand it each block on its own.
  for (const tiff of container.exif) merge(await safeParse(tiff));
  for (const packet of container.xmp) {
    const payload = concatBytes([new TextEncoder().encode(XMP_ID), new TextEncoder().encode(packet)]);
    if (payload.length > 65_533) continue;
    merge(await safeParse(jpegEnvelope(payload)));
  }
  return merged;
}

async function safeParse(input: Uint8Array): Promise<unknown> {
  try {
    return await exifr.parse(input, OPTIONS);
  } catch {
    return null;
  }
}

/** A minimal JPEG holding one APP1 segment, so exifr can parse XMP from any container. */
function jpegEnvelope(app1Payload: Uint8Array): Uint8Array {
  const length = app1Payload.length + 2;
  return concatBytes([
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff]),
    app1Payload,
    Uint8Array.from([0xff, 0xd9]),
  ]);
}

function addText(
  report: MetadataReport,
  add: (list: Fact[], label: string, value: string) => void,
  key: string,
  value: string,
  source: string,
): void {
  if (/parameters|prompt|workflow|negative|sd-metadata|invokeai|comfy|dream/i.test(key)) {
    report.aiSettings = true;
    add(report.notes, 'AI image settings', value);
  } else if (/author|artist|creator|owner|copyright/i.test(key)) add(report.people, key, value);
  else if (/software|source|camera|make|model/i.test(key)) add(report.device, key === 'Source' ? 'Device' : key, value);
  else if (/time|date|changed/i.test(key)) add(report.notes, key, value);
  else add(report.notes, key === 'Comment' && source === 'JPEG comment' ? 'Comment' : key, value);
}

async function decompressTexts(entries: { key: string; data: Uint8Array }[]): Promise<{ key: string; value: string }[]> {
  const out: { key: string; value: string }[] = [];
  for (const entry of entries) {
    const value = await inflateLimited(entry.data, 64 * 1024);
    if (value === null) continue;
    if (entry.key === 'XML:com.adobe.xmp') continue;
    out.push({ key: entry.key, value });
  }
  return out;
}

/** Decompresses zlib data but stops at a size limit, so a booby-trapped file can't exhaust memory. */
async function inflateLimited(data: Uint8Array, limit: number): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    return decodeText(concatBytes(chunks).subarray(0, limit));
  } catch {
    return null;
  }
}

function readGps(parsed: Parsed, xmpPackets: string[]): GpsInfo | null {
  const gps = parsed.gps ?? {};
  let lat = typeof gps.latitude === 'number' ? gps.latitude : NaN;
  let lon = typeof gps.longitude === 'number' ? gps.longitude : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    // XMP can store GPS as "41,52.962N".
    for (const packet of xmpPackets) {
      const xmpLat = parseXmpCoordinate(findXmpValue(packet, 'GPSLatitude'));
      const xmpLon = parseXmpCoordinate(findXmpValue(packet, 'GPSLongitude'));
      if (xmpLat !== null && xmpLon !== null) {
        lat = xmpLat;
        lon = xmpLon;
        break;
      }
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  const info: GpsInfo = { lat, lon };
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const altitude = number(gps.GPSAltitude);
  if (altitude !== undefined) info.altitude = gps.GPSAltitudeRef === 1 ? -altitude : altitude;
  info.accuracy = number(gps.GPSHPositioningError);
  info.direction = number(gps.GPSImgDirection);
  return info;
}

function hasZeroGps(parsed: Parsed): boolean {
  const gps = parsed.gps;
  return !!gps && gps.latitude === 0 && gps.longitude === 0;
}

function findXmpValue(packet: string, name: string): string | null {
  const attribute = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`).exec(packet);
  if (attribute) return attribute[1];
  const element = new RegExp(`<(?:\\w+:)?${name}>([^<]+)<`).exec(packet);
  return element ? element[1] : null;
}

export function parseXmpCoordinate(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?(?:,(\d+(?:\.\d+)?))?\s*([NSEW])\s*$/i.exec(value);
  if (!match) return null;
  const [, degrees, minutes = '0', seconds = '0', hemisphere] = match;
  const decimal = Number(degrees) + Number(minutes) / 60 + Number(seconds) / 3600;
  return /[SW]/i.test(hemisphere) ? -decimal : decimal;
}

function readTaken(parsed: Parsed): MetadataReport['taken'] {
  const candidates = ['DateTimeOriginal', 'CreateDate', 'DateCreated', 'ModifyDate'];
  let date: Date | null = null;
  let text = '';
  for (const key of candidates) {
    for (const block of Object.values(parsed)) {
      const value = block?.[key];
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        date = value;
        break;
      }
      if (typeof value === 'string' && value.trim() && !text) text = value.trim();
    }
    if (date) break;
  }
  if (!date && !text) return null;
  const exif = parsed.exif ?? {};
  const offset = [exif.OffsetTimeOriginal, exif.OffsetTime].find((value): value is string => typeof value === 'string');
  return { date, text: date ? formatDateTime(date) : clip(text, 80), offset };
}

function readOrientation(parsed: Parsed): number {
  const value = parsed.ifd0?.Orientation ?? parsed.tiff?.Orientation;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 8 ? number : 1;
}

async function readThumbnail(bytes: Uint8Array, container: ContainerReport): Promise<Uint8Array | null> {
  const sources = container.format === 'jpeg' || container.format === 'heic' ? [bytes] : container.exif;
  for (const source of sources) {
    try {
      const thumb = await exifr.thumbnail(source);
      if (thumb && thumb.length > 0) return new Uint8Array(thumb);
    } catch {
      // No readable thumbnail in this block.
    }
  }
  return null;
}

function stringify(key: string, value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : formatDateTime(value);
  if (typeof value === 'string') return value.replace(/\0/g, '').trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value instanceof Uint8Array || (Array.isArray(value) && key.startsWith('XP') && value.every((v) => typeof v === 'number'))) {
    const bytes = value instanceof Uint8Array ? value : Uint8Array.from(value as number[]);
    // Windows XP* tags are UTF-16LE text.
    if (key.startsWith('XP')) return new TextDecoder('utf-16le').decode(bytes).replace(/\0/g, '').trim();
    return isPrintable(bytes) ? decodeText(bytes).replace(/\0/g, '').trim() : '';
  }
  if (Array.isArray(value)) return value.map((item) => stringify(key, item)).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const leaves: string[] = [];
    collectStrings(value as Record<string, unknown>, leaves, 0);
    return leaves.join(' · ');
  }
  return '';
}

function collectStrings(value: Record<string, unknown>, out: string[], depth: number): void {
  if (depth > 4) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'parseType' || key === 'lang' || key === 'about') continue;
    if (typeof child === 'string') {
      // Skip namespace URIs that XMP parsers sometimes attach.
      if (!/^https?:\/\/ns\./.test(child) && !/^http:\/\/(purl|www\.w3)\.org/.test(child)) out.push(child.trim());
    } else if (typeof child === 'number') out.push(String(child));
    else if (child && typeof child === 'object') collectStrings(child as Record<string, unknown>, out, depth + 1);
  }
}

function isPrintable(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.length > 2000) return false;
  let printable = 0;
  for (const byte of bytes) if ((byte >= 0x20 && byte < 0x7f) || byte === 0x0a || byte === 0x0d || byte === 0) printable++;
  return printable / bytes.length > 0.9;
}

function humanize(key: string): string {
  const spaced = key
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
