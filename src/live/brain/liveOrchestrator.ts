/**
 * liveOrchestrator.ts — Unified Layer 2 Sophon-style Live Cognitive Coordinator.
 *
 * Coordinates:
 * - Speculative draft execution (~260ms micro-pause) with prefix-match commit or O(1) `xcRollbackLastTurn`
 * - Front-Brain instant replies (`enable_thinking: false`, `<= 900` tok prompt, 90-tok punctuation grace stop)
 * - Async Heavyworker delegation (`<delegate .../>`) with mid-flight `amend()` & spoken commentary streaming
 * - Non-interrupting listener backchannel ack (`handleBackchannelAck`)
 * - Instant barge-in cancellation + `xcTruncateReplyToHeard` KV truncation (`[interrupted]`) with zero KV wipe
 * - Idle-only background context compaction at 75% / 3000 tokens
 */

import {
  interruptWebLLMGenerate,
  resetWebLLMChat,
  rollbackWebLLMLastTurn,
  streamWebLLMDirect,
  truncateWebLLMReplyToHeard,
} from '@/llm/webLLMProvider';
import {
  ContextCompactor,
  DEFAULT_COMPACTION_WATERMARK_TOKENS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  type CompactionSummarizer,
} from './contextCompactor';
import {
  FRONT_BRAIN_MAX_TOKENS,
  FRONT_BRAIN_SOFT_TOKEN_BUDGET,
  formatInterruptedAssistantText,
  runFrontBrainTurn,
  SOPHON_LIVE_FRONT_BRAIN_PROMPT,
  type ParsedDelegateDirective,
} from './frontBrain';
import {
  createDefaultMemoryAdapter,
  HeavyWorker,
  type HeavyTaskHandle,
  type OpenAIStreamTransport,
} from './heavyWorker';
import type {
  BargeInOptions,
  BrainKVRuntimeAdapter,
  BrainMemoryAdapter,
  BrainMessage,
  BrainSystemState,
  HeavyWorkerConfig,
  LiveBrainTurnMetrics,
  LiveEmotionTag,
  LiveLanguageHint,
  LiveOrchestratorStats,
  LiveSpeakChunk,
  LiveTurnEvents,
} from './types';
import type { IntentRouterClient, IntentPrediction } from '@/live/router';

export type { IntentRouterClient, IntentPrediction };

export interface LiveOrchestratorOptions {
  events?: LiveTurnEvents;
  heavyConfig?: HeavyWorkerConfig;
  kvAdapter?: BrainKVRuntimeAdapter;
  memoryAdapter?: BrainMemoryAdapter;
  openAITransport?: OpenAIStreamTransport;
  compactionSummarizer?: CompactionSummarizer;
  contextWindowTokens?: number;
  compactionWatermarkTokens?: number;
  softTokenBudget?: number;
  maxFrontTokens?: number;
  intentRouter?: IntentRouterClient;
}

interface ActiveTurnRuntime {
  turnId: number;
  userText: string;
  language: LiveLanguageHint;
  startedAt: number;
  abortController: AbortController;
  abortedByBargeIn: boolean;
  seqCounter: number;
  donePromise: Promise<void>;
}

interface SpeculativeDraftRuntime {
  turnId: number;
  rawPartialText: string;
  normalizedPrefix: string;
  language: LiveLanguageHint;
  startedAt: number;
  firstTokenAt: number | null;
  abortController: AbortController;
  cancelledByCaller: boolean;
  committed: boolean;
  seqCounter: number;
  cleanAccum: string;
  lastEmotion: LiveEmotionTag;
  bufferedFrontDeltas: Array<{
    delta: string;
    cleanAccum: string;
    emotion: LiveEmotionTag;
  }>;
  bufferedSpeakClauses: Array<{ text: string; emotion: LiveEmotionTag }>;
  bufferedDelegates: ParsedDelegateDirective[];
  /** Non-null after `commitOrCancelSpeculative` decides to commit while stream is still live. */
  liveForwarder: {
    onDelta: (delta: string, cleanAccum: string, emotion: LiveEmotionTag) => void;
    onSpeakClause: (text: string, emotion: LiveEmotionTag) => void;
    onDelegate: (d: ParsedDelegateDirective) => void;
  } | null;
  promise: Promise<{
    cleanText: string;
    delegated: boolean;
    aborted: boolean;
    ttftMs: number;
  }>;
}

