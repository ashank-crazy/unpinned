// Finds personal details in text read from a picture: addresses, contact
// details, card numbers, booking references, and names next to labels.
// It works line by line so each match can be mapped back to a spot in the image.

import type { Severity, VisibleKind } from './types';

export interface TextMatch {
  kind: VisibleKind;
  severity: Severity;
  line: number;
  start: number;
  end: number;
  value: string;
}

type LineMatch = Omit<TextMatch, 'line'>;

const STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|PR|GU|VI';
const PROVINCES = 'AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT';
const STREET_SUFFIX =
  'street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|terrace|ter|circle|cir|parkway|pkwy|highway|hwy|square|sq|trail|trl|crescent|cres|close|grove|row|loop|alley|plaza|walk';

const PATTERNS: { kind: VisibleKind; severity: Severity; re: RegExp; group?: number; check?: (value: string, match: RegExpExecArray) => boolean }[] = [
  { kind: 'ssn', severity: 'high', re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
  // Card numbers in their usual groupings, confirmed with the Luhn checksum.
  { kind: 'card', severity: 'high', re: /\b\d{4}([ -]?)\d{4}\1\d{4}\1\d{1,7}\b/g, check: (value) => isCardNumber(value) },
  { kind: 'card', severity: 'high', re: /\b3[47]\d{2}([ -]?)\d{6}\1\d{5}\b/g, check: (value) => isCardNumber(value) },
  { kind: 'iban', severity: 'high', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, check: (value) => isIban(value) },
  { kind: 'email', severity: 'medium', re: /[A-Z0-9._%+-]+ ?@ ?[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,24}\b/gi },
  {
    kind: 'address',
    severity: 'high',
    re: new RegExp(
      `\\b\\d{1,6}[A-Za-z]?(?:-\\d{1,4})?\\s+(?:[NSEW]\\.?\\s+)?(?:[A-Za-z0-9'’.-]+\\s+){0,4}?(?:${STREET_SUFFIX})\\b\\.?(?:,?\\s*(?:apt|apartment|unit|suite|ste|fl|floor|#)\\.?\\s*#?[A-Za-z0-9-]+)?`,
      'gi',
    ),
  },
  { kind: 'address', severity: 'high', re: /\bP\.? ?O\.? ?Box\s+\d+\b/gi },
  { kind: 'address', severity: 'medium', re: new RegExp(`\\b[A-Za-z][A-Za-z .'’-]{1,30},\\s*(?:${STATES})\\s+\\d{5}(?:-\\d{4})?\\b`, 'g') },
  { kind: 'address', severity: 'medium', re: new RegExp(`\\b[A-Za-z][A-Za-z .'’-]{1,30},?\\s+(?:${PROVINCES})\\s+[A-Z]\\d[A-Z] ?\\d[A-Z]\\d\\b`, 'g') },
  { kind: 'address', severity: 'medium', re: /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/g },
  // Phone numbers need a separator before the last digits, so long order numbers don't match.
  { kind: 'phone', severity: 'medium', re: /(?:\+1[ .-]?)?(?:\(\d{3}\) ?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/g },
  { kind: 'phone', severity: 'medium', re: /\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?){2,5}\b/g, check: (value) => digitCount(value) >= 8 && digitCount(value) <= 15 },
  {
    kind: 'birthdate',
    severity: 'medium',
    re: /\b(?:DOB|D\.O\.B\.?|date of birth|birth ?date|born)\s*[:-]?\s*((?:\d{1,2}[/.\- ]\d{1,2}[/.\- ]\d{2,4})|(?:[A-Za-z]{3,9}\.? \d{1,2},? \d{4})|(?:\d{1,2} [A-Za-z]{3,9}\.? \d{4}))/gi,
    group: 1,
  },
  {
    kind: 'reference',
    severity: 'medium',
    re: /\b(booking(?: reference| ref| code| number)?|confirmation(?: number| code| no\.?)?|reservation(?: number| code)?|record locator|pnr|order(?: number| no\.?| id)?|e-?ticket(?: number| no\.?)?|ticket(?: number| no\.?)?|tracking(?: number| no\.?)?|reference(?: number| no\.?)?|invoice(?: number| no\.?)?|claim(?: number)?|case(?: number)?)\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]*(?: [A-Z0-9-]*\d[A-Z0-9-]*){0,3})/gi,
    group: 2,
    check: (value, match) => isIdentifier(value, /booking|confirmation|reservation|record locator|pnr/i.test(match[1])),
  },
  {
    kind: 'account',
    severity: 'medium',
    re: /\b(account(?: number| no\.?| #)?|acct\.?(?: no\.?| #)?|member(?:ship)?(?: number| no\.?| id)?|customer (?:number|no\.?|id)|policy(?: number| no\.?)?|frequent flyer(?: number| no\.?)?|loyalty(?: number| no\.?)?|rewards(?: number| no\.?)?|patient id|student id|employee id|passport(?: number| no\.?)?|licen[cs]e(?: number| no\.?)|routing(?: number)?)\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]*(?: [A-Z0-9-]*\d[A-Z0-9-]*){0,3})/gi,
    group: 2,
    check: (value) => isIdentifier(value, false),
  },
  {
    kind: 'name',
    severity: 'medium',
    re: /\b(?:name|passenger|recipient|ship to|deliver to|bill to|sold to|attn|attention|guest|patient|traveler|traveller|cardholder|account holder)\s*[:-]\s*([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){0,3})/gi,
    group: 1,
    check: (value) => value.split(/\s+/).every((word) => /^[A-Z]/.test(word)),
  },
  // Airline style "SURNAME/GIVEN".
  { kind: 'name', severity: 'medium', re: /\b[A-Z]{2,}\/[A-Z]{2,}(?: ?(?:MR|MRS|MS|MSTR|MISS|DR))?\b/g },
];

const LABEL_LINES: { kind: VisibleKind; re: RegExp; accepts: (line: string) => boolean }[] = [
  {
    kind: 'name',
    re: /^(?:passenger|name|full name|recipient|ship(?:ping)? to|deliver(?:y)? to|bill(?:ing)? to|sold to|guest|travell?er|cardholder|account holder)\s*:?$/i,
    accepts: looksLikeName,
  },
  {
    kind: 'reference',
    re: /^(?:booking(?: reference| ref| code| number)?|confirmation(?: number| code)?|reservation(?: number| code)?|record locator|pnr|order(?: number| no\.?)|e-?ticket(?: number)?|ticket(?: number| no\.?)|tracking(?: number| no\.?)?|reference(?: number)?)\s*:?$/i,
    accepts: (line) => isIdentifier(line, true),
  },
  {
    kind: 'account',
    re: /^(?:account(?: number| no\.?)?|acct\.?(?: no\.?)?|member(?:ship)?(?: number| no\.?| id)?|frequent flyer(?: number| no\.?)?|loyalty(?: number)?|rewards(?: number)?|policy(?: number)?|customer (?:number|id)|patient id|student id|passport(?: number)?)\s*:?$/i,
    accepts: (line) => isIdentifier(line, false),
  },
  {
    kind: 'birthdate',
    re: /^(?:date of birth|dob|birth ?date|born)\s*:?$/i,
    accepts: (line) => /^(?:\d{1,2}[/.\- ]\d{1,2}[/.\- ]\d{2,4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9}\.? \d{4})$/.test(line),
  },
];

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export function findInLine(text: string): LineMatch[] {
  const found: LineMatch[] = [];
  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.re.exec(text))) {
      if (match[0].length === 0) {
        pattern.re.lastIndex++;
        continue;
      }
      const value = pattern.group ? match[pattern.group] : match[0];
      if (!value || (pattern.check && !pattern.check(value, match))) continue;
      const start = pattern.group ? match.index + match[0].lastIndexOf(value) : match.index;
      found.push({ kind: pattern.kind, severity: pattern.severity, start, end: start + value.length, value: value.trim() });
    }
  }
  return removeOverlaps(found);
}

