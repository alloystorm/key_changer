import type { PlayerStatus } from '../lib/player';
import type { ViewMode } from '../lib/types';
import './Controls.css';

// ── Key name helpers ────────────────────────────────────────────────────────
const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

function keyLabel(transpose: number): string {
  // Assume original key is C; show target key
  const mod = ((transpose % 12) + 12) % 12;
  return KEY_NAMES[mod];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  status: PlayerStatus;
  transpose: number;
  currentTime: number;
  totalDuration: number;
  bpm: number;
  viewMode: ViewMode;
  hasMusicXml: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onTransposeChange: (delta: number) => void;
  onSeek: (t: number) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onChangeFile: () => void;
  filename: string;
}

export function Controls({
  status,
  transpose,
  currentTime,
  totalDuration,
  bpm,
  viewMode,
  hasMusicXml,
  onPlay,
  onPause,
  onStop,
  onTransposeChange,
  onSeek,
  onViewModeChange,
  onChangeFile,
  filename,
}: Props) {
  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';
  const progress = totalDuration > 0 ? currentTime / totalDuration : 0;

  return (
    <div className="controls">
      {/* ── Row 1: file name + view toggle ─────────────────────────── */}
      <div className="controls-row controls-row--top">
        <button className="btn btn-ghost btn-sm" onClick={onChangeFile} title="Load different file">
          📂 <span className="filename">{filename}</span>
        </button>

        {hasMusicXml && (
          <div className="view-toggle">
            <button
              className={`btn btn-sm ${viewMode === 'pianoroll' ? 'btn-active' : ''}`}
              onClick={() => onViewModeChange('pianoroll')}
            >
              🎹 Piano Roll
            </button>
            <button
              className={`btn btn-sm ${viewMode === 'sheet' ? 'btn-active' : ''}`}
              onClick={() => onViewModeChange('sheet')}
            >
              🎼 Sheet Music
            </button>
          </div>
        )}
      </div>

      {/* ── Row 2: transport + key shift ───────────────────────────── */}
      <div className="controls-row controls-row--transport">
        {/* Playback buttons */}
        <div className="transport-buttons">
          <button
            className="btn btn-icon"
            onClick={onStop}
            disabled={isLoading || status === 'idle' || status === 'ready'}
            title="Stop"
          >
            ⏹
          </button>
          <button
            className="btn btn-icon btn-primary"
            onClick={isPlaying ? onPause : onPlay}
            disabled={isLoading || status === 'idle'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? '⏳' : isPlaying ? '⏸' : '▶'}
          </button>
        </div>

        {/* Seek bar */}
        <div className="seek-area">
          <span className="time-label">{formatTime(currentTime)}</span>
          <input
            type="range"
            className="seek-bar"
            min={0}
            max={totalDuration || 1}
            step={0.1}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            disabled={isLoading}
          />
          <span className="time-label">{formatTime(totalDuration)}</span>
        </div>

        {/* Key shift */}
        <div className="key-shift">
          <button
            className="btn btn-icon"
            onClick={() => onTransposeChange(-1)}
            disabled={isLoading || transpose <= -12}
            title="Shift down 1 semitone"
          >
            ♭
          </button>
          <div className="key-display" title={`Transposing ${transpose >= 0 ? '+' : ''}${transpose} semitones`}>
            <span className="key-label">{keyLabel(transpose)}</span>
            {transpose !== 0 && (
              <span className="key-offset">{transpose > 0 ? `+${transpose}` : transpose}</span>
            )}
          </div>
          <button
            className="btn btn-icon"
            onClick={() => onTransposeChange(+1)}
            disabled={isLoading || transpose >= 12}
            title="Shift up 1 semitone"
          >
            ♯
          </button>
        </div>

        {/* BPM */}
        <div className="bpm-display">
          <span className="bpm-value">{Math.round(bpm)}</span>
          <span className="bpm-unit">BPM</span>
        </div>
      </div>
    </div>
  );
}
