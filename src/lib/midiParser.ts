import { Midi } from '@tonejs/midi';
import type { ParsedSong, NoteEvent } from './types';

const START_PADDING = 4;
const END_PADDING = 4;

export async function parseMidi(buffer: ArrayBuffer, filename: string): Promise<ParsedSong> {
  const midi = new Midi(buffer);

  const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;

  const notes: NoteEvent[] = [];
  midi.tracks.forEach((track, trackIdx) => {
    track.notes.forEach((note) => {
      notes.push({
        pitch: note.midi,
        startTime: note.time + START_PADDING,
        duration: note.duration,
        velocity: Math.round(note.velocity * 127),
        track: trackIdx,
      });
    });
  });

  notes.sort((a, b) => a.startTime - b.startTime);

  const musicDuration =
    notes.length > 0
      ? Math.max(...notes.map((n) => n.startTime + n.duration))
      : START_PADDING;

  const totalDuration = musicDuration + END_PADDING;

  return { notes, totalDuration, bpm, filename };
}
