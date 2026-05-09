# 🧪 PowderBox

A particle sandbox simulation — draw with sand, water, fire, lava, acid, and more. Watch emergent physics in real-time.

**Zero API keys required. Zero external services. Just HTML + Canvas + Web Worker.**

## Features

- **10 elements**: Sand, Water, Fire, Wall, Wood, Oil, Plant, Lava, Acid, Eraser
- **Emergent physics**: Sand falls and piles, water flows, fire spreads, lava solidifies, acid dissolves
- **Element interactions**: Water extinguishes fire → steam, Oil + fire → explosion, Lava + water → steam, Wood burns → fire
- **GIF export**: Record 3-second GIFs of your creations
- **Keyboard shortcuts**: `1-9` tools, `0` eraser, `-`/`=` brush, `G` GIF, `C` clear, `Space` pause
- **Mobile-friendly**: Responsive canvas, touch support, scrollable toolbar
- **No dependencies beyond dev**: Vite + TypeScript
- **60fps physics**: Grid simulation runs in a Web Worker via `OffscreenCanvas`-style pixel transfer

## Quick Start

```bash
npm install
npm run dev
```

## Build & Deploy

```bash
npm run build     # outputs to dist/
npm run preview   # preview production build
```

Push to GitHub with the included deploy workflow — Pages deploy happens automatically.

## Architecture

```
┌─────────┐   mouse events   ┌──────────┐   pixel buffer   ┌────────────┐
│ Browser ├─────────────────►│ main.ts  ├─────────────────►│ Worker     │
│ (render) │                 │ (input)   │  (transferable)  │ (physics)  │
└─────────┘                  └──────────┘                   └────────────┘
```

- **Grid**: 320 × 200 cells as flat `Uint8Array` (one byte per cell)
- **Worker**: Owns grid state, processes physics bottom-up with alternating scan to prevent bias
- **Rendering**: `requestAnimationFrame` loop sends ticks, worker returns RGBA buffer transferred via `postMessage`
- **GIF Export**: `GIFEncoder` from `gif.js` with known palette (skips NeuQuant quantization for speed)

## License

MIT
