import type { PlayerStatus } from '../lib/player';
import './Controls.css';

// ── Inline SVG icons (platform-consistent rendering) ─────────────────────────
function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <polygon points="2,1 11,6 2,11" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <rect x="1.5" y="1" width="3.5" height="10" rx="1" />
      <rect x="7" y="1" width="3.5" height="10" rx="1" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <rect x="1" y="1" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="4.5" strokeDasharray="14 8" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur="0.8s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

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
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onTransposeChange: (delta: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onSeek: (t: number) => void;
  onChangeFile: () => void;
}

export function Controls({
  status,
  transpose,
  currentTime,
  totalDuration,
  bpm,
  playbackRate,
  onPlay,
  onPause,
  onStop,
  onTransposeChange,
  onPlaybackRateChange,
  onSeek,
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
            <StopIcon />
          </button>
          <button
            className="btn btn-icon btn-primary"
            onClick={isPlaying ? onPause : onPlay}
            disabled={isLoading || status === 'idle'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading ? <LoadingIcon /> : isPlaying ? <PauseIcon /> : <PlayIcon />}
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
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const startY = e.clientY;
            const startRate = playbackRate;
            
            const onPointerMove = (moveEvent: PointerEvent) => {
              const deltaY = startY - moveEvent.clientY;
              const newRate = startRate + (deltaY / 100);
              onPlaybackRateChange(newRate);
            };
            
            const onPointerUp = (upEvent: PointerEvent) => {
              upEvent.currentTarget?.removeEventListener('pointermove', onPointerMove as any);
              upEvent.currentTarget?.removeEventListener('pointerup', onPointerUp as any);
            };

            e.currentTarget.addEventListener('pointermove', onPointerMove as any);
            e.currentTarget.addEventListener('pointerup', onPointerUp as any);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onPlaybackRateChange(1.0);
          }}
          style={{ cursor: 'ns-resize', userSelect: 'none', touchAction: 'none' }}
        >
          <span className="bpm-value">{Math.round(bpm * playbackRate)}</span>
          <span className="bpm-unit">{playbackRate === 1 ? 'BPM' : `${Math.round(playbackRate * 100)}%`}</span>
        </div>
      </div>
    </div>
  );
}
