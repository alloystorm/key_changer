import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ParsedSong, ViewMode, RollSettings } from './lib/types';
import { applyFingerHints } from './lib/fingering';
import { buildChordEvents } from './lib/chords';
import type { ChordEvent } from './lib/chords';
import { player } from './lib/player';
import type { PlayerStatus } from './lib/player';
import { parseMidi } from './lib/midiParser';
import { parseMxl } from './lib/mxlParser';
import { storage } from './lib/storage';
import { MIDI_LOW, MIDI_HIGH, SIDEBAR_WIDTH, countWhiteKeys } from './lib/layout';
import { FileUpload } from './components/FileUpload';
import { Controls } from './components/Controls';
import { PianoRollView } from './components/PianoRollView';
import { SheetMusicView } from './components/SheetMusicView';
import { PianoKeyboardView } from './components/PianoKeyboardView';
import { SongLibrary } from './components/SongLibrary';
import { ParticleOverlay } from './components/ParticleOverlay';
import './App.css';

const FEATURED_PIECES = [
  { name: 'Bach: Prelude in C Major', url: './music/bach_prelude_c_major.mid' },
  { name: 'Beethoven: Moonlight Sonata', url: './music/beethoven_moonlight_1.mid' },
  { name: 'Chopin: Nocturne Op. 9 No. 2', url: './music/chopin_nocturne_op9_n2.mid' },
  { name: 'Mozart: Turkish March', url: './music/mozart_turkish_march.mid' },
];

