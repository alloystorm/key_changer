import { useRef, useEffect, useCallback } from 'react';
import type { NoteEvent } from '../lib/types';
import './SheetMusicView.css';

// ─── Layout constants ─────────────────────────────────────────────────────────
const VISIBLE_SECONDS       = 5;       // seconds of music visible at once
const PLAY_LINE_X_RATIO     = 0.22;    // play line at 22% from left edge
const HALF_SPACE            = 7;       // px per diatonic step (half a staff space)
const LINE_SPACING          = 14;      // px between adjacent staff lines

const CLEF_AREA_WIDTH       = 60;      // left area reserved for clef symbol
const NOTE_RX               = 8;       // note head horizontal radius
const NOTE_RY               = 5.5;     // note head vertical radius
const LEDGER_HALF_W         = 12;      // half-width of a ledger line

// Staff top-line Y positions (measured from canvas top)
const TREBLE_TOP_LINE_Y     = 100;     // extra headroom for high ledger-line notes
const STAVES_GAP            = 60;      // px between treble bottom and bass top lines
const TREBLE_BOTTOM_LINE_Y  = TREBLE_TOP_LINE_Y + 4 * LINE_SPACING;   // 156
const BASS_TOP_LINE_Y       = TREBLE_BOTTOM_LINE_Y + STAVES_GAP;      // 216
const CANVAS_HEIGHT         = BASS_TOP_LINE_Y + 4 * LINE_SPACING + 110; // 382

// Pitch helpers
// Semitone → diatonic step in octave (sharps mapped to natural below: C#→C=0, D#→D=1, …)
const SEMITONE_TO_DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const;
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

// Diatonic position of each clef's bottom staff line:
//   Treble bottom = E4 → octave 4, diatonic step 2 → pos = 4*7+2 = 30
//   Bass   bottom = G2 → octave 2, diatonic step 4 → pos = 2*7+4 = 18
const TREBLE_BOTTOM_DIATONIC = 30;
const BASS_BOTTOM_DIATONIC   = 18;

// Note/track colours (matches PianoRollView palette)
const NOTE_COLORS = [
  '#7c6af7', '#f77c6a', '#6af7b8', '#f7e96a',
  '#6ab4f7', '#f76ac8', '#aef76a',
];

const BG_COLOR       = '#1a1a2e';
const STAFF_COLOR    = '#4a4a6a';
const LEDGER_COLOR   = '#8888aa';
const PLAYLINE_COLOR = 'rgba(255,255,255,0.65)';
const CLEF_COLOR     = '#c0c0e0';
const ACCY_COLOR     = '#aaaacc';
const ACCY_ACTIVE    = '#ffffff';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** MIDI pitch → diatonic position (C0=0, D0=1, … C4=28, E4=30, …) */
function midiToDiatonicPos(midi: number): number {
  const semitone = midi % 12;
  const octave   = Math.floor(midi / 12) - 1;  // MIDI: C4=60 → octave 4
  return octave * 7 + SEMITONE_TO_DIATONIC[semitone];
}

