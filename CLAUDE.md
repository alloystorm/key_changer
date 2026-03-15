# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start Vite dev server
npm run build      # tsc type-check then Vite production build
npm run preview    # serve the production build locally
npm run test       # run vitest once
npm run test:watch # run vitest in watch mode
```

Tests use **vitest**. The only test file is `src/lib/fingering.test.ts`.

## Architecture

**ShiftPiano** is a browser-based piano learning app. Users load a MIDI or MXL file and see it visualised while it plays back.

### Data flow

1. **Parsing** — `src/lib/midiParser.ts` (uses `@tonejs/midi`) and `src/lib/mxlParser.ts` (uses `jszip` + `opensheetmusicdisplay`) both produce a `ParsedSong` (see `src/lib/types.ts`), which is a flat array of `NoteEvent` objects (pitch, startTime, duration, velocity, track).
2. **Finger hints** — `src/lib/fingering.ts` mutates `NoteEvent.finger` and `NoteEvent.hand` in place after parsing.
3. **Playback** — `src/lib/player.ts` exposes a singleton `player`. It fetches per-note MP3s from the `gleitz/midi-js-soundfonts` CDN (acoustic grand piano), schedules them via Web Audio API, and drives `currentTime` via `requestAnimationFrame`. Transpose re-fetches the shifted pitches; playback rate reschedules all sources.
4. **State** — All app state lives in `App.tsx` (`useState`). `currentTime` is updated on every animation frame. `transpose`, `playbackRate`, `viewMode`, and `rollSettings` flow down as props.
5. **Persistence** — `src/lib/storage.ts` wraps raw IndexedDB (`ShiftPianoDB`) to cache uploaded songs so they survive page refresh.

### Shared utilities

- **`src/lib/layout.ts`** — keyboard geometry constants (`MIDI_LOW=21`, `MIDI_HIGH=108`, `NOTE_COLORS`, key position helpers). Imported by all views to stay in sync.
- **`src/lib/chords.ts`** — detects chord names from simultaneous `NoteEvent`s and returns `ChordEvent[]` (time + name). Used by views to display chord labels.

### Views

All views are canvas-based and sized via `ResizeObserver`. They receive `notes`, `transpose`, and `currentTime` as props and redraw on every frame.

- **`PianoRollView`** — scrolling note bar. Supports `flowDirection` (up/down), `triggerPosition` (where the play line sits), and `showFingers`.
- **`SheetMusicView`** — renders MusicXML via `opensheetmusicdisplay`. Only visible when `ParsedSong.musicXml` is present.
- **`PianoKeyboardView`** — 88-key keyboard (MIDI 21–108). Key geometry is rebuilt when container width changes. `aspect-ratio: 52/6` keeps key proportions natural as the container narrows.

### Layout

`App.css` controls the three-panel player layout via flex ratios on `.view-area--{pianoroll,sheet,both}`. The keyboard panel uses `aspect-ratio: 52/6; max-height: 160px` so it scales proportionally rather than stretching.

### Vite config note

`base: './'` keeps asset paths relative, which is required for Capacitor / Tauri / GitHub Pages hosting.