export function createWebLLMKVAdapter(): BrainKVRuntimeAdapter {
  return {
    streamChat: (request) =>
      streamWebLLMDirect({
        messages: request.messages,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        thinking: request.thinking,
        stop: request.stop,
        signal: request.signal,
      }),
    interruptGenerate: () => interruptWebLLMGenerate(),
    xcRollbackLastTurn: () => rollbackWebLLMLastTurn(),
    xcTruncateReplyToHeard: (heardText) => truncateWebLLMReplyToHeard(heardText),
    resetChat: () => resetWebLLMChat(),
  };
}

/**
 * Normalize partial/final ASR text for deterministic speculative-draft prefix matching.
 */
export function normalizeSpeculativePrefix(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。！？,.!?~～…、]+$/g, '')
    .trim();
}

export class LiveOrchestrator {
  private events: LiveTurnEvents;
  private readonly kvAdapter: BrainKVRuntimeAdapter;
  private readonly memoryAdapter: BrainMemoryAdapter;
  private readonly heavyWorker: HeavyWorker;
  private readonly compactor: ContextCompactor;
  private readonly softTokenBudget: number;
  private readonly maxFrontTokens: number;
  private intentRouter?: IntentRouterClient;

  private state: BrainSystemState = 'idle';
  private turnCounter = 0;
  private history: BrainMessage[] = [];
  private activeFrontTurn: ActiveTurnRuntime | null = null;
  private speculative: SpeculativeDraftRuntime | null = null;
  private activeHeavyHandle: HeavyTaskHandle | null = null;
  private pendingHeavyContextNotes: string[] = [];
  private lastHeavyResult: string | null = null;
  private heavySeqCounter = 10_000;

  private rollbackCount = 0;
  private truncationCount = 0;
  private speculativeHitCount = 0;
  private speculativeMissCount = 0;
  private speculativeMsSavedTotal = 0;
  private backchannelCount = 0;
  private delegateCount = 0;
  private lastBackchannelAt: number | null = null;
  private lastBackchannelText: string | null = null;

  constructor(options: LiveOrchestratorOptions = {}) {
    this.events = options.events ?? {};
    this.kvAdapter = options.kvAdapter ?? createWebLLMKVAdapter();
    this.memoryAdapter = options.memoryAdapter ?? createDefaultMemoryAdapter();
    this.softTokenBudget =
      options.softTokenBudget ?? FRONT_BRAIN_SOFT_TOKEN_BUDGET;
    this.maxFrontTokens = options.maxFrontTokens ?? FRONT_BRAIN_MAX_TOKENS;
    this.intentRouter = options.intentRouter;

    this.heavyWorker = new HeavyWorker({
      config: options.heavyConfig ?? { mode: 'auto' },
      localAdapter: this.kvAdapter,
      memoryAdapter: this.memoryAdapter,
      openAITransport: options.openAITransport,
      isLocalModelBusy: () =>
        this.activeFrontTurn !== null ||
        (this.speculative !== null && !this.speculative.cancelledByCaller),
    });

    this.compactor = new ContextCompactor({
      contextWindowTokens:
        options.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
      watermarkTokens:
        options.compactionWatermarkTokens ?? DEFAULT_COMPACTION_WATERMARK_TOKENS,
      systemPrompt: SOPHON_LIVE_FRONT_BRAIN_PROMPT,
      getState: () => this.state,
      summarizer: options.compactionSummarizer,
      onCompacted: (summary, stats) => {
        this.events.onCompacted?.(summary, stats);
      },
    });
  }

  setEvents(events: LiveTurnEvents): void {
    this.events = events;
  }

  setIntentRouter(router: IntentRouterClient): void {
    this.intentRouter = router;
  }

  getIntentRouter(): IntentRouterClient | undefined {
    return this.intentRouter;
  }

  updateHeavyConfig(config: Partial<HeavyWorkerConfig>): void {
    this.heavyWorker.updateConfig(config);
  }

  getHeavyConfig(): HeavyWorkerConfig {
    return this.heavyWorker.getConfig();
  }

