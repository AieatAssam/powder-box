/**
 * Procedural starting scenes. Every scene is a side-view cross section with
 * the ground at the bottom. A builder returns `[x, y, elem, life]` cells.
 * The Canvas keeps the final state per position, so later writes overwrite
 * earlier ones (write EMPTY to carve).
 *
 * Life conventions (engine contract):
 *  - FIRE: life 0 = random lifetime.
 *  - CLONE: life = the element id it copies into empty neighbours.
 *  - WOOD: life 0 (static wood). Life > 0 means burning.
 *  - VOID: life 0.
 */
import { Element, GRID_W, GRID_H } from './types';

type Cell = [number, number, number, number]; // x, y, elem, life
type SceneBuilder = (seed: number) => Cell[];

const W = GRID_W;
const H = GRID_H;
const UNSET = 255;

// ─── Seeded random (mulberry32) ─────────────────────────────────
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Canvas: a grid of final cell states ────────────────────────
class Canvas {
  private el = new Uint8Array(W * H).fill(UNSET);
  private life = new Uint8Array(W * H);
  constructor(readonly rng: () => number) {}

  set(x: number, y: number, e: number, life = 0): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    this.el[y * W + x] = e;
    this.life[y * W + x] = life;
  }

  /** Filled rectangle. */
  rect(x: number, y: number, w: number, h: number, e: number, life = 0): void {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) this.set(i, j, e, life);
  }

  /** Filled disc. */
  disc(cx: number, cy: number, r: number, e: number, life = 0): void {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++)
        if (i * i + j * j <= r * r) this.set(cx + i, cy + j, e, life);
  }

  /** Line with a square brush `thick` cells wide. */
  line(x0: number, y0: number, x1: number, y1: number, e: number, thick = 1, life = 0): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const r = Math.floor((thick - 1) / 2);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      this.rect(x - r, y - r, thick, thick, e, life);
    }
  }

  /** Current element at a position (EMPTY when unset or off the grid). */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= W || y >= H) return Element.EMPTY;
    const e = this.el[y * W + x];
    return e === UNSET ? Element.EMPTY : e;
  }

  /** Every cell that holds a non-empty element. */
  cells(): Cell[] {
    const out: Cell[] = [];
    for (let i = 0; i < W * H; i++) {
      const e = this.el[i];
      if (e !== UNSET && e !== Element.EMPTY) out.push([i % W, (i / W) | 0, e, this.life[i]]);
    }
    return out;
  }
}

function scene(build: (c: Canvas) => void): SceneBuilder {
  return (seed) => {
    const c = new Canvas(mulberry32(seed));
    build(c);
    return c.cells();
  };
}

const ri = (c: Canvas, a: number, b: number): number => a + Math.floor(c.rng() * (b - a + 1));

// ─── Terrain ────────────────────────────────────────────────────
/** Rolling surface: the top row of each column, `base` ± `amp`, from three sines with random phase. */
function surface(c: Canvas, base: number, amp: number): number[] {
  const p = [c.rng() * 7, c.rng() * 7, c.rng() * 7];
  return Array.from({ length: W }, (_, x) =>
    Math.round(base + amp * (0.6 * Math.sin(x / 47 + p[0]) + 0.3 * Math.sin(x / 19 + p[1]) + 0.1 * Math.sin(x / 7 + p[2]))));
}

/** Lower the surface into a bowl between x0 and x1. */
function dig(surf: number[], x0: number, x1: number, depth: number): void {
  for (let x = x0; x <= x1; x++) surf[x] += Math.round(depth * Math.sin(((x - x0) / (x1 - x0)) * Math.PI) ** 0.6);
}

/** Stone from the surface down, flecked with ash "gravel", under `depth` cells of `top`. */
function land(c: Canvas, surf: number[], top = 0, depth = 3): void {
  for (let x = 0; x < W; x++) {
    c.rect(x, surf[x], 1, H - surf[x], Element.STONE);
    if (top) c.rect(x, surf[x], 1, depth, top);
  }
  for (let n = 0; n < 500; n++) {
    const x = ri(c, 0, W - 1), y = ri(c, surf[x] + depth + 3, H + 20);
    if (y < H) c.set(x, y, Element.ASH);
  }
}

/** Fill the air between `level` and the ground with a liquid, wherever the ground is lower. */
function flood(c: Canvas, surf: number[], x0: number, x1: number, level: number, e: number): void {
  for (let x = x0; x <= x1; x++) if (surf[x] > level) c.rect(x, level, 1, surf[x] - level, e);
}

/** A strip of VOID that only swallows from above: wrapped in WALL because void eats its neighbours. */
function drain(c: Canvas, x0: number, x1: number, y: number): void {
  c.rect(x0 - 1, y, x1 - x0 + 3, 3, Element.WALL);
  c.rect(x0, y, x1 - x0 + 1, 1, Element.VOID);
}

// ─── Props ──────────────────────────────────────────────────────
function tree(c: Canvas, x: number, base: number, h: number): void {
  const r = Math.round(h / 3);
  c.rect(x - 1, base - h + r, 3, h - r, Element.WOOD);
  c.disc(x, base - h + r, r, Element.PLANT);
  c.disc(x - r + 1, base - h + r + 2, r - 2, Element.PLANT);
  c.disc(x + r - 1, base - h + r + 2, r - 2, Element.PLANT);
}

