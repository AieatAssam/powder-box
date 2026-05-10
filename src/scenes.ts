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

  // Island base
  const islandCX = GRID_W / 2 + (rng() - 0.5) * 40;
  const islandCY = GRID_H * 0.72 + (rng() - 0.5) * 10;
  const islandR = 58 + rng() * 25;

  // Base island (sand)
  fillCircle(out, islandCX, islandCY, islandR, Element.SAND);

  // Beach ring (lighter sand variation — use same element but the palette gives variation)
  fillCircle(out, islandCX, islandCY, islandR - 5, Element.SAND);

  // Rock ring around volcano base
  const rockR = islandR * 0.45;
  strokeCircle(out, islandCX, islandCY - rockR * 0.2, rockR, Element.WALL);

  // Volcano cone: wall layers
  const peakY = islandCY - rockR * 0.8 + rng() * 8;
  const peakX = islandCX + (rng() - 0.5) * 10;
  for (let layer = 0; layer < 25; layer++) {
    const t = layer / 25;
    const coneR = rockR * (1 - t) * 0.7;
    const cy = peakY + layer;
    if (cy > islandCY) break;
    fillCircle(out, peakX, cy, coneR, Element.WALL);
  }

  // Crater: lava at top
  fillCircle(out, peakX, peakY + 2, 6 + rng() * 4, Element.LAVA, 180);

  // Lava flows down the cone
  for (let i = 0; i < 3 + Math.floor(rng() * 3); i++) {
    const flowX = peakX + (rng() - 0.5) * 12;
    const flowY = peakY + 5;
    for (let d = 0; d < 20 + rng() * 15; d++) {
      const fx = flowX + Math.sin(d * 0.3) * (3 + rng() * 3);
      const fy = flowY + d;
      if (fy > islandCY) break;
      fillCircle(out, fx, fy, 2 + rng() * 2, Element.LAVA, 80 + rng() * 60);
    }
  }

  // Water surrounding the island
  const waterR = islandR + 12 + rng() * 8;
  for (let a = 0; a < 360; a += 1) {
    const rad = a * Math.PI / 180;
    const wx = islandCX + waterR * Math.cos(rad);
    const wy = islandCY + waterR * Math.sin(rad);
    fillCircle(out, wx, wy, 4 + rng() * 3, Element.WATER);
  }
  // Fill water area around island
  for (let py = 0; py < GRID_H; py++) {
    for (let px = 0; px < GRID_W; px++) {
      const dist = Math.sqrt((px - islandCX) ** 2 + (py - islandCY) ** 2);
      if (dist > islandR + 4 && dist < islandR + 30 && rng() < 0.85) {
        out.push(px, py, Element.WATER, 0);
      }
    }
  }

  // Trees on island
  const treeCount = 4 + Math.floor(rng() * 6);
  for (let i = 0; i < treeCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = 8 + rng() * (islandR * 0.55);
    const tx = Math.floor(islandCX + dist * Math.cos(angle));
    const ty = Math.floor(islandCY + dist * Math.sin(angle) * 0.6);
    if (ty < GRID_H - 5 && ty > peakY + 15) {
      const trunkH = 4 + Math.floor(rng() * 4);
      for (let t = 0; t < trunkH; t++)
        out.push(tx, ty - t, Element.WOOD, 0);
      fillCircle(out, tx, ty - trunkH - 2, 3 + rng() * 2, Element.PLANT);
    }
  }

  // Smoke at top
  scatter(out, peakX - 6, peakY - 10, 12, 8, Element.SMOKE, 20, rng, 35);

  // A few rocks on the beach
  scatter(out, islandCX - islandR * 0.6, islandCY + islandR * 0.15, islandR * 0.5, 15, Element.WALL, 5, rng);

  // Small fires / hot rocks near lava
  scatter(out, peakX - 15, peakY + 8, 30, 15, Element.FIRE, 10, rng, 45);

  return out.cells;
};

