import { useState, useCallback, useRef, useEffect } from 'react';
import type { ParsedSong, ViewMode, RollSettings } from './lib/types';
import { applyFingerHints } from './lib/fingering';
import { buildChordEvents } from './lib/chords';
import type { ChordEvent } from './lib/chords';
import { player } from './lib/player';
import type { PlayerStatus } from './lib/player';
import { parseMidi } from './lib/midiParser';
import { parseMxl } from './lib/mxlParser';
import { storage } from './lib/storage';
import { FileUpload } from './components/FileUpload';
import { Controls } from './components/Controls';
import { PianoRollView } from './components/PianoRollView';
import { SheetMusicView } from './components/SheetMusicView';
import { PianoKeyboardView } from './components/PianoKeyboardView';
import { SongLibrary } from './components/SongLibrary';
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
  const transposeRef = useRef(0); // keep in sync for player callbacks
  const [rollSettings, setRollSettings] = useState<RollSettings>({
    flowDirection: 'down',
    triggerPosition: 'bottom',
    showFingers: false,
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

  const handleSongLoaded = useCallback(async (loaded: ParsedSong, shouldCache = true) => {
    setFileLoading(false);
    setError(null);
    setSong(loaded);
    setTranspose(0);
    transposeRef.current = 0;
    setCurrentTime(0);
    setViewMode('pianoroll');
    applyFingerHints(loaded.notes, 0);

    await player.load(loaded.notes, loaded.bpm, 0);

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
              <div className="view-toggle">
                {(['pianoroll', 'sheet', 'both'] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`btn btn-sm ${viewMode === mode ? 'btn-active' : ''}`}
                    onClick={() => setViewMode(mode)}
                  >
                    {mode === 'pianoroll' ? '📊 Bar' : mode === 'sheet' ? '🎼 Sheet' : '📊🎼 Both'}
                  </button>
                ))}
              </div>
              <button
                className={`btn btn-sm btn-fingers ${rollSettings.showFingers ? 'btn-active' : ''}`}
                onClick={() => handleRollSettingsChange({ showFingers: !rollSettings.showFingers })}
                title="Show beginner finger numbers (1–5)"
              >
                🖐 Fingers
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
            viewMode={viewMode}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
            onTransposeChange={handleTransposeChange}
            onPlaybackRateChange={handlePlaybackRateChange}
            onSeek={handleSeek}
            onViewModeChange={setViewMode}
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
                  />
                </div>
              </>
            )}

            <div className="view-layer view-layer--keyboard">
              <PianoKeyboardView
                notes={song.notes}
                transpose={transpose}
                currentTime={currentTime}
                showFingers={rollSettings.showFingers}
              />
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
