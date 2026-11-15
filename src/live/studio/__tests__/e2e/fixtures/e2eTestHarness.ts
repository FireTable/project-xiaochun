/**
 * e2eTestHarness.ts — High-Fidelity Headless Test Harness, Mocks & Telemetry
 * for Live Studio E2E Test Suites.
 */

import { vi } from 'vitest';
import { LiveOrchestrator } from '@/live/brain/liveOrchestrator';
import { DuplexEar } from '@/live/audio/duplexEar';
import { LiveSpeechPlayer } from '@/live/audio/liveSpeechPlayer';
import { DuplexTurnClient } from '@/live/turn/duplexTurnClient';
import { decideBimodalTurn } from '@/live/turn/bimodalTurnFusion';
import { TelemetryStore } from '@/live/studio/telemetry';
import {
  createDynamicStudioKvAdapter,
  synthesizeOfflineFallbackPcm24k,
} from '@/live/studio/fallbackKvAdapter';
import type { EmbedStageClient, FrameCadenceMonitor } from '@/live/studio/embedHost';
import type {
  ScenarioRuntimeController,
  TurnExecutionOutcome,
} from '@/live/studio/scenarioHarness';
import type {
  BrainGenerateRequest,
  BrainKVRuntimeAdapter,
  BrainStreamChunk,
  LiveLanguageHint,
} from '@/live/brain/types';
import type {
  BimodalTurnDecision,
  DuplexTurnProbs,
} from '@/live/turn/types';
import type {
  LiveEmotionTag,
  TtsAudioResult,
  TtsSynthesisRequest,
} from '@/live/tts/types';

export type IntentClass = 'CHAT' | 'HEAVY';

export interface IntentPrediction {
  intent: IntentClass;
  confidence: number;
  latencyMs: number;
  guardrailTriggered?: string;
  probabilities: {
    CHAT: number;
    HEAVY: number;
  };
}

export interface IntentRouterClient {
  init(): Promise<void>;
  predict(text: string): Promise<IntentPrediction>;
  classify?(text: string): Promise<IntentPrediction>;
  warmup?(): Promise<number>;
  isReady(): boolean;
  dispose(): void;
}

/**
 * High-fidelity deterministic Mock Intent Router Client
 * satisfying PROJECT.md §Interface Contracts §1.
 */
export class MockIntentRouterClient implements IntentRouterClient {
  private ready = false;
  private latency = 2.5;

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  setSimulatedLatency(ms: number): void {
    this.latency = ms;
  }

  async classify(text: string): Promise<IntentPrediction> {
    return this.predict(text);
  }

  async warmup(): Promise<number> {
    return this.latency;
  }

  async predict(text: string): Promise<IntentPrediction> {
    const t0 = performance.now();
    const trimmed = text.trim();

    // Fast-path guardrails
    if (!trimmed) {
      return {
        intent: 'CHAT',
        confidence: 0.99,
        latencyMs: performance.now() - t0,
        guardrailTriggered: 'empty_input_default_chat',
        probabilities: { CHAT: 0.99, HEAVY: 0.01 },
      };
    }

    const lower = trimmed.toLowerCase();

    // Ambiguous keyword exception (banter mentioning "代码风裙子" is CHAT)
    if (lower.includes('代码风裙子') || lower.includes('像递归一样开心') || lower.includes('跟 pipeline 似的')) {
      return {
        intent: 'CHAT',
        confidence: 0.92,
        latencyMs: Math.max(0.1, performance.now() - t0),
        guardrailTriggered: 'banter_keyword_whitelist',
        probabilities: { CHAT: 0.92, HEAVY: 0.08 },
      };
    }

    const heavyKeywords = [
      'tbdr',
      'msaa',
      'rgba16f',
      'webgpu',
      'webgl',
      'shader',
      'deeply analyze',
      'look up',
      'analyze',
      'algorithm',
      'time complexity',
      'space complexity',
      'oom crash',
      'memory bandwidth',
      'lock-free',
      'promise 池',
      '二叉树',
      '并发控制',
      '查一下',
      '排查',
      '分析一下',
      'webassembly',
      'wasm',
      'simd',
      'neural network',
      'inference',
      'optimize',
      'bottleneck',
    ];

    const isHeavy = heavyKeywords.some((kw) => lower.includes(kw));
    const simulatedLatencyMs = Math.max(this.latency, performance.now() - t0);

    if (isHeavy) {
      return {
        intent: 'HEAVY',
        confidence: 0.96,
        latencyMs: simulatedLatencyMs,
        probabilities: { CHAT: 0.04, HEAVY: 0.96 },
      };
    }

    return {
      intent: 'CHAT',
      confidence: 0.94,
      latencyMs: simulatedLatencyMs,
      probabilities: { CHAT: 0.94, HEAVY: 0.06 },
    };
  }

