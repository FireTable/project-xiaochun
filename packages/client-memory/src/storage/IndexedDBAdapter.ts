import {
  emptyUserProfile,
  type EpisodeRecord,
  type LorebookEntry,
  type StorageAdapter,
  type TurnRecord,
  type UserProfile,
} from '../types';
import { AsyncMutex } from './AsyncMutex';

const DEFAULT_DB_NAME = 'client-memory-db';
const DB_VERSION = 1;

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDBAdapter implements StorageAdapter {
  private dbName: string;
  private db: IDBDatabase | null = null;
  private mutex = new AsyncMutex();
  private initPromise: Promise<void> | null = null;

  constructor(dbName = DEFAULT_DB_NAME) {
    this.dbName = dbName;
  }

  async init(): Promise<void> {
    if (!isIndexedDBAvailable()) {
      console.warn('[client-memory] IndexedDB is not available in current environment');
      return;
    }
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;

        // 1. turns store
        if (!db.objectStoreNames.contains('turns')) {
          const turns = db.createObjectStore('turns', { keyPath: 'id', autoIncrement: true });
          turns.createIndex('by_ts', 'ts', { unique: false });
          turns.createIndex('by_session', 'sessionId', { unique: false });
        }

        // 2. profiles store
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' });
        }

        // 3. episodes store
        if (!db.objectStoreNames.contains('episodes')) {
          const episodes = db.createObjectStore('episodes', { keyPath: 'id' });
          episodes.createIndex('by_ts', 'ts', { unique: false });
          episodes.createIndex('by_importance', 'importance', { unique: false });
        }

        // 4. lorebooks store
        if (!db.objectStoreNames.contains('lorebooks')) {
          const lore = db.createObjectStore('lorebooks', { keyPath: 'uid' });
          lore.createIndex('by_book', 'bookId', { unique: false });
          lore.createIndex('by_enabled', 'enabled', { unique: false });
        }
      };

      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
          console.warn('[client-memory] Database version changed elsewhere, closed connection');
        };
        resolve();
      };

      req.onblocked = () => {
        console.warn('[client-memory] IndexedDB open blocked by other tabs/connections');
      };

      req.onerror = () => reject(req.error);
    }).finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    if (!this.db) {
      throw new Error('[client-memory] IndexedDB failed to initialize');
    }
    return this.db;
  }

  async appendTurn(turn: Omit<TurnRecord, 'id'>): Promise<TurnRecord> {
    return this.mutex.runExclusive(async () => {
      const db = await this.getDb();
      const tx = db.transaction('turns', 'readwrite');
      const store = tx.objectStore('turns');
      const id = await reqToPromise(store.add(turn));
      return { ...turn, id: id as number };
    });
  }

  async loadRecentTurns(limit: number, sessionId?: string): Promise<TurnRecord[]> {
    const db = await this.getDb();
    const tx = db.transaction('turns', 'readonly');
    const store = tx.objectStore('turns');
    const index = store.index('by_ts');

    const records: TurnRecord[] = [];
    return new Promise((resolve, reject) => {
      // Open cursor backward (newest first)
      const req = index.openCursor(null, 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || records.length >= limit) {
          resolve(records.reverse()); // Restore chronological order
          return;
        }
        const val = cursor.value as TurnRecord;
        if (!sessionId || val.sessionId === sessionId) {
          records.push(val);
        }
        cursor.continue();
      };

      req.onerror = () => reject(req.error);
    });
  }

  async loadAllTurns(sessionId?: string): Promise<TurnRecord[]> {
    const db = await this.getDb();
    const tx = db.transaction('turns', 'readonly');
    const store = tx.objectStore('turns');
    const index = store.index('by_ts');
    const rows = await reqToPromise(index.getAll());
    const list = rows as TurnRecord[];
    return sessionId ? list.filter((t) => t.sessionId === sessionId) : list;
  }

  async markTurnsSummarized(ids: number[]): Promise<void> {
    if (!ids.length) return;
    const targetSet = new Set(ids);
    await this.mutex.runExclusive(async () => {
      const db = await this.getDb();
      const tx = db.transaction('turns', 'readwrite');
      const store = tx.objectStore('turns');
      await new Promise<void>((resolve, reject) => {
        const req = store.openCursor();
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const turn = cursor.value as TurnRecord;
            if (turn.id != null && targetSet.has(turn.id)) {
              turn.summarized = true;
              cursor.update(turn);
              targetSet.delete(turn.id);
            }
            if (targetSet.size > 0) {
              cursor.continue();
            } else {
              resolve();
            }
          } else {
            resolve();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  async loadProfile(): Promise<UserProfile> {
    try {
      const db = await this.getDb();
      const tx = db.transaction('profiles', 'readonly');
      const store = tx.objectStore('profiles');
      const row = await reqToPromise(store.get('user_master'));
      if (!row) return emptyUserProfile();
      return row as UserProfile;
    } catch {
      return emptyUserProfile();
    }
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const db = await this.getDb();
      const tx = db.transaction('profiles', 'readwrite');
      const store = tx.objectStore('profiles');
      store.put({ ...profile, id: 'user_master', updatedAt: Date.now() });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  async saveEpisode(episode: EpisodeRecord): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const db = await this.getDb();
      const tx = db.transaction('episodes', 'readwrite');
      const store = tx.objectStore('episodes');
      store.put(episode);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  async deleteEpisode(id: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const db = await this.getDb();
      const tx = db.transaction('episodes', 'readwrite');
      const store = tx.objectStore('episodes');
      store.delete(id);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  async loadAllEpisodes(): Promise<EpisodeRecord[]> {
    const db = await this.getDb();
    const tx = db.transaction('episodes', 'readonly');
    const store = tx.objectStore('episodes');
    const index = store.index('by_ts');
    const rows = await reqToPromise(index.getAll());
    return (rows as EpisodeRecord[]).sort((a, b) => b.ts - a.ts);
  }

  async saveLoreEntry(entry: LorebookEntry): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const db = await this.getDb();
      const tx = db.transaction('lorebooks', 'readwrite');
      const store = tx.objectStore('lorebooks');
      store.put(entry);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  async saveLoreEntries(entries: LorebookEntry[]): Promise<void> {
    if (!entries.length) return;
    await this.mutex.runExclusive(async () => {
      const db = await this.getDb();
      const tx = db.transaction('lorebooks', 'readwrite');
      const store = tx.objectStore('lorebooks');
      for (const entry of entries) {
        store.put(entry);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  async deleteLoreEntry(uid: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const db = await this.getDb();
      const tx = db.transaction('lorebooks', 'readwrite');
      const store = tx.objectStore('lorebooks');
      store.delete(uid);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  async loadAllLoreEntries(bookId?: string): Promise<LorebookEntry[]> {
    const db = await this.getDb();
    const tx = db.transaction('lorebooks', 'readonly');
    const store = tx.objectStore('lorebooks');
    const rows = await reqToPromise(store.getAll());
    const list = rows as LorebookEntry[];
    return bookId ? list.filter((e) => e.bookId === bookId) : list;
  }

  async clearAllMemory(options?: { includeLorebook?: boolean }): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const db = await this.getDb();
      const storeNames = ['turns', 'profiles', 'episodes'];
      if (options?.includeLorebook && db.objectStoreNames.contains('lorebooks')) {
        storeNames.push('lorebooks');
      }
      const tx = db.transaction(storeNames, 'readwrite');
      tx.objectStore('turns').clear();
      tx.objectStore('profiles').clear();
      tx.objectStore('episodes').clear();
      if (options?.includeLorebook && db.objectStoreNames.contains('lorebooks')) {
        tx.objectStore('lorebooks').clear();
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }
}
