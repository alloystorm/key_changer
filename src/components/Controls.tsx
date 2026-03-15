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

function ChevronUpIcon() {
  return (
    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 5L5 1L9 5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1L5 5L9 1" />
    </svg>
  );
}

const DragHandle = () => (
  <svg width="14" height="5" viewBox="0 0 14 5" aria-hidden="true" style={{ display: 'block', margin: '3px auto 0', opacity: 0.28 }}>
    <rect y="0"   width="14" height="1" rx="0.5" fill="currentColor" />
    <rect y="2"   width="14" height="1" rx="0.5" fill="currentColor" />
    <rect y="4"   width="14" height="1" rx="0.5" fill="currentColor" />
  </svg>
);

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

        {/* Key Shift — vertical spinner */}
        <div className="spinner-ctl">
          <button
            className="spinner-ctl__arrow"
            onClick={() => onTransposeChange(+1)}
            disabled={isLoading || transpose >= 12}
            title="Shift up 1 semitone"
          >
            <ChevronUpIcon />
          </button>
          <div
            className="spinner-ctl__value"
            title={`Transposing ${transpose >= 0 ? '+' : ''}${transpose} semitones`}
          >
            <span className="spinner-ctl__main">{keyLabel(transpose)}</span>
            <span className={`spinner-ctl__sub${transpose !== 0 ? ' spinner-ctl__sub--accent' : ''}`}>
              {transpose !== 0 ? (transpose > 0 ? `+${transpose}` : String(transpose)) : 'key'}
            </span>
          </div>
          <button
            className="spinner-ctl__arrow"
            onClick={() => onTransposeChange(-1)}
            disabled={isLoading || transpose <= -12}
            title="Shift down 1 semitone"
          >
            <ChevronDownIcon />
          </button>
        </div>

        {/* Speed — vertical spinner (arrows = ±5%, centre = drag for fine control) */}
        <div className="spinner-ctl">
          <button
            className="spinner-ctl__arrow"
            onClick={() => onPlaybackRateChange(playbackRate + 0.05)}
            disabled={isLoading}
            title="Speed up"
          >
            <ChevronUpIcon />
          </button>
          <div
            className="spinner-ctl__value spinner-ctl__value--grab"
            title="Drag up/down to fine-tune speed · double-click to reset"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const startY = e.clientY;
              const startRate = playbackRate;
              const onPointerMove = (mv: PointerEvent) => {
                onPlaybackRateChange(startRate + (startY - mv.clientY) / 100);
              };
              const onPointerUp = (up: PointerEvent) => {
                up.currentTarget?.removeEventListener('pointermove', onPointerMove as any);
                up.currentTarget?.removeEventListener('pointerup', onPointerUp as any);
              };
              e.currentTarget.addEventListener('pointermove', onPointerMove as any);
              e.currentTarget.addEventListener('pointerup', onPointerUp as any);
            }}
            onDoubleClick={(e) => { e.stopPropagation(); onPlaybackRateChange(1.0); }}
          >
            <span className="spinner-ctl__main">{Math.round(bpm * playbackRate)}</span>
            <span className={`spinner-ctl__sub${playbackRate !== 1 ? ' spinner-ctl__sub--accent' : ''}`}>
              {playbackRate === 1 ? 'bpm' : `${Math.round(playbackRate * 100)}%`}
            </span>
            <DragHandle />
          </div>
          <button
            className="spinner-ctl__arrow"
            onClick={() => onPlaybackRateChange(playbackRate - 0.05)}
            disabled={isLoading}
            title="Slow down"
          >
            <ChevronDownIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