  getState(): BrainSystemState {
    return this.state;
  }

  getHistory(): readonly BrainMessage[] {
    return this.history;
  }

  getLastHeavyResult(): string | null {
    return this.lastHeavyResult;
  }

  /**
   * Append synthetic turn history (mainly useful in tests or session restore).
   */
  seedHistory(messages: BrainMessage[]): void {
    this.history = messages.filter((m) => m.role !== 'system').map((m) => ({ ...m }));
  }

  getStats(): LiveOrchestratorStats {
    return {
      state: this.state,
      contextWindowTokens: this.compactor.contextWindowTokens,
      estimatedKvTokens: this.compactor.estimateTokens(this.history),
      compactionWatermarkTokens: this.compactor.watermarkTokens,
      turnCount: this.turnCounter,
      historyMessageCount: this.history.length,
      rollbackCount: this.rollbackCount,
      truncationCount: this.truncationCount,
      compactionCount: this.compactor.getCompactionCount(),
      speculativeHitCount: this.speculativeHitCount,
      speculativeMissCount: this.speculativeMissCount,
      speculativeMsSavedTotal: this.speculativeMsSavedTotal,
      backchannelCount: this.backchannelCount,
      delegateCount: this.delegateCount,
      lastBackchannelAt: this.lastBackchannelAt,
      lastBackchannelText: this.lastBackchannelText,
      lastCompactedSummary: this.compactor.getLastSummary(),
      activeHeavyTaskId: this.heavyWorker.getActiveTaskId(),
    };
  }

  /**
   * Start speculative prefill & buffered token generation during a ~260ms user micro-pause.
   */
  async startSpeculativeDraft(
    partialOrStableText: string,
    language: LiveLanguageHint = 'mixed',
  ): Promise<number | null> {
    const normalized = normalizeSpeculativePrefix(partialOrStableText);
    if (!normalized || normalized.length < 2) {
      return null;
    }
    if (this.activeFrontTurn) {
      return null;
    }
    if (this.speculative) {
      if (this.speculative.normalizedPrefix === normalized) {
        return this.speculative.turnId;
      }
      await this.cancelSpeculativeDraftInternal();
    }

    // Never compete with an idle compaction task
    this.compactor.cancelInFlight();

    const turnId = ++this.turnCounter;
    this.state = 'speculating';
    this.events.onSpeculativeStart?.(turnId);

    const abortController = new AbortController();
    const spec: SpeculativeDraftRuntime = {
      turnId,
      rawPartialText: partialOrStableText,
      normalizedPrefix: normalized,
      language,
      startedAt: performance.now(),
      firstTokenAt: null,
      abortController,
      cancelledByCaller: false,
      committed: false,
      seqCounter: 0,
      cleanAccum: '',
      lastEmotion: 'neutral',
      bufferedFrontDeltas: [],
      bufferedSpeakClauses: [],
      bufferedDelegates: [],
      liveForwarder: null,
      promise: Promise.resolve({
        cleanText: '',
        delegated: false,
        aborted: false,
        ttftMs: 0,
      }),
    };

    const userPromptText = this.attachPendingHeavyContext(partialOrStableText);
    const historySnapshot = [...this.history];

    spec.promise = (async () => {
      try {
        let isSpecHeavy = false;
        if (this.intentRouter) {
          try {
            const pred = await this.intentRouter.predict(partialOrStableText);
            isSpecHeavy = pred.intent === 'HEAVY';
          } catch {
            isSpecHeavy = false;
          }
        }
        if (spec.cancelledByCaller || abortController.signal.aborted) {
          return { cleanText: '', delegated: false, aborted: true, ttftMs: 0 };
        }

        const result = await runFrontBrainTurn({
          adapter: this.kvAdapter,
          history: historySnapshot,
          userText: userPromptText,
          language,
          signal: abortController.signal,
          softTokenBudget: isSpecHeavy ? Math.min(20, this.softTokenBudget) : this.softTokenBudget,
          maxTokens: isSpecHeavy ? Math.min(30, this.maxFrontTokens) : this.maxFrontTokens,
          bridgeOnly: isSpecHeavy,
          onFirstToken: () => {
            if (spec.firstTokenAt === null) {
              spec.firstTokenAt = performance.now();
            }
          },
          onStep: (step) => {
            if (spec.cancelledByCaller) return;
            spec.cleanAccum = step.cleanAccum;
            spec.lastEmotion = step.emotion;

            if (step.cleanDelta) {
              if (spec.liveForwarder) {
                spec.liveForwarder.onDelta(
                  step.cleanDelta,
                  step.cleanAccum,
                  step.emotion,
                );
              } else {
                spec.bufferedFrontDeltas.push({
                  delta: step.cleanDelta,
                  cleanAccum: step.cleanAccum,
                  emotion: step.emotion,
                });
              }
            }

            for (const clause of step.speakClauses) {
              if (spec.liveForwarder) {
                spec.liveForwarder.onSpeakClause(clause.text, clause.emotion);
              } else {
                spec.bufferedSpeakClauses.push(clause);
              }
            }

            for (const d of step.newDelegates) {
              if (spec.liveForwarder) {
                spec.liveForwarder.onDelegate(d);
              } else {
                spec.bufferedDelegates.push(d);
              }
            }
          },
        });

        return {
          cleanText: result.segment.cleanText,
          delegated: result.delegates.length > 0,
          aborted: result.aborted || spec.cancelledByCaller,
          ttftMs: result.ttftMs,
        };
      } catch {
        return {
          cleanText: spec.cleanAccum,
          delegated: spec.bufferedDelegates.length > 0,
          aborted: true,
          ttftMs: 0,
        };
      }
    })();

    this.speculative = spec;
    return turnId;
  }

