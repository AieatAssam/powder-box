/**
 * Procedural scene generators — each creates unique, beautiful, artistic starting scenes.
 * Scenes are designed to be visually striking when physics starts: water flows,
 * sand settles, lava burns, fire spreads, creating emergent beauty.
 */
import { Element, GRID_W, GRID_H } from './types';

type Cell = [number, number, number, number]; // x, y, elem, lifetime

type SceneBuilder = (seed: number) => Cell[];

// ─── Seeded random (mulberry32) ─────────────────────────────────
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── Drawing primitives ─────────────────────────────────────────
type CellSink = { push: (x: number, y: number, elem: number, life?: number) => void };

function makeSink(): CellSink & { cells: Cell[] } {
  const c: Cell[] = [];
  return {
    push(x: number, y: number, elem: number, life = 0) { c.push([x, y, elem, life]); },
    get cells() { return c; },
  };
}

function fillRect(out: CellSink, x: number, y: number, w: number, h: number, elem: number, life = 0) {
  const x1 = Math.max(0, Math.floor(x));
  const y1 = Math.max(0, Math.floor(y));
  const x2 = Math.min(GRID_W - 1, Math.floor(x + w));
  const y2 = Math.min(GRID_H - 1, Math.floor(y + h));
  for (let cy = y1; cy <= y2; cy++)
    for (let cx = x1; cx <= x2; cx++)
      out.push(cx, cy, elem, life);
}

function fillCircle(out: CellSink, cx: number, cy: number, r: number, elem: number, life = 0) {
  const r2 = r * r;
  const x1 = Math.max(0, Math.floor(cx - r));
  const x2 = Math.min(GRID_W - 1, Math.floor(cx + r));
  const y1 = Math.max(0, Math.floor(cy - r));
  const y2 = Math.min(GRID_H - 1, Math.floor(cy + r));
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2)
        out.push(x, y, elem, life);
}

function strokeCircle(out: CellSink, cx: number, cy: number, r: number, elem: number, life = 0) {
  for (let a = 0; a < 360; a += 2) {
    const rad = a * Math.PI / 180;
    const x = Math.round(cx + r * Math.cos(rad));
    const y = Math.round(cy + r * Math.sin(rad));
    if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H)
      out.push(x, y, elem, life);
  }
}

function line(out: CellSink, x1: number, y1: number, x2: number, y2: number, elem: number, life = 0) {
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;
  let x = x1, y = y1;
  while (true) {
    if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H)
      out.push(x, y, elem, life);
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function scallop(out: CellSink, x: number, y: number, w: number, h: number, elem: number, life = 0) {
  // Filled ellipse for terrain-like blobs
  const cx = x + w / 2, cy = y + h / 2;
  const rx = w / 2, ry = h / 2;
  const x1 = Math.max(0, Math.floor(x));
  const x2 = Math.min(GRID_W - 1, Math.floor(x + w));
  const y1 = Math.max(0, Math.floor(y));
  const y2 = Math.min(GRID_H - 1, Math.floor(y + h));
  for (let py = y1; py <= y2; py++)
    for (let px = x1; px <= x2; px++)
      if (((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1)
        out.push(px, py, elem, life);
}

function scatter(
  out: CellSink, x: number, y: number, w: number, h: number,
  elem: number, density: number, rng: () => number, life = 0
) {
  const area = w * h;
  const count = Math.floor(area * density * 0.01);
  for (let i = 0; i < count; i++) {
    const px = Math.floor(x + rng() * w);
    const py = Math.floor(y + rng() * h);
    if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H)
      out.push(px, py, elem, life);
  }
}

function noise(x: number, y: number, seed: number): number {
  // Simple value noise
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 41.137) * 43758.5453;
  return n - Math.floor(n);
}

// ─── Scene: Volcano Island ─────────────────────────────────────
const volcano: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // Island centre with organic offset
  const islandCX = GRID_W / 2 + (rng() - 0.5) * 40;
  const islandCY = GRID_H * 0.72 + (rng() - 0.5) * 10;
  const islandR = 55 + rng() * 25;

  // ── Organic island base (scalloped ellipse rather than perfect circle) ──
  for (let a = 0; a < 360; a += 2) {
    const rad = a * Math.PI / 180;
    const organicR = islandR + Math.sin(a * 3 + seed) * 4 + Math.sin(a * 7 + seed * 2) * 2;
    const px = Math.round(islandCX + organicR * Math.cos(rad));
    const py = Math.round(islandCY + organicR * Math.sin(rad) * 0.75);
    if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H)
      out.push(px, py, Element.SAND);
  }
  // Fill island interior
  for (let y = Math.max(0, Math.floor(islandCY - islandR * 0.75)); y < Math.min(GRID_H, Math.ceil(islandCY + islandR * 0.75)); y++) {
    for (let x = Math.max(0, Math.floor(islandCX - islandR)); x < Math.min(GRID_W, Math.ceil(islandCX + islandR)); x++) {
      const dx = (x - islandCX) / islandR;
      const dy = (y - islandCY) / (islandR * 0.75);
      const organicBias = Math.sin(x * 0.05 + y * 0.07 + seed) * 0.15;
      if (dx * dx + dy * dy < 1 + organicBias && rng() < 0.92)
        out.push(x, y, Element.SAND);
    }
  }

  // ── Volcano cone (wall, layered with tapering) ──
  const peakX = islandCX + (rng() - 0.5) * 15;
  const peakY = islandCY - islandR * 0.5 + rng() * 8;
  const coneBaseR = islandR * 0.4;
  const coneLayers = 20 + Math.floor(rng() * 10);
  for (let layer = 0; layer < coneLayers; layer++) {
    const t = layer / coneLayers;
    const coneR = Math.max(1, coneBaseR * (1 - t * 0.85));
    const cy = peakY + layer;
    if (cy >= GRID_H) break;
    fillCircle(out, peakX, cy, coneR, Element.WALL);
  }

  // ── Crater lake (lava at peak) ──
  const craterR = 5 + rng() * 5;
  fillCircle(out, peakX, peakY - 2, craterR, Element.LAVA, 180);
  scatter(out, peakX - craterR, peakY - craterR - 3, craterR * 2, 4, Element.FIRE, 30, rng, 30);

  // ── Lava rivers cascading down ──
  const flowCount = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < flowCount; i++) {
    let fx = peakX + (rng() - 0.5) * craterR * 1.5;
    let fy = peakY + 3;
    const age = 80 + rng() * 60;
    for (let d = 0; d < 30 + rng() * 20; d++) {
      fx += Math.sin(d * 0.4 + i * 7 + seed) * (1.5 + rng() * 1.5);
      fy += 0.6 + rng() * 0.6;
      if (fy >= islandCY - 5 || fx < 3 || fx >= GRID_W - 3) break;
      const width = 2 + Math.sin(d * 0.15) * 0.5;
      fillCircle(out, Math.round(fx), Math.round(fy), width, Element.LAVA, age - d);
      // Heat shimmer
      if (rng() < 0.15)
        out.push(Math.round(fx + (rng() - 0.5) * 3), Math.round(fy), Element.FIRE, 15 + rng() * 20);
    }
  }

  // ── Ocean — ring of water around island ──
  for (let a = 0; a < 360; a += 2) {
    const rad = a * Math.PI / 180;
    const dist = islandR + 6 + Math.sin(a * 4 + seed) * 3;
    const wx = Math.round(islandCX + dist * Math.cos(rad));
    const wy = Math.round(islandCY + dist * Math.sin(rad) * 0.75);
    fillCircle(out, wx, wy, 8 + Math.sin(a * 2) * 3 + rng() * 2, Element.WATER);
  }
  // Fill outer water area (scatter rather than full grid)
  for (let i = 0; i < 6000; i++) {
    const px = Math.floor(rng() * GRID_W);
    const py = Math.floor(rng() * GRID_H);
    const dx = (px - islandCX) / islandR;
    const dy = (py - islandCY) / (islandR * 0.75);
    if (dx * dx + dy * dy > 1.3 && rng() < 0.75)
      out.push(px, py, Element.WATER);
  }

  // ── Trees scattered on lower slopes ──
  const treeCount = 3 + Math.floor(rng() * 5);
  for (let i = 0; i < treeCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = 10 + rng() * (islandR * 0.5);
    const tx = Math.round(islandCX + dist * Math.cos(angle));
    const ty = Math.round(islandCY + dist * Math.sin(angle) * 0.75);
    if (ty < GRID_H - 5 && ty > peakY + 15 && tx > 5 && tx < GRID_W - 5) {
      // Curved trunk
      const trunkH = 3 + Math.floor(rng() * 4);
      for (let t = 0; t < trunkH; t++)
        out.push(Math.round(tx + Math.sin(t * 0.8) * 1), ty - t, Element.WOOD);
      // Foliage
      fillCircle(out, tx, ty - trunkH - 2, 2 + rng() * 2, Element.PLANT);
      if (rng() > 0.5)
        fillCircle(out, tx + (rng() - 0.5) * 2, ty - trunkH - 1, 1 + rng(), Element.PLANT);
    }
  }

  // ── Plume of smoke ──
  scatter(out, peakX - 8, peakY - 15, 16, 10, Element.SMOKE, 25, rng, 40);

  // ── Beach rocks ──
  for (let i = 0; i < 4 + Math.floor(rng() * 5); i++) {
    const angle = rng() * Math.PI * 2;
    const dist = islandR * (0.65 + rng() * 0.3);
    const rx = Math.round(islandCX + dist * Math.cos(angle));
    const ry = Math.round(islandCY + dist * Math.sin(angle) * 0.75);
    if (rx > 5 && rx < GRID_W - 5 && ry > peakY + 10)
      fillCircle(out, rx, ry, 1.5 + rng() * 3, Element.WALL);
  }

  return out.cells;
};

