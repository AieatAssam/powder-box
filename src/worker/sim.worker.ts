/// <reference lib="webworker" />

import {
  Element,
  POWDERS, LIQUIDS, GASES, SOLIDS, FLAMMABLE,
  Tool,
  GRID_W, GRID_H,
  PALETTE_FLAT, PALETTE_LEN,
  type WorkerInput, type FrameMessage,
} from '../types';

// ─── State owned by the worker ──────────────────────────────────
let W = GRID_W;
let H = GRID_H;
let grid: Uint8Array;
let life: Uint8Array;  // lifetime / burn-timer per cell
let inputX = -1;
let inputY = -1;
let inputTool = Tool.SAND;
let inputBrushSize = 3;
let inputActive = false;
let tickNum = 0;

// ─── Pre-allocated pixel buffer ─────────────────────────────────
let pixels: Uint8ClampedArray;

// ─── Element lifetime constants (in ticks) ──────────────────────
const FIRE_LIFETIME = 45;       // 45 ticks before fire dies
const LAVA_LIFETIME = 180;      // 180 ticks before lava solidifies
const SMOKE_LIFETIME = 35;      // ticks before smoke fades
const STEAM_LIFETIME = 50;      // ticks before steam condenses
const WOOD_BURN_TIME = 60;      // ticks for wood to burn before turning to fire

// ─── Probability constants (1/N chance per check) ───────────────
const FIRE_SPREAD_CHANCE = 5;   // 1 in 5 chance per tick
const FIRE_IGNITE_CHANCE = 8;   // 1 in 8 to ignite adjacent fuel
const LAVA_IGNITE_CHANCE = 4;   // 1 in 4

// ─── Initialisation ─────────────────────────────────────────────
function init(w: number, h: number) {
  W = w;
  H = h;
  grid = new Uint8Array(W * H);
  life = new Uint8Array(W * H);
  pixels = new Uint8ClampedArray(W * H * 4);
  // Fill canvas with empty pixel colour (black with alpha = 255)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 20;       // R
    pixels[i + 1] = 15;   // G
    pixels[i + 2] = 25;   // B — very dark purple-black
    pixels[i + 3] = 255;  // A
  }
}

// ─── Grid helpers ────────────────────────────────────────────────
function idx(x: number, y: number): number { return y * W + x; }
function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < W && y >= 0 && y < H;
}
function get(x: number, y: number): number {
  return grid[idx(x, y)];
}
function set(x: number, y: number, v: number, l = 0) {
  const i = idx(x, y);
  grid[i] = v;
  life[i] = l;
}
function swap(x1: number, y1: number, x2: number, y2: number) {
  const i1 = idx(x1, y1);
  const i2 = idx(x2, y2);
  const tg = grid[i1]; const tl = life[i1];
  grid[i1] = grid[i2]; life[i1] = life[i2];
  grid[i2] = tg; life[i2] = tl;
}

// ─── Colour picker (with pseudo-random from position) ───────────
function pickColor(elem: number, x: number, y: number): [number, number, number] {
  const palette = PALETTE_FLAT[elem];
  const len = PALETTE_LEN[elem];
  if (!palette || !len) return [50, 50, 50]; // fallback gray
  // Deterministic pseudo-random from position
  const variant = ((x * 7 + y * 31) & 0x7FFFFFFF) % len;
  const vi = variant * 3;
  return [palette[vi], palette[vi + 1], palette[vi + 2]];
}

// ─── Place cells in a brush circle ──────────────────────────────
function placeAt(cx: number, cy: number, elem: number, radius: number, lifetime = 0) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      // Don't overwrite walls with fluids
      if (elem !== Element.EMPTY && grid[i] === Element.WALL) continue;
      // Don't overwrite wood/plant/glass with anything (eraser excepted)
      if (elem !== Element.EMPTY) {
        if (grid[i] === Element.WOOD || grid[i] === Element.PLANT || grid[i] === Element.GLASS) continue;
      }
      grid[i] = elem;
      life[i] = lifetime;
    }
  }
}

// ─── Element-specific physics ───────────────────────────────────