  /**
   * Commit speculative draft on normalized prefix match (0ms re-prefill),
   * OR roll back via O(1) `xcRollbackLastTurn` on mismatch and run a clean turn.
   */
  async commitOrCancelSpeculative(
    finalUserText: string,
    isComplete: boolean,
    language?: LiveLanguageHint,
  ): Promise<LiveBrainTurnMetrics | null> {
    const spec = this.speculative;
    if (!spec) {
      if (!isComplete) return null;
      return this.handleUserTurn(finalUserText, language);
    }

    const lang = language ?? spec.language;
    const normFinal = normalizeSpeculativePrefix(finalUserText);
    const isHit =
      isComplete && normFinal.length > 0 && normFinal === spec.normalizedPrefix;

    if (!isHit) {
      await this.cancelSpeculativeDraftInternal();
      if (!isComplete) {
        this.state = 'listening';
        return null;
      }
      this.speculativeMissCount += 1;
      return this.handleUserTurn(finalUserText, lang);
    }

    // Speculative Hit: zero re-prefill, commit live stream cleanly!
    this.speculative = null;
    spec.committed = true;
    this.speculativeHitCount += 1;
    const commitAt = performance.now();
    const savedMs = Math.max(1, Math.round(commitAt - spec.startedAt));
    this.speculativeMsSavedTotal += savedMs;

    this.compactor.cancelInFlight();
    this.state = 'speaking';

    const userHistoryText = this.attachPendingHeavyContext(finalUserText);
    let seqCounter = 0;
    let delegated = false;
    let bridgeForHeavy = spec.cleanAccum;

    let isHeavy = false;
    if (this.intentRouter) {
      try {
        const pred = await this.intentRouter.predict(finalUserText);
        if (pred.intent === 'HEAVY') {
          isHeavy = true;
        }
      } catch {
        isHeavy = false;
      }
    }

    const activeTurn: ActiveTurnRuntime = {
      turnId: spec.turnId,
      userText: userHistoryText,
      language: lang,
      startedAt: commitAt,
      abortController: spec.abortController,
      abortedByBargeIn: false,
      seqCounter: 0,
      donePromise: Promise.resolve(),
    };
    this.activeFrontTurn = activeTurn;

    if (isHeavy && !delegated) {
      delegated = true;
      this.delegateCount += 1;
      this.startHeavyDelegation(
        spec.turnId,
        { task: finalUserText, urgency: 'deep', rawTag: '' },
        finalUserText,
        spec.cleanAccum,
      );
      if (activeTurn.abortedByBargeIn) {
        if (this.activeFrontTurn === activeTurn) {
          this.activeFrontTurn = null;
        }
        return null;
      }
      this.events.onDelegateStarted?.(finalUserText, spec.turnId);
      if (activeTurn.abortedByBargeIn) {
        if (this.activeFrontTurn === activeTurn) {
          this.activeFrontTurn = null;
        }
        return null;
      }
    }

    const launchDelegate = (d: ParsedDelegateDirective) => {
      if (activeTurn.abortedByBargeIn) return;
      if (delegated) return;
      const resolvedTask = d.task.trim() || finalUserText;
      delegated = true;
      this.delegateCount += 1;
      this.startHeavyDelegation(
        spec.turnId,
        { ...d, task: resolvedTask },
        finalUserText,
        bridgeForHeavy || spec.cleanAccum,
      );
      if (activeTurn.abortedByBargeIn) return;
      this.events.onDelegateStarted?.(resolvedTask, spec.turnId);
    };

    // 1. Flush already-buffered speculative deltas & clauses without re-prefilling
    for (const d of spec.bufferedFrontDeltas) {
      this.events.onFrontDelta?.(d.delta, d.cleanAccum, d.emotion);
    }
    for (const clause of spec.bufferedSpeakClauses) {
      this.emitSpeakChunk({
        text: clause.text,
        emotion: clause.emotion,
        seq: seqCounter++,
        turnId: spec.turnId,
        source: 'front',
      });
    }
    for (const del of spec.bufferedDelegates) {
      launchDelegate(del);
    }

    // 2. Attach live forwarder for any tail tokens still arriving
    spec.liveForwarder = {
      onDelta: (delta, cleanAccum, emotion) => {
        if (activeTurn.abortedByBargeIn) return;
        bridgeForHeavy = cleanAccum;
        this.events.onFrontDelta?.(delta, cleanAccum, emotion);
      },
      onSpeakClause: (text, emotion) => {
        if (activeTurn.abortedByBargeIn) return;
        this.emitSpeakChunk({
          text,
          emotion,
          seq: seqCounter++,
          turnId: spec.turnId,
          source: 'front',
        });
      },
      onDelegate: (d) => {
        launchDelegate(d);
      },
    };

    const completionPromise = (async (): Promise<LiveBrainTurnMetrics | null> => {
      const outcome = await spec.promise;
      if (this.activeFrontTurn === activeTurn) {
        this.activeFrontTurn = null;
      }
      if (activeTurn.abortedByBargeIn) {
        return null;
      }

      const fullReply = outcome.cleanText || spec.cleanAccum;
      this.recordCompletedTurn(userHistoryText, fullReply);

      const perceivedTtft =
        spec.firstTokenAt !== null && spec.firstTokenAt <= commitAt
          ? 0
          : Math.max(0, Math.round((spec.firstTokenAt ?? commitAt) - commitAt));

      const metrics: LiveBrainTurnMetrics = {
        turnId: spec.turnId,
        ttftMs: perceivedTtft,
        speculativeMsSaved: savedMs,
        wasSpeculativeHit: true,
        delegated: delegated || outcome.delegated,
        kvCacheHitTokens: this.compactor.estimateTokens(this.history),
      };

      this.state = this.heavyWorker.isRunning() ? 'thinking' : 'idle';
      this.events.onTurnComplete?.(spec.turnId, fullReply, metrics);
      this.scheduleIdleCompactionIfReady();
      return metrics;
    })();

    activeTurn.donePromise = completionPromise.then(() => undefined);
    return completionPromise;
  }