// ─── Scene: Zen Garden ─────────────────────────────────────────
const zenGarden: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // ── Sand base with wavy rake patterns ──
  const sandTop = GRID_H * 0.18 + rng() * 0.04;
  for (let y = Math.floor(sandTop); y < GRID_H; y++) {
    for (let px = 0; px < GRID_W; px += 2 + ((y) % 2)) {
      out.push(px, y, Element.SAND);
    }
  }
  // Add rake-line texture (alternating lighter patches via density)
  for (let y = Math.floor(sandTop + 5); y < GRID_H; y += 4 + Math.floor(rng() * 3)) {
    const offset = Math.sin(y * 0.05 + seed) * 20;
    for (let x = 0; x < GRID_W; x++) {
      const wave = Math.sin((x + offset) * 0.03) * 2;
      if (Math.abs((y + wave) - Math.round((y + wave) / 4) * 4) < 0.5) {
        if (rng() < 0.15) out.push(x, y, Element.GLASS); // lighter streak
      }
    }
  }

  // ── Curved gravel path (wall rocks) ──
  const pathAmp = 18 + rng() * 12;
  const pathFreq = 0.025 + rng() * 0.015;
  for (let x = 15; x < GRID_W - 15; x += 1) {
    const cy = sandTop + 5 + Math.sin(x * pathFreq + seed) * pathAmp * 0.4
      + Math.sin(x * pathFreq * 2.3 + seed * 2) * pathAmp * 0.2;
    const thickness = 2 + Math.sin(x * 0.1) * 0.5;
    for (let t = -Math.floor(thickness); t <= Math.floor(thickness); t++) {
      const py = Math.round(cy + t);
      if (py > sandTop && py < GRID_H * 0.5 && rng() < 0.4)
        out.push(x, py, Element.WALL);
    }
  }

  // ── Organic water pond with rocky rim ──
  const pondX = GRID_W * (0.3 + rng() * 0.25);
  const pondY = GRID_H * (0.5 + rng() * 0.12);
  const pondR = 12 + rng() * 10;
  // Rocky rim around pond
  for (let a = 0; a < 360; a += 2) {
    const rad = a * Math.PI / 180;
    const organicR = pondR + Math.sin(a * 3 + seed) * 3 + Math.sin(a * 8 + seed * 2) * 2;
    const innerR = organicR - 2;
    const px = Math.round(pondX + organicR * Math.cos(rad));
    const py = Math.round(pondY + organicR * Math.sin(rad) * 0.6);
    if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H) {
      out.push(px, py, Element.WALL);
      // Inner rim
      const ix = Math.round(pondX + innerR * Math.cos(rad));
      const iy = Math.round(pondY + innerR * Math.sin(rad) * 0.6);
      if (rng() < 0.5) out.push(ix, iy, Element.WALL);
    }
  }
  // Fill pond water
  for (let a = 0; a < 360; a += 3) {
    const rad = a * Math.PI / 180;
    const fillR = pondR - 2 + Math.sin(a * 4 + seed) * 2;
    const px = Math.round(pondX + fillR * Math.cos(rad));
    const py = Math.round(pondY + fillR * Math.sin(rad) * 0.6);
    fillCircle(out, px, py, 1.5 + rng() * 1.5, Element.WATER);
  }

  // ── Zen stones (grouped in clusters) ──
  const clusterCount = 2 + Math.floor(rng() * 3);
  for (let c = 0; c < clusterCount; c++) {
    const acx = 25 + rng() * (GRID_W - 50);
    const acy = sandTop + 15 + rng() * (GRID_H * 0.4);
    // Skip if overlapping pond
    if (Math.hypot(acx - pondX, (acy - pondY) * 1.6) < pondR + 10) continue;
    const stoneCount = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < stoneCount; s++) {
      const sx = acx + (rng() - 0.5) * 12;
      const sy = acy + (rng() - 0.5) * 6;
      const sr = 1.5 + rng() * (4 - s);
      fillCircle(out, Math.round(sx), Math.round(sy), sr, Element.WALL);
      // Shadow rock beside larger stones
      if (sr > 2.5 && rng() > 0.5)
        fillCircle(out, Math.round(sx + sr + 1 + rng() * 3), Math.round(sy + (rng() - 0.5) * 2), sr * 0.5, Element.WALL);
    }
  }

  // ── Wooden bridge across pond ──
  const bridgeAngle = rng() * Math.PI * 0.3 - Math.PI * 0.15;
  const bridgeLen = 8 + Math.floor(rng() * 5);
  for (let i = -bridgeLen; i <= bridgeLen; i++) {
    const bx = Math.round(pondX + i * Math.cos(bridgeAngle) + Math.sin(i * 0.5) * 1);
    const by = Math.round(pondY - 3 + Math.abs(i) * 0.3 + Math.sin(i * 0.5) * 0.5);
    out.push(bx, by, Element.WOOD);
    out.push(bx, by + 1, Element.WOOD);
  }

  // ── Moss / plants near pond edge ──
  for (let i = 0; i < 8 + Math.floor(rng() * 8); i++) {
    const angle = rng() * Math.PI * 2;
    const dist = pondR + 2 + rng() * 8;
    const px = Math.round(pondX + dist * Math.cos(angle));
    const py = Math.round(pondY + dist * Math.sin(angle) * 0.6);
    if (px > 5 && px < GRID_W - 5 && py > sandTop && py < GRID_H - 5)
      out.push(px, py, Element.PLANT);
  }

  return out.cells;
};

