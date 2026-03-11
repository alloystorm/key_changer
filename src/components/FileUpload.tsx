import { useRef, useCallback } from 'react';
import type { ParsedSong } from '../lib/types';
import { parseMidi } from '../lib/midiParser';
import { parseMxl } from '../lib/mxlParser';
import './FileUpload.css';

interface Props {
  onSongLoaded: (song: ParsedSong) => void;
  onError: (msg: string) => void;
  loading: boolean;
}

export function FileUpload({ onSongLoaded, onError, loading }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const name = file.name.toLowerCase();
      const isMidi = name.endsWith('.mid') || name.endsWith('.midi');
      const isMxl =
        name.endsWith('.mxl') || name.endsWith('.xml') || name.endsWith('.musicxml');

      if (!isMidi && !isMxl) {
        onError('Unsupported file type. Please load a .mid, .midi, .mxl, or .musicxml file.');
        return;
      }

      try {
        const buffer = await file.arrayBuffer();
        const song = isMidi
          ? await parseMidi(buffer, file.name)
          : await parseMxl(buffer, file.name);
        onSongLoaded(song);
      } catch (err) {
        onError(`Failed to parse file: ${(err as Error).message}`);
      }
    },
    [onSongLoaded, onError]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div
      className={`file-upload ${loading ? 'loading' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      aria-label="Load MIDI or MXL file"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".mid,.midi,.mxl,.xml,.musicxml"
        style={{ display: 'none' }}
        onChange={onInputChange}
      />
      {loading ? (
        <span className="upload-icon">⏳</span>
      ) : (
        <>
          <span className="upload-icon">🎵</span>
          <p className="upload-primary">Drop a MIDI or MXL file here</p>
          <p className="upload-secondary">or click to browse</p>
          <p className="upload-hint">.mid · .midi · .mxl · .musicxml</p>
        </>
      )}
    </div>
  );
}
