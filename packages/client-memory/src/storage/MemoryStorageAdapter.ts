import {
  emptyUserProfile,
  type EpisodeRecord,
  type LorebookEntry,
  type StorageAdapter,
  type TurnRecord,
  type UserProfile,
} from '../types';

/**
 * In-memory StorageAdapter for pure Node.js environments (vitest), SSR, or fallback.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private turns: TurnRecord[] = [];
  private nextTurnId = 1;
  private profile: UserProfile = emptyUserProfile();
  private episodes: Map<string, EpisodeRecord> = new Map();
  private lorebooks: Map<string, LorebookEntry> = new Map();

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async appendTurn(turn: Omit<TurnRecord, 'id'>): Promise<TurnRecord> {
    const record: TurnRecord = {
      ...turn,
      id: this.nextTurnId++,
    };
    this.turns.push(record);
    return record;
  }

  async loadRecentTurns(limit: number, sessionId?: string): Promise<TurnRecord[]> {
    const list = sessionId ? this.turns.filter((t) => t.sessionId === sessionId) : this.turns;
    return list.slice(-Math.max(1, limit));
  }

  async loadAllTurns(sessionId?: string): Promise<TurnRecord[]> {
    if (!sessionId) return [...this.turns];
    return this.turns.filter((t) => t.sessionId === sessionId);
  }

  async markTurnsSummarized(ids: number[]): Promise<void> {
    const set = new Set(ids);
    for (const t of this.turns) {
      if (t.id != null && set.has(t.id)) {
        t.summarized = true;
      }
    }
  }

  async loadProfile(): Promise<UserProfile> {
    return JSON.parse(JSON.stringify(this.profile));
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    this.profile = JSON.parse(JSON.stringify(profile));
  }

  async saveEpisode(episode: EpisodeRecord): Promise<void> {
    this.episodes.set(episode.id, { ...episode });
  }

  async deleteEpisode(id: string): Promise<void> {
    this.episodes.delete(id);
  }

  async loadAllEpisodes(): Promise<EpisodeRecord[]> {
    return Array.from(this.episodes.values()).sort((a, b) => b.ts - a.ts);
  }

  async saveLoreEntry(entry: LorebookEntry): Promise<void> {
    this.lorebooks.set(entry.uid, { ...entry });
  }

  async saveLoreEntries(entries: LorebookEntry[]): Promise<void> {
    for (const e of entries) {
      this.lorebooks.set(e.uid, { ...e });
    }
  }

  async deleteLoreEntry(uid: string): Promise<void> {
    this.lorebooks.delete(uid);
  }

  async loadAllLoreEntries(bookId?: string): Promise<LorebookEntry[]> {
    const all = Array.from(this.lorebooks.values());
    if (!bookId) return all;
    return all.filter((e) => e.bookId === bookId);
  }

  async clearAllMemory(options?: { includeLorebook?: boolean }): Promise<void> {
    this.turns = [];
    this.nextTurnId = 1;
    this.profile = emptyUserProfile();
    this.episodes.clear();
    if (options?.includeLorebook) {
      this.lorebooks.clear();
    }
  }
}