// ─── Scene: Waterfall Canyon ───────────────────────────────────
const waterfall: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  const cliffX = 30 + rng() * 30;
  const cliffH = 45 + rng() * 25;
  const cliffTop = 20 + rng() * 12;

  // ── Left canyon wall (rugged stone face) ──
  for (let y = 0; y < GRID_H; y++) {
    const wobble = Math.sin(y * 0.15 + seed) * 5 + Math.sin(y * 0.4 + seed * 2) * 2;
    const faceX = cliffX + wobble;
    for (let x = 0; x < Math.round(faceX); x++)
      if (x >= 0 && x < GRID_W) out.push(x, y, Element.WALL);
  }

  // ── Plateau on top of cliff ──
  const plateauTop = cliffTop - 3;
  for (let y = 0; y <= plateauTop; y++) {
    for (let x = 0; x < Math.round(cliffX + 15 + Math.sin(y * 0.1) * 3); x++)
      if (x < GRID_W) out.push(x, y, Element.WALL);
  }

  // ── Water source lake on plateau ──
  const lakeCX = cliffX - 3 + (rng() - 0.5) * 8;
  const lakeR = 6 + rng() * 4;
  fillCircle(out, lakeCX, plateauTop * 0.3 + rng() * 2, lakeR, Element.WATER);

  // ── Waterfall curtain (wider, more dramatic) ──
  const fallWidth = 3 + Math.floor(rng() * 2);
  for (let y = cliffTop; y < cliffTop + cliffH; y++) {
    const wobble = Math.sin(y * 0.08 + seed * 3) * 6 + Math.sin(y * 0.02 + seed) * 3;
    const cx = Math.round(cliffX + wobble);
    for (let w = -fallWidth; w <= fallWidth; w++) {
      const px = cx + w;
      if (px >= 0 && px < GRID_W) {
        out.push(px, y, Element.WATER);
        // Occasional splash particles
        if (rng() < 0.08)
          out.push(px + (rng() > 0.5 ? 1 : -1), y, Element.WATER);
      }
    }
  }

  // ── Plunge pool below ──
  const poolY = cliffTop + cliffH - 2;
  const poolR = 12 + rng() * 8;
  for (let a = 0; a < 360; a += 3) {
    const rad = a * Math.PI / 180;
    const organicR = poolR + Math.sin(a * 3 + seed) * 2 + Math.sin(a * 7 + seed * 2) * 1;
    const px = Math.round(cliffX + organicR * Math.cos(rad));
    const py = Math.round(poolY + organicR * Math.sin(rad) * 0.5);
    if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H)
      fillCircle(out, px, py, 2 + Math.sin(a * 0.5) * 1, Element.WATER);
  }
  // Deep pool centre
  fillCircle(out, cliffX, poolY + 3, poolR * 0.6, Element.WATER);

  // ── Sandy beach on right with gentle slope ──
  for (let y = poolY + 1; y < GRID_H; y++) {
    const sandStart = Math.round(cliffX + 5 + (y - poolY) * 0.4 + Math.sin(y * 0.08 + seed) * 4);
    for (let x = Math.max(0, sandStart); x < GRID_W; x++)
      out.push(x, y, Element.SAND);
  }

  // ── Rock wall on right edge (partial, for framing) ──
  const rightCliffX = GRID_W - 15 - rng() * 15;
  for (let y = cliffTop * 0.5; y < cliffTop + cliffH * 0.5; y++) {
    const wobble = Math.sin(y * 0.12 + seed + 5) * 4;
    const faceRight = rightCliffX + wobble;
    for (let x = Math.round(faceRight); x < GRID_W; x++)
      out.push(x, y, Element.WALL);
  }

  // ── Mist/steam at waterfall base ──
  scatter(out, cliffX - 12, poolY - 4, 28, 10, Element.STEAM, 30, rng, 35);
  scatter(out, cliffX - 8, poolY + 3, 20, 6, Element.STEAM, 15, rng, 25);

  // ── Lush vegetation near pool ──
  for (let i = 0; i < 8 + Math.floor(rng() * 8); i++) {
    const px = Math.round(cliffX + 10 + rng() * 30);
    const py = Math.round(poolY + 1 + rng() * 10);
    if (px < GRID_W && py < GRID_H) {
      out.push(px, py, Element.PLANT);
      // Taller plant
      if (rng() > 0.5) out.push(px, py - 1, Element.PLANT);
    }
  }

  return out.cells;
};

