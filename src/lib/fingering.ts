/**
 * Simple rule-based fingering advisor for beginners.
 *
 * Algorithm: a greedy "position-based" approach.
 *   - Scan notes in time order.
 *   - Maintain the current "hand position": a window of 5 consecutive
 *     white-key indices the hand covers (thumb on lowest, pinky on highest).
 *   - When a note falls outside the current position, shift the hand to the
 *     nearest covering position.
 *   - Assign fingers: white key index within position → 1-5 (left hand reversed).
 *   - Black keys share the finger of the nearest white key below them.
 *
 * This is intentionally simplified — it works well for single-hand,
 * scalar/chordal beginner pieces. For polyphonic or two-hand pieces notes
 * are split by track: track 0 = right hand, track 1 = left hand.
 */

import type { NoteEvent } from './types';

export interface FingerHint {
  pitch: number;      // MIDI pitch (already transposed)
  finger: 1 | 2 | 3 | 4 | 5;
  hand: 'right' | 'left';
}

// ── helpers ──────────────────────────────────────────────────────────────────

const BLACK_KEY_OFFSETS = new Set([1, 3, 6, 8, 10]);

function isBlack(midi: number) {
  return BLACK_KEY_OFFSETS.has(midi % 12);
}

/** Index of the note among all white keys (A0=0, B0=1, C1=2, …) */
function whiteIndex(midi: number): number {
  // number of white keys below this midi note
  const octave = Math.floor(midi / 12);
  const semitone = midi % 12;
  // white keys per octave: C D E F G A B = offsets 0 2 4 5 7 9 11
  const whiteInOctave = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  return octave * 7 + whiteInOctave[semitone];
}

/** For a black key, return the white key index it's "on top of" (the one to its left) */
function blackToWhiteIndex(midi: number): number {
  return whiteIndex(midi - 1);
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * For a given slice of notes (already transposed), compute finger hints.
 * Only notes within [startTime, startTime + windowSec] are considered.
 */
export function computeFingerHints(
  notes: NoteEvent[],
  transpose: number,
  windowStart: number,
  windowEnd: number
): Map<string, FingerHint> {
  const result = new Map<string, FingerHint>();

  // Split into right (track 0) and left (track 1+) hands
  const byHand: Record<'right' | 'left', NoteEvent[]> = {
    right: [],
    left: [],
  };

  notes.forEach((n) => {
    if (n.startTime < windowStart - 0.5 || n.startTime > windowEnd) return;
    const hand = n.track <= 0 ? 'right' : 'left';
    byHand[hand].push(n);
  });

  (['right', 'left'] as const).forEach((hand) => {
    const handNotes = byHand[hand];
    if (handNotes.length === 0) return;

    // Sort by time then pitch
    handNotes.sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch);

    // Current hand position: whiteIndex of the thumb (finger 1 for right / finger 5 for left)
    // Initialise at the first note
    const firstPitch = Math.max(21, Math.min(108, handNotes[0].pitch + transpose));
    const firstWI = isBlack(firstPitch)
      ? blackToWhiteIndex(firstPitch)
      : whiteIndex(firstPitch);

    // Hand spans 5 consecutive white-key positions
    let posStart = hand === 'right' ? firstWI : firstWI - 4; // lowest white index covered
    posStart = Math.max(0, posStart);

    handNotes.forEach((note) => {
      const pitch = Math.max(21, Math.min(108, note.pitch + transpose));
      const wi = isBlack(pitch) ? blackToWhiteIndex(pitch) : whiteIndex(pitch);

      // Shift hand position if needed
      if (wi < posStart) posStart = wi;
      if (wi > posStart + 4) posStart = wi - 4;

      // Assign finger
      const offset = wi - posStart; // 0-4
      let finger: 1 | 2 | 3 | 4 | 5;
      if (hand === 'right') {
        finger = (offset + 1) as 1 | 2 | 3 | 4 | 5;
      } else {
        // Left hand: thumb (1) on highest, pinky (5) on lowest
        finger = (5 - offset) as 1 | 2 | 3 | 4 | 5;
      }
      finger = Math.max(1, Math.min(5, finger)) as 1 | 2 | 3 | 4 | 5;

      const key = `${pitch}_${note.startTime.toFixed(3)}`;
      result.set(key, { pitch, finger, hand });
    });
  });

  return result;
}
