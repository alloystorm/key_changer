import { useRef, useEffect, useCallback } from 'react';
import type { NoteEvent } from '../lib/types';
import {
  SIDEBAR_WIDTH,
  MIDI_LOW,
  MIDI_HIGH,
  NOTE_COLORS,
  buildKeyGeometryForRange,
  hexToRgb,
  type KeyGeom,
} from '../lib/layout';

import './ParticleOverlay.css';

// ── Physics constants ─────────────────────────────────────────────────────────
/** Downward gravitational acceleration in px/s² */
const GRAVITY = 65;
const MAX_PARTICLES = 700;

/**
 * 2D spatially-coherent flow field via layered waves (pseudo-Perlin).
 * Returns [fx, fy] in px/s — the ambient "wind" velocity at a point.
 *
 * Two frequency layers with different spatial & temporal scales produce
 * coherent, slowly-drifting turbulence without external dependencies.
 */
function flowField(x: number, y: number, t: number): [number, number] {
  const s = 0.003;
  const fx =
    Math.sin(x * s * 1.7 + y * s * 0.6 + t * 1.4) * 75 +
    Math.sin(x * s * 0.5 - y * s * 1.4 + t * 0.7) * 38 +
    Math.sin(x * s * 3.1 + y * s * 2.3 + t * 2.1) * 18;
  const fy =
    Math.cos(x * s * 0.9 + y * s * 1.5 + t * 1.1) * 55 +
    Math.cos(x * s * 1.3 - y * s * 0.4 + t * 1.7) * 28 +
    Math.cos(x * s * 2.7 - y * s * 1.8 + t * 2.5) * 14;
  return [fx, fy];
}

// ── Particle data ─────────────────────────────────────────────────────────────
type ParticleType = 'spark' | 'ember' | 'smoke';

interface Particle {
  type: ParticleType;
  x: number;
  y: number;
  /** Velocity in px/s */
  vx: number;
  vy: number;
  /** Elapsed age in seconds */
  age: number;
  /** Total lifespan in seconds */
  lifetime: number;
  /** Pre-parsed RGB components for fast rgba() strings */
  r: number;
  g: number;
  b: number;
  /** Base visual radius in px */
  size: number;
  /**
   * Linear drag coefficient (s⁻¹).
   * Deceleration = drag * velocity → terminal velocity = flow / drag.
   */
  drag: number;
  /**
   * Fraction of GRAVITY this particle feels.
   * sparks ≈ 1, embers ≈ 0.25, smoke ≈ 0 (near-neutral buoyancy).
   */
  gravityScale: number;
  /**
   * Sensitivity to the ambient flow field.
   * 0 = unaffected, 1 = fully carried by the wind.
   */
  turbFactor: number;
}

