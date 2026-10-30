import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { indexOfAscii } from '../src/lib/bytes';
import { readContainer, sniffFormat, walkJpeg } from '../src/lib/container';
import { findUserName, hiddenFindings } from '../src/lib/hidden';
import { parseXmpCoordinate, readMetadata } from '../src/lib/metadata';
import { describePlace, nearestIn, parsePlaces } from '../src/lib/places';
import { CleanError, stripJpeg, stripLossless, stripPng, stripWebp } from '../src/lib/strip';
import { verifyClean } from '../src/lib/verify';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const places = parsePlaces(readFileSync(join(__dirname, '..', 'src', 'data', 'places.txt'), 'utf8'));

async function inspect(name: string) {
  const bytes = fixture(name);
  const container = readContainer(bytes);
  const meta = await readMetadata(bytes, container);
  return { bytes, container, meta };
}

describe('reading the file structure', () => {
  it('recognizes formats by their bytes, not their names', () => {
    expect(sniffFormat(fixture('desk-for-sale.jpg'))).toBe('jpeg');
    expect(sniffFormat(fixture('order-receipt.png'))).toBe('png');
    expect(sniffFormat(fixture('exif.webp'))).toBe('webp');
    expect(sniffFormat(fixture('not-an-image.jpg'))).toBe('unknown');
  });

  it('finds EXIF in a phone photo and nothing after the picture', () => {
    const report = readContainer(fixture('desk-for-sale.jpg'));
    expect(report.exif).toHaveLength(1);
    expect(report.trailing).toBeNull();
    expect(report.truncated).toBe(false);
  });

  it('spots leftover data from a cropped screenshot (aCropalypse-style)', () => {
    const bytes = fixture('order-receipt.png');
    const report = readContainer(bytes);
    expect(report.trailing?.kind).toBe('leftover-image-data');
    expect(report.trailing!.offset + report.trailing!.length).toBe(bytes.length);
    expect(report.texts).toContainEqual({ source: 'PNG text', key: 'Software', value: 'SampleShot 2.1' });
  });

  it('spots the video attached to a motion photo', () => {
    const report = readContainer(fixture('motion-photo.jpg'));
    expect(report.motionPhoto).toBe(true);
    expect(report.trailing?.kind).toBe('video');
  });

  it('finds XMP, IPTC and comments', () => {
    const report = readContainer(fixture('xmp-iptc.jpg'));
    expect(report.xmp).toHaveLength(1);
    expect(report.iptc).toBe(true);
    expect(report.texts[0].value).toBe('Taken from the balcony at home');
  });

  it('reads EXIF and XMP chunks in WebP', () => {
    const report = readContainer(fixture('exif.webp'));
    expect(report.exif).toHaveLength(1);
    expect(report.xmp).toHaveLength(1);
  });

  it('copes with truncated and fake files without throwing', () => {
    expect(readContainer(fixture('truncated.jpg')).truncated).toBe(true);
    expect(readContainer(fixture('not-an-image.jpg')).format).toBe('unknown');
    expect(readContainer(new Uint8Array(0)).format).toBe('unknown');
  });
});

describe('reading hidden information', () => {
  it('reads location, time, device, and the hidden preview from a phone photo', async () => {
    const { meta } = await inspect('desk-for-sale.jpg');
    expect(meta.gps?.lat).toBeCloseTo(41.8827, 4);
    expect(meta.gps?.lon).toBeCloseTo(-87.6233, 4);
    expect(meta.gps?.accuracy).toBe(4.7);
    expect(meta.gps?.direction).toBe(312.5);
    expect(meta.taken?.offset).toBe('-05:00');
    expect(meta.taken?.text).toContain('October 26, 2026');
    expect(meta.device.map((fact) => fact.value)).toEqual(expect.arrayContaining(['Sample', 'Demo Phone 7', 'DemoOS 26.1']));
    expect(meta.identifiers[0].label).toBe('Unique photo ID');
    expect(meta.thumbnail?.length).toBeGreaterThan(1000);
  });

  it('reads names, places, captions and folder paths from XMP and IPTC', async () => {
    const { meta } = await inspect('xmp-iptc.jpg');
    expect(meta.people.map((fact) => fact.value)).toContain('Alex Sample');
    expect(meta.places.map((fact) => fact.value)).toEqual(expect.arrayContaining(['Sampleville', 'United States']));
    expect(meta.notes.map((fact) => fact.value)).toEqual(expect.arrayContaining(['View from our balcony', 'Taken from the balcony at home']));
    expect(findUserName(meta.history)).toBe('alexs');
  });

  it('reads orientation and serial numbers', async () => {
    const { meta } = await inspect('orientation-6.jpg');
    expect(meta.orientation).toBe(6);
    expect(meta.identifiers.map((fact) => fact.value)).toContain('SN-0000-1234');
  });

  it('reads GPS from a WebP', async () => {
    const { meta } = await inspect('exif.webp');
    expect(meta.gps?.lat).toBeCloseTo(-33.8568, 4);
    expect(meta.gps?.lon).toBeCloseTo(151.2153, 4);
  });

  it('parses XMP-style coordinates', () => {
    expect(parseXmpCoordinate('41,52.962N')).toBeCloseTo(41.8827, 4);
    expect(parseXmpCoordinate('87,37,23.88W')).toBeCloseTo(-87.6233, 4);
    expect(parseXmpCoordinate('nonsense')).toBeNull();
  });

  it('finds nothing in a plain file', async () => {
    const { meta, container } = await inspect('plain.png');
    expect(hiddenFindings({ container, meta, place: null, thumbnailCheck: 'unknown' })).toEqual([]);
  });
});