function pine(c: Canvas, x: number, base: number, h: number): void {
  const top = base - h, hw = Math.max(3, Math.round(h / 3.5));
  for (let y = top; y < base - 3; y++) {
    // Tiers: the width grows down the tree and sawtooths every 5 rows.
    const half = Math.round(((y - top) / (h - 3)) * hw * (0.6 + ((y - top) % 5) / 10));
    c.rect(x - half, y, 1 + 2 * half, 1, Element.PLANT);
  }
  c.rect(x, base - 4, 1, 4, Element.WOOD);
}

function palm(c: Canvas, x: number, base: number, h: number, lean: number): void {
  const tx = x + lean, ty = base - h;
  c.line(x, base, tx, ty, Element.WOOD, 2);
  for (const [dx, dy] of [[-10, 3], [-7, -3], [0, -6], [7, -3], [10, 3]]) c.line(tx, ty, tx + dx, ty + dy, Element.PLANT, 2);
}

function vine(c: Canvas, x: number, y: number, len: number): void {
  for (let i = 0; i < len; i++) if (c.rng() < 0.85) c.set(x, y + i, Element.PLANT);
}

/** Round-bottomed glass flask standing on `base`, filled to `frac` of its height. `cork` seals it. */
function flask(c: Canvas, cx: number, base: number, r: number, e: number, frac: number, cork = false): void {
  const cy = base - r;
  c.disc(cx, cy, r, Element.GLASS);
  c.disc(cx, cy, r - 2, Element.EMPTY);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= (r - 2) * (r - 2) && dy >= r - 2 - (2 * r - 4) * frac) c.set(cx + dx, cy + dy, e);
  c.rect(cx - 3, cy - r - 6, 7, 8, Element.GLASS);
  c.rect(cx - 1, cy - r - 6, 3, 9, frac >= 1 ? e : Element.EMPTY);
  if (cork) c.rect(cx - 3, cy - r - 8, 7, 2, Element.WOOD);
}

/** Straight-sided open jar of `shell` standing on `base`, holding `fill` rows of e. */
function jar(c: Canvas, x0: number, base: number, w: number, h: number, e: number, fill: number, shell: number = Element.GLASS): void {
  c.rect(x0, base - h + 1, w, h, shell);
  c.rect(x0 + 2, base - h + 1, w - 4, h - 2, Element.EMPTY);
  c.rect(x0 + 2, base - 1 - fill, w - 4, fill, e);
}

/** Up to `n` buried pockets of a random element from `es`, placed only where the ground is solid all around. */
function buried(c: Canvas, n: number, es: number[], yMin: number): void {
  const solid = (x: number, y: number): boolean => {
    const e = c.get(x, y);
    return e === Element.STONE || e === Element.ASH || e === Element.SAND;
  };
  for (let t = 0, placed = 0; t < n * 12 && placed < n; t++) {
    const r = ri(c, 2, 5), d = r + 3, x = ri(c, 10, W - 11), y = ri(c, yMin, H - 11);
    if (![[0, 0], [-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, -d], [-d, d], [d, d]].every(([i, j]) => solid(x + i, y + j))) continue;
    c.disc(x, y, r, es[ri(c, 0, es.length - 1)]);
    placed++;
  }
}

function cactus(c: Canvas, x: number, base: number, h: number): void {
  c.rect(x, base - h, 2, h, Element.PLANT);
  const a = base - Math.round(h * 0.55);
  c.rect(x - 3, a, 3, 1, Element.PLANT);
  c.rect(x - 3, a - 3, 1, 3, Element.PLANT);
  c.rect(x + 2, a - 2, 3, 1, Element.PLANT);
  c.rect(x + 4, a - 4, 1, 2, Element.PLANT);
}

/** A cabin of `w` x `h` wood with a stone roof and a doorway, standing on `base`. `smoke` adds a smoking chimney. */
function hut(c: Canvas, x: number, base: number, w: number, h: number, smoke = false): void {
  if (smoke) {
    c.rect(x + w - 4, base - h - 5, 2, 3, Element.STONE);
    c.set(x + w - 3, base - h - 6, Element.CLONE, Element.SMOKE);
  }
  c.rect(x, base - h, w, h, Element.WOOD);
  c.rect(x + 1, base - h + 1, w - 2, h - 2, Element.EMPTY);
  c.rect(x - 2, base - h - 2, w + 4, 2, Element.STONE);
  c.rect(x + Math.floor(w / 2) - 1, base - 4, 2, 4, Element.EMPTY);
}

/** A 5x5 sealed glass lantern at (x, y), its centre an eternal flame. */
function lantern(c: Canvas, x: number, y: number): void {
  c.rect(x, y, 5, 5, Element.GLASS);
  c.rect(x + 1, y + 1, 3, 3, Element.EMPTY);
  c.set(x + 2, y + 2, Element.CLONE, Element.FIRE);
}

/** A wooden crate of `w` x `h` standing on `base`, packed with `inside`. */
function crate(c: Canvas, x: number, base: number, w: number, h: number, inside: number): void {
  c.rect(x, base - h, w, h, Element.WOOD);
  c.rect(x + 1, base - h + 1, w - 2, h - 2, inside);
}

/** Scatter up to `n` fish through water in a box, keeping them at least 3 cells apart. */
function fishIn(c: Canvas, x0: number, y0: number, x1: number, y1: number, n: number): void {
  let placed = 0;
  for (let t = 0; t < n * 40 && placed < n; t++) {
    const x = ri(c, x0, x1), y = ri(c, y0, y1);
    if (c.get(x, y) !== Element.WATER) continue;
    let near = false;
    for (let j = -2; j <= 2 && !near; j++)
      for (let i = -2; i <= 2; i++) if (c.get(x + i, y + j) === Element.FISH) { near = true; break; }
    if (near) continue;
    c.set(x, y, Element.FISH);
    placed++;
  }
}

