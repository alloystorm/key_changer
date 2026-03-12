import { useEffect, useState } from 'react';
import { storage, SongMetadata } from '../lib/storage';
import './SongLibrary.css';

interface Props {
  onLoadSong: (id: string) => void;
  loading: boolean;
}

export function SongLibrary({ onLoadSong, loading }: Props) {
  const [songs, setSongs] = useState<SongMetadata[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    storage.getSongs().then(setSongs);
  }, [refreshKey]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this song from your library?')) {
      await storage.deleteSong(id);
      setRefreshKey(k => k + 1);
    }
  };

  if (songs.length === 0) return null;

  return (
    <div className="song-library">
      <div className="library-header">
        <h3>Your Library</h3>
        <span className="library-count">{songs.length} pieces saved</span>
      </div>
      <div className="library-grid">
        {songs.map((song) => (
          <div 
            key={song.id} 
            className={`library-item ${loading ? 'disabled' : ''}`}
            onClick={() => !loading && onLoadSong(song.id)}
          >
            <div className="item-info">
              <span className="item-icon">{song.type === 'midi' ? '🎹' : '🎼'}</span>
              <div className="item-details">
                <span className="item-name">{song.name}</span>
                <span className="item-meta">
                  {new Date(song.dateAdded).toLocaleDateString()} • {song.type.toUpperCase()}
                </span>
              </div>
            </div>
            <button 
              className="delete-btn" 
              onClick={(e) => handleDelete(e, song.id)}
              title="Remove from library"
              disabled={loading}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
