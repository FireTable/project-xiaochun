/**
 * types.ts — Layer 2 Sophon-style Live Cognitive Brain contracts.
 *
 *Shared across FrontBrain (instant low-latency persona), HeavyWorker (async deep reasoning + memory),
 * ContextCompactor (idle-only KV watermark compaction), and LiveOrchestrator.
 */

export type LiveEmotionTag =
  | 'neutral'
  | 'happy'
  | 'angry'
  | 'sad'
  | 'relaxed'
  | 'surprised'
  | 'shy';

export type LiveLanguageHint = 'zh' | 'en' | 'mixed';

export type BrainSystemState =
  | 'idle'
  | 'listening'
  | 'speculating'
  | 'speaking'
  | 'thinking';

export interface FrontBrainSegment {
  text: string;
  cleanText: string;
  emotion: LiveEmotionTag;
  isDelegate?: boolean;
  delegateTask?: string;
  delegateUrgency?: 'quick' | 'deep';
}

export interface HeavyWorkerConfig {
  mode: 'custom-openai' | 'local-thinking' | 'auto';
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
}

export interface LiveBrainTurnMetrics {
  turnId: number;
  ttftMs: number;
  speculativeMsSaved: number;
  wasSpeculativeHit: boolean;
  delegated: boolean;
  kvCacheHitTokens?: number;
}

export interface LiveSpeakChunk {
  text: string;
  emotion: LiveEmotionTag;
  seq: number;
  turnId: number;
  source: 'front' | 'heavy' | 'backchannel';
}

export interface LiveTurnEvents {
  onSpeculativeStart?: (turnId: number) => void;
  onFrontDelta?: (
    delta: string,
    cleanAccum: string,
    emotion: LiveEmotionTag,
  ) => void;
  onSpeakChunk?: (chunk: LiveSpeakChunk) => void;
  onDelegateStarted?: (task: string, turnId: number) => void;
  onHeavyDelta?: (
    delta: string,
    cleanAccum: string,
    emotion: LiveEmotionTag,
  ) => void;
  onTurnComplete?: (
    turnId: number,
    fullReply: string,
    metrics: LiveBrainTurnMetrics,
  ) => void;
  onCompacted?: (
    summary: string,
    stats: { beforeTokens: number; afterTokens: number },
  ) => void;
}

export type BrainRole = 'system' | 'user' | 'assistant';

export interface BrainMessage {
  role: BrainRole;
  content: string;
}

export interface BrainStreamChunk {
  delta: string;
  raw?: string;
  finishReason?: string | null;
}

export interface BrainGenerateRequest {
  messages: BrainMessage[];
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
  stop?: string[];
  signal?: AbortSignal;
}

/**
 * Abstraction over MLC / WebLLM worker KV primitives and generation streaming.
 * Defaults to `webLLMProvider` in browser runtime and can be mocked cleanly in tests.
 */
export interface BrainKVRuntimeAdapter {
  streamChat(request: BrainGenerateRequest): AsyncIterable<BrainStreamChunk>;
  interruptGenerate(): void;
  xcRollbackLastTurn(): Promise<{ popped: number; remaining: number }>;
  xcTruncateReplyToHeard(
    heardText: string,
  ): Promise<{ truncated: boolean; poppedTokens: number; remainingTokens: number }>;
  resetChat(): Promise<void>;
}

export interface BrainMemorySnapshot {
  recalledSummary?: string;
  profileText?: string;
  episodeLines?: string[];
  lorebookLines?: string[];
}

export interface BrainMemoryAdapter {
  recall(query: string, maxTurns?: number): Promise<BrainMemorySnapshot>;
  remember(userText: string, assistantText: string): Promise<void>;
}

export interface LiveOrchestratorStats {
  state: BrainSystemState;
  contextWindowTokens: number;
  estimatedKvTokens: number;
  compactionWatermarkTokens: number;
  turnCount: number;
  historyMessageCount: number;
  rollbackCount: number;
  truncationCount: number;
  compactionCount: number;
  speculativeHitCount: number;
  speculativeMissCount: number;
  speculativeMsSavedTotal: number;
  backchannelCount: number;
  delegateCount: number;
  lastBackchannelAt: number | null;
  lastBackchannelText: string | null;
  lastCompactedSummary: string | null;
  activeHeavyTaskId: string | null;
}

export interface BargeInOptions {
  /** Whether to abort any active Heavyworker task (default `'abort'`). */
  heavyAction?: 'abort' | 'amend' | 'keep';
  /** Optional user amendment text when `heavyAction === 'amend'`. */
  amendmentText?: string;
}
