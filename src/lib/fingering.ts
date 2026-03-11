/**
 * Piano finger-hint advisor.
 *
 * Algorithm ported from pianoplayer (MIT © Marco Musy):
 *   https://github.com/marcomusy/pianoplayer
 *
 * Key ideas:
 *  - Physical keyboard geometry (cm) via keyposMidi()
 *  - Biomechanical pruning in skip(): no crossing, no thumb-under on black keys,
 *    chord ordering rules, inter-finger stretch limits
 *  - Velocity/effort cost with a simplified relaxed-hand-posture model
 *  - Depth-first backtracking over 9-note windows; depth 4-9 auto-selected
 *  - Full song computed ONCE at file load / transpose change; result is a plain
 *    Map<"${pitch}_${time.toFixed(3)}", FingerHint> used as a lookup cache
 */

import type { NoteEvent } from './types';

// Public types
export interface FingerHint {
  pitch: number;
  finger: 1 | 2 | 3 | 4 | 5;
  hand: 'right' | 'left';
}

// Physical geometry
const BLACK_MIDI = new Set([1, 3, 6, 8, 10]);
const isBlack = (p: number) => BLACK_MIDI.has(p % 12);
const clamp   = (v: number, lo: number, hi: number) => v < lo ? lo : v > hi ? hi : v;

function keyposMidi(pitch: number): number {
  return 16.5 * Math.floor(pitch / 12) + (pitch % 12) * (16.5 / 7);
}

// Hand constants - "M" size, hf = 0.82 (from pianoplayer/hand.py)
const HF = 0.82;
const FREST   = [0, -7.0 * HF, -2.8 * HF, 0.0,  2.8 * HF, 5.6 * HF];
const WEIGHTS = [0,  1.1,       1.0,       1.1,  0.9,      0.8      ];
const BFACTOR = [0,  0.3,       1.0,       1.1,  0.8,      0.7      ];
const FINGERS = [1, 2, 3, 4, 5] as const;

const CHORD_STRETCH: Record<string, number> = {
  '3,4': 5, '4,5': 5, '2,3': 6, '2,4': 7,
  '3,5': 8, '2,5': 11, '1,2': 12, '1,3': 14, '1,4': 16,
};

// Internal note type
interface PNote {
  pitch: number;
  x: number;
  time: number;
  duration: number;
  isBlack: boolean;
  isChord: boolean;
  chordID: number;
  chordnr: number;
  NinChord: number;
}

const CHORD_THRESHOLD_S = 0.030;

function buildPNotes(evts: NoteEvent[], transpose: number): PNote[] {
  const sorted = [...evts]
    .map(n => ({ ...n, pitch: clamp(n.pitch + transpose, 21, 108) }))
    .sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch);

  const pn: PNote[] = sorted.map(n => ({
    pitch: n.pitch,
    x: keyposMidi(n.pitch),
    time: n.startTime,
    duration: n.duration,
    isBlack: isBlack(n.pitch),
    isChord: false, chordID: 0, chordnr: 0, NinChord: 1,
  }));

  let cid = 1;
  let i = 0;
  while (i < pn.length) {
    let j = i + 1;
    while (j < pn.length && pn[j].time - pn[i].time < CHORD_THRESHOLD_S) j++;
    if (j > i + 1) {
      for (let k = i; k < j; k++) {
        pn[k].isChord = true; pn[k].chordID = cid;
        pn[k].chordnr = k - i; pn[k].NinChord = j - i;
      }
      cid++;
    }
    i = j;
  }
  return pn;
}

// Posture model
function setFingerPos(fi: number, noteX: number, pos: number[]): void {
  const fiRest = FREST[fi];
  for (let j = 1; j <= 5; j++) pos[j] = noteX + (FREST[j] - fiRest);
}

// Pruning rules (hand.py:skip)
function skip(fa: number, fb: number, na: PNote, nb: PNote, lr: 'right' | 'left'): boolean {
  const xba = nb.x - na.x;

  if (!na.isChord && !nb.isChord) {
    if (fa === fb && xba !== 0 && na.duration < 2.0) return true;
    if (fa > 1) {
      if (fb > 1 && (fb - fa) * xba < 0) return true;
      if (fb === 1 && nb.isBlack && xba > 0) return true;
    } else {
      if (na.isBlack && xba < 0 && fb > 1 && na.duration < 1.0) return true;
    }
  } else if (na.isChord && nb.isChord && na.chordID === nb.chordID) {
    const axba = Math.abs(xba) * HF / 0.8;
    if (fa === fb) return true;
    if (fa < fb && lr === 'left') return true;
    if (fa > fb && lr === 'right') return true;
    const th = CHORD_STRETCH[`${Math.min(fa, fb)},${Math.max(fa, fb)}`];
    if (th !== undefined && axba > th) return true;
  }

  return false;
}

// Cost function (hand.py:ave_velocity)
function aveVelocity(fingering: number[], pn: PNote[], depth: number, initPos: number[]): number {
  const pos = initPos.slice();
  setFingerPos(fingering[0], pn[0].x, pos);
  let sum = 0;
  for (let i = 1; i < depth; i++) {
    const fb = fingering[i];
    const dx = Math.abs(pn[i].x - pos[fb]);
    const dt = Math.abs(pn[i].time - pn[i - 1].time) + 0.1;
    sum += (dx / dt) / WEIGHTS[fb] / (pn[i].isBlack ? BFACTOR[fb] : 1);
    setFingerPos(fb, pn[i].x, pos);
  }
  return sum / Math.max(depth - 1, 1);
}