  /**
   * Standard non-speculative user turn entry point.
   */
  async handleUserTurn(
    userText: string,
    language: LiveLanguageHint = 'mixed',
  ): Promise<LiveBrainTurnMetrics | null> {
    const trimmed = userText.trim();
    if (!trimmed) return null;

    if (this.speculative) {
      await this.cancelSpeculativeDraftInternal();
    }
    if (this.activeFrontTurn) {
      await this.abortActiveFrontTurn();
    }

    this.compactor.cancelInFlight();
    const turnId = ++this.turnCounter;
    const abortController = new AbortController();
    const startedAt = performance.now();
    this.state = 'speaking';

    const userHistoryText = this.attachPendingHeavyContext(trimmed);
    const historySnapshot = [...this.history];

    let seqCounter = 0;
    let delegated = false;
    let bridgeAccum = '';

    // Evaluate intent router immediately (< 5 ms latency)
    let isHeavy = false;
    const resolvedTask = trimmed;
    if (this.intentRouter) {
      try {
        const pred = await this.intentRouter.predict(trimmed);
        if (pred.intent === 'HEAVY') {
          isHeavy = true;
        }
      } catch {
        isHeavy = false;
      }
    }

    const activeTurn: ActiveTurnRuntime = {
      turnId,
      userText: userHistoryText,
      language,
      startedAt,
      abortController,
      abortedByBargeIn: false,
      seqCounter: 0,
      donePromise: Promise.resolve(),
    };
    this.activeFrontTurn = activeTurn;

    if (isHeavy) {
      delegated = true;
      this.delegateCount += 1;
      this.startHeavyDelegation(
        turnId,
        { task: resolvedTask, urgency: 'deep', rawTag: '' },
        trimmed,
        '',
      );
      if (activeTurn.abortedByBargeIn) {
        if (this.activeFrontTurn === activeTurn) {
          this.activeFrontTurn = null;
        }
        return null;
      }
      this.events.onDelegateStarted?.(resolvedTask, turnId);
      if (activeTurn.abortedByBargeIn) {
        if (this.activeFrontTurn === activeTurn) {
          this.activeFrontTurn = null;
        }
        return null;
      }
    }

    const runPromise = (async (): Promise<LiveBrainTurnMetrics | null> => {
      try {
        const result = await runFrontBrainTurn({
          adapter: this.kvAdapter,
          history: historySnapshot,
          userText: userHistoryText,
          language,
          signal: abortController.signal,
          softTokenBudget: isHeavy ? Math.min(20, this.softTokenBudget) : this.softTokenBudget,
          maxTokens: isHeavy ? Math.min(30, this.maxFrontTokens) : this.maxFrontTokens,
          bridgeOnly: isHeavy,
          onStep: (step) => {
            if (activeTurn.abortedByBargeIn) return;
            bridgeAccum = step.cleanAccum;
            if (step.cleanDelta) {
              this.events.onFrontDelta?.(
                step.cleanDelta,
                step.cleanAccum,
                step.emotion,
              );
            }
            for (const clause of step.speakClauses) {
              this.emitSpeakChunk({
                text: clause.text,
                emotion: clause.emotion,
                seq: seqCounter++,
                turnId,
                source: 'front',
              });
            }
            for (const d of step.newDelegates) {
              if (!delegated) {
                const task = d.task.trim() || trimmed;
                delegated = true;
                this.delegateCount += 1;
                this.startHeavyDelegation(
                  turnId,
                  { ...d, task },
                  trimmed,
                  bridgeAccum || step.cleanAccum,
                );
                if (activeTurn.abortedByBargeIn) return;
                this.events.onDelegateStarted?.(task, turnId);
              }
            }
          },
        });

        if (activeTurn.abortedByBargeIn) {
          return null;
        }

        const fullReply = result.segment.cleanText;
        this.recordCompletedTurn(userHistoryText, fullReply);

        const metrics: LiveBrainTurnMetrics = {
          turnId,
          ttftMs: Math.round(result.ttftMs),
          speculativeMsSaved: 0,
          wasSpeculativeHit: false,
          delegated,
          kvCacheHitTokens: this.compactor.estimateTokens(this.history),
        };

        this.state = this.heavyWorker.isRunning() ? 'thinking' : 'idle';
        this.events.onTurnComplete?.(turnId, fullReply, metrics);
        this.scheduleIdleCompactionIfReady();
        return metrics;
      } finally {
        if (this.activeFrontTurn === activeTurn) {
          this.activeFrontTurn = null;
        }
      }
    })();

    activeTurn.donePromise = runPromise.then(() => undefined);
    return runPromise;
  }

