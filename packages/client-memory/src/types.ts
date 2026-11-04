export type RelationshipStage =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'close_friend'
  | 'soulmate';

export type FactCategory =
  | 'identity'
  | 'occupation'
  | 'relationship'
  | 'preference'
  | 'habit'
  | 'health'
  | 'promise'
  | 'other';

export interface UserFact {
  id: string;
  category: FactCategory;
  key: string;
  value: string;
  confidence: number; // 1-5 (5 = explicit user statement)
  ts: number;
}

export interface UserTraits {
  birthday?: string;
  occupation?: string;
  location?: string;
  mbti?: string;
  [k: string]: string | undefined;
}

export interface UserProfile {
  id: 'user_master';
  name?: string;
  nickname?: string;
  relationshipStage: RelationshipStage;
  intimacyScore: number; // 0-100
  traits: UserTraits;
  facts: UserFact[];
  updatedAt: number;
}

export interface TurnRecord {
  id?: number;
  sessionId: string;
  user: string;
  assistant: string;
  ts: number;
  summarized?: boolean;
}

export interface EpisodeRecord {
  id: string;
  ts: number;
  title: string;
  summary: string;
  entities: string[];
  importance: number; // 1-10
  lastRecalledAt: number;
  recallCount: number;
}

export interface LorebookEntry {
  uid: string;
  bookId: string;
  keys: string[];
  secondaryKeys?: string[];
  selective?: boolean;
  constant: boolean;
  order: number;
  depth: number;
  content: string;
  enabled: boolean;
}

export interface RecallOptions {
  workingMemoryTurns?: number;
  maxEpisodes?: number;
  maxLorebookEntries?: number;
  minBm25Score?: number;
  halfLifeDays?: number;
  enableLorebook?: boolean;
  enableEpisodes?: boolean;
}

export interface RecallResult {
  profile: UserProfile;
  workingTurns: TurnRecord[];
  episodes: EpisodeRecord[];
  lorebookHits: LorebookEntry[];
  matchedFacts?: UserFact[];
}

export interface ClientMemoryConfig {
  dbName?: string;
  storage?: StorageAdapter;
  workingMemoryLimit?: number;
  decayHalfLifeDays?: number;
  bm25K1?: number;
  bm25B?: number;
}

export interface StorageAdapter {
  init(): Promise<void>;
  close(): Promise<void>;

  // Turns
  appendTurn(turn: Omit<TurnRecord, 'id'>): Promise<TurnRecord>;
  loadRecentTurns(limit: number, sessionId?: string): Promise<TurnRecord[]>;
  loadAllTurns(sessionId?: string): Promise<TurnRecord[]>;
  markTurnsSummarized(ids: number[]): Promise<void>;

  // Profile
  loadProfile(): Promise<UserProfile>;
  saveProfile(profile: UserProfile): Promise<void>;

  // Episodes
  saveEpisode(episode: EpisodeRecord): Promise<void>;
  deleteEpisode(id: string): Promise<void>;
  loadAllEpisodes(): Promise<EpisodeRecord[]>;

  // Lorebooks
  saveLoreEntry(entry: LorebookEntry): Promise<void>;
  saveLoreEntries?(entries: LorebookEntry[]): Promise<void>;
  deleteLoreEntry(uid: string): Promise<void>;
  loadAllLoreEntries(bookId?: string): Promise<LorebookEntry[]>;

  // Reset / Clear
  clearAllMemory(options?: { includeLorebook?: boolean }): Promise<void>;
}

export function emptyUserProfile(): UserProfile {
  return {
    id: 'user_master',
    relationshipStage: 'stranger',
    intimacyScore: 0,
    traits: {},
    facts: [],
    updatedAt: Date.now(),
  };
}
