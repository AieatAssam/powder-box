import { describe, it, expect } from 'vitest';
import { SCENES, buildScenePlacement, randomSceneIndex, mulberry32 } from '../src/scenes';
import { Sim } from '../src/sim';
import { Element, ELEMENT_COUNT, GRID_W, GRID_H } from '../src/types';

const W = GRID_W;
const H = GRID_H;
const TOTAL = W * H;
const SIM_TIMEOUT = 120_000;
const SEEDS = [1, 2, 3];
const EMOJI = /\p{Extended_Pictographic}/u;

type Rec = { x: number; y: number; elem: number; life: number };

function decode(buf: ArrayBuffer): Rec[] {
  const v = new DataView(buf);
  const out: Rec[] = [];
  for (let off = 0; off < buf.byteLength; off += 6) {
    out.push({
      x: v.getUint16(off, true),
      y: v.getUint16(off + 2, true),
      elem: v.getUint8(off + 4),
      life: v.getUint8(off + 5),
    });
  }
  return out;
}

function loadSim(index: number, seed: number): Sim {
  const sim = new Sim(W, H, mulberry32(99));
  sim.loadCells(buildScenePlacement(index, seed));
  return sim;
}

function nonEmpty(grid: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] !== Element.EMPTY) n++;
  return n;
}

const NAMES = [
  'Volcano', 'Waterfall Canyon', 'Frozen Lake', 'Hourglass', 'Powder Keg',
  'Fireworks Night', 'Hanging Gardens', 'Gas Mine', "Alchemist's Lab",
  'Desert Oasis', 'Crystal Cave', 'Oil Rig',
];
const idx = (name: string) => NAMES.indexOf(name);

describe('scene registry', () => {
  it('has exactly 12 scenes with the expected names in order', () => {
    expect(SCENES.map((s) => s.name)).toEqual(NAMES);
  });

  it('descriptions are non-empty, emoji-free, one sentence ending in a period', () => {
    for (const s of SCENES) {
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.description, s.name).not.toMatch(EMOJI);
      expect(s.description, s.name).toMatch(/\.$/);
      expect(s.description.slice(0, -1), s.name).not.toMatch(/[.!?]/);
    }
  });
});

describe('placement buffer', () => {
  it('is a whole number of 6-byte records, positions unique and in range', () => {
    SCENES.forEach((s, i) => {
      const buf = buildScenePlacement(i, 1);
      expect(buf.byteLength % 6, s.name).toBe(0);
      const recs = decode(buf);
      const seen = new Set<number>();
      for (const r of recs) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x).toBeLessThan(W);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeLessThan(H);
        const key = r.y * W + r.x;
        expect(seen.has(key), `${s.name} duplicate at ${r.x},${r.y}`).toBe(false);
        seen.add(key);
      }
    });
  });

  it('keeps exactly one record per distinct position (dedupe)', () => {
    SCENES.forEach((s, i) => {
      const cells = s.generate(1);
      const distinct = new Set(
        cells
          .filter(([x, y]) => x >= 0 && x < W && y >= 0 && y < H)
          .map(([x, y]) => y * W + x),
      );
      expect(decode(buildScenePlacement(i, 1)).length, s.name).toBe(distinct.size);
    });
  });

  it('is deterministic for a fixed seed', () => {
    SCENES.forEach((_, i) => {
      const a = new Uint8Array(buildScenePlacement(i, 555));
      const b = new Uint8Array(buildScenePlacement(i, 555));
      expect(a).toEqual(b);
    });
  });

  it('varies with the seed', () => {
    SCENES.forEach((s, i) => {
      const a = new Uint8Array(buildScenePlacement(i, 1));
      const b = new Uint8Array(buildScenePlacement(i, 2));
      expect(a, s.name).not.toEqual(b);
    });
  });

  it('returns an empty buffer for an unknown index', () => {
    expect(buildScenePlacement(-1, 1).byteLength).toBe(0);
    expect(buildScenePlacement(SCENES.length, 1).byteLength).toBe(0);
  });

  it('builds every scene in under 150 ms', () => {
    SCENES.forEach((s, i) => {
      const t0 = performance.now();
      buildScenePlacement(i, 7);
      expect(performance.now() - t0, s.name).toBeLessThan(150);
    });
  });
});

