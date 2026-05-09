import {
  Tool, BRUSH_SIZES,
  GRID_W, GRID_H, CELL_PX,
  type BrushSize, type WorkerInput, type FrameMessage,
} from './types';
import { encodeGifBlob, type GifFrameData } from './gif-encoder';

// ─── Canvas setup ────────────────────────────────────────────────
const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const CANVAS_W = GRID_W * CELL_PX;
const CANVAS_H = GRID_H * CELL_PX;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
// CSS handles display sizing via aspect-ratio + width:100%

// ─── Spawn the Web Worker ──────────────────────────────────────
const worker = new Worker(
  new URL('./worker/sim.worker.ts', import.meta.url),
  { type: 'module' },
);

worker.postMessage({ type: 'init', width: GRID_W, height: GRID_H } satisfies WorkerInput);

// ─── Input state ────────────────────────────────────────────────
let mouseDown = false;
let tool = Tool.SAND;
let brushSize: BrushSize = 3;
let lastX = -1;
let lastY = -1;

// ─── Keyboard shortcuts ─────────────────────────────────────────
const toolByKey: Record<string, Tool> = {
  '1': Tool.SAND, '2': Tool.WATER, '3': Tool.FIRE,
  '4': Tool.WALL, '5': Tool.WOOD, '6': Tool.OIL,
  '7': Tool.PLANT, '8': Tool.LAVA, '9': Tool.ACID,
  '0': Tool.ERASER,
};

document.addEventListener('keydown', (e) => {
  const key = e.key;
  if (key in toolByKey) {
    selectTool(toolByKey[key]);
    e.preventDefault();
    return;
  }
  if (key === '-' || key === '_') {
    cycleBrush(-1);
    e.preventDefault();
  }
  if (key === '=' || key === '+') {
    cycleBrush(1);
    e.preventDefault();
  }
  if (key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
    worker.postMessage({ type: 'clear' } satisfies WorkerInput);
    e.preventDefault();
  }
  if (key.toLowerCase() === 'g') {
    toggleRecording();
    e.preventDefault();
  }
});

// ─── Coordinate helpers ─────────────────────────────────────────
function canvasToGrid(cx: number, cy: number): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const gx = Math.floor((cx - rect.left) * scaleX / CELL_PX);
  const gy = Math.floor((cy - rect.top) * scaleY / CELL_PX);
  return [gx, gy];
}

function sendInput(x: number, y: number, active: boolean) {
  worker.postMessage({
    type: 'input',
    x, y, tool, brushSize, active,
  } satisfies WorkerInput);
}

// ─── Mouse / touch handlers ─────────────────────────────────────
function onPointerDown(cx: number, cy: number) {
  mouseDown = true;
  const [gx, gy] = canvasToGrid(cx, cy);
  lastX = gx; lastY = gy;
  sendInput(gx, gy, true);
}

function onPointerMove(cx: number, cy: number) {
  const [gx, gy] = canvasToGrid(cx, cy);
  if (gx !== lastX || gy !== lastY || mouseDown) {
    lastX = gx; lastY = gy;
    if (mouseDown) sendInput(gx, gy, true);
  }
}

function onPointerUp() {
  if (!mouseDown) return;
  mouseDown = false;
  // Post input with active=false on next microtask to let in-progress ticks finish
  setTimeout(() => sendInput(-1, -1, false), 0);
}

// Mouse
canvas.addEventListener('mousedown', (e) => onPointerDown(e.clientX, e.clientY));
canvas.addEventListener('mousemove', (e) => onPointerMove(e.clientX, e.clientY));
canvas.addEventListener('mouseup', () => onPointerUp());
canvas.addEventListener('mouseleave', () => onPointerUp());

// Touch
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  onPointerDown(t.clientX, t.clientY);
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  onPointerMove(t.clientX, t.clientY);
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  onPointerUp();
}, { passive: false });

