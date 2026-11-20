import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim';
import { Element, ELEMENT_COUNT, GRID_W, GRID_H, SAVE_HEADER_BYTES } from '../src/types';

// ─── Helpers ────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mk = (w = 40, h = 40, seed = 1) => new Sim(w, h, mulberry32(seed));
const set = (s: Sim, x: number, y: number, e: number, life = 0) => { const j = y * s.w + x; s.grid[j] = e; s.life[j] = life; };
const get = (s: Sim, x: number, y: number) => s.grid[y * s.w + x];
const run = (s: Sim, n: number) => { for (let k = 0; k < n; k++) s.step(); };
function where(s: Sim, e: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (get(s, x, y) === e) out.push([x, y]);
  return out;
}
const floorWall = (s: Sim, x0: number, x1: number, y: number, e = Element.WALL) => { for (let x = x0; x <= x1; x++) set(s, x, y, e); };

describe('powder', () => {
  it('sand falls to the floor', () => {
    const s = mk();
    set(s, 20, 5, Element.SAND);
    run(s, 60);
    // Landing at speed hops the grain one cell sideways, so only the row is fixed.
    expect(where(s, Element.SAND).length).toBe(1);
    expect(where(s, Element.SAND).every(([, y]) => y === 39)).toBe(true);
  });

  it('sand rests on the floor without moving', () => {
    const s = mk();
    set(s, 20, 39, Element.SAND);
    run(s, 20);
    expect(where(s, Element.SAND)).toEqual([[20, 39]]);
  });

  it('a column of sand spreads into a pile wider than one cell and conserves mass', () => {
    const s = mk();
    for (let y = 0; y < 20; y++) set(s, 20, y, Element.SAND);
    run(s, 400);
    const sand = where(s, Element.SAND);
    expect(sand.length).toBe(20);
    const bottomRow = sand.filter(([, y]) => y === 39).length;
    expect(bottomRow).toBeGreaterThan(1);
  });
});

describe('liquids and gases', () => {
  it('steam rises at most one cell per tick', () => {
    const s = mk();
    set(s, 20, 35, Element.STEAM, 200);
    let [px, py] = where(s, Element.STEAM)[0];
    for (let k = 0; k < 40; k++) {
      s.step();
      const p = where(s, Element.STEAM)[0];
      expect(p).toBeDefined();
      const [cx, cy] = p;
      expect(py - cy).toBeGreaterThanOrEqual(0);
      expect(py - cy).toBeLessThanOrEqual(1);
      [px, py] = [cx, cy];
    }
    expect(py).toBeLessThan(35);
  });

  it('water disperses sideways at most 14 cells per tick (landing splash) and does spread', () => {
    const s = mk();
    set(s, 20, 10, Element.WATER);
    let prev = 20, maxStep = 0;
    for (let k = 0; k < 60; k++) {
      s.step();
      const p = where(s, Element.WATER);
      expect(p.length).toBe(1);
      const dx = Math.abs(p[0][0] - prev);
      maxStep = Math.max(maxStep, dx);
      expect(dx).toBeLessThanOrEqual(14);
      prev = p[0][0];
    }
    expect(maxStep).toBeGreaterThan(1);
  });

  it('water in a basin settles to a level within one cell', () => {
    const s = mk();
    for (let y = 0; y < 40; y++) { set(s, 10, y, Element.WALL); set(s, 30, y, Element.WALL); }
    for (let x = 11; x <= 29; x++) for (let y = 30; y <= 34; y++) set(s, x, y, Element.WATER);
    run(s, 1500);
    const tops: number[] = [];
    for (let x = 11; x <= 29; x++) {
      const col = where(s, Element.WATER).filter(([cx]) => cx === x).map(([, y]) => y);
      expect(col.length).toBeGreaterThan(0);
      tops.push(Math.min(...col));
    }
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    expect(s.count(Element.WATER)).toBe(95);
  });

  it('mass is conserved across 500 ticks of mixed sand, water, oil and gas', () => {
    const s = mk(40, 40, 7);
    const r = mulberry32(9);
    const kinds = [Element.SAND, Element.WATER, Element.OIL, Element.GAS];
    for (let k = 0; k < 300; k++) {
      const j = Math.floor(r() * 1600);
      if (s.grid[j] === 0) { s.grid[j] = kinds[k % 4]; s.life[j] = 0; }
    }
    const before = kinds.map(e => s.count(e));
    run(s, 500);
    expect(kinds.map(e => s.count(e))).toEqual(before);
  });
});

