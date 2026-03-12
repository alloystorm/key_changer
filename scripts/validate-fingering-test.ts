/**
 * Fingering validation script.
 *
 * Usage:
 *   node scripts/validate-fingering.mjs [path/to/file.mid]
 *
 * Parses the MIDI file, runs computeAllFingerHints(), then checks:
 *   1. No two simultaneously-active notes on the same hand share a finger
 *   2. Right hand: lower pitch → lower (or equal) finger number
 *   3. Left hand: lower pitch → higher (or equal) finger number
 *   4. All finger values are in 1..5
 *   5. Every note has a hint (coverage check)
 *
 * Prints a per-rule summary and lists the first 20 violations for each rule.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import pkg from '@tonejs/midi';
const { Midi } = pkg;

import { computeAllFingerHints } from '../src/lib/fingering.ts';

// ── MIDI loader ───────────────────────────────────────────────────────────────
function loadMidi(filePath) {
  const buf = readFileSync(filePath);
  const midi = new Midi(buf);
  const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
  const notes = [];
  midi.tracks.forEach((track, trackIdx) => {
    track.notes.forEach(note => {
      notes.push({
        pitch: note.midi,
        startTime: note.time,
        duration: note.duration,
        velocity: Math.round(note.velocity * 127),
        track: trackIdx,
      });
    });
  });
  notes.sort((a, b) => a.startTime - b.startTime);
  return { notes, bpm };
}

// ── Validation ────────────────────────────────────────────────────────────────

const MAX_VIOLATIONS = 20; // cap per rule to avoid flood

function validate(notes, hints) {
  const failures = { coverage: [], fingerRange: [], simultaneousConflict: [], orderConflict: [] };

  // Build a list of hints with timing info for overlap/order checks
  const annotated = [];
  for (const note of notes) {
    const clampedPitch = note.pitch < 21 ? 21 : note.pitch > 108 ? 108 : note.pitch;
    const key = `${clampedPitch}_${note.startTime.toFixed(3)}`;
    const hint = hints.get(key);
    if (!hint) {
      failures.coverage.push(
        `  MISS  pitch=${note.pitch} t=${note.startTime.toFixed(3)}s track=${note.track}`
      );
    } else {
      annotated.push({ ...note, pitch: hint.pitch, finger: hint.finger, hand: hint.hand });
      // Rule: finger in 1..5
      if (hint.finger < 1 || hint.finger > 5) {
        failures.fingerRange.push(
          `  finger=${hint.finger} pitch=${hint.pitch} t=${note.startTime.toFixed(3)}s`
        );
      }
    }
  }

  // Group notes by time slot (same 1-ms bucket = simultaneous)
  const bySlot = new Map();
  for (const n of annotated) {
    const slot = Math.floor(n.startTime / 0.030).toString();
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(n);
  }

  for (const [slot, group] of bySlot) {
    // Per-hand sub-groups
    const perHand = { right: [], left: [] };
    for (const n of group) perHand[n.hand].push(n);

    for (const [hand, hn] of Object.entries(perHand)) {
      if (hn.length < 2) continue;

      // Rule 1: no two simultaneous notes share the same finger
      const seen = new Map(); // finger → pitch
      for (const n of hn) {
        if (seen.has(n.finger)) {
          if (failures.simultaneousConflict.length < MAX_VIOLATIONS) {
            failures.simultaneousConflict.push(
              `  ${hand.toUpperCase()}  t=${slot}s  finger=${n.finger} on both pitch=${seen.get(n.finger)} and pitch=${n.pitch}`
            );
          }
        }
        seen.set(n.finger, n.pitch);
      }

      // Rule 2: ordering — sort by pitch, check finger monotonicity
      const sorted = hn.slice().sort((a, b) => a.pitch - b.pitch);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1], curr = sorted[i];
        if (prev.pitch === curr.pitch) continue; // enharmonic duplicates: ok

        let violation = false;
        if (hand === 'right') {
          // RH: higher pitch → higher or equal finger
          violation = curr.finger < prev.finger;
        } else {
          // LH: higher pitch → lower or equal finger
          violation = curr.finger > prev.finger;
        }
        if (violation && failures.orderConflict.length < MAX_VIOLATIONS) {
          failures.orderConflict.push(
            `  ${hand.toUpperCase()}  t=${slot}s  pitch=${prev.pitch}→finger=${prev.finger}  pitch=${curr.pitch}→finger=${curr.finger}`
          );
        }
      }
    }
  }

  return failures;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function printStats(notes, hints) {
  const rhCount = [...hints.values()].filter(h => h.hand === 'right').length;
  const lhCount = [...hints.values()].filter(h => h.hand === 'left').length;
  const fingerDist = { right: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, left: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
  for (const h of hints.values()) fingerDist[h.hand][h.finger]++;

  console.log(`\nTotal notes in file : ${notes.length}`);
  console.log(`Hints computed      : ${hints.size}  (RH=${rhCount}  LH=${lhCount})`);
  console.log('\nFinger distribution:');
  for (const hand of ['right', 'left']) {
    const d = fingerDist[hand];
    const bar = [1, 2, 3, 4, 5].map(f => `${f}:${d[f]}`).join('  ');
    console.log(`  ${hand.padEnd(5)}: ${bar}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

const midiPath = resolve(process.argv[2] ?? 'music/nier-automata-city-ruins-2018-piano-collections.mid');
console.log(`\nValidating fingering for: ${midiPath}\n`);

const t0 = Date.now();
const { notes, bpm } = loadMidi(midiPath);
console.log(`Parsed MIDI: ${notes.length} notes, BPM=${bpm.toFixed(1)}`);

const hints = computeAllFingerHints(notes, 0);
console.log(`Fingering computed in ${Date.now() - t0} ms`);

printStats(notes, hints);

const failures = validate(notes, hints);

console.log('\n─────────────────────────────────────────────────────────────');

let allPassed = true;
const rules = [
  ['Coverage (every note has a hint)', failures.coverage],
  ['Finger values in range 1..5', failures.fingerRange],
  ['No two simultaneous notes share a finger', failures.simultaneousConflict],
  ['Pitch/finger order monotone per hand', failures.orderConflict],
];

for (const [name, list] of rules) {
  const pass = list.length === 0;
  if (!pass) allPassed = false;
  console.log(`${pass ? '✓ PASS' : '✗ FAIL'}  ${name}${pass ? '' : `  (${list.length} violation${list.length > 1 ? 's' : ''})`}`);
  if (!pass) {
    for (const v of list.slice(0, MAX_VIOLATIONS)) console.log(v);
    if (list.length > MAX_VIOLATIONS) console.log(`  … and ${list.length - MAX_VIOLATIONS} more`);
  }
}

console.log('─────────────────────────────────────────────────────────────');
console.log(allPassed ? '\n✓ All checks passed.' : '\n✗ Some checks failed — see above.');