function tickSand(x: number, y: number) {
  // Fall straight down
  if (inBounds(x, y + 1) && get(x, y + 1) === Element.EMPTY) {
    swap(x, y, x, y + 1);
    return;
  }
  // Sink in liquids
  if (inBounds(x, y + 1) && LIQUIDS.has(get(x, y + 1) as Element)) {
    swap(x, y, x, y + 1);
    return;
  }
  // Fall diagonally
  const dir = ((x + y) & 1) ? 1 : -1;
  if (inBounds(x + dir, y + 1) && get(x + dir, y + 1) === Element.EMPTY) {
    swap(x, y, x + dir, y + 1);
    return;
  }
  if (inBounds(x - dir, y + 1) && get(x - dir, y + 1) === Element.EMPTY) {
    swap(x, y, x - dir, y + 1);
    return;
  }
  // Sink diagonally in liquids
  if (inBounds(x + dir, y + 1) && LIQUIDS.has(get(x + dir, y + 1) as Element)) {
    swap(x, y, x + dir, y + 1);
    return;
  }
  if (inBounds(x - dir, y + 1) && LIQUIDS.has(get(x - dir, y + 1) as Element)) {
    swap(x, y, x - dir, y + 1);
    return;
  }
}

function tickLiquid(x: number, y: number, spreadRate: number) {
  // Fall straight down
  if (inBounds(x, y + 1)) {
    const below = get(x, y + 1);
    if (below === Element.EMPTY) { swap(x, y, x, y + 1); return; }
    // Water/oil floats on lava (lava is denser)
    if (get(x, y) === Element.WATER && below === Element.LAVA) {
      // Water + lava = steam
      set(x, y + 1, Element.STEAM, STEAM_LIFETIME);
      set(x, y, Element.EMPTY);
      return;
    }
  }

  // Spread sideways
  for (let attempt = 0; attempt < spreadRate; attempt++) {
    const dir = ((x + y + attempt) & 1) ? 1 : -1;
    const tx = x + dir;
    if (inBounds(tx, y) && get(tx, y) === Element.EMPTY) {
      swap(x, y, tx, y);
      return;
    }
  }
}

function tickGas(x: number, y: number, spreadRate: number) {
  // Rise upward
  if (inBounds(x, y - 1) && get(x, y - 1) === Element.EMPTY) {
    swap(x, y, x, y - 1);
    return;
  }
  // Spread sideways
  for (let attempt = 0; attempt < spreadRate; attempt++) {
    const dir = ((x + y + attempt) & 1) ? 1 : -1;
    const tx = x + dir;
    if (inBounds(tx, y) && get(tx, y) === Element.EMPTY) {
      swap(x, y, tx, y);
      return;
    }
  }
}

function tickFire(x: number, y: number) {
  const l = life[idx(x, y)];
  if (l === 0) {
    // Fire dies → smoke
    set(x, y, Element.SMOKE, SMOKE_LIFETIME);
    return;
  }
  life[idx(x, y)] = l - 1;

  // Spread to adjacent fuel
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    const adjacent = get(nx, ny);
    if (adjacent === Element.WOOD) {
      // Wood starts burning
      if (life[idx(nx, ny)] === 0) {
        life[idx(nx, ny)] = WOOD_BURN_TIME;
      }
      if (Math.random() < 1 / FIRE_IGNITE_CHANCE && life[idx(nx, ny)] <= 1) {
        set(nx, ny, Element.FIRE, FIRE_LIFETIME);
      }
    } else if (adjacent === Element.OIL) {
      // Oil ignites immediately with a larger fire
      if (Math.random() < 1 / FIRE_IGNITE_CHANCE) {
        set(nx, ny, Element.FIRE, FIRE_LIFETIME + 10);
        // Spread fire around
        for (const [dx2, dy2] of dirs) {
          const sx = nx + dx2, sy = ny + dy2;
          if (inBounds(sx, sy) && get(sx, sy) === Element.EMPTY && Math.random() < 0.3) {
            set(sx, sy, Element.FIRE, FIRE_LIFETIME);
          }
        }
      }
    } else if (adjacent === Element.PLANT) {
      if (Math.random() < 1 / FIRE_IGNITE_CHANCE) {
        set(nx, ny, Element.FIRE, FIRE_LIFETIME);
      }
    } else if (adjacent === Element.WATER) {
      // Water extinguishes fire
      set(x, y, Element.STEAM, STEAM_LIFETIME);
      set(nx, ny, Element.EMPTY);
      return;
    }
  }

  // Random upward smoke
  if (Math.random() < 0.08 && inBounds(x, y - 1) && get(x, y - 1) === Element.EMPTY) {
    set(x, y - 1, Element.SMOKE, SMOKE_LIFETIME);
  }
}

