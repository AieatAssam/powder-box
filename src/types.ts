// ─── Element types ───────────────────────────────────────────────
export const enum Element {
  EMPTY = 0,
  SAND = 1,
  WATER = 2,
  FIRE = 3,
  WALL = 4,
  WOOD = 5,
  OIL = 6,
  PLANT = 7,
  LAVA = 8,
  STEAM = 9,
  SMOKE = 10,
  ACID = 11,
  GLASS = 12,
}

// All element IDs for iteration
export const ALL_ELEMENTS: Element[] = [
  Element.EMPTY, Element.SAND, Element.WATER, Element.FIRE,
  Element.WALL, Element.WOOD, Element.OIL, Element.PLANT,
  Element.LAVA, Element.STEAM, Element.SMOKE, Element.ACID,
  Element.GLASS,
];

// ─── Element categories (for physics rules) ─────────────────────
/** Elements that fall with gravity (powders) */
export const POWDERS = new Set([Element.SAND]);

/** Elements that flow (liquids) */
export const LIQUIDS = new Set([Element.WATER, Element.OIL, Element.ACID]);

/** Elements that rise (gases) */
export const GASES = new Set([Element.STEAM, Element.SMOKE]);

/** Elements that are immovable */
export const SOLIDS = new Set([Element.WALL, Element.WOOD, Element.PLANT, Element.GLASS]);

/** Elements that can catch fire */
export const FLAMMABLE = new Set([Element.WOOD, Element.OIL, Element.PLANT]);

// ─── Tool identifiers ───────────────────────────────────────────
export const enum Tool {
  SAND = 1,
  WATER = 2,
  FIRE = 3,
  WALL = 4,
  WOOD = 5,
  OIL = 6,
  PLANT = 7,
  LAVA = 8,
  ACID = 9,
  ERASER = 10,
  EXPLOSIVE = 11,
}

export const BRUSH_SIZES = [1, 2, 3, 5, 8, 14] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number];

// ─── Grid constants ─────────────────────────────────────────────
export const GRID_W = 320;
export const GRID_H = 200;
export const CELL_PX = 3; // Each grid cell rendered as CELL_PX × CELL_PX pixels

// ─── Color palettes ─────────────────────────────────────────────
// Each element gets multiple color variants for visual variety.
// Format: [R, G, B][]
const PALETTES: Record<number, number[][]> = {
  [Element.SAND]: [
    [212, 165, 116], [228, 180, 130], [195, 150, 105],
    [220, 172, 122], [205, 158, 110],
  ],
  [Element.WATER]: [
    [52, 152, 219], [41, 128, 185], [60, 165, 230],
    [48, 140, 200], [55, 160, 215],
  ],
  [Element.FIRE]: [
    [255, 87, 34], [255, 152, 0], [255, 193, 7],
    [230, 74, 25], [255, 112, 67],
  ],
  [Element.WALL]: [
    [100, 100, 110], [110, 110, 120], [90, 90, 100],
    [105, 105, 115], [95, 95, 105],
  ],
  [Element.WOOD]: [
    [139, 69, 19], [160, 82, 45], [120, 60, 30],
    [145, 75, 35], [155, 90, 50],
  ],
  [Element.OIL]: [
    [80, 70, 30], [100, 85, 40], [90, 78, 35],
    [110, 92, 45], [75, 65, 28],
  ],
  [Element.PLANT]: [
    [46, 125, 50], [76, 175, 80], [56, 142, 60],
    [66, 160, 70], [36, 110, 42],
  ],
  [Element.LAVA]: [
    [255, 69, 0], [255, 140, 0], [230, 60, 0],
    [255, 100, 0], [200, 50, 0],
  ],
  [Element.STEAM]: [
    [200, 210, 215], [180, 195, 205], [210, 220, 225],
    [190, 200, 210], [220, 225, 230],
  ],
  [Element.SMOKE]: [
    [80, 80, 80], [60, 60, 60], [100, 100, 100],
    [70, 70, 70], [90, 90, 90],
  ],
  [Element.ACID]: [
    [0, 255, 0], [50, 230, 50], [0, 245, 0],
    [30, 220, 30], [0, 200, 0],
  ],
  [Element.GLASS]: [
    [180, 200, 210], [170, 190, 200], [190, 210, 220],
    [175, 195, 205], [185, 205, 215],
  ],
};

/** Pre-computed flat RGB palette per element: each is a Uint8 of [R0,G0,B0, R1,G1,B1,...] */
export const PALETTE_FLAT: Record<number, Uint8Array> = {};
for (const [elem, colors] of Object.entries(PALETTES)) {
  const flat = new Uint8Array(colors.length * 3);
  for (let i = 0; i < colors.length; i++) {
    flat[i * 3] = colors[i][0];
    flat[i * 3 + 1] = colors[i][1];
    flat[i * 3 + 2] = colors[i][2];
  }
  PALETTE_FLAT[Number(elem)] = flat;
}

/** Number of color variants per element */
export const PALETTE_LEN: Record<number, number> = {};
for (const [elem, colors] of Object.entries(PALETTES)) {
  PALETTE_LEN[Number(elem)] = colors.length;
}

// ─── Worker message types ───────────────────────────────────────
export interface InitMessage {
  type: 'init';
  width: number;
  height: number;
}

export interface InputMessage {
  type: 'input';
  x: number;
  y: number;
  tool: Tool;
  brushSize: number;
  active: boolean;
}

export interface TickMessage {
  type: 'tick';
}

export interface ClearMessage {
  type: 'clear';
}

export interface PlaceCellsMessage {
  type: 'placeCells';
  /** Packed buffer: [x(16bit), y(16bit), elem(8bit), life(8bit)] × N (little-endian) */
  data: ArrayBuffer;
}

export interface SaveStateMessage {
  type: 'saveState';
}

export interface LoadStateMessage {
  type: 'loadState';
  /** Serialised grid: [W(16bit LE), H(16bit LE), grid[0..W*H-1](8bit), life[0..W*H-1](8bit)] */
  data: ArrayBuffer;
}

export interface ExplodeMessage {
  type: 'explode';
  x: number;
  y: number;
  radius: number;
}

export interface WindMessage {
  type: 'wind';
  /** -1 = left, 0 = off, 1 = right */
  direction: number;
}

export interface GravityMessage {
  type: 'gravity';
  /** 1 = normal down, -1 = reversed up */
  direction: number;
}

export type WorkerInput =
  | InitMessage
  | InputMessage
  | TickMessage
  | ClearMessage
  | PlaceCellsMessage
  | SaveStateMessage
  | LoadStateMessage
  | ExplodeMessage
  | WindMessage
  | GravityMessage;

export interface FrameMessage {
  type: 'frame';
  /** RGBA pixel buffer (transferable) */
  pixels: Uint8ClampedArray;
}

export interface StateSnapshotMessage {
  type: 'stateSnapshot';
  /** Serialised: grid[0..W*H-1](8bit), life[0..W*H-1](8bit) */
  data: ArrayBuffer;
}
