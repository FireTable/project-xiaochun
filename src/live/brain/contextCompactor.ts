/**
 * contextCompactor.ts — Idle-only non-blocking Front/Shared context compactor.
 *
 * Monitors total context tokens against the 75% watermark of 4096 (>= 3000 tokens)
 * and runs background summarization ONLY while the orchestrator is `idle`,
 * cancelling cleanly without blocking if a live turn or speculative draft begins.
 */

import {
  estimateBilingualTokens,
  SOPHON_LIVE_FRONT_BRAIN_PROMPT,
} from './frontBrain';
import type { BrainMessage, BrainSystemState } from './types';

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 4096;
export const DEFAULT_COMPACTION_RATIO = 0.75;
export const DEFAULT_COMPACTION_WATERMARK_TOKENS = 3000;
export const DEFAULT_KEEP_RECENT_MESSAGES = 4;

export interface CompactionStats {
  beforeTokens: number;
  afterTokens: number;
}

export interface CompactionOutcome {
  compacted: boolean;
  summary: string;
  history: BrainMessage[];
  stats: CompactionStats;
}

export type CompactionSummarizer = (
  messagesToCompact: BrainMessage[],
  priorSummary: string | null,
  signal: AbortSignal,
) => Promise<string>;

export interface ContextCompactorOptions {
  contextWindowTokens?: number;
  watermarkTokens?: number;
  keepRecentMessages?: number;
  systemPrompt?: string;
  getState: () => BrainSystemState;
  summarizer?: CompactionSummarizer;
  onCompacted?: (summary: string, stats: CompactionStats) => void;
}

export function estimateMessageListTokens(
  messages: readonly BrainMessage[],
  systemPrompt = SOPHON_LIVE_FRONT_BRAIN_PROMPT,
): number {
  let total = estimateBilingualTokens(systemPrompt) + 8;
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    total += estimateBilingualTokens(msg.content) + 6;
  }
  return total;
}

export function deterministicSummarizeTurns(
  messages: readonly BrainMessage[],
  priorSummary: string | null,
): string {
  const bullets: string[] = [];
  if (priorSummary) {
    bullets.push(priorSummary.trim());
  }
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const tag = msg.role === 'user' ? 'User' : 'XiaoChun';
    const compact = msg.content.replace(/\s+/g, ' ').trim();
    if (!compact) continue;
    bullets.push(`${tag}: ${compact.slice(0, 72)}${compact.length > 72 ? '…' : ''}`);
  }
  const joined = bullets.join(' | ');
  return joined.length > 360 ? `${joined.slice(0, 357)}…` : joined;
}

export class ContextCompactor {
  readonly contextWindowTokens: number;
  readonly watermarkTokens: number;
  readonly keepRecentMessages: number;
  private readonly systemPrompt: string;
  private readonly getState: () => BrainSystemState;
  private readonly summarizer?: CompactionSummarizer;
  private readonly onCompacted?: (summary: string, stats: CompactionStats) => void;

  private activeAbort: AbortController | null = null;
  private inFlightPromise: Promise<CompactionOutcome | null> | null = null;
  private compactionCount = 0;
  private lastSummary: string | null = null;

  constructor(opts: ContextCompactorOptions) {
    this.contextWindowTokens =
      opts.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    this.watermarkTokens =
      opts.watermarkTokens ??
      Math.min(
        Math.floor(this.contextWindowTokens * DEFAULT_COMPACTION_RATIO),
        DEFAULT_COMPACTION_WATERMARK_TOKENS,
      );
    this.keepRecentMessages =
      opts.keepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES;
    this.systemPrompt = opts.systemPrompt ?? SOPHON_LIVE_FRONT_BRAIN_PROMPT;
    this.getState = opts.getState;
    this.summarizer = opts.summarizer;
    this.onCompacted = opts.onCompacted;
  }

  estimateTokens(history: readonly BrainMessage[]): number {
    return estimateMessageListTokens(history, this.systemPrompt);
  }

  shouldCompact(history: readonly BrainMessage[]): boolean {
    if (this.getState() !== 'idle') return false;
    const nonSystem = history.filter((m) => m.role !== 'system');
    if (nonSystem.length <= this.keepRecentMessages) return false;
    return this.estimateTokens(nonSystem) >= this.watermarkTokens;
  }

  getCompactionCount(): number {
    return this.compactionCount;
  }

  getLastSummary(): string | null {
    return this.lastSummary;
  }

  cancelInFlight(): void {
    this.activeAbort?.abort();
    this.activeAbort = null;
  }

  reset(): void {
    this.cancelInFlight();
    this.compactionCount = 0;
    this.lastSummary = null;
  }

  /**
   * Run compaction iff system is currently `idle` and estimated tokens >= watermark.
   * Returns `null` immediately without blocking when non-idle or below threshold.
   */
  async maybeCompact(
    history: readonly BrainMessage[],
    commitCompactedHistory?: (nextHistory: BrainMessage[], summary: string) => void,
  ): Promise<CompactionOutcome | null> {
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }
    if (!this.shouldCompact(history)) {
      return null;
    }

    const ctrl = new AbortController();
    this.activeAbort = ctrl;

    const task = (async (): Promise<CompactionOutcome | null> => {
      try {
        const nonSystem = history.filter((m) => m.role !== 'system');
        if (nonSystem.length <= this.keepRecentMessages) return null;

        const beforeTokens = this.estimateTokens(nonSystem);
        if (beforeTokens < this.watermarkTokens) return null;

        const splitIdx = Math.max(1, nonSystem.length - this.keepRecentMessages);
        const toSummarize = nonSystem.slice(0, splitIdx);
        const recentTail = nonSystem.slice(splitIdx);

        // Double check idle right before async summarization work
        if (this.getState() !== 'idle' || ctrl.signal.aborted) {
          return null;
        }

        let summary: string;
        if (this.summarizer) {
          summary = await this.summarizer(toSummarize, this.lastSummary, ctrl.signal);
        } else {
          summary = deterministicSummarizeTurns(toSummarize, this.lastSummary);
        }

        // Abort safely without mutating history if user became active while compacting
        if (this.getState() !== 'idle' || ctrl.signal.aborted) {
          return null;
        }

        const cleanSummary = summary.trim();
        const compactedHistory: BrainMessage[] = cleanSummary
          ? [
              {
                role: 'user',
                content: `[Context Recap] ${cleanSummary}`,
              },
              {
                role: 'assistant',
                content: '好的，前面聊的我都有记着～',
              },
              ...recentTail,
            ]
          : recentTail;

        const afterTokens = this.estimateTokens(compactedHistory);
        this.compactionCount += 1;
        this.lastSummary = cleanSummary;

        commitCompactedHistory?.(compactedHistory, cleanSummary);
        const stats: CompactionStats = { beforeTokens, afterTokens };
        this.onCompacted?.(cleanSummary, stats);

        return {
          compacted: true,
          summary: cleanSummary,
          history: compactedHistory,
          stats,
        };
      } finally {
        if (this.activeAbort === ctrl) {
          this.activeAbort = null;
        }
        this.inFlightPromise = null;
      }
    })();

    this.inFlightPromise = task;
    return task;
  }
}
