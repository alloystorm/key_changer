import { useRef, useEffect, useCallback, useMemo } from 'react';
import type { NoteEvent, RollSettings } from '../lib/types';
import { computeFingerHints } from '../lib/fingering';
import './PianoRollView.css';

// ─── Layout constants ────────────────────────────────────────────────────────
const SIDEBAR_WIDTH = 36;       // left pitch-label sidebar
const KEYBOARD_HEIGHT = 120;    // height of the piano keyboard strip
const MIDI_LOW  = 21;           // A0
const MIDI_HIGH = 108;          // C8
const VISIBLE_SECONDS = 4;      // seconds of music visible in the roll at once

const NOTE_COLORS = [
  '#7c6af7', '#f77c6a', '#6af7b8', '#f7e96a',
  '#6ab4f7', '#f76ac8', '#aef76a',
];

// Black-key MIDI semitone offsets within an octave
const BLACK_OFFSETS = new Set([1, 3, 6, 8, 10]);

function isBlack(midi: number) {
  return BLACK_OFFSETS.has(midi % 12);
}

// ── Per-key geometry: x position and width aligned to the keyboard ───────────
interface KeyGeom {
  x: number;       // left edge relative to roll area (excludes sidebar)
  w: number;       // width in pixels
  isBlack: boolean;
}

function buildKeyGeometry(rollWidth: number): Map<number, KeyGeom> {
  const whites: number[] = [];
  for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) {
    if (!isBlack(m)) whites.push(m);
  }
  const wkW = rollWidth / whites.length;
  const bkW = wkW * 0.60;

  const map = new Map<number, KeyGeom>();
  whites.forEach((midi, i) => {
    map.set(midi, { x: i * wkW, w: wkW - 1, isBlack: false });
  });
  whites.forEach((midi, i) => {
    const nb = midi + 1;
    if (isBlack(nb) && nb <= MIDI_HIGH) {
      const cx = (i + 1) * wkW;
      map.set(nb, { x: cx - bkW / 2, w: bkW, isBlack: true });
    }
  });
  return map;
}

function triggerFrac(pos: RollSettings['triggerPosition']): number {
  return pos === 'bottom' ? 1.0 : pos === 'middle' ? 0.5 : 0.15;
}

function shadeColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  notes: NoteEvent[];
  transpose: number;
  currentTime: number;
  totalDuration: number;
  settings: RollSettings;
}

