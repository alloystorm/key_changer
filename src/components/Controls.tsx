import type { PlayerStatus } from '../lib/player';
import type { ViewMode, RollSettings } from '../lib/types';
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
  playbackRate: number;
  viewMode: ViewMode;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onTransposeChange: (delta: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onSeek: (t: number) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onChangeFile: () => void;
}

export function Controls({
  status,
  transpose,
  currentTime,
  totalDuration,
  bpm,
  playbackRate,
  viewMode,
  onPlay,
  onPause,
  onStop,
  onTransposeChange,
  onPlaybackRateChange,
  onSeek,
  onViewModeChange,
  onChangeFile,
}: Props) {
  const isPlaying = status === 'playing';
  const isLoading = status === 'loading';
  // Clamp to 0 during the pre-roll phase so the UI never shows negative time
  const displayTime = Math.max(0, currentTime);

  return (
    <div className="controls" onMouseDown={(e) => e.stopPropagation()}>
      {/* ── Transport + key shift ── */}
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
          <span className="time-label">{formatTime(displayTime)}</span>
          <input
            type="range"
            className="seek-bar"
            min={0}
            max={totalDuration || 1}
            step={0.1}
            value={displayTime}
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

        {/* BPM / Speed Control */}
        <div 
          className="bpm-display"
          title="Drag up/down to change speed, double-click to reset"
          onMouseDown={(e) => {
            e.stopPropagation();
            const startY = e.clientY;
            const startRate = playbackRate;
            const onMouseMove = (moveEvent: MouseEvent) => {
              const deltaY = startY - moveEvent.clientY;
              const newRate = startRate + (deltaY / 100);
              onPlaybackRateChange(newRate);
            };
            const onMouseUp = () => {
              window.removeEventListener('mousemove', onMouseMove);
              window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onPlaybackRateChange(1.0);
          }}
          style={{ cursor: 'ns-resize', userSelect: 'none' }}
        >
          <span className="bpm-value">{Math.round(bpm * playbackRate)}</span>
          <span className="bpm-unit">{playbackRate === 1 ? 'BPM' : `${Math.round(playbackRate * 100)}%`}</span>
        </div>
      </div>
    </div>
  );
}