describe('density and reactions', () => {
  it('sand sinks through water', () => {
    const s = mk();
    for (let y = 30; y <= 39; y++) for (let x = 15; x <= 25; x++) set(s, x, y, Element.WATER);
    set(s, 20, 5, Element.SAND);
    run(s, 400);
    const [, sy] = where(s, Element.SAND)[0];
    expect(sy).toBeGreaterThan(30);
  });

  it('oil floats on a water surface', () => {
    const s = mk();
    for (let x = 0; x < 40; x++) set(s, x, 39, Element.WATER);
    set(s, 20, 38, Element.OIL);
    run(s, 60);
    expect(where(s, Element.OIL).every(([, y]) => y === 38)).toBe(true);
  });

  it('lava meeting water makes stone and steam', () => {
    const s = mk();
    set(s, 20, 38, Element.LAVA);
    set(s, 21, 39, Element.WATER);
    for (const [x, y] of [[19, 38], [21, 38], [19, 39], [20, 39], [22, 39]] as const) set(s, x, y, Element.WALL);
    run(s, 2);
    expect(s.count(Element.STONE)).toBe(1);
    expect(s.count(Element.STEAM)).toBeGreaterThanOrEqual(1);
  });

  it('fire ignites wood and leaves ash', () => {
    const s = mk();
    for (let x = 10; x <= 30; x++) set(s, x, 39, Element.WOOD);
    for (let y = 36; y <= 38; y++) set(s, 9, y, Element.FIRE, 50); set(s, 9, 39, Element.FIRE, 50);
    set(s, 9, 35, Element.WALL); // ceiling: fire is buoyant and would otherwise rise away
    run(s, 900);
    expect(s.count(Element.ASH)).toBeGreaterThan(0);
    expect(s.count(Element.WOOD)).toBeLessThan(21);
  });

  it('fire touching sealed water turns it to steam', () => {
    const s = mk();
    set(s, 20, 38, Element.WATER);
    set(s, 20, 37, Element.FIRE, 40);
    for (const [x, y] of [[19, 38], [21, 38], [19, 39], [20, 39], [21, 39]] as const) set(s, x, y, Element.WALL);
    s.step();
    expect(s.count(Element.STEAM)).toBeGreaterThanOrEqual(1);
  });

  it('lava heats adjacent sand into glass', () => {
    const s = mk();
    set(s, 20, 38, Element.LAVA);
    set(s, 21, 39, Element.SAND);
    for (const [x, y] of [[19, 38], [21, 38], [19, 39], [20, 39], [22, 39]] as const) set(s, x, y, Element.WALL);
    run(s, 60);
    expect(s.count(Element.GLASS)).toBeGreaterThanOrEqual(1);
  });

  it('fire melts ice and water freezes against ice', () => {
    const s = mk();
    for (let x = 15; x <= 25; x++) set(s, x, 39, Element.ICE);
    set(s, 26, 39, Element.FIRE, 50);
    set(s, 26, 38, Element.WALL); // ceiling: keeps the buoyant fire beside the ice
    run(s, 60);
    expect(s.count(Element.ICE)).toBeLessThan(11);
    expect(s.count(Element.WATER)).toBeGreaterThan(0);

    const f = mk();
    set(f, 20, 39, Element.ICE);
    set(f, 21, 39, Element.WATER);
    for (const [x, y] of [[22, 39], [21, 38], [20, 38]] as const) set(f, x, y, Element.WALL);
    run(f, 1500);
    expect(f.count(Element.ICE)).toBeGreaterThanOrEqual(2);
  });

  it('seed next to water sprouts and the plant grows', () => {
    const s = mk();
    set(s, 20, 39, Element.SEED);
    set(s, 21, 39, Element.WATER);
    set(s, 22, 39, Element.WALL);
    set(s, 21, 38, Element.WALL);
    run(s, 200);
    expect(s.count(Element.PLANT)).toBeGreaterThan(1);
  });

  it('gunpowder burns with bounded consumption', () => {
    // Each ignition rolls a 20% blast that can clear the chain, so the strip burns out
    // in most seeds but not all. The isolated pile must survive every seed.
    const seeds = Array.from({ length: 12 }, (_, k) => k + 1);
    let burnedOut = 0;
    for (const seed of seeds) {
      const s = mk(40, 40, seed);
      for (let x = 8; x <= 24; x++) set(s, x, 38, Element.WALL); // ceiling keeps buoyant fire in contact
      for (let x = 10; x <= 20; x++) set(s, x, 39, Element.GUNPOWDER); // lit strip
      for (let x = 32; x <= 36; x++) set(s, x, 39, Element.GUNPOWDER); // beyond blast reach
      set(s, 9, 39, Element.FIRE, 40);
      run(s, 300);
      const strip = where(s, Element.GUNPOWDER).filter(([x]) => x <= 21).length;
      if (strip < 6) burnedOut++;
      expect(where(s, Element.GUNPOWDER).filter(([x]) => x >= 32).length).toBe(5);
    }
    expect(burnedOut).toBeGreaterThanOrEqual(10);
  });

  it('firework launches, bursts and all its sparks are gone', () => {
    const s = mk();
    set(s, 20, 39, Element.FIREWORK, 40);
    let maxSpark = 0;
    for (let k = 0; k < 300; k++) { s.step(); maxSpark = Math.max(maxSpark, s.count(Element.SPARK)); }
    expect(maxSpark).toBeGreaterThan(0);
    expect(s.count(Element.SPARK)).toBe(0);
    expect(s.count(Element.FIREWORK)).toBe(0);
  });

  it('acid dissolves sand but not glass or wall', () => {
    const s = mk();
    set(s, 20, 39, Element.GLASS);
    set(s, 21, 39, Element.ACID);
    set(s, 22, 39, Element.SAND);
    set(s, 21, 38, Element.WALL);
    run(s, 100);
    expect(s.count(Element.SAND)).toBe(0);
    expect(s.count(Element.GLASS)).toBe(1);
    expect(s.count(Element.WALL)).toBe(1);
  });

  it('clone copies what touches it and void swallows it', () => {
    const c = mk();
    set(c, 20, 39, Element.CLONE);
    set(c, 21, 39, Element.SAND);
    run(c, 200);
    expect(c.count(Element.SAND)).toBeGreaterThan(1);

    const v = mk();
    set(v, 20, 39, Element.VOID);
    set(v, 21, 39, Element.SAND);
    v.step();
    expect(v.count(Element.SAND)).toBe(0);
  });
});

