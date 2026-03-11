import { useRef, useEffect, useCallback } from 'react';
import type { NoteEvent } from '../lib/types';
import './PianoRollView.css';

// ─── Layout constants ───────────────────────────────────────────────────────
const PIANO_KEY_WIDTH = 52;     // px — width of the piano keyboard on the left
const KEYBOARD_HEIGHT = 110;    // px — height of the piano keyboard at the bottom
const WHITE_KEY_COUNT = 52;     // keys C2 to C9 (MIDI 36–96 roughly)
const TOTAL_MIDI_NOTES = 88;    // A0 (21) to C8 (108)
const MIDI_LOW = 21;            // A0
const MIDI_HIGH = 108;          // C8
const VISIBLE_SECONDS = 4;      // how many seconds of music are visible in the roll
const NOTE_COLORS = [
  '#7c6af7', '#f77c6a', '#6af7b8', '#f7e96a',
  '#6ab4f7', '#f76ac8', '#aef76a',
];

const isBlackKey = (midi: number): boolean => {
  const mod = midi % 12;
  return [1, 3, 6, 8, 10].includes(mod);
};

interface Props {
  notes: NoteEvent[];
  transpose: number;
  currentTime: number;
  totalDuration: number;
}

export function PianoRollView({ notes, transpose, currentTime, totalDuration }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const rollHeight = height - KEYBOARD_HEIGHT;
    const rollWidth = width - PIANO_KEY_WIDTH;

    // ── Background ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, width, rollHeight);

    // ── Pitch lanes ─────────────────────────────────────────────────────────
    const noteRange = MIDI_HIGH - MIDI_LOW + 1;
    const laneH = rollHeight / noteRange;

    for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi++) {
      const y = rollHeight - (midi - MIDI_LOW + 1) * laneH;
      if (isBlackKey(midi)) {
        ctx.fillStyle = '#161616';
        ctx.fillRect(PIANO_KEY_WIDTH, y, rollWidth, laneH);
      }
      // Subtle octave lines
      if (midi % 12 === 0) {
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PIANO_KEY_WIDTH, y + laneH);
        ctx.lineTo(width, y + laneH);
        ctx.stroke();
      }
    }

    // Play line sits flush on the top edge of the keyboard
    const playLineY = rollHeight;

    // ── Notes ─────────────────────────────────────────────────────────────
    const pxPerSecond = rollHeight / VISIBLE_SECONDS;

    const activeKeys = new Set<number>();

    notes.forEach((note) => {
      const pitch = Math.max(MIDI_LOW, Math.min(MIDI_HIGH, note.pitch + transpose));
      const noteStart = note.startTime;
      const noteEnd = noteStart + note.duration;

      // Distance from current play position (seconds before playhead = positive)
      const secBeforePlayhead = noteStart - currentTime;
      const secBeforePlayheadEnd = noteEnd - currentTime;

      // y positions (notes fall downward — higher y = sooner)
      const yTop = playLineY - secBeforePlayheadEnd * pxPerSecond;
      const yBottom = playLineY - secBeforePlayhead * pxPerSecond;
      const noteHeight = Math.max(yBottom - yTop, 2);

      // Skip notes that are off-screen
      if (yBottom < 0 || yTop > rollHeight) return;

      // Track active keys (touching or crossing play line)
      if (yTop <= playLineY && yBottom >= playLineY) {
        activeKeys.add(pitch);
      }

      const x = PIANO_KEY_WIDTH + ((pitch - MIDI_LOW) / noteRange) * rollWidth;
      const noteWidth = Math.max((1 / noteRange) * rollWidth - 1, 2);

      const color = NOTE_COLORS[note.track % NOTE_COLORS.length];
      const alpha = yBottom < playLineY ? 0.5 : 1.0; // faded after playhead

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      // Rounded rect
      const radius = Math.min(noteWidth / 2, 3);
      ctx.beginPath();
      ctx.roundRect(x, yTop, noteWidth, noteHeight, radius);
      ctx.fill();

      // Bright top edge for active notes
      if (activeKeys.has(pitch)) {
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x, yTop, noteWidth, Math.min(2, noteHeight));
      }
      ctx.globalAlpha = 1;
    });

    // ── Piano keyboard ────────────────────────────────────────────────────
    // White keys
    let whiteKeyX = PIANO_KEY_WIDTH;
    const whiteKeyWidth = rollWidth / WHITE_KEY_COUNT;
    const whiteKeyH = KEYBOARD_HEIGHT - 1;

    // Collect white keys in order
    const whiteKeys: number[] = [];
    for (let m = MIDI_LOW; m <= MIDI_HIGH; m++) {
      if (!isBlackKey(m)) whiteKeys.push(m);
    }

    whiteKeys.forEach((midi, i) => {
      const x = PIANO_KEY_WIDTH + i * whiteKeyWidth;
      const isActive = activeKeys.has(midi);
      ctx.fillStyle = isActive
        ? NOTE_COLORS[(notes.find(n => n.pitch + transpose === midi)?.track ?? 0) % NOTE_COLORS.length]
        : '#f0f0f0';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.5;
      ctx.fillRect(x, rollHeight, whiteKeyWidth - 1, whiteKeyH);
      ctx.strokeRect(x, rollHeight, whiteKeyWidth - 1, whiteKeyH);
      // label C notes
      if (midi % 12 === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`C${Math.floor(midi / 12) - 1}`, x + whiteKeyWidth / 2, rollHeight + whiteKeyH - 4);
      }
      whiteKeyX += whiteKeyWidth;
    });

    // Black keys (drawn on top)
    const blackKeyWidth = whiteKeyWidth * 0.6;
    const blackKeyH = KEYBOARD_HEIGHT * 0.6;

    whiteKeys.forEach((midi, i) => {
      const x = PIANO_KEY_WIDTH + i * whiteKeyWidth;
      // Draw black key to the right of each white key that needs one
      const nextBlack = midi + 1;
      if (isBlackKey(nextBlack) && nextBlack <= MIDI_HIGH) {
        const bx = x + whiteKeyWidth - blackKeyWidth / 2;
        const isActive = activeKeys.has(nextBlack);
        ctx.fillStyle = isActive
          ? NOTE_COLORS[(notes.find(n => n.pitch + transpose === nextBlack)?.track ?? 0) % NOTE_COLORS.length]
          : '#1a1a1a';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 0.5;
        ctx.fillRect(bx, rollHeight, blackKeyWidth, blackKeyH);
        ctx.strokeRect(bx, rollHeight, blackKeyWidth, blackKeyH);
      }
    });

    // Left pitch sidebar background
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, PIANO_KEY_WIDTH, height);

    // Sidebar pitch labels
    ctx.fillStyle = '#555';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi += 12) {
      const y = rollHeight - (midi - MIDI_LOW) * laneH - laneH / 2;
      ctx.fillText(`C${Math.floor(midi / 12) - 1}`, PIANO_KEY_WIDTH - 4, y + 4);
    }

    // Bottom-left corner fill
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, rollHeight, PIANO_KEY_WIDTH, KEYBOARD_HEIGHT);
  }, [notes, transpose, currentTime]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { width, height };
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
        }
        draw();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // Redraw on every prop change
  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div ref={containerRef} className="piano-roll-view">
      <canvas ref={canvasRef} className="piano-roll-canvas" />
    </div>
  );
}
