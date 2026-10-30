// Turns what the file structure and metadata readers found into findings
// written for the person about to share the photo.

import type { ContainerReport } from './container';
import { clip, compassDirection, formatBytes, formatCoordinate, formatMeters, formatOffset, plural } from './format';
import type { MetadataReport } from './metadata';
import { describePlace, type NearestPlace } from './places';
import type { Fact, Finding, Severity } from './types';

/** How the embedded preview compares with the actual picture. */
export type ThumbnailCheck = 'different-crop' | 'different-content' | 'same' | 'unknown';

export interface HiddenInput {
  container: ContainerReport;
  meta: MetadataReport;
  place: NearestPlace | null;
  thumbnailCheck: ThumbnailCheck;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function sortFindings(findings: Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] || a.index - b.index)
    .map(({ finding }) => finding);
}

export function hiddenFindings({ container, meta, place, thumbnailCheck }: HiddenInput): Finding[] {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);

  if (meta.gps) {
    const { lat, lon, accuracy, altitude, direction } = meta.gps;
    const facts: Fact[] = [{ label: 'Coordinates', value: formatCoordinate(lat, lon) }];
    if (accuracy !== undefined) facts.push({ label: 'Accuracy', value: `about ${formatMeters(accuracy)}` });
    if (altitude !== undefined) facts.push({ label: 'Altitude', value: formatMeters(altitude) });
    if (direction !== undefined) facts.push({ label: 'Camera facing', value: `${compassDirection(direction)} (${Math.round(direction)}°)` });
    if (place) facts.push({ label: 'Nearest town (approximate)', value: [place.name, place.state, place.country].filter(Boolean).join(', ') });
    const precision =
      accuracy !== undefined
        ? `The position is accurate to about ${formatMeters(accuracy)}.`
        : 'Phones usually record this to within a few meters.';
    add({
      id: 'location',
      kind: 'location',
      severity: 'high',
      title: 'Where you took it',
      summary: `Taken ${place ? describePlace(place) : 'at an exact spot on the map'}. ${precision}`,
      why: 'Anyone who gets this file can put these numbers into a map app and see the exact spot. For a photo taken at home, that is your address.',
      facts,
    });
  }

  if (meta.places.length) {
    const specific = meta.places.some((fact) => /city|sub|location|state|province/i.test(fact.label));
    add({
      id: 'place-names',
      kind: 'place-names',
      severity: specific ? 'high' : 'medium',
      title: 'Place names written in the file',
      summary: clip(meta.places.map((fact) => fact.value).join(', '), 120),
      why: 'Photo and editing apps can save the name of the place. It can say where you live or spend time, even without GPS.',
      facts: meta.places,
    });
  }

  if (meta.taken) {
    const offset = meta.taken.offset ? formatOffset(meta.taken.offset) : '';
    const facts: Fact[] = [{ label: 'Taken', value: meta.taken.text }];
    if (offset) facts.push({ label: 'Time zone', value: `${offset}, which hints at the region you were in` });
    add({
      id: 'time',
      kind: 'time',
      severity: 'medium',
      title: 'When you took it',
      summary: offset ? `${meta.taken.text} (${offset}).` : `${meta.taken.text}.`,
      why: 'Dates and times can show your routine, like when you are usually home, or that you are away right now.',
      facts,
    });
  }

  if (meta.thumbnail || container.jfifThumbnail) {
    const different = thumbnailCheck === 'different-crop' || thumbnailCheck === 'different-content';
    add({
      id: 'thumbnail',
      kind: 'thumbnail',
      severity: different ? 'high' : 'low',
      title: different ? 'A hidden preview that shows more' : 'A hidden preview copy',
      summary:
        thumbnailCheck === 'different-crop'
          ? 'A small preview stored inside the file shows a wider view than your photo. It may include parts you cropped out.'
          : thumbnailCheck === 'different-content'
            ? 'A small preview stored inside the file does not match your photo. It may show the picture before you edited it.'
            : 'A small copy of this photo is stored inside the file.',
      why: different
        ? 'Some apps change the photo but not this preview, so the parts you cut out or covered can still be seen.'
        : 'It matches your photo now, but some editing apps never update it, so it can end up showing what you cropped or covered.',
      facts: meta.thumbnail ? [{ label: 'Preview size', value: formatBytes(meta.thumbnail.length) }] : [],
      preview: meta.thumbnail ?? undefined,
    });
  }

  const trailing = container.trailing;
  if (trailing?.kind === 'video' || container.motionPhoto) {
    add({
      id: 'video',
      kind: 'video',
      severity: 'high',
      title: 'A hidden video clip',
      summary:
        trailing?.kind === 'video'
          ? `This is a motion photo: about ${formatBytes(trailing.length)} of video is attached after the picture.`
          : 'This file is marked as a motion photo, which carries a short video clip.',
      why: 'Motion photos record a few seconds before and after the shot, sometimes with sound. People, voices, and places outside the frame can end up in it.',
      facts: trailing ? [{ label: 'Attached data', value: formatBytes(trailing.length) }] : [],
    });
  }
  if (trailing?.kind === 'leftover-image-data') {
    add({
      id: 'leftovers',
      kind: 'leftovers',
      severity: 'high',
      title: 'Leftover data from a bigger picture',
      summary: `${formatBytes(trailing.length)} of old picture data sits after the end of this image.`,
      why: 'Some editing tools saved a cropped picture over the old file without removing the rest. Tools exist that can rebuild the original from this leftover data, including the part you cropped off.',
      facts: [
        { label: 'Leftover data', value: formatBytes(trailing.length) },
        { label: 'Known causes', value: 'Google Pixel Markup and Windows Snipping Tool, fixed in 2023. Older screenshots can still carry it.' },
      ],
    });
  } else if (trailing?.kind === 'image' && !container.motionPhoto) {
    add({
      id: 'extra-images',
      kind: 'extra-images',
      severity: 'low',
      title: 'Extra pictures inside the file',
      summary: `${plural(Math.max(1, container.extraImages), 'extra picture')} (${formatBytes(trailing.length)}) stored after the main one.`,
      why: 'Phones often save depth or HDR brightness data this way. It is rarely private, but it can carry its own hidden details.',
      facts: [{ label: 'Extra data', value: formatBytes(trailing.length) }],
    });
  } else if (trailing?.kind === 'unknown') {
    add({
      id: 'extra-data',
      kind: 'extra-data',
      severity: 'medium',
      title: 'Extra data after the picture',
      summary: `${formatBytes(trailing.length)} of data we can't identify comes after the end of the picture.`,
      why: 'It is not needed to show the picture, and it could hold anything, so it is safer to remove it.',
      facts: [{ label: 'Extra data', value: formatBytes(trailing.length) }],
    });
  }

  if (meta.people.length) {
    add({
      id: 'people',
      kind: 'people',
      severity: 'medium',
      title: 'Names saved in the file',
      summary: clip(unique(meta.people.map((fact) => fact.value)).join(', '), 120),
      why: 'Cameras and editing apps can save an owner, author, or copyright name. A stranger could use it to find you.',
      facts: meta.people,
    });
  }

  if (meta.identifiers.length) {
    add({
      id: 'identifiers',
      kind: 'identifiers',
      severity: 'medium',
      title: 'Serial numbers and photo IDs',
      summary: `${unique(meta.identifiers.map((fact) => lowerFirst(fact.label))).join(', ')}.`.replace(/^./, (c) => c.toUpperCase()),
      why: 'These numbers can tie different photos back to the same camera or file, even after you rename them.',
      facts: meta.identifiers,
    });
  }

  if (meta.notes.length) {
    add({
      id: 'notes',
      kind: 'notes',
      severity: 'medium',
      title: 'Captions, comments, and notes',
      summary: meta.aiSettings
        ? 'Includes the AI prompt and settings used to make this image.'
        : `“${clip(meta.notes[0].value, 90)}”${meta.notes.length > 1 ? ` and ${plural(meta.notes.length - 1, 'more note')}` : ''}.`,
      why: 'Text tucked into the file travels with it, and it can say more than you meant to share.',
      facts: meta.notes,
    });
  }

  if (meta.history.length) {
    const user = findUserName(meta.history);
    add({
      id: 'history',
      kind: 'history',
      severity: user ? 'medium' : 'low',
      title: 'Editing history and file names',
      summary: user
        ? `Includes a folder path with a computer user name: “${user}”.`
        : `Shows how the file was made: ${clip(meta.history[0].value, 80)}.`,
      why: 'Editing apps can record the software you used and original file names and folders, which can include your name or user name.',
      facts: meta.history,
    });
  }

  if (meta.device.length) {
    const hardware = meta.device.some((fact) => fact.label !== 'Software');
    add({
      id: 'device',
      kind: 'device',
      severity: 'low',
      title: hardware ? 'Your phone or camera' : 'The app that saved it',
      summary: `${describeDevice(meta.device)}.`.replace(/^./, (c) => c.toUpperCase()),
      why: hardware
        ? 'Device details can link photos to the same person, and a software version hints at what your phone or computer runs.'
        : 'The app name and version hint at what your phone or computer runs, and can link pictures to the same person.',
      facts: meta.device,
    });
  }

  if (meta.technical.length) {
    add({
      id: 'technical',
      kind: 'technical',
      severity: 'low',
      title: 'Camera settings and other details',
      summary: `${plural(meta.technical.length, 'technical detail')}, like ${meta.technical
        .slice(0, 3)
        .map((fact) => lowerFirst(fact.label))
        .join(', ')}.`,
      why: 'Mostly harmless. They are removed too, so the copy carries nothing extra.',
      facts: meta.technical,
    });
  }

  return sortFindings(findings);
}

/** "Unique photo ID" becomes "unique photo ID", keeping abbreviations intact. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function describeDevice(device: Fact[]): string {
  const get = (label: string) => device.find((fact) => fact.label === label)?.value ?? '';
  const make = get('Maker');
  const model = get('Model');
  const name = model && make && model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(' ');
  const parts = [name, get('Software') ? `software ${get('Software')}` : '', get('Device')].filter(Boolean);
  return clip(parts.length ? parts.join(', ') : device.map((fact) => fact.value).join(', '), 120);
}

/** Finds a user name inside a folder path such as C:\Users\alex\... or /Users/alex/... */
export function findUserName(facts: Fact[]): string | null {
  for (const fact of facts) {
    const match = /(?:[A-Za-z]:\\(?:Users|Documents and Settings)\\|\/(?:Users|home)\/)([^\\/:*?"<>|\s]+)/i.exec(fact.value);
    if (match && !/^(public|shared|default)$/i.test(match[1])) return match[1];
  }
  return null;
}
