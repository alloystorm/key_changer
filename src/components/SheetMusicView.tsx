import { useRef, useEffect, useCallback } from 'react';
import type { NoteEvent } from '../lib/types';
import './SheetMusicView.css';

// ─── Layout constants ─────────────────────────────────────────────────────────
const VISIBLE_SECONDS = 5;       // seconds of music visible at once
const PLAY_LINE_X_RATIO = 0.22;    // play line at 22% from left edge
const HALF_SPACE = 7;       // px per diatonic step (half a staff space)
const LINE_SPACING = 14;      // px between adjacent staff lines

const CLEF_AREA_WIDTH = 60;      // left area reserved for clef symbol
const NOTE_RX = 8;       // note head horizontal radius
const NOTE_RY = 5.5;     // note head vertical radius
const LEDGER_HALF_W = 12;      // half-width of a ledger line
const STEM_LENGTH = 7 * HALF_SPACE; // standard stem = 3.5 staff spaces (49px)
const STEM_LW = 1.5;            // stem stroke width
const FLAG_LW = 1.5;            // flag stroke width

// Base span from Treble Top Line (E5) to Bass Bottom Line (G2)
// Treble: 0 to 4 spaces, Bass: staves_gap + 4 spaces
// We want to center this 172px span (at scale=1) in the viewport.
const STAFF_SPAN_BASE = 172;
const BASE_STAVES_GAP = 60;

// Pitch helpers
const SEMITONE_TO_DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const;
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

const TREBLE_BOTTOM_DIATONIC = 30;
const BASS_BOTTOM_DIATONIC = 18;

const NOTE_COLORS = [
  '#7c6af7', '#f77c6a', '#6af7b8', '#f7e96a',
  '#6ab4f7', '#f76ac8', '#aef76a',
];

const BG_COLOR = '#1a1a2e';
const STAFF_COLOR = '#4a4a6a';
const LEDGER_COLOR = '#8888aa';
const PLAYLINE_COLOR = 'rgba(255,255,255,0.65)';
const CLEF_COLOR = '#c0c0e0';
const ACCY_COLOR = '#aaaacc';
const ACCY_ACTIVE = '#ffffff';

const SNAP_VALUES = [4, 2, 1, 0.5, 0.25, 0.125] as const;

function snapBeats(raw: number): number {
  return SNAP_VALUES.reduce((best, v) =>
    Math.abs(v - raw) < Math.abs(best - raw) ? v : best
  );
}

function midiToDiatonicPos(midi: number): number {
  const semitone = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return octave * 7 + SEMITONE_TO_DIATONIC[semitone];
}

interface NoteInfo {
  stave: 'treble' | 'bass';
  slot: number;
  isSharp: boolean;
}

function getNoteInfo(pitch: number): NoteInfo {
  const stave: 'treble' | 'bass' = pitch >= 60 ? 'treble' : 'bass';
  const diatonic = midiToDiatonicPos(pitch);
  const slot = stave === 'treble'
    ? diatonic - TREBLE_BOTTOM_DIATONIC
    : diatonic - BASS_BOTTOM_DIATONIC;
  return { stave, slot, isSharp: BLACK_KEYS.has(pitch % 12) };
}

interface Props {
  notes: NoteEvent[];
  bpm: number;
  transpose: number;
  currentTime: number;
  totalDuration: number;
  isPlaying: boolean;
  onSeek: (t: number) => void;
}

