/**
 * GIF export using GIFEncoder from gif.js
 * Sets our known palette to skip NeuQuant quantization — ~12 colors, fast encode.
 */
import { GIFEncoder } from 'gif.js';
import { GRID_W, GRID_H } from './types';
import { PALETTE_FLAT, PALETTE_LEN, ALL_ELEMENTS } from './types';
import { Element } from './types';

/** Build a flat global palette array [R,G,B, R,G,B, ...] of unique colors */
function buildPalette(): number[] {
  const seen = new Set<string>();
  const palette: number[] = [];
  for (const elem of ALL_ELEMENTS) {
    if (elem === Element.EMPTY) continue;
    const flat = PALETTE_FLAT[elem];
    const len = PALETTE_LEN[elem];
    if (!flat || !len) continue;
    for (let i = 0; i < len; i++) {
      const r = flat[i * 3];
      const g = flat[i * 3 + 1];
      const b = flat[i * 3 + 2];
      const key = `${r},${g},${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        palette.push(r, g, b);
      }
    }
  }
  // Add background color
  palette.push(20, 15, 25);
  // Pad to fill 256 colors (required by GIF spec)
  while (palette.length < 256 * 3) palette.push(0, 0, 0);
  return palette;
}

const GLOBAL_PALETTE = buildPalette();

export interface GifFrameData {
  /** RGBA pixel data (flat Uint8Array, GRID_W * GRID_H * 4 bytes) */
  pixels: Uint8Array;
  /** Frame delay in milliseconds */
  delay: number;
}

/**
 * Encode frames to a GIF blob.
 * Returns a Promise that resolves with the Blob.
 */
export function encodeGifBlob(frames: GifFrameData[]): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const encoder = new GIFEncoder(GRID_W, GRID_H);
      encoder.setRepeat(0); // loop forever
      encoder.setQuality(1); // highest quality (quick for known palette)
      encoder.setGlobalPalette(GLOBAL_PALETTE);
      encoder.writeHeader();

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        encoder.setDelay(Math.round(frame.delay / 10)); // in 1/100ths of a second
        encoder.addFrame(frame.pixels);
      }

      encoder.finish();

      // GIFEncoder stream outputs pages (Uint8Array chunks) and a cursor
      const stream = encoder.stream();
      const totalSize = (stream.pages.length - 1) * stream.constructor.pageSize + stream.cursor;
      const buffer = new Uint8Array(totalSize);
      let offset = 0;
      for (let i = 0; i < stream.pages.length; i++) {
        const page = stream.pages[i];
        const len = i === stream.pages.length - 1 ? stream.cursor : page.length;
        buffer.set(page.subarray(0, len), offset);
        offset += len;
      }

      resolve(new Blob([buffer], { type: 'image/gif' }));
    } catch (err) {
      reject(err);
    }
  });
}