export function findInLines(lines: string[]): TextMatch[] {
  const matches: TextMatch[] = lines.flatMap((text, line) => findInLine(text).map((match) => ({ ...match, line })));
  const covered = (line: number) => matches.some((match) => match.line === line);

  lines.forEach((text, line) => {
    const label = text.trim();
    const rule = LABEL_LINES.find((candidate) => candidate.re.test(label));
    if (!rule) return;
    const next = nextLine(lines, line);
    if (next === null || covered(next)) return;
    const value = lines[next].trim();
    if (rule.accepts(value)) matches.push(wholeLine(lines, next, rule.kind, 'medium'));
  });

  // A street line followed by a city line is one full address; a name just above it is the addressee.
  for (const street of matches.filter((match) => match.kind === 'address' && match.severity === 'high')) {
    const below = nextLine(lines, street.line);
    if (below !== null) for (const match of matches) if (match.line === below && match.kind === 'address') match.severity = 'high';
    const above = previousLine(lines, street.line);
    if (above !== null && !covered(above) && looksLikeName(lines[above].trim())) {
      matches.push(wholeLine(lines, above, 'name', 'medium'));
    }
  }

  return matches.sort((a, b) => a.line - b.line || a.start - b.start);
}

function wholeLine(lines: string[], line: number, kind: VisibleKind, severity: Severity): TextMatch {
  const text = lines[line];
  const start = text.length - text.trimStart().length;
  const value = text.trim();
  return { kind, severity, line, start, end: start + value.length, value };
}

function nextLine(lines: string[], from: number): number | null {
  for (let i = from + 1; i < lines.length; i++) if (lines[i].trim()) return i;
  return null;
}

function previousLine(lines: string[], from: number): number | null {
  for (let i = from - 1; i >= 0; i--) if (lines[i].trim()) return i;
  return null;
}

function removeOverlaps(found: LineMatch[]): LineMatch[] {
  const ranked = [...found].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const kept: LineMatch[] = [];
  for (const candidate of ranked) {
    if (!kept.some((other) => candidate.start < other.end && other.start < candidate.end)) kept.push(candidate);
  }
  return kept.sort((a, b) => a.start - b.start);
}

const NOT_NAMES = /^(order|total|shipping|contact|payment|subtotal|thanks|thank|track|package|boarding|pass|flight|seat|gate|date|guest|wi-?fi|scan|join|confirmed|arriving|delivered)$/i;

export function looksLikeName(line: string): boolean {
  if (line.length < 4 || line.length > 40) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Z][A-Za-z'’.-]*$/.test(word) && !NOT_NAMES.test(word));
}

function isIdentifier(value: string, allowLettersOnly: boolean): boolean {
  const compact = value.replace(/[\s-]/g, '');
  if (compact.length < 4 || compact.length > 30 || !/^[A-Z0-9]+$/i.test(compact)) return false;
  if (/\d/.test(compact)) return true;
  // Airline booking codes can be letters only, e.g. "QWERTY".
  return allowLettersOnly && /^[A-Z]{5,8}$/.test(compact);
}

function digitCount(value: string): number {
  return value.replace(/\D/g, '').length;
}

export function isCardNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function isIban(value: string): boolean {
  const compact = value.replace(/\s/g, '').toUpperCase();
  if (compact.length < 15 || compact.length > 34) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
