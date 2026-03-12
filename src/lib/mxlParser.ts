import JSZip from 'jszip';
import type { ParsedSong, NoteEvent } from './types';

/** Note name to semitone offset within octave (C=0) */
const NOTE_STEP_MAP: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function midiPitchFromXmlPitch(
  step: string,
  alter: number,
  octave: number
): number {
  const base = NOTE_STEP_MAP[step.toUpperCase()] ?? 0;
  return (octave + 1) * 12 + base + alter;
}

const START_PADDING = 4;
const END_PADDING = 4;

/**
 * Parse a MusicXML string into note events.
 * Handles <divisions>, <tempo>, tied notes (skips <tie type="stop">).
 */
function parseMusicXmlNotes(xml: string): { notes: NoteEvent[]; bpm: number; totalDuration: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  let bpm = 120;
  const soundEl = doc.querySelector('sound[tempo]');
  if (soundEl) bpm = parseFloat(soundEl.getAttribute('tempo') ?? '120');

  const parts = Array.from(doc.querySelectorAll('part'));
  const allNotes: NoteEvent[] = [];

  parts.forEach((part, partIdx) => {
    const measures = Array.from(part.querySelectorAll('measure'));
    let currentTime = START_PADDING; // seconds
    let divisions = 1; // divisions per quarter note

    measures.forEach((measure) => {
      // Check for new tempo in this measure
      const tempoEl = measure.querySelector('sound[tempo]');
      if (tempoEl) {
        bpm = parseFloat(tempoEl.getAttribute('tempo') ?? String(bpm));
      }

      // Update divisions if present
      const divsEl = measure.querySelector('divisions');
      if (divsEl) divisions = parseInt(divsEl.textContent ?? '1', 10);

      const secondsPerBeat = 60 / bpm;
      const secondsPerDiv = secondsPerBeat / divisions;

      let chordOffset = 0; // for <chord> elements
      let prevDuration = 0;

      const noteEls = Array.from(measure.querySelectorAll('note'));
      noteEls.forEach((noteEl) => {
        const isRest = noteEl.querySelector('rest') !== null;
        const durationEl = noteEl.querySelector('duration');
        const dur = durationEl ? parseInt(durationEl.textContent ?? '0', 10) : 0;
        const durationSec = dur * secondsPerDiv;

        // Handle chord: chord notes start at same time as previous note
        const isChord = noteEl.querySelector('chord') !== null;
        if (isChord) {
          chordOffset = prevDuration;
        } else {
          chordOffset = 0;
        }

        if (isRest) {
          if (!isChord) currentTime += durationSec;
          prevDuration = durationSec;
          return;
        }

        // Skip tied continuation notes
        const ties = Array.from(noteEl.querySelectorAll('tie'));
        const isTieStop = ties.some((t) => t.getAttribute('type') === 'stop');
        if (isTieStop) {
          if (!isChord) currentTime += durationSec;
          prevDuration = durationSec;
          return;
        }

        const pitchEl = noteEl.querySelector('pitch');
        if (!pitchEl) {
          if (!isChord) currentTime += durationSec;
          prevDuration = durationSec;
          return;
        }

        const step = pitchEl.querySelector('step')?.textContent ?? 'C';
        const alter = parseFloat(pitchEl.querySelector('alter')?.textContent ?? '0');
        const octave = parseInt(pitchEl.querySelector('octave')?.textContent ?? '4', 10);
        const pitch = midiPitchFromXmlPitch(step, alter, octave);

        const noteStart = isChord ? currentTime - chordOffset : currentTime;

        // Handle tie start — find duration by including tied successors
        // (simplified: just use the written duration)
        const velocity = 80;

        allNotes.push({
          pitch,
          startTime: noteStart,
          duration: Math.max(durationSec - 0.02, 0.05),
          velocity,
          track: partIdx,
        });

        if (!isChord) {
          prevDuration = durationSec;
          currentTime += durationSec;
        }
      });
    });
  });

  allNotes.sort((a, b) => a.startTime - b.startTime);
  const musicDuration =
    allNotes.length > 0 ? Math.max(...allNotes.map((n) => n.startTime + n.duration)) : START_PADDING;

  const totalDuration = musicDuration + END_PADDING;

  return { notes: allNotes, bpm, totalDuration };
}

export async function parseMxl(buffer: ArrayBuffer, filename: string): Promise<ParsedSong> {
  const zip = await JSZip.loadAsync(buffer);

  // Find the root MusicXML file (could be .xml or .musicxml)
  let xmlString: string | null = null;

  // First, check META-INF/container.xml for the root file path
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    const containerXml = await containerFile.async('string');
    const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const rootFile = containerDoc.querySelector('rootfile');
    const rootPath = rootFile?.getAttribute('full-path');
    if (rootPath) {
      const musicFile = zip.file(rootPath);
      if (musicFile) xmlString = await musicFile.async('string');
    }
  }

  // Fallback: find any .xml or .musicxml file in the root or any path
  if (!xmlString) {
    const xmlFiles = Object.keys(zip.files).filter(
      (name) =>
        !zip.files[name].dir &&
        (name.endsWith('.xml') || name.endsWith('.musicxml')) &&
        !name.startsWith('META-INF')
    );
    if (xmlFiles.length > 0) {
      xmlString = await zip.file(xmlFiles[0])!.async('string');
    }
  }

  if (!xmlString) throw new Error('No MusicXML found inside .mxl archive');

  const { notes, bpm, totalDuration } = parseMusicXmlNotes(xmlString);

  return { notes, totalDuration, bpm, musicXml: xmlString, filename };
}