// Combinatorial optimizer (hand.py:optimize_seq)
function optimizeSeq(
  pn: PNote[],
  istart: number,
  lr: 'right' | 'left',
  pos0: number[],
  forceDepth9: boolean,
): [number[], number] {
  let depth: number;
  if (forceDepth9) {
    depth = 9;
  } else if (pn[0].isChord) {
    depth = Math.max(3, pn[0].NinChord - pn[0].chordnr + 1);
  } else {
    const t0 = pn[0].time;
    depth = 4;
    for (let d = 4; d <= 9; d++) { depth = d; if (pn[d - 1].time - t0 > 3.5) break; }
  }

  const choices0 = istart === 0 ? FINGERS : [istart as (typeof FINGERS)[number]];
  let best  = new Array<number>(9).fill(1);
  let minv  = 1e10;
  const cand = new Array<number>(9).fill(1);

  (function bt(level: number): void {
    if (level === depth) {
      const v = aveVelocity(cand, pn, depth, pos0);
      if (v < minv) { minv = v; best = cand.slice(); }
      return;
    }
    const ch = level === 0 ? choices0 : FINGERS;
    for (const f of ch) {
      if (level > 0 && skip(cand[level - 1], f, pn[level - 1], pn[level], lr)) continue;
      cand[level] = f;
      bt(level + 1);
    }
  })(0);

  return [best, minv];
}

// Per-hand generator (hand.py:generate)
function generate(pnotes: PNote[], lr: 'right' | 'left'): Map<string, number> {
  const res = new Map<string, number>();
  if (!pnotes.length) return res;

  if (lr === 'left') for (const n of pnotes) n.x = -n.x;

  const pos = [0, 0, 0, 0, 0, 0];
  const N   = pnotes.length;
  let startF = 0;
  let out: number[] = [];

  for (let i = 0; i < N; i++) {
    const win = pnotes.slice(i, i + 9);
    while (win.length < 9) win.push(win[win.length - 1]);

    let best: number;
    if (i > N - 10 && out.length > 1) {
      best   = out.splice(1, 1)[0];
      out[0] = best;
      startF = out.length > 1 ? out[1] : best;
    } else {
      [out]  = optimizeSeq(win, startF, lr, pos.slice(), i > N - 11);
      best   = out[0];
      startF = out.length > 1 ? out[1] : out[0];
    }

    setFingerPos(best, pnotes[i].x, pos);
    res.set(`${pnotes[i].pitch}_${pnotes[i].time.toFixed(3)}`, best);
  }

  if (lr === 'left') for (const n of pnotes) n.x = -n.x;
  return res;
}

// Utility
function median(arr: number[]): number {
  if (!arr.length) return 60;
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Compute finger hints for every note in a song.
 *
 * Hand assignment:
 *  - Multi-track: highest-median-pitch track -> right hand, rest -> left hand.
 *  - Single-track: notes above the median pitch -> right hand, at/below -> left hand.
 *
 * Result key: "${transposedPitch}_${startTime.toFixed(3)}" — matches the key
 * built inside PianoRollView's draw loop.
 *
 * Call once at file load and once per transpose change.
 */
export function computeAllFingerHints(
  notes: NoteEvent[],
  transpose: number,
): Map<string, FingerHint> {
  const result = new Map<string, FingerHint>();
  if (!notes.length) return result;

  const tracks = [...new Set(notes.map(n => n.track))].sort((a, b) => a - b);
  let rhEvts: NoteEvent[], lhEvts: NoteEvent[];

  if (tracks.length >= 2) {
    const byTrack = new Map<number, NoteEvent[]>(tracks.map(t => [t, []]));
    for (const n of notes) byTrack.get(n.track)!.push(n);
    const sorted = [...tracks].sort(
      (a, b) => median(byTrack.get(b)!.map(n => n.pitch))
              - median(byTrack.get(a)!.map(n => n.pitch)),
    );
    rhEvts = byTrack.get(sorted[0])!;
    lhEvts = sorted.slice(1).flatMap(t => byTrack.get(t)!);
  } else {
    const mid = median(notes.map(n => clamp(n.pitch + transpose, 21, 108)));
    rhEvts = notes.filter(n => clamp(n.pitch + transpose, 21, 108) > mid);
    lhEvts = notes.filter(n => clamp(n.pitch + transpose, 21, 108) <= mid);
  }

  const rhMap = generate(buildPNotes(rhEvts, transpose), 'right');
  const lhMap = generate(buildPNotes(lhEvts, transpose), 'left');

  for (const [key, finger] of rhMap) {
    result.set(key, { pitch: parseInt(key, 10), finger: finger as FingerHint['finger'], hand: 'right' });
  }
  for (const [key, finger] of lhMap) {
    result.set(key, { pitch: parseInt(key, 10), finger: finger as FingerHint['finger'], hand: 'left' });
  }

  return result;
}
