import { describe, it, expect } from 'vitest';
import type { NoteEvent } from './types';
import { applyFingerHints, keyposMidi, buildPNotes, skip } from './fingering';

const WKW = 16.5 / 7; // cm per white-key interval — mirrors the constant in fingering.ts

function n(
  pitch: number,
  startTime: number,
  duration = 0.5,
  velocity = 64,
  track = 0,
): NoteEvent {
  return { pitch, startTime, duration, velocity, track };
}

// ─── keyposMidi ──────────────────────────────────────────────────────────────

describe('keyposMidi', () => {
  it('is strictly increasing across all 88 keys (MIDI 21–108)', () => {
    for (let p = 21; p < 108; p++) {
      expect(keyposMidi(p)).toBeLessThan(keyposMidi(p + 1));
    }
  });

  it('places a black key between its two white neighbours', () => {
    // C#4 (61) must lie between C4 (60) and D4 (62)
    expect(keyposMidi(61)).toBeGreaterThan(keyposMidi(60));
    expect(keyposMidi(61)).toBeLessThan(keyposMidi(62));
  });

  it('spaces white keys evenly (C→D == D→E)', () => {
    const cd = keyposMidi(62) - keyposMidi(60); // C4→D4
    const de = keyposMidi(64) - keyposMidi(62); // D4→E4
    expect(cd).toBeCloseTo(WKW, 5);
    expect(de).toBeCloseTo(WKW, 5);
  });

  it('spans exactly 7 white-key widths per octave', () => {
    expect(keyposMidi(72) - keyposMidi(60)).toBeCloseTo(7 * WKW, 5);
  });
});

// ─── buildPNotes ─────────────────────────────────────────────────────────────

describe('buildPNotes', () => {
  it('sorts by startTime then pitch', () => {
    const notes = [n(64, 1.0), n(60, 0.0), n(62, 0.0)];
    const pn = buildPNotes(notes, 0);
    expect(pn.map(p => p.pitch)).toEqual([60, 62, 64]);
  });

  it('clamps pitch below 21 up to 21', () => {
    expect(buildPNotes([n(0, 0)], 0)[0].pitch).toBe(21);
  });

  it('clamps pitch above 108 down to 108', () => {
    expect(buildPNotes([n(127, 0)], 0)[0].pitch).toBe(108);
  });

  it('applies transpose before clamping', () => {
    expect(buildPNotes([n(60, 0)], 7)[0].pitch).toBe(67); // C4 + 7 = G4
  });

  it('computes x via keyposMidi', () => {
    const pn = buildPNotes([n(60, 0)], 0);
    expect(pn[0].x).toBeCloseTo(keyposMidi(60), 5);
  });

  it('marks white keys as not black, black keys as black', () => {
    const pn = buildPNotes([n(60, 0), n(61, 0.5)], 0); // C4 (white), C#4 (black)
    expect(pn[0].isBlack).toBe(false);
    expect(pn[1].isBlack).toBe(true);
  });

  it('groups simultaneous notes as a chord with correct chordnr and NinChord', () => {
    const pn = buildPNotes([n(60, 0), n(64, 0), n(67, 0)], 0); // C major triad
    expect(pn.every(p => p.isChord)).toBe(true);
    expect(pn.every(p => p.NinChord === 3)).toBe(true);
    expect(pn.map(p => p.chordnr)).toEqual([0, 1, 2]);
    // All share the same chordID
    expect(new Set(pn.map(p => p.chordID)).size).toBe(1);
    expect(pn[0].chordID).toBeGreaterThan(0);
  });

  it('does not mark well-separated notes as chords', () => {
    const pn = buildPNotes([n(60, 0), n(62, 0.5), n(64, 1.0)], 0);
    expect(pn.every(p => !p.isChord)).toBe(true);
  });

  it('assigns distinct chordIDs to separate chords', () => {
    const pn = buildPNotes(
      [n(60, 0), n(64, 0), n(65, 1.0), n(69, 1.0)],
      0,
    );
    expect(pn[0].chordID).not.toBe(0);
    expect(pn[2].chordID).not.toBe(0);
    expect(pn[0].chordID).not.toBe(pn[2].chordID);
  });

  it('handles a single note with no chord metadata', () => {
    const pn = buildPNotes([n(60, 0)], 0);
    expect(pn[0].isChord).toBe(false);
    expect(pn[0].NinChord).toBe(1);
    expect(pn[0].chordnr).toBe(0);
  });
});

// ─── skip — melody (non-chord) notes ─────────────────────────────────────────

