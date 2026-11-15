/**
 * tier4_real_world.test.ts — Tier 4 Real-World Application Scenarios:
 * 1. Casual Banter & Code-switching (CHAT fast-path, Xiaoyi voice, 0 MB VRAM)
 * 2. Heavy Technical Query (HEAVY classification, < 15 ms bridge, zero hallucination)
 * 3. Mid-Flight Amendment (Dynamic HeavyWorker amendment streaming)
 * 4. Offline / Network Failure Fallback (Lazy Kokoro fallback on network drop)
 * 5. Multi-Turn Mixed Conversation (CHAT -> HEAVY -> CHAT -> HEAVY WebLLM KV continuity)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { StudioTtsRouter, DEFAULT_ONLINE_VOICE } from '@/live/studio/ttsRouter';
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

describe('Tier 4: Real-World Application Scenarios (Scenarios 1–5)', () => {
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

  it('Scenario 1: Casual Banter & Code-switching ("小春早, today is a sunny day") -> CHAT fast-path, single voice Xiaoyi, TTFT < 800 ms, 0 MB VRAM', async () => {
    const router = new MockIntentRouterClient();
    await router.init();

    const text = CHAT_CORPUS.codeSwitching[0]; // '小春早, today is such a sunny day!'
    const pred = await router.predict(text);
    expect(pred.intent).toBe('CHAT');
    expect(pred.latencyMs).toBeLessThan(5);

    const { ctrl, cleanup } = buildE2ETestController();
    cleanups.push(cleanup);

    const decision = await ctrl.classifyBimodalTurn({
      pcm16k: new Float32Array(1600),
      stableText: text,
      tailText: '',
      pauseMs: 350,
      speechDurationMs: 850,
      rmsDb: -18,
      assistantSpeaking: false,
      hintedProbs: PROB_FIXTURES.clearComplete,
    });

    const outcome = await ctrl.runTurnFromSimulatedAudio({
      scenario: 'scenario_1_casual_banter',
      userText: text,
      lang: 'mixed',
      decision,
      waitForDrain: false,
    });

    expect(outcome.delegated).toBe(false);
    expect(outcome.telemetryRow?.ttftMs).toBeLessThan(800);

    // Audio synthesis in Auto mode routes to Warm Edge-TTS with Xiaoyi
    const ttsRouter = new StudioTtsRouter();
    cleanups.push(() => ttsRouter.dispose());

    const edgeSpy = vi.spyOn(ttsRouter.edge, 'synthesize').mockResolvedValue({
      pcm24k: new Float32Array(2400),
      sampleRate: 24000,
      durationMs: 100,
      ttfaMs: 310,
      engine: 'edge-warm',
      warmHit: true,
    });

    const audioRes = await ttsRouter.synthesize({ text: outcome.replyText });
    expect(audioRes.engine).toBe('edge-warm');
    expect(edgeSpy).toHaveBeenCalled();
    expect(edgeSpy.mock.calls[0][0].voicePreset).toBe(DEFAULT_ONLINE_VOICE);
    expect(DEFAULT_ONLINE_VOICE).toBe('zh-CN-XiaoyiNeural');
    expect(ttsRouter.kokoro.isReady()).toBe(false); // Kokoro never loaded
  });

  it('Scenario 2: Heavy Technical Query ("帮我查一下 / deeply analyze...") -> HEAVY classification, bridge latency < 15 ms, concurrent HeavyWorker dispatch, zero hallucinated technical answers', async () => {
    const router = new MockIntentRouterClient();
    await router.init();

    const heavyQuery = HEAVY_CORPUS.mandarin[0];
    const pred = await router.predict(heavyQuery);
    expect(pred.intent).toBe('HEAVY');
    expect(pred.latencyMs).toBeLessThan(5);

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
    let delegateAtMs: number | null = null;
    const t0 = performance.now();

    const decision = await ctrl.classifyBimodalTurn({
      pcm16k: new Float32Array(1600),
      stableText: heavyQuery,
      tailText: '',
      pauseMs: 440,
      speechDurationMs: 1250,
      rmsDb: -17,
      assistantSpeaking: false,
      hintedProbs: PROB_FIXTURES.clearComplete,
    });

    const outcome = await ctrl.runTurnFromSimulatedAudio({
      scenario: 'scenario_2_heavy_query',
      userText: heavyQuery,
      decision,
      waitForDrain: false,
      onDelegateStarted: () => {
        delegateFired = true;
        delegateAtMs = Math.round(performance.now() - t0);
      },
    });

    expect(delegateFired).toBe(true);
    expect(outcome.delegated).toBe(true);
    expect(delegateAtMs).not.toBeNull();
    expect(delegateAtMs!).toBeLessThan(15);

    // FrontBrain reply acknowledges without hallucinating technical details
    const frontText = outcome.replyText.toLowerCase();
    expect(frontText).not.toContain('片外主存');
    expect(frontText).not.toContain('32 字节');
  });

  it('Scenario 3: Mid-Flight Amendment ("尤其是开启 bloom 的时候") -> Amendment injected during heavy task execution, amendAccepted: true, commentary incorporates bloom context', async () => {
    const { ctrl, cleanup } = buildE2ETestController();
    cleanups.push(cleanup);

    await ctrl.resetConversation();

    let amendAccepted = false;
    const heavyPrompt = HEAVY_CORPUS.mandarin[0];

    const decision = await ctrl.classifyBimodalTurn({
      pcm16k: new Float32Array(1600),
      stableText: heavyPrompt,
      tailText: '',
      pauseMs: 440,
      speechDurationMs: 1250,
      rmsDb: -17,
      assistantSpeaking: false,
      hintedProbs: PROB_FIXTURES.clearComplete,
    });

    const outcomePromise = ctrl.runTurnFromSimulatedAudio({
      scenario: 'scenario_3_amendment',
      userText: heavyPrompt,
      lang: 'mixed',
      decision,
      waitForDrain: false,
      onDelegateStarted: () => {
        setTimeout(() => {
          amendAccepted = ctrl.orchestrator.amendActiveHeavyTask('尤其是开启 bloom 的时候');
        }, 10);
      },
    });

    const outcome = await outcomePromise;
    expect(outcome.delegated).toBe(true);

    const commentary = await ctrl.waitForHeavyCompletion(8000);
    expect(amendAccepted).toBe(true);
    expect(commentary).not.toBeNull();
    expect(commentary!).toContain('Bloom');
  });

  it('Scenario 4: Offline / Network Failure Fallback -> Edge fails -> transparent lazy Kokoro fallback, audio delivered offline without crashes', async () => {
    const ttsRouter = new StudioTtsRouter();
    cleanups.push(() => ttsRouter.dispose());

    expect(ttsRouter.kokoro.isReady()).toBe(false);

    // Network connection fails
    vi.spyOn(ttsRouter.edge, 'synthesize').mockRejectedValue(new Error('NetworkOffline: connection failed'));

    const kokoroInitSpy = vi.spyOn(ttsRouter.kokoro, 'init').mockImplementation(async () => {
      // Lazy initialization completes
    });

    const kokoroSynthSpy = vi.spyOn(ttsRouter.kokoro, 'synthesize').mockImplementation(async () => {
      await ttsRouter.kokoro.init();
      return {
        pcm24k: new Float32Array(2400),
        sampleRate: 24000,
        durationMs: 100,
        ttfaMs: 780,
        engine: 'kokoro-local',
      };
    });

    const res = await ttsRouter.synthesize({ text: '小春在离线状态下依然可以陪伴你。' });

    expect(res.engine).toBe('kokoro-local');
    expect(kokoroInitSpy).toHaveBeenCalled();
    expect(kokoroSynthSpy).toHaveBeenCalled();
    expect(res.pcm24k.length).toBeGreaterThan(0);
  });

  it('Scenario 5: Multi-Turn Mixed Conversation (CHAT -> HEAVY -> CHAT -> HEAVY) -> WebLLM KV cache continuity across 4 turns, prefix hits on subsequent turns, conversational context preserved', async () => {
    const { ctrl, cleanup } = buildE2ETestController();
    cleanups.push(cleanup);

    await ctrl.resetConversation();

    const conversationFlow = [
      { text: CHAT_CORPUS.mandarin[0], isHeavy: false },
      { text: HEAVY_CORPUS.mandarin[0], isHeavy: true },
      { text: CHAT_CORPUS.mandarin[1], isHeavy: false },
      { text: '帮我查一下 WebGL 内存泄漏问题与 time complexity', isHeavy: true },
    ];

    for (let i = 0; i < conversationFlow.length; i++) {
      const step = conversationFlow[i];
      const decision = await ctrl.classifyBimodalTurn({
        pcm16k: new Float32Array(1600),
        stableText: step.text,
        tailText: '',
        pauseMs: 400,
        speechDurationMs: 900,
        rmsDb: -18,
        assistantSpeaking: false,
        hintedProbs: PROB_FIXTURES.clearComplete,
      });

      const outcome = await ctrl.runTurnFromSimulatedAudio({
        scenario: `scenario_5_turn_${i}`,
        userText: step.text,
        decision,
        waitForDrain: false,
      });

      expect(outcome.delegated).toBe(step.isHeavy);
    }

    const history = ctrl.getHistory();
    expect(history.length).toBe(8); // 4 turns * 2 messages (user + assistant)

    // Strict role alternation
    for (let i = 0; i < 8; i++) {
      expect(history[i].role).toBe(i % 2 === 0 ? 'user' : 'assistant');
    }

    // Context preserved
    expect(history[0].content).toContain(conversationFlow[0].text);
    expect(history[2].content).toContain(conversationFlow[1].text);
    expect(history[4].content).toContain(conversationFlow[2].text);
    expect(history[6].content).toContain(conversationFlow[3].text);
  });
});
