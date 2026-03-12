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
const STEM_LENGTH           = 7 * HALF_SPACE; // standard stem = 3.5 staff spaces (49px)
const STEM_LW               = 1.5;            // stem stroke width
const FLAG_LW               = 1.5;            // flag stroke width

// Staves geometry constants (will be multiplied by a scale factor)
const BASE_TREBLE_TOP_LINE_Y = 100;
const BASE_STAVES_GAP        = 60;
const BASE_CANVAS_HEIGHT     = 382; // Height on which constants are based

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

// Standard rhythmic values in quarter-note beats
const SNAP_VALUES = [4, 2, 1, 0.5, 0.25, 0.125] as const;

/** Round a raw beat duration to the nearest standard note value. */
function snapBeats(raw: number): number {
  return SNAP_VALUES.reduce((best, v) =>
    Math.abs(v - raw) < Math.abs(best - raw) ? v : best
  );
}

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

// ─── Component ────────────────────────────────────────────────────────────────


// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  notes: NoteEvent[];
  bpm: number;
  transpose: number;
  currentTime: number;
  isPlaying: boolean;
}

export function SheetMusicView({ notes, bpm, transpose, currentTime }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  // Hold latest props in a ref so the RAF loop never captures stale closures
  const propsRef  = useRef({ notes, bpm, transpose, currentTime });

  useEffect(() => {
    propsRef.current = { notes, bpm, transpose, currentTime };
  }, [notes, bpm, transpose, currentTime]);

  // ── Canvas resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width  = Math.round(width);
        canvas.height = Math.round(height);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Draw loop ────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { animRef.current = requestAnimationFrame(draw); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx)   { animRef.current = requestAnimationFrame(draw); return; }

    const { notes: n, bpm: songBpm, transpose: tp, currentTime: ct } = propsRef.current;
    const W          = canvas.width;
    const H          = canvas.height;
    
    // Calculate scale factor based on container height
    const scale      = H / BASE_CANVAS_HEIGHT;
    
    const playLineX  = W * PLAY_LINE_X_RATIO;
    const pxPerSec   = W / VISIBLE_SECONDS;

    // Responsive staff positions
    const trebleTopLineY = BASE_TREBLE_TOP_LINE_Y * scale;
    const stavesGap      = BASE_STAVES_GAP * scale;
    const lineSpacing    = LINE_SPACING * scale;
    const halfSpace      = HALF_SPACE * scale;
    
    const trebleBottomLineY = trebleTopLineY + 4 * lineSpacing;
    const bassTopLineY      = trebleBottomLineY + stavesGap;

    const slotToY = (stave: 'treble' | 'bass', slot: number) => {
      const topY = stave === 'treble' ? trebleTopLineY : bassTopLineY;
      return topY + (8 - slot) * halfSpace;
    };

    // ── Background ──────────────────────────────────────────────────────
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, H);

    // ── Staff lines (treble + bass, drawn from clef area to right edge) ──
    ctx.strokeStyle = STAFF_COLOR;
    ctx.lineWidth   = Math.max(1, scale);
    for (let i = 0; i < 5; i++) {
      const ty = Math.round(trebleTopLineY + i * lineSpacing) + 0.5;
      const by = Math.round(bassTopLineY   + i * lineSpacing) + 0.5;
      ctx.beginPath(); ctx.moveTo(CLEF_AREA_WIDTH, ty); ctx.lineTo(W, ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(CLEF_AREA_WIDTH, by); ctx.lineTo(W, by); ctx.stroke();
    }
    // Vertical barline
    ctx.beginPath();
    ctx.moveTo(CLEF_AREA_WIDTH + 0.5, trebleTopLineY);
    ctx.lineTo(CLEF_AREA_WIDTH + 0.5, bassTopLineY + 4 * lineSpacing);
    ctx.stroke();

    // ── Play line ────────────────────────────────────────────────────────
    ctx.save();
    ctx.setLineDash([6 * scale, 4 * scale]);
    ctx.strokeStyle = PLAYLINE_COLOR;
    ctx.lineWidth   = 1.5 * scale;
    ctx.beginPath();
    ctx.moveTo(playLineX, trebleTopLineY - 38 * scale);
    ctx.lineTo(playLineX, bassTopLineY + 4 * lineSpacing + 38 * scale);
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
      const y        = slotToY(stave, slot);
      const color    = NOTE_COLORS[note.track % NOTE_COLORS.length];
      const isActive = note.startTime <= ct && ct < note.startTime + note.duration;

      // ── Ledger lines ────────────────────────────────────────────────
      ctx.strokeStyle = LEDGER_COLOR;
      ctx.lineWidth   = Math.max(1, scale);
      const ledgerH   = LEDGER_HALF_W * scale;
      if (slot <= -2) {
        const lowest = slot % 2 === 0 ? slot : slot - 1;
        for (let s = -2; s >= lowest; s -= 2) {
          const ly = slotToY(stave, s);
          ctx.beginPath();
          ctx.moveTo(x - ledgerH, ly);
          ctx.lineTo(x + ledgerH, ly);
          ctx.stroke();
        }
      } else if (slot >= 10) {
        const highest = slot % 2 === 0 ? slot : slot + 1;
        for (let s = 10; s <= highest; s += 2) {
          const ly = slotToY(stave, s);
          ctx.beginPath();
          ctx.moveTo(x - ledgerH, ly);
          ctx.lineTo(x + ledgerH, ly);
          ctx.stroke();
        }
      }

      // ── Accidental ──────────────────────────────────────────────────
      if (isSharp) {
        ctx.fillStyle    = isActive ? ACCY_ACTIVE : ACCY_COLOR;
        ctx.font         = `bold ${11 * scale}px sans-serif`;
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('#', x - NOTE_RX * scale - 2 * scale, y);
      }

      // ── Duration ────────────────────────────────────────────────────
      const beats    = snapBeats(note.duration * (songBpm / 60));
      const filled   = beats < 2.0;       // half & whole = open/hollow
      const hasStem  = beats < 4.0;       // whole notes have no stem
      const numFlags = beats <= 0.125 ? 3 : beats <= 0.25 ? 2 : beats <= 0.5 ? 1 : 0;
      
      const stemLength = STEM_LENGTH * scale;
      const noteRx     = NOTE_RX * scale;
      const noteRy     = NOTE_RY * scale;

      const stemUp   = slot <= 4;
      const stemX    = stemUp ? x + noteRx * 0.85 : x - noteRx * 0.85;
      const stemFree = stemUp ? y - stemLength : y + stemLength;

      // ── Stem ────────────────────────────────────────────────────────
      if (hasStem) {
        ctx.save();
        ctx.strokeStyle = isActive ? 'rgba(255,255,255,0.75)' : color;
        ctx.lineWidth   = STEM_LW * scale;
        ctx.beginPath();
        ctx.moveTo(stemX, stemUp ? y - noteRy * 0.5 : y + noteRy * 0.5);
        ctx.lineTo(stemX, stemFree);
        ctx.stroke();

        // ── Flags ──────────────────────────────────────────────────────
        ctx.lineWidth = FLAG_LW * scale;
        for (let f = 0; f < numFlags; f++) {
          const fy = stemUp
            ? stemFree + f * halfSpace * 1.8
            : stemFree - f * halfSpace * 1.8;
          ctx.beginPath();
          if (stemUp) {
            // flag curves right-downward from stem tip
            ctx.moveTo(stemX, fy);
            ctx.bezierCurveTo(
              stemX + noteRx * 2.2, fy + halfSpace * 1.2,
              stemX + noteRx * 1.8, fy + halfSpace * 2.8,
              stemX,                 fy + halfSpace * 3.6,
            );
          } else {
            // flag curves right-upward from stem tip
            ctx.moveTo(stemX, fy);
            ctx.bezierCurveTo(
              stemX + noteRx * 2.2, fy - halfSpace * 1.2,
              stemX + noteRx * 1.8, fy - halfSpace * 2.8,
              stemX,                 fy - halfSpace * 3.6,
            );
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── Note head ───────────────────────────────────────────────────
      const noteColor = isActive ? '#ffffff' : color;
      if (isActive) {
        ctx.shadowColor = color;
        ctx.shadowBlur  = 14;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.strokeStyle = noteColor;
      ctx.fillStyle   = noteColor;
      ctx.lineWidth   = 1.5 * scale;
      ctx.beginPath();
      ctx.ellipse(x, y, noteRx, noteRy, -0.35, 0, Math.PI * 2);
      if (filled) {
        ctx.fill();
      } else {
        // Open head: fill with background to mask staff lines through it, then outline
        ctx.fillStyle = BG_COLOR;
        ctx.fill();
        ctx.strokeStyle = noteColor;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // ── Clef overlay — mask notes that scroll behind the clef area ───────
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, CLEF_AREA_WIDTH, H);

    // Redraw staff line stubs inside clef area
    ctx.strokeStyle = STAFF_COLOR;
    ctx.lineWidth   = Math.max(1, scale);
    for (let i = 0; i < 5; i++) {
      const ty = Math.round(trebleTopLineY + i * lineSpacing) + 0.5;
      const by = Math.round(bassTopLineY   + i * lineSpacing) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(CLEF_AREA_WIDTH, ty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(CLEF_AREA_WIDTH, by); ctx.stroke();
    }

    // ── Clef glyphs ──────────────────────────────────────────────────────
    ctx.fillStyle    = CLEF_COLOR;
    ctx.textAlign    = 'center';

    // Treble clef 𝄞 — baseline near treble bottom line
    ctx.font         = `${60 * scale}px serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('\uD834\uDD1E', CLEF_AREA_WIDTH / 2, trebleBottomLineY + 8 * scale);

    // Bass clef 𝄢 — aligned to F3 line (4th line from bottom = slot 6)
    ctx.font         = `${36 * scale}px serif`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('\uD834\uDD22', CLEF_AREA_WIDTH / 2, slotToY('bass', 6) + 4 * scale);

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