describe('gravity and wind', () => {
  it('gravity -1 sends sand to the ceiling', () => {
    const s = mk();
    s.gravity = -1;
    set(s, 20, 20, Element.SAND);
    run(s, 40);
    expect(where(s, Element.SAND).length).toBe(1);
    expect(where(s, Element.SAND).every(([, y]) => y === 0)).toBe(true);
  });

  it('wind pushes snow and smoke sideways', () => {
    const snow = mk();
    snow.wind = 1;
    set(snow, 10, 5, Element.SNOW);
    run(snow, 150);
    expect(where(snow, Element.SNOW)[0][0]).toBeGreaterThan(10);

    const smoke = mk();
    smoke.wind = 1;
    set(smoke, 10, 30, Element.SMOKE, 200);
    run(smoke, 60);
    expect(where(smoke, Element.SMOKE)[0][0]).toBeGreaterThan(15);
  });
});

describe('falling', () => {
  it('sand dropped from height 60 lands in fewer than 30 ticks', () => {
    const s = mk(40, 61);
    set(s, 20, 0, Element.SAND);
    let t = 0;
    while (!where(s, Element.SAND).some(([, y]) => y === 60) && t < 100) { s.step(); t++; }
    expect(t).toBeLessThan(30);
  });

  it('a falling sand grain never passes through a one-cell wall floor', () => {
    const s = mk();
    floorWall(s, 0, 39, 30);
    set(s, 20, 0, Element.SAND);
    for (let k = 0; k < 100; k++) {
      s.step();
      expect(where(s, Element.SAND).every(([, y]) => y < 30)).toBe(true);
    }
    expect(s.count(Element.SAND)).toBe(1);
  });

  it('water dropped from height spreads wider after landing than water placed gently', () => {
    const width = (s: Sim) => { const xs = where(s, Element.WATER).map(([x]) => x); return Math.max(...xs) - Math.min(...xs); };
    const drop = mk();
    for (let x = 18; x <= 22; x++) set(drop, x, 5, Element.WATER);
    for (let t = 0; t < 200 && where(drop, Element.WATER).some(([, y]) => y < 39); t++) drop.step();
    run(drop, 5);
    const gentle = mk();
    for (let x = 18; x <= 22; x++) set(gentle, x, 39, Element.WATER);
    run(gentle, 5);
    expect(width(drop)).toBeGreaterThan(width(gentle));
  });

  it('sand and water in a closed box conserve their counts over 300 ticks', () => {
    const s = mk(40, 40, 11);
    const r = mulberry32(5);
    for (let k = 0; k < 40; k++) { set(s, k, 0, Element.WALL); set(s, k, 39, Element.WALL); set(s, 0, k, Element.WALL); set(s, 39, k, Element.WALL); }
    for (let k = 0; k < 400; k++) {
      const j = 1 + Math.floor(r() * 38) * 40 + 1 + Math.floor(r() * 38);
      if (s.grid[j] === 0) s.grid[j] = k % 2 ? Element.SAND : Element.WATER;
    }
    const before = [s.count(Element.SAND), s.count(Element.WATER)];
    run(s, 300);
    expect([s.count(Element.SAND), s.count(Element.WATER)]).toEqual(before);
  });
});

