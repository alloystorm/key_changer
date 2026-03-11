import { Midi } from '@tonejs/midi';
import type { ParsedSong, NoteEvent } from './types';

export async function parseMidi(buffer: ArrayBuffer, filename: string): Promise<ParsedSong> {
  const midi = new Midi(buffer);

  const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;

  const notes: NoteEvent[] = [];
  midi.tracks.forEach((track, trackIdx) => {
    track.notes.forEach((note) => {
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

  const totalDuration =
    notes.length > 0
      ? Math.max(...notes.map((n) => n.startTime + n.duration))
      : 0;

  return { notes, totalDuration, bpm, filename };
}