function tickLava(x: number, y: number) {
  const l = life[idx(x, y)];
  if (l === 0) {
    // Lava solidifies
    set(x, y, Element.WALL);
    return;
  }
  life[idx(x, y)] = l - 1;

  // Check surroundings
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    const adjacent = get(nx, ny);
    if (adjacent === Element.WATER) {
      // Steam explosion
      set(nx, ny, Element.STEAM, STEAM_LIFETIME + 10);
      set(x, y, Element.WALL); // Lava solidifies into obsidian-ish wall
      return;
    }
    if (FLAMMABLE.has(adjacent as Element) && Math.random() < 1 / LAVA_IGNITE_CHANCE) {
      set(nx, ny, Element.FIRE, FIRE_LIFETIME);
    }
  }

  // Fall like a thick liquid
  const below = inBounds(x, y + 1) ? get(x, y + 1) : -1;
  if (below === Element.EMPTY) { swap(x, y, x, y + 1); return; }
  if (LIQUIDS.has(below as Element) && below !== Element.LAVA && below !== Element.ACID) {
    // Lava sinks in water/oil (they become steam/fire)
    if (below === Element.WATER) {
      set(x, y + 1, Element.STEAM, STEAM_LIFETIME);
      set(x, y, Element.EMPTY);
      return;
    }
    if (below === Element.OIL) {
      set(x, y + 1, Element.FIRE, FIRE_LIFETIME + 15);
      set(x, y, Element.EMPTY);
      return;
    }
  }
  // Slow lateral spread
  const dir = ((x + y) & 1) ? 1 : -1;
  if (inBounds(x + dir, y) && get(x + dir, y) === Element.EMPTY) {
    swap(x, y, x + dir, y);
  }
}

function tickWood(x: number, y: number) {
  const l = life[idx(x, y)];
  if (l === 0) return; // not burning
  // Wood is burning → countdown then become fire
  if (l <= 1) {
    set(x, y, Element.FIRE, FIRE_LIFETIME);
    return;
  }
  life[idx(x, y)] = l - 1;

  // Occasionally emit smoke while burning
  if (Math.random() < 0.05 && inBounds(x, y - 1) && get(x, y - 1) === Element.EMPTY) {
    set(x, y - 1, Element.SMOKE, SMOKE_LIFETIME);
  }
}

function tickAcid(x: number, y: number) {
  // Dissolve anything it touches
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    const a = get(nx, ny);
    if (a !== Element.EMPTY && a !== Element.ACID && a !== Element.STEAM && a !== Element.SMOKE) {
      if (Math.random() < 0.15) {
        // Acid consumed, target dissolved
        set(nx, ny, Element.EMPTY);
        if (Math.random() < 0.5) {
          set(x, y, Element.EMPTY); // acid used up
          return;
        }
      }
    }
  }
  // Fall like water
  tickLiquid(x, y, 3);
}

function tickSmoke(x: number, y: number) {
  const l = life[idx(x, y)];
  if (l === 0) { set(x, y, Element.EMPTY); return; }
  life[idx(x, y)] = l - 1;
  tickGas(x, y, 3);
}

