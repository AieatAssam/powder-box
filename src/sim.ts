// Pure falling-sand engine. No DOM or worker APIs; all randomness goes through the injected rng.

import { KIND, DENSITY, MATERIALS, GRID_W, GRID_H, ELEMENT_COUNT, SAVE_MAGIC, SAVE_HEADER_BYTES } from './types';

// Local copies of the Element and Kind const enums (ids are a save-format contract, see types.ts).
// Reading an imported const enum or table costs about 9x a local in the hot loops under the
// vitest transform, so the engine uses these. Keep them in sync with types.ts.
const E_EMPTY = 0, E_SAND = 1, E_WATER = 2, E_FIRE = 3, E_WALL = 4, E_WOOD = 5, E_OIL = 6, E_PLANT = 7,
  E_LAVA = 8, E_STEAM = 9, E_SMOKE = 10, E_ACID = 11, E_GLASS = 12, E_STONE = 13, E_ICE = 14, E_SNOW = 15,
  E_GUNPOWDER = 16, E_GAS = 17, E_ASH = 18, E_SEED = 19, E_FIREWORK = 20, E_SPARK = 21, E_CLONE = 22, E_VOID = 23;
const K_EMPTY = 0, K_POWDER = 1, K_LIQUID = 2, K_GAS = 3, K_SOLID = 4, K_ENERGY = 5;
const KD = KIND, DEN = DENSITY;

// Neighbour offsets: first 4 are orthogonal, last 4 diagonal.
const SX = Int8Array.from([-1, 1, 0, 0, -1, 1, -1, 1]);
const SY = Int8Array.from([0, 0, -1, 1, -1, -1, 1, 1]);
const FLAM = Float32Array.from(MATERIALS, m => m.flammability);

const DISP = new Uint8Array(ELEMENT_COUNT); // liquid sideways dispersion
DISP[E_WATER] = 8; DISP[E_ACID] = 6; DISP[E_OIL] = 5; DISP[E_LAVA] = 1;

// Terminal fall speed (cells per tick is 1 + vel/2). 0 = no acceleration (snow, ash, lava, gas, the rest).
const TERM = new Uint8Array(ELEMENT_COUNT);
TERM[E_SAND] = 6; TERM[E_GUNPOWDER] = 6; TERM[E_SEED] = 6; TERM[E_WATER] = 6; TERM[E_ACID] = 6; TERM[E_OIL] = 4;

// Step skipping: INERT elements never act; BULK elements with the same element on all 4 sides do nothing.
const INERT = new Uint8Array(ELEMENT_COUNT);
INERT[E_WALL] = 1; INERT[E_GLASS] = 1;
const BULK = new Uint8Array(ELEMENT_COUNT);
for (const e of [E_SAND, E_WATER, E_OIL, E_ACID, E_LAVA, E_STONE, E_ICE, E_SNOW, E_ASH, E_GUNPOWDER, E_SEED, E_PLANT, E_WOOD]) BULK[e] = 1;

// Glow strength (0..256) per glowing element. Burning wood is handled separately.
const GLOW = new Uint16Array(ELEMENT_COUNT);
GLOW[E_FIRE] = 140; GLOW[E_SPARK] = 180; GLOW[E_LAVA] = 110; GLOW[E_ACID] = 40;

// Neighbour-type bits for the 8-neighbourhood mask.
const B_HOT = 1, B_STEAM = 2, B_WATER = 4, B_ICE = 8, B_LAVA = 16, B_SNOW = 32;
const BIT = new Uint8Array(ELEMENT_COUNT);
BIT[E_FIRE] = B_HOT; BIT[E_LAVA] = B_HOT | B_LAVA; BIT[E_STEAM] = B_STEAM;
BIT[E_WATER] = B_WATER; BIT[E_ICE] = B_ICE; BIT[E_SNOW] = B_SNOW;

// Colour variants: COL[(e * 4 + v) * 3 + c], NV[e] = variant count.
const COL = new Uint8Array(ELEMENT_COUNT * 12);
const NV = new Uint8Array(ELEMENT_COUNT);
for (let e = 0; e < ELEMENT_COUNT; e++) {
  const cs = MATERIALS[e].colors;
  NV[e] = Math.min(4, cs.length);
  for (let v = 0; v < NV[e]; v++) for (let c = 0; c < 3; c++) COL[(e * 4 + v) * 3 + c] = cs[v][c];
}
// Spark palette: white, gold, red, magenta, violet, cyan, green, orange.
const SPARK_PAL = Uint8Array.from([255, 255, 255, 255, 200, 60, 230, 40, 40, 230, 60, 200, 150, 80, 255, 60, 220, 255, 90, 230, 90, 255, 140, 40]);

