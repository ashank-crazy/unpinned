// Reads text in a picture with Tesseract, running in a Web Worker on this
// device. The engine and English language data are served from this site.

import type { Worker } from 'tesseract.js';
import type { Box } from './types';

export interface OcrWord {
  text: string;
  confidence: number;
  box: Box;
}

export interface OcrLine {
  text: string;
  words: OcrWord[];
}

type Progress = (fraction: number) => void;

let workerPromise: Promise<Worker> | null = null;
let reportProgress: Progress | null = null;

function vendorUrl(path: string): string {
  return new URL(`vendor/tesseract/${path}`, document.baseURI).href;
}

function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: vendorUrl('worker.min.js'),
      corePath: vendorUrl('core'),
      langPath: vendorUrl('lang'),
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
      logger: (message) => {
        // Loading takes the first fifth of the bar; recognizing takes the rest.
        if (message.status === 'recognizing text') reportProgress?.(0.2 + message.progress * 0.8);
        else if (message.status.startsWith('loading')) reportProgress?.(message.progress * 0.2);
      },
    });
  })().catch((error) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

export async function readText(canvas: HTMLCanvasElement, onProgress: Progress, timeoutMs = 90_000): Promise<OcrLine[]> {
  reportProgress = onProgress;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Reading text took too long on this device.')), timeoutMs);
  });
  try {
    const worker = await Promise.race([getWorker(), timeout]);
    const { data } = await Promise.race([worker.recognize(canvas, {}, { blocks: true, text: false }), timeout]);
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const words = line.words
            .filter((word) => word.text.trim())
            .map((word) => ({
              text: word.text.trim(),
              confidence: word.confidence,
              box: { x: word.bbox.x0, y: word.bbox.y0, w: word.bbox.x1 - word.bbox.x0, h: word.bbox.y1 - word.bbox.y0 },
            }));
          if (words.length) lines.push({ text: words.map((word) => word.text).join(' '), words });
        }
      }
    }
    onProgress(1);
    return lines;
  } finally {
    clearTimeout(timer);
    // A newer photo may already be waiting its turn; leave its progress bar connected.
    if (reportProgress === onProgress) reportProgress = null;
  }
}
