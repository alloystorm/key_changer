import { useState, useCallback, useRef, useEffect } from 'react';
import type { ParsedSong, ViewMode } from './lib/types';
import { player } from './lib/player';
import type { PlayerStatus } from './lib/player';
import { FileUpload } from './components/FileUpload';
import { Controls } from './components/Controls';
import { PianoRollView } from './components/PianoRollView';
import { SheetMusicView } from './components/SheetMusicView';
import './App.css';

export default function App() {
  const [song, setSong] = useState<ParsedSong | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('pianoroll');
  const [transpose, setTranspose] = useState(0);
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const transposeRef = useRef(0); // keep in sync for player callbacks

  // Wire player callbacks on mount
  useEffect(() => {
    player.onStatusChange = setPlayerStatus;
    player.onTimeUpdate = (t) => setCurrentTime(t);
    return () => {
      player.stop();
    };
  }, []);

  const handleSongLoaded = useCallback(async (loaded: ParsedSong) => {
    setFileLoading(false);
    setError(null);
    setSong(loaded);
    setTranspose(0);
    transposeRef.current = 0;
    setCurrentTime(0);
    setViewMode('pianoroll');

    await player.load(loaded.notes, loaded.bpm, 0);
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

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">🎹</span>
        <span className="app-title">Key Changer</span>
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
            hasMusicXml={!!song.musicXml}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
            onTransposeChange={handleTransposeChange}
            onSeek={handleSeek}
            onViewModeChange={setViewMode}
            onChangeFile={handleChangeFile}
            filename={song.filename}
          />

          <div className="view-area">
            {viewMode === 'pianoroll' ? (
              <PianoRollView
                notes={song.notes}
                transpose={transpose}
                currentTime={currentTime}
                totalDuration={song.totalDuration}
              />
            ) : (
              song.musicXml && (
                <SheetMusicView
                  xmlString={song.musicXml}
                  transpose={transpose}
                  currentTime={currentTime}
                  isPlaying={playerStatus === 'playing'}
                />
              )
            )}
          </div>
        </main>
      )}
    </div>
  );
}