function hourglass(c: Canvas, cx: number, top: number, bot: number, half: number, e: number): void {
  const mid = (top + bot) / 2, span = (bot - top) / 2;
  for (let y = top; y <= bot; y++) {
    const h = Math.round(half * (Math.abs(y - mid) / span) ** 1.2);
    c.rect(cx - h - 2, y, 2 * h + 5, 1, Element.GLASS);
    c.rect(cx - h, y, 2 * h + 1, 1, y < mid - 3 && y > top + span * 0.3 ? e : Element.EMPTY);
  }
  for (const y of [top - 3, bot + 1]) c.rect(cx - half - 6, y, 2 * half + 13, 3, Element.WALL);
  for (const x of [cx - half - 6, cx + half + 5]) c.rect(x, top, 2, H - top, Element.WOOD);
}

// ─── Scenes ─────────────────────────────────────────────────────
const volcano = scene((c) => {
  const cx = ri(c, 140, 180);
  const surf = surface(c, 168, 5);
  dig(surf, 4, 70, 20);
  dig(surf, 250, 316, 20);
  for (let x = 0; x < W; x++) surf[x] = Math.min(surf[x], Math.round(48 + Math.abs(x - cx) * 1.25 + 2 * Math.sin(x / 4)));
  land(c, surf);
  for (let x = 0; x < W; x++) if (Math.abs(x - cx) > 88) c.rect(x, surf[x], 1, 3, Element.SAND);
  flood(c, surf, 4, 70, 171, Element.WATER);
  flood(c, surf, 250, 316, 171, Element.WATER);
  // Magma chamber and conduit; clones on the crater floor keep the eruption going.
  c.disc(cx, 158, 14, Element.LAVA);
  c.rect(cx - 2, 62, 5, 96, Element.LAVA);
  c.rect(cx - 6, 40, 13, 21, Element.EMPTY); // crater bowl: floor at 60, rim near 56
  c.rect(cx - 6, 61, 13, 1, Element.CLONE, Element.LAVA);
  for (const side of [-1, 1]) c.rect(cx + side * 8 - 1, 56, 2, 2, Element.CLONE, Element.LAVA); // rim vents feed the flanks
  c.set(cx + 9, 57, Element.CLONE, Element.SMOKE);
  for (const side of [-1, 1])
    for (let k = 0; k < 3; k++) {
      const x = cx + side * ri(c, 92, 118);
      if (x > 5 && x < W - 5 && surf[x] < 171) tree(c, x, surf[x], ri(c, 14, 22));
    }
  // A village of cabins on the lower slopes, and fish in the sea either side.
  for (const x of [cx - 78, cx + 78]) if (surf[x] < 150) {
    c.rect(x, surf[x], 12, 18, Element.STONE); // a level footing on the slope
    hut(c, x, surf[x], 12, 9, true);
  }
  // Snow on the upper slopes, a blind lava tube ending just under one flank, and pockets in the rock.
  for (let x = cx - 40; x <= cx + 40; x++) if (Math.abs(x - cx) > 15) c.rect(x, surf[x] - 2, 1, 2, Element.SNOW);
  c.line(cx, 112, cx + (c.rng() < 0.5 ? -50 : 50), 120, Element.LAVA, 3);
  buried(c, 7, [Element.GAS, Element.OIL, Element.WATER, Element.SAND], 110);
  fishIn(c, 4, 172, 70, 192, 4);
  fishIn(c, 250, 172, 316, 192, 4);
});

const waterfall = scene((c) => {
  const n = surface(c, 0, 3);
  const surf = n.map((d, x) => (x < 112 ? 60 : x < 122 ? 60 + (x - 112) * 9 : 150 + ((x - 122) * 20) / 198) + d).map(Math.round);
  for (let x = 0; x < 24; x++) surf[x] = Math.min(surf[x], 56);
  dig(surf, 24, 98, 18);
  for (let x = 90; x <= 112; x++) surf[x] = 64; // spillway lip, one row under the lake surface
  dig(surf, 124, 178, 14);
  land(c, surf, Element.SAND, 2);
  flood(c, surf, 24, 98, 63, Element.WATER);
  c.rect(0, 40, 34, 5, Element.STONE);
  c.rect(28, 45, 6, 1, Element.CLONE, Element.WATER); // the spring, under a rock ledge
  drain(c, 306, 317, surf[310]);
  for (const x of [8, 16, 200, 222, 278, 294]) tree(c, x + ri(c, -3, 3), surf[x], ri(c, 16, 26));
  // Plunge pool with fish, a footbridge over it, and a cabin on the far bank.
  const pool = Math.max(surf[123], surf[179]) + 1;
  flood(c, surf, 124, 178, pool, Element.WATER);
  fishIn(c, 126, pool + 1, 176, pool + 12, 5);
  c.rect(130, pool - 6, 48, 2, Element.WOOD);
  for (const x of [130, 176]) c.rect(x, pool - 6, 2, surf[x] - pool + 6, Element.WOOD);
  hut(c, 240, surf[247], 14, 10, true);
  // Reeds waiting on the river bank.
  for (let n = 0; n < 16; n++) { const x = ri(c, 182, 236); c.set(x, surf[x] - 1, Element.SEED); }
  // A sealed smugglers' cave inside the cliff: blast through the rock face to find it.
  c.rect(72, 104, 34, 18, Element.EMPTY);
  crate(c, 75, 122, 11, 8, Element.FIREWORK);
  crate(c, 90, 122, 9, 7, Element.TNT);
  lantern(c, 84, 105);
  buried(c, 5, [Element.GAS, Element.OIL, Element.SAND], 165);
});

