/**
 * IndexedDB 持久化。SSR / 无 indexedDB 时全部变成空操作。
 */
import { APP_CONFIG } from '@/config';
import { emptyEntities, type EntityProfile, type LongNote, type MemoryTurn } from './types';

const DB_NAME = 'xiaochun-memory';
const DB_VER = 1;

function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('turns')) {
        db.createObjectStore('turns', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  store: 'turns' | 'notes' | 'meta',
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, mode);
    const s = tx.objectStore(store);
    const out = fn(s);
    return out instanceof Promise ? await out : await reqToPromise(out);
  } finally {
    db.close();
  }
}

export async function loadTurns(): Promise<MemoryTurn[]> {
  if (!available()) return [];
  try {
    const rows = await withStore('turns', 'readonly', (s) => s.getAll());
    return (rows as MemoryTurn[]).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  } catch (e) {
    console.warn('[memory] loadTurns', e);
    return [];
  }
}

export async function appendTurn(turn: Omit<MemoryTurn, 'id'>): Promise<void> {
  if (!available()) return;
  try {
    await withStore('turns', 'readwrite', (s) => s.add(turn));
    const keep = APP_CONFIG.memory.shortTermTurns;
    const all = await loadTurns();
    const extra = all.length - keep;
    if (extra <= 0) return;
    const db = await openDb();
    try {
      const tx = db.transaction('turns', 'readwrite');
      const s = tx.objectStore('turns');
      for (const row of all.slice(0, extra)) {
        if (row.id != null) s.delete(row.id);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn('[memory] appendTurn', e);
  }
}

export async function loadEntities(): Promise<EntityProfile> {
  if (!available()) return emptyEntities();
  try {
    const row = await withStore('meta', 'readonly', (s) => s.get('entities'));
    if (!row) return emptyEntities();
    const e = row as EntityProfile;
    return {
      name: e.name,
      nickname: e.nickname,
      likes: Array.isArray(e.likes) ? e.likes : [],
      dislikes: Array.isArray(e.dislikes) ? e.dislikes : [],
      facts: Array.isArray(e.facts) ? e.facts : [],
    };
  } catch (e) {
    console.warn('[memory] loadEntities', e);
    return emptyEntities();
  }
}

export async function saveEntities(profile: EntityProfile): Promise<void> {
  if (!available()) return;
  try {
    await withStore('meta', 'readwrite', (s) => s.put(profile, 'entities'));
  } catch (e) {
    console.warn('[memory] saveEntities', e);
  }
}

export async function loadNotes(): Promise<LongNote[]> {
  if (!available()) return [];
  try {
    const rows = await withStore('notes', 'readonly', (s) => s.getAll());
    return (rows as LongNote[]).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  } catch (e) {
    console.warn('[memory] loadNotes', e);
    return [];
  }
}

export async function appendNote(note: Omit<LongNote, 'id'>): Promise<void> {
  if (!available()) return;
  try {
    await withStore('notes', 'readwrite', (s) => s.add(note));
    const keep = APP_CONFIG.memory.longTermKeep;
    const all = await loadNotes();
    const extra = all.length - keep;
    if (extra <= 0) return;
    const db = await openDb();
    try {
      const tx = db.transaction('notes', 'readwrite');
      const s = tx.objectStore('notes');
      for (const row of all.slice(0, extra)) {
        if (row.id != null) s.delete(row.id);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn('[memory] appendNote', e);
  }
}
