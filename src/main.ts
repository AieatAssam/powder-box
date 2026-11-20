import {
  BRUSH_SIZES, GRID_H, GRID_W, MATERIALS, SAVE_HEADER_BYTES, SAVE_MAGIC, TOOLS,
  type FrameMessage, type Gravity, type ToolDef, type Wind, type WorkerInput, type WorkerOutput,
} from './types';
import { SCENES } from './scenes';

// ─── Constants ──────────────────────────────────────────────────
const UNDO_LIMIT = 20;
const AUTOSAVE_KEY = 'powderbox.autosave';
const AUTOSAVE_MS = 10_000;
const RECORD_MS = 30_000;
const RECORD_TYPES = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const WIND: [Wind, string][] = [[0, 'Calm'], [1, 'Right'], [-1, 'Left'], [2, 'Gusts']];
/** Hand-drawn icons for the tools that have no material colour. Keyed by tool id. */
const GLYPHS: Record<string, string> = {
  explode: '<circle cx="11" cy="14" r="6.5"/><path d="M15.5 9.5 19 5.5"/><path d="M17.5 3.5H20v2.5"/>',
  lightning: '<path d="M13.5 2 5 13.5h6L9.5 22 19 10h-6z"/>',
  eraser: '<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.5"/>',
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ─── State ──────────────────────────────────────────────────────
interface Cell { x: number; y: number }
interface Hold { cell: Cell; lastStrike: number }

const state = {
  tool: TOOLS[0],
  sizeIndex: 2,
  speed: 1,
  paused: false,
  stepOnce: false,
  windIndex: 0,
  gravity: 1 as Gravity,
  sceneIndex: -1,
  genToken: 0,
  sceneBusy: false,
  awaiting: false,
  frame: null as FrameMessage | null,
  framesIn: 0,
  particles: 0,
  fps: 0,
  hold: null as Hold | null,
  cursor: null as Cell | null,
  scale: 1,
};

// ─── DOM ────────────────────────────────────────────────────────
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const stage = $('stage');
const ring = $('brush-ring');
const picker = $('scene-picker');
const sceneMenu = $<HTMLDivElement>('scene-menu');
const sceneGrid = $('scene-grid');
const undoBtn = $<HTMLButtonElement>('undo');
const recordBtn = $<HTMLButtonElement>('record');
const fileInput = $<HTMLInputElement>('file-input');
const help = $<HTMLDialogElement>('help');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, cls = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

// ─── Worker ─────────────────────────────────────────────────────
const worker = new Worker(new URL('./worker/sim.worker.ts', import.meta.url), { type: 'module' });
const send = (msg: WorkerInput, transfer: Transferable[] = []): void => worker.postMessage(msg, transfer);

/** Resolvers for `saveState` replies, in request order. */
const stateWaiters: ((data: ArrayBuffer) => void)[] = [];

function requestState(): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    stateWaiters.push(resolve);
    send({ type: 'saveState' });
  });
}

function onWorker(msg: WorkerOutput): void {
  if (msg.type === 'state') {
    stateWaiters.shift()?.(msg.data);
    return;
  }
  state.awaiting = false;
  state.frame = msg;
  state.framesIn++;
  state.particles = msg.particles;
  if (msg.sceneGenToken !== undefined && msg.sceneGenToken === state.genToken) {
    state.sceneBusy = false;
    showSceneCard(state.sceneIndex);
  }
}

worker.addEventListener('message', (e: MessageEvent<WorkerOutput>) => onWorker(e.data));
worker.addEventListener('error', () => toast('The simulation stopped. Reload the page to start it again.'));

// ─── Undo ───────────────────────────────────────────────────────
const undoStack: ArrayBuffer[] = [];

/** Snapshot the grid before a destructive action. The worker answers in order, so the snapshot precedes it. */
function pushUndo(): void {
  void requestState().then((buf) => {
    undoStack.push(buf);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    undoBtn.disabled = false;
  });
}

function undo(): void {
  const buf = undoStack.pop();
  if (!buf) return;
  send({ type: 'loadState', data: buf });
  undoBtn.disabled = undoStack.length === 0;
}

// ─── Painting ───────────────────────────────────────────────────
function cellAt(e: PointerEvent | WheelEvent): Cell {
  const r = canvas.getBoundingClientRect();
  return {
    x: clamp(Math.floor(((e.clientX - r.left) / r.width) * GRID_W), 0, GRID_W - 1),
    y: clamp(Math.floor(((e.clientY - r.top) / r.height) * GRID_H), 0, GRID_H - 1),
  };
}