describe('still pools', () => {
  it('a settled water pool changes under 2% of its water cells per tick', () => {
    const s = mk();
    for (let y = 0; y < 40; y++) { set(s, 10, y, Element.WALL); set(s, 30, y, Element.WALL); }
    for (let x = 11; x <= 29; x++) for (let y = 30; y <= 34; y++) set(s, x, y, Element.WATER);
    run(s, 400);
    const before = Uint8Array.from(s.grid);
    s.step();
    let changed = 0;
    for (let k = 0; k < before.length; k++) if (before[k] !== s.grid[k]) changed++;
    expect(changed).toBeLessThan(s.count(Element.WATER) * 0.02);
  });
});

describe('explosions, lightning, painting', () => {
  it('explode and lightning are safe at edges and with bad coordinates', () => {
    const s = mk();
    set(s, 0, 0, Element.SAND); set(s, 39, 39, Element.WATER); set(s, 20, 20, Element.WOOD);
    s.explode(0, 0, 4); s.explode(39, 39, 64); s.explode(-5, NaN, 4); s.explode(20, 20, NaN);
    s.lightning(0, 0); s.lightning(39, 0); s.lightning(NaN, 0); s.lightning(1e9, 0); s.lightning(-1e9, 5);
    run(s, 10);
    for (const v of s.grid) expect(v).toBeLessThan(ELEMENT_COUNT);
  });

  it('serialize round-trips and deserialize rejects bad input', () => {
    const s = mk();
    for (let x = 0; x < 40; x++) set(s, x, 10, Element.SAND);
    set(s, 5, 30, Element.WATER);
    run(s, 20);
    const buf = s.serialize();
    expect(buf.byteLength).toBe(SAVE_HEADER_BYTES + 40 * 40 * 2);
    const s2 = mk();
    expect(s2.deserialize(buf)).toBe(true);
    expect(s2.grid).toEqual(s.grid);
    expect(s2.life).toEqual(s.life);

    const badMagic = buf.slice(0); new Uint8Array(badMagic)[0] ^= 0xff;
    expect(mk().deserialize(badMagic)).toBe(false);
    expect(mk().deserialize(buf.slice(0, buf.byteLength - 1))).toBe(false);
    expect(mk(30, 40).deserialize(buf)).toBe(false);
    const badElem = buf.slice(0); new Uint8Array(badElem)[SAVE_HEADER_BYTES] = 200;
    expect(mk().deserialize(badElem)).toBe(false);
  });

  it('paint draws 8-connected lines, erases, and ignores NaN and out-of-range input', () => {
    const s = mk();
    s.paint(0, 0, 10, 10, Element.SAND, 0);
    expect(s.count(Element.SAND)).toBe(11);
    for (let k = 0; k <= 10; k++) expect(get(s, k, k)).toBe(Element.SAND);

    const line = mk();
    line.paint(0, 0, 10, 3, Element.SAND, 0);
    const cols = where(line, Element.SAND).sort((a, b) => a[0] - b[0]);
    expect(cols.length).toBe(11);
    for (let k = 1; k < cols.length; k++) {
      expect(cols[k][0]).toBe(cols[k - 1][0] + 1);
      expect(Math.abs(cols[k][1] - cols[k - 1][1])).toBeLessThanOrEqual(1);
    }

    s.paint(0, 0, 10, 10, Element.EMPTY, 0);
    expect(s.count(Element.SAND)).toBe(0);

    const safe = mk();
    safe.paint(NaN, 0, 5, 5, Element.SAND, 0);
    safe.paint(-1e9, -1e9, 1e9, 1e9, Element.SAND, 3);
    safe.paint(3.7, 2.2, -4.9, 9.1, Element.STONE, 1.5);
    expect(safe.count(Element.STONE)).toBeGreaterThan(0);
    expect(safe.count(Element.SAND)).toBeGreaterThan(0);
  });
});