describe('skip — melody notes', () => {
  // Build two sequential non-chord PNotes via buildPNotes so geometry is real.
  function melody(pitchA: number, pitchB: number, durationA = 0.3) {
    const [na, nb] = buildPNotes([n(pitchA, 0, durationA), n(pitchB, 0.5)], 0);
    return { na, nb };
  }

  it('skips the same finger reused on a different pitch (short previous note)', () => {
    const { na, nb } = melody(60, 62, 0.3); // short note, so rule applies
    expect(skip(3, 3, na, nb, 'right')).toBe(true);
  });

  it('allows the same finger when the previous note is long (legato hold)', () => {
    const { na, nb } = melody(60, 62, 2.0); // duration >= 1.0 disables same-finger rule
    expect(skip(3, 3, na, nb, 'right')).toBe(false);
  });

  it('skips a descending finger on an ascending right-hand interval (crossing)', () => {
    const { na, nb } = melody(60, 64); // ascending pitch
    // finger 4 → 2 while moving right = illegal crossing
    expect(skip(4, 2, na, nb, 'right')).toBe(true);
  });

  it('allows an ascending finger on an ascending right-hand interval', () => {
    const { na, nb } = melody(60, 64);
    expect(skip(2, 4, na, nb, 'right')).toBe(false);
  });

  it('allows thumb-under (3→1) when the target is a white key', () => {
    // C4 → F4: thumb tucks under on a white key — legal
    const [na, nb] = buildPNotes([n(60, 0, 0.3), n(65, 0.5)], 0);
    expect(skip(3, 1, na, nb, 'right')).toBe(false);
  });

  it('skips thumb-to-black-key on an ascending right-hand interval', () => {
    // C4 → C#4: thumb cannot comfortably reach an ascending black key
    const [na, nb] = buildPNotes([n(60, 0, 0.3), n(61, 0.5)], 0);
    expect(skip(3, 1, na, nb, 'right')).toBe(true);
  });

  it('relax mode suppresses all non-chord pruning', () => {
    const { na, nb } = melody(60, 62, 0.3);
    expect(skip(3, 3, na, nb, 'right', true)).toBe(false); // same-finger — normally skipped
    expect(skip(4, 2, na, nb, 'right', true)).toBe(false); // crossing   — normally skipped
  });
});

// ─── skip — chord notes ───────────────────────────────────────────────────────

describe('skip — chord notes', () => {
  // Two notes at the same time → buildPNotes marks them as a chord.
  function chord(pitchA: number, pitchB: number) {
    const [na, nb] = buildPNotes([n(pitchA, 0), n(pitchB, 0)], 0);
    return { na, nb };
  }

  it('always skips when the same finger is assigned to two chord notes', () => {
    const { na, nb } = chord(60, 67);
    expect(skip(3, 3, na, nb, 'right')).toBe(true);
  });

  it('skips right-hand chord where a higher pitch gets a lower finger number', () => {
    // na = lower pitch (60), nb = higher pitch (67)
    // right hand expects ascending fingers for ascending pitches
    expect(skip(4, 2, chord(60, 67).na, chord(60, 67).nb, 'right')).toBe(true);
  });

  it('allows right-hand chord with ascending finger on ascending pitch', () => {
    const { na, nb } = chord(60, 67);
    expect(skip(1, 3, na, nb, 'right')).toBe(false);
  });

  it('skips left-hand chord where a higher pitch gets a higher finger number', () => {
    // left hand is mirrored — higher pitch should get a lower finger number
    const { na, nb } = chord(60, 67);
    expect(skip(1, 3, na, nb, 'left')).toBe(true);
  });

  it('skips when stretch exceeds the table limit (fingers 3,4 limit = 5 cm)', () => {
    // C4→C5 = 7 white keys ≈ 16.5 cm, well beyond 5 cm limit for fingers 3,4
    const { na, nb } = chord(60, 72);
    expect(skip(3, 4, na, nb, 'right')).toBe(true);
  });

  it('allows when stretch is within the table limit (fingers 3,4 limit = 5 cm)', () => {
    // C4→D4 = 1 white key ≈ 2.4 cm, under the 5 cm limit
    const { na, nb } = chord(60, 62);
    expect(skip(3, 4, na, nb, 'right')).toBe(false);
  });

  it('relax mode overrides stretch limit while still enforcing ordering', () => {
    const { na, nb } = chord(60, 72); // large stretch
    expect(skip(3, 4, na, nb, 'right', false)).toBe(true);  // strict: skipped for stretch
    expect(skip(3, 4, na, nb, 'right', true)).toBe(false);  // relax: allowed
  });
});

// ─── applyFingerHints — integration ──────────────────────────────────────────

