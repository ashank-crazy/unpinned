// Explains what a barcode or QR code in a picture gives away. Anyone can scan
// a code from a photo, so the content matters as much as visible text.

import { clip, formatCoordinate } from './format';
import type { Fact, Finding } from './types';

export type BarcodeDescription = Omit<Finding, 'id' | 'boxes'>;

export interface BoardingPass {
  name: string;
  bookingRef: string;
  from: string;
  to: string;
  carrier: string;
  flight: string;
  seat: string;
}

/** Reads the first leg of an IATA Bar Coded Boarding Pass (Resolution 792). */
export function parseBoardingPass(raw: string): BoardingPass | null {
  if (raw.length < 58 || raw[0] !== 'M' || !/[1-9]/.test(raw[1])) return null;
  const name = raw.slice(2, 22).trim();
  const bookingRef = raw.slice(23, 30).trim();
  const from = raw.slice(30, 33);
  const to = raw.slice(33, 36);
  const carrier = raw.slice(36, 39).trim();
  const flight = raw.slice(39, 44).trim().replace(/^0+(?=\d)/, '');
  const seat = raw.slice(48, 52).trim().replace(/^0+(?=\d)/, '');
  if (!name.includes('/') || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !/^[A-Z0-9]{5,7}$/.test(bookingRef)) return null;
  return { name, bookingRef, from, to, carrier, flight, seat };
}

export interface WifiNetwork {
  ssid: string;
  password: string;
  security: string;
}

/** Parses the "WIFI:T:WPA;S:name;P:password;;" format, including backslash escapes. */
export function parseWifi(raw: string): WifiNetwork | null {
  if (!/^WIFI:/i.test(raw)) return null;
  const fields: Record<string, string> = {};
  let key = '';
  let value = '';
  let readingKey = true;
  for (let i = 5; i < raw.length; i++) {
    const char = raw[i];
    if (char === '\\' && i + 1 < raw.length) {
      value += raw[++i];
    } else if (readingKey && char === ':') {
      readingKey = false;
    } else if (readingKey) {
      key += char;
    } else if (char === ';') {
      if (key) fields[key.toUpperCase()] = value;
      key = '';
      value = '';
      readingKey = true;
    } else {
      value += char;
    }
  }
  if (!fields.S) return null;
  return { ssid: fields.S, password: fields.P ?? '', security: fields.T ?? '' };
}

function contactFacts(raw: string): Fact[] {
  const facts: Fact[] = [];
  const pick = (label: string, re: RegExp) => {
    const match = re.exec(raw);
    if (match?.[1]?.trim()) facts.push({ label, value: clip(match[1].replace(/;/g, ' '), 80) });
  };
  pick('Name', /(?:^|\n)FN[^:\n]*:([^\n]+)/i);
  pick('Name', /MECARD:N:([^;]+)/i);
  pick('Phone', /(?:^|\n|;)TEL[^:\n]*:([^\n;]+)/i);
  pick('Email', /(?:^|\n|;)EMAIL[^:\n]*:([^\n;]+)/i);
  pick('Address', /(?:^|\n|;)ADR[^:\n]*:([^\n]+)/i);
  return facts;
}

/** True when a link carries a long code that looks personal, like a ticket or login token. */
export function hasPersonalToken(url: URL): boolean {
  const parts = [...url.pathname.split('/'), ...[...url.searchParams.values()]];
  return parts.some((part) => /[A-Za-z0-9_-]{16,}/.test(part) && /\d/.test(part));
}