// ─── Scene: Lava Delta ─────────────────────────────────────────
const lavaDelta: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // ── Rocky highlands at top ──
  const highlandBottom = GRID_H * 0.25 + rng() * 0.05;
  for (let y = 0; y < Math.floor(highlandBottom); y++) {
    for (let x = 0; x < GRID_W; x++) {
      const n = noise(x * 0.035, y * 0.04, seed);
      if (n > 0.42) out.push(x, y, Element.WALL);
    }
  }

  // ── Lava caldera ──
  const lavaCX = GRID_W / 2 + (rng() - 0.5) * 35;
  const lavaCY = 15 + rng() * 10;
  const calderaR = 20 + rng() * 10;
  fillCircle(out, lavaCX, lavaCY, calderaR, Element.LAVA, 200);
  fillCircle(out, lavaCX, lavaCY, calderaR - 3, Element.LAVA, 180);
  // Rock rim around caldera
  strokeCircle(out, lavaCX, lavaCY, calderaR + 3, Element.WALL);
  strokeCircle(out, lavaCX, lavaCY, calderaR + 4, Element.WALL);

  // ── Braided lava rivers (3-5 branches) ──
  const riverCount = 3 + Math.floor(rng() * 3);
  for (let r = 0; r < riverCount; r++) {
    let rx = lavaCX + (rng() - 0.5) * calderaR * 0.8;
    let ry = lavaCY + 8;
    const riverLen = 30 + Math.floor(rng() * 30);
    for (let step = 0; step < riverLen; step++) {
      rx += Math.sin(step * 0.15 + r * 4 + seed) * 2.5 + (rng() - 0.5) * 1.5;
      ry += 0.7 + rng() * 0.4;
      if (ry >= GRID_H - 5 || rx < 3 || rx >= GRID_W - 3) break;
      const width = 2 + Math.sin(step * 0.12 + r) * 0.8 + (step > riverLen * 0.5 ? 1.5 : 0);
      const life = 50 + rng() * 40 + Math.floor((riverLen - step) * 0.5);
      fillCircle(out, Math.round(rx), Math.round(ry), Math.max(1, width), Element.LAVA, life);
      // Fire/heat around lava edges
      if (rng() < 0.12)
        fillCircle(out, Math.round(rx + (rng() - 0.5) * 4), Math.round(ry), 1, Element.FIRE, 15 + rng() * 20);
    }
  }

  // ── Scorched terrain near lava (wall + scattered fire) ──
  scatter(out, lavaCX - calderaR - 5, lavaCY, calderaR * 2 + 10, Math.floor(GRID_H * 0.15), Element.FIRE, 8, rng, 30);

  // ── Ocean at bottom ──
  for (let i = 0; i < 8000; i++) {
    const px = Math.floor(rng() * GRID_W);
    const py = Math.floor(GRID_H * 0.55 + rng() * (GRID_H * 0.45));
    out.push(px, py, Element.WATER);
  }

  // ── Obsidian pillars where lava channels meet water ──
  for (let i = 0; i < 5 + Math.floor(rng() * 6); i++) {
    const rx = 15 + rng() * (GRID_W - 30);
    const ry = Math.floor(GRID_H * 0.55 + rng() * (GRID_H * 0.3));
    const pillarH = 3 + Math.floor(rng() * 6);
    for (let h = 0; h < pillarH; h++) {
      const wobble = Math.sin(h * 0.6 + seed + i) * 1.5;
      out.push(Math.round(rx + wobble), Math.round(ry - h), Element.WALL);
    }
  }

  // ── Steam and smoke clouds ──
  scatter(out, lavaCX - 25, lavaCY + calderaR, 50, 20, Element.STEAM, 20, rng, 40);
  scatter(out, lavaCX - 15, lavaCY - 10, 30, 10, Element.SMOKE, 15, rng, 35);
  // Additional steam where lava rivers approach water line
  for (let i = 0; i < 40; i++) {
    const px = Math.floor(10 + rng() * (GRID_W - 20));
    const py = Math.floor(GRID_H * 0.5 + rng() * 8);
    if (rng() < 0.3) out.push(px, py, Element.STEAM, 20 + rng() * 20);
  }

  return out.cells;
};

// ─── Scene: Geometric Mandala ───────────────────────────────────
// A stable, compartmented design: wall rings trap sand/water/lava in sections
// so physics enhances rather than destroys the pattern.
const mandala: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();
  const cx = GRID_W / 2 + (rng() - 0.5) * 15;
  const cy = GRID_H * 0.42 + (rng() - 0.5) * 10;
  const maxR = 98;

  // ── Outer ring (thick wall border) ──
  strokeCircle(out, cx, cy, maxR, Element.WALL);
  strokeCircle(out, cx, cy, maxR + 1, Element.WALL);
  strokeCircle(out, cx, cy, maxR - 1, Element.WALL);

  // ── Structured concentric rings ──
  // Each segment alternates: wall border → filled compartment
  const ringRadii = [85, 75, 62, 50, 38, 25, 14];
  const ringElems = [Element.WALL, Element.GLASS, Element.WALL, Element.GLASS, Element.WALL, Element.GLASS, Element.WALL];

  for (let ri = 0; ri < ringRadii.length; ri++) {
    const r = ringRadii[ri];
    const isWall = ri % 2 === 0;
    const elem = ringElems[ri];
    if (isWall) {
      // Thicker wall ring to act as compartment border
      strokeCircle(out, cx, cy, r, Element.WALL);
      strokeCircle(out, cx, cy, r + 1, Element.WALL);
      strokeCircle(out, cx, cy, r - 1, Element.WALL);
    } else {
      // Glass ring (decorative translucent ring)
      strokeCircle(out, cx, cy, r, Element.GLASS);
      // Fill the compartment between this ring and the next wall ring
      const outerWallR = ringRadii[ri - 1];
      const innerWallR = ringRadii[ri + 1];
      if (outerWallR && innerWallR) {
        const midR = (outerWallR + innerWallR) / 2;
        // Wedge fills in alternating quadrants
        const fillElem = [Element.SAND, Element.WATER, Element.SAND, Element.FIRE];
        const petalCount = 8;
        for (let p = 0; p < petalCount; p++) {
          const startAngle = (p / petalCount) * Math.PI * 2 + rng() * 0.05;
          const endAngle = ((p + 0.4) / petalCount) * Math.PI * 2;
          const wedgeElem = fillElem[p % fillElem.length];
          const life = wedgeElem === Element.FIRE ? 40 : 0;
          for (let a = startAngle; a < endAngle; a += 0.04) {
            for (let rr = innerWallR + 1; rr < outerWallR - 1; rr++) {
              const px = Math.round(cx + rr * Math.cos(a));
              const py = Math.round(cy + rr * Math.sin(a) * 0.85);
              if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H)
                out.push(px, py, wedgeElem, life);
            }
          }
        }
      }
    }
  }

  // ── Radial spokes connecting rings ──
  const spokeCount = 12;
  for (let s = 0; s < spokeCount; s++) {
    const a = (s / spokeCount) * Math.PI * 2;
    const x1 = Math.round(cx + 10 * Math.cos(a));
    const y1 = Math.round(cy + 10 * Math.sin(a) * 0.85);
    const x2 = Math.round(cx + maxR * Math.cos(a));
    const y2 = Math.round(cy + maxR * Math.sin(a) * 0.85);
    line(out, x1, y1, x2, y2, Element.WALL);
  }

  // ── Center piece: lava core inside glass ──
  fillCircle(out, cx, cy, 6, Element.GLASS);
  fillCircle(out, cx, cy, 3, Element.LAVA, 180);

  // ── Accents: small wall dots on outer ring for visual rhythm ──
  let dotIdx = 0;
  for (let a = 0; a < 360; a += 15) {
    const rad = a * Math.PI / 180;
    const dx = (maxR + 1) * Math.cos(rad);
    const dy = (maxR + 1) * Math.sin(rad) * 0.85;
    const px = Math.round(cx + dx);
    const py = Math.round(cy + dy);
    if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H)
      out.push(px, py, dotIdx++ % 3 === 0 ? Element.WALL : Element.GLASS);
  }

  return out.cells;
};