function paintBetween(from: Cell, to: Cell): void {
  send({
    type: 'paint', x0: from.x, y0: from.y, x1: to.x, y1: to.y,
    element: state.tool.element, radius: BRUSH_SIZES[state.sizeIndex] - 1, emit: state.tool.emit,
  });
}

function strike(c: Cell): void {
  send({ type: 'lightning', x: c.x, y: c.y });
}

function blast(c: Cell): void {
  send({ type: 'explode', x: c.x, y: c.y, radius: BRUSH_SIZES[state.sizeIndex] * 3 + 4 });
}

/** Keep material pouring while the pointer is held still; lightning repeats about six times a second. */
function pour(now: number): void {
  const hold = state.hold;
  if (!hold) return;
  if (state.tool.action === 'paint') paintBetween(hold.cell, hold.cell);
  else if (state.tool.action === 'lightning' && now - hold.lastStrike > 160) {
    hold.lastStrike = now;
    strike(hold.cell);
  }
}

function placeRing(c: Cell): void {
  state.cursor = c;
  const d = (2 * (BRUSH_SIZES[state.sizeIndex] - 1) + 1) * state.scale;
  ring.style.width = `${d}px`;
  ring.style.height = `${d}px`;
  ring.style.transform = `translate(${(c.x + 0.5) * state.scale - d / 2}px, ${(c.y + 0.5) * state.scale - d / 2}px)`;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const c = cellAt(e);
  pushUndo();
  state.hold = { cell: c, lastStrike: performance.now() };
  const action = state.tool.action;
  if (action === 'explode') blast(c);
  else if (action === 'lightning') strike(c);
  else paintBetween(c, c);
  ring.hidden = e.pointerType === 'touch';
  placeRing(c);
});

canvas.addEventListener('pointermove', (e) => {
  const c = cellAt(e);
  ring.hidden = e.pointerType === 'touch';
  placeRing(c);
  const hold = state.hold;
  if (!hold) return;
  if (state.tool.action === 'paint') paintBetween(hold.cell, c);
  hold.cell = c;
});

const release = (): void => { state.hold = null; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => {
  if (!state.hold) { ring.hidden = true; state.cursor = null; }
});

let wheelDelta = 0;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  wheelDelta += e.deltaY;
  if (Math.abs(wheelDelta) < 40) return;
  resizeBrush(wheelDelta < 0 ? 1 : -1);
  wheelDelta = 0;
}, { passive: false });

// ─── Stage fit ──────────────────────────────────────────────────
// Whole device pixels per cell, so cells are even and the picture does not shimmer.
function fitStage(): void {
  const wrap = $('stage-wrap'), dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.floor(Math.min(wrap.clientWidth * dpr / GRID_W, wrap.clientHeight * dpr / GRID_H)));
  stage.style.width = `${(k * GRID_W) / dpr}px`;
  stage.style.height = `${(k * GRID_H) / dpr}px`;
  state.scale = k / dpr;
  if (state.cursor) placeRing(state.cursor);
}
new ResizeObserver(fitStage).observe($('stage-wrap'));

// ─── Controls ───────────────────────────────────────────────────
function setHint(tool: ToolDef): void {
  const text = document.createElement('span');
  text.className = 'hint-text';
  text.append(el('strong', tool.name), ` ${tool.hint}`);
  $('hint').replaceChildren(text, el('kbd', tool.key));
}

function selectTool(tool: ToolDef): void {
  state.tool = tool;
  setHint(tool);
  syncControls();
}

function resizeBrush(step: number): void {
  state.sizeIndex = clamp(state.sizeIndex + step, 0, BRUSH_SIZES.length - 1);
  $('brush-size').textContent = String(BRUSH_SIZES[state.sizeIndex]);
  if (state.cursor) placeRing(state.cursor);
}

function togglePause(): void {
  state.paused = !state.paused;
  state.stepOnce = false;
  syncControls();
}

function step(): void {
  if (state.paused) state.stepOnce = true;
}

function setSpeed(speed: number): void {
  state.speed = speed;
  syncControls();
}

function cycleWind(): void {
  state.windIndex = (state.windIndex + 1) % WIND.length;
  send({ type: 'wind', direction: WIND[state.windIndex][0] });
  syncControls();
}

function flipGravity(): void {
  state.gravity = state.gravity === 1 ? -1 : 1;
  send({ type: 'gravity', direction: state.gravity });
  syncControls();
}