describe('composition rules at generation', () => {
  it('every scene has ground across the full width at the bottom row', () => {
    SCENES.forEach((s, i) => {
      for (const seed of SEEDS) {
        const sim = loadSim(i, seed);
        for (let x = 0; x < W; x++)
          expect(sim.grid[(H - 1) * W + x], `${s.name} seed ${seed} x=${x}`).not.toBe(Element.EMPTY);
      }
    });
  });

  it('every scene is at least 15% filled at t=2 for every seed', () => {
    SCENES.forEach((s, i) => {
      for (const seed of SEEDS) {
        const sim = loadSim(i, seed);
        sim.step();
        sim.step();
        const frac = nonEmpty(sim.grid) / TOTAL;
        expect(frac, `${s.name} seed ${seed}`).toBeGreaterThanOrEqual(0.15);
      }
    });
  }, SIM_TIMEOUT);
});

describe('simulation at t=600', () => {
  SCENES.forEach((s, i) => {
    it(`${s.name}: at least 12% filled, and something moves`, () => {
      const sim = loadSim(i, 1);
      const before = sim.grid.slice();
      for (let t = 0; t < 600; t++) sim.step();
      expect(nonEmpty(sim.grid) / TOTAL).toBeGreaterThanOrEqual(0.12);
      expect(sim.grid).not.toEqual(before);
    }, SIM_TIMEOUT);
  });

  it('Powder Keg keeps at least 90% of its gunpowder after 600 steps', () => {
    const sim = loadSim(idx('Powder Keg'), 1);
    const initial = sim.count(Element.GUNPOWDER);
    expect(initial).toBeGreaterThan(0);
    for (let t = 0; t < 600; t++) sim.step();
    expect(sim.count(Element.GUNPOWDER)).toBeGreaterThanOrEqual(0.9 * initial);
  }, SIM_TIMEOUT);

  it('Fireworks Night loses firework tubes after 1500 steps', () => {
    const sim = loadSim(idx('Fireworks Night'), 1);
    const initial = sim.count(Element.FIREWORK);
    expect(initial).toBeGreaterThan(0);
    for (let t = 0; t < 1500; t++) sim.step();
    expect(sim.count(Element.FIREWORK)).toBeLessThan(initial);
  }, SIM_TIMEOUT);
});

describe('life byte rules', () => {
  it('LAVA, WOOD and VOID-free scenes keep life 0 on those elements', () => {
    SCENES.forEach((s, i) => {
      for (const r of decode(buildScenePlacement(i, 1))) {
        if (r.elem === Element.LAVA) expect(r.life, `${s.name} LAVA`).toBe(0);
        if (r.elem === Element.WOOD) expect(r.life, `${s.name} WOOD`).toBe(0);
      }
    });
  });

  it('any CLONE cell has a nonzero emitted element id that is not CLONE', () => {
    SCENES.forEach((s, i) => {
      for (const r of decode(buildScenePlacement(i, 1))) {
        if (r.elem !== Element.CLONE) continue;
        expect(r.life, s.name).toBeGreaterThanOrEqual(1);
        expect(r.life, s.name).toBeLessThan(ELEMENT_COUNT);
        expect(r.life, s.name).not.toBe(Element.CLONE);
      }
    });
  });
});

describe('randomSceneIndex', () => {
  it('always returns an index within the scene list', () => {
    let state = 12345;
    const lcg = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x80000000;
    };
    for (let k = 0; k < 2000; k++) {
      const n = randomSceneIndex(lcg);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(SCENES.length);
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});