// ─── Scene: Galaxy Spiral ──────────────────────────────────────
const galaxy: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();
  const cx = GRID_W / 2 + (rng() - 0.5) * 25;
  const cy = GRID_H * 0.42 + (rng() - 0.5) * 15;

  // ── Dual spiral arms ──
  // Use fire + lava for the inner glow (they'll rise/interact nicely)
  // Use glass + wall for the stable outer arm structure
  for (let arm = 0; arm < 2; arm++) {
    const armOffset = arm * Math.PI;
    for (let a = 0; a < 600; a += 1) {
      const rad = (a * Math.PI / 180) + armOffset;
      const t = a / 600;
      const dist = 4 + t * 75;
      const spread = 0.8 + t * 0.5;
      const x = cx + dist * Math.cos(rad + dist * 0.025 + seed * 0.5) + (rng() - 0.5) * spread;
      const y = cy + dist * Math.sin(rad + dist * 0.025 + seed * 0.5) * 0.45 + (rng() - 0.5) * spread * 0.5;

      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H) {
        // Inner → outer: lava core → fire → glass → wall rim for structure
        let elem: number, life = 0;
        if (t < 0.15) {
          elem = Element.LAVA;
          life = 200;
        } else if (t < 0.35) {
          elem = Element.FIRE;
          life = 40 + rng() * 20;
        } else if (t < 0.6) {
          elem = rng() > 0.5 ? Element.GLASS : Element.FIRE;
          life = elem === Element.FIRE ? 30 + rng() * 15 : 0;
        } else {
          elem = Element.GLASS;
        }
        out.push(px, py, elem, life);

        // Star-like bright clumps
        if (rng() < 0.04 && t > 0.2) {
          const sx = px + Math.floor((rng() - 0.5) * 3);
          const sy = py + Math.floor((rng() - 0.5) * 3);
          if (sx >= 0 && sx < GRID_W && sy >= 0 && sy < GRID_H)
            out.push(sx, sy, Element.FIRE, 10 + rng() * 15);
        }
      }
    }
  }

  // ── Bright galactic core ──
  fillCircle(out, cx, cy, 6 + rng() * 3, Element.LAVA, 220);
  fillCircle(out, cx, cy, 4, Element.FIRE, 70);
  fillCircle(out, cx, cy, 2, Element.FIRE, 40);

  // ── Scattered background stars (glass = stable, won't fall) ──
  for (let i = 0; i < 150; i++) {
    const sx = Math.floor(rng() * GRID_W);
    const sy = Math.floor(rng() * GRID_H);
    out.push(sx, sy, Element.GLASS);
  }
  // Brighter twinkling stars (very-short-life fire)
  for (let i = 0; i < 60; i++) {
    const sx = Math.floor(rng() * GRID_W);
    const sy = Math.floor(rng() * GRID_H);
    out.push(sx, sy, Element.FIRE, 5 + Math.floor(rng() * 10));
  }

  return out.cells;
};

// ─── Scene: Sunset Beach ────────────────────────────────────────
const beach: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // ── Ocean with animated-looking wave ridges ──
  const horizonY = GRID_H * (0.32 + rng() * 0.06);
  for (let i = 0; i < 4000; i++) {
    const px = Math.floor(rng() * GRID_W);
    const py = Math.floor(rng() * horizonY);
    const waveY = horizonY + Math.sin(px * 0.04 + seed) * 5 + Math.sin(px * 0.09 + seed * 2) * 2;
    if (py >= waveY)
      out.push(px, py, Element.WATER);
  }
  // Additional wave crest ridges
  for (let x = 0; x < GRID_W; x++) {
    const crestY = horizonY + Math.sin(x * 0.04 + seed) * 5 + Math.sin(x * 0.09 + seed * 2) * 2;
    for (let t = -2; t <= 0; t++) {
      const py = Math.round(crestY + t);
      if (py >= 0 && py < GRID_H) out.push(x, py, Element.WATER);
    }
  }

  // ── Sandy beach with gentle slope ──
  const beachStart = horizonY + 2;
  for (let y = Math.floor(beachStart); y < GRID_H; y++) {
    const sandLine = beachStart + Math.sin(y * 0.06 + seed) * 2;
    for (let x = 0; x < GRID_W; x++) {
      const tideWobble = Math.sin(x * 0.06 + y * 0.03) * 3;
      if (y > sandLine + tideWobble) {
        // Wet sand zone (thicker, mixed with water)
        if (y - sandLine < 6 && rng() < 0.15)
          out.push(x, y, Element.WATER);
        else
          out.push(x, y, Element.SAND);
      }
    }
  }

  // ── Foam line between water and sand ──
  for (let x = 0; x < GRID_W; x++) {
    const foamY = beachStart + Math.sin(x * 0.06 + seed) * 2 - 1;
    out.push(x, Math.round(foamY), Element.GLASS);
  }

  // ── Palm trees with better fronds ──
  const treeCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < treeCount; i++) {
    const tx = 25 + rng() * (GRID_W - 50);
    const ty = Math.floor(beachStart + 12 + rng() * (GRID_H - beachStart - 20));
    const trunkH = 5 + Math.floor(rng() * 5);
    // Curved trunk (coconut-palm style)
    for (let t = 0; t < trunkH; t++) {
      const wobble = Math.sin(t * 0.5 + i * 2) * 2;
      const px = Math.round(tx + wobble);
      out.push(px, ty - t, Element.WOOD);
    }
    // Palm fronds (longer, more organic)
    const frondY = ty - trunkH;
    const frondCount = 5 + Math.floor(rng() * 4);
    for (let f = 0; f < frondCount; f++) {
      const angle = (f / frondCount) * Math.PI * 2 + rng() * 0.1;
      const len = 5 + rng() * 6;
      const fX = Math.round(tx + len * Math.cos(angle));
      const fY = Math.round(frondY + len * Math.sin(angle) * 0.6);
      line(out, tx, frondY, fX, fY, Element.PLANT);
      // Thicker frond base
      const midX = Math.round((tx + fX) / 2);
      const midY = Math.round((frondY + fY) / 2);
      out.push(midX, midY, Element.PLANT);
    }
  }

  // ── Tide pools (small water patches on beach) ──
  for (let i = 0; i < 2 + Math.floor(rng() * 3); i++) {
    const px = 20 + rng() * (GRID_W - 40);
    const py = Math.floor(beachStart + 6 + rng() * 12);
    fillCircle(out, px, py, 2 + rng() * 3, Element.WATER);
  }

  // ── Rocks scattered on beach ──
  for (let i = 0; i < 3 + Math.floor(rng() * 5); i++) {
    const rx = 10 + rng() * (GRID_W - 20);
    const ry = Math.floor(beachStart + 5 + rng() * (GRID_H - beachStart - 10));
    const rr = 1.5 + rng() * 3.5;
    fillCircle(out, rx, ry, rr, Element.WALL);
  }

  // ── Scattered shells (glass specks) ──
  scatter(out, 10, beachStart + 6, GRID_W - 20, Math.floor(GRID_H - beachStart - 10), Element.GLASS, 4, rng);

  return out.cells;
};

