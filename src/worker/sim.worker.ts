// Thin adapter: maps WorkerInput messages onto the Sim engine and posts frames back.
import { Sim } from '../sim';
import { GRID_W, GRID_H, type WorkerInput, type FrameMessage, type StateMessage } from '../types';
import { buildScenePlacement } from '../scenes';

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerInput>) => void) | null;
};

let sim = new Sim(GRID_W, GRID_H);

function frame(extra: Partial<FrameMessage> = {}): void {
  const pixels = new Uint8ClampedArray(sim.w * sim.h * 4);
  const particles = sim.render(pixels);
  const msg: FrameMessage = { type: 'frame', pixels, particles, ...extra };
  ctx.postMessage(msg, [pixels.buffer as ArrayBuffer]);
}

ctx.onmessage = (e: MessageEvent<WorkerInput>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      sim = new Sim(m.width, m.height);
      break;
    case 'tick': {
      const steps = Math.min(8, Math.max(0, m.steps | 0));
      for (let k = 0; k < steps; k++) sim.step();
      frame();
      break;
    }
    case 'paint':
      sim.paint(m.x0, m.y0, m.x1, m.y1, m.element, m.radius, m.emit);
      break;
    case 'explode':
      sim.explode(m.x, m.y, m.radius);
      break;
    case 'lightning':
      sim.lightning(m.x, m.y);
      break;
    case 'clear':
      sim.clear();
      break;
    case 'wind':
      sim.wind = m.direction;
      break;
    case 'gravity':
      sim.gravity = m.direction;
      break;
    case 'generateScene':
      sim.clear();
      try {
        sim.loadCells(buildScenePlacement(m.sceneIndex, m.seed));
      } catch {
        // Bad scene index or generator failure: leave the grid empty and still reply.
      }
      frame({ sceneGenToken: m.genToken });
      break;
    case 'saveState': {
      const data = sim.serialize();
      const msg: StateMessage = { type: 'state', data };
      ctx.postMessage(msg, [data]);
      break;
    }
    case 'loadState':
      sim.deserialize(m.data); // invalid buffers are ignored by design
      break;
  }
};