function r(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/**
 * All spawn functions now take (xLeft, xRight) so particles spread across the
 * full key width instead of emanating from a single centre point.
 */

function makeSpark(xLeft: number, xRight: number, y: number, ri: number, gi: number, bi: number): Particle {
  const angle = r(-Math.PI * 0.85, -Math.PI * 0.15);
  const speed = r(240, 580);
  return {
    type: 'spark',
    x: r(xLeft, xRight),
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    age: 0,
    lifetime: r(0.12, 1.0),
    r: ri, g: gi, b: bi,
    size: r(1.0, 2.2),
    drag: r(0.6, 1.2),      // lower drag → travels further before stopping
    gravityScale: r(0.8, 1.2),
    turbFactor: r(0.02, 0.08),
  };
}

function makeEmber(xLeft: number, xRight: number, y: number, ri: number, gi: number, bi: number): Particle {
  const angle = r(-Math.PI * 0.82, -Math.PI * 0.18);
  const speed = r(30, 110);
  return {
    type: 'ember',
    x: r(xLeft, xRight),
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 50,
    age: 0,
    lifetime: r(0.4, 2.8),
    r: ri, g: gi, b: bi,
    size: r(2.0, 4.5),
    drag: r(0.3, 0.6),
    gravityScale: r(-0.45, -0.10), // buoyancy: hot embers rise
    turbFactor: r(0.50, 0.90),
  };
}

function makeSmoke(xLeft: number, xRight: number, y: number, ri: number, gi: number, bi: number): Particle {
  return {
    type: 'smoke',
    x: r(xLeft, xRight),
    y,
    vx: r(-22, 22),
    vy: r(-45, -10),
    age: 0,
    lifetime: r(0.8, 4.5),
    r: Math.min(255, ri + 60),
    g: Math.min(255, gi + 55),
    b: Math.min(255, bi + 55),
    size: r(12, 28),
    drag: r(1.0, 1.8),
    gravityScale: r(-0.18, -0.04), // slight buoyancy, turbulence-dominated
    turbFactor: r(0.70, 1.10),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  notes: NoteEvent[];
  transpose: number;
  currentTime: number;
  keyboardRef: React.RefObject<HTMLDivElement>;
  enabled: boolean;
  keyRange?: { low: number; high: number };
}

export function ParticleOverlay({ notes, transpose, currentTime, keyboardRef, enabled, keyRange }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lastTimeRef  = useRef(currentTime);
  const keyGeomRef   = useRef<Map<number, KeyGeom>>(new Map());
  const geomStateRef = useRef({ rollWidth: 0, low: MIDI_LOW, high: MIDI_HIGH });
  const sizeRef      = useRef({ width: 0, height: 0 });
  /** Wall-clock timestamp of the previous animation frame (ms) */
  const lastFrameMs  = useRef(performance.now());
  /** Monotonically increasing simulation time (s) for the flow field */
  const simTime      = useRef(0);

  // ── Spawn helpers ───────────────────────────────────────────────────────────
  const burst = useCallback((xLeft: number, xRight: number, cy: number, track: number) => {
    const hex = NOTE_COLORS[track % NOTE_COLORS.length];
    const { r: ri, g: gi, b: bi } = hexToRgb(hex);
    const ps = particlesRef.current;

    const room = MAX_PARTICLES - ps.length;
    if (room <= 0) return;

    const nSparks = Math.min(Math.floor(r(4, 8)), room);
    for (let i = 0; i < nSparks; i++) ps.push(makeSpark(xLeft, xRight, cy, ri, gi, bi));

    const nEmbers = Math.min(Math.floor(r(2, 5)), room - nSparks);
    for (let i = 0; i < nEmbers; i++) ps.push(makeEmber(xLeft, xRight, cy, ri, gi, bi));

    const nSmoke = Math.min(Math.floor(r(2, 4)), room - nSparks - nEmbers);
    for (let i = 0; i < nSmoke; i++) ps.push(makeSmoke(xLeft, xRight, cy, ri, gi, bi));
  }, []);

  const trickle = useCallback((xLeft: number, xRight: number, cy: number, track: number) => {
    if (particlesRef.current.length >= MAX_PARTICLES) return;
    const hex = NOTE_COLORS[track % NOTE_COLORS.length];
    const { r: ri, g: gi, b: bi } = hexToRgb(hex);
    if (Math.random() < 0.1) particlesRef.current.push(makeEmber(xLeft, xRight, cy, ri, gi, bi));
    if (Math.random() < 0.08) particlesRef.current.push(makeSmoke(xLeft, xRight, cy, ri, gi, bi));
  }, []);

  // ── Physics + render ────────────────────────────────────────────────────────
  const updateAndDraw = useCallback((nowMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Real elapsed time, capped at 50 ms to absorb tab-hidden jumps
    const dt = Math.min((nowMs - lastFrameMs.current) / 1000, 0.05);
    lastFrameMs.current = nowMs;
    simTime.current += dt;
    const t = simTime.current;

    const { width, height } = sizeRef.current;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const ps = particlesRef.current;

    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;

      if (p.age >= p.lifetime || p.y < -150) {
        ps.splice(i, 1);
        continue;
      }

      // ── Physics integration (semi-implicit Euler) ─────────────────────────
      // Flow field gives ambient "wind" in px/s
      const [fx, fy] = flowField(p.x, p.y, t);

      // Linear drag: deceleration ∝ velocity (Stokes drag for small particles)
      // Turbulence: particle is nudged toward the local flow velocity
      p.vx += (-p.drag * p.vx + fx * p.turbFactor) * dt;
      // Gravity is additive (positive = downward in canvas coords)
      p.vy += (-p.drag * p.vy + fy * p.turbFactor + GRAVITY * p.gravityScale) * dt;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const life = 1 - p.age / p.lifetime; // 1 = fresh, 0 = dead

      // ── Rendering ─────────────────────────────────────────────────────────
      if (p.type === 'spark') {
        // Motion-blur streak along velocity direction
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const len = Math.max(speed * dt * 7, 2.5);
        const nx = speed > 0.1 ? p.vx / speed : 0;
        const ny = speed > 0.1 ? p.vy / speed : 1;
        const alpha = Math.pow(life, 0.45) * 0.92;

        ctx.globalAlpha = alpha * 0.5;
        ctx.strokeStyle = `rgba(${p.r},${p.g},${p.b},1)`;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - nx * len * 0.55, p.y - ny * len * 0.55);
        ctx.lineTo(p.x + nx * len * 0.45, p.y + ny * len * 0.45);
        ctx.stroke();

        // White-hot leading tip
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = alpha * 0.25;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.55, 0, Math.PI * 2);
        ctx.fill();

      } else if (p.type === 'ember') {
        // Radial gradient: white-hot core → colored glow → transparent
        const alpha = Math.pow(life, 0.55);
        const radius = p.size * (0.55 + 0.45 * life);
        const glow = radius * 3.5;

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
        grad.addColorStop(0,    `rgba(255,255,240,${(alpha * 0.95).toFixed(3)})`);
        grad.addColorStop(0.22, `rgba(${p.r},${p.g},${p.b},${(alpha * 0.85).toFixed(3)})`);
        grad.addColorStop(1,    `rgba(${p.r},${p.g},${p.b},0)`);

        ctx.globalAlpha = 1;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
        ctx.fill();

      } else {
        // Smoke puff: fades in over 0.2 s then out; expands as it rises
        const fadeIn = Math.min(p.age / 0.2, 1);
        const alpha = fadeIn * Math.pow(life, 1.6) * 0.13;
        const radius = p.size * (1 + (1 - life) * 0.9);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},1)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }, []);

  // ── Animation loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    let frameId: number;
    const loop = (nowMs: number) => {
      if (!enabled) {
        // Clear canvas and drain particles when disabled
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
        particlesRef.current = [];
        frameId = requestAnimationFrame(loop);
        return;
      }
      updateAndDraw(nowMs);
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [updateAndDraw, enabled]);

  // ── Resize observer ─────────────────────────────────────────────────────────
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

  // ── Note hit & sustain detection ────────────────────────────────────────────
  useEffect(() => {
    const keyboardEl  = keyboardRef.current;
    const containerEl = containerRef.current;
    if (!enabled || !keyboardEl || !containerEl) return;

    const parentRect   = containerEl.getBoundingClientRect();
    const keyboardRect = keyboardEl.getBoundingClientRect();
    const hitY  = keyboardRect.top  - parentRect.top;
    const hitX  = keyboardRect.left - parentRect.left;
    const rollWidth = keyboardRect.width - SIDEBAR_WIDTH;
    const rangeLow  = keyRange?.low  ?? MIDI_LOW;
    const rangeHigh = keyRange?.high ?? MIDI_HIGH;

    // Rebuild key geometry when width or range changes
    const prev = geomStateRef.current;
    if (
      Math.abs(prev.rollWidth - rollWidth) > 0.5 ||
      prev.low !== rangeLow ||
      prev.high !== rangeHigh
    ) {
      keyGeomRef.current = buildKeyGeometryForRange(rollWidth, rangeLow, rangeHigh);
      geomStateRef.current = { rollWidth, low: rangeLow, high: rangeHigh };
    }
    const keyGeom = keyGeomRef.current;

    notes.forEach((note) => {
      const isActive = note.startTime <= currentTime && note.startTime + note.duration >= currentTime;
      if (!isActive) return;

      const pitch = note.pitch + transpose;
      if (pitch < rangeLow || pitch > rangeHigh) return;
      const geom  = keyGeom.get(pitch);
      if (!geom) return;

      const xLeft  = hitX + SIDEBAR_WIDTH + geom.x;
      const xRight = xLeft + geom.w;
      const cy = hitY;

      const isJustStarted = note.startTime >= lastTimeRef.current && note.startTime < currentTime;
      if (isJustStarted) {
        burst(xLeft, xRight, cy, note.track);
      } else {
        trickle(xLeft, xRight, cy, note.track);
      }
    });

    lastTimeRef.current = currentTime;
  }, [notes, currentTime, transpose, keyboardRef, burst, trickle, enabled, keyRange]);

  return (
    <div ref={containerRef} className="particle-overlay">
      <canvas ref={canvasRef} className="particle-canvas" />
    </div>
  );
}
