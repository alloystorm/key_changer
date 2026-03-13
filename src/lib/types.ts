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
  /** Finger number assigned by the fingering algorithm (1=thumb … 5=pinky) */
  finger?: 1 | 2 | 3 | 4 | 5;
  /** Which hand this note is assigned to */
  hand?: 'right' | 'left';
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

export type ViewMode = 'pianoroll' | 'sheet' | 'both';

/** Which direction notes travel */
export type FlowDirection = 'down' | 'up';

/**
 * Where on the roll the "play line" (trigger point) sits.
 * 'bottom' = flush with keyboard (default, notes fall onto keys)
 * 'middle' = halfway up the roll
 * 'top'    = near the top (notes travel a long way before triggering)
 */
export type TriggerPosition = 'bottom' | 'middle' | 'top';

export interface RollSettings {
  flowDirection: FlowDirection;
  triggerPosition: TriggerPosition;
  showFingers: boolean;
}