// ─── Scene: Zen Garden ─────────────────────────────────────────
const zenGarden: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // Sand base (entire bottom area)
  fillRect(out, 0, GRID_H * 0.2, GRID_W, GRID_H * 0.8, Element.SAND);

  // Decorative wall rocks — curved path using sine
  const pathAmp = 20 + rng() * 15;
  const pathFreq = 0.03 + rng() * 0.02;
  for (let x = 20; x < GRID_W - 20; x += 1) {
    const cy = GRID_H * 0.25 + Math.sin(x * pathFreq + seed) * pathAmp * 0.5 + Math.sin(x * pathFreq * 2 + seed * 2) * pathAmp * 0.25;
    if (cy > GRID_H * 0.2 && cy < GRID_H * 0.5) {
      if (rng() < 0.3) out.push(x, Math.floor(cy), Element.WALL, 0);
    }
  }

  // Water pond — organic shape
  const pondX = GRID_W * (0.4 + rng() * 0.2);
  const pondY = GRID_H * (0.55 + rng() * 0.1);
  const pondR = 14 + rng() * 8;
  for (let a = 0; a < 360; a += 3) {
    const rad = a * Math.PI / 180;
    const organicR = pondR + Math.sin(a * 3 + seed) * 3 + Math.sin(a * 7 + seed * 2) * 2;
    const px = pondX + organicR * Math.cos(rad);
    const py = pondY + organicR * Math.sin(rad) * 0.6;
    fillCircle(out, px, py, 2 + rng() * 1.5, Element.WATER);
  }

  // Larger rocks (zen stones)
  const rockPositions = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < rockPositions; i++) {
    const rx = 30 + rng() * (GRID_W - 60);
    const ry = GRID_H * (0.4 + rng() * 0.45);
    const rr = 3 + rng() * 5;
    fillCircle(out, rx, ry, rr, Element.WALL);
    // Smaller rock next to it
    if (rng() > 0.5)
      fillCircle(out, rx + rr + 2 + rng() * 5, ry + (rng() - 0.5) * 4, 1.5 + rng() * 2, Element.WALL);
  }

  // Plants / moss near water
  const plantCount = 6 + Math.floor(rng() * 8);
  for (let i = 0; i < plantCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = pondR + 3 + rng() * 10;
    const px = pondX + dist * Math.cos(angle);
    const py = pondY + dist * Math.sin(angle) * 0.6;
    if (px > 10 && px < GRID_W - 10 && py > GRID_H * 0.3 && py < GRID_H * 0.8)
      out.push(Math.floor(px), Math.floor(py), Element.PLANT, 0);
  }

  // Bridge (wood)
  const bridgeX = pondX - 8 + (rng() - 0.5) * 10;
  for (let i = -6; i <= 6; i++) {
    const by = pondY - 4 + Math.abs(i) * 0.5 - 2;
    for (let j = -1; j <= 1; j++)
      out.push(Math.floor(bridgeX + i), Math.floor(by + j), Element.WOOD, 0);
  }

  return out.cells;
};

