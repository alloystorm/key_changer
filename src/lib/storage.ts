// We use raw IndexedDB for zero-dependency simplicity.

// We'll use a simple wrapper for now to avoid adding 'idb' dependency if possible, 
// but 'idb' is standard. Let's see if it's in package.json.
// Wait, 'idb' is not in package.json. I should use raw IndexedDB or install it.
// I'll use raw IndexedDB for zero-dependency simplicity unless it gets complex.

const DB_NAME = 'KeyChangerDB';
const DB_VERSION = 1;
const STORE_NAME = 'songs';

export interface StoredSong {
  id: string; // generated from name + timestamp or hash
  name: string;
  data: ArrayBuffer;
  type: 'midi' | 'mxl';
  dateAdded: number;
}

export interface SongMetadata {
  id: string;
  name: string;
  type: 'midi' | 'mxl';
  dateAdded: number;
}

class Storage {
  private db: IDBDatabase | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  async saveSong(name: string, data: ArrayBuffer, type: 'midi' | 'mxl'): Promise<string> {
    const db = await this.getDB();
    const id = btoa(name + Date.now()).substring(0, 16);
    const song: StoredSong = {
      id,
      name,
      data,
      type,
      dateAdded: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(song);

      request.onsuccess = () => resolve(id);
      request.onerror = () => reject(request.error);
    });
  }

  async getSongs(): Promise<SongMetadata[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      // We only want metadata to keep it fast
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result as StoredSong[];
        resolve(
          results.map(({ id, name, type, dateAdded }) => ({
            id,
            name,
            type,
            dateAdded,
          }))
        );
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getSongData(id: string): Promise<StoredSong | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteSong(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const storage = new Storage();
