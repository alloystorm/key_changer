import { useRef, useEffect, useCallback } from 'react';
import type { NoteEvent } from '../lib/types';
import { 
  SIDEBAR_WIDTH, 
  MIDI_LOW, 
  MIDI_HIGH, 
  NOTE_COLORS, 
  buildKeyGeometry, 
  type KeyGeom 
} from '../lib/layout';

import './GlowOverlay.css';

interface Props {
  notes: NoteEvent[];
  transpose: number;
  currentTime: number;
  keyboardRef: React.RefObject<HTMLDivElement>;
}

export function GlowOverlay({ notes, transpose, currentTime, keyboardRef }: Props) {
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

    // Find the seam (hitting point) relative to this overlay
    const keyboardEl = keyboardRef.current;
    if (!keyboardEl) return;
    const parentRect = containerRef.current?.getBoundingClientRect();
    const keyboardRect = keyboardEl.getBoundingClientRect();
    if (!parentRect) return;

    const hitY = keyboardRect.top - parentRect.top;
    const hitX = keyboardRect.left - parentRect.left;

    const rollWidth = keyboardRect.width - SIDEBAR_WIDTH;

    // Rebuild geometry if needed
    const existingWkW = keyGeomRef.current.size > 0
      ? (keyGeomRef.current.get(MIDI_LOW + 2)?.w ?? 0) + 1
      : 0;
    const expectedWkW = rollWidth / 52;
    if (Math.abs(existingWkW - expectedWkW) > 0.5) {
      keyGeomRef.current = buildKeyGeometry(rollWidth);
    }
    const keyGeom = keyGeomRef.current;

    // Find active notes
    const activeTracks = new Map<number, number>();
    notes.forEach((note) => {
      const isCurrentlyActive = note.startTime <= currentTime && note.startTime + note.duration >= currentTime;
      if (isCurrentlyActive) {
        const pitch = Math.max(MIDI_LOW, Math.min(MIDI_HIGH, note.pitch + transpose));
        activeTracks.set(pitch, note.track);
      }
    });

    ctx.clearRect(0, 0, width, height);

    // Helper: draw a capsule with TOTAL width w and height h
    const drawCapsulePath = (x: number, y: number, totalW: number, h: number) => {
      const r = h / 2;
      const innerW = Math.max(0, totalW - h); // width of the central rectangle
      ctx.beginPath();
      ctx.arc(x - innerW / 2, y, r, Math.PI / 2, Math.PI * 1.5);
      ctx.lineTo(x + innerW / 2, y - r);
      ctx.arc(x + innerW / 2, y, r, Math.PI * 1.5, Math.PI / 2);
      ctx.lineTo(x - innerW / 2, y + r);
      ctx.closePath();
    };

    // Draw glows for active tracks
    activeTracks.forEach((trackIdx, pitch) => {
      const geom = keyGeom.get(pitch);
      if (!geom) return;

      const cx = hitX + SIDEBAR_WIDTH + geom.x + geom.w / 2;
      const cy = hitY - 4; // Hitting point at the keyboard top edge

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // 1. Outer Soft Glow (Capsule)
      const glowH = 24; 
      const glowTotalW = geom.w + 12; // slightly wider than key
      
      const gradient = ctx.createLinearGradient(cx, cy - glowH / 2, cx, cy + glowH / 2);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      
      ctx.fillStyle = gradient;
      drawCapsulePath(cx, cy, glowTotalW, glowH);
      ctx.fill();

      // 2. Inner Bright Spark (Capsule)
      const sparkH = 8;
      const sparkTotalW = geom.w + 4; // match key width exactly
      
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.8;
      drawCapsulePath(cx, cy, sparkTotalW, sparkH);
      ctx.fill();

      ctx.restore();
    });
  }, [notes, transpose, currentTime]);

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
    <div ref={containerRef} className="glow-overlay">
      <canvas ref={canvasRef} className="glow-canvas" />
    </div>
  );
}
