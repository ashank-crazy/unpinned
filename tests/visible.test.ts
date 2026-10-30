import { describe, expect, it } from 'vitest';
import { dropStrays, trimDropped } from '../src/lib/inspect';
import { describeBarcode, hasPersonalToken, parseBoardingPass, parseWifi } from '../src/lib/barcode-text';
import { findInLine, findInLines, isCardNumber, isIban, looksLikeName } from '../src/lib/sensitive-text';

const kinds = (lines: string[]) => findInLines(lines).map((match) => `${match.kind}:${match.value}`);

describe('finding personal details in text', () => {
  it('finds everything on the sample order screenshot', () => {
    const lines = [
      'Order confirmed',
      'Thanks for your order, Alex!',
      'Order #114-2938471-5520183',
      'Ship to',
      'Alex Sample',
      '42 Example Lane, Apt 3',
      'Sampleville, CA 90000',
      'Contact',
      'alex.sample@example.com',
      '(312) 555-0142',
    ];
    expect(kinds(lines)).toEqual([
      'reference:114-2938471-5520183',
      'name:Alex Sample',
      'address:42 Example Lane, Apt 3',
      'address:Sampleville, CA 90000',
      'email:alex.sample@example.com',
      'phone:(312) 555-0142',
    ]);
    // The city line belongs to a full street address, so it is as serious as the street line.
    expect(findInLines(lines).find((match) => match.value.startsWith('Sampleville'))?.severity).toBe('high');
  });

  it('reads labels that sit on the line above their value, like on a boarding pass', () => {
    const lines = ['Passenger', 'ALEX SAMPLE', 'Flight', 'XX 123', 'Seat', '14C', 'Booking reference', 'ZX7Q4P', 'Frequent flyer', 'XX 4417229018'];
    expect(kinds(lines)).toEqual(['name:ALEX SAMPLE', 'reference:ZX7Q4P', 'account:XX 4417229018']);
  });

  it('finds an address label on an envelope', () => {
    expect(kinds(['ALEX SAMPLE', '42 EXAMPLE LANE, APT 3', 'SAMPLEVILLE, CA 90000'])).toEqual([
      'name:ALEX SAMPLE',
      'address:42 EXAMPLE LANE, APT 3',
      'address:SAMPLEVILLE, CA 90000',
    ]);
  });

  it('covers only the value next to a label', () => {
    const [match] = findInLine('Booking reference: ZX7Q4P');
    expect(match.value).toBe('ZX7Q4P');
    expect('Booking reference: ZX7Q4P'.slice(match.start, match.end)).toBe('ZX7Q4P');
  });

  it('checks card numbers and IBANs with their checksums', () => {
    expect(isCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(isCardNumber('4111 1111 1111 1112')).toBe(false);
    expect(findInLine('Card number 4111 1111 1111 1111')[0].kind).toBe('card');
    expect(findInLine('Card number 4111 1111 1111 1112')).toEqual([]);
    expect(isIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(isIban('GB82 WEST 1234 5698 7654 33')).toBe(false);
  });

  it('finds other common details', () => {
    expect(findInLine('SSN 123-45-6789')[0].kind).toBe('ssn');
    expect(findInLine('DOB: 04/12/1990')[0]).toMatchObject({ kind: 'birthdate', value: '04/12/1990' });
    expect(findInLine('Call +44 20 7946 0958 today')[0].kind).toBe('phone');
    expect(findInLine('PO Box 1234')[0].kind).toBe('address');
    expect(findInLine('London SW1A 1AA')[0].kind).toBe('address');
    expect(findInLine('Passenger: Jordan Lee')[0]).toMatchObject({ kind: 'name', value: 'Jordan Lee' });
    expect(findInLine('DOE/JANE MS')[0].kind).toBe('name');
  });

  it('stays quiet on ordinary text', () => {
    const ordinary = [
      'Total paid $38.99',
      'Gate closes 20 minutes before departure',
      "We'll text you when it's on the way.",
      'Arriving Thursday',
      'Order confirmed',
      'Desk lamp, brass',
      'Flight XX 123',
      'Meet at 10:30 on 28 Oct 2026',
      'Guest Wi-Fi',
      'Scan to join',
    ];
    expect(findInLines(ordinary)).toEqual([]);
  });

  it('recognizes name-like lines without catching headings', () => {
    expect(looksLikeName('Alex Sample')).toBe(true);
    expect(looksLikeName('ALEX SAMPLE')).toBe(true);
    expect(looksLikeName('Order Confirmed')).toBe(false);
    expect(looksLikeName('Guest Wi-Fi')).toBe(false);
  });
});

describe('explaining barcodes', () => {
  const bcbp = 'M1SAMPLE/ALEX         EZX7Q4P SFOJFKXX 0123 301Y014C0042 100';

  it('reads a boarding pass barcode', () => {
    expect(parseBoardingPass(bcbp)).toEqual({
      name: 'SAMPLE/ALEX',
      bookingRef: 'ZX7Q4P',
      from: 'SFO',
      to: 'JFK',
      carrier: 'XX',
      flight: '123',
      seat: '14C',
    });
    const description = describeBarcode(bcbp);
    expect(description.severity).toBe('high');
    expect(description.summary).toContain('ZX7Q4P');
  });

  it('reads Wi-Fi codes, including escaped characters', () => {
    expect(parseWifi('WIFI:T:WPA;S:SampleHome-5G;P:maple-otter-42;;')).toEqual({ ssid: 'SampleHome-5G', password: 'maple-otter-42', security: 'WPA' });
    expect(parseWifi('WIFI:S:My\\;Net;P:pa\\:ss;;')).toEqual({ ssid: 'My;Net', password: 'pa:ss', security: '' });
    const description = describeBarcode('WIFI:T:WPA;S:SampleHome-5G;P:maple-otter-42;;');
    expect(description.kind).toBe('barcode-wifi');
    // The password itself is never repeated on screen.
    expect(JSON.stringify(description)).not.toContain('maple-otter-42');
  });

  it('flags two-step login secrets', () => {
    const description = describeBarcode('otpauth://totp/Example:alex@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example');
    expect(description).toMatchObject({ kind: 'barcode-2fa', severity: 'high' });
    expect(JSON.stringify(description)).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('tells personal links from plain ones', () => {
    expect(hasPersonalToken(new URL('https://example.com/menu'))).toBe(false);
    expect(hasPersonalToken(new URL('https://tickets.example.com/t/8f3k2j9d0s7a6h5g4f3d'))).toBe(true);
    expect(describeBarcode('https://example.com/menu').severity).toBe('low');
  });

  it('describes anything else without guessing', () => {
    expect(describeBarcode('1Z999AA10123456784').title).toBe('A shipping label barcode');
    expect(describeBarcode('hello world').kind).toBe('barcode-other');
  });
});

describe('stray letters from the text reader', () => {
  const word = (text: string, x: number, w: number) => ({ text, confidence: 90, box: { x, y: 0, w, h: 10 } });

  it('drops a lone letter far from the rest of the line', () => {
    const all = [word('ALEX', 0, 40), word('SAMPLE', 46, 60), word('A', 200, 8)];
    const kept = dropStrays(all);
    expect(kept.map((item) => item.text)).toEqual(['ALEX', 'SAMPLE']);
    expect(trimDropped('ALEX SAMPLE A', all, kept)).toBe('ALEX SAMPLE');
  });

  it('keeps a short word that belongs to the line, like an apartment number', () => {
    const all = [word('APT', 0, 30), word('3', 36, 8)];
    expect(dropStrays(all)).toEqual(all);
  });
});