// ─── Tool palette ────────────────────────────────────────────────
const toolButtons: Record<string, Tool> = {
  'tool-sand': Tool.SAND,
  'tool-water': Tool.WATER,
  'tool-fire': Tool.FIRE,
  'tool-wall': Tool.WALL,
  'tool-wood': Tool.WOOD,
  'tool-oil': Tool.OIL,
  'tool-plant': Tool.PLANT,
  'tool-lava': Tool.LAVA,
  'tool-acid': Tool.ACID,
  'tool-eraser': Tool.ERASER,
};

const toolNames: Record<Tool, string> = {
  [Tool.SAND]: 'Sand',
  [Tool.WATER]: 'Water',
  [Tool.FIRE]: 'Fire',
  [Tool.WALL]: 'Wall',
  [Tool.WOOD]: 'Wood',
  [Tool.OIL]: 'Oil',
  [Tool.PLANT]: 'Plant',
  [Tool.LAVA]: 'Lava',
  [Tool.ACID]: 'Acid',
  [Tool.ERASER]: 'Eraser',
};

let activeToolBtn: HTMLElement | null = null;
const statusTool = document.getElementById('status-tool')!;

function selectTool(t: Tool) {
  tool = t;
  statusTool.textContent = toolNames[t];
  if (activeToolBtn) activeToolBtn.classList.remove('active');

  // Find button by matching tool
  for (const [id, tVal] of Object.entries(toolButtons)) {
    if (tVal === t) {
      const btn = document.getElementById(id);
      if (btn) {
        btn.classList.add('active');
        activeToolBtn = btn;
      }
      break;
    }
  }
}

for (const [id, t] of Object.entries(toolButtons)) {
  const btn = document.getElementById(id);
  if (!btn) continue;
  btn.addEventListener('click', () => selectTool(t));
  // Also handle on touchend to avoid double-firing
  btn.addEventListener('touchend', (e) => { e.preventDefault(); selectTool(t); });
}

// ─── Brush size ──────────────────────────────────────────────────
const brushDisplay = document.getElementById('brush-size-display')!;
const statusSize = document.getElementById('status-size')!;
const brushDecrease = document.getElementById('brush-decrease')!;
const brushIncrease = document.getElementById('brush-increase')!;

function updateBrushDisplay() {
  brushDisplay.textContent = String(brushSize);
  statusSize.textContent = String(brushSize);
}

function cycleBrush(dir: number) {
  const idx = BRUSH_SIZES.indexOf(brushSize);
  const next = idx + dir;
  if (next >= 0 && next < BRUSH_SIZES.length) {
    brushSize = BRUSH_SIZES[next];
    updateBrushDisplay();
  }
}

brushDecrease.addEventListener('click', () => cycleBrush(-1));
brushIncrease.addEventListener('click', () => cycleBrush(1));

// ─── Clear button ────────────────────────────────────────────────
document.getElementById('btn-clear')!.addEventListener('click', () => {
  worker.postMessage({ type: 'clear' } satisfies WorkerInput);
});

// ─── GIF Recording ──────────────────────────────────────────────
let recording = false;
let recordedFrames: Uint8Array[] = [];
let recordingFrameCount = 0;
const RECORD_DURATION_MS = 3000;      // 3 seconds
const RECORD_TOTAL_FRAMES = 90;       // ~30 fps target

const btnRecord = document.getElementById('btn-record')!;

function toggleRecording() {
  if (recording) {
    // Already recording — click again to stop early
    recording = false;
    const captured = recordedFrames;
    recordedFrames = [];
    if (captured.length < 5) {
      btnRecord.textContent = '🎬 GIF';
      btnRecord.classList.remove('active');
      return;
    }
    encodeGIF(captured);
    return;
  }
  // Start recording
  recording = true;
  recordingFrameCount = 0;
  recordedFrames = [];
  btnRecord.textContent = '⏺ Rec...';
  btnRecord.classList.add('active');
}

