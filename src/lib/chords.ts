import type { NoteEvent } from './types';

export interface ChordEvent {
  /** Onset time in seconds (matches NoteEvent.startTime scale) */
  time: number;
  /** Human-readable chord name, e.g. "Cmaj7", "Am", "G7/B" */
  name: string;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Chord templates ordered from most specific (most intervals) to least.
 * Within the same size, more common chord types come first.
 * The first matching template per root wins — so ordering matters.
 */
const TEMPLATES: ReadonlyArray<{ readonly iv: readonly number[]; readonly q: string }> = [
  // 5-note
  { iv: [0, 2, 4, 7, 11], q: 'maj9'  },
  { iv: [0, 2, 4, 7, 10], q: '9'     },
  { iv: [0, 2, 3, 7, 10], q: 'm9'    },
  // 4-note
  { iv: [0, 4, 7, 11],    q: 'maj7'  },
  { iv: [0, 4, 7, 10],    q: '7'     },
  { iv: [0, 3, 7, 10],    q: 'm7'    },
  { iv: [0, 3, 7, 11],    q: 'mM7'   },
  { iv: [0, 3, 6,  9],    q: 'dim7'  },
  { iv: [0, 3, 6, 10],    q: 'ø7'    },
  { iv: [0, 4, 7,  9],    q: '6'     },
  { iv: [0, 3, 7,  9],    q: 'm6'    },
  { iv: [0, 2, 4,  7],    q: 'add9'  },
  // 3-note
  { iv: [0, 4, 7],        q: ''      },  // major
  { iv: [0, 3, 7],        q: 'm'     },  // minor
  { iv: [0, 3, 6],        q: 'dim'   },
  { iv: [0, 4, 8],        q: 'aug'   },
  { iv: [0, 5, 7],        q: 'sus4'  },
  { iv: [0, 2, 7],        q: 'sus2'  },
];

/**
 * Identify a chord name from a set of MIDI pitches.
 *
 * Returns null when fewer than 3 distinct pitch classes are present or no
 * template matches. Inversions are shown as "/BassNote" (e.g. "C/E" for
 * first-inversion C major). Ties in score are broken by lower pitch-class
 * number (root-position preference).
 */
export function identifyChord(pitches: number[]): string | null {
  // Deduplicate and sort pitch classes ascending so lower roots win ties
  const pcs = [...new Set(pitches.map(p => ((p % 12) + 12) % 12))].sort((a, b) => a - b);
  if (pcs.length < 3) return null;

  const lowestPitch = pitches.reduce((lo, p) => (p < lo ? p : lo), pitches[0]);
  const bassPC = ((lowestPitch % 12) + 12) % 12;

  let bestScore = -Infinity;
  let bestRoot = -1;
  let bestQuality = '';

  for (const root of pcs) {
    const ivSet = new Set(pcs.map(pc => (pc - root + 12) % 12));

    for (const tmpl of TEMPLATES) {
      if (!tmpl.iv.every(i => ivSet.has(i))) continue;
      // Reward matched template tones; penalise unmatched extra chord tones
      const score = tmpl.iv.length * 10 - (pcs.length - tmpl.iv.length);
      if (score > bestScore) {
        bestScore = score;
        bestRoot = root;
        bestQuality = tmpl.q;
      }
      // Templates are sorted most→least specific; first match for this root is best
      break;
    }
  }

  if (bestRoot === -1) return null;

  const inv = bestRoot !== bassPC ? `/${NOTE_NAMES[bassPC]}` : '';
  return `${NOTE_NAMES[bestRoot]}${bestQuality}${inv}`;
}

/** Onset window for grouping simultaneous / lightly rolled notes (60 ms) */
const CHORD_WINDOW = 0.060;

/**
 * Scan all notes in a song and return chord events for simultaneous groups
 * with ≥ 3 distinct pitch classes. Uses both hands together so bass + chord
 * combine into the full harmonic picture.
 *
 * Consecutive identical chord names are collapsed to avoid clutter; the
 * same name re-emits after a 2-second gap (e.g. when a repeated section
 * returns).
 */
export function buildChordEvents(notes: NoteEvent[]): ChordEvent[] {
  if (!notes.length) return [];

  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  const events: ChordEvent[] = [];
  let lastName = '';
  let lastTime = -Infinity;

  let i = 0;
  while (i < sorted.length) {
    const t0 = sorted[i].startTime;
    let j = i + 1;
    while (j < sorted.length && sorted[j].startTime - t0 < CHORD_WINDOW) j++;

    if (j - i >= 2) {
      const name = identifyChord(sorted.slice(i, j).map(n => n.pitch));
      if (name !== null) {
        const isChange = name !== lastName;
        const isReturn = t0 - lastTime > 2.0; // re-show after gap
        if (isChange || isReturn) {
          events.push({ time: t0, name });
          lastName = name;
          lastTime = t0;
        }
      }
    }
    i = j;
  }

  return events;
}