export default function App() {
  const [song, setSong] = useState<ParsedSong | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('pianoroll');
  const [transpose, setTranspose] = useState(0);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showParticles, setShowParticles] = useState(true);
  const [keyboardWidth, setKeyboardWidth] = useState(0);
  const transposeRef = useRef(0); // keep in sync for player callbacks
  const windowCenterRef = useRef(60); // smoothed MIDI centroid for windowed key range
  const [rollSettings, setRollSettings] = useState<RollSettings>({
    flowDirection: 'down',
    triggerPosition: 'bottom',
    showFingers: true,
  });

  const handleRollSettingsChange = useCallback((patch: Partial<RollSettings>) => {
    setRollSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Wire player callbacks on mount
  useEffect(() => {
    player.onStatusChange = setPlayerStatus;
    player.onTimeUpdate = (t) => setCurrentTime(t);
    return () => {
      player.stop();
    };
  }, []);

  // Screen Wake Lock logic
  const wakeLockRef = useRef<any>(null);

  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      console.log('Wake Lock acquired');
      wakeLockRef.current.addEventListener('release', () => {
        console.log('Wake Lock released');
      });
    } catch (err) {
      console.error(`${(err as Error).name}, ${(err as Error).message}`);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (playerStatus === 'playing') {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [playerStatus, requestWakeLock, releaseWakeLock]);

  // Re-acquire wake lock on visibility change if playing
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (wakeLockRef.current !== null && document.visibilityState === 'visible' && playerStatus === 'playing') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [playerStatus, requestWakeLock]);

  const handleSongLoaded = useCallback(async (loaded: ParsedSong, shouldCache = true) => {
    setFileLoading(false);
    setError(null);
    setSong(loaded);
    setTranspose(0);
    transposeRef.current = 0;
    setCurrentTime(0);
    setViewMode('pianoroll');
    applyFingerHints(loaded.notes, 0);

    await player.load(loaded.notes, loaded.bpm, 0, loaded.totalDuration);

    // Cache the song if it's not already from the library
    if (shouldCache) {
      try {
        // We need the raw data to cache it effectively. 
        // For uploaded files, this is already done in FileUpload or handleLoadUrl.
        // Wait, handleSongLoaded only gets ParsedSong. 
        // I should probably cache at the point of parsing.
      } catch (err) {
        console.error('Failed to cache song:', err);
      }
    }
  }, []);

  const handleFileError = useCallback((msg: string) => {
    setFileLoading(false);
    setError(msg);
  }, []);

  const handlePlay = useCallback(() => {
    player.play();
  }, []);

  const handlePause = useCallback(() => {
    player.pause();
  }, []);

  const handleStop = useCallback(() => {
    player.stop();
    setCurrentTime(0);
  }, []);

  const handleSeek = useCallback((t: number) => {
    if (!song) return;
    const clamped = Math.max(0, Math.min(t, song.totalDuration));
    player.seek(clamped);
    setCurrentTime(clamped);
  }, [song]);

  const handleTransposeChange = useCallback(
    async (delta: number) => {
      const next = Math.max(-12, Math.min(12, transposeRef.current + delta));
      transposeRef.current = next;
      setTranspose(next);
      await player.updateTranspose(next);
    },
    []
  );

  const handlePlaybackRateChange = useCallback((rate: number) => {
    const next = Math.max(0.1, Math.min(4.0, rate));
    setPlaybackRate(next);
    player.setPlaybackRate(next);
  }, []);

  const handleChangeFile = useCallback(() => {
    player.stop();
    setSong(null);
    setCurrentTime(0);
    setTranspose(0);
    transposeRef.current = 0;
  }, []);

  const handleLoadUrl = useCallback(async (name: string, url: string) => {
    setFileLoading(true);
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      const isMidi = url.toLowerCase().endsWith('.mid') || url.toLowerCase().endsWith('.midi');
      const loaded = isMidi
        ? await parseMidi(buffer, name)
        : await parseMxl(buffer, name);
      
      handleSongLoaded(loaded, false);
    } catch (err) {
      handleFileError((err as Error).message);
    } finally {
      setFileLoading(false);
    }
  }, [handleSongLoaded, handleFileError]);

  const handleLoadFromLibrary = useCallback(async (id: string) => {
    setFileLoading(true);
    setError(null);
    try {
      const songData = await storage.getSongData(id);
      if (!songData) throw new Error('Song not found in library');

      const loaded = songData.type === 'midi'
        ? await parseMidi(songData.data, songData.name)
        : await parseMxl(songData.data, songData.name);
      
      handleSongLoaded(loaded, false);
    } catch (err) {
      handleFileError((err as Error).message);
    } finally {
      setFileLoading(false);
    }
  }, [handleSongLoaded, handleFileError]);

  const keyboardContainerRef = useRef<HTMLDivElement>(null);

  // Track keyboard container width for dynamic key range.
  // Must depend on `song` because the keyboard div only mounts after a song loads;
  // the ref is null on initial mount so an empty-dep effect would never attach.
  useEffect(() => {
    const container = keyboardContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setKeyboardWidth(entry.contentRect.width);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [song]);

  // Rolling window: how far ahead/behind currentTime to scan when computing pitch range
  const RANGE_LOOKAHEAD = 6;   // seconds
  const RANGE_LOOKBACK  = 1;   // seconds
  const RANGE_PAD       = 2;   // semitone padding either side

  // Compute pitch range from notes in the rolling window around currentTime.
  // On wider screens this is moot (full 88 shown). On narrow screens the
  // keyboard trims itself to only the pitches actually coming up soon.
  const songRange = useMemo(() => {
    if (!song) return null;
    let lo = 127, hi = 0;
    const wStart = currentTime - RANGE_LOOKBACK;
    const wEnd   = currentTime + RANGE_LOOKAHEAD;
    for (const n of song.notes) {
      if (n.startTime + n.duration < wStart) continue;
      if (n.startTime > wEnd) break; // notes are time-sorted
      const p = n.pitch + transpose;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    if (lo > hi) return null;
    return {
      low:  Math.max(MIDI_LOW,  lo - RANGE_PAD),
      high: Math.min(MIDI_HIGH, hi + RANGE_PAD),
    };
  }, [song, transpose, currentTime]);

  // ────────────────────────────────────────────────────────────────────
  // Key range thresholds (CSS pixels per white key)
  // ────────────────────────────────────────────────────────────────────
  //  ≥ FULL_RANGE_MIN_PX  →  all 88 keys shown regardless of song range
  //    (landscape phones ~10–17px per key, tablets ~15–25px, desktop ~20–30px)
  //  < FULL_RANGE_MIN_PX  →  trim to song’s actual pitch range
  //  < SONG_RANGE_MIN_PX  →  windowed mode (pan to follow active notes)
  const FULL_RANGE_MIN_PX = 12;
  const SONG_RANGE_MIN_PX = 6;

  // Compute visible key range: trims to song range on narrow screens,
  // and pans to follow active notes when even the song range is too wide.
  // windowCenterRef is smoothed in the rAF loop (fps-independent); read-only in useMemo.
  const windowCenterTargetRef = useRef(60); // raw centroid target written by useMemo
  const keyRange = useMemo(() => {
    if (!song || !songRange || keyboardWidth === 0) return { low: MIDI_LOW, high: MIDI_HIGH };
    const rollWidth = Math.max(1, keyboardWidth - SIDEBAR_WIDTH);

    // Enough room for full 88 keys — show them all
    if (rollWidth / 52 >= FULL_RANGE_MIN_PX) {
      return { low: MIDI_LOW, high: MIDI_HIGH };
    }

    const { low: songLow, high: songHigh } = songRange;
    const songWhites = countWhiteKeys(songLow, songHigh);

    // Enough room for song’s actual pitch range
    if (songWhites === 0 || rollWidth / songWhites >= SONG_RANGE_MIN_PX) {
      return { low: songLow, high: songHigh };
    }

    // Windowed mode: screen too narrow for full song range — pan to follow notes
    const maxWhites = Math.max(7, Math.floor(rollWidth / SONG_RANGE_MIN_PX));

    // Compute centroid of notes in the next 4 seconds
    let sum = 0, count = 0;
    for (const note of song.notes) {
      if (note.startTime >= currentTime && note.startTime < currentTime + 4) {
        sum += note.pitch + transpose;
        count++;
      }
    }
    if (count > 0) windowCenterTargetRef.current = sum / count;

    // Derive a key window centred on the smoothed MIDI centroid (read-only here)
    const center = Math.round(windowCenterRef.current);
    const semitonesNeeded = Math.ceil((maxWhites / 7) * 12);
    let low = Math.max(MIDI_LOW, center - Math.floor(semitonesNeeded / 2));
    let high = Math.min(MIDI_HIGH, low + semitonesNeeded);
    if (high === MIDI_HIGH) low = Math.max(MIDI_LOW, high - semitonesNeeded);

    // Fine-tune: trim to exactly maxWhites white keys
    while (countWhiteKeys(low, high) > maxWhites && high > low) {
      if (center - low > high - center) low++;
      else high--;
    }
    return { low, high };
  }, [song, songRange, keyboardWidth, currentTime, transpose]);

  // ─── Smooth animation of the visible key range ──────────────────────────────
  // `animKeyRange` lags behind the discrete `keyRange` target, giving a zoom+pan
  // animation. A persistent rAF loop lerps toward `keyRangeTargetRef` every frame.
  // Using a ref for the target avoids restarting the loop on every keyRange change.
  const keyRangeTargetRef = useRef(keyRange);
  keyRangeTargetRef.current = keyRange; // updated synchronously every render

  const animRangeRef = useRef<{ low: number; high: number }>({ low: MIDI_LOW, high: MIDI_HIGH });
  const [animKeyRange, setAnimKeyRange] = useState<{ low: number; high: number }>(
    { low: MIDI_LOW, high: MIDI_HIGH }
  );

  // Animation speed — semitones per second. Increase for snappier pan/zoom.
  const ANIM_KEYS_PER_SEC = 6;
  // Stability buffer: target must hold for this many frames before we commit to it.
  // Absorbs ±1 flips caused by rolling-window boundary notes crossing currentTime.
  const STABLE_FRAMES = 4;
  const pendingTargetRef = useRef(keyRange);
  const pendingFramesRef = useRef(0);
  const committedTargetRef = useRef(keyRange);

  useEffect(() => {
    let rafId: number;
    let lastTs: number | null = null;

    const step = (ts: number) => {
      // Delta time in seconds; cap at 100 ms to survive tab-switch pauses
      const dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
      lastTs = ts;

      // ── Smooth windowed-mode centroid fps-independently (8 st/sec) ──────
      const cwTarget = windowCenterTargetRef.current;
      const cwCur    = windowCenterRef.current;
      const cwDelta  = cwTarget - cwCur;
      const cwMove   = Math.min(Math.abs(cwDelta), 8 * dt);
      if (cwMove > 0) windowCenterRef.current = cwCur + Math.sign(cwDelta) * cwMove;

      // ── Stability buffer: ignore single-frame target oscillations ────────
      const latest = keyRangeTargetRef.current;
      if (latest.low === pendingTargetRef.current.low &&
          latest.high === pendingTargetRef.current.high) {
        pendingFramesRef.current++;
        if (pendingFramesRef.current >= STABLE_FRAMES) committedTargetRef.current = latest;
      } else {
        pendingTargetRef.current = { low: latest.low, high: latest.high };
        pendingFramesRef.current = 1;
      }

      const target = committedTargetRef.current;
      const { low, high } = animRangeRef.current;

      // ── Instant snap on large jumps (new song / transpose ±octave) ───────
      if (Math.abs(target.low - low) > 20 || Math.abs(target.high - high) > 20) {
        animRangeRef.current = { low: target.low, high: target.high };
        setAnimKeyRange({ low: target.low, high: target.high });
        rafId = requestAnimationFrame(step);
        return;
      }

      // ── Constant-speed linear movement (fps-independent) ─────────────────
      const maxMove = ANIM_KEYS_PER_SEC * dt;
      const dLow    = target.low  - low;
      const dHigh   = target.high - high;
      const newLow  = Math.abs(dLow)  <= maxMove ? target.low  : low  + Math.sign(dLow)  * maxMove;
      const newHigh = Math.abs(dHigh) <= maxMove ? target.high : high + Math.sign(dHigh) * maxMove;

      if (newLow !== animRangeRef.current.low || newHigh !== animRangeRef.current.high) {
        animRangeRef.current = { low: newLow, high: newHigh };
        setAnimKeyRange({ low: newLow, high: newHigh });
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Continuous (float) white-key count drives the keyboard height:
  //   52 white keys span 87 semitones on a standard 88-note piano.
  const animWhiteCount = Math.max(7, (animKeyRange.high - animKeyRange.low) * (52 / 87));

  // Keyboard container height = natural proportion clamped to [60, 160] px.
  // `keyboardWidth` is tracked by ResizeObserver so this stays accurate after resize.
  const keyboardHeight =
    keyboardWidth > 0
      ? Math.round(Math.min(160, Math.max(60, (keyboardWidth / animWhiteCount) * 6)))
      : 100; // fallback before first measurement

  // Integer-rounded range for view components (canvas drawing uses integers).
  const viewKeyRange = {
    low:  Math.round(animKeyRange.low),
    high: Math.round(animKeyRange.high),
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <button className="btn-home" onClick={handleChangeFile} title="Go to home">
            <span className="app-logo">🎹</span>
            <span className="app-title">ShiftPiano</span>
          </button>
        </div>
        
        {song && (
          <div className="header-center">
            <span className="current-song-name">{song.filename}</span>
          </div>
        )}

        <div className="header-right">
          {song && (
            <>
              {song && (
                <div className="view-toggle">
                  <button
                    className={`btn btn-sm${viewMode !== 'sheet' ? ' btn-active' : ''}`}
                    onClick={() => {
                      if (viewMode === 'pianoroll') return;
                      if (viewMode === 'both') setViewMode('sheet');
                      else setViewMode('both');
                    }}
                    title="Piano Roll"
                  >
                    Bar
                  </button>
                  <button
                    className={`btn btn-sm${viewMode !== 'pianoroll' ? ' btn-active' : ''}`}
                    onClick={() => {
                      if (viewMode === 'sheet') return;
                      if (viewMode === 'both') setViewMode('pianoroll');
                      else setViewMode('both');
                    }}
                    title="Sheet Music"
                  >
                    Sheet
                  </button>
                </div>
              )}
              <button
                className={`btn btn-sm${rollSettings.showFingers ? ' btn-active' : ''}`}
                onClick={() => handleRollSettingsChange({ showFingers: !rollSettings.showFingers })}
                title="Show beginner finger numbers (1–5)"
              >
                Fingers
              </button>
              <button
                className={`btn btn-sm${showParticles ? ' btn-active' : ''}`}
                onClick={() => setShowParticles((v) => !v)}
                title="Toggle particle effects"
              >
                ✦ FX
              </button>
            </>
          )}
        </div>
      </header>

      {!song ? (
        <main className="app-landing">
          {error && <div className="error-banner">{error}</div>}
          <FileUpload
            onSongLoaded={(s) => { setFileLoading(true); handleSongLoaded(s); }}
            onError={handleFileError}
            loading={fileLoading}
          />
          <p className="landing-hint">
            Supports <b>.mid</b> / <b>.midi</b> <span className="sep">·</span> <b>.mxl</b> / <b>.musicxml</b>
          </p>

          <div className="featured-pieces">
            <h3>Try a classic piece:</h3>
            <div className="featured-grid">
              {FEATURED_PIECES.map((piece) => (
                <button
                  key={piece.url}
                  className="featured-item"
                  onClick={() => handleLoadUrl(piece.name, piece.url)}
                  disabled={fileLoading}
                >
                  <span className="featured-icon">🎹</span>
                  <span className="featured-name">{piece.name}</span>
                </button>
              ))}
            </div>
          </div>

          <SongLibrary onLoadSong={handleLoadFromLibrary} loading={fileLoading} />
        </main>
      ) : (
        <main className="app-player">
          <Controls
            status={playerStatus}
            transpose={transpose}
            currentTime={currentTime}
            totalDuration={song.totalDuration}
            bpm={song.bpm}
            playbackRate={playbackRate}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
            onTransposeChange={handleTransposeChange}
            onPlaybackRateChange={handlePlaybackRateChange}
            onSeek={handleSeek}
            onChangeFile={handleChangeFile}
          />

          <div className={`view-area view-area--${viewMode}`}>
            {viewMode === 'sheet' && (
              <div className="view-layer view-layer--sheet">
                <SheetMusicView
                  notes={song.notes}
                  bpm={song.bpm}
                  transpose={transpose}
                  currentTime={currentTime}
                  totalDuration={song.totalDuration}
                  isPlaying={playerStatus === 'playing'}
                  onSeek={handleSeek}
                />
              </div>
            )}
            
            {viewMode === 'pianoroll' && (
              <div className="view-layer view-layer--roll">
                <PianoRollView
                  notes={song.notes}
                  transpose={transpose}
                  currentTime={currentTime}
                  totalDuration={song.totalDuration}
                  bpm={song.bpm}
                  settings={rollSettings}
                  onSeek={handleSeek}
                  keyRange={animKeyRange}
                />
              </div>
            )}

            {viewMode === 'both' && (
              <>
                <div className="view-layer view-layer--sheet">
                  <SheetMusicView
                    notes={song.notes}
                    bpm={song.bpm}
                    transpose={transpose}
                    currentTime={currentTime}
                    totalDuration={song.totalDuration}
                    isPlaying={playerStatus === 'playing'}
                    onSeek={handleSeek}
                  />
                </div>
                <div className="view-layer view-layer--roll">
                  <PianoRollView
                    notes={song.notes}
                    transpose={transpose}
                    currentTime={currentTime}
                    totalDuration={song.totalDuration}
                    bpm={song.bpm}
                    settings={rollSettings}
                    onSeek={handleSeek}
                    keyRange={animKeyRange}
                  />
                </div>
              </>
            )}

            <div
              ref={keyboardContainerRef}
              className="view-layer view-layer--keyboard"
              style={{ height: keyboardHeight }}
            >
              <PianoKeyboardView
                notes={song.notes}
                transpose={transpose}
                currentTime={currentTime}
                showFingers={rollSettings.showFingers}
                keyRange={animKeyRange}
              />
            </div>

            <ParticleOverlay
              notes={song.notes}
              transpose={transpose}
              currentTime={currentTime}
              keyboardRef={keyboardContainerRef}
              enabled={showParticles}
              keyRange={viewKeyRange}
            />
          </div>
        </main>
      )}
    </div>
  );
}
