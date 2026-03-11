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

// ── Inline port of computeAllFingerHints (mirrors src/lib/fingering.ts) ──────
const BLACK_MIDI = new Set([1, 3, 6, 8, 10]);
const isBlack = (p) => BLACK_MIDI.has(p % 12);
const clamp   = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

const WKI_IN_OCT = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];
const WKW = 16.5 / 7;
const keyposMidi = (pitch) => {
  const oct = Math.floor(pitch / 12);
  return (oct * 7 + WKI_IN_OCT[pitch % 12] + 0.5) * WKW;
};

const HF = 0.82;
const FREST   = [0, -7.0*HF, -2.8*HF, 0.0, 2.8*HF, 5.6*HF];
const WEIGHTS = [0,  1.1,    1.0,     1.1, 0.9,    0.8   ];
const BFACTOR = [0,  0.3,    1.0,     1.1, 0.8,    0.7   ];
const FINGERS = [1, 2, 3, 4, 5];
const CHORD_STRETCH = { '3,4':5,'4,5':5,'2,3':6,'2,4':7,'3,5':8,'2,5':11,'1,2':12,'1,3':14,'1,4':16 };
const CHORD_THRESHOLD_S = 0.030;

function buildPNotes(evts, transpose) {
  const sorted = evts
    .map(n => ({ ...n, pitch: clamp(n.pitch + transpose, 21, 108) }))
    .sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch);

  const pn = sorted.map(n => ({
    pitch: n.pitch, x: keyposMidi(n.pitch),
    time: n.startTime, duration: n.duration,
    isBlack: isBlack(n.pitch),
    isChord: false, chordID: 0, chordnr: 0, NinChord: 1,
  }));

  let cid = 1, i = 0;
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

function setFingerPos(fi, noteX, pos) {
  const fiRest = FREST[fi];
  for (let j = 1; j <= 5; j++) pos[j] = noteX + (FREST[j] - fiRest);
}

function skip(fa, fb, na, nb, lr) {
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
    const th = CHORD_STRETCH[`${Math.min(fa,fb)},${Math.max(fa,fb)}`];
    if (th !== undefined && axba > th) return true;
  }
  return false;
}

function aveVelocity(fingering, pn, depth, initPos) {
  const pos = initPos.slice();
  setFingerPos(fingering[0], pn[0].x, pos);
  let sum = 0;
  for (let i = 1; i < depth; i++) {
    const fb = fingering[i];
    const dx = Math.abs(pn[i].x - pos[fb]);
    const dt = Math.abs(pn[i].time - pn[i-1].time) + 0.1;
    sum += (dx / dt) / WEIGHTS[fb] / (pn[i].isBlack ? BFACTOR[fb] : 1);
    setFingerPos(fb, pn[i].x, pos);
  }
  return sum / Math.max(depth - 1, 1);
}

function optimizeSeq(pn, istart, lr, pos0, forceDepth9) {
  let depth;
  if (forceDepth9) { depth = 9; }
  else if (pn[0].isChord) { depth = Math.max(3, pn[0].NinChord - pn[0].chordnr + 1); }
  else {
    const t0 = pn[0].time; depth = 4;
    for (let d = 4; d <= 9; d++) { depth = d; if (pn[d-1].time - t0 > 3.5) break; }
  }
  const choices0 = istart === 0 ? FINGERS : [istart];
  let best = new Array(9).fill(1), minv = 1e10;
  const cand = new Array(9).fill(1);
  (function bt(level) {
    if (level === depth) {
      const v = aveVelocity(cand, pn, depth, pos0);
      if (v < minv) { minv = v; best = cand.slice(); }
      return;
    }
    const ch = level === 0 ? choices0 : FINGERS;
    for (const f of ch) {
      if (level > 0 && skip(cand[level-1], f, pn[level-1], pn[level], lr)) continue;
      cand[level] = f; bt(level + 1);
    }
  })(0);
  return [best, minv];
}