// ─── Scene: Waterfall ──────────────────────────────────────────
const waterfall: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  const cliffX = 30 + rng() * 30;
  const cliffH = 55 + rng() * 20;
  const cliffTop = 25 + rng() * 15;

  // Cliff wall (left side)
  fillRect(out, 0, 0, cliffX - 3, GRID_H, Element.WALL);
  // Cliff face
  for (let y = cliffTop; y < cliffTop + cliffH; y++) {
    const wobble = Math.sin(y * 0.2 + seed) * 3 + Math.sin(y * 0.5 + seed * 2) * 1.5;
    const faceX = cliffX + wobble;
    for (let x = Math.floor(faceX - 4); x < Math.floor(faceX + 5); x++)
      if (x > 0 && x < GRID_W) out.push(x, y, Element.WALL, 0);
  }

  // Plateau on top of cliff
  fillRect(out, 0, 0, cliffX + 20, cliffTop - 2, Element.WALL);
  // Water source on plateau
  const waterStart = cliffX - 5 + (rng() - 0.5) * 10;
  fillRect(out, Math.floor(waterStart - 8), 0, Math.floor(waterStart + 8), cliffTop - 2, Element.WATER);

  // Waterfall
  for (let y = cliffTop; y < cliffTop + cliffH; y++) {
    const wobble = Math.sin(y * 0.15 + seed * 3) * 4;
    const wx = cliffX + wobble;
    fillCircle(out, wx, y, 2.5, Element.WATER);
    // Water splashing
    if (rng() < 0.15) {
      fillCircle(out, wx + (rng() - 0.5) * 4, y, 1, Element.WATER);
    }
  }

  // Pool at bottom
  const poolY = cliffTop + cliffH - 3;
  for (let px = cliffX - 20; px < cliffX + 25; px++) {
    const poolDepth = 8 + Math.sin(px * 0.1 + seed) * 3;
    for (let py = poolY; py < Math.min(GRID_H - 1, poolY + poolDepth); py++) {
      if (rng() < 0.8) out.push(px, py, Element.WATER, 0);
    }
  }

  // Sand/beach on right
  fillRect(out, cliffX + 15, poolY + 3, GRID_W - cliffX - 15, GRID_H - poolY - 3, Element.SAND);
  // Sand slope
  for (let y = poolY; y < GRID_H; y++) {
    const sandX = cliffX + 10 + (y - poolY) * 0.5 + Math.sin(y * 0.1) * 5;
    fillRect(out, Math.floor(sandX), y, GRID_W, 1, Element.SAND);
  }

  // Plants near pool
  const plantCount = 5 + Math.floor(rng() * 8);
  for (let i = 0; i < plantCount; i++) {
    const px = cliffX + 12 + rng() * 25;
    const py = poolY + 2 + rng() * 8;
    if (px < GRID_W && py < GRID_H) out.push(Math.floor(px), Math.floor(py), Element.PLANT, 0);
  }

  // Mist (steam) at waterfall base
  scatter(out, cliffX - 8, poolY - 2, 20, 8, Element.STEAM, 25, rng, 30);

  return out.cells;
};

// ─── Scene: Lava Delta ─────────────────────────────────────────
const lavaDelta: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // Rocky terrain base
  for (let y = 0; y < GRID_H * 0.3; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const n = noise(x * 0.04, y * 0.04, seed);
      if (n > 0.5) out.push(x, y, Element.WALL, 0);
    }
  }

  // Lava pool at top
  const lavaCX = GRID_W / 2 + (rng() - 0.5) * 40;
  const lavaCY = 20 + rng() * 15;
  fillCircle(out, lavaCX, lavaCY, 25 + rng() * 10, Element.LAVA, 180);

  // Lava rivers flowing down
  for (let r = 0; r < 3 + Math.floor(rng() * 3); r++) {
    let rx = lavaCX + (rng() - 0.5) * 20;
    let ry = lavaCY + 15;
    for (let step = 0; step < 50; step++) {
      rx += Math.sin(step * 0.2 + r * 5 + seed) * 3 + (rng() - 0.5) * 2;
      ry += 0.8 + rng() * 0.5;
      if (ry >= GRID_H - 5 || rx < 5 || rx >= GRID_W - 5) break;
      fillCircle(out, Math.floor(rx), Math.floor(ry), 3 + Math.sin(step * 0.1) * 1, Element.LAVA, 60 + rng() * 50);
      // Heat/fire around lava
      if (rng() < 0.2) fillCircle(out, Math.floor(rx + (rng() - 0.5) * 4), Math.floor(ry), 1, Element.FIRE, 20 + rng() * 20);
    }
  }

  // Surrounding rock
  fillCircle(out, lavaCX, lavaCY, 30 + rng() * 8, Element.WALL);

  // Water in lower area
  for (let y = Math.floor(GRID_H * 0.5); y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (rng() < 0.7) out.push(x, y, Element.WATER, 0);
    }
  }

  // Floating obsidian/wall in water
  for (let i = 0; i < 5 + Math.floor(rng() * 5); i++) {
    const rx = 20 + rng() * (GRID_W - 40);
    const ry = GRID_H * 0.6 + rng() * (GRID_H * 0.3);
    fillCircle(out, rx, ry, 3 + rng() * 5, Element.WALL);
  }

  // Steam where lava meets water
  scatter(out, lavaCX - 30, lavaCY + 25, 60, 30, Element.STEAM, 15, rng, 40);

  return out.cells;
};