  /**
   * Record listener backchannel acknowledgment (e.g. "mm-hmm", "对对") cleanly
   * WITHOUT interrupting, aborting, or altering active generation / KV cache.
   */
  handleBackchannelAck(ackText = ''): {
    logged: boolean;
    backchannelCount: number;
    wasActiveGenerationPreserved: boolean;
  } {
    this.backchannelCount += 1;
    this.lastBackchannelAt = Date.now();
    this.lastBackchannelText = ackText.trim() || null;
    return {
      logged: true,
      backchannelCount: this.backchannelCount,
      wasActiveGenerationPreserved:
        this.activeFrontTurn !== null ||
        this.speculative !== null ||
        this.heavyWorker.isRunning(),
    };
  }

  /**
   * Amend an active in-flight Heavyworker task with follow-up user details.
   */
  amendActiveHeavyTask(additionalUserText: string): boolean {
    return this.heavyWorker.amendActive(additionalUserText);
  }

  /**
   * Handle user barge-in: abort stream immediately, truncate KV cache to `heardText` via
   * O(1) `xcTruncateReplyToHeard`, update history to `[interrupted]`, and abort/amend Heavyworker.
   */
  async handleBargeIn(
    heardText: string,
    options: BargeInOptions = {},
  ): Promise<{
    truncated: boolean;
    poppedTokens: number;
    remainingTokens: number;
    interruptedText: string;
  }> {
    this.compactor.cancelInFlight();

    // If an uncommitted speculative draft was running, roll it back cleanly first
    if (this.speculative) {
      await this.cancelSpeculativeDraftInternal();
    }

    const activeTurn = this.activeFrontTurn;
    if (activeTurn) {
      activeTurn.abortedByBargeIn = true;
      activeTurn.abortController.abort();
      this.kvAdapter.interruptGenerate();
      await Promise.race([
        activeTurn.donePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 60)),
      ]);
      if (this.activeFrontTurn === activeTurn) {
        this.activeFrontTurn = null;
      }
    } else {
      this.kvAdapter.interruptGenerate();
    }

    // Handle active Heavyworker (amend vs abort vs keep)
    const heavyAction = options.heavyAction ?? 'abort';
    if (heavyAction === 'amend' && options.amendmentText) {
      this.heavyWorker.amendActive(options.amendmentText);
    } else if (heavyAction === 'abort') {
      this.heavyWorker.abortActive();
    }

    const truncResult = await this.kvAdapter.xcTruncateReplyToHeard(heardText);
    this.truncationCount += 1;

    const interruptedText = formatInterruptedAssistantText(heardText);
    if (activeTurn) {
      // Mid-stream turn hadn't written to `history` yet: record user + truncated assistant reply
      this.history.push(
        { role: 'user', content: activeTurn.userText },
        { role: 'assistant', content: interruptedText },
      );
    } else if (
      this.history.length > 0 &&
      this.history[this.history.length - 1].role === 'assistant'
    ) {
      // Completed turn was being read aloud via TTS: update its assistant message in-place
      this.history[this.history.length - 1] = {
        role: 'assistant',
        content: interruptedText,
      };
    }

    this.state = 'listening';
    return {
      ...truncResult,
      interruptedText,
    };
  }

  /**
   * Explicitly run compaction if system state is currently `idle` and watermark is reached.
   * No-op when busy.
   */
  async runIdleCompactionIfNeeded(): Promise<boolean> {
    const outcome = await this.compactor.maybeCompact(
      this.history,
      (compactedHistory) => {
        this.history = compactedHistory;
        // Re-sync underlying KV cache prefix only when history actually compacts while idle
        void this.kvAdapter.resetChat().catch(() => {});
      },
    );
    return Boolean(outcome?.compacted);
  }

  async waitForActiveHeavyTask(): Promise<string | null> {
    if (!this.activeHeavyHandle) return null;
    try {
      return await this.activeHeavyHandle.result;
    } catch {
      return null;
    }
  }

  async reset(): Promise<void> {
    this.compactor.reset();
    if (this.speculative) {
      this.speculative.cancelledByCaller = true;
      this.speculative.abortController.abort();
      this.speculative = null;
    }
    if (this.activeFrontTurn) {
      this.activeFrontTurn.abortedByBargeIn = true;
      this.activeFrontTurn.abortController.abort();
      this.activeFrontTurn = null;
    }
    this.heavyWorker.abortActive();
    this.activeHeavyHandle = null;
    this.kvAdapter.interruptGenerate();
    await this.kvAdapter.resetChat();
    this.history = [];
    this.pendingHeavyContextNotes = [];
    this.lastHeavyResult = null;
    this.state = 'idle';
  }

  private scheduleIdleCompactionIfReady(): void {
    if (this.state !== 'idle') return;
    if (!this.compactor.shouldCompact(this.history)) return;
    queueMicrotask(() => {
      if (this.state === 'idle') {
        void this.runIdleCompactionIfNeeded();
      }
    });
  }

  private emitSpeakChunk(chunk: LiveSpeakChunk): void {
    this.events.onSpeakChunk?.(chunk);
  }

  private attachPendingHeavyContext(rawUserText: string): string {
    if (this.pendingHeavyContextNotes.length === 0) {
      return rawUserText;
    }
    const notes = this.pendingHeavyContextNotes.splice(0);
    return `[Background analysis context: ${notes.join(' | ')}]\n${rawUserText}`;
  }

  private recordCompletedTurn(userContent: string, assistantContent: string): void {
    this.history.push(
      { role: 'user', content: userContent },
      { role: 'assistant', content: assistantContent },
    );
    void this.memoryAdapter
      .remember(userContent, assistantContent)
      .catch(() => {});
  }

  private startHeavyDelegation(
    turnId: number,
    directive: ParsedDelegateDirective,
    userUtterance: string,
    bridgeSpokenText: string,
  ): void {
    const taskId = `heavy-${turnId}-${Date.now()}`;
    const handle = this.heavyWorker.startTask({
      taskId,
      turnId,
      task: directive.task,
      urgency: directive.urgency,
      userUtterance,
      bridgeSpokenText,
      history: [...this.history],
      callbacks: {
        onDelta: (delta, cleanAccum, emotion) => {
          this.events.onHeavyDelta?.(delta, cleanAccum, emotion);
        },
        onSpeakClause: (text, emotion) => {
          this.emitSpeakChunk({
            text,
            emotion,
            seq: this.heavySeqCounter++,
            turnId,
            source: 'heavy',
          });
        },
        onComplete: (fullCleanText) => {
          this.lastHeavyResult = fullCleanText;
          if (fullCleanText.trim()) {
            this.pendingHeavyContextNotes.push(
              fullCleanText.trim().slice(0, 320),
            );
            void this.memoryAdapter
              .remember(directive.task, fullCleanText)
              .catch(() => {});
          }
          if (this.activeHeavyHandle?.taskId === taskId) {
            this.activeHeavyHandle = null;
          }
          if (!this.activeFrontTurn && !this.speculative) {
            this.state = 'idle';
            this.scheduleIdleCompactionIfReady();
          }
        },
        onError: () => {
          if (this.activeHeavyHandle?.taskId === taskId) {
            this.activeHeavyHandle = null;
          }
          if (!this.activeFrontTurn && !this.speculative) {
            this.state = 'idle';
          }
        },
      },
    });
    this.activeHeavyHandle = handle;
  }

  /** Cancel any in-flight speculative draft without recording a miss metric. */
  async cancelSpeculativeDraft(): Promise<void> {
    await this.cancelSpeculativeDraftInternal();
  }

  private async cancelSpeculativeDraftInternal(): Promise<void> {
    const spec = this.speculative;
    if (!spec) return;
    this.speculative = null;
    spec.cancelledByCaller = true;
    spec.abortController.abort();
    this.kvAdapter.interruptGenerate();
    await Promise.race([
      spec.promise,
      new Promise<void>((resolve) => setTimeout(resolve, 60)),
    ]);
    await this.kvAdapter.xcRollbackLastTurn();
    this.rollbackCount += 1;
  }

  private async abortActiveFrontTurn(): Promise<void> {
    const active = this.activeFrontTurn;
    if (!active) return;
    active.abortedByBargeIn = true;
    active.abortController.abort();
    this.kvAdapter.interruptGenerate();
    await Promise.race([
      active.donePromise,
      new Promise<void>((resolve) => setTimeout(resolve, 60)),
    ]);
    if (this.activeFrontTurn === active) {
      this.activeFrontTurn = null;
    }
  }
}