function generate(pnotes, lr) {
  const res = new Map();
  if (!pnotes.length) return res;
  if (lr === 'left') for (const n of pnotes) n.x = -n.x;
  const pos = [0,0,0,0,0,0];
  const N = pnotes.length;
  let startF = 0, out = [];
  for (let i = 0; i < N; i++) {
    const win = pnotes.slice(i, i + 9);
    while (win.length < 9) win.push(win[win.length - 1]);
    let best;
    if (i > N - 10 && out.length > 1) {
      best = out.splice(1, 1)[0]; out[0] = best;
      startF = out.length > 1 ? out[1] : best;
    } else {
      [out] = optimizeSeq(win, startF, lr, pos.slice(), i > N - 11);
      best = out[0]; startF = out.length > 1 ? out[1] : out[0];
    }
    setFingerPos(best, pnotes[i].x, pos);
    res.set(`${pnotes[i].pitch}_${pnotes[i].time.toFixed(3)}`, best);
  }
  if (lr === 'left') for (const n of pnotes) n.x = -n.x;
  return res;
}

function median(arr) {
  if (!arr.length) return 60;
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length & 1 ? s[m] : (s[m-1] + s[m]) / 2;
}

function computeAllFingerHints(notes, transpose = 0) {
  const result = new Map();
  if (!notes.length) return result;

  const tracks = [...new Set(notes.map(n => n.track))].sort((a,b) => a-b);
  let rhEvts, lhEvts;

  if (tracks.length >= 2) {
    const byTrack = new Map(tracks.map(t => [t, []]));
    for (const n of notes) byTrack.get(n.track).push(n);
    const sorted = [...tracks].sort(
      (a, b) => median(byTrack.get(b).map(n => n.pitch))
              - median(byTrack.get(a).map(n => n.pitch)),
    );
    rhEvts = byTrack.get(sorted[0]);
    lhEvts = sorted.slice(1).flatMap(t => byTrack.get(t));
  } else {
    const mid = median(notes.map(n => clamp(n.pitch + transpose, 21, 108)));
    rhEvts = notes.filter(n => clamp(n.pitch + transpose, 21, 108) > mid);
    lhEvts = notes.filter(n => clamp(n.pitch + transpose, 21, 108) <= mid);
  }

  const rhMap = generate(buildPNotes(rhEvts, transpose), 'right');
  const lhMap = generate(buildPNotes(lhEvts, transpose), 'left');

  for (const [key, finger] of rhMap)
    result.set(key, { pitch: parseInt(key, 10), finger, hand: 'right' });
  for (const [key, finger] of lhMap)
    result.set(key, { pitch: parseInt(key, 10), finger, hand: 'left' });

  return result;
}

// ── MIDI loader ───────────────────────────────────────────────────────────────
function loadMidi(filePath) {
  const buf = readFileSync(filePath);
  const midi = new Midi(buf);
  const bpm  = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
  const notes = [];
  midi.tracks.forEach((track, trackIdx) => {
    track.notes.forEach(note => {
      notes.push({
        pitch:     note.midi,
        startTime: note.time,
        duration:  note.duration,
        velocity:  Math.round(note.velocity * 127),
        track:     trackIdx,
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
    const key = `${clamp(note.pitch, 21, 108)}_${note.startTime.toFixed(3)}`;
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
    const slot = n.startTime.toFixed(3);
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
  const fingerDist = { right: {1:0,2:0,3:0,4:0,5:0}, left: {1:0,2:0,3:0,4:0,5:0} };
  for (const h of hints.values()) fingerDist[h.hand][h.finger]++;

  console.log(`\nTotal notes in file : ${notes.length}`);
  console.log(`Hints computed      : ${hints.size}  (RH=${rhCount}  LH=${lhCount})`);
  console.log('\nFinger distribution:');
  for (const hand of ['right', 'left']) {
    const d = fingerDist[hand];
    const bar  = [1,2,3,4,5].map(f => `${f}:${d[f]}`).join('  ');
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
  ['Coverage (every note has a hint)',         failures.coverage],
  ['Finger values in range 1..5',              failures.fingerRange],
  ['No two simultaneous notes share a finger', failures.simultaneousConflict],
  ['Pitch/finger order monotone per hand',     failures.orderConflict],
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