  dispose(): void {
    this.ready = false;
  }
}

/**
 * Standard ES class mock for WarmEdgeTtsClient (constructor-safe for `new`).
 */
export class MockWarmEdgeTtsClient {
  prewarm = vi.fn().mockResolvedValue({ ok: true, warmSockets: 2 });
  synthesize = vi.fn().mockImplementation(
    async (_req: TtsSynthesisRequest): Promise<TtsAudioResult> => ({
      pcm24k: new Float32Array(2400),
      sampleRate: 24000,
      durationMs: 100,
      ttfaMs: 280,
      engine: 'edge-warm',
      warmHit: true,
    }),
  );
  dispose = vi.fn();
}

/**
 * Standard ES class mock for KokoroTtsClient (constructor-safe for `new`).
 */
export class MockKokoroTtsClient {
  private ready = false;
  init = vi.fn().mockImplementation(async () => {
    this.ready = true;
  });
  isReady = vi.fn().mockImplementation(() => this.ready);
  synthesize = vi.fn().mockImplementation(
    async (_req: TtsSynthesisRequest): Promise<TtsAudioResult> => ({
      pcm24k: new Float32Array(2400),
      sampleRate: 24000,
      durationMs: 100,
      ttfaMs: 850,
      engine: 'kokoro-local',
    }),
  );
  dispose = vi.fn();
}

/**
 * Factory creating scripted BrainKVRuntimeAdapter for precise KV stream testing.
 */
export function createScriptedKvAdapter(
  scriptedTurns: Array<
    (req: BrainGenerateRequest) => AsyncGenerator<BrainStreamChunk, void, void>
  > = [],
) {
  const requests: BrainGenerateRequest[] = [];
  const rollbackMock = vi.fn(async () => ({ popped: 18, remaining: 24 }));
  const truncateMock = vi.fn(async (heardText: string) => ({
    truncated: true,
    poppedTokens: 11,
    remainingTokens: 24 + heardText.length,
  }));
  const interruptMock = vi.fn();
  const resetMock = vi.fn(async () => {});

  const adapter: BrainKVRuntimeAdapter = {
    streamChat(req) {
      requests.push(req);
      const handler = scriptedTurns.shift();
      if (!handler) {
        return (async function* () {
          yield { delta: '[happy] 在呢～', finishReason: 'stop' };
        })();
      }
      return handler(req);
    },
    interruptGenerate: interruptMock,
    xcRollbackLastTurn: rollbackMock,
    xcTruncateReplyToHeard: truncateMock,
    resetChat: resetMock,
  };

  return {
    adapter,
    requests,
    rollbackMock,
    truncateMock,
    interruptMock,
    resetMock,
  };
}

export interface E2ETestHarnessOptions {
  kvAdapter?: BrainKVRuntimeAdapter;
  intentRouter?: IntentRouterClient;
  autoClock?: boolean;
}