// ─── Scene: Bioluminescent Cave ────────────────────────────────
const cave: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  const ceilingH = 25 + Math.floor(rng() * 10);
  const floorTop = GRID_H - 18 - Math.floor(rng() * 8);

  // ── Cave ceiling (organic noise shape) ──
  for (let y = 0; y < ceilingH; y++) {
    const t = y / ceilingH;
    for (let x = 0; x < GRID_W; x++) {
      const n = noise(x * 0.03, y * 0.05, seed);
      if (n > 0.5 - t * 0.15 || y < 3) out.push(x, y, Element.WALL);
    }
  }

  // ── Stalactites (dripping from ceiling) ──
  const stalCount = 6 + Math.floor(rng() * 8);
  for (let i = 0; i < stalCount; i++) {
    const sx = 8 + rng() * (GRID_W - 16);
    const len = 4 + Math.floor(rng() * 10);
    for (let l = 0; l < len && ceilingH + l < floorTop; l++) {
      const wobble = Math.sin(l * 0.4 + sx) * 1;
      const px = Math.round(sx + wobble);
      if (px > 0 && px < GRID_W)
        out.push(px, ceilingH + l, Element.WALL);
    }
    // Dripping water at tip
    if (rng() > 0.5) {
      const tipX = Math.round(sx + Math.sin(len * 0.4 + sx) * 1);
      const tipY = ceilingH + len;
      if (tipY < floorTop) out.push(tipX, tipY, Element.WATER);
    }
  }

  // ── Cave floor with undulating surface ──
  for (let y = floorTop; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const n = noise(x * 0.04, y * 0.05, seed + 2);
      const floorLine = floorTop + Math.sin(x * 0.04 + seed) * 2;
      if (y <= floorLine || n > 0.45)
        out.push(x, y, Element.WALL);
      else
        out.push(x, y, Element.SAND);
    }
  }

  // ── Stalagmites (growing from floor) ──
  for (let i = 0; i < 4 + Math.floor(rng() * 5); i++) {
    const sx = 15 + rng() * (GRID_W - 30);
    const len = 3 + Math.floor(rng() * 7);
    for (let l = 0; l < len; l++) {
      const wobble = Math.sin(l * 0.3 + sx + seed) * 1;
      const py = floorTop - 1 - l;
      if (py > ceilingH)
        out.push(Math.round(sx + wobble), py, Element.WALL);
    }
  }

  // ── Glowing crystal formations (glass, rising from floor) ──
  const crystalCount = 4 + Math.floor(rng() * 6);
  for (let i = 0; i < crystalCount; i++) {
    const cx2 = 15 + rng() * (GRID_W - 30);
    const cy2 = floorTop - 2 - rng() * 4;
    const crystalH = 3 + Math.floor(rng() * 7);
    for (let h = 0; h < crystalH; h++) {
      const wobble = Math.sin(h * 0.6 + i * 3 + seed) * 1.5;
      const px = Math.round(cx2 + wobble);
      const py = cy2 - h;
      if (py > ceilingH) {
        out.push(px, py, Element.GLASS);
        // Glow at crystal tip
        if (h === crystalH - 1 && rng() > 0.5)
          out.push(px, py, Element.FIRE, 40 + rng() * 20);
      }
    }
  }

  // ── Acid pools on floor ──
  const acidCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < acidCount; i++) {
    const px = 25 + rng() * (GRID_W - 50);
    const py = floorTop + 3 + rng() * (GRID_H - floorTop - 8);
    const ar = 4 + rng() * 5;
    fillCircle(out, px, py, ar, Element.ACID);
    // Sizzle effect (fire on surface)
    scatter(out, Math.round(px - ar), Math.round(py - 1), Math.round(ar * 2), 3, Element.FIRE, 5, rng, 20);
  }

  // ── Underground water pool ──
  const poolX = 30 + rng() * (GRID_W - 60);
  const poolY = floorTop + 2;
  fillCircle(out, poolX, poolY, 6 + rng() * 5, Element.WATER);

  // ── Bioluminescent mushrooms (fixed: plant on floor, glow above) ──
  const mushCount = 5 + Math.floor(rng() * 7);
  for (let i = 0; i < mushCount; i++) {
    const px = Math.round(10 + rng() * (GRID_W - 20));
    const py = floorTop - 1;
    // Stem
    out.push(px, py, Element.PLANT);
    out.push(px, py - 1, Element.PLANT);
    // Cap (glowing — fire on the cap, not overwriting plant)
    out.push(px, py - 2, Element.FIRE, 60 + rng() * 30);
    // Side glow
    if (rng() > 0.5) out.push(px + 1, py - 2, Element.FIRE, 40 + rng() * 20);
  }

  return out.cells;
};