/** Clamp a colour channel to 0..255, truncated to an integer. */
function clamp255(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

/** Round and clamp to [lo, hi]. NaN maps to lo. */
function toInt(v: number, lo: number, hi: number): number {
  const n = Math.round(v);
  return n >= lo ? (n <= hi ? n : hi) : lo;
}

export class Sim {
  readonly w: number;
  readonly h: number;
  grid: Uint8Array;
  life: Uint8Array;
  gravity: 1 | -1 = 1;
  wind: -1 | 0 | 1 | 2 = 0;
  tickNum = 0;
  private stamp: Uint8Array; // cell was written this tick (moved into or created): skip it
  private vel: Uint8Array;   // per-cell fall speed for powders and liquids (not saved)
  private depth: Uint8Array; // render scratch: liquid cells seen so far in each column
  private cur = 1;           // stamp value for this tick, cycles 1..255 so 0 never matches
  private eff = 0;           // effective wind for this tick
  private glowBuf: Uint16Array;
  private hash: Uint32Array;
  private rng: () => number;

  constructor(w = GRID_W, h = GRID_H, rng: () => number = Math.random) {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
    const n = this.w * this.h;
    this.grid = new Uint8Array(n);
    this.life = new Uint8Array(n);
    this.stamp = new Uint8Array(n);
    this.vel = new Uint8Array(n);
    this.depth = new Uint8Array(this.w);
    this.glowBuf = new Uint16Array(n * 3);
    this.hash = new Uint32Array(n); // per-cell colour-variant hash, fixed for the life of the sim
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      this.hash[y * this.w + x] = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
    }
    this.rng = rng;
  }

  // ─── Public API ───────────────────────────────────────────────

  step(): void {
    const w = this.w, h = this.h, grid = this.grid, stamp = this.stamp;
    this.tickNum++;
    this.cur = (this.tickNum % 255) + 1;
    if (this.cur === 1) stamp.fill(0); // stamp values wrap every 255 ticks; drop stale ones
    const cur = this.cur, g = this.gravity, flip = this.tickNum & 1;
    this.eff = this.wind === 2 ? (((this.tickNum / 90) | 0) & 1 ? 1 : -1) : this.wind;
    // Rows from the gravity floor upward; x direction alternates each tick.
    for (let k = 0; k < h; k++) {
      const y = g === 1 ? h - 1 - k : k;
      for (let m = 0; m < w; m++) {
        const x = flip ? w - 1 - m : m;
        const i = y * w + x;
        const e = grid[i];
        if (e === 0 || stamp[i] === cur || INERT[e]) continue;
        // Interior fast path. Wood and plant with a live counter (burning, growing) still take the slow path.
        if (BULK[e] && x > 0 && x < w - 1 && y > 0 && y < h - 1 && grid[i - 1] === e && grid[i + 1] === e &&
            grid[i - w] === e && grid[i + w] === e && (this.life[i] === 0 || (e !== E_WOOD && e !== E_PLANT))) continue;
        this.update(i, x, y, e);
      }
    }
  }

  paint(x0: number, y0: number, x1: number, y1: number, element: number, radius: number): void {
    if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(radius))) return;
    if (!(element >= 0 && element < ELEMENT_COUNT)) return;
    const e = element | 0;
    const r = toInt(radius, 0, 64);
    // Clamp endpoints so the stroke stays bounded; discs that reach the grid still stamp.
    let x = toInt(x0, -r - 1, this.w + r), y = toInt(y0, -r - 1, this.h + r);
    const ex = toInt(x1, -r - 1, this.w + r), ey = toInt(y1, -r - 1, this.h + r);
    const dx = Math.abs(ex - x), sx = x < ex ? 1 : -1;
    const dy = -Math.abs(ey - y), sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.disc(x, y, r, e);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  explode(x: number, y: number, radius: number): void {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(radius))) return;
    const w = this.w, h = this.h, grid = this.grid, life = this.life;
    const R = toInt(radius, 1, 64);
    // Clamp like paint(): off-grid centres keep their real position, so a far-off blast does nothing.
    const cx = toInt(x, -R - 1, w + R), cy = toInt(y, -R - 1, h + R);
    const inner = (R / 2) * (R / 2), R2 = R * R;
    for (let dy = -R; dy <= R; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= w) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        const j = yy * w + xx, n = grid[j];
        if (d2 <= inner) {
          // Inner blast: everything goes, some of it burns.
          if (n === E_VOID || n === E_CLONE) continue;
          this.place(j, this.rng() < 0.3 ? E_FIRE : E_EMPTY);
          continue;
        }
        // Outer ring.
        if (n === E_EMPTY) {
          const r = this.rng();
          if (r < 0.04) this.place(j, E_FIRE);
          else if (r < 0.06) this.place(j, E_SMOKE);
          else if (r < 0.065) this.place(j, E_SPARK);
          continue;
        }
        const kind = KD[n];
        if (kind === K_SOLID) {
          if ((n === E_WOOD || n === E_PLANT || n === E_GLASS || n === E_ICE || n === E_STONE) && this.rng() < 0.4) {
            this.place(j, E_EMPTY);
          }
          continue;
        }
        if (kind === K_ENERGY) continue;
        // Movable cell: throw it outward to the furthest free cell along the ray.
        const dist = Math.sqrt(d2), ux = dx / dist, uy = dy / dist, maxS = Math.floor(R - dist);
        let far = j;
        for (let s = 1; s <= maxS; s++) {
          const tx = xx + Math.round(ux * s), ty = yy + Math.round(uy * s);
          if (tx === xx && ty === yy) continue;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h || grid[ty * w + tx] !== 0) break;
          far = ty * w + tx;
        }
        if (far !== j) {
          const l = life[j];
          grid[far] = n; life[far] = l;
          grid[j] = 0; life[j] = 0;
          this.vel[far] = 0; this.vel[j] = 0;
        }
        if (FLAM[n] > 0 && this.rng() < 0.5) this.place(far, E_FIRE);
      }
    }
  }

  lightning(x: number, _y: number): void {
    if (!Number.isFinite(x)) return;
    const w = this.w, h = this.h, g = this.gravity, grid = this.grid;
    let cx = toInt(x, 0, w - 1);
    let y = g === 1 ? 0 : h - 1;
    let ix = cx, iy = y;
    while (y >= 0 && y < h) {
      const j = y * w + cx, n = grid[j];
      if (n !== E_EMPTY && KD[n] !== K_GAS) { ix = cx; iy = y; break; }
      this.put(j, E_SPARK, this.ri(4, 6));
      ix = cx; iy = y;
      cx = toInt(cx + this.ri(-1, 1), 0, w - 1);
      y += g;
    }
    this.explode(ix, iy, 5);
    for (let dy = -3; dy <= 3; dy++) {
      const yy = iy + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const xx = ix + dx;
        if (xx < 0 || xx >= w) continue;
        const d2 = dx * dx + dy * dy, j = yy * w + xx, n = grid[j];
        if (n === E_SAND && d2 <= 9) this.put(j, E_GLASS, 0);
        else if (n === E_WATER && d2 <= 4) this.place(j, E_STEAM);
      }
    }
  }

  clear(): void {
    this.grid.fill(0);
    this.life.fill(0);
    this.stamp.fill(0);
    this.vel.fill(0);
  }

  loadCells(buf: ArrayBuffer): void {
    const v = new DataView(buf);
    const count = Math.floor(buf.byteLength / 6);
    this.vel.fill(0);
    for (let k = 0; k < count; k++) {
      const o = k * 6;
      const x = v.getUint16(o, true), y = v.getUint16(o + 2, true);
      const e = v.getUint8(o + 4), l = v.getUint8(o + 5);
      if (x >= this.w || y >= this.h || e >= ELEMENT_COUNT) continue;
      const j = y * this.w + x;
      this.grid[j] = e;
      this.life[j] = l === 0 ? this.defLife(e) : l;
    }
  }

  serialize(): ArrayBuffer {
    const n = this.w * this.h;
    const buf = new ArrayBuffer(SAVE_HEADER_BYTES + n * 2);
    const v = new DataView(buf);
    v.setUint32(0, SAVE_MAGIC, true);
    v.setUint16(4, this.w, true);
    v.setUint16(6, this.h, true);
    new Uint8Array(buf, SAVE_HEADER_BYTES, n).set(this.grid);
    new Uint8Array(buf, SAVE_HEADER_BYTES + n, n).set(this.life);
    return buf;
  }

  deserialize(buf: ArrayBuffer): boolean {
    const n = this.w * this.h;
    if (buf.byteLength !== SAVE_HEADER_BYTES + n * 2) return false;
    const v = new DataView(buf);
    if (v.getUint32(0, true) !== SAVE_MAGIC || v.getUint16(4, true) !== this.w || v.getUint16(6, true) !== this.h) return false;
    const grid = new Uint8Array(buf, SAVE_HEADER_BYTES, n);
    for (let i = 0; i < n; i++) if (grid[i] >= ELEMENT_COUNT) return false;
    this.grid.set(grid);
    this.life.set(new Uint8Array(buf, SAVE_HEADER_BYTES + n, n));
    this.vel.fill(0);
    return true;
  }

  render(out: Uint8ClampedArray): number {
    const w = this.w, h = this.h, grid = this.grid, life = this.life, glow = this.glowBuf;
    const g = this.gravity, t = this.tickNum;

    // Pass 1: glowing cells add light over a radius-2 diamond.
    let anyGlow = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, e = grid[i];
        const s = e === E_WOOD ? (life[i] > 0 ? 90 : 0) : GLOW[e];
        if (s === 0) continue;
        anyGlow = true;
        const cb = e * 12;
        const cr = COL[cb], cg = COL[cb + 1], cbl = COL[cb + 2];
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, ad = Math.abs(dx) + Math.abs(dy);
            if (ad > 2 || xx < 0 || xx >= w) continue;
            const f = (s * (ad === 0 ? 256 : ad === 1 ? 128 : 64)) >> 8;
            const k = (yy * w + xx) * 3;
            glow[k] += (cr * f) >> 8;
            glow[k + 1] += (cg * f) >> 8;
            glow[k + 2] += (cbl * f) >> 8;
          }
        }
      }
    }

    // Pass 2: colour every cell, add and clear the glow buffer.
    let count = 0;
    const stamp = this.stamp, cur = this.cur, depth = this.depth;
    const px = new Uint32Array(out.buffer, out.byteOffset, w * h); // one little-endian RGBA word per cell
    depth.fill(0);
    for (let y = 0; y < h; y++) {
      const fy = h > 1 ? y / (h - 1) : 0;
      const bgR = (14 + 6 * fy) | 0, bgG = (15 + 3 * fy) | 0, bgB = (22 + 8 * fy) | 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, e = grid[i], gi = i * 3;
        const liq = KD[e] === K_LIQUID;
        if (!liq) depth[x] = 0;
        let R = bgR, G = bgG, B = bgB;
        if (e !== 0) {
          count++;
          const hv = this.hash[i];
          const nv = NV[e];
          const cb = (e * 4 + (nv > 1 && !liq ? hv % nv : 0)) * 3;
          R = COL[cb]; G = COL[cb + 1]; B = COL[cb + 2];
          const l = life[i];
          const flick = ((hv >>> 8) ^ t) & 31;
          switch (e) {
            case E_FIRE:
              if (l > 30) { R = 255; G = 236; B = 150; }
              else if (l > 12) { R = 255; G = 150; B = 30; }
              else { R = 190; G = 40; B = 12; }
              G += flick - 16; B += (flick >> 1) - 8;
              break;
            case E_LAVA: {
              const k = 1 + (((t + x * 3 + y * 5) & 63) - 32) / 200;
              R *= k; G *= k; B *= k;
              break;
            }
            case E_SMOKE: {
              const a = l >= 20 ? 1 : l / 20;
              R = bgR + (R - bgR) * a; G = bgG + (G - bgG) * a; B = bgB + (B - bgB) * a;
              break;
            }
            case E_STEAM: {
              const a = l >= 30 ? 1 : l / 30;
              R = bgR + (R - bgR) * a; G = bgG + (G - bgG) * a; B = bgB + (B - bgB) * a;
              break;
            }
            case E_WOOD:
              if (l > 0) { R = 255; G = 100 + flick; B = 20; }
              break;
            case E_SPARK: {
              const f = 0.35 + (0.65 * (l & 31)) / 31, pi = (l >> 5) * 3;
              R = SPARK_PAL[pi] * f; G = SPARK_PAL[pi + 1] * f; B = SPARK_PAL[pi + 2] * f;
              break;
            }
            case E_CLONE:
              if (l > 0 && l < ELEMENT_COUNT) {
                const sb = l * 12;
                R = R * 0.6 + COL[sb] * 0.4; G = G * 0.6 + COL[sb + 1] * 0.4; B = B * 0.6 + COL[sb + 2] * 0.4;
              }
              break;
            default: break;
          }
          if (liq) {
            // Liquids shade by depth below the surface (no hash variant, no relief): the top layer is lighter.
            const dp = depth[x];
            if (dp === 0) { R *= 1.12; G *= 1.12; B *= 1.12; }
            else { const k = 1 - 0.025 * (dp < 12 ? dp : 12); R *= k; G *= k; B *= k; }
            if (dp < 255) depth[x] = dp + 1;
          } else if (KD[e] !== K_GAS && KD[e] !== K_ENERGY && stamp[i] !== cur) {
            // Relief: surfaces facing open sky catch light, undersides fall into shade. Moved cells skip it so falling grains do not flash.
            const uy = y - g, dy = y + g;
            if (uy >= 0 && uy < h && grid[uy * w + x] === 0) { R += 22; G += 22; B += 22; }
            else if (dy >= 0 && dy < h && grid[dy * w + x] === 0) { R *= 0.8; G *= 0.8; B *= 0.8; }
          }
        }
        let gr = 0, gg = 0, gb = 0;
        if (anyGlow) {
          gr = glow[gi]; gg = glow[gi + 1]; gb = glow[gi + 2];
          if (gr | gg | gb) { glow[gi] = 0; glow[gi + 1] = 0; glow[gi + 2] = 0; }
        }
        px[i] = 0xff000000 | (clamp255(B + gb) << 16) | (clamp255(G + gg) << 8) | clamp255(R + gr);
      }
    }
    return count;
  }

  count(element: number): number {
    const grid = this.grid;
    let c = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] === element) c++;
    return c;
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private ri(a: number, b: number): number {
    return a + Math.floor(this.rng() * (b - a + 1));
  }

  /** Index of neighbour k, or -1 if off the grid. */
  private nIdx(x: number, y: number, k: number): number {
    const nx = x + SX[k], ny = y + SY[k];
    return nx >= 0 && ny >= 0 && nx < this.w && ny < this.h ? ny * this.w + nx : -1;
  }

  /** Bitmask of what touches (x, y) in the 8-neighbourhood. */
  private nb(x: number, y: number): number {
    let m = 0;
    for (let k = 0; k < 8; k++) {
      const j = this.nIdx(x, y, k);
      if (j < 0) continue;
      const n = this.grid[j];
      m |= BIT[n];
      if (n === E_WOOD && this.life[j] > 0) m |= B_HOT;
    }
    return m;
  }

  /** How many of the 8 neighbours of cell j hold element e. */
  private countAround(j: number, e: number): number {
    const x = j % this.w, y = (j / this.w) | 0;
    let c = 0;
    for (let k = 0; k < 8; k++) {
      const n = this.nIdx(x, y, k);
      if (n >= 0 && this.grid[n] === e) c++;
    }
    return c;
  }

  private defLife(e: number): number {
    switch (e) {
      case E_FIRE: return this.ri(25, 50);
      case E_STEAM: return this.ri(150, 220);
      case E_SMOKE: return this.ri(40, 80);
      case E_SPARK: return (this.ri(0, 7) << 5) | 20;
      default: return 0;
    }
  }

  /** Write a cell and mark it as touched this tick. */
  private put(j: number, e: number, l: number): void {
    this.grid[j] = e;
    this.life[j] = l;
    this.vel[j] = 0;
    this.stamp[j] = this.cur;
  }

  /** Create element e with its default life. */
  private place(j: number, e: number): void {
    this.put(j, e, this.defLife(e));
  }

  /** Swap cell i with cell j. The element arriving at j is marked as moved. */
  private move(i: number, j: number): void {
    const grid = this.grid, life = this.life, vel = this.vel;
    const e = grid[i], l = life[i], v = vel[i];
    grid[i] = grid[j]; life[i] = life[j]; vel[i] = vel[j];
    grid[j] = e; life[j] = l; vel[j] = v;
    this.stamp[j] = this.cur;
  }

  private sideStep(i: number, x: number, y: number, dir: number): boolean {
    const xx = x + dir;
    if (xx < 0 || xx >= this.w) return false;
    const j = y * this.w + xx;
    if (this.grid[j] !== 0) return false;
    this.move(i, j);
    return true;
  }

  /** Can an element e swap into a cell holding t? Rising uses the liquid rule, falling the density rule. */
  private accepts(e: number, t: number, rising: boolean): boolean {
    if (t === 0) return true;
    if (rising) return KD[t] === K_LIQUID;
    return (KD[t] === K_LIQUID || KD[t] === K_GAS) && DEN[t] < DEN[e];
  }

  /** Move straight in direction dy, else diagonally (random side first). */
  private drift(i: number, x: number, y: number, e: number, dy: number, rising: boolean): boolean {
    const w = this.w, grid = this.grid, yb = y + dy;
    if (yb < 0 || yb >= this.h) return false;
    if (this.accepts(e, grid[yb * w + x], rising)) { this.move(i, yb * w + x); return true; }
    const s = this.rng() < 0.5 ? -1 : 1;
    for (let k = 0; k < 2; k++) {
      const xx = x + (k === 0 ? s : -s);
      if (xx < 0 || xx >= w) continue;
      const j = yb * w + xx;
      if (this.accepts(e, grid[j], rising)) { this.move(i, j); return true; }
    }
    return false;
  }

  /** Slide sideways through empty cells, up to dist, dropping into the first hole. hy is the hole direction. */
  private flow(i: number, x: number, y: number, dist: number, hy: number, e: number, splash = false): boolean {
    const w = this.w, grid = this.grid, hr = y + hy;
    const holeRow = hr >= 0 && hr < this.h;
    const dir = this.rng() < 0.5 ? -1 : 1;
    let best = -1, hole = false;
    for (let s = 1; s <= dist; s++) {
      const xx = x + dir * s;
      if (xx < 0 || xx >= w) break;
      const n = grid[y * w + xx];
      if (n !== 0) {
        // A heavier liquid shoulders a lighter one aside, so layers level out under each other.
        if (s === 1 && KD[n] === K_LIQUID && KD[e] === K_LIQUID && DEN[n] < DEN[e]) best = y * w + xx;
        break;
      }
      best = y * w + xx;
      if (holeRow && grid[hr * w + xx] === 0) { hole = true; break; }
    }
    if (best < 0) return false;
    if (!hole && !splash && KD[e] !== K_GAS) {
      // Still pool: no hole in reach, so creep one cell now and then instead of sliding the whole run every tick.
      if (this.rng() >= 0.2) return false;
      best = y * w + x + dir;
    }
    this.move(i, best);
    return true;
  }

  // ─── Per-element update ───────────────────────────────────────

  /** Accelerating fall: enters free cells at 1 + vel/2 per tick, checking each cell on the way. False if blocked straight down. */
  private fall(i: number, x: number, y: number, e: number): boolean {
    const g = this.gravity, w = this.w, h = this.h, grid = this.grid, vel = this.vel;
    const yb = y + g;
    if (yb < 0 || yb >= h) return false;
    const t1 = grid[yb * w + x];
    if (!this.accepts(e, t1, false)) return false;
    let v = Math.min(vel[i] + 1, TERM[e]), steps = 1;
    if (t1 !== 0) v = 0; // entering a liquid: slow to one cell
    else {
      const reach = 1 + (v >> 1);
      for (let s = 2; s <= reach; s++) {
        const yy = y + g * s;
        if (yy < 0 || yy >= h) break;
        const t = grid[yy * w + x];
        if (!this.accepts(e, t, false)) break;
        if (t !== 0) { v = 0; steps = 1; break; } // passing through a liquid: slow to one cell
        steps = s;
      }
    }
    vel[i] = v;
    this.move(i, (y + g * steps) * w + x);
    return true;
  }

  /** Gravity step for powders and liquids: accelerating fall, then impact, then the sideways fallback. */
  private settle(i: number, x: number, y: number, e: number): void {
    const g = this.gravity, vel = this.vel;
    if (this.fall(i, x, y, e)) return;
    const liquid = KD[e] === K_LIQUID;
    const v = vel[i];
    if (v >= 3) { // impact: liquids splash, powders slide or hop
      vel[i] = 0;
      if (liquid) this.flow(i, x, y, DISP[e] + v, g, e, true);
      else if (!this.drift(i, x, y, e, g, false)) this.sideStep(i, x, y, this.rng() < 0.5 ? -1 : 1);
      return;
    }
    if (this.drift(i, x, y, e, g, false)) return;
    if (liquid) this.flow(i, x, y, DISP[e], g, e);
  }

  private update(i: number, x: number, y: number, e: number): void {
    switch (e) {
      case E_SAND: this.sand(i, x, y); break;
      case E_SNOW: this.snow(i, x, y); break;
      case E_ASH: case E_GUNPOWDER: this.powder(i, x, y, e); break;
      case E_SEED: this.seed(i, x, y); break;
      case E_WATER: this.water(i, x, y); break;
      case E_OIL: this.liquid(i, x, y, e); break;
      case E_ACID: this.acid(i, x, y); break;
      case E_LAVA: this.lava(i, x, y); break;
      case E_FIRE: this.fire(i, x, y); break;
      case E_WOOD: this.wood(i, x, y); break;
      case E_PLANT: this.plant(i, x, y); break;
      case E_ICE: this.ice(i, x, y); break;
      case E_STONE: this.stone(i, x, y); break;
      case E_STEAM: this.steam(i, x, y); break;
      case E_SMOKE: this.smoke(i, x, y); break;
      case E_GAS: this.gas(i, x, y, e); break;
      case E_FIREWORK: this.firework(i, x, y); break;
      case E_SPARK: this.spark(i, x, y); break;
      case E_CLONE: this.clone(i, x, y); break;
      case E_VOID: this.voidCell(i, x, y); break;
      default: break; // WALL and GLASS are inert
    }
  }

  private powder(i: number, x: number, y: number, e: number): void {
    const g = this.gravity;
    const b = y + g >= 0 && y + g < this.h ? i + g * this.w : -1;
    const airborne = b >= 0 && this.grid[b] === 0;
    const light = e === E_SNOW || e === E_ASH;
    if (airborne && this.eff !== 0 && this.rng() < (light ? 0.8 : 0.15) && this.sideStep(i, x, y, this.eff)) return;
    if (light) {
      if (airborne && this.rng() < 0.2 && this.sideStep(i, x, y, this.rng() < 0.5 ? -1 : 1)) return;
      if (this.rng() < 0.5) return;
    }
    this.settle(i, x, y, e);
  }

  private sand(i: number, x: number, y: number): void {
    if (this.nb(x, y) & B_HOT) {
      if (++this.life[i] >= 25) { this.put(i, E_GLASS, 0); return; }
    }
    this.powder(i, x, y, E_SAND);
  }

  private snow(i: number, x: number, y: number): void {
    const m = this.nb(x, y);
    if ((m & (B_HOT | B_STEAM)) || ((m & B_WATER) && this.rng() < 1 / 40)) { this.put(i, E_WATER, 0); return; }
    this.powder(i, x, y, E_SNOW);
  }

  private seed(i: number, x: number, y: number): void {
    const g = this.gravity, w = this.w;
    const yb = y + g;
    let resting = yb < 0 || yb >= this.h;
    if (!resting) {
      const below = this.grid[yb * w + x];
      resting = below !== 0 && KD[below] !== K_LIQUID && KD[below] !== K_GAS;
    }
    if (resting && this.waterNear(x, y)) { this.put(i, E_PLANT, this.ri(10, 30)); return; }
    this.powder(i, x, y, E_SEED);
  }

  private waterNear(x: number, y: number): boolean {
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= this.h) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < this.w && this.grid[yy * this.w + xx] === E_WATER) return true;
      }
    }
    return false;
  }

  private water(i: number, x: number, y: number): void {
    if ((this.nb(x, y) & B_ICE) && this.rng() < 1 / 150) { this.put(i, E_ICE, 0); return; }
    this.liquid(i, x, y, E_WATER);
  }

  private liquid(i: number, x: number, y: number, e: number): void {
    if (e === E_LAVA && this.rng() > 1 / 3) return; // viscous: moves about one tick in three
    this.settle(i, x, y, e);
  }

  private gas(i: number, x: number, y: number, e: number): void {
    if (this.eff !== 0 && this.rng() < 0.6 && this.sideStep(i, x, y, this.eff)) return;
    if (this.drift(i, x, y, e, -this.gravity, true)) return;
    this.flow(i, x, y, 3, -this.gravity, e);
  }

  private acid(i: number, x: number, y: number): void {
    for (let k = 0; k < 4; k++) {
      const j = this.nIdx(x, y, k);
      if (j < 0) continue;
      const n = this.grid[j];
      if (n === 0 || n === E_ACID || n === E_WALL || n === E_GLASS || n === E_CLONE || n === E_VOID || KD[n] === K_GAS) continue;
      if (n === E_WATER) {
        if (this.rng() < 0.05) { this.place(i, E_WATER); return; }
        continue;
      }
      if (this.rng() < (KD[n] === K_SOLID ? 0.05 : 0.15)) {
        this.place(j, this.rng() < 0.1 ? E_GAS : E_EMPTY);
        if (this.rng() < 0.5) { this.place(i, E_EMPTY); return; }
      }
    }
    this.liquid(i, x, y, E_ACID);
  }

  private lava(i: number, x: number, y: number): void {
    const g = this.gravity, w = this.w, grid = this.grid;
    for (let k = 0; k < 8; k++) {
      const j = this.nIdx(x, y, k);
      if (j < 0) continue;
      const n = grid[j];
      if (n === E_WATER || n === E_ICE || n === E_SNOW) {
        this.place(j, E_STEAM);
        this.put(i, E_STONE, 0);
        return;
      }
      const f = FLAM[n];
      if (f > 0 && this.rng() < f) this.ignite(j, n);
    }
    const uy = y - g;
    // Thin films and stream edges crust over; a pool with lava all around stays molten.
    if (uy >= 0 && uy < this.h && grid[uy * w + x] === 0 && this.rng() < 1 / 700 && this.countAround(i, E_LAVA) <= 2) {
      this.place(i, E_STONE);
      return;
    }
    this.liquid(i, x, y, E_LAVA);
  }

  private fire(i: number, x: number, y: number): void {
    const g = this.gravity, w = this.w, grid = this.grid;
    const l = this.life[i];
    if (l === 0) { this.place(i, this.rng() < 0.35 ? E_SMOKE : E_EMPTY); return; }
    this.life[i] = l - 1;
    for (let k = 0; k < 8; k++) {
      const j = this.nIdx(x, y, k);
      if (j < 0) continue;
      const n = grid[j];
      if (n === E_WATER) {
        this.place(i, E_STEAM);
        if (this.rng() < 0.5) this.place(j, E_EMPTY);
        return;
      }
      if (n === E_ICE || n === E_SNOW) {
        if (this.rng() < 0.2) this.place(j, E_WATER);
        continue;
      }
      const f = FLAM[n];
      if (f > 0 && this.rng() < f) this.ignite(j, n);
    }
    if (this.rng() < 0.3) {
      const uy = y - g;
      const up = uy * w + x;
      if (uy >= 0 && uy < this.h && grid[up] === 0) this.move(i, up);
    }
  }

  /** Flammable cell j of type n catches fire. */
  private ignite(j: number, n: number): void {
    switch (n) {
      case E_WOOD: if (this.life[j] === 0) this.life[j] = this.ri(130, 220); break;
      case E_OIL: this.put(j, E_FIRE, this.ri(30, 50)); break;
      case E_PLANT: case E_SEED: this.put(j, E_FIRE, this.ri(20, 35)); break;
      case E_GAS: this.put(j, E_FIRE, this.ri(6, 12)); break;
      case E_GUNPOWDER:
        this.put(j, E_FIRE, 8);
        if (this.rng() < 0.2) this.explode(j % this.w, (j / this.w) | 0, 4);
        break;
      case E_FIREWORK: this.life[j] = this.ri(25, 45); break;
      default: break;
    }
  }

  private wood(i: number, x: number, y: number): void {
    const l = this.life[i];
    if (l === 0) return;
    for (let k = 0; k < 4; k++) {
      const j = this.nIdx(x, y, k);
      if (j >= 0 && this.grid[j] === E_WATER) {
        this.life[i] = 0;
        this.place(j, E_STEAM);
        return;
      }
    }
    if (l <= 1) { this.place(i, this.rng() < 0.6 ? E_ASH : E_FIRE); return; }
    this.life[i] = l - 1;
    if (this.rng() < 0.25) {
      const j = this.nIdx(x, y, this.ri(0, 7));
      if (j >= 0 && this.grid[j] === 0) this.place(j, E_FIRE);
    }
    for (let k = 0; k < 8; k++) {
      const j = this.nIdx(x, y, k);
      if (j < 0) continue;
      const n = this.grid[j], f = FLAM[n];
      if (f > 0 && this.rng() < f) this.ignite(j, n);
    }
    if (this.rng() < 0.05) {
      const uy = y - this.gravity;
      if (uy >= 0 && uy < this.h && this.grid[uy * this.w + x] === 0) this.place(uy * this.w + x, E_SMOKE);
    }
  }

  private plant(i: number, x: number, y: number): void {
    const l = this.life[i], grid = this.grid, w = this.w;
    if (l === 0) {
      for (let k = 0; k < 4; k++) {
        const j = this.nIdx(x, y, k);
        // Only grow into water that is not already crowded by plant: tendrils, not a solid blob.
        if (j >= 0 && grid[j] === E_WATER && this.rng() < 1 / 12 && this.countAround(j, E_PLANT) <= 2) this.place(j, E_PLANT);
      }
      return;
    }
    if (this.rng() >= 0.25) return;
    const diag = this.rng() < 0.25;
    const nx = diag ? x + (this.rng() < 0.5 ? -1 : 1) : x;
    const ny = y - this.gravity;
    if (nx < 0 || nx >= w || ny < 0 || ny >= this.h) { this.life[i] = 0; return; }
    const t = ny * w + nx, n = grid[t];
    if (n !== 0 && n !== E_WATER) { this.life[i] = 0; return; }
    this.put(t, E_PLANT, l - 1);
    this.life[i] = 0;
    if (l >= 4 && this.rng() < 0.1) {
      const bx = x + (this.rng() < 0.5 ? -1 : 1);
      if (bx >= 0 && bx < w) {
        const bi = y * w + bx, bn = grid[bi];
        if (bn === 0 || bn === E_WATER) this.put(bi, E_PLANT, (l - 1) >> 1);
      }
    }
  }

  private ice(i: number, x: number, y: number): void {
    const m = this.nb(x, y);
    if (m & B_HOT ? this.rng() < 0.2 : (m & B_STEAM) !== 0 && this.rng() < 0.05) this.put(i, E_WATER, 0);
  }

  private stone(i: number, x: number, y: number): void {
    if ((this.nb(x, y) & B_LAVA) && this.rng() < 1 / 3000) this.put(i, E_LAVA, 0);
  }

  private steam(i: number, x: number, y: number): void {
    if (this.life[i] === 0 || (this.nb(x, y) & (B_ICE | B_SNOW))) { this.put(i, E_WATER, 0); return; }
    this.life[i]--;
    this.gas(i, x, y, E_STEAM);
  }

  private smoke(i: number, x: number, y: number): void {
    if (this.life[i] === 0) { this.put(i, E_EMPTY, 0); return; }
    this.life[i]--;
    this.gas(i, x, y, E_SMOKE);
  }

  private firework(i: number, x: number, y: number): void {
    const l = this.life[i];
    if (l === 0) { this.powder(i, x, y, E_FIREWORK); return; }
    const g = this.gravity, w = this.w, grid = this.grid;
    let c = i, cy = y, life = l, blocked = false;
    for (let s = 0; s < 2 && life > 1; s++) {
      const ny = cy - g;
      if (ny < 0 || ny >= this.h) { blocked = true; break; }
      const t = ny * w + x, n = grid[t];
      if (n === E_FIREWORK) { // queue behind the rocket above, lighting it so the stack launches top first
        if (this.life[t] === 0) this.life[t] = this.ri(25, 45);
        break;
      }
      if (n !== 0 && KD[n] !== K_GAS) { blocked = true; break; }
      this.put(c, E_SPARK, (this.ri(0, 7) << 5) | 8); // trail
      life--;
      this.put(t, E_FIREWORK, life);
      c = t;
      cy = ny;
    }
    if (blocked || life <= 1) this.burst(x, cy);
  }

  private burst(cx: number, cy: number): void {
    const w = this.w;
    const R = this.ri(6, 9), col = this.ri(0, 7), count = this.ri(40, 70);
    this.put(cy * w + cx, E_EMPTY, 0);
    for (let tries = 0, placed = 0; placed < count && tries < count * 8; tries++) {
      const dx = this.ri(-R, R), dy = this.ri(-R, R);
      if (dx * dx + dy * dy > R * R) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= w || y >= this.h) continue;
      const j = y * w + x;
      if (this.grid[j] !== 0) continue;
      this.put(j, E_SPARK, (col << 5) | this.ri(15, 31));
      placed++;
    }
  }

  private spark(i: number, x: number, y: number): void {
    const l = this.life[i];
    const ttl = (l & 31) - 1;
    if (ttl <= 0) { this.place(i, E_EMPTY); return; }
    this.life[i] = (l & 0xe0) | ttl;
    for (let k = 0; k < 8; k++) {
      const j = this.nIdx(x, y, k);
      if (j < 0) continue;
      const n = this.grid[j], f = FLAM[n];
      if (f > 0 && this.rng() < f * 0.3) this.ignite(j, n);
    }
    // 40% of moves try straight down, the rest pick a random neighbour.
    const j = this.rng() < 0.4 ? this.nIdx(x, y, this.gravity === 1 ? 3 : 2) : this.nIdx(x, y, this.ri(0, 7));
    if (j >= 0 && this.grid[j] === 0) this.move(i, j);
  }

  private clone(i: number, x: number, y: number): void {
    const src = this.life[i];
    if (src === 0) {
      for (let k = 0; k < 4; k++) {
        const j = this.nIdx(x, y, k);
        if (j < 0) continue;
        const n = this.grid[j];
        if (n !== 0 && n !== E_CLONE && n !== E_VOID && n !== E_WALL) { this.life[i] = n; return; }
      }
      return;
    }
    if (this.rng() >= 0.5) return;
    const j = this.nIdx(x, y, this.ri(0, 7));
    if (j >= 0 && this.grid[j] === 0) this.place(j, src);
  }

  private voidCell(i: number, x: number, y: number): void {
    for (let k = 0; k < 4; k++) {
      const j = this.nIdx(x, y, k);
      if (j < 0) continue;
      const n = this.grid[j];
      if (n !== 0 && n !== E_VOID && n !== E_WALL && n !== E_CLONE) this.place(j, E_EMPTY);
    }
  }

  // ─── Paint ────────────────────────────────────────────────────

  private disc(cx: number, cy: number, r: number, e: number): void {
    const r2 = r * r, w = this.w, h = this.h;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= w || dx * dx + dy * dy > r2) continue;
        this.brush(y * w + x, e, r);
      }
    }
  }

  private brush(j: number, e: number, r: number): void {
    if (e === E_EMPTY) { this.grid[j] = 0; this.life[j] = 0; this.vel[j] = 0; return; }
    const cur = this.grid[j];
    if (e === E_FIRE && FLAM[cur] > 0) { this.ignite(j, cur); return; } // a flame brush lights what it touches
    if (KD[e] === K_SOLID) {
      if (KD[cur] === K_SOLID) return;
    } else if (cur !== 0 || (r > 0 && this.rng() >= 0.6)) {
      return; // non-solids only fill empty cells, and only most of a stamp unless radius 0
    }
    this.grid[j] = e;
    this.life[j] = this.defLife(e);
    this.vel[j] = 0;
  }
}
