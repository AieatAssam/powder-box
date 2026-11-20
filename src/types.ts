// Shared contract between the simulation engine (src/sim.ts), the worker,
// the scene generators and the UI. Element IDs are stable: they are stored
// in save files.

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
  STONE = 13,
  ICE = 14,
  SNOW = 15,
  GUNPOWDER = 16,
  GAS = 17,
  ASH = 18,
  SEED = 19,
  FIREWORK = 20,
  SPARK = 21,
  CLONE = 22,
  VOID = 23,
  TNT = 24,
  FISH = 25,
}
export const ELEMENT_COUNT = 26;

// ─── Material table ─────────────────────────────────────────────
export const enum Kind { EMPTY = 0, POWDER = 1, LIQUID = 2, GAS = 3, SOLID = 4, ENERGY = 5 }

export interface Material {
  name: string;
  kind: Kind;
  /** Relative density. Heavier movable cells sink through lighter liquids/gases. */
  density: number;
  /** 0..1 chance per tick that an adjacent flame ignites it. 0 = fireproof. */
  flammability: number;
  /** Base colour variants [r,g,b]; the renderer picks one per cell and shades it. */
  colors: number[][];
  /** Emits light: the renderer adds a glow around it. */
  glow?: boolean;
}

export const MATERIALS: Material[] = [];
function def(id: Element, m: Material) { MATERIALS[id] = m; }

def(Element.EMPTY, { name: 'Empty', kind: Kind.EMPTY, density: 0, flammability: 0, colors: [[14, 15, 22]] });
def(Element.SAND, { name: 'Sand', kind: Kind.POWDER, density: 60, flammability: 0, colors: [[212, 165, 116], [228, 180, 130], [195, 150, 105], [220, 172, 122], [205, 158, 110]] });
def(Element.WATER, { name: 'Water', kind: Kind.LIQUID, density: 30, flammability: 0, colors: [[52, 152, 219], [41, 128, 185], [60, 165, 230], [48, 140, 200]] });
def(Element.FIRE, { name: 'Fire', kind: Kind.ENERGY, density: 1, flammability: 0, colors: [[255, 87, 34], [255, 152, 0], [255, 193, 7], [255, 236, 150]], glow: true });
def(Element.WALL, { name: 'Wall', kind: Kind.SOLID, density: 255, flammability: 0, colors: [[100, 100, 110], [110, 110, 120], [90, 90, 100], [105, 105, 115]] });
def(Element.WOOD, { name: 'Wood', kind: Kind.SOLID, density: 255, flammability: 0.04, colors: [[139, 69, 19], [160, 82, 45], [120, 60, 30], [145, 75, 35]] });
def(Element.OIL, { name: 'Oil', kind: Kind.LIQUID, density: 20, flammability: 0.35, colors: [[80, 70, 30], [100, 85, 40], [90, 78, 35], [110, 92, 45]] });
def(Element.PLANT, { name: 'Plant', kind: Kind.SOLID, density: 255, flammability: 0.15, colors: [[46, 125, 50], [76, 175, 80], [56, 142, 60], [36, 110, 42]] });
def(Element.LAVA, { name: 'Lava', kind: Kind.LIQUID, density: 70, flammability: 0, colors: [[255, 69, 0], [255, 140, 0], [230, 60, 0], [255, 100, 0]], glow: true });
def(Element.STEAM, { name: 'Steam', kind: Kind.GAS, density: 3, flammability: 0, colors: [[200, 210, 215], [180, 195, 205], [210, 220, 225]] });
def(Element.SMOKE, { name: 'Smoke', kind: Kind.GAS, density: 4, flammability: 0, colors: [[80, 80, 84], [62, 62, 66], [98, 98, 102]] });
def(Element.ACID, { name: 'Acid', kind: Kind.LIQUID, density: 35, flammability: 0, colors: [[140, 255, 60], [110, 235, 50], [160, 250, 80]], glow: true });
def(Element.GLASS, { name: 'Glass', kind: Kind.SOLID, density: 255, flammability: 0, colors: [[170, 205, 215], [150, 190, 205], [190, 220, 228]] });
def(Element.STONE, { name: 'Stone', kind: Kind.SOLID, density: 255, flammability: 0, colors: [[72, 68, 74], [84, 80, 86], [62, 58, 64], [78, 72, 76]] });
def(Element.ICE, { name: 'Ice', kind: Kind.SOLID, density: 255, flammability: 0, colors: [[168, 216, 240], [190, 228, 246], [150, 204, 234]] });
def(Element.SNOW, { name: 'Snow', kind: Kind.POWDER, density: 10, flammability: 0, colors: [[240, 244, 250], [226, 232, 242], [250, 252, 255]] });
def(Element.GUNPOWDER, { name: 'Gunpowder', kind: Kind.POWDER, density: 55, flammability: 1, colors: [[58, 56, 60], [72, 70, 74], [46, 44, 48]] });
def(Element.GAS, { name: 'Gas', kind: Kind.GAS, density: 2, flammability: 0.9, colors: [[96, 78, 140], [110, 90, 156], [84, 68, 124]] });
def(Element.ASH, { name: 'Ash', kind: Kind.POWDER, density: 25, flammability: 0, colors: [[150, 146, 142], [128, 124, 120], [168, 164, 160]] });
def(Element.SEED, { name: 'Seed', kind: Kind.POWDER, density: 50, flammability: 0.1, colors: [[196, 214, 96], [176, 196, 80], [210, 226, 116]] });
def(Element.FIREWORK, { name: 'Firework', kind: Kind.POWDER, density: 55, flammability: 1, colors: [[214, 60, 96], [232, 84, 118], [190, 44, 80]] });
def(Element.SPARK, { name: 'Spark', kind: Kind.ENERGY, density: 1, flammability: 0, colors: [[255, 240, 180]], glow: true });
def(Element.CLONE, { name: 'Clone', kind: Kind.SOLID, density: 255, flammability: 0, colors: [[224, 176, 40], [240, 196, 60], [204, 156, 28]] });
def(Element.VOID, { name: 'Void', kind: Kind.SOLID, density: 255, flammability: 0, colors: [[34, 8, 48], [46, 12, 64], [26, 4, 38]] });
def(Element.TNT, { name: 'TNT', kind: Kind.SOLID, density: 255, flammability: 1, colors: [[196, 48, 40], [176, 40, 34], [212, 60, 50]] });
def(Element.FISH, { name: 'Fish', kind: Kind.POWDER, density: 30, flammability: 0, colors: [[255, 150, 40]] });