// ─── Scene: Geometric Mandala ───────────────────────────────────
const mandala: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();
  const cx = GRID_W / 2 + (rng() - 0.5) * 20;
  const cy = GRID_H / 2 + (rng() - 0.5) * 15;
  const elements = [Element.SAND, Element.WATER, Element.WALL, Element.WOOD, Element.PLANT, Element.LAVA];

  for (let ring = 1; ring <= 12; ring++) {
    const r = ring * 8 + rng() * 2;
    const elem = elements[ring % elements.length];
    const thickness = 2 + Math.sin(ring * 2) * 1;

    for (let a = 0; a < 360; a += 360 / (ring * 4 + 4)) {
      const rad = a * Math.PI / 180;
      const x = cx + r * Math.cos(rad);
      const y = cy + r * Math.sin(rad) * 0.8;
      if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H) {
        fillCircle(out, x, y, thickness, elem);
      }
    }

    // Radial spokes
    if (ring % 3 === 0) {
      for (let a = 0; a < 360; a += 30 + ring * 2) {
        const rad = a * Math.PI / 180;
        const x2 = cx + (r + 5) * Math.cos(rad);
        const y2 = cy + (r + 5) * Math.sin(rad) * 0.8;
        const x1 = cx + (r - 5) * Math.cos(rad);
        const y1 = cy + (r - 5) * Math.sin(rad) * 0.8;
        line(out, Math.floor(x1), Math.floor(y1), Math.floor(x2), Math.floor(y2), Element.WALL);
      }
    }
  }

  // Center glow (lava/fire in center)
  fillCircle(out, cx, cy, 5 + rng() * 3, Element.LAVA, 180);
  fillCircle(out, cx, cy, 3, Element.FIRE, 45);

  // Outer border
  strokeCircle(out, cx, cy, 100, Element.WALL);

  // Fill background with sand
  fillCircle(out, cx, cy, 110, Element.SAND);

  return out.cells;
};

// ─── Scene: Celestial / Galaxy ──────────────────────────────────
const galaxy: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();
  const cx = GRID_W / 2 + (rng() - 0.5) * 30;
  const cy = GRID_H / 2 + (rng() - 0.5) * 20;

  // Spiral arms
  for (let a = 0; a < 720; a += 1) {
    const rad = a * Math.PI / 180;
    const t = a / 720;
    const dist = 5 + t * 70;
    const x = cx + dist * Math.cos(rad + dist * 0.03 + seed);
    const y = cy + dist * Math.sin(rad + dist * 0.03 + seed) * 0.5;

    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H) {
      const elem = t < 0.2 ? Element.LAVA : t < 0.5 ? Element.FIRE : t < 0.7 ? Element.GLASS : Element.SAND;
      const life = elem === Element.LAVA ? 180 : elem === Element.FIRE ? 45 : 0;
      out.push(px, py, elem, life);

      // Stars (random bright spots)
      if (rng() < 0.05) {
        const sx = px + Math.floor((rng() - 0.5) * 4);
        const sy = py + Math.floor((rng() - 0.5) * 4);
        if (sx >= 0 && sx < GRID_W && sy >= 0 && sy < GRID_H)
          out.push(sx, sy, Element.FIRE, 15 + rng() * 20);
      }
    }
  }

  // Center core (bright lava)
  fillCircle(out, cx, cy, 8 + rng() * 4, Element.LAVA, 200);
  fillCircle(out, cx, cy, 4, Element.FIRE, 60);

  // Distant "stars" scattered in background
  for (let i = 0; i < 200; i++) {
    const sx = Math.floor(rng() * GRID_W);
    const sy = Math.floor(rng() * GRID_H);
    out.push(sx, sy, Element.GLASS, 0);
  }

  return out.cells;
};

