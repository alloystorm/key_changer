import { useRef, useEffect, useCallback } from 'react';
import type { NoteEvent } from '../lib/types';
import { 
  SIDEBAR_WIDTH, 
  MIDI_LOW, 
  MIDI_HIGH, 
  NOTE_COLORS, 
  isBlack, 
  buildKeyGeometryForRange,
  shadeColor,
  hexToRgb,
  type KeyGeom
} from '../lib/layout';

import './PianoKeyboardView.css';

interface Props {
  notes: NoteEvent[];
  transpose: number;
  currentTime: number;
  showFingers: boolean;
  keyRange?: { low: number; high: number };
}

export function PianoKeyboardView({ notes, transpose, currentTime, showFingers, keyRange }: Props) {
  const rangeLow  = keyRange?.low  ?? MIDI_LOW;
  const rangeHigh = keyRange?.high ?? MIDI_HIGH;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const keyGeomRef = useRef<Map<number, KeyGeom>>(new Map());

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const rollWidth = width - SIDEBAR_WIDTH;
    const keyboardHeight = height;

    // Geometry is always built for the full 88-key range [MIDI_LOW, MIDI_HIGH].
    // This keeps the transform span constant (87 semitones) so scaleX/transX
    // are perfectly smooth — no discontinuity when float boundaries cross integers.
    const expectedWkW = rollWidth / 52; // 52 white keys in the full 88-note range
    const existingWkW = keyGeomRef.current.get(MIDI_LOW)?.w ?? 0;
    if (Math.abs(existingWkW - expectedWkW) > 0.5) {
      keyGeomRef.current = buildKeyGeometryForRange(rollWidth, MIDI_LOW, MIDI_HIGH);
    }
    const keyGeom = keyGeomRef.current;

    // Iteration bounds: only visit keys inside the visible float range (performance).
    const drawLow  = Math.floor(rangeLow);
    const drawHigh = Math.ceil(rangeHigh);

    const activeKeys = new Set<number>();
    const activeTracks = new Map<number, number>();
    const activeNote = new Map<number, NoteEvent>();
    const previewAlphas = new Map<number, number>();
    const previewTracks = new Map<number, number>();

    const PREVIEW_WINDOW = 3.0;

    notes.forEach((note) => {
      const pitch = note.pitch + transpose;
      if (pitch < drawLow || pitch > drawHigh) return;
      const isCurrentlyActive = note.startTime <= currentTime && note.startTime + note.duration >= currentTime;

      if (isCurrentlyActive) {
        activeKeys.add(pitch);
        activeTracks.set(pitch, note.track);
        activeNote.set(pitch, note);
      } else if (note.startTime > currentTime) {
        const dt = note.startTime - currentTime;
        if (dt < PREVIEW_WINDOW) {
          const existingAlpha = previewAlphas.get(pitch);
          const newAlpha = (1 - dt / PREVIEW_WINDOW) * 0.5;
          if (existingAlpha === undefined || newAlpha > existingAlpha) {
            previewAlphas.set(pitch, newAlpha);
            previewTracks.set(pitch, note.track);
          }
        }
      }
    });

    ctx.clearRect(0, 0, width, height);

    // ── Sub-pixel pan/zoom transform ──────────────────────────────────────────
    // Geometry spans [MIDI_LOW, MIDI_HIGH] = 87 semitones → constant span,
    // so fracLow/fracHigh/scaleX change smoothly with no integer-boundary snaps.
    const span     = MIDI_HIGH - MIDI_LOW; // 87, never changes
    const fracLow  = (rangeLow  - MIDI_LOW) / span;
    const fracHigh = (rangeHigh - MIDI_LOW) / span;
    const visFrac  = Math.max(0.001, fracHigh - fracLow);
    const scaleX   = 1 / visFrac;
    const transX   = -fracLow * rollWidth * scaleX;
    
    const wkH = keyboardHeight - 1;
    const bkH = keyboardHeight * 0.58;

    // Clip to the roll area so fractional edge keys don't bleed over the sidebar
    ctx.save();
    ctx.beginPath();
    ctx.rect(SIDEBAR_WIDTH, 0, rollWidth, height);
    ctx.clip();

    // Apply zoom+pan: all key coordinates (geom.x) are now in the integer-range
    // pixel space; this transform maps them into the visible float-range space.
    ctx.translate(SIDEBAR_WIDTH + transX, 0);
    ctx.scale(scaleX, 1);

    // White keys
    for (let midi = drawLow; midi <= drawHigh; midi++) {
      if (isBlack(midi)) continue;
      const geom = keyGeom.get(midi)!;
      const active = activeKeys.has(midi);
      const trackIdx = active ? (activeTracks.get(midi) ?? 0) : (previewTracks.get(midi) ?? 0);
      const alpha = active ? 1 : (previewAlphas.get(midi) ?? 0);

      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(geom.x, 0, geom.w, wkH);

      if (alpha > 0) {
        const color = NOTE_COLORS[trackIdx % NOTE_COLORS.length];
        const rgb = hexToRgb(color);
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        ctx.fillRect(geom.x, 0, geom.w, wkH);
      }

      ctx.strokeStyle = '#555';
      ctx.lineWidth = 0.5 / scaleX; // keep stroke width visually constant
      ctx.strokeRect(geom.x, 0, geom.w, wkH);

      if (midi % 12 === 0) {
        ctx.fillStyle = '#111';
        ctx.font = `bold ${Math.min(10, height * 0.22)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.save();
        ctx.scale(1 / scaleX, 1); // un-scale text so it stays readable
        ctx.fillText(`C${Math.floor(midi / 12) - 1}`, (geom.x + geom.w / 2) * scaleX, wkH - 3);
        ctx.restore();
      }

      if (showFingers && active) {
        const n = activeNote.get(midi);
        if (n?.finger) {
          ctx.fillStyle = '#111';
          ctx.font = `bold ${Math.min(geom.w * 0.65, height * 0.4, 12)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.save();
          ctx.scale(1 / scaleX, 1);
          ctx.fillText(String(n.finger), (geom.x + geom.w / 2) * scaleX, height * 0.12);
          ctx.restore();
        }
      }
    }

    // Black keys
    for (let midi = drawLow; midi <= drawHigh; midi++) {
      if (!isBlack(midi)) continue;
      const geom = keyGeom.get(midi);
      if (!geom) continue;
      const active = activeKeys.has(midi);
      const trackIdx = active ? (activeTracks.get(midi) ?? 0) : (previewTracks.get(midi) ?? 0);
      const alpha = active ? 1 : (previewAlphas.get(midi) ?? 0);

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(geom.x, 0, geom.w, bkH);

      if (alpha > 0) {
        let color = NOTE_COLORS[trackIdx % NOTE_COLORS.length];
        if (active) color = shadeColor(color, -20);
        const rgb = hexToRgb(color);
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        ctx.fillRect(geom.x, 0, geom.w, bkH);
      }

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.5 / scaleX;
      ctx.strokeRect(geom.x, 0, geom.w, bkH);

      if (showFingers && active && geom.w >= 8) {
        const n = activeNote.get(midi);
        if (n?.finger) {
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${Math.min(geom.w * 0.65, height * 0.4, 12)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.save();
          ctx.scale(1 / scaleX, 1);
          ctx.fillText(String(n.finger), (geom.x + geom.w / 2) * scaleX, height * 0.12);
          ctx.restore();
        }
      }
    }

    // ── Key-press glow ─────────────────────────────────────────────────────────
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    activeKeys.forEach((pitch) => {
      const g = keyGeom.get(pitch);
      if (!g) return;
      const trackIdx = activeTracks.get(pitch) ?? 0;
      const { r, g: gr, b } = hexToRgb(NOTE_COLORS[trackIdx % NOTE_COLORS.length]);
      const cx = g.x + g.w / 2;

      if (!g.isBlack) {
        // White key: width capped to 85 % of key so glow doesn't spill onto
        // adjacent black keys. Taller gradient with track colour for a vivid look.
        const glowW = g.w * 0.85;
        const glowH = Math.min(keyboardHeight * 0.6, 55);
        const grad = ctx.createLinearGradient(0, 0, 0, glowH);
        grad.addColorStop(0,   `rgba(${r},${gr},${b},0.55)`);
        grad.addColorStop(0.35,`rgba(${r},${gr},${b},0.18)`);
        grad.addColorStop(1,   `rgba(${r},${gr},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(cx - glowW / 2, 0, glowW, glowH);
        // Bright spark line along the top edge
        const sparkH = Math.max(2, Math.min(4, keyboardHeight * 0.05));
        ctx.fillStyle = `rgba(${r},${gr},${b},0.9)`;
        ctx.fillRect(cx - glowW / 2, 0, glowW, sparkH);
      } else {
        // Black key: bloom slightly wider than the key for a soft halo effect.
        const glowW = g.w * 1.5;
        const glowH = bkH * 0.65;
        const grad = ctx.createLinearGradient(0, 0, 0, glowH);
        grad.addColorStop(0, `rgba(${r},${gr},${b},0.7)`);
        grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(cx - glowW / 2, 0, glowW, glowH);
        // Bright spark along the top edge, confined to key width
        const sparkH = Math.max(2, Math.min(3, bkH * 0.06));
        ctx.fillStyle = `rgba(${r},${gr},${b},0.95)`;
        ctx.fillRect(cx - g.w / 2, 0, g.w, sparkH);
      }
    });
    ctx.restore();

    ctx.restore(); // undo clip + translate + scale
  }, [notes, transpose, currentTime, showFingers, rangeLow, rangeHigh]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { width, height };
        keyGeomRef.current = new Map();
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = Math.round(width);
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
    <div ref={containerRef} className="piano-keyboard-view">
      <canvas ref={canvasRef} className="piano-keyboard-canvas" />
    </div>
  );
}