export function PianoRollView({ notes, transpose, currentTime, settings }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef      = useRef({ width: 0, height: 0 });
  const keyGeomRef   = useRef<Map<number, KeyGeom>>(new Map());

  const { flowDirection, triggerPosition, showFingers } = settings;

  // Finger hints recomputed when relevant props change
  const fingerHints = useMemo(() => {
    if (!showFingers) return new Map();
    return computeFingerHints(notes, transpose, currentTime, currentTime + VISIBLE_SECONDS);
  }, [notes, transpose, currentTime, showFingers]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const rollWidth  = width - SIDEBAR_WIDTH;
    const rollHeight = height - KEYBOARD_HEIGHT;

    // Rebuild key geometry when width changes
    const existingWkW = keyGeomRef.current.size > 0
      ? (keyGeomRef.current.get(MIDI_LOW + 2)?.w ?? 0) + 1
      : 0;
    const expectedWkW = rollWidth / 52;
    if (Math.abs(existingWkW - expectedWkW) > 0.5) {
      keyGeomRef.current = buildKeyGeometry(rollWidth);
    }
    const keyGeom = keyGeomRef.current;

    // ── Background ────────────────────────────────────────────────────────
    ctx.fillStyle = '#111';
    ctx.fillRect(SIDEBAR_WIDTH, 0, rollWidth, rollHeight);

    // ── Lane shading for black key columns ────────────────────────────────
    keyGeom.forEach((geom, midi) => {
      if (geom.isBlack) {
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.fillRect(SIDEBAR_WIDTH + geom.x, 0, geom.w, rollHeight);
      }
    });

    // Octave divider lines
    for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) {
      if (m % 12 === 0 && keyGeom.has(m)) {
        const geom = keyGeom.get(m)!;
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(SIDEBAR_WIDTH + geom.x, 0);
        ctx.lineTo(SIDEBAR_WIDTH + geom.x, rollHeight);
        ctx.stroke();
      }
    }

    // ── Play line & scaling ───────────────────────────────────────────────
    const frac = triggerFrac(triggerPosition);
    const playLineY = flowDirection === 'down'
      ? rollHeight * frac
      : rollHeight * (1 - frac);

    const travelPx = flowDirection === 'down' ? playLineY : rollHeight - playLineY;
    const pxPerSecond = travelPx / VISIBLE_SECONDS;

    // Draw play-line only when not flush with keyboard edge
    if (triggerPosition !== 'bottom') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(SIDEBAR_WIDTH, playLineY);
      ctx.lineTo(width, playLineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Active key tracking ───────────────────────────────────────────────
    const activeKeys    = new Set<number>();
    const activeTracks  = new Map<number, number>();

    notes.forEach((note) => {
      const pitch = Math.max(MIDI_LOW, Math.min(MIDI_HIGH, note.pitch + transpose));
      if (note.startTime <= currentTime && note.startTime + note.duration >= currentTime) {
        activeKeys.add(pitch);
        activeTracks.set(pitch, note.track);
      }
    });

    // ── Draw notes (white pass, then black on top) ────────────────────────
    const drawNote = (note: NoteEvent, blackPass: boolean) => {
      const pitch = Math.max(MIDI_LOW, Math.min(MIDI_HIGH, note.pitch + transpose));
      const geom = keyGeom.get(pitch);
      if (!geom || geom.isBlack !== blackPass) return;

      const secFromNow = note.startTime - currentTime;
      const secEnd     = (note.startTime + note.duration) - currentTime;

      let yTop: number, yBottom: number;
      if (flowDirection === 'down') {
        yTop    = playLineY - secEnd     * pxPerSecond;
        yBottom = playLineY - secFromNow * pxPerSecond;
      } else {
        const a = playLineY + secFromNow * pxPerSecond;
        const b = playLineY + secEnd     * pxPerSecond;
        yTop    = Math.min(a, b);
        yBottom = Math.max(a, b);
      }

      const noteH = Math.max(yBottom - yTop, 3);
      if (yBottom < 0 || yTop > rollHeight) return;

      const x = SIDEBAR_WIDTH + geom.x;
      const w = geom.w;
      const color = NOTE_COLORS[note.track % NOTE_COLORS.length];

      const isPast = flowDirection === 'down' ? yBottom < playLineY : yTop > playLineY;
      ctx.globalAlpha = isPast ? 0.4 : 1.0;
      ctx.fillStyle   = geom.isBlack ? shadeColor(color, -35) : color;

      const radius = Math.min(w / 2, 4);
      ctx.beginPath();
      ctx.roundRect(x, yTop, w, noteH, radius);
      ctx.fill();

      // Leading-edge bright cap for active notes
      const isActive = note.startTime <= currentTime && note.startTime + note.duration >= currentTime;
      if (isActive) {
        ctx.fillStyle   = '#fff';
        ctx.globalAlpha = 0.75;
        const capY = flowDirection === 'down' ? yTop : yBottom - 2;
        ctx.fillRect(x, capY, w, 2);
      }

      // Finger label inside bar
      if (showFingers && noteH >= 14 && w >= 8) {
        const key = `${pitch}_${note.startTime.toFixed(3)}`;
        const hint = fingerHints.get(key);
        if (hint) {
          ctx.globalAlpha = 1;
          const fontSize = Math.min(w * 0.65, 13);
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle    = geom.isBlack ? '#fff' : '#111';
          ctx.fillText(String(hint.finger), x + w / 2, yTop + noteH / 2);
        }
      }

      ctx.globalAlpha = 1;
    };

    notes.forEach((n) => drawNote(n, false));
    notes.forEach((n) => drawNote(n, true));

    // ── Keyboard ──────────────────────────────────────────────────────────
    const kbTop = rollHeight;
    const wkH   = KEYBOARD_HEIGHT - 1;
    const bkH   = KEYBOARD_HEIGHT * 0.58;

    // White keys
    for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
      if (isBlack(midi)) continue;
      const geom = keyGeom.get(midi)!;
      const active = activeKeys.has(midi);
      const trackIdx = activeTracks.get(midi) ?? 0;

      ctx.fillStyle  = active ? NOTE_COLORS[trackIdx % NOTE_COLORS.length] : '#f0f0f0';
      ctx.strokeStyle = '#555';
      ctx.lineWidth  = 0.5;
      ctx.fillRect  (SIDEBAR_WIDTH + geom.x, kbTop, geom.w, wkH);
      ctx.strokeRect(SIDEBAR_WIDTH + geom.x, kbTop, geom.w, wkH);

      // C label
      if (midi % 12 === 0) {
        ctx.fillStyle    = active ? 'rgba(0,0,0,0.5)' : '#999';
        ctx.font         = '8px sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`C${Math.floor(midi / 12) - 1}`, SIDEBAR_WIDTH + geom.x + geom.w / 2, kbTop + wkH - 2);
      }

      // Finger on key
      if (showFingers && active) {
        for (const [k, h] of fingerHints) {
          if (h.pitch === midi) {
            ctx.fillStyle    = '#111';
            ctx.font         = `bold ${Math.min(geom.w * 0.6, 12)}px sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(h.finger), SIDEBAR_WIDTH + geom.x + geom.w / 2, kbTop + wkH * 0.38);
            break;
          }
        }
      }
    }

    // Black keys (on top)
    for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
      if (!isBlack(midi)) continue;
      const geom = keyGeom.get(midi);
      if (!geom) continue;
      const active   = activeKeys.has(midi);
      const trackIdx = activeTracks.get(midi) ?? 0;

      ctx.fillStyle  = active ? shadeColor(NOTE_COLORS[trackIdx % NOTE_COLORS.length], -20) : '#1a1a1a';
      ctx.strokeStyle = '#000';
      ctx.lineWidth  = 0.5;
      ctx.fillRect  (SIDEBAR_WIDTH + geom.x, kbTop, geom.w, bkH);
      ctx.strokeRect(SIDEBAR_WIDTH + geom.x, kbTop, geom.w, bkH);

      if (showFingers && active && geom.w >= 8) {
        for (const [, h] of fingerHints) {
          if (h.pitch === midi) {
            ctx.fillStyle    = '#fff';
            ctx.font         = `bold ${Math.min(geom.w * 0.7, 11)}px sans-serif`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(h.finger), SIDEBAR_WIDTH + geom.x + geom.w / 2, kbTop + bkH * 0.38);
            break;
          }
        }
      }
    }

    // ── Sidebar ───────────────────────────────────────────────────────────
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, SIDEBAR_WIDTH, height);
    ctx.fillRect(0, rollHeight, SIDEBAR_WIDTH, KEYBOARD_HEIGHT);

  }, [notes, transpose, currentTime, flowDirection, triggerPosition, showFingers, fingerHints]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { width, height };
        keyGeomRef.current = new Map(); // force geometry rebuild
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width  = Math.round(width);
          canvas.height = Math.round(height);
        }
        draw();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div ref={containerRef} className="piano-roll-view">
      <canvas ref={canvasRef} className="piano-roll-canvas" />
    </div>
  );
}
