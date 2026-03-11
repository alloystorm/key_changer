/** A single note event extracted from a MIDI or MXL file */
export interface NoteEvent {
  /** MIDI pitch number (0–127). Middle C = 60. */
  pitch: number;
  /** Start time in seconds from beginning of song */
  startTime: number;
  /** Duration in seconds */
  duration: number;
  /** Velocity 0–127 */
  velocity: number;
  /** Track/part index (for colouring) */
  track: number;
}

export interface ParsedSong {
  notes: NoteEvent[];
  /** Total song duration in seconds */
  totalDuration: number;
  /** Beats per minute (tempo) */
  bpm: number;
  /** Raw MusicXML string — only present when loaded from .mxl/.xml */
  musicXml?: string;
  /** Original filename */
  filename: string;
}

export type FileType = 'midi' | 'mxl';

export type ViewMode = 'pianoroll' | 'sheet';