// ─── Scene: Sunset Beach ────────────────────────────────────────
const beach: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // Sky (empty, dark background)

  // Ocean — top portion with wavy horizon
  const horizonY = GRID_H * (0.35 + rng() * 0.05);
  for (let y = 0; y < horizonY; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const waveY = horizonY + Math.sin(x * 0.05 + seed) * 4 + Math.sin(x * 0.1 + seed * 2) * 2;
      if (y >= waveY) {
        out.push(x, y, Element.WATER, 0);
      }
    }
  }

  // Sand beach — bottom
  const beachY = horizonY + 3;
  for (let y = Math.floor(beachY); y < GRID_H; y++) {
    const sandLine = beachY + Math.sin(y * 0.08 + seed) * 3;
    const waviness = 3 + Math.sin(y * 0.03 + seed * 2) * 2;
    for (let x = 0; x < GRID_W; x++) {
      if (y > sandLine + Math.sin(x * 0.08 + y * 0.02) * waviness) {
        // Wet sand near water, dry sand further
        if (y - sandLine < 8) {
          // Wet sand — mix with occasional water
          out.push(x, y, Element.SAND, 0);
          if (rng() < 0.1) out.push(x, y, Element.WATER, 0);
        } else {
          out.push(x, y, Element.SAND, 0);
        }
      }
    }
  }

  // Palm trees
  const treeCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < treeCount; i++) {
    const tx = 30 + rng() * (GRID_W - 60);
    const ty = beachY + 10 + rng() * (GRID_H - beachY - 20);
    const trunkH = 6 + Math.floor(rng() * 5);
    // Curved trunk
    for (let t = 0; t < trunkH; t++) {
      const wobble = Math.sin(t * 0.5) * 1.5;
      out.push(Math.floor(tx + wobble), Math.floor(ty - t), Element.WOOD, 0);
    }
    // Palm fronds
    const frondY = ty - trunkH;
    for (let a = 0; a < 360; a += 30) {
      const rad = a * Math.PI / 180;
      const fx = tx + 8 * Math.cos(rad);
      const fy = frondY + 4 * Math.sin(rad);
      line(out, Math.floor(tx), Math.floor(frondY), Math.floor(fx), Math.floor(fy), Element.PLANT);
    }
  }

  // Rocks on the beach
  for (let i = 0; i < 4 + Math.floor(rng() * 5); i++) {
    const rx = 10 + rng() * (GRID_W - 20);
    const ry = beachY + 5 + rng() * (GRID_H - beachY - 10);
    const rr = 2 + rng() * 4;
    fillCircle(out, rx, ry, rr, Element.WALL);
  }

  // Shells / starfish (small bright spots)
  scatter(out, 10, beachY + 5, GRID_W - 20, GRID_H - beachY - 10, Element.GLASS, 3, rng);

  return out.cells;
};

// ─── Scene: Bioluminescent Cave ────────────────────────────────
const cave: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();

  // Ceiling
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const n = noise(x * 0.04, y * 0.06, seed);
      if (n > 0.45) out.push(x, y, Element.WALL, 0);
    }
  }

  // Stalactites
  for (let x = 10; x < GRID_W - 10; x += 5 + Math.floor(rng() * 8)) {
    const n = noise(x * 0.1, seed, seed + 1);
    const len = 5 + n * 10;
    for (let l = 0; l < len && 30 + l < GRID_H - 20; l++) {
      const wobble = Math.sin(l * 0.5 + x) * 1;
      const px = x + Math.floor(wobble);
      if (px > 0 && px < GRID_W)
        out.push(px, 30 + l, Element.WALL, 0);
    }
  }

  // Floor
  for (let y = GRID_H - 25; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const n = noise(x * 0.04, y * 0.05, seed + 2);
      if (n > 0.4)
        out.push(x, y, Element.WALL, 0);
      else
        out.push(x, y, Element.SAND, 0);
    }
  }

  // Acid pools
  for (let i = 0; i < 2 + Math.floor(rng() * 3); i++) {
    const px = 30 + rng() * (GRID_W - 60);
    const py = GRID_H - 20 + (rng() - 0.5) * 10;
    fillCircle(out, px, py, 5 + rng() * 6, Element.ACID);
    // Acid glow — fire around acid
    scatter(out, px - 6, py - 6, 12, 12, Element.FIRE, 10, rng, 30);
  }

  // Crystal formations (glass)
  for (let i = 0; i < 5 + Math.floor(rng() * 8); i++) {
    const cx2 = 20 + rng() * (GRID_W - 40);
    const cy2 = 35 + rng() * (GRID_H - 60);
    const crystalH = 4 + Math.floor(rng() * 8);
    for (let h = 0; h < crystalH; h++) {
      const wobble = Math.sin(h * 0.7 + seed) * 1.5;
      out.push(Math.floor(cx2 + wobble), Math.floor(cy2 - h), Element.GLASS, 0);
    }
  }

  // Water dripping / pool
  for (let i = 0; i < 3; i++) {
    const px = 40 + rng() * (GRID_W - 80);
    const py = 50 + rng() * (GRID_H - 70);
    fillCircle(out, px, py, 4 + rng() * 4, Element.WATER);
  }

  // Bioluminescent mushrooms (plant + fire)
  for (let i = 0; i < 6 + Math.floor(rng() * 6); i++) {
    const px = 15 + rng() * (GRID_W - 30);
    const py = GRID_H - 20 + (rng() - 0.5) * 8;
    out.push(Math.floor(px), Math.floor(py), Element.PLANT, 0);
    out.push(Math.floor(px), Math.floor(py - 1), Element.PLANT, 0);
    // Glow
    out.push(Math.floor(px), Math.floor(py), Element.FIRE, 50);
  }

  return out.cells;
};

