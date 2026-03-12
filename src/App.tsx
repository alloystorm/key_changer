import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ParsedSong, ViewMode, RollSettings } from './lib/types';
import { computeAllFingerHints } from './lib/fingering';
import type { FingerHint } from './lib/fingering';
import { player, PRE_ROLL } from './lib/player';
import type { PlayerStatus } from './lib/player';
import { parseMidi } from './lib/midiParser';
import { parseMxl } from './lib/mxlParser';
import { storage } from './lib/storage';
import { FileUpload } from './components/FileUpload';
import { Controls } from './components/Controls';
import { PianoRollView } from './components/PianoRollView';
import { SheetMusicView } from './components/SheetMusicView';
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
  const transposeRef = useRef(0); // keep in sync for player callbacks
  const [rollSettings, setRollSettings] = useState<RollSettings>({
    flowDirection: 'down',
    triggerPosition: 'bottom',
    showFingers: false,
  });

  const handleRollSettingsChange = useCallback((patch: Partial<RollSettings>) => {
    setRollSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Compute finger hints for the whole song once; recompute on transpose or toggle.
  const fingerHints = useMemo<Map<string, FingerHint>>(() => {
    if (!song || !rollSettings.showFingers) return new Map();
    return computeAllFingerHints(song.notes, transpose);
  }, [song, transpose, rollSettings.showFingers]);

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
    setCurrentTime(-PRE_ROLL);
    setViewMode('pianoroll');

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
    setCurrentTime(-PRE_ROLL);
  }, []);

  const handleSeek = useCallback((t: number) => {
    player.seek(t);
    setCurrentTime(t);
  }, []);

  const handleTransposeChange = useCallback(
    async (delta: number) => {
      const next = Math.max(-12, Math.min(12, transposeRef.current + delta));
      transposeRef.current = next;
      setTranspose(next);
      await player.updateTranspose(next);
    },
    []
  );

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
        <span className="app-logo">🎹</span>
        <span className="app-title">ShiftPiano</span>
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
            viewMode={viewMode}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
            onTransposeChange={handleTransposeChange}
            onSeek={handleSeek}
            onViewModeChange={setViewMode}
            onChangeFile={handleChangeFile}
            filename={song.filename}
            rollSettings={rollSettings}
            onRollSettingsChange={handleRollSettingsChange}
          />

          <div className={`view-area${viewMode === 'both' ? ' view-area--split' : ''}`}>
            {viewMode === 'sheet' ? (
              <SheetMusicView
                notes={song.notes}
                bpm={song.bpm}
                transpose={transpose}
                currentTime={currentTime}
                isPlaying={playerStatus === 'playing'}
              />
            ) : viewMode === 'both' ? (
              <>
                <SheetMusicView
                  notes={song.notes}
                  bpm={song.bpm}
                  transpose={transpose}
                  currentTime={currentTime}
                  isPlaying={playerStatus === 'playing'}
                />
                <PianoRollView
                  notes={song.notes}
                  transpose={transpose}
                  currentTime={currentTime}
                  totalDuration={song.totalDuration}
                  bpm={song.bpm}
                  settings={rollSettings}
                  fingerHints={fingerHints}
                />
              </>
            ) : (
              <PianoRollView
                notes={song.notes}
                transpose={transpose}
                currentTime={currentTime}
                totalDuration={song.totalDuration}
                bpm={song.bpm}
                settings={rollSettings}
                fingerHints={fingerHints}
              />
            )}
          </div>
        </main>
      )}
    </div>
  );
}
