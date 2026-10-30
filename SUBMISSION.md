# Devpost submission: Unpinned

Copy each section into the matching Devpost field. Replace the demo and video links if they change.

---

## Project name

Unpinned

## Tagline

See what a photo or screenshot gives away, from hidden GPS to a cropped-out house number, then share a checked,
safer copy. Nothing leaves your device.

## Links

- **Working demo:** https://ashank-crazy.github.io/unpinned/ (no account, no install; try the three examples on the
  start page)
- **Source code:** https://github.com/ashank-crazy/unpinned
- **Video (optional):** _add link_

## Intended user, situation, and improvement

- **Intended user:** people who share pictures with people they don't know well, like when selling or giving things
  away online, renting out a room, posting in a community group, or sending photos to a landlord, school, or insurer.
  It matters most for people whose location needs protecting, such as someone who has moved away from an abusive
  partner or is being harassed online, and the advocates who help them.
- **Situation and risk:** a photo can carry the exact spot where it was taken (often accurate to a few meters), the
  time, and the phone model. Some files keep a hidden preview that still shows what was cropped out, a motion-photo
  video clip, or (after the 2023 "aCropalypse" bugs) the cropped-off part of a screenshot. In the picture itself,
  people miss addresses on mail, card numbers in screenshots, Wi-Fi QR codes, and boarding pass barcodes that hold a
  name and booking code. Many social apps strip hidden details, but email, cloud links, files sent as documents, and
  some websites don't, and people can't see what their own photo carries.
- **Practical improvement:** in under a minute, Unpinned explains in plain words what a photo gives away and why it
  matters, then makes a copy with the hidden details removed and chosen spots covered by solid boxes. It re-reads the
  copy to show the details are gone. It runs entirely in the browser, works offline, and never uploads the photo.

## What it does

1. **Add a photo or screenshot** by choosing, dropping, or pasting it (or from the Android share sheet when installed).
2. **Read the report.** A one-line verdict ("Don't share this one as it is") is followed by findings labeled Serious,
   Worth knowing, or Minor. Each says what was found and why it matters. Numbered boxes on the photo match the
   findings.
   - **Hidden in the file:** location (shown as "in or near Chicago, accurate to about 4.7 m", using an offline town
     list, never a map service), place names, date and time zone, phone and serial numbers, names, captions, editing
     history with computer user names, hidden previews (shown next to the photo when they differ), motion-photo video,
     and leftover data after the end of the image.
   - **Visible in the picture:** addresses, card numbers (Luhn-checked), bank account numbers (IBAN, mod-97 checked),
     Social Security numbers, phone numbers, emails, names, booking and account numbers, and QR codes and barcodes:
     boarding passes, Wi-Fi passwords, two-step login setup codes, locations, and contact cards.
3. **Make a safer copy.** Hidden details are always left out. Ticked items and anything the person draws over (with a
   mouse, touch, or the keyboard) get solid covers. When nothing is covered, the picture data is kept exactly as it
   was, with no re-compression.
4. **Check it.** Seven checks re-read the copy and are shown with ticks. People can open the copy in Unpinned to see
   for themselves, then save or share it. The original is never changed, so it can be kept as evidence.

## One example of the safer outcome

The "Selling a desk" example is a listing photo. **Before:** the file holds a GPS position in Chicago accurate to
4.7 m and the direction the camera faced, the date and time (Monday, October 26, 2026 at 6:42 PM, UTC−05:00), the
phone model, and a unique photo ID. A hidden preview inside the file still shows the front door and house number 42
that were cropped out of the visible photo. The picture also shows a guest Wi-Fi QR code (with its password), the name
"Alex Sample", and a street address on an envelope. **After:** the safer copy has none of the hidden details, and the
QR code, name, and address are under solid boxes. All seven re-checks pass, and opening the copy in Unpinned reports
nothing hidden and no personal text or codes.

## One limitation

Unpinned can't recognize faces, house numbers on buildings, street signs, landmarks, license plates, or what is in
reflections and on screens. Its text reader works in English and can miss small, blurry, angled, or handwritten text.
The report reminds people to look for these and lets them draw covers, but it can't promise a photo is safe, and it
can't take back a photo that has already been shared.

## Trust and responsible design

- **Private by construction:** no server, accounts, analytics, or cookies. A Content Security Policy
  (`connect-src 'self'`) makes the browser block connections to any other site. The text reader, its language
  model, the barcode reader, and the font are served from the same site. No map tiles or geocoding services are used.
- **Safe covers:** solid boxes, never blur or pixelation, which can sometimes be reversed.
- **Careful display:** card, bank, and Social Security numbers are partly masked on screen; Wi-Fi passwords and
  two-step login secrets are never displayed.
