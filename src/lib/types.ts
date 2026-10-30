export type Severity = 'high' | 'medium' | 'low';

/** A rectangle in the displayed (correctly rotated) image, in pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Fact {
  label: string;
  value: string;
}

export type HiddenKind =
  | 'location'
  | 'place-names'
  | 'time'
  | 'device'
  | 'identifiers'
  | 'people'
  | 'notes'
  | 'history'
  | 'thumbnail'
  | 'video'
  | 'leftovers'
  | 'extra-images'
  | 'extra-data'
  | 'technical';

export type VisibleKind =
  | 'address'
  | 'email'
  | 'phone'
  | 'card'
  | 'ssn'
  | 'iban'
  | 'name'
  | 'reference'
  | 'account'
  | 'birthdate'
  | 'barcode-boarding'
  | 'barcode-wifi'
  | 'barcode-2fa'
  | 'barcode-location'
  | 'barcode-link'
  | 'barcode-contact'
  | 'barcode-other';

export interface Finding {
  id: string;
  kind: HiddenKind | VisibleKind;
  severity: Severity;
  /** Short plain-language name, e.g. "Where you took it". */
  title: string;
  /** What we found, in one sentence. */
  summary: string;
  /** Why it matters to the person sharing the photo. */
  why: string;
  /** The raw values, shown on request. */
  facts: Fact[];
  /** Where the item appears in the picture (visible findings only). */
  boxes?: Box[];
  /** True when the text reader wasn't confident it read this correctly. */
  unsure?: boolean;
  /** JPEG bytes of a hidden preview image, so people can see it for themselves. */
  preview?: Uint8Array;
}
