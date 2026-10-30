// Re-reads a finished copy with the same readers used on the original, so the
// app can show that the hidden information is really gone.

import { readContainer } from './container';
import { readMetadata } from './metadata';

export interface Check {
  label: string;
  ok: boolean;
}

export interface Verification {
  checks: Check[];
  clean: boolean;
}

export async function verifyClean(bytes: Uint8Array): Promise<Verification> {
  const container = readContainer(bytes);
  const meta = await readMetadata(bytes, container);
  const checks: Check[] = [
    { label: 'No location or place names', ok: !meta.gps && meta.places.length === 0 },
    { label: 'No date or time', ok: !meta.taken },
    { label: 'No phone, camera, or software details', ok: meta.device.length === 0 && meta.identifiers.length === 0 },
    { label: 'No names, captions, or editing history', ok: meta.people.length + meta.notes.length + meta.history.length === 0 },
    { label: 'No hidden preview', ok: !meta.thumbnail && !container.jfifThumbnail },
    { label: 'No video or extra data after the picture', ok: (!container.trailing || container.trailing.kind === 'padding') && !container.motionPhoto },
    {
      label: 'No other metadata blocks',
      ok: container.xmp.length === 0 && !container.iptc && container.texts.length === 0 && container.compressedTexts.length === 0 && meta.technical.length === 0,
    },
  ];
  return { checks, clean: checks.every((check) => check.ok) };
}