// ─── Scene: Strata (geological layers) ──────────────────────────
const strata: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();
  const layers: [number, number, number][] = []; // [yStart, yEnd, elem]
  const elemCycle = [Element.WALL, Element.SAND, Element.WOOD, Element.WALL, Element.SAND, Element.GLASS, Element.OIL, Element.SAND];

  let currentY = 0;
  for (let l = 0; l < 6 + Math.floor(rng() * 4); l++) {
    const h = 10 + Math.floor(rng() * 25);
    const elem = elemCycle[l % elemCycle.length];
    layers.push([currentY, Math.min(GRID_H - 1, currentY + h), elem]);
    currentY += h;
    if (currentY >= GRID_H) break;
  }

  // Draw layers with undulating boundaries
  for (let l = 0; l < layers.length; l++) {
    const [yStart, yEnd, elem] = layers[l];
    for (let y = yStart; y <= yEnd; y++) {
      for (let x = 0; x < GRID_W; x++) {
        // Wavy boundary between layers
        const waveOffset = Math.sin(x * 0.05 + l * 3 + seed) * 3;
        if (y >= yStart + Math.floor(waveOffset)) {
          out.push(x, y, elem, 0);
        }
      }
    }
  }

  // Fossil / crystal pockets
  for (let i = 0; i < 8 + Math.floor(rng() * 8); i++) {
    const px = 10 + Math.floor(rng() * (GRID_W - 20));
    const py = 10 + Math.floor(rng() * (GRID_H - 20));
    const pocketElem = rng() > 0.5 ? Element.GLASS : Element.WOOD;
    const size = 2 + Math.floor(rng() * 4);
    fillCircle(out, px, py, size, pocketElem);
  }

  // Water table at bottom
  fillRect(out, 0, GRID_H - 8, GRID_W, 8, Element.WATER);

  return out.cells;
};

