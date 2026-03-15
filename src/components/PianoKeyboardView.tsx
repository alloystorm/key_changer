import { useRef, useEffect, useCallback } from 'react';
import type { NoteEvent } from '../lib/types';
import { 
  SIDEBAR_WIDTH, 
  MIDI_LOW, 
  MIDI_HIGH, 
  NOTE_COLORS, 
  isBlack, 
  buildKeyGeometryForRange, 
  countWhiteKeys,
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
  const rangeRef = useRef({ low: MIDI_LOW, high: MIDI_HIGH });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const rollWidth = width - SIDEBAR_WIDTH;
    const keyboardHeight = height;

    // Integer-expanded range: geometry is always built for whole keys.
    // The fractional edges (rangeLow/rangeHigh may be floats from animation)
    // are handled by a canvas scale+translate applied below.
    const iLow  = Math.floor(rangeLow);
    const iHigh = Math.ceil(rangeHigh);

    const existingWkW = keyGeomRef.current.size > 0
      ? (keyGeomRef.current.get(!isBlack(iLow) ? iLow : iLow + 1)?.w ?? 0) + 1
      : 0;
    const expectedWkW = rollWidth / Math.max(1, countWhiteKeys(iLow, iHigh));
    if (
      Math.abs(existingWkW - expectedWkW) > 0.5 ||
      rangeRef.current.low !== iLow ||
      rangeRef.current.high !== iHigh
    ) {
      keyGeomRef.current = buildKeyGeometryForRange(rollWidth, iLow, iHigh);
      rangeRef.current = { low: iLow, high: iHigh };
    }
    const keyGeom = keyGeomRef.current;

    const activeKeys = new Set<number>();
    const activeTracks = new Map<number, number>();
    const activeNote = new Map<number, NoteEvent>();
    const previewAlphas = new Map<number, number>();
    const previewTracks = new Map<number, number>();

    const PREVIEW_WINDOW = 3.0;

    notes.forEach((note) => {
      const pitch = note.pitch + transpose;
      if (pitch < iLow || pitch > iHigh) return;
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
    // Treat the pitch range as linear in x-space.  The geometry was built for
    // [iLow, iHigh] spanning rollWidth.  The float range [rangeLow, rangeHigh]
    // is a sub-interval of [iLow, iHigh], so we scale+translate so that
    // sub-interval fills rollWidth exactly.
    const span    = Math.max(1, iHigh - iLow);
    const fracLow  = (rangeLow  - iLow) / span;
    const fracHigh = (rangeHigh - iLow) / span;
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
    for (let midi = iLow; midi <= iHigh; midi++) {
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
    for (let midi = iLow; midi <= iHigh; midi++) {
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
      const cx = g.x + g.w / 2;
      const glowH = Math.min(30, keyboardHeight * 0.42);
      const glowW = (g.w + 14);
      const gradGlow = ctx.createLinearGradient(0, 0, 0, glowH);
      gradGlow.addColorStop(0, 'rgba(255,255,255,0.45)');
      gradGlow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradGlow;
      ctx.fillRect(cx - glowW / 2, 0, glowW, glowH);
      const sparkH = Math.min(6, keyboardHeight * 0.10);
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillRect(cx - g.w / 2 - 2, 0, g.w + 4, sparkH);
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