const frozenLake = scene((c) => {
  const surf = surface(c, 118, 10);
  dig(surf, 85, 235, 46);
  land(c, surf, Element.SNOW, 3);
  const level = Math.max(surf[84], surf[236]) + 3;
  flood(c, surf, 85, 235, level, Element.WATER);
  for (let x = 85; x <= 235; x++) if (surf[x] > level) c.rect(x, level, 1, Math.min(5, surf[x] - level), Element.ICE);
  c.disc(ri(c, 140, 180), 190, 7, Element.LAVA); // sealed under the lake bed, slowly melting its way up
  fishIn(c, 90, level + 6, 230, level + 30, 9);
  const hx = ri(c, 110, 130);
  hut(c, hx, level, 16, 10, true); // a cabin on the ice, its lantern sealed inside
  lantern(c, hx + 5, level - 9);
  c.rect(hx + 24, level, 3, 5, Element.WATER); // fishing hole
  const ix = ri(c, 185, 212); // igloo
  for (let dy = -8; dy <= 0; dy++)
    for (let dx = -8; dx <= 8; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 <= 64 && d2 > 30) c.set(ix + dx, level - 1 + dy, Element.ICE);
    }
  buried(c, 6, [Element.GAS, Element.OIL, Element.SAND], level + 50);
  for (let k = 0; k < 4; k++) c.set(30 + k * 80 + ri(c, -12, 12), 0, Element.CLONE, Element.SNOW);
  for (let x = 12; x < W - 8; x += ri(c, 10, 16)) if (x < 76 || x > 244) pine(c, x, surf[x], ri(c, 18, 30));
});

const hourglassScene = scene((c) => {
  const surf = surface(c, 184, 3);
  land(c, surf, Element.SAND, 8);
  const fills = [Element.WATER, Element.SNOW, Element.SEED, Element.ASH, Element.GUNPOWDER];
  hourglass(c, 160, 14, 176, 46, Element.SAND);
  hourglass(c, 52, 96, 176, 22, fills[ri(c, 0, 4)]);
  hourglass(c, 268, 96, 176, 22, fills[ri(c, 0, 4)]);
  // Specimen jars on top of the small timers: a fish bowl, a seed bed in ash that sprouts at once, and worse.
  const flip = c.rng() < 0.5, a0 = flip ? 244 : 26, b0 = flip ? 26 : 244;
  jar(c, a0, 92, 14, 20, Element.WATER, 12);
  c.set(a0 + 6, 85, Element.FISH);
  jar(c, a0 + 18, 92, 14, 20, Element.ASH, 7);
  c.rect(a0 + 20, 83, 10, 1, Element.SEED);
  jar(c, a0 + 36, 92, 14, 20, Element.GUNPOWDER, ri(c, 6, 14));
  jar(c, b0, 92, 14, 20, Element.ACID, ri(c, 6, 12));
  jar(c, b0 + 18, 92, 14, 20, Element.OIL, ri(c, 6, 14));
  jar(c, b0 + 36, 92, 14, 20, Element.SNOW, ri(c, 6, 14));
  c.rect(b0 + 20, 70, 10, 2, Element.TNT); // balanced on the rim of the oil jar
  buried(c, 4, [Element.WATER, Element.GAS, Element.OIL], 186);
});

const powderKeg = scene((c) => {
  const surf = surface(c, 165, 4);
  for (let x = 90; x < W; x++) surf[x] = 165;
  land(c, surf, Element.SAND, 3);
  for (let k = 0; k < 3; k++) {
    const x0 = 112 + k * 68;
    c.rect(x0, 131, 44, 40, Element.WALL);
    c.rect(x0 + 3, 134, 38, 31, Element.EMPTY);
    c.rect(x0 + 3, 165 - ri(c, 14, 24), 38, 24, Element.GUNPOWDER);
    c.rect(x0 + 3, 165, 38, 6, Element.WALL);
    c.rect(x0 - 3, 127, 50, 4, Element.WOOD);
    c.rect(x0, 161, 44, 4, Element.GUNPOWDER); // doorways the fuse runs through
  }
  // Watchtower with a crate of fireworks, and the palisade.
  for (const x of [58, 70]) c.rect(x, 125, 2, surf[x] - 125, Element.WOOD);
  c.rect(54, 123, 22, 2, Element.WOOD);
  c.rect(60, 119, 10, 4, Element.FIREWORK);
  for (let x = 94; x < 104; x += 4) c.rect(x, 142, 3, 23, Element.WOOD);
  for (let x = 42; x < W - 6; x++) c.rect(x, surf[x] - 2, 1, 2, Element.GUNPOWDER); // the fuse
  // An eternal torch a short walk from the end of the fuse: the player has to carry the flame.
  c.rect(14, surf[15] - 12, 3, 12, Element.STONE);
  c.set(15, surf[15] - 13, Element.CLONE, Element.FIRE);
  // TNT stacked on the fuse between the sheds, oil drums, a flag, a well and what is buried under the fort.
  c.rect(163, 157, 10, 6, Element.TNT);
  c.rect(162, 155, 12, 2, Element.WOOD);
  for (const x of [228, 238]) jar(c, x, 162, 9, ri(c, 9, 13), Element.OIL, 6, Element.WALL);
  c.rect(64, 106, 1, 13, Element.WOOD);
  c.rect(65, 106, 7, 4, Element.PLANT);
  jar(c, 24, surf[30] + 2, 13, 8, Element.WATER, 5, Element.STONE);
  tree(c, 305, 165, ri(c, 14, 20));
  buried(c, 7, [Element.GAS, Element.OIL, Element.GUNPOWDER, Element.TNT], 178);
});