/** Typed-array lookups for hot loops (indexed by Element). */
export const KIND = Uint8Array.from(MATERIALS, m => m.kind);
export const DENSITY = Uint8Array.from(MATERIALS, m => m.density);

// ─── Tools (the UI palette is built from this table) ────────────
export type ToolGroup = 'Powders' | 'Liquids and gases' | 'Solids' | 'Life' | 'Energy' | 'Sources and tools';
export type ToolAction = 'paint' | 'explode' | 'lightning';

export interface ToolDef {
  id: string;
  name: string;
  /** Keyboard shortcut (single lowercase char). */
  key: string;
  group: ToolGroup;
  action: ToolAction;
  /** Element painted when action === 'paint' (EMPTY = eraser). */
  element: Element;
  /** One-line description of what makes it fun. */
  hint: string;
  /** Source tools paint a Clone cell that already pours this element. */
  emit?: Element;
}

const t = (id: string, name: string, key: string, group: ToolGroup, element: Element, hint: string, action: ToolAction = 'paint'): ToolDef =>
  ({ id, name, key, group, action, element, hint });

const src = (id: string, name: string, key: string, emit: Element, hint: string): ToolDef =>
  ({ ...t(id, name, key, 'Sources and tools', Element.CLONE, hint), emit });

export const TOOLS: ToolDef[] = [
  t('sand', 'Sand', '1', 'Powders', Element.SAND, 'Piles up. Fire fuses it into glass.'),
  t('snow', 'Snow', 'o', 'Powders', Element.SNOW, 'Drifts on the wind, melts near heat, slowly vanishes in the open.'),
  t('gunpowder', 'Gunpowder', 'p', 'Powders', Element.GUNPOWDER, 'Flashes at a spark and sometimes explodes.'),
  t('ash', 'Ash', 'a', 'Powders', Element.ASH, 'Left by fire. Seeds sprout in it without water and grow twice as tall.'),
  t('water', 'Water', '2', 'Liquids and gases', Element.WATER, 'Flows, freezes, boils, feeds plants.'),
  t('oil', 'Oil', '6', 'Liquids and gases', Element.OIL, 'Floats on water and burns fiercely.'),
  t('lava', 'Lava', '8', 'Liquids and gases', Element.LAVA, 'Sets fire to anything that burns, boils water, cools into stone.'),
  t('acid', 'Acid', '9', 'Liquids and gases', Element.ACID, 'Eats everything except glass and wall. Water dilutes it.'),
  t('wall', 'Wall', '4', 'Solids', Element.WALL, 'Immovable. Only the heart of an explosion breaks it.'),
  t('wood', 'Wood', '5', 'Solids', Element.WOOD, 'Burns slowly down to ash. Water puts it out.'),
  t('stone', 'Stone', 'q', 'Solids', Element.STONE, 'Cooled lava. Slowly melts again where lava touches it.'),
  t('ice', 'Ice', 'i', 'Solids', Element.ICE, 'Freezes water it touches, melts near heat.'),
  t('glass', 'Glass', 'l', 'Solids', Element.GLASS, 'Holds acid and lava. Explosions shatter it.'),
  t('tnt', 'TNT', 'x', 'Solids', Element.TNT, 'A block that blows a big hole when fire reaches it. Sets off its neighbours.'),
  t('gas', 'Gas', 'm', 'Liquids and gases', Element.GAS, 'Rises, collects under ceilings, goes up at one spark.'),
  t('steam', 'Steam', 't', 'Liquids and gases', Element.STEAM, 'Rises, cools, rains back down.'),
  t('seed', 'Seed', 'd', 'Life', Element.SEED, 'Sprouts a vine when it lands near water or on ash.'),
  t('plant', 'Plant', '7', 'Life', Element.PLANT, 'Drinks the water it touches and grows taller. Burns fast.'),
  t('fish', 'Fish', 'h', 'Life', Element.FISH, 'Swims in water, eats seeds to breed, flops and dies on dry land.'),
  t('fire', 'Fire', '3', 'Energy', Element.FIRE, 'Spreads to anything that burns.'),
  t('firework', 'Firework', 'f', 'Energy', Element.FIREWORK, 'Light it: it launches and bursts in colour.'),
  t('explode', 'Bomb', 'e', 'Energy', Element.EMPTY, 'Click to detonate. The blast throws loose material outward.', 'explode'),
  t('lightning', 'Lightning', 'z', 'Energy', Element.EMPTY, 'Strikes from the sky. Fuses sand to glass where it lands.', 'lightning'),
  src('spring', 'Spring', 'j', Element.WATER, 'Pours water forever.'),
  src('vent', 'Vent', 'u', Element.LAVA, 'Pours lava forever.'),
  src('jet', 'Gas jet', 'y', Element.GAS, 'Leaks gas forever. Keep sparks away, or do not.'),
  src('torch', 'Torch', 'b', Element.FIRE, 'A flame that never goes out.'),
  src('cloud', 'Cloud', 's', Element.SNOW, 'Snows forever.'),
  t('clone', 'Clone', 'k', 'Sources and tools', Element.CLONE, 'A source for anything: pours the first material that touches it.'),
  t('void', 'Void', 'v', 'Sources and tools', Element.VOID, 'A drain: swallows whatever touches it.'),
  t('eraser', 'Eraser', '0', 'Sources and tools', Element.EMPTY, 'Remove anything.'),
];