// ─── Scene: Strata (geological layers) ──────────────────────────
const strata: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  const elemCycle = [Element.WALL, Element.SAND, Element.WOOD, Element.GLASS, Element.WALL, Element.SAND, Element.OIL, Element.WALL];
  const layerCount = 5 + Math.floor(rng() * 4);

  // ── Generate layer heights with some variation ──
  const layers: { yStart: number; yEnd: number; elem: number; faultOffset: number }[] = [];
  let currentY = 0;
  for (let l = 0; l < layerCount; l++) {
    const remaining = GRID_H - currentY;
    const h = Math.min(remaining, 8 + Math.floor(rng() * (l === layerCount - 1 ? remaining : 22)));
    if (h < 3) break;
    layers.push({
      yStart: currentY,
      yEnd: currentY + h,
      elem: elemCycle[l % elemCycle.length],
      faultOffset: (rng() - 0.5) * (l > 0 && rng() > 0.6 ? 6 : 2),
    });
    currentY += h;
  }
  // Fill any remaining space with last layer
  if (currentY < GRID_H) {
    const last = layers[layers.length - 1];
    if (last) last.yEnd = GRID_H - 1;
  }

  // ── Draw layers with undulating boundaries and fault lines ──
  for (const layer of layers) {
    const { yStart, yEnd, elem, faultOffset } = layer;
    for (let y = yStart; y <= yEnd; y++) {
      for (let x = 0; x < GRID_W; x++) {
        // Undulating boundary
        const waveOffset = Math.sin(x * 0.04 + yStart * 0.01 + seed) * 3
          + Math.sin(x * 0.08 + seed * 2) * 1.5;
        // Fault line displacement (vertical shift at certain x)
        const faultX = GRID_W * 0.5 + Math.sin(seed + layer.yStart) * 25;
        const faultDist = Math.max(0, 1 - Math.abs(x - faultX) / 4);
        const yShift = faultOffset * faultDist * faultDist;
        if (y >= yStart + Math.round(waveOffset + yShift))
          out.push(x, y, elem);
      }
    }
  }

  // ── Embedded fossils / geodes (glass + fire/lava pockets) ──
  for (let i = 0; i < 6 + Math.floor(rng() * 8); i++) {
    const px = 8 + Math.floor(rng() * (GRID_W - 16));
    const py = 8 + Math.floor(rng() * (GRID_H - 16));
    const size = 2 + Math.floor(rng() * 4);
    if (size > 3 && rng() > 0.5) {
      // Geode: glass shell with lava/fire inside
      strokeCircle(out, px, py, size, Element.GLASS);
      fillCircle(out, px, py, size - 1, rng() > 0.5 ? Element.LAVA : Element.GLASS,
        rng() > 0.5 ? 120 + rng() * 60 : 0);
    } else {
      // Fossil: a small glass/blob inclusion
      fillCircle(out, px, py, size, rng() > 0.5 ? Element.GLASS : Element.WOOD);
    }
  }

  // ── Coal seams (thin oil layers) ──
  for (let s = 0; s < 1 + Math.floor(rng() * 3); s++) {
    const seamY = 15 + Math.floor(rng() * (GRID_H - 30));
    const seamH = 1 + Math.floor(rng() * 2);
    for (let y = seamY; y < seamY + seamH; y++) {
      for (let x = 5; x < GRID_W - 5; x++) {
        if (Math.sin(x * 0.1 + seed + s * 5) > 0.3)
          out.push(x, y, Element.OIL);
      }
    }
  }

  // ── Water table at bottom (undulating, not flat) ──
  const waterTop = GRID_H - 6 + Math.floor(rng() * 3);
  for (let y = waterTop; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const wave = Math.sin(x * 0.06 + seed) * 1.5;
      if (y >= waterTop + wave && rng() < 0.85)
        out.push(x, y, Element.WATER);
    }
  }

  return out.cells;
};

// ─── Scene: Aurora Borealis ─────────────────────────────────────
const aurora: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // ── Snowy ground (sand + glass for icy highlights) ──
  const snowTop = Math.floor(GRID_H * 0.72 + rng() * 0.05 * GRID_H);
  fillRect(out, 0, snowTop, GRID_W, GRID_H - snowTop, Element.SAND);
  // Icy patches
  scatter(out, 0, snowTop, GRID_W, GRID_H - snowTop, Element.GLASS, 8, rng);

  // ── Aurora bands (glass + fire — glass stays, fire animates!) ──
  // Using glass as the stable aurora colour + fire with long life that'll
  // rise slowly and create a drifting effect as physics runs.
  const bandCount = 3 + Math.floor(rng() * 3);
  for (let b = 0; b < bandCount; b++) {
    const by = 15 + b * 30 + rng() * 10;
    for (let x = 0; x < GRID_W; x++) {
      const wave =
        Math.sin(x * 0.015 + b * 2.3 + seed) * 20 +
        Math.sin(x * 0.04 + b * 3.7 + seed * 2) * 8 +
        Math.sin(x * 0.008 + b * 1.1 + seed * 0.7) * 12;
      const y = by + Math.round(wave);
      if (y < 0 || y >= snowTop) continue;
      // Core band (glass — stable)
      out.push(x, y, Element.GLASS);
      // Glowing edge (fire — will drift up, nice aurora effect)
      if (rng() < 0.4) {
        const glowY = y - 1 + (rng() > 0.5 ? 1 : 0);
        if (glowY > 0 && glowY < snowTop)
          out.push(x, glowY, Element.FIRE, 30 + Math.floor(rng() * 25));
      }
      // Secondary wisp
      if (rng() < 0.15) {
        out.push(x, y + (rng() > 0.5 ? 1 : -1), Element.FIRE, 15 + Math.floor(rng() * 20));
      }
    }
  }

  // ── Additional vertical "pillar" aurora streaks ──
  for (let p = 0; p < 5 + Math.floor(rng() * 6); p++) {
    const px = 15 + rng() * (GRID_W - 30);
    const py = 5 + rng() * (snowTop * 0.5);
    const len = 5 + Math.floor(rng() * 15);
    for (let l = 0; l < len; l++) {
      const wobble = Math.sin(l * 0.2 + seed + p) * 2;
      const sx = Math.round(px + wobble);
      const sy = py + l;
      if (sy < snowTop)
        out.push(sx, sy, rng() > 0.5 ? Element.GLASS : Element.FIRE,
          rng() > 0.5 ? 0 : 20 + Math.floor(rng() * 20));
    }
  }

  // ── Stars (glass for stable twinkle, short-fire for intermittent) ──
  for (let i = 0; i < 100; i++) {
    const sx = Math.floor(rng() * GRID_W);
    const sy = Math.floor(rng() * snowTop);
    out.push(sx, sy, Element.GLASS);
  }
  for (let i = 0; i < 40; i++) {
    const sx = Math.floor(rng() * GRID_W);
    const sy = Math.floor(rng() * snowTop);
    out.push(sx, sy, Element.FIRE, 8 + Math.floor(rng() * 12));
  }

  // ── Pine trees on the snowy ground ──
  const treeCount = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < treeCount; i++) {
    const tx = 12 + rng() * (GRID_W - 24);
    const ty = snowTop + 2 + Math.floor(rng() * 5);
    const treeH = 6 + Math.floor(rng() * 7);
    // Trunk
    for (let t = 0; t < treeH; t++)
      out.push(tx, ty - t, Element.WOOD);
    // Foliage layers (triangular)
    for (let layer = 0; layer < 3; layer++) {
      const ly = ty - treeH + 2 + layer * 3;
      const lw = 4 - layer;
      for (let px = tx - lw; px <= tx + lw; px++) {
        if (px > 0 && px < GRID_W)
          out.push(px, ly, Element.PLANT);
      }
    }
    // Snow cap (glass)
    out.push(tx, ty - treeH - 1, Element.GLASS);
    out.push(tx, ty - treeH, Element.GLASS);
  }

  return out.cells;
};

