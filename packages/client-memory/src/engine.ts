import type {
  ClientMemoryConfig,
  EpisodeRecord,
  LorebookEntry,
  RecallOptions,
  RecallResult,
  StorageAdapter,
  TurnRecord,
  UserFact,
  UserProfile,
} from './types';
import { MemoryStorageAdapter } from './storage/MemoryStorageAdapter';
import { IndexedDBAdapter } from './storage/IndexedDBAdapter';
import { BM25Index } from './search/bm25';
import { rankByCognitiveScore, type ScoredCandidate } from './search/scorer';
import { extractFactsFromUserText } from './cognitive/extractor';
import { mergeFactsIntoProfile } from './cognitive/conflictResolver';
import { consolidateTurnsToEpisode } from './cognitive/consolidator';
import { matchLorebookEntries, parseSillyTavernLorebook } from './lorebook/lorebookEngine';
import { assembleChatMessages, type AssembleContextOptions, type ChatMessageItem } from './assembler/contextAssembler';

type BM25Payload = { type: 'episode' | 'turn' | 'fact'; raw: EpisodeRecord | TurnRecord | UserFact };

export class ClientMemoryEngine {
  private config: ClientMemoryConfig;
  private storage: StorageAdapter;
  private bm25: BM25Index<BM25Payload>;
  private isInitialized = false;
  private rememberMutex = new (class {
    private queue: (() => void)[] = [];
    private locked = false;
    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      await this.acquire();
      try {
        return await fn();
      } finally {
        this.release();
      }
    }
    private acquire(): Promise<void> {
      if (!this.locked) {
        this.locked = true;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => this.queue.push(resolve));
    }
    private release(): void {
      const next = this.queue.shift();
      if (next) next();
      else this.locked = false;
    }
  })();

  constructor(config?: ClientMemoryConfig) {
    this.config = {
      workingMemoryLimit: 2,
      decayHalfLifeDays: 7,
      bm25K1: 1.2,
      bm25B: 0.75,
      ...config,
    };

    if (config?.storage) {
      this.storage = config.storage;
    } else if (typeof indexedDB !== 'undefined') {
      this.storage = new IndexedDBAdapter(config?.dbName);
    } else {
      this.storage = new MemoryStorageAdapter();
    }

    this.bm25 = new BM25Index({
      k1: this.config.bm25K1,
      b: this.config.bm25B,
      lang: 'zh',
    });
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;
    try {
      await this.storage.init();
    } catch (err) {
      console.warn('[client-memory] Storage init failed, falling back to MemoryStorageAdapter', err);
      this.storage = new MemoryStorageAdapter();
      await this.storage.init();
    }

    // Cold-start hydration: load episodes and profile facts into in-memory BM25 index (<15ms)
    const [episodes, profile] = await Promise.all([
      this.storage.loadAllEpisodes().catch(() => []),
      this.storage.loadProfile().catch(() => null),
    ]);

    for (const ep of episodes) {
      this.bm25.addDocument(`ep_${ep.id}`, `${ep.title} ${ep.summary} ${ep.entities.join(' ')}`, {
        type: 'episode',
        raw: ep,
      });
    }

    if (profile?.facts) {
      for (const fact of profile.facts) {
        this.bm25.addDocument(`fact_${fact.id}`, `${fact.key} ${fact.value}`, {
          type: 'fact',
          raw: fact,
        });
      }
    }

    this.isInitialized = true;
  }

  async close(): Promise<void> {
    await this.storage.close();
    this.bm25.clear();
    this.isInitialized = false;
  }

  /**
   * Records a user/assistant turn, extracts facts, updates user profile, and triggers consolidation.
   */
  async remember(params: {
    user: string;
    assistant: string;
    sessionId?: string;
    ts?: number;
  }): Promise<{ profile: UserProfile; turn: TurnRecord; newEpisode?: EpisodeRecord }> {
    return this.rememberMutex.runExclusive(async () => {
      await this.init();
      const ts = params.ts ?? Date.now();
      const sessionId = params.sessionId ?? 'default_session';

      // 1. Extract facts from user speech
      const newFacts = extractFactsFromUserText(params.user, ts);

      // 2. Load & update UserProfile
      let profile = await this.storage.loadProfile();
      if (newFacts.length > 0) {
        profile = mergeFactsIntoProfile(profile, newFacts);
        await this.storage.saveProfile(profile);

        // Index facts into BM25
        for (const fact of newFacts) {
          this.bm25.addDocument(`fact_${fact.id}`, `${fact.key} ${fact.value}`, {
            type: 'fact',
            raw: fact,
          });
        }
      }

      // 3. Persist raw turn (Pure raw text, zero prompt debris)
      const turn = await this.storage.appendTurn({
        sessionId,
        user: params.user,
        assistant: params.assistant,
        ts,
        summarized: false,
      });

      // 4. Check if unsummarized turns should be consolidated into an episode
      let newEpisode: EpisodeRecord | undefined;
      const allTurns = await this.storage.loadAllTurns(sessionId);
      const unsummarized = allTurns.filter((t) => !t.summarized);
      const consolidationThreshold = Math.max(4, (this.config.workingMemoryLimit ?? 2) * 2);

      if (unsummarized.length >= consolidationThreshold) {
        const batch = unsummarized.slice(0, consolidationThreshold);
        const res = consolidateTurnsToEpisode(batch);
        if (res) {
          newEpisode = res.episode;
          await this.storage.saveEpisode(newEpisode);
          await this.storage.markTurnsSummarized(res.turnIds);

          // Add episode to BM25
          this.bm25.addDocument(
            `ep_${newEpisode.id}`,
            `${newEpisode.title} ${newEpisode.summary} ${newEpisode.entities.join(' ')}`,
            { type: 'episode', raw: newEpisode },
          );
        }
      }

      return { profile, turn, newEpisode };
    });
  }

  /**
   * Recalls relevant memories (working context, top episodes, matched lorebook).
   */
  async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    await this.init();
    const limit = options?.workingMemoryTurns ?? this.config.workingMemoryLimit ?? 2;
    const enableEpisodes = options?.enableEpisodes ?? true;
    const enableLorebook = options?.enableLorebook ?? true;
    const maxEpisodes = options?.maxEpisodes ?? 2;

    const [profile, workingTurns, lorebookEntries] = await Promise.all([
      this.storage.loadProfile(),
      this.storage.loadRecentTurns(limit),
      enableLorebook ? this.storage.loadAllLoreEntries() : Promise.resolve([]),
    ]);

    let episodes: EpisodeRecord[] = [];
    const matchedFacts: UserFact[] = [];

    // Search BM25 for episodes & facts if enabled
    if (this.bm25.size > 0 && query.trim().length > 0) {
      const searchResults = this.bm25.search(query, 10);
      const episodeCandidates: ScoredCandidate<EpisodeRecord>[] = [];

      for (const res of searchResults) {
        if (enableEpisodes && res.data?.type === 'episode') {
          const ep = res.data.raw as EpisodeRecord;
          episodeCandidates.push({
            id: ep.id,
            ts: ep.ts,
            importance: ep.importance,
            bm25Score: res.score,
            data: ep,
          });
        } else if (res.data?.type === 'fact') {
          const fact = res.data.raw as UserFact;
          matchedFacts.push(fact);
        }
      }

      // Stanford 3D re-ranking with gating
      if (episodeCandidates.length > 0) {
        const ranked = rankByCognitiveScore(episodeCandidates, {
          halfLifeDays: options?.halfLifeDays ?? this.config.decayHalfLifeDays ?? 7,
        });
        episodes = ranked.slice(0, maxEpisodes).map((r) => r.data);
      }
    }

    // Lorebook keyword matching with strict 1-entry budget
    const lorebookHits = enableLorebook ? matchLorebookEntries(lorebookEntries, query, { maxEntries: 1 }) : [];

    return {
      profile,
      workingTurns,
      episodes,
      lorebookHits,
      matchedFacts: matchedFacts.slice(0, 2),
    };
  }

  /**
   * Assembles ChatML messages with frozen system prompt and compact current-turn hint.
   */
  assemble(params: AssembleContextOptions): {
    systemPrompt: string;
    messages: ChatMessageItem[];
    recalledSummary: string;
  } {
    return assembleChatMessages(params);
  }

  /**
   * Resets all stored memory (turns, profile, episodes, and optionally lorebooks),
   * and clears the in-memory BM25 index.
   */
  async clearAll(options?: { includeLorebook?: boolean }): Promise<void> {
    await this.init();
    await this.storage.clearAllMemory(options);
    this.bm25.clear();
  }

  // --- Sub-Domain Managers for UI & Settings ---

  readonly profileManager = {
    get: async () => {
      await this.init();
      return this.storage.loadProfile();
    },
    save: async (profile: UserProfile) => {
      await this.init();
      await this.storage.saveProfile(profile);
    },
    deleteFact: async (factId: string) => {
      await this.init();
      const p = await this.storage.loadProfile();
      p.facts = p.facts.filter((f) => f.id !== factId);
      await this.storage.saveProfile(p);
      this.bm25.removeDocument(`fact_${factId}`);
    },
    updateName: async (name: string) => {
      await this.init();
      const p = await this.storage.loadProfile();
      p.name = name;
      p.traits.name = name;
      await this.storage.saveProfile(p);
    },
  };

  readonly episodeManager = {
    getAll: async () => {
      await this.init();
      return this.storage.loadAllEpisodes();
    },
    delete: async (id: string) => {
      await this.init();
      await this.storage.deleteEpisode(id);
      this.bm25.removeDocument(`ep_${id}`);
    },
  };

  readonly lorebookManager = {
    getAll: async (bookId?: string) => {
      await this.init();
      return this.storage.loadAllLoreEntries(bookId);
    },
    saveEntry: async (entry: LorebookEntry) => {
      await this.init();
      await this.storage.saveLoreEntry(entry);
    },
    deleteEntry: async (uid: string) => {
      await this.init();
      await this.storage.deleteLoreEntry(uid);
    },
    importSillyTavernJson: async (jsonStr: string, bookId = 'custom') => {
      await this.init();
      const entries = parseSillyTavernLorebook(jsonStr, bookId);
      if (this.storage.saveLoreEntries) {
        await this.storage.saveLoreEntries(entries);
      } else {
        for (const e of entries) {
          await this.storage.saveLoreEntry(e);
        }
      }
      return entries;
    },
  };
}

export function createClientMemory(config?: ClientMemoryConfig): ClientMemoryEngine {
  return new ClientMemoryEngine(config);
}
