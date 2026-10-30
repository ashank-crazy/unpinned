// Finds barcodes and QR codes with ZXing compiled to WebAssembly. The .wasm
// file is bundled with the app instead of loading from a CDN.

import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { Box } from './types';

export interface FoundBarcode {
  rawValue: string;
  format: string;
  box: Box;
}

let detector: BarcodeDetector | null = null;

function getDetector(): BarcodeDetector {
  if (!detector) {
    const localWasm = new URL(wasmUrl, document.baseURI).href;
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? localWasm : prefix + path),
      },
    });
    detector = new BarcodeDetector();
  }
  return detector;
}

export async function detectBarcodes(source: HTMLCanvasElement): Promise<FoundBarcode[]> {
  const results = await getDetector().detect(source);
  return results
    .filter((result) => result.rawValue)
    .map((result) => ({
      rawValue: result.rawValue,
      format: result.format,
      box: { x: result.boundingBox.x, y: result.boundingBox.y, w: result.boundingBox.width, h: result.boundingBox.height },
    }));
}
