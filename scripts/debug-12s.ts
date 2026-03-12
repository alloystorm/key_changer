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
const hints = computeAllFingerHints(notes, 0);

for (const note of notes) {
  if (note.startTime >= 11.5 && note.startTime <= 13) {
    const clampedPitch = note.pitch < 21 ? 21 : note.pitch > 108 ? 108 : note.pitch;
    const key = `${clampedPitch}_${note.startTime.toFixed(3)}`;
    const hint = hints.get(key);
    if (hint && hint.hand === 'left') {
      console.log(`t=${note.startTime.toFixed(3)} pitch=${note.pitch} finger=${hint.finger}`);
    }
  }
}
