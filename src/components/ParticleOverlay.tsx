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

import './ParticleOverlay.css';

interface Particle {
  x: number;
  y: number;
  initialX: number;
  vx: number;
  vy: number;
  life: number; // 0 to 1
  color: string;
  size: number;
  phase: number; // For wavy motion
  freq: number;  // frequency of weave
  amp: number;   // amplitude of weave
}

interface Props {
  notes: NoteEvent[];
  transpose: number;
  currentTime: number;
  keyboardRef: React.RefObject<HTMLDivElement>;
}

export function ParticleOverlay({ notes, transpose, currentTime, keyboardRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lastTimeRef = useRef(currentTime);
  const keyGeomRef = useRef<Map<number, KeyGeom>>(new Map());
  const sizeRef = useRef({ width: 0, height: 0 });

  const spawnParticles = useCallback((x: number, y: number, track: number, burst: boolean) => {
    const color = NOTE_COLORS[track % NOTE_COLORS.length];
    // Burst for hit, small amount for continuous
    const count = burst ? (15 + Math.random() * 10) : (1 + Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.4;
      const speed = 0.5 + Math.random() * 2;
      particlesRef.current.push({
        x,
        y,
        initialX: x,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        color,
        size: 1.5 + Math.random() * 2.5,
        phase: Math.random() * Math.PI * 2,
        freq: 0.05 + Math.random() * 0.1,
        amp: 0.5 + Math.random() * 1.5,
      });
    }
  }, []);

  const updateAndDraw = useCallback((dt: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const particles = particlesRef.current;
    // Cap particles for performance
    if (particles.length > 1000) {
      particles.splice(0, particles.length - 1000);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      
      // Update physics
      p.vy -= 0.03; // Buoyancy / rising force
      p.vx += (Math.random() - 0.5) * 0.1; // Slight air jitter
      
      p.x += p.vx;
      p.y += p.vy;
      
      // Wavy turbulence
      p.phase += p.freq;
      p.x += Math.sin(p.phase) * p.amp;

      p.life -= 0.012 * (0.8 + Math.random() * 0.4);
      
      if (p.life <= 0 || p.y < -50) {
        particles.splice(i, 1);
        continue;
      }

      const alpha = p.life * (0.6 + Math.random() * 0.4); // Flickering
      const drawSize = p.size * (0.8 + Math.sin(p.phase * 5) * 0.2); // Pulsing size

      ctx.beginPath();
      // Glow trail / body
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, drawSize * 3);
      grad.addColorStop(0, p.color);
      grad.addColorStop(1, 'transparent');
      
      ctx.fillStyle = grad;
      ctx.globalAlpha = alpha;
      ctx.arc(p.x, p.y, drawSize * 3, 0, Math.PI * 2);
      ctx.fill();

      // Sparkle core (ember)
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = alpha * 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, drawSize * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { width, height };
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = Math.round(width);
          canvas.height = Math.round(height);
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Frame loop
  useEffect(() => {
    let frameId: number;
    const loop = () => {
      updateAndDraw(16);
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [updateAndDraw]);

  // Note hit & sustain detection
  useEffect(() => {
    const keyboardEl = keyboardRef.current;
    const containerEl = containerRef.current;
    if (!keyboardEl || !containerEl) return;

    const parentRect = containerEl.getBoundingClientRect();
    const keyboardRect = keyboardEl.getBoundingClientRect();
    const hitY = keyboardRect.top - parentRect.top;
    const hitX = keyboardRect.left - parentRect.left;
    const rollWidth = keyboardRect.width - SIDEBAR_WIDTH;

    // Refresh geometry if width changed significantly
    const existingWkW = keyGeomRef.current.get(MIDI_LOW + 2)?.w ?? 0;
    const expectedWkW = rollWidth / 52;
    if (Math.abs(existingWkW - expectedWkW) > 0.5) {
      keyGeomRef.current = buildKeyGeometry(rollWidth);
    }
    const keyGeom = keyGeomRef.current;

    // Check for notes that are active
    notes.forEach(note => {
      const isCurrentlyActive = note.startTime <= currentTime && note.startTime + note.duration >= currentTime;
      if (!isCurrentlyActive) return;

      const pitch = Math.max(MIDI_LOW, Math.min(MIDI_HIGH, note.pitch + transpose));
      const geom = keyGeom.get(pitch);
      if (geom) {
        const cx = hitX + SIDEBAR_WIDTH + geom.x + geom.w / 2;
        const cy = hitY;

        const isJustStarted = note.startTime >= lastTimeRef.current && note.startTime < currentTime;
        spawnParticles(cx, cy, note.track, isJustStarted);
      }
    });

    lastTimeRef.current = currentTime;
  }, [notes, currentTime, transpose, keyboardRef, spawnParticles]);

  return (
    <div ref={containerRef} className="particle-overlay">
      <canvas ref={canvasRef} className="particle-canvas" />
    </div>
  );
}
