import { describe, expect, it, vi } from 'vitest';
import { LiveOrchestrator } from '@/live/brain/liveOrchestrator';
import { DuplexEar } from '@/live/audio/duplexEar';
import { LiveSpeechPlayer } from '@/live/audio/liveSpeechPlayer';
import { DuplexTurnClient } from '@/live/turn/duplexTurnClient';
import { decideBimodalTurn } from '@/live/turn/bimodalTurnFusion';
import { createDynamicStudioKvAdapter, synthesizeOfflineFallbackPcm24k } from '../fallbackKvAdapter';
import { TelemetryStore } from '../telemetry';
import { executeAllVerificationScenarios, type ScenarioRuntimeController } from '../scenarioHarness';
import type { EmbedStageClient, FrameCadenceMonitor } from '../embedHost';
import { createIntentRouterClient } from '@/live/router';

vi.mock('@/llm/webLLMProvider', () => ({
  isWebLLMReady: () => false,
  preloadWebLLM: vi.fn(),
  getActiveModelId: () => 'MiniCPM5-2B-q4f16_1-MLC',
  streamWebLLMDirect: vi.fn(),
  interruptWebLLMGenerate: vi.fn(),
  rollbackWebLLMLastTurn: vi.fn(),
  truncateWebLLMReplyToHeard: vi.fn(),
  resetWebLLMChat: vi.fn(),
}));

vi.mock('@/memory', () => ({
  getClientMemory: vi.fn(async () => null),
  recallForChat: vi.fn(async () => null),
}));

function buildHeadlessTestController() {
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
    snapshotTurnWindow: () => ({ minFps: 59.5, jank25: 0, jank50: 0 }),
  } as unknown as FrameCadenceMonitor;

  let clockSec = 100;
  const clockInterval = setInterval(() => {
    clockSec += 0.08;
    player.tick(clockSec);
  }, 10);

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

  const ear = new DuplexEar({
    enableAsr: false,
    playbackRmsProvider: () => player.getCurrentPlaybackRms(),
    isAssistantSpeakingProvider: () => player.isPlaying(),
  });
  const duplexTurn = { isReady: () => false } as DuplexTurnClient;

  const drainWaiters = new Set<() => void>();
  let onDelegateHook: (() => void) | null = null;
  let onHeavyHook: ((txt: string, emo: 'neutral' | 'happy' | 'angry' | 'sad' | 'relaxed' | 'surprised' | 'shy') => void) | null = null;
  let delegateTriggeredAtMs: number | null = null;
  let turnStartMs = 0;
  const heavyChunks: string[] = [];
  let seq = 1;

  const intentRouter = createIntentRouterClient();
  void intentRouter.init();

  const orchestrator = new LiveOrchestrator({
    kvAdapter: createDynamicStudioKvAdapter(),
    intentRouter,
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
    intentRouter,
    async resetConversation() {
      player.abortAndFade(0);
      ear.resetUtterance();
      await orchestrator.reset();
    },
    async classifyBimodalTurn(params) {
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
    async runTurnFromSimulatedAudio(opts) {
      turnStartMs = performance.now();
      delegateTriggeredAtMs = null;
      heavyChunks.length = 0;
      onDelegateHook = opts.onDelegateStarted ?? null;
      onHeavyHook = opts.onHeavyClause ?? null;
      telemetry.beginTurn({
        scenario: opts.scenario,
        input: opts.userText,
        turnLabel: opts.decision.turnClass,
        turnProbs: opts.decision.probs,
      });
      const metrics = opts.preSpeculativeText
        ? await orchestrator.commitOrCancelSpeculative(opts.userText, true, opts.lang)
        : await orchestrator.handleUserTurn(opts.userText, opts.lang);

      if (opts.waitForDrain !== false) {
        await ctrl.waitForPlaybackDrain(8000);
      }
      const active = telemetry.getActiveTurn();
      const replyText = active?.replyChunks.join(' ').trim() ?? '';
      const row = telemetry.commitTurn({ minFps: 59.5, jank25: 0, jank50: 0 });
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
    handleBackchannelDuringSpeech(ackText) {
      orchestrator.handleBackchannelAck(ackText);
      return { aborted: false, playerStillActive: player.isPlaying() };
    },
    async executeBargeInInterruption(fallbackText) {
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
    async waitForPlaybackActive(minMs = 150, timeoutMs = 4000) {
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
    async waitForPlaybackDrain(timeoutMs = 8000) {
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
    async waitForHeavyCompletion(timeoutMs = 8000) {
      return Promise.race([
        orchestrator.waitForActiveHeavyTask(),
        new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
      ]);
    },
    getStats: () => orchestrator.getStats(),
    getHistory: () => orchestrator.getHistory(),
  };

  return {
    ctrl,
    cleanup: () => {
      clearInterval(clockInterval);
      player.dispose();
    },
  };
}

describe('Live Studio Telemetry & 5-Scenario Verification Harness', () => {
  it('tracks turn telemetry rows and transcripts deterministically', () => {
    const store = new TelemetryStore();
    store.beginTurn({ scenario: 'zh_banter', input: '你好小春', turnLabel: 'COMPLETE' });
    store.markTtft(42);
    store.markTtsTtfa(120, 'edge-warm');
    store.markFirstSound(185);
    store.appendReplyText('海边风真舒服！');
    const row = store.commitTurn({ minFps: 59.8, jank25: 0, jank50: 0 });
    expect(row?.ttftMs).toBe(42);
    expect(row?.ttsTtfaMs).toBe(120);
    expect(row?.firstSoundMs).toBe(185);
    expect(row?.minFps).toBe(59.8);
    expect(store.getRows()).toHaveLength(1);
  });

  it('passes all 5 bilingual full-duplex scenarios cleanly', async () => {
    const { ctrl, cleanup } = buildHeadlessTestController();
    try {
      const results = await executeAllVerificationScenarios(ctrl);
      expect(results).toHaveLength(5);
      for (const r of results) {
        expect(r.passed, `Scenario ${r.id} failed: ${JSON.stringify(r.assertions)}`).toBe(true);
      }
    } finally {
      cleanup();
    }
  }, 25_000);
});
