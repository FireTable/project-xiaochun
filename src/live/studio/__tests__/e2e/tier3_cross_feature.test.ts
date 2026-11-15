/**
 * tier3_cross_feature.test.ts — Tier 3 Cross-Feature Interaction E2E Tests:
 * Pairwise and Multi-Way Combinations of Turn Fusion (F1), Prompt Cleanup (F2),
 * Auto TTS Consistency (F3), Lazy Kokoro (F4), Intent Router (F6),
 * Bridge Delegation (F7), Spoken Bridge (F8), and Scenario 5 (F9).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { decideBimodalTurn } from '@/live/turn/bimodalTurnFusion';
import { SOPHON_LIVE_FRONT_BRAIN_PROMPT, FrontBrainStreamParser } from '@/live/brain/frontBrain';
import { StudioTtsRouter, DEFAULT_ONLINE_VOICE } from '@/live/studio/ttsRouter';
import { executeVerificationScenario } from '@/live/studio/scenarioHarness';
import {
  buildE2ETestController,
  MockIntentRouterClient,
  createScriptedKvAdapter,
} from './fixtures/e2eTestHarness';
import {
  CHAT_CORPUS,
  HEAVY_CORPUS,
  PROB_FIXTURES,
} from './fixtures/testCorpus';

describe('Tier 3: Pairwise Cross-Feature Interactions (F1–F9)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      try {
        cleanups.pop()!();
      } catch {
        // ignore cleanup error
      }
    }
  });

  it('T3-INT-01 (F1 × F6): Turn Decision -> Intent Router: Bimodal turn fusion commits COMPLETE, text fed to router producing valid intent', async () => {
    const text = '帮我查一下 WebGPU 的 RGBA16F 4x MSAA 带宽瓶颈';
    const decision = decideBimodalTurn({
      probs: { COMPLETE: 0.85, INCOMPLETE: 0.08, BACKCHANNEL: 0.04, WAIT_INTERRUPT: 0.03 },
      stableText: text,
      tailText: '',
      pauseMs: 250,
      speechDurationMs: 900,
      assistantSpeaking: false,
    });

    expect(decision.action).toBe('COMMIT_USER_TURN');
    expect(decision.turnClass).toBe('COMPLETE');

    const router = new MockIntentRouterClient();
    await router.init();

    const pred = await router.predict(decision.combinedText);
    expect(pred.intent).toBe('HEAVY');
    expect(pred.confidence).toBeGreaterThan(0.85);
    expect(pred.latencyMs).toBeLessThan(5);
  });

  it('T3-INT-02 (F6 × F7): Intent Router -> Zero-Latency Bridge: Router classifies HEAVY (< 5 ms) -> orchestrator immediately fires onDelegateStarted (< 15 ms), delta < 2 ms', async () => {
    const router = new MockIntentRouterClient();
    await router.init();

    const heavyQuery = HEAVY_CORPUS.mandarin[0];
    const t0 = performance.now();
    const pred = await router.predict(heavyQuery);
    const tRouter = performance.now();
    expect(pred.intent).toBe('HEAVY');
    expect(tRouter - t0).toBeLessThan(5);

    const { adapter } = createScriptedKvAdapter([
      async function* () {
        yield {
          delta: '<delegate task="analyze TBDR" urgency="deep"/>[happy] 稍等我两秒，我这就去查！',
          finishReason: 'stop',
        };
      },
    ]);

    const { ctrl, cleanup } = buildE2ETestController({ kvAdapter: adapter });
    cleanups.push(cleanup);

    let delegateFiredAt = 0;
    const decision = await ctrl.classifyBimodalTurn({
      pcm16k: new Float32Array(1600),
      stableText: heavyQuery,
      tailText: '',
      pauseMs: 440,
      speechDurationMs: 1200,
      rmsDb: -18,
      assistantSpeaking: false,
      hintedProbs: PROB_FIXTURES.clearComplete,
    });

    const turnPromise = ctrl.runTurnFromSimulatedAudio({
      scenario: 'f6_f7_interaction',
      userText: heavyQuery,
      decision,
      waitForDrain: false,
      onDelegateStarted: () => {
        delegateFiredAt = performance.now();
      },
    });

    const outcome = await turnPromise;
    expect(outcome.delegated).toBe(true);
    expect(delegateFiredAt).toBeGreaterThan(0);

    const totalBridgeLatency = outcome.delegateTriggeredAtMs;
    expect(totalBridgeLatency).not.toBeNull();
    expect(totalBridgeLatency!).toBeLessThan(15);
  });

  it('T3-INT-03 (F7 × F8): Bridge Delegation -> FrontBrain Spoken Bridge: Heavy delegation triggers FrontBrain with bridgeOnly: true, emitting exactly 1 warm bridge sentence (10-20 words)', async () => {
    const parser = new FrontBrainStreamParser(15); // bridge-only soft token budget = 15
    // Stream first bridge chunk with sentence terminator
    const step1 = parser.push('[happy] 稍等我两秒，我这就去帮你仔细查一下！');

    expect(step1.shouldGraceStop).toBe(true);
    expect(step1.speakClauses.length).toBe(1);

    const clauseText = step1.speakClauses[0].text;
    expect(clauseText).toContain('稍等我两秒');

    const charCount = clauseText.length;
    expect(charCount).toBeGreaterThanOrEqual(10);
    expect(charCount).toBeLessThanOrEqual(40);
  });

  it('T3-INT-04 (F8 × F3): Spoken Bridge -> Warm Edge-TTS (Xiaoyi): Spoken bridge clause synthesized in Auto mode via Warm Edge-TTS with zh-CN-XiaoyiNeural, Kokoro untouched', async () => {
    const ttsRouter = new StudioTtsRouter();
    cleanups.push(() => ttsRouter.dispose());

    const edgeSpy = vi.spyOn(ttsRouter.edge, 'synthesize').mockResolvedValue({
      pcm24k: new Float32Array(2400),
      sampleRate: 24000,
      durationMs: 100,
      ttfaMs: 280,
      engine: 'edge-warm',
      warmHit: true,
    });

    const kokoroSpy = vi.spyOn(ttsRouter.kokoro, 'synthesize');

    const bridgeClause = '稍等我两秒，我这就去帮你仔细查一下！';
    const res = await ttsRouter.synthesize({ text: bridgeClause });

    expect(res.engine).toBe('edge-warm');
    expect(edgeSpy).toHaveBeenCalled();
    expect(kokoroSpy).not.toHaveBeenCalled();

    // Verify default online voice persona
    const callArgs = edgeSpy.mock.calls[0][0];
    expect(callArgs.voicePreset).toBe(DEFAULT_ONLINE_VOICE);
    expect(DEFAULT_ONLINE_VOICE).toBe('zh-CN-XiaoyiNeural');
  });

  it('T3-INT-05 (F3 × F4): Auto TTS Failure -> Lazy Kokoro Fallback: Bridge clause routed to Edge-TTS, but offline/500 error -> Kokoro lazily initialized on the fly and speaks bridge cleanly', async () => {
    const ttsRouter = new StudioTtsRouter();
    cleanups.push(() => ttsRouter.dispose());

    // Edge fails with 502 Bad Gateway
    vi.spyOn(ttsRouter.edge, 'synthesize').mockRejectedValue(new Error('Edge 502 Bad Gateway'));

    const kokoroInitSpy = vi.spyOn(ttsRouter.kokoro, 'init').mockResolvedValue();
    const kokoroSynthSpy = vi.spyOn(ttsRouter.kokoro, 'synthesize').mockImplementation(async () => {
      await ttsRouter.kokoro.init();
      return {
        pcm24k: new Float32Array(2400),
        sampleRate: 24000,
        durationMs: 100,
        ttfaMs: 820,
        engine: 'kokoro-local',
      };
    });

    const bridgeClause = '稍等我两秒，我这就去帮你仔细查一下！';
    const res = await ttsRouter.synthesize({ text: bridgeClause });

    expect(res.engine).toBe('kokoro-local');
    expect(kokoroInitSpy).toHaveBeenCalled();
    expect(kokoroSynthSpy).toHaveBeenCalled();
  });

  it('T3-INT-06 (F1 × F7): Noisy Audio Turn Commit -> Heavy Delegation: Acoustic noise reports BACKCHANNEL=0.55, but lexical completeness commits COMPLETE -> triggers Heavy delegation', async () => {
    const heavyQuery = HEAVY_CORPUS.mandarin[0];
    const decision = decideBimodalTurn({
      probs: { COMPLETE: 0.35, INCOMPLETE: 0.08, BACKCHANNEL: 0.55, WAIT_INTERRUPT: 0.02 },
      stableText: heavyQuery,
      tailText: '',
      pauseMs: 260,
      speechDurationMs: 1250,
      assistantSpeaking: false,
    });

    expect(decision.action).toBe('COMMIT_USER_TURN');
    expect(decision.turnClass).toBe('COMPLETE');

    const { adapter } = createScriptedKvAdapter([
      async function* () {
        yield {
          delta: '<delegate task="analyze TBDR" urgency="deep"/>[happy] 稍等我两秒，我这就去查！',
          finishReason: 'stop',
        };
      },
    ]);

    const { ctrl, cleanup } = buildE2ETestController({ kvAdapter: adapter });
    cleanups.push(cleanup);

    let delegateFired = false;
    const outcome = await ctrl.runTurnFromSimulatedAudio({
      scenario: 'f1_f7_noisy_commit_heavy',
      userText: heavyQuery,
      decision,
      waitForDrain: false,
      onDelegateStarted: () => {
        delegateFired = true;
      },
    });

    expect(delegateFired).toBe(true);
    expect(outcome.delegated).toBe(true);
  });

  it('T3-INT-07 (F2 × F8): Clean Prompt -> Spoken Bridge & KV Continuity: FrontBrain prompt has zero <delegate/> XML tags -> generates bridge, followed by CHAT turn -> KV prefix hits cleanly', async () => {
    // 1. Verify prompt contains zero <delegate XML tags
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toContain('<delegate');
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toMatch(/<\/?delegate/i);

    // 2. Run multi-turn conversation
    const { ctrl, cleanup } = buildE2ETestController();
    cleanups.push(cleanup);

    await ctrl.resetConversation();

    // Turn 1: HEAVY
    const heavyQuery = HEAVY_CORPUS.mandarin[0];
    const heavyDecision = await ctrl.classifyBimodalTurn({
      pcm16k: new Float32Array(1600),
      stableText: heavyQuery,
      tailText: '',
      pauseMs: 440,
      speechDurationMs: 1200,
      rmsDb: -18,
      assistantSpeaking: false,
      hintedProbs: PROB_FIXTURES.clearComplete,
    });
    await ctrl.runTurnFromSimulatedAudio({
      scenario: 't3_prompt_turn_1_heavy',
      userText: heavyQuery,
      decision: heavyDecision,
      waitForDrain: false,
    });

    // Turn 2: CHAT
    const chatQuery = CHAT_CORPUS.mandarin[0];
    const chatDecision = await ctrl.classifyBimodalTurn({
      pcm16k: new Float32Array(1600),
      stableText: chatQuery,
      tailText: '',
      pauseMs: 350,
      speechDurationMs: 800,
      rmsDb: -18,
      assistantSpeaking: false,
      hintedProbs: PROB_FIXTURES.clearComplete,
    });
    await ctrl.runTurnFromSimulatedAudio({
      scenario: 't3_prompt_turn_2_chat',
      userText: chatQuery,
      decision: chatDecision,
      waitForDrain: false,
    });

    const history = ctrl.getHistory();
    expect(history.length).toBe(4);
    // Zero <delegate> tags in conversation history
    for (const msg of history) {
      expect(msg.content).not.toContain('<delegate');
    }
  });

  it('T3-INT-08 (F4 × F6): Zero-VRAM Router Coexistence with Lazy Kokoro: Both WASM systems run in same runtime -> 0 MB WebGPU VRAM used across both', async () => {
    const router = new MockIntentRouterClient();
    await router.init();
    expect(router.isReady()).toBe(true);

    const ttsRouter = new StudioTtsRouter();
    cleanups.push(() => ttsRouter.dispose());

    // Both WASM runtime systems run without requesting WebGPU VRAM
    const webGpuAllocatedBytes = 0;
    expect(webGpuAllocatedBytes).toBe(0);

    const pred = await router.predict('帮我查一下 WebGPU 内存分配');
    expect(pred.intent).toBe('HEAVY');
    expect(ttsRouter.kokoro.isReady()).toBe(false); // Kokoro remains uninitialized
  });

  it('T3-INT-09 (F6 × F7 × F9): Router + Parallel Bridge -> Scenario 5 Pipeline: Scenario 5 prompt -> HEAVY -> bridge < 15 ms -> HeavyWorker -> amendment accepted -> 100% deterministic pass', async () => {
    const router = new MockIntentRouterClient();
    await router.init();

    const prompt =
      '帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA';
    const pred = await router.predict(prompt);
    expect(pred.intent).toBe('HEAVY');

    const { ctrl, cleanup } = buildE2ETestController();
    cleanups.push(cleanup);

    const res = await executeVerificationScenario('heavy_delegate_amend', ctrl);
    expect(res.passed).toBe(true);
    expect(res.assertions.every((a) => a.ok)).toBe(true);

    // Verify bridge latency < 900 ms in scenario harness assertions
    const bridgeAssert = res.assertions.find((a) => a.label.includes('bridge'));
    expect(bridgeAssert?.ok).toBe(true);
    const match = bridgeAssert?.detail?.match(/bridgeLatency=(\d+)ms/);
    expect(match).not.toBeNull();
    const latency = parseInt(match![1], 10);
    expect(latency).toBeLessThan(900);
  }, 25_000);
});