const fireworksNight = scene((c) => {
  c.rect(0, 178, W, 22, Element.STONE);
  for (let x = 3, cups = 0; x < W - 20;) {
    const w = ri(c, 20, 40), h = ri(c, 30, 100), top = 178 - h;
    c.rect(x, top, w, h, Element.WALL);
    for (let yy = top + 4; yy < 172; yy += 6)
      for (let xx = x + 3; xx < x + w - 3; xx += 5) if (c.rng() < 0.6) c.rect(xx, yy, 2, 3, Element.GLASS);
    if (cups < 8 && c.rng() < 0.8) {
      // A cup of fireworks, a wooden wick of random length, an eternal flame at its far end.
      const mx = x + 6, len = ri(c, 2, w - 16);
      c.rect(mx - 4, top - 6, 9, 6, Element.WALL);
      c.rect(mx - 3, top - 6, 7, 5, Element.FIREWORK);
      c.rect(mx + 4, top - 2, len + 1, 1, Element.WOOD);
      // Every other wick is already lit. The rest wait for a stray spark from a neighbour's burst, or for you.
      if (cups % 2 === 0) c.set(mx + 5 + len, top - 2, Element.CLONE, Element.FIRE);
      cups++;
    } else if (w > 22) {
      // Rooftops without a launcher get a water tank, a garden or a smoking chimney.
      const r = c.rng();
      if (r < 0.35) jar(c, x + 4, top - 1, 13, 9, Element.WATER, 6, Element.WALL);
      else if (r < 0.7) c.rect(x + 2, top - 2, w - 4, 2, Element.PLANT);
      else { c.rect(x + w - 7, top - 5, 3, 5, Element.STONE); c.set(x + w - 6, top - 6, Element.CLONE, Element.SMOKE); }
    }
    if (c.rng() < 0.2) c.rect(x + 2, 173, w - 4, 3, Element.TNT); // demolition charges in the ground floor
    x += w + ri(c, 1, 4);
  }
  c.rect(6, 187, W - 12, 3, Element.GAS); // the gas main under the street
  const mx = ri(c, 40, 280);
  c.disc(mx, 24, 11, Element.ICE); // crescent moon
  c.disc(mx + 6, 21, 10, Element.EMPTY);
});

const hangingGardens = scene((c) => {
  const surf = surface(c, 178, 3);
  dig(surf, 70, 150, 8);
  land(c, surf);
  c.rect(0, 28, 56, 4, Element.STONE);
  c.rect(46, 32, 8, 1, Element.CLONE, Element.WATER);
  for (let k = 0; k < 4; k++) {
    const y = 56 + k * 30, x0 = k % 2 ? 108 : 38, w = 172;
    const lowX = k % 2 ? x0 : x0 + w - 3, tallX = k % 2 ? x0 + w - 3 : x0;
    c.rect(x0, y, w, 6, Element.STONE);
    c.rect(tallX, y - 10, 3, 10, Element.STONE);
    c.rect(lowX, y - 3, 3, 3, Element.STONE);
    c.rect(x0 + 3, y - 3, w - 6, 3, Element.WATER);
    for (let n = 0; n < 9; n++) c.set(ri(c, x0 + 6, x0 + w - 7), y - 1, Element.SEED);
    for (let x = x0 + 4; x < x0 + w - 4; x += ri(c, 5, 12)) vine(c, x, y + 6, ri(c, 4, 16));
    fishIn(c, x0 + 4, y - 3, x0 + w - 5, y - 2, 3);
  }
  // A temple on the heights with a brazier that never goes out, and seed beds in ash at its foot.
  for (const x of [286, 313]) c.rect(x, 53, 3, surf[x] - 53, Element.STONE);
  c.rect(238, 50, 80, 3, Element.STONE);
  c.rect(240, 28, 76, 3, Element.STONE);
  for (let k = 0; k < 10; k++) c.rect(244 + k * 4, 27 - k, 68 - k * 8, 1, Element.STONE);
  for (const x of [244, 262, 290, 308]) c.rect(x, 31, 3, 19, Element.STONE);
  c.rect(273, 47, 7, 3, Element.STONE);
  c.set(276, 46, Element.CLONE, Element.FIRE);
  for (let x = 36; x < 68; x++) {
    c.set(x, surf[x] - 1, Element.ASH);
    if (c.rng() < 0.3) c.set(x, surf[x] - 2, Element.SEED);
  }
  buried(c, 4, [Element.WATER, Element.SAND, Element.GAS], 184);
  drain(c, 100, 112, surf[106]);
  for (const x of [14, 26, 296, 308]) tree(c, x, surf[x], ri(c, 18, 28));
});