function tickSteam(x: number, y: number) {
  const l = life[idx(x, y)];
  if (l === 0) {
    // Condense back to water if possible
    const below = inBounds(x, y + 1) ? get(x, y + 1) : -1;
    if (below === Element.EMPTY || below === Element.STEAM || below === Element.SMOKE) {
      set(x, y, Element.WATER);
    } else {
      set(x, y, Element.EMPTY);
    }
    return;
  }
  life[idx(x, y)] = l - 1;
  tickGas(x, y, 4);
}

// ─── Main physics tick ──────────────────────────────────────────
function tick() {
  tickNum++;

  // Process input
  if (inputActive && inBounds(inputX, inputY)) {
    const elem = toolToElement(inputTool);
    if (elem !== null) {
      const lifetime = elem === Element.FIRE ? FIRE_LIFETIME
        : elem === Element.LAVA ? LAVA_LIFETIME
        : elem === Element.SMOKE ? SMOKE_LIFETIME
        : elem === Element.STEAM ? STEAM_LIFETIME
        : 0;
      placeAt(inputX, inputY, elem, inputBrushSize, lifetime);
    }
  }

  // Update cells bottom-to-top, alternating scan direction
  const rightward = (tickNum & 1) === 0;

  for (let y = H - 1; y >= 0; y--) {
    if (rightward) {
      for (let x = 0; x < W; x++) {
        processCell(x, y);
      }
    } else {
      for (let x = W - 1; x >= 0; x--) {
        processCell(x, y);
      }
    }
  }

  // Render pixels
  renderPixels();
}

function processCell(x: number, y: number) {
  const elem = get(x, y);
  switch (elem) {
    case Element.SAND: tickSand(x, y); break;
    case Element.WATER: tickLiquid(x, y, 4); break;
    case Element.OIL: tickLiquid(x, y, 3); break;
    case Element.ACID: tickAcid(x, y); break;
    case Element.FIRE: tickFire(x, y); break;
    case Element.LAVA: tickLava(x, y); break;
    case Element.STEAM: tickSteam(x, y); break;
    case Element.SMOKE: tickSmoke(x, y); break;
    case Element.WOOD: tickWood(x, y); break;
    case Element.GLASS:
      // Glass is static but can be broken by acid
      break;
  }
}

function toolToElement(tool: Tool): Element | null {
  switch (tool) {
    case Tool.SAND: return Element.SAND;
    case Tool.WATER: return Element.WATER;
    case Tool.FIRE: return Element.FIRE;
    case Tool.WALL: return Element.WALL;
    case Tool.WOOD: return Element.WOOD;
    case Tool.OIL: return Element.OIL;
    case Tool.PLANT: return Element.PLANT;
    case Tool.LAVA: return Element.LAVA;
    case Tool.ACID: return Element.ACID;
    case Tool.ERASER: return Element.EMPTY;
    default: return null;
  }
}

// ─── Pixel rendering ────────────────────────────────────────────
function renderPixels() {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = (y * W + x) * 4;
      const elem = grid[y * W + x];
      if (elem === Element.EMPTY) {
        // Dark background
        pixels[pi] = 20;
        pixels[pi + 1] = 15;
        pixels[pi + 2] = 25;
        pixels[pi + 3] = 255;
      } else {
        const [r, g, b] = pickColor(elem, x, y);
        pixels[pi] = r;
        pixels[pi + 1] = g;
        pixels[pi + 2] = b;
        pixels[pi + 3] = 255;
      }
    }
  }
}

// ─── Worker message handler ─────────────────────────────────────
self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      init(msg.width, msg.height);
      break;
    case 'input':
      inputX = msg.x;
      inputY = msg.y;
      inputTool = msg.tool;
      inputBrushSize = msg.brushSize;
      inputActive = msg.active;
      break;
    case 'tick':
      tick();
      // Send pixel buffer back (transfer for zero-copy)
      const out: FrameMessage = { type: 'frame', pixels };
      self.postMessage(out, [pixels.buffer as ArrayBuffer]);
      // Re-allocate new buffer for next frame
      pixels = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 20; pixels[i + 1] = 15;
        pixels[i + 2] = 25; pixels[i + 3] = 255;
      }
      break;
    case 'clear':
      grid.fill(0);
      life.fill(0);
      break;
  }
};