function clearCanvas(): void {
  pushUndo();
  send({ type: 'clear' });
}

function syncControls(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tool')) {
    b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool.id));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === state.speed));
  }
  $('play').textContent = state.paused ? 'Play' : 'Pause';
  $<HTMLButtonElement>('step').disabled = !state.paused;
  $('wind').textContent = `Wind ${WIND[state.windIndex][1].toLowerCase()}`;
  $('gravity').textContent = `Gravity ${state.gravity === 1 ? 'down' : 'up'}`;
  $('state-badge').hidden = !state.paused;
}

function updateHud(now: number): void {
  state.fps = Math.round((state.framesIn * 1000) / Math.max(1, now - hudAt));
  state.framesIn = 0;
  hudAt = now;
  $('particles').textContent = state.particles.toLocaleString();
  $('fps').textContent = String(state.fps);
}

// ─── Scenes ─────────────────────────────────────────────────────
let cardTimer = 0;

function showSceneCard(index: number): void {
  const scene = SCENES[index];
  const card = $('scene-card');
  card.replaceChildren(el('strong', scene.name), el('span', scene.description));
  card.classList.add('is-visible');
  clearTimeout(cardTimer);
  cardTimer = window.setTimeout(() => card.classList.remove('is-visible'), 4000);
}

/** A scene other than the current one, so the same scene never comes up twice in a row. */
function nextSceneIndex(): number {
  const n = SCENES.length;
  return (state.sceneIndex + 1 + Math.floor(Math.random() * (n - 1))) % n;
}

/** Generates a scene without an undo snapshot (used at startup). Ignored while a scene is still building. */
function startScene(index: number): void {
  if (state.sceneBusy) return;
  state.sceneIndex = index;
  state.genToken++;
  state.sceneBusy = true;
  syncScenes();
  send({ type: 'generateScene', sceneIndex: index, seed: Math.floor(Math.random() * 2 ** 32), genToken: state.genToken });
}

function newScene(index: number): void {
  if (state.sceneBusy) return;
  pushUndo();
  startScene(index);
}

function cycleScene(delta: number): void {
  const n = SCENES.length;
  newScene((Math.max(state.sceneIndex, 0) + delta + n) % n);
}

// ─── Save, load, autosave ───────────────────────────────────────
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

async function saveFile(): Promise<void> {
  const buf = await requestState();
  download(new Blob([buf]), `powderbox-${stamp()}.pbox`);
}

/** True when the buffer carries the save magic and exactly the grid bytes its header declares. */
function isSave(buf: ArrayBuffer): boolean {
  if (buf.byteLength < SAVE_HEADER_BYTES) return false;
  const dv = new DataView(buf);
  const cells = dv.getUint16(4, true) * dv.getUint16(6, true);
  return dv.getUint32(0, true) === SAVE_MAGIC && buf.byteLength === SAVE_HEADER_BYTES + 2 * cells;
}

async function loadFile(file: File): Promise<void> {
  const buf = await file.arrayBuffer();
  if (!isSave(buf)) {
    toast('That file is not a PowderBox save.');
    return;
  }
  pushUndo();
  send({ type: 'loadState', data: buf });
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function fromBase64(text: string): ArrayBuffer {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function autosave(): void {
  void requestState().then((buf) => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, toBase64(buf));
    } catch {
      // Storage blocked or full: autosave is best effort.
    }
  });
}

/** Loads the stored autosave if it is a valid save; returns false otherwise. */
function restoreAutosave(): boolean {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return false;
    const buf = fromBase64(text);
    if (!isSave(buf)) return false;
    send({ type: 'loadState', data: buf });
    return true;
  } catch {
    return false;
  }
}

// ─── Recording ──────────────────────────────────────────────────
let recorder: MediaRecorder | null = null;
let recordStart = 0;
let recordStopTimer = 0;
let recordTicker = 0;
// Videos are recorded from a 3x nearest-neighbour copy so players do not blur the 320x200 grid.
const RECORD_SCALE = 3;
const recCanvas = document.createElement('canvas');
recCanvas.width = GRID_W * RECORD_SCALE;
recCanvas.height = GRID_H * RECORD_SCALE;
const recCtx = recCanvas.getContext('2d') as CanvasRenderingContext2D;
recCtx.imageSmoothingEnabled = false;
const drawRecordFrame = (): void => recCtx.drawImage(canvas, 0, 0, recCanvas.width, recCanvas.height);

