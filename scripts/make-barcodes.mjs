// Writes the barcodes used by the fictional samples (see make_samples.py).
// Usage: node scripts/make-barcodes.mjs <out-dir>
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeBarcode } from 'zxing-wasm/writer';

const outDir = process.argv[2];
if (!outDir) throw new Error('Pass an output directory.');
await mkdir(outDir, { recursive: true });

// IATA BCBP mandatory items, 60 characters. Every value is made up.
const bcbp = [
  'M', // format code
  '1', // number of legs
  'SAMPLE/ALEX'.padEnd(20), // passenger name
  'E', // electronic ticket
  'ZX7Q4P'.padEnd(7), // booking reference (PNR)
  'SFO', // from
  'JFK', // to
  'XX'.padEnd(3), // carrier (XX is a placeholder code)
  '0123'.padEnd(5), // flight number
  '301', // day of year: 28 October 2026
  'Y', // compartment
  '014C', // seat
  '0042'.padEnd(5), // check-in sequence
  '1', // passenger status
  '00', // size of conditional section
].join('');
if (bcbp.length !== 60) throw new Error(`BCBP must be 60 characters, got ${bcbp.length}`);

const codes = [
  { file: 'boarding-pass-aztec.png', text: bcbp, format: 'Aztec', scale: 8 },
  { file: 'wifi-qr.png', text: 'WIFI:T:WPA;S:SampleHome-5G;P:maple-otter-42;;', format: 'QRCode', scale: 8 },
];

for (const code of codes) {
  const result = await writeBarcode(code.text, { format: code.format, scale: code.scale });
  if (result.error || !result.image) throw new Error(`${code.file}: ${result.error}`);
  await writeFile(join(outDir, code.file), Buffer.from(await result.image.arrayBuffer()));
  console.log(`wrote ${code.file}`);
}
