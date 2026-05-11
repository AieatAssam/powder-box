# 🧪 PowderBox

**A gorgeous, high-performance particle sandbox simulation in your browser.**

Draw with sand, water, fire, lava, acid, and more. Watch emergent physics unfold in real-time at 60fps. Zero runtime dependencies — just a browser.

[**🌐 Live Demo**](https://aieatassam.github.io/powder-box/) — play with PowderBox right now, no install needed

---

## ✨ What It Looks Like

### Procedurally Generated Scenes

| | | |
|:-:|:-:|:-:|
| ![Volcano Island](powderbox-sc-01-volcano.png) | ![Scene 2](powderbox-sc-02.png) | ![Scene 3](powderbox-sc-03.png) |
| ![Scene 4](powderbox-sc-04.png) | ![Scene 5](powderbox-sc-05.png) | ![Scene 6](powderbox-sc-06.png) |

Each click of **🎲 Scene** generates a unique composition — islands, canyons, mandalas, galaxies, caves, and more — that physics brings to life.

> Screenshots from the live app at **https://aieatassam.github.io/powder-box/**

---

## 🎯 Features

### 🎮 10 Element Tools

The toolbar shows colour swatches that exactly match each element's in-game palette colour:

| # | Element | Behaviour |
|:-:|:--------|:----------|
| 1 | **Sand** | Falls, piles up, forms slopes and dunes |
| 2 | **Water** | Flows, spreads, pools, extinguishes fire |
| 3 | **Fire** | Rises, spreads to flammable materials, emits smoke |
| 4 | **Wall** | Indestructible barrier — great for structures |
| 5 | **Wood** | Flammable — burns slowly when fire touches it |
| 6 | **Oil** | Flammable, floats on water — explodes near fire |
| 7 | **Plant** | Grows, catches fire easily |
| 8 | **Lava** | Melts through, solidifies into rock over time |
| 9 | **Acid** | Dissolves most materials on contact |
| 0 | **Eraser** | Remove anything |

### 🔥 Emergent Interactions

- **Water + Fire** → Steam (cloud particles that rise and condense)
- **Oil + Fire** → 💥 Explosion with chain reaction
- **Lava + Water** → Steam explosion + solid rock
- **Lava + Wood/Plants** → Fire + destruction
- **Acid + most things** → Dissolves on contact
- **Wood burning** → Slowly chars then ignites into fire

### 🎲 11 Procedural Scenes

Generate stunning, unique starting scenes with one click — each is different every time, and the physics brings them to life:

1. **🌋 Volcano Island** — Erupting cone with lava cascades, surrounded by ocean
2. **🪨 Zen Garden** — Raked sand, koi pond with bridge, clustered stones
3. **💧 Waterfall Canyon** — Multi-tier waterfall plunging into a misty pool
4. **🌊 Lava Delta** — Braided lava rivers flowing from a caldera into the sea
5. **🌀 Mandala** — Compartmented geometric rings with trapped elements
6. **🌌 Galaxy Spiral** — Dual spiral arms of fire, glass, and lava
7. **🏖️ Sunset Beach** — Tropical shore with palms, tide pools, and seashells
8. **🕯️ Bioluminescent Cave** — Glowing crystals, acid pools, and mushrooms
9. **📐 Strata** — Geological layers with faults, fossils, and geodes
10. **🌠 Aurora Borealis** — Aurora bands over snowy pines
11. **🎨 Abstract Color Field** — Noise-driven bands with trapped fluid blobs

### 🎬 GIF Export
Record your creations as animated GIFs (3 seconds) with one click — shareable, embeddable, no extra tools needed.

### 💾 Save & Load
- **Save** (`Ctrl+S`): Download your canvas as a compact `.pbox` binary file (~125 KB)
- **Load** (`Ctrl+O`): Open a `.pbox` file to restore any saved world
- **Auto-save**: Your canvas is automatically saved to `localStorage` every 10 seconds — refresh the page without losing your work

### ⌨️ Controls

| Key | Action |
|:---|:-------|
| `1` – `9` | Select element tool |
| `0` | Eraser |
| `-` / `=` | Decrease / Increase brush size |
| `G` | Record & export 3s GIF |
| `N` | New procedural scene |
| `←` / `→` | Cycle scenes |
| `C` | Clear the canvas |
| `Space` | Pause / Resume simulation |
| `Ctrl+S` | Save canvas |
| `Ctrl+O` | Load canvas |

### 📱 Touch-Friendly
Works great on mobile — touch to draw, responsive layout, scrollable toolbar.

---

## 🏗️ Architecture

PowderBox achieves **smooth 60fps physics** through a clean Web Worker architecture:

```
┌─────────┐   mouse/touch    ┌──────────┐   postMessage(transferable)   ┌──────────────┐
│ Browser ├─────────────────▶│ main.ts  ├──────────────────────────────▶│ sim.worker.ts│
│ (render) │   rAF loop       │ (input)   │   pixel buffer + genToken     │ (physics +   │
│ Canvas   │◀────────────────│ (rAF)    │◀──────────────────────────────│ scene gen)   │
└─────────┘   drawImage()    └──────────┘   64 KB RGBA Uint8ClampedArray └──────────────┘
                                    │
                              clear | generateScene (sceneIndex, seed, genToken)
```

- **Grid**: 320 × 200 cells as a flat `Uint8Array` (one byte per cell = 64 KB total) plus a parallel `Uint8Array` for lifetime/burn timers
- **Worker**: Owns the entire grid state and all physics logic. Also handles procedural scene generation — `buildScenePlacement()` runs inside the worker, not the main thread
- **Scene generation off the main thread**: each scene click sends a `generateScene` message with `genToken`. The worker generates the scene (CPU-heavy loops with `fillCircle`, `line`, `scatter`), places cells into its grid, renders pixels, and returns the frame tagged with the matching token. The main thread only resets its debounce when the correct `genToken` frame arrives, preventing stale tick frames from breaking the flow
- **rAF-throttled render loop**: a `requestAnimationFrame` loop decouples rendering from the worker's tick rate. The worker can run at full speed, but the main thread only renders the latest frame at vsync (60fps). Intermediate frames are dropped
- **Error resilience**: `worker.addEventListener('error', ...)` catches worker crashes (uncaught exceptions, import failures, transfer errors) and exposes them via `window.__workerError` for debugging. `try/catch` around scene generation prevents a bad scene builder from silently killing the worker
- **GIF Export**: Encoder uses a known global palette (skips NeuQuant quantization for speed)
- **Save/Load**: Binary `.pbox` format serialises grid + life arrays (4 bytes header + 64 KB grid + 64 KB life = ~132 KB total)

### Why a Web Worker?
The physics loop iterates every cell every frame. At 60fps that's **3.8 million cell-checks/second**. Running this on the main thread would block rendering completely — the Worker keeps the UI buttery smooth.

---

## 🚀 Quick Start

```bash
git clone https://github.com/AieatAssam/powder-box.git
cd powder-box
npm install
npm run dev
```

Open `http://localhost:5173` and start drawing.

### Build for Production

```bash
npm run build      # outputs to dist/
npm run preview    # preview the production build locally
```

### Deploy to GitHub Pages

1. Push to the `main` branch
2. The included [GitHub Actions workflow](.github/workflows/deploy.yml) handles the rest
3. Your site will be live at `https://<username>.github.io/powder-box/`

**Already live:** [**🌐 https://aieatassam.github.io/powder-box/**](https://aieatassam.github.io/powder-box/)

---

## ⚙️ Tech Stack

| Layer | Technology |
|:------|:-----------|
| Runtime | Browser (Web Worker + Canvas 2D) |
| Language | TypeScript |
| Build | Vite |
| Physics | Custom grid simulation in Web Worker |
| GIF | `gif.js` with custom palette encoder |
| Rendering | OffscreenCanvas via pixel buffer transfer |
| Save/Load | Binary `.pbox` format (magic bytes + grid data) |

**Zero runtime dependencies.** The only npm packages are build/dev tools and `gif.js`.

---

## 💡 Inspiration

PowderBox is a modern take on the classic "falling sand" / "powder toy" genre — reimagined with:

- ✅ Modern TypeScript tooling
- ✅ Web Worker performance (60fps physics)
- ✅ 11 procedural scene generators
- ✅ Save/load for sharing worlds
- ✅ GIF export built in
- ✅ Colour-accurate toolbar swatches
- ✅ Zero Flash, zero plugins, zero hassle

---

## 📐 Technical Deep-Dive

### Grid Architecture

The simulation world is a **320 × 200** cell grid — 64,000 cells total. Each cell is represented by a single byte in a `Uint8Array`:

```
grid[ y * GRID_W + x ] = element_byte   // 0 = EMPTY, 1 = SAND, ..., 12 = GLASS
life[ y * GRID_W + x ] = timer_byte     // burn remaining, lifetime remaining, etc.
```

Two flat typed arrays: **64 KB for elements** + **64 KB for timers** = **128 KB total state**. This compact representation is cache-friendly — the entire grid fits in L2 cache on modern CPUs, making the per-tick scan extremely fast.

Elements are stored as `const enum` values that inline to raw bytes at compile time, eliminating function call overhead during the hot loop.

### Scan Direction & Deterministic Bias

Each tick scans the grid **bottom-to-top** (for normal gravity) or **top-to-bottom** (for reversed gravity). Within each row, the scan direction alternates based on row parity:

```
if (gravityDir >= 0) {
  for (let y = H - 1; y >= 0; y--)   // bottom → top
    if (y & 1) scan left→right        // odd rows: LTR
    else       scan right→left         // even rows: RTL
} else {
  for (let y = 0; y < H; y++)        // top → bottom
    if (y & 1) scan left→right
    else       scan right→left
}
```

This alternating pattern prevents particles from developing a directional bias (all drifting left or right) that would happen with a uniform scan direction. It's the same technique used in real falling-sand simulators like The Powder Toy.

### Per-Element Physics

Each element's tick function is specialised for its physical behaviour:

**Powders (Sand) — `tickSand()`**
1. Check cell below (gravity direction) — if empty or liquid, swap
2. If blocked, try diagonal fall (alternating per cell parity)
3. If still blocked, try sinking into liquid below
4. Apply wind push (30% chance)

Each powder cell checks up to 5 neighbour positions per tick. The diagonal check alternates direction based on `(x + y) & 1` to prevent staircase artifacts on slopes.

**Liquids (Water, Oil, Acid) — `tickLiquid(spreadRate)`**
1. Check cell below — if empty, fall (fast path)
2. Density displacement — water sinks through oil, oil floats on water
3. Inter-element reactions — water+lava=steam, oil+lava=fire, water+acid=steam
4. Lateral spread (up to `spreadRate` attempts per tick, alternating directions)
5. Wind push (15% chance)

Liquids use a configurable `spreadRate` parameter (water=4, oil=3, acid=3) controlling how many lateral spread attempts they make per tick. Higher values = faster spreading but more CPU.

**Gases (Steam, Smoke) — `tickGas(spreadRate)`**
1. Rise opposite to gravity direction
2. Lateral spread (up to `spreadRate` attempts)
3. Wind pushes strongly (2 attempts per tick)
4. Lifetime countdown — gases expire after a fixed number of ticks

**Fire — `tickFire()`**
1. Decrement lifetime — when it hits 0, turn to smoke
2. Spread to adjacent flammable cells (wood, oil, plant)
3. Random smoke emission in anti-gravity direction (8% chance per tick)
4. Water extinguishes instantly → steam

The spread uses a `FIRE_IGNITE_CHANCE` (1 in 8) per neighbour check, per tick. This gives fire a natural-looking propagation speed without igniting everything instantly.

**Lava — `tickLava()`**
1. Decrement lifetime — when it hits 0, solidify into WALL (obsidian)
2. Ignite adjacent flammable materials (1 in 4 chance)
3. React with water → steam explosion + solid rock
4. Fall like a slow liquid, sink below lighter liquids
5. Slow lateral spread

Lifetime values: FIRE=45 ticks, LAVA=180 ticks, SMOKE=35 ticks, STEAM=50 ticks, WOOD_BURN=60 ticks before wood turns to fire.

### Procedural Scene Generation

Each scene is a pure function `(seed) => Cell[]` that uses the **mulberry32** PRNG:

```
function mulberry32(seed: number): () => number {
  seed |= 0;
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
```

Mulberry32 is a 32-bit PRNG with 2^32 period, good distribution, and very fast — no Math.random calls needed. The seed is derived from `Date.now() ^ (Math.random() * 0x7fffffff | 0)`, making each generation unique.

Scene builders use drawing primitives:
- **`fillRect()`** — clamped to grid bounds, used for layers and structures
- **`fillCircle()`** — uses Euclidean distance check, used for ponds, craters, rocks
- **`strokeCircle()`** — Bresenham-like angular stepping, used for ring structures
- **`line()`** — Bresenham's line algorithm with integer-equality termination:
  - Rounds all inputs to prevent floating-point infinite loops
  - Safety cap at 10× Manhattan distance as a last resort
- **`scatter()`** — random placement with configurable density, used for foliage, shells
- **`makeSink()`** — collects cells into an array (avoids allocating intermediate structures)

Cells are packed into an `ArrayBuffer` as `[x(16bit LE), y(16bit LE), elem(8bit), life(8bit)]` — 6 bytes per cell. A typical scene generates 15,000–45,000 cells (180–270 KB buffer). Scene generation runs inside the Web Worker, keeping the main thread fully responsive.

### Worker Communication Protocol

The main thread and worker communicate via typed message passing:

```
Main → Worker:
  init         → sets grid dimensions
  tick         → run one physics tick, return a frame
  input        → set tool, position, brush state
  clear        → zero the grid and life arrays
  generateScene→ generate a procedural scene (includes genToken)
  explode      → trigger a radial explosion at (x, y, radius)
  wind/gravity → toggle environmental parameters
  saveState    → return serialized grid
  loadState    → restore grid from serialized data

Worker → Main:
  frame        → RGBA pixel buffer (transferable, zero-copy)
  stateSnapshot→ serialized grid + life arrays (for save/autosave)
```

#### Frame Pipeline with genToken

The `generateScene` flow uses a token system to prevent race conditions:

```
Main thread                     Worker
──────────                      ──────
sceneGenCounter++
pendingGenToken = counter
postMessage({generateScene, genToken})
                                receives message
                                buildScenePlacement()  ← CPU-heavy
                                renderPixels()
                                postMessage({frame, sceneGenToken})
receives frame
if msg.sceneGenToken === pendingGenToken:
    sceneGenerating = false
```

Without this token, stale tick frames (queued before the clear message) would reset `sceneGenerating` prematurely, allowing subsequent generate clicks to slip through and pile up in the worker's message queue.

#### Buffer Transfer

The worker's RGBA pixel buffer (320×200×4 = 256 KB) is sent via `postMessage` with the **transferable** protocol:

```js
self.postMessage(frameMessage, [pixels.buffer]);
```

This transfers ownership of the `ArrayBuffer` to the main thread — zero-copy, no serialization overhead. The worker immediately allocates a fresh buffer for the next frame. This double-buffering pattern avoids any data races.

### Rendering Pipeline

```
requestAnimationFrame(renderLoop)
  │
  ├─ renderTick()
  │     │
  │     ├─ latestFrame? ──no──→ (nothing to render)
  │     │    │
  │     │   yes
  │     │    │
  │     ├─ gridImgData.data.set(latestFrame)   ← 256 KB copy
  │     ├─ offCtx.putImageData(gridImgData, 0, 0)
  │     ├─ ctx.drawImage(offscreen, 0, 0, 960, 600)  ← GPU-scaled
  │     │
  │     └─ queueTick()  ← send next tick AFTER rendering
  │                         (backpressure: tickPending flag)
  │
  └─ requestAnimationFrame(renderLoop)
```

The `latestFrame` buffer is a single slot — if the worker produces frames faster than vsync, intermediate frames are dropped. This prevents the main thread from being flooded with messages.

The offscreen canvas at 320×200 resolution is scaled to 960×600 display pixels via `ctx.drawImage()` — the GPU handles the bilinear scaling for free.

#### Frame Budget

When the physics worker is overloaded (many particles), the rAF loop naturally reduces the tick rate — `queueTick()` is only called after rendering, so if rendering takes 20ms, the next tick is delayed by 20ms. The system gracefully degrades from 60fps to 30fps or lower rather than freezing.

### GIF Encoding

The GIF encoder uses a **pre-computed global palette** built from all element color variants. This means:

- No NeuQuant quantization per frame (the expensive part of GIF encoding)
- The palette is fixed at 256 colors (padding unused slots with black)
- Each frame's RGBA data is passed directly to the encoder without color reduction
- Encoding 90 frames at 320×200 takes ~2-3 seconds via `gif.js` running in its own worker

### Save/Load Binary Format

`.pbox` files use a compact binary layout:

```
Offset  Size  Field
────────────────────────────
 0       4    Magic bytes: 0x50425850 ("PBOX" in LE)
 4       2    Grid width (16-bit LE)
 6       2    Grid height (16-bit LE)
 8      64KB  Grid element data (W×H bytes)
 8+64KB 64KB  Life/timer data (W×H bytes)
────────────────────────────
Total: ~128 KB + 8 byte header
```

The format is just a memory dump of the two typed arrays — fast to serialize, fast to load, no parsing overhead. The magic bytes allow the load handler to validate files before applying them.

### Performance Characteristics

| Operation | Time | Notes |
|:----------|:-----|:------|
| Physics tick (empty grid) | ~0.05 ms | Just iterating 64K cells checking for EMPTY |
| Physics tick (10K particles) | ~2-5 ms | Sand settling, water flowing |
| Physics tick (40K particles) | ~5-15 ms | Beach scene density |
| Scene generation (beach) | ~15-50 ms | 42K-45K cells, in worker |
| Render frame to canvas | ~0.5-1 ms | 256 KB copy + putImageData + drawImage |
| GIF encode (90 frames) | ~2-3 s | gif.js with pre-computed palette |
| Save to file | ~1-2 ms | Two TypedArray copies + Blob |
| Load from file | ~3-5 ms | ArrayBuffer → grid.set() + life.set() |

The critical bottleneck is the physics tick on dense grids. Each tick touches every cell once for scanning, plus neighbor checks for active particles. With 40K particles, the tick does roughly 64K main-loop iterations + ~150K neighbor reads + ~40K grid writes. This fits comfortably within a 16ms frame budget at 60fps.

---

## 📜 License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong><a href="https://aieatassam.github.io/powder-box/">🌐 Try PowderBox Now →</a></strong>
</p>