interface NoteInfo {
  stave: 'treble' | 'bass';
  /** 0 = bottom staff line, 8 = top staff line; outside range = ledger territory */
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

/** Pixel Y for a given stave + diatonic slot */
function slotY(stave: 'treble' | 'bass', slot: number): number {
  const topY = stave === 'treble' ? TREBLE_TOP_LINE_Y : BASS_TOP_LINE_Y;
  // slot 8 → topY (top line), slot 0 → topY + 4*LINE_SPACING (bottom line)
  return topY + (8 - slot) * HALF_SPACE;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  notes: NoteEvent[];
  transpose: number;
  currentTime: number;
  isPlaying: boolean;
}

export function SheetMusicView({ notes, transpose, currentTime }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  // Hold latest props in a ref so the RAF loop never captures stale closures
  const propsRef  = useRef({ notes, transpose, currentTime });

  useEffect(() => {
    propsRef.current = { notes, transpose, currentTime };
  });

  // ── Canvas resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth  || 800;
      canvas.height = CANVAS_HEIGHT;
    });
    ro.observe(canvas);
    canvas.width  = canvas.offsetWidth  || 800;
    canvas.height = CANVAS_HEIGHT;
    return () => ro.disconnect();
  }, []);

  // ── Draw loop ────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { animRef.current = requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx)   { animRef.current = requestAnimationFrame(draw); return; }

    const { notes: n, transpose: tp, currentTime: ct } = propsRef.current;
    const W          = canvas.width;
    const playLineX  = W * PLAY_LINE_X_RATIO;
    const pxPerSec   = W / VISIBLE_SECONDS;

    // ── Background ──────────────────────────────────────────────────────
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, CANVAS_HEIGHT);

    // ── Staff lines (treble + bass, drawn from clef area to right edge) ──
    ctx.strokeStyle = STAFF_COLOR;
    ctx.lineWidth   = 1;
    for (let i = 0; i < 5; i++) {
      const ty = Math.round(TREBLE_TOP_LINE_Y + i * LINE_SPACING) + 0.5;
      const by = Math.round(BASS_TOP_LINE_Y   + i * LINE_SPACING) + 0.5;
      ctx.beginPath(); ctx.moveTo(CLEF_AREA_WIDTH, ty); ctx.lineTo(W, ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(CLEF_AREA_WIDTH, by); ctx.lineTo(W, by); ctx.stroke();
    }
    // Vertical barline connecting both staves at left edge of staff area
    ctx.beginPath();
    ctx.moveTo(CLEF_AREA_WIDTH + 0.5, TREBLE_TOP_LINE_Y);
    ctx.lineTo(CLEF_AREA_WIDTH + 0.5, BASS_TOP_LINE_Y + 4 * LINE_SPACING);
    ctx.stroke();

    // ── Play line ────────────────────────────────────────────────────────
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = PLAYLINE_COLOR;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(playLineX, TREBLE_TOP_LINE_Y - 38);
    ctx.lineTo(playLineX, BASS_TOP_LINE_Y + 4 * LINE_SPACING + 38);
    ctx.stroke();
    ctx.restore();

    // ── Notes ────────────────────────────────────────────────────────────
    for (const note of n) {
      const pitch = note.pitch + tp;
      if (pitch < 21 || pitch > 108) continue;

      const x = playLineX + (note.startTime - ct) * pxPerSec;
      // Skip if off-screen (generous margin for ledger lines / accidentals)
      if (x < CLEF_AREA_WIDTH - NOTE_RX - 20 || x > W + NOTE_RX + 20) continue;

      const { stave, slot, isSharp } = getNoteInfo(pitch);
      const y        = slotY(stave, slot);
      const color    = NOTE_COLORS[note.track % NOTE_COLORS.length];
      const isActive = note.startTime <= ct && ct < note.startTime + note.duration;

      // ── Ledger lines ────────────────────────────────────────────────
      ctx.strokeStyle = LEDGER_COLOR;
      ctx.lineWidth   = 1;
      if (slot <= -2) {
        // Draw from -2 down to the deepest even slot at or above the note
        const lowest = slot % 2 === 0 ? slot : slot - 1;
        for (let s = -2; s >= lowest; s -= 2) {
          const ly = slotY(stave, s);
          ctx.beginPath();
          ctx.moveTo(x - LEDGER_HALF_W, ly);
          ctx.lineTo(x + LEDGER_HALF_W, ly);
          ctx.stroke();
        }
      } else if (slot >= 10) {
        const highest = slot % 2 === 0 ? slot : slot + 1;
        for (let s = 10; s <= highest; s += 2) {
          const ly = slotY(stave, s);
          ctx.beginPath();
          ctx.moveTo(x - LEDGER_HALF_W, ly);
          ctx.lineTo(x + LEDGER_HALF_W, ly);
          ctx.stroke();
        }
      }

      // ── Accidental ──────────────────────────────────────────────────
      if (isSharp) {
        ctx.fillStyle    = isActive ? ACCY_ACTIVE : ACCY_COLOR;
        ctx.font         = 'bold 11px sans-serif';
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('#', x - NOTE_RX - 2, y);
      }

      // ── Note head ───────────────────────────────────────────────────
      if (isActive) {
        ctx.shadowColor = color;
        ctx.shadowBlur  = 14;
        ctx.fillStyle   = '#ffffff';
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle  = color;
      }
      ctx.beginPath();
      ctx.ellipse(x, y, NOTE_RX, NOTE_RY, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // ── Clef overlay — mask notes that scroll behind the clef area ───────
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, CLEF_AREA_WIDTH, CANVAS_HEIGHT);

    // Redraw staff line stubs inside clef area
    ctx.strokeStyle = STAFF_COLOR;
    ctx.lineWidth   = 1;
    for (let i = 0; i < 5; i++) {
      const ty = Math.round(TREBLE_TOP_LINE_Y + i * LINE_SPACING) + 0.5;
      const by = Math.round(BASS_TOP_LINE_Y   + i * LINE_SPACING) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(CLEF_AREA_WIDTH, ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(CLEF_AREA_WIDTH, by); ctx.stroke();
    }

    // ── Clef glyphs ──────────────────────────────────────────────────────
    ctx.fillStyle    = CLEF_COLOR;
    ctx.textAlign    = 'center';

    // Treble clef 𝄞 — baseline near treble bottom line
    ctx.font         = '60px serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('\uD834\uDD1E', CLEF_AREA_WIDTH / 2, TREBLE_BOTTOM_LINE_Y + 8);

    // Bass clef 𝄢 — aligned to F3 line (4th line from bottom = slot 6)
    ctx.font         = '36px serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('\uD834\uDD22', CLEF_AREA_WIDTH / 2, slotY('bass', 6) + 4);

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return (
    <div className="sheet-music-view">
      <canvas ref={canvasRef} className="sheet-canvas" />
    </div>
  );
}