describe('fuzz and performance', () => {
  it('64x64 fuzz over all elements, gravities and winds never yields an invalid element', () => {
    const r = mulberry32(42);
    for (const g of [1, -1] as const) for (const wind of [-1, 0, 1, 2] as const) {
      const s = new Sim(64, 64, r);
      s.gravity = g; s.wind = wind;
      for (let t = 0; t < 400; t++) {
        const e = Math.floor(r() * ELEMENT_COUNT);
        s.paint(Math.floor(r() * 64), Math.floor(r() * 64), Math.floor(r() * 64), Math.floor(r() * 64), e, Math.floor(r() * 4));
        if (t % 50 === 0) s.explode(Math.floor(r() * 64), Math.floor(r() * 64), 3);
        if (t % 97 === 0) s.lightning(Math.floor(r() * 64), 0);
        s.step();
      }
      for (const v of s.grid) expect(v).toBeLessThan(ELEMENT_COUNT);
    }
  });

  it('step averages under 4 ms on a 320x200 grid with its bottom half full of sand and water', () => {
    const s = new Sim(GRID_W, GRID_H, mulberry32(8));
    const r = mulberry32(9);
    for (let i = (GRID_H / 2) * GRID_W; i < GRID_W * GRID_H; i++) s.grid[i] = r() < 0.5 ? Element.SAND : Element.WATER;
    for (let k = 0; k < 20; k++) s.step(); // untimed warm-up so JIT compile is not measured
    const t0 = performance.now();
    for (let k = 0; k < 200; k++) s.step();
    const avg = (performance.now() - t0) / 200;
    console.log(`step avg: ${avg.toFixed(2)} ms`);
    expect(avg).toBeLessThan(4);
  });

  it('step plus render averages under 12 ms at full size', () => {
    const s = new Sim(GRID_W, GRID_H, mulberry32(3));
    const r = mulberry32(4);
    for (let i = 0; i < GRID_W * GRID_H; i++) if (r() < 0.5) s.grid[i] = r() < 0.7 ? Element.SAND : Element.WATER;
    const out = new Uint8ClampedArray(GRID_W * GRID_H * 4);
    for (let k = 0; k < 10; k++) { s.step(); s.render(out); } // untimed warm-up so JIT compile is not measured
    const t0 = performance.now();
    for (let k = 0; k < 60; k++) { s.step(); s.render(out); }
    const avg = (performance.now() - t0) / 60;
    console.log(`step+render avg: ${avg.toFixed(2)} ms`);
    expect(avg).toBeLessThan(12);
  });
});