btnRecord.addEventListener('click', toggleRecording);

async function encodeGIF(frames: Uint8Array[]) {
  btnRecord.textContent = '⏳ 0%';
  btnRecord.classList.remove('active');

  const totalFrames = frames.length;
  const delayMs = Math.round(RECORD_DURATION_MS / totalFrames);

  // Process in batches, yielding to UI between batches
  const frameDatas: GifFrameData[] = [];
  const BATCH = 10;

  for (let i = 0; i < totalFrames; i++) {
    frameDatas.push({ pixels: frames[i], delay: delayMs });

    if (frameDatas.length >= BATCH || i === totalFrames - 1) {
      // Yield to UI before encoding
      await new Promise(r => setTimeout(r, 0));
    }
  }

  btnRecord.textContent = '⏳ Encoding...';

  try {
    const blob = await encodeGifBlob(frameDatas);

    // Download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `powderbox-${Date.now()}.gif`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('GIF encoding failed:', err);
  }

  btnRecord.textContent = '🎬 GIF';
}

// ─── Pause state ────────────────────────────────────────────────
const imgData = ctx.createImageData(CANVAS_W, CANVAS_H);
let paused = false;
const pauseOverlay = document.createElement('div');
pauseOverlay.style.cssText = `
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,0.5);color:#f7c948;font-size:2rem;font-weight:700;
  letter-spacing:0.1em;pointer-events:none;opacity:0;transition:opacity 0.2s;
  border-radius:10px;z-index:10;
`;
pauseOverlay.textContent = '⏸ PAUSED';
document.querySelector('.canvas-wrap')?.appendChild(pauseOverlay);

const statusPause = document.createElement('span');
statusPause.className = 'status-badge';
statusPause.style.cssText = 'color:#f7c948;display:none';
statusPause.textContent = '⏸ PAUSED';
document.querySelector('.status')?.appendChild(statusPause);

function updatePauseUI() {
  pauseOverlay.style.opacity = paused ? '1' : '0';
  statusPause.style.display = paused ? 'inline' : 'none';
}

// Space to pause
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Space') {
    e.preventDefault();
    paused = !paused;
    updatePauseUI();
  }
});

worker.onmessage = (e: MessageEvent<FrameMessage>) => {
  const msg = e.data;
  if (msg.type !== 'frame') return;

  const src = msg.pixels;

  // GIF recording: capture raw RGBA frame at grid resolution
  if (recording) {
    recordedFrames.push(new Uint8Array(src));
    recordingFrameCount++;
    btnRecord.textContent = `⏺ ${Math.round(recordingFrameCount / RECORD_TOTAL_FRAMES * 100)}%`;

    if (recordingFrameCount >= RECORD_TOTAL_FRAMES) {
      recording = false;
      const capturedFrames = recordedFrames;
      recordedFrames = [];
      encodeGIF(capturedFrames);
      return; // don't render this frame, let encoding happen
    }
  }

  if (paused) return;

  // Scale grid pixels to canvas (CELL_PX ×)
  const scale = CELL_PX;
  for (let sy = 0; sy < GRID_H; sy++) {
    for (let sx = 0; sx < GRID_W; sx++) {
      const si = (sy * GRID_W + sx) * 4;
      const r = src[si];
      const g = src[si + 1];
      const b = src[si + 2];
      const a = src[si + 3];
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const di = ((sy * scale + dy) * CANVAS_W + (sx * scale + dx)) * 4;
          imgData.data[di] = r;
          imgData.data[di + 1] = g;
          imgData.data[di + 2] = b;
          imgData.data[di + 3] = a;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
};

// ─── Simulation loop ────────────────────────────────────────────
function loop() {
  worker.postMessage({ type: 'tick' } satisfies WorkerInput);
  requestAnimationFrame(loop);
}

// Activate default tool
selectTool(Tool.SAND);
updateBrushDisplay();
loop();
