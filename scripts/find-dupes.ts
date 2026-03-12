import { readFileSync } from 'fs';
import { resolve } from 'path';
import pkg from '@tonejs/midi';
const { Midi } = pkg;

import { computeAllFingerHints } from '../src/lib/fingering.ts';

function loadMidi(filePath: string) {
  const buf = readFileSync(filePath);
  const midi = new Midi(buf);
  const notes: any[] = [];
  midi.tracks.forEach((track, trackIdx) => {
    track.notes.forEach(note => {
      notes.push({
        pitch: note.midi,
        name: note.name,
        startTime: note.time,
        duration: note.duration,
        velocity: Math.round(note.velocity * 127),
        track: trackIdx,
      });
    });
  });
  notes.sort((a, b) => a.startTime - b.startTime);
  return { notes };
}

const midiPath = resolve('music/nier-automata-city-ruins-2018-piano-collections.mid');
const { notes } = loadMidi(midiPath);
const hints = computeAllFingerHints(notes as any, 0);

const lhNotes = [];
for (const n of notes) {
  const pitch = Math.max(21, Math.min(108, n.pitch));
  const key = `${pitch}_${n.startTime.toFixed(3)}`;
  const hint = hints.get(key);
  if (hint && hint.hand === 'left') {
    lhNotes.push({ ...n, finger: hint.finger });
  }
}

for (let i = 0; i < lhNotes.length - 1; i++) {
  const a = lhNotes[i];
  const b = lhNotes[i + 1];
  if (a.finger === b.finger && Math.abs(b.startTime - a.startTime) <= 0.2 && a.pitch !== b.pitch) {
    console.log(`Same finger ${a.finger} on different pitch at t=${a.startTime.toFixed(3)}s (${a.name} -> ${b.name}) diff=${(b.startTime-a.startTime).toFixed(3)}s`);
  }
}