describe('applyFingerHints', () => {
  function cMajor(octave = 4, track = 0): NoteEvent[] {
    // C D E F G A B C — 8 notes, well separated
    return [0, 2, 4, 5, 7, 9, 11, 12].map((s, i) =>
      n(60 + (octave - 4) * 12 + s, i * 0.5, 0.4, 64, track),
    );
  }

  it('handles empty input without throwing', () => {
    expect(() => applyFingerHints([], 0)).not.toThrow();
  });

  it('assigns a valid finger (1–5) to every note', () => {
    const notes = cMajor();
    applyFingerHints(notes, 0);
    for (const note of notes) {
      expect(note.finger).toBeGreaterThanOrEqual(1);
      expect(note.finger).toBeLessThanOrEqual(5);
    }
  });

  it('assigns a hand to every note', () => {
    const notes = cMajor();
    applyFingerHints(notes, 0);
    for (const note of notes) {
      expect(['right', 'left']).toContain(note.hand);
    }
  });

  it('assigns a finger and hand to a single note', () => {
    const notes = [n(60, 0)];
    applyFingerHints(notes, 0);
    expect(notes[0].finger).toBeDefined();
    expect(notes[0].hand).toBeDefined();
  });

  it('multi-track: highest-median-pitch track becomes right hand', () => {
    // track 1 = treble range, track 0 = bass range
    const treble = [60, 62, 64, 65, 67].map((p, i) => n(p + 24, i * 0.5, 0.4, 64, 1));
    const bass   = [36, 38, 40, 41, 43].map((p, i) => n(p,       i * 0.5, 0.4, 64, 0));
    applyFingerHints([...treble, ...bass], 0);
    for (const note of treble) expect(note.hand).toBe('right');
    for (const note of bass)   expect(note.hand).toBe('left');
  });

  it('single-track: notes above median pitch → right hand, at/below → left hand', () => {
    // pitches [48 52 56 60 64 68 72] — sorted median = 60
    const notes = [48, 52, 56, 60, 64, 68, 72].map((p, i) => n(p, i * 0.5, 0.4));
    applyFingerHints(notes, 0);
    for (const note of notes) {
      if (note.pitch > 60)  expect(note.hand).toBe('right');
      if (note.pitch <= 60) expect(note.hand).toBe('left');
    }
  });

  it('chord notes in the same hand each get a distinct finger', () => {
    // Put background bass in track 0 so track 1 (the chord) is unambiguously right hand
    const bass  = [36, 38, 40].map((p, i) => n(p, i * 0.5, 0.4, 64, 0));
    const chord = [60, 64, 67].map(p => n(p, 2.0, 0.4, 64, 1)); // simultaneous
    applyFingerHints([...bass, ...chord], 0);
    const fingers = chord.map(note => note.finger);
    expect(new Set(fingers).size).toBe(3); // all three must differ
  });

  it('is idempotent — two calls produce identical results', () => {
    const notes = cMajor();
    applyFingerHints(notes, 0);
    const firstFingers = notes.map(note => note.finger);
    const firstHands   = notes.map(note => note.hand);
    applyFingerHints(notes, 0);
    expect(notes.map(note => note.finger)).toEqual(firstFingers);
    expect(notes.map(note => note.hand)).toEqual(firstHands);
  });

  it('transpose shifts assignments without errors and keeps fingers valid', () => {
    const notes = cMajor();
    applyFingerHints(notes, 7); // up a fifth
    for (const note of notes) {
      expect(note.finger).toBeGreaterThanOrEqual(1);
      expect(note.finger).toBeLessThanOrEqual(5);
      expect(['right', 'left']).toContain(note.hand);
    }
  });

  it('handles a descending scale without errors', () => {
    const notes = [72, 71, 69, 67, 65, 64, 62, 60].map((p, i) => n(p, i * 0.5, 0.4));
    expect(() => applyFingerHints(notes, 0)).not.toThrow();
    for (const note of notes) {
      expect(note.finger).toBeGreaterThanOrEqual(1);
      expect(note.finger).toBeLessThanOrEqual(5);
    }
  });

  it('handles an extreme upward transpose (clamping at 108)', () => {
    const notes = [100, 104, 107].map((p, i) => n(p, i * 0.5, 0.4));
    expect(() => applyFingerHints(notes, 12)).not.toThrow();
  });

  it('handles notes all on the same pitch', () => {
    const notes = Array.from({ length: 5 }, (_, i) => n(60, i * 0.5, 0.4));
    expect(() => applyFingerHints(notes, 0)).not.toThrow();
    for (const note of notes) expect(note.finger).toBeDefined();
  });
});