function updateRecordButton(): void {
  const secs = Math.floor((performance.now() - recordStart) / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  recordBtn.textContent = recorder ? `Stop ${clock}` : 'Record';
  recordBtn.setAttribute('aria-pressed', String(recorder !== null));
}

function startRecording(): void {
  const mime = RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) {
    toast('This browser cannot record the simulation.');
    return;
  }
  drawRecordFrame();
  const rec = new MediaRecorder(recCanvas.captureStream(60), { mimeType: mime });
  const chunks: Blob[] = [];
  rec.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
  rec.addEventListener('stop', () => {
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    download(new Blob(chunks, { type: mime }), `powderbox-${stamp()}.${ext}`);
  });
  rec.start();
  recorder = rec;
  recordStart = performance.now();
  recordStopTimer = window.setTimeout(stopRecording, RECORD_MS);
  recordTicker = window.setInterval(updateRecordButton, 250);
  updateRecordButton();
}

function stopRecording(): void {
  if (!recorder) return;
  recorder.stop();
  recorder = null;
  clearTimeout(recordStopTimer);
  clearInterval(recordTicker);
  updateRecordButton();
}

function toggleRecording(): void {
  if (recorder) stopRecording();
  else startRecording();
}

// ─── Toast ──────────────────────────────────────────────────────
let toastTimer = 0;

function toast(text: string): void {
  const node = $('toast');
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { node.hidden = true; }, 3200);
}

// ─── Palette and help, generated from TOOLS ─────────────────────
function swatch(tool: ToolDef): string {
  if (GLYPHS[tool.id]) {
    return `<span class="swatch glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[tool.id]}</svg></span>`;
  }
  const [c] = MATERIALS[tool.emit ?? tool.element].colors;
  // Sources show what they pour, framed in the Clone colour.
  const ring = tool.emit ? `;box-shadow:inset 0 0 0 3px rgb(${MATERIALS[tool.element].colors[0]})` : '';
  return `<span class="swatch" style="background:rgb(${c})${ring}" aria-hidden="true"></span>`;
}

function toolButton(tool: ToolDef): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool';
  b.dataset.tool = tool.id;
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-keyshortcuts', tool.key);
  b.innerHTML = `${swatch(tool)}<span class="tool-name">${tool.name}</span>`;
  b.addEventListener('click', () => selectTool(tool));
  b.addEventListener('pointerenter', () => setHint(tool));
  b.addEventListener('pointerleave', () => setHint(state.tool));
  b.addEventListener('focus', () => setHint(tool));
  b.addEventListener('blur', () => setHint(state.tool));
  return b;
}

function buildPalette(): void {
  const rail = $('palette');
  for (const group of new Set(TOOLS.map((t) => t.group))) {
    const section = document.createElement('section');
    section.className = 'group';
    const wrap = document.createElement('div');
    wrap.className = 'tools';
    for (const tool of TOOLS) if (tool.group === group) wrap.append(toolButton(tool));
    section.append(el('h2', group, 'group-name'), wrap);
    rail.append(section);
  }
}

function buildShortcuts(): void {
  const list = $('tool-shortcuts');
  for (const tool of TOOLS) {
    const dt = document.createElement('dt');
    dt.append(el('kbd', tool.key));
    list.append(dt, el('dd', `${tool.name}: ${tool.hint}`));
  }
}

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Shows the current scene name on the picker button and marks its tile. */
function syncScenes(): void {
  $('scene-name').textContent = SCENES[state.sceneIndex]?.name ?? 'Choose a scene';
  for (const b of sceneGrid.querySelectorAll<HTMLButtonElement>('.scene-opt')) {
    if (Number(b.dataset.scene) === state.sceneIndex) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  }
}

/** Places the popover under the picker button, kept inside the viewport. */
function placeSceneMenu(): void {
  if (!sceneMenu.matches(':popover-open')) return;
  const r = picker.getBoundingClientRect();
  sceneMenu.style.left = `${clamp(r.left, 8, window.innerWidth - sceneMenu.offsetWidth - 8)}px`;
  sceneMenu.style.top = `${r.bottom + 8}px`;
}