// ─── Scene: Abstract Color Field ────────────────────────────────
const abstract: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // ── Base: broad horizontal bands with noise-driven edges ──
  // Use stable elements (wall/glass/wood) that hold their shape
  // with pockets of dynamic elements (sand/water/lava) for emergent behaviour
  const bandCount = 4 + Math.floor(rng() * 4);
  const bandElems = [Element.GLASS, Element.WALL, Element.SAND, Element.WOOD, Element.GLASS, Element.WALL, Element.PLANT];
  let yPos = 0;
  for (let b = 0; b < bandCount; b++) {
    const bandH = Math.floor(GRID_H / bandCount) + (rng() - 0.5) * 8;
    const elem = bandElems[b % bandElems.length];
    for (let y = yPos; y < Math.min(GRID_H, yPos + bandH); y++) {
      for (let x = 0; x < GRID_W; x++) {
        const n = noise(x * 0.025, y * 0.03 + b * 50, seed);
        if (n > 0.35) out.push(x, y, elem);
      }
    }
    // Wavy transition zone to next band
    for (let x = 0; x < GRID_W; x++) {
      const waveY = yPos + bandH + Math.sin(x * 0.04 + b * 2 + seed) * 3;
      for (let t = -1; t <= 1; t++) {
        const py = Math.round(waveY + t);
        if (py > 0 && py < GRID_H) out.push(x, py, rng() > 0.5 ? elem : bandElems[(b + 1) % bandElems.length]);
      }
    }
    yPos += bandH;
  }
  // Fill remaining
  if (yPos < GRID_H) {
    for (let y = yPos; y < GRID_H; y++)
      for (let x = 0; x < GRID_W; x++)
        out.push(x, y, bandElems[bandCount % bandElems.length]);
  }

  // ── Organic fluid blobs (lava/water/acid in wall compartments) ──
  const blobCount = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < blobCount; i++) {
    const bx = 15 + rng() * (GRID_W - 30);
    const by = 10 + rng() * (GRID_H - 35);
    const br = 5 + rng() * 10;
    // Wall rim holds the blob in place
    strokeCircle(out, bx, by, br + 1, Element.WALL);
    strokeCircle(out, bx, by, br, Element.WALL);
    // Fill with dynamic element
    const fillElem = [Element.WATER, Element.LAVA, Element.ACID, Element.SAND][Math.floor(rng() * 4)];
    const life = fillElem === Element.LAVA ? 180 : fillElem === Element.WATER ? 0 : 0;
    fillCircle(out, bx, by, br - 1, fillElem, life);
    // Glow/steam above
    if (fillElem === Element.LAVA || fillElem === Element.ACID)
      scatter(out, Math.round(bx - br), Math.round(by - br), Math.round(br * 2), 4, Element.FIRE, 12, rng, 20);
  }

  // ── Vein-like lines (thin streaks of contrasting elements) ──
  const veinCount = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < veinCount; i++) {
    let vx = Math.floor(rng() * GRID_W);
    let vy = 0;
    const velem = [Element.WATER, Element.LAVA, Element.OIL, Element.ACID][i % 4];
    const life = velem === Element.LAVA ? 50 : 0;
    while (vy < GRID_H) {
      out.push(vx, vy, velem, life);
      vx += Math.floor((rng() - 0.5) * 4);
      vy += 1 + Math.floor(rng() * 2);
      if (vx < 0 || vx >= GRID_W) break;
    }
  }

  // ── Scattered accent dots (glass + fire burst) ──
  for (let i = 0; i < 20 + rng() * 20; i++) {
    const px = Math.floor(rng() * GRID_W);
    const py = Math.floor(rng() * GRID_H);
    out.push(px, py, rng() > 0.5 ? Element.GLASS : Element.FIRE, rng() > 0.5 ? 0 : 10 + Math.floor(rng() * 15));
  }

  return out.cells;
};

// ─── Scene registry ─────────────────────────────────────────────
export interface SceneInfo {
  name: string;
  emoji: string;
  description: string;
  generate: SceneBuilder;
}

export const SCENES: SceneInfo[] = [
  {
    name: 'Volcano Island',
    emoji: '🌋',
    description: 'Towering volcano with flowing lava, surrounded by ocean',
    generate: volcano,
  },
  {
    name: 'Zen Garden',
    emoji: '🪨',
    description: 'Peaceful sand garden with stones, plants, and a koi pond',
    generate: zenGarden,
  },
  {
    name: 'Waterfall Canyon',
    emoji: '💧',
    description: 'Cascading waterfall plunging into a crystal pool',
    generate: waterfall,
  },
  {
    name: 'Lava Delta',
    emoji: '🌊',
    description: 'Lava rivers branching into the sea',
    generate: lavaDelta,
  },
  {
    name: 'Mandala',
    emoji: '🌀',
    description: 'Symmetrical geometric rings of color',
    generate: mandala,
  },
  {
    name: 'Galaxy Spiral',
    emoji: '🌌',
    description: 'Swirling cosmic arms of fire and crystal',
    generate: galaxy,
  },
  {
    name: 'Sunset Beach',
    emoji: '🏖️',
    description: 'Tropical shore with palms, waves, and rocks',
    generate: beach,
  },
  {
    name: 'Bioluminescent Cave',
    emoji: '🕯️',
    description: 'Underground cavern with glowing crystals and acid pools',
    generate: cave,
  },
  {
    name: 'Strata',
    emoji: '📐',
    description: 'Geological layers with hidden fossils',
    generate: strata,
  },
  {
    name: 'Aurora Borealis',
    emoji: '🌠',
    description: 'Northern lights dancing over snowy pines',
    generate: aurora,
  },
  {
    name: 'Abstract Color Field',
    emoji: '🎨',
    description: 'Organic blobs and gradient bands of color',
    generate: abstract,
  },
];

// ─── Place cells into grid (worker-compatible) ─────────────────
export function buildScenePlacement(sceneIndex: number, seed: number): ArrayBuffer {
  const scene = SCENES[sceneIndex];
  const cells = scene.generate(seed);

  // Pack into a buffer: for each cell, [x(16bit LE), y(16bit LE), elem(8bit), life(8bit)]
  const buf = new ArrayBuffer(cells.length * 6);
  const view = new DataView(buf);
  for (let i = 0; i < cells.length; i++) {
    const [x, y, elem, life] = cells[i];
    const off = i * 6;
    view.setUint16(off, x, true);
    view.setUint16(off + 2, y, true);
    view.setUint8(off + 4, elem);
    view.setUint8(off + 5, life);
  }
  return buf;
}

/** Pick a random scene index */
export function randomSceneIndex(rng: () => number): number {
  return Math.floor(rng() * SCENES.length);
}