const gasMine = scene((c) => {
  const surf = surface(c, 36, 5);
  land(c, surf, Element.SAND, 2);
  const upper = (x: number) => Math.round(76 + (x - 50) / 44), lower = (x: number) => Math.round(142 - (x - 30) / 52);
  c.line(50, 76, 270, 81, Element.EMPTY, 13);
  c.line(30, 142, 290, 137, Element.EMPTY, 15);
  c.line(270, 81, 290, 137, Element.EMPTY, 11);
  c.rect(56, 20, 9, 60, Element.EMPTY); // the shaft
  for (const x of [100, 170, 235]) c.disc(x, upper(x) - 9, 9, Element.GAS);
  for (const x of [80, 150, 220]) c.disc(x, lower(x) - 10, 10, Element.GAS);
  for (const x of [120, 200]) c.rect(x, lower(x) + 7, 24, 7, Element.OIL);
  for (let x = 75; x < 265; x += 32) {
    c.rect(x, upper(x) - 6, 2, 13, Element.WOOD);
    c.rect(x - 3, upper(x) - 6, 8, 1, Element.WOOD);
  }
  for (let x = 45; x < 285; x += 34) {
    c.rect(x, lower(x) - 7, 2, 15, Element.WOOD);
    c.rect(x - 3, lower(x) - 7, 8, 1, Element.WOOD);
  }
  jar(c, 255, lower(255) + 7, 14, 9, Element.GUNPOWDER, 6, Element.WOOD);
  c.disc(110, 110, 8, Element.WATER);
  fishIn(c, 102, 103, 118, 117, 2);
  c.disc(ri(c, 200, 280), 182, 9, Element.LAVA);
  // Headframe over the shaft, and a lantern well away from it.
  c.line(48, surf[48], 60, 8, Element.WOOD, 2);
  c.line(72, surf[72], 60, 8, Element.WOOD, 2);
  c.rect(52, 18, 17, 2, Element.WOOD);
  c.rect(288, surf[289] - 10, 3, 10, Element.STONE);
  c.set(289, surf[289] - 11, Element.CLONE, Element.FIRE);
  // Pit village on the surface; below, a TNT store, an ore cart, sealed lamps, a flooded gallery and ore pockets.
  hut(c, 150, surf[156], 14, 9, true);
  for (const x of [108, 128, 190, 214, 238]) tree(c, x + ri(c, -4, 4), surf[x], ri(c, 12, 18));
  crate(c, 33, lower(36) + 8, 9, 8, Element.TNT);
  crate(c, 163, lower(167) + 8, 10, 6, Element.SAND);
  for (const x of [130, 200]) lantern(c, x, upper(x) - 6);
  c.rect(58, 166, 118, 9, Element.WATER);
  fishIn(c, 60, 167, 174, 173, 5);
  buried(c, 9, [Element.SAND, Element.GAS, Element.OIL, Element.WATER, Element.GLASS], 92);
});

const alchemistLab = scene((c) => {
  c.rect(0, 0, W, 4, Element.WALL);
  c.rect(0, 0, 4, H, Element.WALL);
  c.rect(W - 4, 0, 4, H, Element.WALL);
  c.rect(0, 186, W, 14, Element.WALL);
  for (const y of [78, 142]) c.rect(4, y, W - 8, 3, Element.WOOD);
  const liquids = [Element.WATER, Element.ACID, Element.OIL, Element.LAVA, Element.GAS];
  const solids = [Element.GUNPOWDER, Element.SEED, Element.SNOW, Element.SAND, Element.FIREWORK];
  for (let k = 0; k < 5; k++) {
    const e = liquids.splice(ri(c, 0, liquids.length - 1), 1)[0];
    flask(c, 40 + k * 60, 77, ri(c, 15, 20), e, e === Element.GAS ? 1 : 0.35 + c.rng() * 0.3, e === Element.GAS);
    jar(c, 26 + k * 60, 141, 28, ri(c, 26, 44), solids.splice(ri(c, 0, solids.length - 1), 1)[0], ri(c, 10, 22));
  }
  // A dripping tap over a cauldron that overflows to a floor drain; a hooded brazier.
  c.set(200, 145, Element.CLONE, Element.WATER);
  jar(c, 176, 185, 50, 24, Element.WATER, 12, Element.STONE);
  drain(c, 236, 250, 186);
  c.rect(54, 178, 13, 8, Element.STONE);
  c.set(60, 177, Element.CLONE, Element.FIRE);
  c.rect(48, 154, 25, 3, Element.STONE);
  // On the floor: a fish tank, a terrarium of seeds in ash, a glass cabinet of TNT. Sealed lamps under the top shelf.
  jar(c, 84, 185, 36, 20, Element.WATER, 15);
  fishIn(c, 86, 169, 117, 183, 4);
  jar(c, 128, 185, 30, 26, Element.ASH, 6);
  c.rect(131, 177, 24, 1, Element.SEED);
  c.rect(262, 160, 46, 26, Element.GLASS);
  c.rect(264, 162, 42, 22, Element.EMPTY);
  c.rect(266, 184 - ri(c, 8, 14), 38, 14, Element.TNT);
  c.rect(262, 184, 46, 2, Element.GLASS);
  for (const x of [68, 188]) lantern(c, x, 81);
});