export function buildE2ETestController(opts: E2ETestHarnessOptions = {}) {
  const telemetry = new TelemetryStore();
  const embedHost = {
    isReady: () => true,
    getActiveAudioStreamId: () => 'mock-stream',
    beginAudioStream: vi.fn(() => 'mock-stream'),
    pushAudioChunk: vi.fn(),
    endAudioStream: vi.fn(),
    sendClock: vi.fn(),
    setTurnState: vi.fn(),
    setExpression: vi.fn(),
    setBubble: vi.fn(),
    setInferenceActive: vi.fn(),
  } as unknown as EmbedStageClient;

  const cadence = {
    beginTurnWindow: vi.fn(),
    snapshotTurnWindow: () => ({ minFps: 59.8, jank25: 0, jank50: 0 }),
  } as unknown as FrameCadenceMonitor;

  let clockSec = 100;
  let clockInterval: NodeJS.Timeout | null = null;

  const player = new LiveSpeechPlayer({
    headless: true,
    autoTick: false,
    clock: () => clockSec,
    onClauseStart: () => {
      telemetry.markFirstSound();
    },
    onDrain: () => {
      for (const fn of drainWaiters) fn();
      drainWaiters.clear();
    },
    onAbort: () => {
      for (const fn of drainWaiters) fn();
      drainWaiters.clear();
    },
  });

  if (opts.autoClock !== false) {
    clockInterval = setInterval(() => {
      clockSec += 0.08;
      player.tick(clockSec);
    }, 10);
  }

  const ear = new DuplexEar({
    enableAsr: false,
    playbackRmsProvider: () => player.getCurrentPlaybackRms(),
    isAssistantSpeakingProvider: () => player.isPlaying(),
  });

  const duplexTurn = { isReady: () => false } as DuplexTurnClient;

  const drainWaiters = new Set<() => void>();
  let onDelegateHook: (() => void) | null = null;
  let onHeavyHook: ((txt: string, emo: LiveEmotionTag) => void) | null = null;
  let delegateTriggeredAtMs: number | null = null;
  let turnStartMs = 0;
  const heavyChunks: string[] = [];
  let seq = 1;

  const defaultRouter = opts.intentRouter ?? new MockIntentRouterClient();
  void defaultRouter.init();

  const orchestrator = new LiveOrchestrator({
    kvAdapter: opts.kvAdapter ?? createDynamicStudioKvAdapter(),
    intentRouter: defaultRouter as any,
    heavyConfig: { mode: 'local-thinking' },
    events: {
      onFrontDelta: () => telemetry.markTtft(),
      onSpeakChunk: (chunk) => {
        telemetry.appendReplyText(chunk.text);
        if (chunk.source === 'heavy') {
          heavyChunks.push(chunk.text);
          onHeavyHook?.(chunk.text, chunk.emotion);
        }
        telemetry.markTtsTtfa(15, 'test-synth');
        player.enqueueClause({
          seq: seq++,
          text: chunk.text,
          pcm24k: synthesizeOfflineFallbackPcm24k(chunk.text),
          emotion: chunk.emotion,
        });
      },
      onDelegateStarted: () => {
        if (delegateTriggeredAtMs === null) {
          delegateTriggeredAtMs = Math.round(performance.now() - turnStartMs);
        }
        onDelegateHook?.();
      },
      onTurnComplete: (_id, _reply, metrics) => {
        const active = telemetry.getActiveTurn();
        if (active) {
          telemetry.markTurnClassification(
            active.turnLabel,
            active.turnProbs,
            metrics.wasSpeculativeHit,
          );
          telemetry.markTtft(metrics.ttftMs);
        }
      },
    },
  });

  const ctrl: ScenarioRuntimeController = {
    orchestrator,
    ear,
    player,
    duplexTurn,
    embedHost,
    cadence,
    telemetry,
    intentRouter: defaultRouter as any,
    async resetConversation() {
      player.abortAndFade(0);
      ear.resetUtterance();
      await orchestrator.reset();
    },
    async classifyBimodalTurn(params: {
      pcm16k: Float32Array;
      stableText: string;
      tailText: string;
      pauseMs: number;
      speechDurationMs: number;
      rmsDb: number;
      assistantSpeaking: boolean;
      hintedProbs?: DuplexTurnProbs;
    }): Promise<BimodalTurnDecision> {
      return decideBimodalTurn({
        probs: params.hintedProbs ?? {
          COMPLETE: 0.85,
          INCOMPLETE: 0.1,
          BACKCHANNEL: 0.03,
          WAIT_INTERRUPT: 0.02,
        },
        stableText: params.stableText,
        tailText: params.tailText,
        pauseMs: params.pauseMs,
        speechDurationMs: params.speechDurationMs,
        rmsDb: params.rmsDb,
        assistantSpeaking: params.assistantSpeaking,
      });
    },
    async runTurnFromSimulatedAudio(turnOpts: {
      scenario: string;
      userText: string;
      preSpeculativeText?: string;
      lang?: LiveLanguageHint;
      decision: BimodalTurnDecision;
      waitForDrain?: boolean;
      onDelegateStarted?: () => void;
      onHeavyClause?: (text: string, emotion: LiveEmotionTag) => void;
    }): Promise<TurnExecutionOutcome> {
      turnStartMs = performance.now();
      delegateTriggeredAtMs = null;
      heavyChunks.length = 0;
      onDelegateHook = turnOpts.onDelegateStarted ?? null;
      onHeavyHook = turnOpts.onHeavyClause ?? null;
      telemetry.beginTurn({
        scenario: turnOpts.scenario,
        input: turnOpts.userText,
        turnLabel: turnOpts.decision.turnClass,
        turnProbs: turnOpts.decision.probs,
      });
      const metrics = turnOpts.preSpeculativeText
        ? await orchestrator.commitOrCancelSpeculative(turnOpts.userText, true, turnOpts.lang)
        : await orchestrator.handleUserTurn(turnOpts.userText, turnOpts.lang);

      if (turnOpts.waitForDrain !== false) {
        await ctrl.waitForPlaybackDrain(8000);
      }
      const active = telemetry.getActiveTurn();
      const replyText = active?.replyChunks.join(' ').trim() ?? '';
      const row = telemetry.commitTurn({ minFps: 59.8, jank25: 0, jank50: 0 });
      onDelegateHook = null;
      onHeavyHook = null;
      return {
        replyText,
        delegated: Boolean(metrics?.delegated),
        delegateTriggeredAtMs,
        heavyCommentary: heavyChunks.join(' '),
        speculativeHit: Boolean(metrics?.wasSpeculativeHit),
        telemetryRow: row,
      };
    },
    handleBackchannelDuringSpeech(ackText: string, _decision: BimodalTurnDecision): {
      aborted: boolean;
      playerStillActive: boolean;
    } {
      orchestrator.handleBackchannelAck(ackText);
      return { aborted: false, playerStillActive: player.isPlaying() };
    },
    async executeBargeInInterruption(fallbackText: string): Promise<{
      abortLatencyMs: number;
      heardText: string;
      truncated: boolean;
      interruptedText: string;
    }> {
      const t0 = performance.now();
      const abortRes = player.abortAndFade(45);
      const abortLatencyMs = performance.now() - t0;
      telemetry.markInterrupted();
      const heard = abortRes.heardText.trim() || fallbackText;
      const trunc = await orchestrator.handleBargeIn(heard, { heavyAction: 'abort' });
      return {
        abortLatencyMs,
        heardText: heard,
        truncated: trunc.truncated,
        interruptedText: trunc.interruptedText,
      };
    },
    async waitForPlaybackActive(minMs = 150, timeoutMs = 4000): Promise<boolean> {
      const deadline = performance.now() + timeoutMs;
      const minSamples = Math.floor((minMs / 1000) * 24_000);
      while (performance.now() < deadline) {
        if (player.isPlaying() && player.getState().sampleOffset >= minSamples) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 15));
      }
      return player.isPlaying();
    },
    async waitForPlaybackDrain(timeoutMs = 8000): Promise<void> {
      if (!player.isPlaying()) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          drainWaiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        drainWaiters.add(done);
      });
    },
    async waitForHeavyCompletion(timeoutMs = 8000): Promise<string | null> {
      return Promise.race([
        orchestrator.waitForActiveHeavyTask(),
        new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
      ]);
    },
    getStats: () => orchestrator.getStats(),
    getHistory: () => orchestrator.getHistory(),
  };

  const advanceClock = (seconds: number) => {
    clockSec += seconds;
    player.tick(clockSec);
  };

  return {
    ctrl,
    player,
    ear,
    orchestrator,
    telemetry,
    advanceClock,
    cleanup: async () => {
      if (clockInterval) clearInterval(clockInterval);
      player.dispose();
      ear.dispose();
      await orchestrator.reset();
    },
  };
}