- **Honest about uncertainty:** low-confidence text is flagged, and if the picture couldn't be fully checked the
  report says so instead of "nothing found". A short list reminds people what the app can't spot.
- **Proof, not promises:** the copy is re-read with the same checks, and the original file is never modified.
- **Not an emergency service:** the page says so and points people to their local emergency number.
- **Accessible:** Atkinson Hyperlegible font, severity in words and icons (not color alone), full keyboard support
  including drawing covers, screen-reader announcements, light and dark themes, and reduced-motion support.

## How we built it

A static web app in TypeScript with Vite, with no framework and no backend.

- **File structure readers** written for this project walk JPEG segments and PNG and WebP chunks to find metadata
  blocks, embedded previews, motion-photo video, and data after the end of the image.
- **exifr** reads EXIF, XMP, and IPTC fields, which are sorted into plain-language groups. For PNG and WebP, each
  metadata block is handed to exifr on its own.
- **Hidden previews** are compared with the photo by shape and by a 24 × 24 grayscale fingerprint, so the app can say
  when a preview shows more than the photo.
- **Tesseract** (in a Web Worker) and **ZXing** (WebAssembly) read text and codes. Detectors check numbers with
  Luhn and mod-97 checks, join address lines, and parse IATA boarding pass and Wi-Fi codes.
- **Lossless cleaning** rebuilds JPEG, PNG, and WebP files keeping only image data, color profile, and orientation.
  When covers are drawn, the picture is re-drawn on a canvas and cleaned again.
- **A service worker** keeps the app available offline and receives photos from the Android share sheet.
- **Unit tests** (Vitest) cover the readers, cleaning, re-checks, and detectors using made-up test files.

## Challenges

- exifr can't read PNG or WebP metadata fully, so the app finds each block itself and passes it to exifr separately.
- Keeping the JPEG picture data byte-for-byte identical while removing everything else, and still keeping the photo
  the right way up.
- Making text reading and barcode scanning work offline under a strict security policy, with every file served from
  the same site.
- Writing findings that are specific (4.7 m, "in or near Chicago") without sending a location to a map service.

## Accomplishments

- The full loop works on all three examples: find, explain, cover, clean, and re-check, in a few seconds and offline.
- Copies with no covers keep the original picture data exactly.
- The hidden-preview check shows people the cropped-out part of their own photo, which makes the risk easy to see.

## What we learned

Most of the risk in a shared photo is invisible, and a tool earns trust by showing its work: what it found, what it
changed, what it re-checked, and what it can't see.

## What's next

- Recognizing faces, house numbers, and license plates on the device, as suggestions people confirm.
- More languages for text reading.
- Rebuilding the cropped-off part of an "aCropalypse" screenshot so people can see what leaked.
- Checking several photos at once.

## Built with

TypeScript, Vite, Vitest, exifr, tesseract.js, Tesseract OCR, zxing-wasm, barcode-detector, ZXing-C++, GeoNames,
Atkinson Hyperlegible, Web Workers, WebAssembly, Service Workers, Web Share API

## Built during the event, and credits

Everything in the repository was written during SafeSpace Hacks (October 17 to November 22, 2026): the file readers,
detectors, cleaning, checks, interface, examples, and tests. Pre-existing components are the open-source libraries
and data listed in the README and `THIRD_PARTY_NOTICES.md`: exifr (MIT), tesseract.js and tesseract.js-core
(Apache 2.0), the tessdata English model (Apache 2.0), barcode-detector and zxing-wasm (MIT), ZXing-C++
(Apache 2.0), GeoNames town data (CC BY 4.0) via all-the-cities (MIT), and the Atkinson Hyperlegible font (SIL OFL).

**AI assistance:** built with substantial help from Claude Code (Anthropic's AI coding assistant), which wrote much of
the code, tests, and text.

**Data:** all example pictures and test files are synthetic. Every name, address, booking code, card number, and Wi-Fi
network is made up. The example GPS position is a public sculpture, not a home.

## Screenshots to upload

In `docs/screenshots/`:

1. `1-start.jpg`: the start page with the three examples
2. `2-report.jpg`: the report for "Selling a desk", with numbered boxes on the photo
3. `3-hidden-preview.jpg`: the hidden preview next to the photo, showing the cropped-out door
4. `4-safer-copy.jpg`: the safer copy with all seven checks passing
5. `5-boarding-pass.jpg`: what a boarding pass barcode gives away
6. `6-phone-receipt.jpg`: the cropped receipt on a phone, with leftover data found