const desertOasis = scene((c) => {
  const surf = surface(c, 132, 12);
  dig(surf, 118, 202, 24);
  for (let x = 0; x < W; x++) {
    c.rect(x, surf[x], 1, H - surf[x], Element.SAND);
    c.rect(x, 182 + Math.round(4 * Math.sin(x / 21)), 1, 20, Element.STONE);
  }
  const lvl = Math.max(surf[117], surf[203]) + 5;
  flood(c, surf, 118, 202, lvl, Element.WATER);
  fishIn(c, 122, lvl + 1, 198, lvl + 9, 4);
  for (const x of [108, 114, 207, 216]) palm(c, x, surf[x], ri(c, 22, 34), ri(c, -8, 8));
  for (let n = 0; n < 10; n++) { const x = c.rng() < 0.5 ? ri(c, 112, 119) : ri(c, 201, 208); c.set(x, surf[x] - 1, Element.SEED); }
  // A stepped pyramid with a sealed treasure chamber, and an oil field with a gas cap under the dunes.
  const px = ri(c, 250, 272), base = Math.max(surf[px - 36], surf[px + 36]) + 3;
  for (let k = 0; k < 9; k++) c.rect(px - 36 + k * 4, base - (k + 1) * 5, 72 - k * 8, 5, Element.STONE);
  c.rect(px - 9, base - 14, 18, 10, Element.EMPTY);
  c.rect(px - 7, base - 8, 14, 4, Element.FIREWORK);
  c.rect(px + 3, base - 8, 4, 4, Element.TNT);
  c.rect(px - 6, base - 31, 12, 8, Element.GLASS); // an acid trap in a glass-lined cell above the treasure
  c.rect(px - 4, base - 29, 8, 4, Element.ACID);
  // Cacti on the dunes, a tent, and a sun of molten glass you can crack.
  for (let n = 0; n < 9; n++) {
    const x = ri(c, 8, W - 9);
    if ((x > 98 && x < 224) || Math.abs(x - px) < 42) continue;
    cactus(c, x, surf[x], ri(c, 7, 13));
  }
  const tx = ri(c, 70, 84);
  c.line(tx - 8, surf[tx - 8], tx, surf[tx] - 11, Element.WOOD);
  c.line(tx + 8, surf[tx + 8], tx, surf[tx] - 11, Element.WOOD);
  const sx = ri(c, 36, 120);
  c.disc(sx, 22, 9, Element.GLASS);
  c.disc(sx, 22, 7, Element.LAVA);
  buried(c, 6, [Element.WATER, Element.GAS, Element.GLASS], 160);
  const ox = ri(c, 40, 70);
  c.disc(ox, 166, 15, Element.STONE);
  c.disc(ox, 166, 12, Element.OIL);
  c.rect(ox - 8, 155, 17, 5, Element.GAS);
});

const crystalCave = scene((c) => {
  c.rect(0, 0, W, H, Element.STONE);
  for (let n = 0; n < 700; n++) c.set(ri(c, 0, W - 1), ri(c, 0, H - 1), Element.ASH);
  const ceil = surface(c, 44, 10), floor = surface(c, 150, 8);
  dig(floor, 118, 200, 16);
  dig(floor, 258, 306, 10);
  for (let x = 6; x < W - 6; x++) c.rect(x, ceil[x], 1, floor[x] - ceil[x], Element.EMPTY);
  for (let n = 0; n < 16; n++) {
    const x = ri(c, 12, W - 13), up = n % 3 === 0, len = ri(c, 6, up ? 14 : 26);
    for (let j = 0; j < len; j++) {
      const half = Math.round((1 - j / len) * 3);
      c.rect(x - half, up ? floor[x] - j : ceil[x] + j, 2 * half + 1, 1, Element.STONE);
    }
  }
  for (let n = 0; n < 12; n++) {
    const x = ri(c, 14, W - 15), up = c.rng() < 0.6, e = c.rng() < 0.5 ? Element.ICE : Element.GLASS;
    if (x > 112 && x < 206) continue;
    for (let k = 0; k < 4; k++) c.line(x, up ? floor[x] : ceil[x], x + ri(c, -9, 9), (up ? floor[x] : ceil[x]) + (up ? -1 : 1) * ri(c, 6, 20), e, 2);
  }
  const level = Math.max(floor[117], floor[201]) + 4;
  flood(c, floor, 118, 200, level, Element.WATER);
  fishIn(c, 120, level + 1, 190, level + 10, 7);
  drain(c, 196, 198, level - 2);
  c.set(140, ceil[140], Element.CLONE, Element.WATER);
  c.set(172, ceil[172], Element.CLONE, Element.SNOW); // snow sifting through a crack, melting on the lake
  // An explorers' camp, a seed bed in ash, and crystal and gas pockets in the rock.
  crate(c, 22, floor[26], 9, 7, Element.TNT);
  c.rect(36, ceil[36], 1, floor[36] - ceil[36], Element.WOOD);
  c.rect(39, ceil[39], 1, floor[39] - ceil[39], Element.WOOD);
  for (let y = ceil[37] + 4; y < floor[37]; y += 5) c.rect(37, y, 2, 1, Element.WOOD);
  for (let x = 80; x < 106; x++) {
    c.set(x, floor[x] - 1, Element.ASH);
    if (c.rng() < 0.3) c.set(x, floor[x] - 2, Element.SEED);
  }
  buried(c, 12, [Element.GAS, Element.GLASS, Element.ICE, Element.OIL, Element.LAVA], 4);
  flood(c, floor, 258, 306, Math.max(floor[257], floor[307]) + 3, Element.LAVA);
  jar(c, 46, floor[60] + 3, 28, 14, Element.ACID, 9);
  for (let x = 10; x < 110; x += ri(c, 3, 7)) vine(c, x, ceil[x], ri(c, 2, 9));
});