export const BRUSH_SIZES = [1, 2, 3, 5, 8, 14] as const;
export type BrushSize = (typeof BRUSH_SIZES)[number];

// ─── Grid constants ─────────────────────────────────────────────
export const GRID_W = 320;
export const GRID_H = 200;
export const CELL_PX = 3; // Each grid cell rendered as CELL_PX × CELL_PX pixels

/** Wind: -1 = left, 0 = calm, 1 = right, 2 = gusting (direction changes over time). */
export type Wind = -1 | 0 | 1 | 2;
/** Gravity: 1 = down, -1 = up. */
export type Gravity = 1 | -1;

// ─── Save format ────────────────────────────────────────────────
// [magic u32 LE][width u16 LE][height u16 LE][grid w*h bytes][life w*h bytes]
export const SAVE_MAGIC = 0x50424f58; // 'PBOX'
export const SAVE_HEADER_BYTES = 8;

// ─── Main → worker messages ─────────────────────────────────────
export type WorkerInput =
  | { type: 'init'; width: number; height: number }
  /** Advance `steps` simulation ticks (0 = just re-render, used while paused) and reply with a frame. */
  | { type: 'tick'; steps: number }
  /** Paint a brush stroke from (x0,y0) to (x1,y1), interpolated so fast drags leave no gaps. */
  | { type: 'paint'; x0: number; y0: number; x1: number; y1: number; element: Element; radius: number; emit?: Element }
  | { type: 'explode'; x: number; y: number; radius: number }
  | { type: 'lightning'; x: number; y: number }
  | { type: 'clear' }
  | { type: 'wind'; direction: Wind }
  | { type: 'gravity'; direction: Gravity }
  /** Clears the grid, builds the scene, replies with a frame carrying `sceneGenToken`. */
  | { type: 'generateScene'; sceneIndex: number; seed: number; genToken: number }
  /** Replies with a `state` message containing a full save buffer (header included). */
  | { type: 'saveState' }
  /** `data` is a full save buffer (header included). Invalid buffers are ignored. */
  | { type: 'loadState'; data: ArrayBuffer };

// ─── Worker → main messages ─────────────────────────────────────
export interface FrameMessage {
  type: 'frame';
  /** RGBA pixel buffer, GRID_W × GRID_H (transferred). */
  pixels: Uint8ClampedArray;
  /** Number of non-empty cells. */
  particles: number;
  /** Set only on the frame produced by `generateScene`. */
  sceneGenToken?: number;
}

export interface StateMessage {
  type: 'state';
  /** Full save buffer (header included, transferred). */
  data: ArrayBuffer;
}

export type WorkerOutput = FrameMessage | StateMessage;
