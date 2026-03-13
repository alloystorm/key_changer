import { useRef, useEffect, useCallback } from 'react';
import type { NoteEvent } from '../lib/types';

import './PianoKeyboardView.css';

const SIDEBAR_WIDTH = 36;
const MIDI_LOW = 21;
const MIDI_HIGH = 108;

const NOTE_COLORS = [
  '#7c6af7', '#f77c6a', '#6af7b8', '#f7e96a',
  '#6ab4f7', '#f76ac8', '#aef76a',
];

const BLACK_OFFSETS = new Set([1, 3, 6, 8, 10]);

function isBlack(midi: number) {
  return BLACK_OFFSETS.has(midi % 12);
}

interface KeyGeom {
  x: number;
  w: number;
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

function shadeColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function hexToRgb(hex: string): { r: number, g: number, b: number } {
  const num = parseInt(hex.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

interface Props {
  notes: NoteEvent[];
  transpose: number;
  currentTime: number;
  showFingers: boolean;
}

export function PianoKeyboardView({ notes, transpose, currentTime, showFingers }: Props) {
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

    const existingWkW = keyGeomRef.current.size > 0
      ? (keyGeomRef.current.get(MIDI_LOW + 2)?.w ?? 0) + 1
      : 0;
    const expectedWkW = rollWidth / 52; // 52 white keys
    if (Math.abs(existingWkW - expectedWkW) > 0.5) {
      keyGeomRef.current = buildKeyGeometry(rollWidth);
    }
    const keyGeom = keyGeomRef.current;

    const activeKeys = new Set<number>();
    const activeTracks = new Map<number, number>();
    const activeNote = new Map<number, NoteEvent>();
    const previewAlphas = new Map<number, number>(); // pitch -> alpha (0-0.5)
    const previewTracks = new Map<number, number>(); // pitch -> track index

    const PREVIEW_WINDOW = 1.0; // seconds

    notes.forEach((note) => {
      const pitch = Math.max(MIDI_LOW, Math.min(MIDI_HIGH, note.pitch + transpose));
      const isCurrentlyActive = note.startTime <= currentTime && note.startTime + note.duration >= currentTime;
      
      if (isCurrentlyActive) {
        activeKeys.add(pitch);
        activeTracks.set(pitch, note.track);
        activeNote.set(pitch, note);
      } else if (note.startTime > currentTime) {
        const dt = note.startTime - currentTime;
        if (dt < PREVIEW_WINDOW) {
          // If already has a preview, only replace if this one is sooner
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

    // Sidebar background
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, SIDEBAR_WIDTH, height);

    const wkH = keyboardHeight - 1;
    const bkH = keyboardHeight * 0.58;

    // White keys
    for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
      if (isBlack(midi)) continue;
      const geom = keyGeom.get(midi)!;
      const active = activeKeys.has(midi);
      const trackIdx = active ? (activeTracks.get(midi) ?? 0) : (previewTracks.get(midi) ?? 0);
      const alpha = active ? 1 : (previewAlphas.get(midi) ?? 0);

      // Draw base key
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(SIDEBAR_WIDTH + geom.x, 0, geom.w, wkH);

      // Draw track color overlay
      if (alpha > 0) {
        const color = NOTE_COLORS[trackIdx % NOTE_COLORS.length];
        const rgb = hexToRgb(color);
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        ctx.fillRect(SIDEBAR_WIDTH + geom.x, 0, geom.w, wkH);
      }

      ctx.strokeStyle = '#555';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(SIDEBAR_WIDTH + geom.x, 0, geom.w, wkH);

      if (midi % 12 === 0) {
        ctx.fillStyle = active ? 'rgba(0,0,0,0.5)' : '#999';
        ctx.font = `${Math.min(9, height * 0.2)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`C${Math.floor(midi / 12) - 1}`, SIDEBAR_WIDTH + geom.x + geom.w / 2, wkH - 2);
      }

      if (showFingers && active) {
        const n = activeNote.get(midi);
        if (n?.finger) {
          ctx.fillStyle = '#111';
          ctx.font = `bold ${Math.min(geom.w * 0.6, height * 0.4, 12)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(n.finger), SIDEBAR_WIDTH + geom.x + geom.w / 2, wkH * 0.38);
        }
      }
    }

    // Black keys
    for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
      if (!isBlack(midi)) continue;
      const geom = keyGeom.get(midi);
      if (!geom) continue;
      const active = activeKeys.has(midi);
      const trackIdx = active ? (activeTracks.get(midi) ?? 0) : (previewTracks.get(midi) ?? 0);
      const alpha = active ? 1 : (previewAlphas.get(midi) ?? 0);

      // Draw base key
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(SIDEBAR_WIDTH + geom.x, 0, geom.w, bkH);

      // Draw track color overlay
      if (alpha > 0) {
        let color = NOTE_COLORS[trackIdx % NOTE_COLORS.length];
        if (active) color = shadeColor(color, -20);
        const rgb = hexToRgb(color);
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        ctx.fillRect(SIDEBAR_WIDTH + geom.x, 0, geom.w, bkH);
      }

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(SIDEBAR_WIDTH + geom.x, 0, geom.w, bkH);

      if (showFingers && active && geom.w >= 8) {
        const n = activeNote.get(midi);
        if (n?.finger) {
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${Math.min(geom.w * 0.7, height * 0.35, 11)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(n.finger), SIDEBAR_WIDTH + geom.x + geom.w / 2, bkH * 0.38);
        }
      }
    }
  }, [notes, transpose, currentTime, showFingers]);

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