const oilRig = scene((c) => {
  const bed = surface(c, 152, 5);
  land(c, bed, Element.SAND, 4);
  flood(c, bed, 0, W - 1, 106, Element.WATER);
  for (let y = 166; y < 194; y++)
    for (let x = 95; x < 245; x++)
      if (((x - 170) / 72) ** 2 + ((y - 180) / 13) ** 2 < 1) c.set(x, y, y < 173 ? Element.GAS : Element.OIL);
  for (const x of [118, 200]) c.rect(x, 92, 4, bed[x] - 88, Element.WALL);
  c.line(120, 106, 202, 150, Element.WALL, 1);
  c.line(202, 106, 120, 150, Element.WALL, 1);
  c.rect(106, 88, 110, 4, Element.WALL);
  c.rect(159, 28, 2, 133, Element.WALL); // drill string, stopping just short of the gas cap
  c.line(146, 87, 157, 28, Element.WOOD, 2);
  c.line(174, 87, 163, 28, Element.WOOD, 2);
  for (let y = 78; y > 34; y -= 14) c.line(160 - (y - 28) / 4.5, y, 160 + (y - 28) / 4.5, y, Element.WOOD, 1);
  c.rect(110, 70, 24, 18, Element.WALL);
  for (let x = 113; x < 131; x += 6) c.rect(x, 74, 3, 4, Element.GLASS);
  jar(c, 182, 87, 28, 16, Element.OIL, 11, Element.WALL);
  // Flare stack: a gas source with an eternal flame beside it.
  c.line(214, 88, 258, 58, Element.WALL, 2);
  c.set(260, 56, Element.CLONE, Element.GAS);
  c.set(262, 57, Element.CLONE, Element.FIRE);
  c.rect(ri(c, 10, 60), 105, ri(c, 20, 40), 1, Element.OIL);
  fishIn(c, 6, 110, 310, 140, 14);
  // A supply boat with a cargo of fireworks, a wreck on the seabed, and more pockets under it.
  const bx = ri(c, 264, 286);
  c.rect(bx, 103, 26, 1, Element.WOOD);
  c.rect(bx + 2, 104, 22, 3, Element.WOOD);
  c.rect(bx + 15, 96, 8, 7, Element.WOOD);
  c.rect(bx + 16, 97, 6, 5, Element.EMPTY);
  c.rect(bx + 4, 100, 7, 3, Element.FIREWORK);
  for (const x of [bx + 3, bx + 11]) c.rect(x, 99, 1, 4, Element.WOOD);
  const wx = ri(c, 24, 60);
  c.line(wx, bed[wx] - 1, wx + 26, bed[wx + 26] - 7, Element.WOOD, 2);
  c.rect(wx + 13, bed[wx + 13] - 20, 1, 16, Element.WOOD);
  c.rect(wx + 6, bed[wx + 6] - 3, 5, 2, Element.GLASS);
  buried(c, 5, [Element.OIL, Element.GAS, Element.LAVA], 162);
  crate(c, 94, 88, 10, 8, Element.TNT); // a crate of TNT on the rig's lee side
});

// ─── Registry ───────────────────────────────────────────────────
export interface SceneInfo {
  name: string;
  /** One sentence telling the player what to try. */
  description: string;
  generate: SceneBuilder;
}

export const SCENES: SceneInfo[] = [
  { name: 'Volcano', description: 'The crater never stops welling up, a lava tube waits under one flank, and the cabins below are in the way.', generate: volcano },
  { name: 'Waterfall Canyon', description: 'A spring-fed lake spills over the cliff, and something is sealed inside the rock behind the falls.', generate: waterfall },
  { name: 'Frozen Lake', description: 'Fish circle under thick ice while snow falls and something hot stirs below the lake bed.', generate: frozenLake },
  { name: 'Hourglass', description: 'Three glass timers are running under a shelf of jars; crack one open or flip gravity.', generate: hourglassScene },
  { name: 'Powder Keg', description: 'Carry a flame from the torch to the fuse, then stand well back from the TNT.', generate: powderKeg },
  { name: 'Fireworks Night', description: 'Half the rooftop wicks are already burning, the rest are yours to light, and a gas main runs under the street.', generate: fireworksNight },
  { name: 'Hanging Gardens', description: 'Water steps down the terraces past fish and vines, under a temple whose fire never goes out.', generate: hangingGardens },
  { name: 'Gas Mine', description: 'Gas has pooled under the gallery roofs, the timbers are dry, and someone left TNT at the bottom.', generate: gasMine },
  { name: "Alchemist's Lab", description: 'Every flask holds something different, so break the glass and mix them, cabinet of TNT included.', generate: alchemistLab },
  { name: 'Desert Oasis', description: 'Palms drink at the pool, the pyramid hides a trap over its treasure, and the sun will crack.', generate: desertOasis },
  { name: 'Crystal Cave', description: 'A dripping cavern of ice and glass lit by a lava pool, with an old camp by the ladder.', generate: crystalCave },
  { name: 'Oil Rig', description: 'The drill has stopped just short of the reservoir, so finish the job and mind the flare.', generate: oilRig },
];

/**
 * Pack a scene as 6-byte records (x u16 LE, y u16 LE, element u8, life u8), one per position.
 */
export function buildScenePlacement(sceneIndex: number, seed: number): ArrayBuffer {
  const scene = SCENES[sceneIndex];
  if (!scene) return new ArrayBuffer(0);
  const cells = scene.generate(seed);

  // Index of the last cell written to each grid position (-1 = none).
  const last = new Int32Array(GRID_W * GRID_H).fill(-1);
  for (let i = 0; i < cells.length; i++) {
    const [x, y] = cells[i];
    if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H)
      last[y * GRID_W + x] = i;
  }

  let count = 0;
  for (let p = 0; p < last.length; p++)
    if (last[p] >= 0) count++;

  const buf = new ArrayBuffer(count * 6);
  const view = new DataView(buf);
  let off = 0;
  for (let i = 0; i < cells.length; i++) {
    const [x, y, elem, life] = cells[i];
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) continue;
    if (last[y * GRID_W + x] !== i) continue;
    view.setUint16(off, x, true);
    view.setUint16(off + 2, y, true);
    view.setUint8(off + 4, elem);
    view.setUint8(off + 5, life);
    off += 6;
  }
  return buf;
}

/** Pick a random scene index */
export function randomSceneIndex(rng: () => number): number {
  return Math.floor(rng() * SCENES.length);
}
