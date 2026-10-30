// Small helpers for reading binary image containers. Every reader checks its
// bounds, because files people drop in can be truncated or malformed.

export function u16be(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) return 0;
  return (bytes[offset] << 8) | bytes[offset + 1];
}

export function u16le(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) return 0;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function u32be(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

export function u32le(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/** Reads bytes as Latin-1, one character per byte. Safe for ASCII tags. */
export function latin1(bytes: Uint8Array, start = 0, length = bytes.length - start): string {
  const end = Math.min(bytes.length, start + length);
  let out = '';
  for (let i = Math.max(0, start); i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function startsWithAscii(bytes: Uint8Array, text: string, offset = 0): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

export function indexOfAscii(bytes: Uint8Array, text: string, from = 0): number {
  const first = text.charCodeAt(0);
  const last = bytes.length - text.length;
  for (let i = Math.max(0, from); i <= last; i++) {
    if (bytes[i] === first && startsWithAscii(bytes, text, i)) return i;
  }
  return -1;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Text stored in files is usually UTF-8 but sometimes Latin-1; prefer UTF-8 when it decodes cleanly. */
export function decodeText(bytes: Uint8Array): string {
  const strict = new TextDecoder('utf-8', { fatal: true });
  try {
    return strict.decode(bytes);
  } catch {
    return latin1(bytes);
  }
}