// ─── Scene: Northern Lights / Aurora ────────────────────────────
const aurora: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();
  const cx = GRID_W / 2;

  // Snowy ground
  fillRect(out, 0, Math.floor(GRID_H * 0.75), GRID_W, Math.floor(GRID_H * 0.25), Element.SAND);
  // Snow covered rocks
  for (let i = 0; i < 10; i++) {
    const rx = rng() * GRID_W;
    const ry = GRID_H * 0.75 + rng() * (GRID_H * 0.2);
    fillCircle(out, rx, ry, 2 + rng() * 3, Element.WALL);
  }

  // Aurora bands in the sky
  const colors = [Element.LAVA, Element.FIRE, Element.GLASS, Element.ACID, Element.WATER];
  for (let b = 0; b < 4 + Math.floor(rng() * 3); b++) {
    const by = 20 + b * 25 + rng() * 10;
    const bandElem = colors[b % colors.length];
    const life = bandElem === Element.FIRE ? 60 + rng() * 30 : bandElem === Element.LAVA ? 100 : 0;

    for (let x = 0; x < GRID_W; x++) {
      const wave = Math.sin(x * 0.02 + b * 2 + seed) * 10
        + Math.sin(x * 0.05 + b * 3 + seed * 2) * 5
        + Math.sin(x * 0.01 + b + seed * 0.5) * 15;
      const y = by + Math.floor(wave);
      if (y >= 0 && y < GRID_H * 0.7) {
        // Band thickness varies
        const thickness = 3 + Math.sin(x * 0.03 + b * 4) * 1.5;
        for (let t = 0; t < thickness; t++) {
          if (y + t >= 0 && y + t < GRID_H * 0.7 && rng() < 0.7)
            out.push(x, Math.floor(y + t), bandElem, life);
        }
      }
    }
  }

  // Stars (tiny fire dots with short life)
  for (let i = 0; i < 150; i++) {
    const sx = Math.floor(rng() * GRID_W);
    const sy = Math.floor(rng() * GRID_H * 0.7);
    out.push(sx, sy, Element.FIRE, 10 + Math.floor(rng() * 20));
  }

  // Pine trees on the ground
  for (let i = 0; i < 4 + Math.floor(rng() * 4); i++) {
    const tx = 15 + rng() * (GRID_W - 30);
    const ty = Math.floor(GRID_H * 0.75) + 5;
    const treeH = 8 + Math.floor(rng() * 8);
    // Trunk
    for (let t = 0; t < treeH; t++)
      out.push(tx, ty - t, Element.WOOD, 0);
    // Triangular foliage (plant)
    for (let layer = 0; layer < 3; layer++) {
      const ly = ty - treeH + layer * 4;
      const lw = 5 - layer * 1.5;
      for (let px = tx - Math.floor(lw); px <= tx + Math.floor(lw); px++) {
        if (px > 0 && px < GRID_W)
          out.push(px, ly, Element.PLANT, 0);
      }
    }
  }

  return out.cells;
};

// ─── Scene: Abstract Color Field ────────────────────────────────
const abstract: SceneBuilder = (seed) => {
  const rng = mulberry32(seed);
  const out = makeSink();
  const elements = [Element.SAND, Element.WATER, Element.LAVA, Element.ACID, Element.GLASS, Element.PLANT, Element.WOOD];

  // Gradient-like color bands
  const bands = 5 + Math.floor(rng() * 5);
  for (let b = 0; b < bands; b++) {
    const yStart = (b / bands) * GRID_H;
    const yEnd = ((b + 1) / bands) * GRID_H + 5;
    const elem = elements[b % elements.length];
    const life = elem === Element.LAVA ? 120 : elem === Element.FIRE ? 40 : 0;

    for (let y = Math.floor(yStart); y < Math.floor(yEnd) && y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const n = noise(x * 0.02, y * 0.03 + b * 100, seed);
        if (n > 0.3) out.push(x, y, elem, life);
      }
    }
  }

  // Organic blobs
  const blobCount = 3 + Math.floor(rng() * 5);
  for (let i = 0; i < blobCount; i++) {
    const bx = rng() * GRID_W;
    const by = rng() * GRID_H;
    const br = 8 + rng() * 15;
    const belem = elements[Math.floor(rng() * elements.length)];
    const life = belem === Element.LAVA ? 120 : belem === Element.FIRE ? 40 : 0;
    fillCircle(out, bx, by, br, belem, life);
  }

  // Veins / lightning lines
  const veinCount = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < veinCount; i++) {
    let vx = Math.floor(rng() * GRID_W);
    let vy = 0;
    const velem = elements[i % elements.length];
    while (vy < GRID_H) {
      out.push(vx, vy, velem, 0);
      vx += Math.floor((rng() - 0.5) * 5);
      vy += 1 + Math.floor(rng() * 2);
      if (vx < 0 || vx >= GRID_W) break;
    }
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