function buildSceneOptions(): void {
  SCENES.forEach((scene, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scene-opt';
    b.dataset.scene = String(i);
    const img = document.createElement('img');
    img.src = `${import.meta.env.BASE_URL}scenes/${slug(scene.name)}.png`;
    img.width = 320;
    img.height = 200;
    img.loading = 'lazy';
    img.alt = '';
    b.append(img, el('strong', scene.name, 'scene-opt-name'), el('span', scene.description, 'scene-opt-desc'));
    b.addEventListener('click', () => {
      if (i !== state.sceneIndex) newScene(i);
      sceneMenu.hidePopover();
    });
    sceneGrid.append(b);
  });
  sceneMenu.addEventListener('toggle', placeSceneMenu);
  syncScenes();
}

// ─── Keyboard ───────────────────────────────────────────────────
/** True while the user is typing or a dialog owns the keyboard, so shortcuts must stay quiet. */
function isTyping(target: EventTarget | null): boolean {
  if (help.open) return true;
  return target instanceof HTMLElement && target.closest('input, select, textarea, [contenteditable="true"]') !== null;
}

const COMMANDS: Record<string, () => void> = {
  ' ': togglePause,
  '.': step,
  w: cycleWind,
  g: flipGravity,
  c: clearCanvas,
  n: () => newScene(nextSceneIndex()),
  r: toggleRecording,
  '?': () => help.showModal(),
  '[': () => resizeBrush(-1),
  '-': () => resizeBrush(-1),
  ']': () => resizeBrush(1),
  '=': () => resizeBrush(1),
  '+': () => resizeBrush(1),
  ArrowLeft: () => cycleScene(-1),
  ArrowRight: () => cycleScene(1),
};

const CTRL_COMMANDS: Record<string, () => void> = {
  z: undo,
  s: () => void saveFile(),
  o: () => fileInput.click(),
};

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  if (e.ctrlKey || e.metaKey) {
    const run = CTRL_COMMANDS[e.key.toLowerCase()];
    if (run) {
      e.preventDefault();
      run();
    }
    return;
  }
  if (e.altKey) return;
  const run = COMMANDS[e.key];
  if (run) {
    e.preventDefault();
    run();
    return;
  }
  const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
  if (tool) {
    e.preventDefault();
    selectTool(tool);
  }
});

// Space is handled above; stop a focused button from also activating on release.
window.addEventListener('keyup', (e) => {
  if (e.key === ' ' && !isTyping(e.target)) e.preventDefault();
});

// ─── Wiring ─────────────────────────────────────────────────────
const on = (id: string, fn: () => void): void => $(id).addEventListener('click', fn);

on('play', togglePause);
on('step', step);
on('wind', cycleWind);
on('gravity', flipGravity);
on('clear', clearCanvas);
on('new-scene', () => newScene(nextSceneIndex()));
on('undo', undo);
on('save', () => void saveFile());
on('load', () => fileInput.click());
on('record', toggleRecording);
on('help-open', () => help.showModal());
on('help-close', () => help.close());
on('brush-smaller', () => resizeBrush(-1));
on('brush-larger', () => resizeBrush(1));

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
  b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
  fileInput.value = '';
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  if (file.name.endsWith('.pbox')) void loadFile(file);
  else toast('Drop a .pbox save file to load it.');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) autosave();
});
window.setInterval(autosave, AUTOSAVE_MS);

if (!('MediaRecorder' in window)) recordBtn.hidden = true;

// ─── Render loop ────────────────────────────────────────────────
let hudAt = performance.now();

function nextSteps(): number {
  const steps = state.paused ? (state.stepOnce ? 1 : 0) : state.speed;
  state.stepOnce = false;
  return steps;
}

/** Draws the latest frame and keeps exactly one tick in flight (backpressure). */
function frameLoop(now: number): void {
  requestAnimationFrame(frameLoop);
  const frame = state.frame;
  if (frame) {
    // The frame's buffer is transferred from the worker, so it is a plain ArrayBuffer.
    ctx.putImageData(new ImageData(frame.pixels as Uint8ClampedArray<ArrayBuffer>, GRID_W, GRID_H), 0, 0);
    if (recorder) drawRecordFrame();
    state.frame = null;
  }
  if (!state.awaiting) {
    send({ type: 'tick', steps: nextSteps() });
    state.awaiting = true;
  }
  pour(now);
  if (now - hudAt > 250) updateHud(now);
}

// ─── Boot ───────────────────────────────────────────────────────
buildPalette();
buildShortcuts();
buildSceneOptions();
selectTool(state.tool);
fitStage();
send({ type: 'init', width: GRID_W, height: GRID_H });
if (!restoreAutosave()) startScene(nextSceneIndex());
requestAnimationFrame(frameLoop);
