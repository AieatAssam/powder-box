/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module 'gif.js' {
  class GIFEncoder {
    constructor(width: number, height: number);
    writeHeader(): void;
    setRepeat(repeat: number): void;
    setDelay(delay: number): void;
    setQuality(quality: number): void;
    setDispose(disposalCode: number): void;
    setTransparent(color: string | number | null): void;
    setDither(dither: boolean | string): void;
    setGlobalPalette(palette: number[] | true): void;
    addFrame(imageData: Uint8Array | Uint8ClampedArray): void;
    finish(): void;
    /** Returns the output stream */
    stream(): {
      pages: Uint8Array[];
      cursor: number;
      constructor: { pageSize: number };
    };
  }
  class NeuQuant { constructor(pixels: Uint8Array, sample: number); buildColormap(): void; getColormap(): number[]; lookupRGB(r: number, g: number, b: number): number; }
  class TypedNeuQuant { constructor(pixels: Uint8Array, sample: number); buildColormap(): void; getColormap(): number[]; }
  class LZWEncoder { constructor(width: number, height: number, pixels: Uint8Array, colorDepth: number); encode(out: { writeByte: (b: number) => void; writeBytes: (arr: Uint8Array, offset: number, length: number) => void }): void; }

  export { GIFEncoder, NeuQuant, TypedNeuQuant, LZWEncoder };
}