describe('fire brush', () => {
  it('lights flammable cells it is painted over', () => {
    const s = new Sim(20, 20, () => 0.5);
    s.paint(5, 19, 15, 19, Element.WOOD, 0);
    s.paint(5, 19, 5, 19, Element.FIRE, 1);
    expect(s.life[19 * 20 + 5]).toBeGreaterThan(0);
  });
});

describe('sources, TNT, fish and ash', () => {
  it('a painted spring pours water without being touched', () => {
    const s = mk();
    s.paint(20, 5, 20, 5, Element.CLONE, 0, Element.WATER);
    run(s, 100);
    expect(s.count(Element.WATER)).toBeGreaterThan(10);
    expect(s.count(Element.CLONE)).toBe(1);
  });

  it('a seed on ash sprouts with no water and consumes the ash under it', () => {
    const s = mk();
    set(s, 20, 39, Element.ASH);
    set(s, 20, 38, Element.SEED);
    run(s, 300);
    expect(s.count(Element.WATER)).toBe(0);
    expect(s.count(Element.ASH)).toBe(0);
    expect(s.count(Element.PLANT)).toBeGreaterThan(20);
  });

  it('a seed on bare ground with no water stays a seed', () => {
    const s = mk();
    set(s, 20, 39, Element.SEED);
    run(s, 300);
    expect(s.count(Element.PLANT)).toBe(0);
  });

  it('TNT lit by fire blows through a wall and sets off the block beside it', () => {
    const s = mk();
    floorWall(s, 0, 39, 30);
    set(s, 10, 29, Element.TNT);
    set(s, 16, 29, Element.TNT);
    set(s, 10, 28, Element.FIRE, 30);
    run(s, 80);
    expect(s.count(Element.TNT)).toBe(0);
    expect(get(s, 10, 30)).not.toBe(Element.WALL);
    expect(get(s, 16, 30)).not.toBe(Element.WALL);
  });

  it('unlit TNT does nothing', () => {
    const s = mk();
    set(s, 10, 39, Element.TNT);
    run(s, 200);
    expect(get(s, 10, 39)).toBe(Element.TNT);
  });

  it('fish live and move in water, and die on dry land', () => {
    const s = mk();
    for (let y = 30; y < 40; y++) for (let x = 0; x < 40; x++) set(s, x, y, Element.WATER);
    set(s, 20, 35, Element.FISH);
    run(s, 400);
    expect(s.count(Element.FISH)).toBe(1);
    expect(where(s, Element.FISH)[0]).not.toEqual([20, 35]);
    expect(s.count(Element.WATER)).toBe(399);

    const dry = mk();
    set(dry, 20, 39, Element.FISH);
    run(dry, 200);
    expect(dry.count(Element.FISH)).toBe(0);
  });

  it('a fish that eats a seed breeds', () => {
    const s = mk();
    for (let y = 30; y < 40; y++) for (let x = 0; x < 40; x++) set(s, x, y, Element.WATER);
    set(s, 20, 35, Element.FISH);
    set(s, 21, 35, Element.SEED);
    run(s, 50);
    expect(s.count(Element.SEED)).toBe(0);
    expect(s.count(Element.FISH)).toBe(2);
  });
});