describe('explaining what was found', () => {
  it('puts the most serious findings first and names the nearest town', async () => {
    const { container, meta } = await inspect('desk-for-sale.jpg');
    const place = nearestIn(places, meta.gps!.lat, meta.gps!.lon);
    const findings = hiddenFindings({ container, meta, place, thumbnailCheck: 'different-crop' });
    expect(findings.map((finding) => finding.kind)).toEqual(['location', 'thumbnail', 'time', 'identifiers', 'device', 'technical']);
    expect(findings[0].summary).toContain('Chicago, IL, United States');
    expect(findings[0].summary).toContain('4.7 m');
    expect(findings[1].severity).toBe('high');
    expect(findings[1].preview).toBeDefined();
  });

  it('explains leftovers and motion-photo video', async () => {
    const receipt = await inspect('order-receipt.png');
    const receiptKinds = hiddenFindings({ ...receipt, place: null, thumbnailCheck: 'unknown' }).map((finding) => finding.kind);
    expect(receiptKinds).toContain('leftovers');
    const motion = await inspect('motion-photo.jpg');
    expect(hiddenFindings({ ...motion, place: null, thumbnailCheck: 'unknown' })[0].kind).toBe('video');
  });
});

describe('naming places offline', () => {
  it('names the town for well-known spots', () => {
    expect(describePlace(nearestIn(places, 41.8827, -87.6233)!)).toBe('in or near Chicago, IL, United States');
    expect(nearestIn(places, 51.5079, -0.0877)!.country).toBe('United Kingdom');
    expect(nearestIn(places, -33.8568, 151.2153)!.name).toBe('Sydney');
  });

  it('is honest when a spot is far from any town', () => {
    expect(describePlace(nearestIn(places, 30, -40)!)).toMatch(/^far from large towns/);
  });
});

describe('making a clean copy without re-compressing', () => {
  it('removes everything hidden from a JPEG and keeps the picture data byte-for-byte', async () => {
    const original = fixture('desk-for-sale.jpg');
    const clean = stripJpeg(original, 1);
    const verification = await verifyClean(clean);
    expect(verification.checks.filter((check) => !check.ok)).toEqual([]);
    // Everything from the quantization tables to the end of the image is unchanged.
    const dqtOriginal = findMarker(original, 0xdb);
    const dqtClean = findMarker(clean, 0xdb);
    expect(Buffer.from(clean.subarray(dqtClean)).equals(Buffer.from(original.subarray(dqtOriginal)))).toBe(true);
    expect(clean.length).toBeLessThan(original.length);
  });

  it('keeps the orientation so the copy is not sideways, and nothing else', async () => {
    const clean = stripJpeg(fixture('orientation-6.jpg'), 6);
    const container = readContainer(clean);
    const meta = await readMetadata(clean, container);
    expect(meta.orientation).toBe(6);
    expect(meta.gps).toBeNull();
    expect(meta.identifiers).toEqual([]);
    expect((await verifyClean(clean)).clean).toBe(true);
  });

  it('drops motion-photo video, XMP, IPTC and comments', async () => {
    for (const name of ['motion-photo.jpg', 'xmp-iptc.jpg']) {
      const clean = stripJpeg(fixture(name));
      expect((await verifyClean(clean)).clean).toBe(true);
    }
  });

  it('drops PNG text and leftover data but keeps the image chunks', async () => {
    const original = fixture('order-receipt.png');
    const clean = stripPng(original);
    expect((await verifyClean(clean)).clean).toBe(true);
    expect(indexOfAscii(clean, 'Software')).toBe(-1);
    // The compressed pixel data is copied unchanged.
    const idat = (bytes: Uint8Array) => {
      const at = indexOfAscii(bytes, 'IDAT') - 4;
      const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(at);
      return Buffer.from(bytes.subarray(at, at + length + 12));
    };
    expect(idat(clean).equals(idat(original))).toBe(true);
  });

  it('drops WebP EXIF and XMP and fixes the header', async () => {
    const clean = stripWebp(fixture('exif.webp'));
    expect((await verifyClean(clean)).clean).toBe(true);
    expect(new DataView(clean.buffer, clean.byteOffset).getUint32(4, true)).toBe(clean.length - 8);
    const vp8x = indexOfAscii(clean, 'VP8X');
    if (vp8x >= 0) expect(clean[vp8x + 8] & 0x0c).toBe(0);
  });

  it('refuses to guess with a truncated file', () => {
    expect(() => stripJpeg(fixture('truncated.jpg'))).toThrow(CleanError);
    expect(stripLossless(fixture('not-an-image.jpg'), 'unknown', 1)).toBeNull();
  });

  it('reports that an untouched original is not clean', async () => {
    const verification = await verifyClean(fixture('desk-for-sale.jpg'));
    expect(verification.clean).toBe(false);
    expect(verification.checks.find((check) => check.label.startsWith('No location'))?.ok).toBe(false);
  });
});

/** Offset of the first top-level segment with this marker (skipping JPEGs nested inside EXIF). */
function findMarker(bytes: Uint8Array, marker: number): number {
  let found = -1;
  walkJpeg(bytes, (segmentMarker, start) => {
    if (found < 0 && segmentMarker === marker) found = start;
  });
  return found;
}
