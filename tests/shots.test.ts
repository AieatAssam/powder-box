// Headless screenshot tool, not a test. Renders scenes through the real engine to PNG.
//   SHOTS=out/dir [TICKS=300] [SCALE=3] [SEED=7] npx vitest run tests/shots.test.ts
// Writes one PNG per scene plus sheet.png (contact sheet of all scenes).
import { it } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Sim } from '../src/sim';
import { SCENES, buildScenePlacement } from '../src/scenes';
import { GRID_W as W, GRID_H as H } from '../src/types';

function png(rgba: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head.writeUInt8(8, 8); head.writeUInt8(6, 9);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function scale(src: Uint8ClampedArray, k: number): Uint8Array {
  const out = new Uint8Array(W * k * H * k * 4);
  for (let y = 0; y < H * k; y++) for (let x = 0; x < W * k; x++) {
    const s = (((y / k) | 0) * W + ((x / k) | 0)) * 4, d = (y * W * k + x) * 4;
    out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = 255;
  }
  return out;
}

const dir = process.env.SHOTS;
it.skipIf(!dir)('renders scene screenshots', () => {
  const ticks = Number(process.env.TICKS ?? 300), k = Number(process.env.SCALE ?? 3), seed = Number(process.env.SEED ?? 7);
  mkdirSync(dir!, { recursive: true });
  const cols = 4, rows = Math.ceil(SCENES.length / cols);
  const sheet = new Uint8Array(W * cols * H * rows * 4).fill(255);
  SCENES.forEach((scene, n) => {
    const sim = new Sim(W, H);
    sim.loadCells(buildScenePlacement(n, seed));
    for (let t = 0; t < ticks; t++) sim.step();
    const px = new Uint8ClampedArray(W * H * 4);
    sim.render(px);
    const slug = scene.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    writeFileSync(`${dir}/${slug}.png`, png(scale(px, k), W * k, H * k));
    const ox = (n % cols) * W, oy = ((n / cols) | 0) * H;
    for (let y = 0; y < H; y++) sheet.set(px.subarray(y * W * 4, (y + 1) * W * 4), ((oy + y) * W * cols + ox) * 4);
  });
  writeFileSync(`${dir}/sheet.png`, png(sheet, W * cols, H * rows));
}, 120_000);