export function describeBarcode(raw: string): BarcodeDescription {
  const value = raw.trim();

  const pass = parseBoardingPass(value);
  if (pass) {
    return {
      kind: 'barcode-boarding',
      severity: 'high',
      title: 'A boarding pass barcode',
      summary: `Anyone who scans it can read your name (${pass.name}), booking reference (${pass.bookingRef}), and flight (${pass.carrier} ${pass.flight}, ${pass.from} to ${pass.to}).`,
      why: "With your name and booking reference, someone may be able to look up, change, or cancel your trip on the airline's website.",
      facts: [
        { label: 'Name', value: pass.name },
        { label: 'Booking reference', value: pass.bookingRef },
        { label: 'Flight', value: `${pass.carrier} ${pass.flight}` },
        { label: 'Route', value: `${pass.from} to ${pass.to}` },
        ...(pass.seat ? [{ label: 'Seat', value: pass.seat }] : []),
      ],
    };
  }

  const wifi = parseWifi(value);
  if (wifi) {
    return {
      kind: 'barcode-wifi',
      severity: wifi.password ? 'high' : 'medium',
      title: wifi.password ? 'A Wi-Fi password in a QR code' : 'A Wi-Fi network in a QR code',
      summary: `Network “${clip(wifi.ssid, 40)}”.${wifi.password ? ' The code includes the password, so anyone who scans it can join.' : ''}`,
      why: 'People on your network may be able to see your other devices, and a network name can help someone find where you live.',
      facts: [
        { label: 'Network name', value: wifi.ssid },
        { label: 'Password included', value: wifi.password ? 'yes (not shown here)' : 'no' },
      ],
    };
  }

  if (/^otpauth(-migration)?:\/\//i.test(value)) {
    let label = '';
    try {
      const url = new URL(value);
      label = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || url.searchParams.get('issuer') || '';
    } catch {
      // Keep the generic wording.
    }
    return {
      kind: 'barcode-2fa',
      severity: 'high',
      title: 'A two-step login secret',
      summary: `This QR code holds the secret behind your login codes${label ? ` for “${clip(label, 50)}”` : ''}.`,
      why: 'Anyone who scans it can create your one-time login codes until you reset two-step login for that account.',
      facts: label ? [{ label: 'Account', value: label }] : [],
    };
  }

  const geo = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(value);
  if (geo) {
    return {
      kind: 'barcode-location',
      severity: 'high',
      title: 'A map location in a QR code',
      summary: `Points to ${formatCoordinate(Number(geo[1]), Number(geo[2]))}.`,
      why: 'Anyone who scans it can open this exact spot on a map.',
      facts: [{ label: 'Coordinates', value: formatCoordinate(Number(geo[1]), Number(geo[2])) }],
    };
  }

  if (/^(BEGIN:VCARD|MECARD:)/i.test(value) || /^(mailto|tel|sms|smsto):/i.test(value)) {
    const facts = contactFacts(value);
    const direct = /^(mailto|tel|sms|smsto):([^?]+)/i.exec(value);
    if (direct) facts.push({ label: /^mailto/i.test(direct[1]) ? 'Email' : 'Phone', value: clip(direct[2], 60) });
    return {
      kind: 'barcode-contact',
      severity: 'medium',
      title: 'Contact details in a code',
      summary: facts.length ? `Contains ${facts.map((fact) => fact.label.toLowerCase()).join(', ')}.` : 'Contains contact details.',
      why: 'Anyone who scans it gets these details, which can be used for spam, scams, or to find you.',
      facts,
    };
  }

  if (/^https?:\/\//i.test(value)) {
    let host = '';
    let personal = false;
    try {
      const url = new URL(value);
      host = url.hostname;
      personal = hasPersonalToken(url);
    } catch {
      host = clip(value, 40);
    }
    return {
      kind: 'barcode-link',
      severity: personal ? 'medium' : 'low',
      title: 'A QR code with a web link',
      summary: `Opens ${host}${personal ? ', with a long code in the link that may be personal' : ''}.`,
      why: 'Codes on tickets, receipts, and passes often link to your booking or account. Anyone can scan a code in a photo.',
      facts: [{ label: 'Link', value: clip(value, 120) }],
    };
  }

  if (/^1Z[0-9A-Z]{16}$/.test(value) || /^9[2-5]\d{20,26}$/.test(value) || /^420\d{5,9}9[2-5]\d{20,26}$/.test(value)) {
    return {
      kind: 'barcode-other',
      severity: 'medium',
      title: 'A shipping label barcode',
      summary: 'Contains a tracking number.',
      why: 'Tracking pages can show where a package is going. Shipping labels often show a name and address too.',
      facts: [{ label: 'Tracking number', value }],
    };
  }

  return {
    kind: 'barcode-other',
    severity: 'medium',
    title: 'A barcode anyone can read',
    summary: `Contains “${clip(value, 60)}”.`,
    why: 'Tickets, passes, and labels often hold personal details. It is safer to cover a code unless you know what it holds.',
    facts: [{ label: 'Contents', value: clip(value, 200) }],
  };
}