export function SheetMusicView({ notes, bpm, transpose, currentTime, totalDuration, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const propsRef = useRef({ notes, bpm, transpose, currentTime });

  useEffect(() => {
    propsRef.current = { notes, bpm, transpose, currentTime };
  }, [notes, bpm, transpose, currentTime]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { animRef.current = requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { animRef.current = requestAnimationFrame(draw); return; }

    const { notes: n, bpm: songBpm, transpose: tp, currentTime: ct } = propsRef.current;
    const W = canvas.width;
    const H = canvas.height;

    // SCALE CALCULATION
    // We want the staves and clear headroom for ledger lines to fit.
    // A base height of 300px is a good "natural" size for the staves + headroom.
    const naturalHeight = 300;
    let scale = H / naturalHeight;

    // Clamp scale to keep it within reasonable bounds
    scale = Math.max(0.4, Math.min(2.0, scale));

    // To center the staves vertically:
    // Base staff span is Treble Top to Bass Bottom = 172px.
    const staffCenterBase = 186; // Midpoint between E5 and G2
    const trebleTopLineY = (H / 2) - (staffCenterBase - 100) * scale;

    const lineSpacing = LINE_SPACING * scale;
    const stavesGap = BASE_STAVES_GAP * scale;
    const halfSpace = HALF_SPACE * scale;

    const trebleBottomLineY = trebleTopLineY + 4 * lineSpacing;
    const bassTopLineY = trebleBottomLineY + stavesGap;

    // HORIZONTAL SCALING
    // Link horizontal spacing to the vertical scale factor instead of width.
    // This maintains the notation's aspect ratio.
    const pxPerSec = 160 * scale;

    // Keep play line at a fixed distance from the left edge, scaled
    const playLineX = CLEF_AREA_WIDTH + (50 * scale);

    const slotToY = (stave: 'treble' | 'bass', slot: number) => {
      const topY = stave === 'treble' ? trebleTopLineY : bassTopLineY;
      return topY + (8 - slot) * halfSpace;
    };

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = STAFF_COLOR;
    ctx.lineWidth = Math.max(1, scale);
    for (let i = 0; i < 5; i++) {
      const ty = Math.round(trebleTopLineY + i * lineSpacing) + 0.5;
      const by = Math.round(bassTopLineY + i * lineSpacing) + 0.5;
      ctx.beginPath(); ctx.moveTo(CLEF_AREA_WIDTH, ty); ctx.lineTo(W, ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(CLEF_AREA_WIDTH, by); ctx.lineTo(W, by); ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(CLEF_AREA_WIDTH + 0.5, trebleTopLineY);
    ctx.lineTo(CLEF_AREA_WIDTH + 0.5, bassTopLineY + 4 * lineSpacing);
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([6 * scale, 4 * scale]);
    ctx.strokeStyle = PLAYLINE_COLOR;
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.moveTo(playLineX, trebleTopLineY - 30 * scale);
    ctx.lineTo(playLineX, bassTopLineY + 4 * lineSpacing + 30 * scale);
    ctx.stroke();
    ctx.restore();

    for (const note of n) {
      const pitch = note.pitch + tp;
      if (pitch < 21 || pitch > 108) continue;
      const x = playLineX + (note.startTime - ct) * pxPerSec;
      if (x < CLEF_AREA_WIDTH - NOTE_RX - 20 || x > W + NOTE_RX + 20) continue;

      const { stave, slot, isSharp } = getNoteInfo(pitch);
      const y = slotToY(stave, slot);
      const color = NOTE_COLORS[note.track % NOTE_COLORS.length];
      const isActive = note.startTime <= ct && ct < note.startTime + note.duration;

      ctx.strokeStyle = LEDGER_COLOR;
      ctx.lineWidth = Math.max(1, scale);
      const ledgerH = LEDGER_HALF_W * scale;
      if (slot <= -2) {
        const lowest = slot % 2 === 0 ? slot : slot - 1;
        for (let s = -2; s >= lowest; s -= 2) {
          const ly = slotToY(stave, s);
          ctx.beginPath(); ctx.moveTo(x - ledgerH, ly); ctx.lineTo(x + ledgerH, ly); ctx.stroke();
        }
      } else if (slot >= 10) {
        const highest = slot % 2 === 0 ? slot : slot + 1;
        for (let s = 10; s <= highest; s += 2) {
          const ly = slotToY(stave, s);
          ctx.beginPath(); ctx.moveTo(x - ledgerH, ly); ctx.lineTo(x + ledgerH, ly); ctx.stroke();
        }
      }

      if (isSharp) {
        ctx.fillStyle = isActive ? ACCY_ACTIVE : ACCY_COLOR;
        ctx.font = `bold ${11 * scale}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('#', x - NOTE_RX * scale - 2 * scale, y);
      }

      const beats = snapBeats(note.duration * (songBpm / 60));
      const filled = beats < 2.0;
      const hasStem = beats < 4.0;
      const numFlags = beats <= 0.125 ? 3 : beats <= 0.25 ? 2 : beats <= 0.5 ? 1 : 0;

      const stemLength = STEM_LENGTH * scale;
      const noteRx = NOTE_RX * scale;
      const noteRy = NOTE_RY * scale;

      const stemUp = slot <= 4;
      const stemX = stemUp ? x + noteRx * 0.85 : x - noteRx * 0.85;
      const stemFree = stemUp ? y - stemLength : y + stemLength;

      if (hasStem) {
        ctx.save();
        ctx.strokeStyle = isActive ? 'rgba(255,255,255,0.75)' : color;
        ctx.lineWidth = STEM_LW * scale;
        ctx.beginPath();
        ctx.moveTo(stemX, stemUp ? y - noteRy * 0.5 : y + noteRy * 0.5);
        ctx.lineTo(stemX, stemFree);
        ctx.stroke();

        ctx.lineWidth = FLAG_LW * scale;
        for (let f = 0; f < numFlags; f++) {
          const fy = stemUp ? stemFree + f * halfSpace * 1.8 : stemFree - f * halfSpace * 1.8;
          ctx.beginPath();
          if (stemUp) {
            ctx.moveTo(stemX, fy);
            ctx.bezierCurveTo(stemX + noteRx * 2.2, fy + halfSpace * 1.2, stemX + noteRx * 1.8, fy + halfSpace * 2.8, stemX, fy + halfSpace * 3.6);
          } else {
            ctx.moveTo(stemX, fy);
            ctx.bezierCurveTo(stemX + noteRx * 2.2, fy - halfSpace * 1.2, stemX + noteRx * 1.8, fy - halfSpace * 2.8, stemX, fy - halfSpace * 3.6);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      const noteColor = isActive ? '#ffffff' : color;
      if (isActive) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12 * scale;
      }
      ctx.strokeStyle = noteColor;
      ctx.fillStyle = noteColor;
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.ellipse(x, y, noteRx, noteRy, -0.35, 0, Math.PI * 2);
      if (filled) {
        ctx.fill();
      } else {
        ctx.fillStyle = BG_COLOR;
        ctx.fill();
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, CLEF_AREA_WIDTH, H);
    ctx.strokeStyle = STAFF_COLOR;
    ctx.lineWidth = Math.max(1, scale);
    for (let i = 0; i < 5; i++) {
      const ty = Math.round(trebleTopLineY + i * lineSpacing) + 0.5;
      const by = Math.round(bassTopLineY + i * lineSpacing) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(CLEF_AREA_WIDTH, ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(CLEF_AREA_WIDTH, by); ctx.stroke();
    }

    ctx.fillStyle = CLEF_COLOR;
    ctx.textAlign = 'center';
    ctx.font = `${60 * scale}px serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('\uD834\uDD1E', CLEF_AREA_WIDTH / 2, trebleBottomLineY + 8 * scale);

    ctx.font = `${36 * scale}px serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('\uD834\uDD22', CLEF_AREA_WIDTH / 2, slotToY('bass', 6) + 4 * scale);

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return (
    <div
      className="sheet-music-view"
      onMouseDown={(e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const H = canvas.height;
        const naturalHeight = 300;
        let scale = H / naturalHeight;
        scale = Math.max(0.4, Math.min(2.0, scale));

        const pxPerSec = 160 * scale;
        const playLineX = CLEF_AREA_WIDTH + (50 * scale);

        const rect = canvas.getBoundingClientRect();
        const dragStartX = e.clientX - rect.left;
        const initialTime = currentTime;

        const handleMouseMove = (moveEvent: React.MouseEvent | MouseEvent) => {
          const mouseX = moveEvent.clientX - rect.left;
          const targetTime = initialTime - (mouseX - dragStartX) / pxPerSec;
          const clamped = Math.max(0, Math.min(targetTime, totalDuration));
          onSeek(clamped);
        };

        const handleMouseUp = () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
        };

        // Initial seek on click
        handleMouseMove(e as unknown as MouseEvent);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      }}
      style={{ cursor: 'crosshair' }}
    >
      <canvas ref={canvasRef} className="sheet-canvas" />
    </div>
  );
}
