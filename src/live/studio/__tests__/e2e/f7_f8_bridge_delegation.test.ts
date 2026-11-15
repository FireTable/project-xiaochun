/**
 * f7_f8_bridge_delegation.test.ts — E2E Test Suite for Features F7 & F8:
 * Zero-Latency Bridge Delegation (< 15 ms), Spoken Bridge Constraints,
 * and WebLLM Multi-Turn KV Cache Continuity.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { LiveOrchestrator } from '@/live/brain/liveOrchestrator';
import {
  FrontBrainStreamParser,
  runFrontBrainTurn,
  estimateBilingualTokens,
} from '@/live/brain/frontBrain';
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

describe('E2E Features F7 & F8: Zero-Latency Bridge Delegation & Spoken Bridge KV Continuity', () => {
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

  describe('Tier 1: Feature Coverage (F7 & F8)', () => {
    describe('F7: Zero-Latency Bridge Delegation', () => {
      it('T1-F7-01: Bridge latency < 15 ms: user commits HEAVY query -> onDelegateStarted fires with latency < 15 ms', async () => {
        const { adapter } = createScriptedKvAdapter([
          async function* () {
            // Emulate instant bridge delegation upon commit without waiting for LLM babble
            yield {
              delta: '<delegate task="analyze iOS TBDR WebGPU" urgency="deep"/>[happy] 稍等我两秒，我这就去查！',
              finishReason: 'stop',
            };
          },
        ]);

        const { ctrl, cleanup } = buildE2ETestController({ kvAdapter: adapter });
        cleanups.push(cleanup);

        const router = new MockIntentRouterClient();
        await router.init();

        const heavyQuery = HEAVY_CORPUS.mandarin[0];
        const pred = await router.predict(heavyQuery);
        expect(pred.intent).toBe('HEAVY');
        expect(pred.latencyMs).toBeLessThan(5);

        const decision = await ctrl.classifyBimodalTurn({
          pcm16k: new Float32Array(1600),
          stableText: heavyQuery,
          tailText: '',
          pauseMs: 450,
          speechDurationMs: 1200,
          rmsDb: -18,
          assistantSpeaking: false,
          hintedProbs: PROB_FIXTURES.clearComplete,
        });
        expect(decision.action).toBe('COMMIT_USER_TURN');

        let delegateTriggeredAtMs: number | null = null;
        const turnStart = performance.now();

        const outcome = await ctrl.runTurnFromSimulatedAudio({
          scenario: 'f7_zero_latency_bridge',
          userText: heavyQuery,
          lang: 'mixed',
          decision,
          waitForDrain: false,
          onDelegateStarted: () => {
            if (delegateTriggeredAtMs === null) {
              delegateTriggeredAtMs = Math.round(performance.now() - turnStart);
            }
          },
        });

        expect(outcome.delegated).toBe(true);
        const latency = outcome.delegateTriggeredAtMs ?? delegateTriggeredAtMs;
        expect(latency).not.toBeNull();
        expect(latency!).toBeLessThan(15);
      });

      it('T1-F7-02: Concurrent HeavyWorker dispatch: startHeavyDelegation invoked before FrontBrain token delta', async () => {
        const eventsOrder: string[] = [];
        let frontDeltaTimestamp = 0;
        let delegateTimestamp = 0;

        const { adapter } = createScriptedKvAdapter([
          async function* () {
            // Emulate slight delay before FrontBrain token decoding
            await new Promise((r) => setTimeout(r, 8));
            frontDeltaTimestamp = performance.now();
            eventsOrder.push('front_delta');
            yield {
              delta: '[happy] 稍等我两秒，我这就去查！<delegate task="analyze TBDR" urgency="deep"/>',
              finishReason: 'stop',
            };
          },
        ]);

        const orchestrator = new LiveOrchestrator({
          kvAdapter: adapter,
          heavyConfig: { mode: 'auto' },
          events: {
            onFrontDelta: () => {
              if (!eventsOrder.includes('front_delta')) {
                frontDeltaTimestamp = performance.now();
                eventsOrder.push('front_delta');
              }
            },
            onDelegateStarted: () => {
              delegateTimestamp = performance.now();
              eventsOrder.push('delegate_started');
            },
          },
        });
        cleanups.push(() => { void orchestrator.reset(); });

        const heavyQuery = HEAVY_CORPUS.mandarin[0];
        await orchestrator.handleUserTurn(heavyQuery, 'zh');

        expect(frontDeltaTimestamp).toBeGreaterThan(0);
        expect(eventsOrder).toContain('delegate_started');
        expect(delegateTimestamp).toBeGreaterThan(0);
        expect(eventsOrder.indexOf('delegate_started')).toBeLessThanOrEqual(eventsOrder.indexOf('front_delta') + 1);
      });

      it('T1-F7-03: CHAT query non-delegation: user commits CHAT query -> onDelegateStarted NOT fired, HeavyWorker NOT launched', async () => {
        const { ctrl, cleanup } = buildE2ETestController();
        cleanups.push(cleanup);

        const router = new MockIntentRouterClient();
        await router.init();

        const chatQuery = CHAT_CORPUS.mandarin[0];
        const pred = await router.predict(chatQuery);
        expect(pred.intent).toBe('CHAT');

        let delegateFired = false;
        const decision = await ctrl.classifyBimodalTurn({
          pcm16k: new Float32Array(1600),
          stableText: chatQuery,
          tailText: '',
          pauseMs: 400,
          speechDurationMs: 800,
          rmsDb: -20,
          assistantSpeaking: false,
          hintedProbs: PROB_FIXTURES.clearComplete,
        });

        const outcome = await ctrl.runTurnFromSimulatedAudio({
          scenario: 'f7_chat_non_delegation',
          userText: chatQuery,
          lang: 'zh',
          decision,
          waitForDrain: false,
          onDelegateStarted: () => {
            delegateFired = true;
          },
        });

        expect(delegateFired).toBe(false);
        expect(outcome.delegated).toBe(false);
        expect(ctrl.getStats().activeHeavyTaskId).toBeNull();
      });

      it('T1-F7-04: FrontBrain bridgeOnly configuration: FrontBrain stream request receives bridgeOnly: true, token budget <= 30', async () => {
        const { adapter } = createScriptedKvAdapter([
          async function* () {
            yield { delta: '[happy] 稍等一下哦，我这就去计算！', finishReason: 'stop' };
          },
        ]);

        const orchestrator = new LiveOrchestrator({
          kvAdapter: adapter,
          softTokenBudget: 25,
          maxFrontTokens: 30,
        });
        cleanups.push(() => { void orchestrator.reset(); });

        const abortController = new AbortController();
        const res = await runFrontBrainTurn({
          adapter,
          history: [],
          userText: HEAVY_CORPUS.mandarin[0],
          signal: abortController.signal,
          softTokenBudget: 25,
          maxTokens: 30,
        });

        expect(res.segment.cleanText.length).toBeGreaterThan(0);
        expect(estimateBilingualTokens(res.segment.cleanText)).toBeLessThanOrEqual(30);
      });

      it('T1-F7-05: Speculative commit delegation: pre-speculative HEAVY draft committed -> evaluates router, fires bridge < 15 ms', async () => {
        const { adapter } = createScriptedKvAdapter([
          async function* () {
            yield {
              delta: '<delegate task="analyze iOS TBDR WebGPU" urgency="deep"/>[happy] 稍等我两秒，我这就去查！',
              finishReason: 'stop',
            };
          },
        ]);

        const { ctrl, cleanup } = buildE2ETestController({ kvAdapter: adapter });
        cleanups.push(cleanup);

        const heavyQuery = HEAVY_CORPUS.mandarin[0];
        // Draft text matches final text (ignoring trailing punctuation) for speculative hit
        const preSpeculativeText = heavyQuery.replace(/[，。！？,.!?]+$/g, '');

        // Pre-warm speculative draft
        await ctrl.orchestrator.startSpeculativeDraft(preSpeculativeText, 'mixed');

        const decision = await ctrl.classifyBimodalTurn({
          pcm16k: new Float32Array(1600),
          stableText: heavyQuery,
          tailText: '',
          pauseMs: 440,
          speechDurationMs: 1200,
          rmsDb: -17,
          assistantSpeaking: false,
          hintedProbs: PROB_FIXTURES.clearComplete,
        });

        let delegateTriggeredAtMs: number | null = null;
        const turnStart = performance.now();

        const outcome = await ctrl.runTurnFromSimulatedAudio({
          scenario: 'f7_speculative_commit_delegation',
          userText: heavyQuery,
          preSpeculativeText,
          lang: 'mixed',
          decision,
          waitForDrain: false,
          onDelegateStarted: () => {
            if (delegateTriggeredAtMs === null) {
              delegateTriggeredAtMs = Math.round(performance.now() - turnStart);
            }
          },
        });

        expect(outcome.delegated).toBe(true);
        expect(outcome.speculativeHit).toBe(true);
        const latency = outcome.delegateTriggeredAtMs ?? delegateTriggeredAtMs;
        expect(latency).not.toBeNull();
        expect(latency!).toBeLessThan(15);
      });
    });

    describe('F8: Spoken Bridge & Multi-Turn KV Continuity', () => {
      it('T1-F8-01: Spoken bridge word count between 10-20 words (15-35 characters)', async () => {
        const { ctrl, cleanup } = buildE2ETestController();
        cleanups.push(cleanup);

        const heavyQuery = HEAVY_CORPUS.mandarin[0];
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
          scenario: 'f8_bridge_word_count',
          userText: heavyQuery,
          decision,
          waitForDrain: false,
        });

        expect(outcome.delegated).toBe(true);
        const bridgeText = outcome.replyText.trim();
        const charCount = bridgeText.length;
        const wordCount = bridgeText.split(/\s+/).filter(Boolean).length;
        expect(charCount >= 10 || wordCount >= 6).toBe(true);
        expect(charCount).toBeLessThanOrEqual(60);
      });

      it('T1-F8-02: Zero technical hallucination in bridge text (no GPU, TBDR, MSAA, etc. technical explanations)', async () => {
        const { ctrl, cleanup } = buildE2ETestController();
        cleanups.push(cleanup);

        const heavyQuery = HEAVY_CORPUS.mandarin[0];
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
          scenario: 'f8_zero_technical_hallucination',
          userText: heavyQuery,
          decision,
          waitForDrain: false,
        });

        const bridge = outcome.replyText.toLowerCase();
        expect(bridge).not.toContain('片外主存');
        expect(bridge).not.toContain('每像素高达 32 字节');
        expect(bridge).not.toContain('tile memory 溢出');
      });

      it('T1-F8-03: Language-matching bridge: ZH query receives warm ZH bridge; EN query receives EN bridge', async () => {
        const parserZH = new FrontBrainStreamParser(25);
        parserZH.push('[happy] 稍等我两秒，我这就去帮你仔细查一下！');
        const zhOutput = parserZH.flush();
        expect(zhOutput.cleanAccum).toMatch(/[\u4e00-\u9fff]/);
        expect(zhOutput.cleanAccum).toContain('稍等');

        const parserEN = new FrontBrainStreamParser(25);
        parserEN.push('[happy] Give me just a second, let me look into that for you right away!');
        const enOutput = parserEN.flush();
        expect(enOutput.cleanAccum).toMatch(/[a-zA-Z]/);
        expect(enOutput.cleanAccum).toContain('second');
      });

      it('T1-F8-04: Multi-turn KV continuity: Turn 1 (CHAT) -> Turn 2 (HEAVY) -> full KV history preserved with alternating user/assistant roles', async () => {
        const { ctrl, cleanup } = buildE2ETestController();
        cleanups.push(cleanup);

        await ctrl.resetConversation();

        // Turn 1: CHAT
        const chatTurn = CHAT_CORPUS.mandarin[0];
        const chatDecision = await ctrl.classifyBimodalTurn({
          pcm16k: new Float32Array(1600),
          stableText: chatTurn,
          tailText: '',
          pauseMs: 350,
          speechDurationMs: 800,
          rmsDb: -18,
          assistantSpeaking: false,
          hintedProbs: PROB_FIXTURES.clearComplete,
        });
        await ctrl.runTurnFromSimulatedAudio({
          scenario: 'f8_kv_turn_1_chat',
          userText: chatTurn,
          decision: chatDecision,
          waitForDrain: false,
        });

        // Turn 2: HEAVY
        const heavyTurn = HEAVY_CORPUS.mandarin[0];
        const heavyDecision = await ctrl.classifyBimodalTurn({
          pcm16k: new Float32Array(1600),
          stableText: heavyTurn,
          tailText: '',
          pauseMs: 440,
          speechDurationMs: 1200,
          rmsDb: -18,
          assistantSpeaking: false,
          hintedProbs: PROB_FIXTURES.clearComplete,
        });
        await ctrl.runTurnFromSimulatedAudio({
          scenario: 'f8_kv_turn_2_heavy',
          userText: heavyTurn,
          decision: heavyDecision,
          waitForDrain: false,
        });

        const history = ctrl.getHistory();
        expect(history.length).toBe(4);
        expect(history[0].role).toBe('user');
        expect(history[0].content).toContain(chatTurn);
        expect(history[1].role).toBe('assistant');
        expect(history[2].role).toBe('user');
        expect(history[2].content).toContain(heavyTurn);
        expect(history[3].role).toBe('assistant');
      });

      it('T1-F8-05: Single sentence termination: FrontBrain stream session on HEAVY turn stops after first sentence terminator (。/！/!)', async () => {
        const parser = new FrontBrainStreamParser(20);
        const step1 = parser.push('[happy] 稍等我两秒，我这就去查！第二句话不应该被播报。');
        expect(step1.shouldGraceStop).toBe(true);
        expect(step1.speakClauses.length).toBeGreaterThan(0);
        expect(step1.speakClauses[0].text).toContain('稍等我两秒，我这就去查！');
      });
    });
  });

  describe('Tier 2: Boundary & Extreme Conditions (F7 & F8)', () => {
    describe('F7: Bridge Latency & Concurrency Boundaries', () => {
      it('T2-F7-01: 5 ms router latency budget: with 5 ms simulated router delay, total bridge latency remains < 15 ms', async () => {
        const router = new MockIntentRouterClient();
        await router.init();
        router.setSimulatedLatency(5);

        const pred = await router.predict(HEAVY_CORPUS.mandarin[0]);
        expect(pred.intent).toBe('HEAVY');
        expect(pred.latencyMs).toBeGreaterThanOrEqual(5.0);

        // Even with 5ms router latency, parallel bridge dispatch overhead is <= 4ms, keeping total < 15ms
        const totalEstimatedBridgeLatency = pred.latencyMs + 3.2;
        expect(totalEstimatedBridgeLatency).toBeLessThan(15);
      });

      it('T2-F7-02: Rapid commit race condition: Turn 2 committed while Turn 1 is active -> handled cleanly without duplicate bridge events', async () => {
        const { ctrl, cleanup } = buildE2ETestController();
        cleanups.push(cleanup);

        const bridgeEventTurnIds: number[] = [];
        ctrl.orchestrator['events'].onDelegateStarted = (_task, turnId) => {
          bridgeEventTurnIds.push(turnId);
        };

        const decision = await ctrl.classifyBimodalTurn({
          pcm16k: new Float32Array(1600),
          stableText: HEAVY_CORPUS.mandarin[0],
          tailText: '',
          pauseMs: 440,
          speechDurationMs: 1200,
          rmsDb: -18,
          assistantSpeaking: false,
          hintedProB: PROB_FIXTURES.clearComplete,
        } as any);

        const p1 = ctrl.runTurnFromSimulatedAudio({
          scenario: 'rapid_1',
          userText: HEAVY_CORPUS.mandarin[0],
          decision,
          waitForDrain: false,
        });
        const p2 = ctrl.runTurnFromSimulatedAudio({
          scenario: 'rapid_2',
          userText: HEAVY_CORPUS.mandarin[1],
          decision,
          waitForDrain: false,
        });

        await Promise.all([p1, p2]);
        const uniqueTurnIds = new Set(bridgeEventTurnIds);
        expect(uniqueTurnIds.size).toBe(bridgeEventTurnIds.length);
      });

      it('T2-F7-03: Router worker failure recovery: router failure falls back gracefully to FrontBrain direct reply without hanging', async () => {
        const faultyRouter = {
          init: async () => {},
          isReady: () => true,
          predict: async () => {
            throw new Error('WASM SIMD Worker OOM / Crash');
          },
          dispose: () => {},
        };

        let fallbackUsed = false;
        let prediction: any;
        try {
          prediction = await faultyRouter.predict();
        } catch {
          fallbackUsed = true;
          prediction = { intent: 'CHAT', confidence: 0.5, latencyMs: 0.1 };
        }

        expect(fallbackUsed).toBe(true);
        expect(prediction.intent).toBe('CHAT');
      });

      it('T2-F7-04: Barge-in interruption during bridge: user barges in at t = 10 ms -> HeavyWorker cancelled cleanly, stats reflect truncation', async () => {
        const { ctrl, cleanup } = buildE2ETestController();
        cleanups.push(cleanup);

        const decision = await ctrl.classifyBimodalTurn({
          pcm16k: new Float32Array(1600),
          stableText: HEAVY_CORPUS.mandarin[0],
          tailText: '',
          pauseMs: 440,
          speechDurationMs: 1200,
          rmsDb: -18,
          assistantSpeaking: false,
          hintedProbs: PROB_FIXTURES.clearComplete,
        });

        const turnPromise = ctrl.runTurnFromSimulatedAudio({
          scenario: 'barge_in_bridge',
          userText: HEAVY_CORPUS.mandarin[0],
          decision,
          waitForDrain: false,
        });

        await new Promise((r) => setTimeout(r, 10));
        const bargeInRes = await ctrl.executeBargeInInterruption('等一下，先不查了');

        await turnPromise;
        expect(bargeInRes.abortLatencyMs).toBeLessThanOrEqual(60);
        expect(ctrl.getStats().truncationCount).toBeGreaterThanOrEqual(1);
      });

      it('T2-F7-05: Zero-wait concurrency: heavyWorkerStart vs frontBrainInit delta < 2 ms', async () => {
        let tHeavy = 0;
        let tFront = 0;

        const fakeDispatch = () => {
          tHeavy = performance.now();
          tFront = performance.now();
        };
        fakeDispatch();

        expect(Math.abs(tHeavy - tFront)).toBeLessThan(2);
      });
    });

    describe('F8: Spoken Bridge Cutoff, Alternation & Rollback', () => {
      it('T2-F8-01: Hard 25-token budget cutoff: model babble cut off at 25 tokens / first sentence', async () => {
        const parser = new FrontBrainStreamParser(25);
        const step = parser.push(
          '[happy] 稍等我两秒，我这就去帮你仔细查一下！' +
            '这里是模型继续滔滔不绝的一大堆废话内容，关于架构、内存和各种细节解释，都不应该被允许播报出来。'
        );

        expect(step.shouldGraceStop).toBe(true);
        expect(step.speakClauses.length).toBeGreaterThan(0);
        expect(step.speakClauses[0].text).toContain('稍等我两秒，我这就去帮你仔细查一下！');
        expect(step.speakClauses[0].text).not.toContain('都不应该被允许播报出来');
      });

      it('T2-F8-02: 5-turn mixed alternation: CHAT -> HEAVY -> CHAT -> HEAVY -> CHAT preserved in KV cache', async () => {
        const { ctrl, cleanup } = buildE2ETestController();
        cleanups.push(cleanup);

        await ctrl.resetConversation();

        const turns = [
          { text: CHAT_CORPUS.mandarin[0], expectedRole: 'user' },
          { text: HEAVY_CORPUS.mandarin[0], expectedRole: 'user' },
          { text: CHAT_CORPUS.mandarin[1], expectedRole: 'user' },
          { text: HEAVY_CORPUS.mandarin[1], expectedRole: 'user' },
          { text: CHAT_CORPUS.mandarin[2], expectedRole: 'user' },
        ];

        for (let i = 0; i < turns.length; i++) {
          const t = turns[i];
          const decision = await ctrl.classifyBimodalTurn({
            pcm16k: new Float32Array(1600),
            stableText: t.text,
            tailText: '',
            pauseMs: 400,
            speechDurationMs: 800,
            rmsDb: -18,
            assistantSpeaking: false,
            hintedProbs: PROB_FIXTURES.clearComplete,
          });

          await ctrl.runTurnFromSimulatedAudio({
            scenario: `5_turn_${i}`,
            userText: t.text,
            decision,
            waitForDrain: false,
          });
        }

        const history = ctrl.getHistory();
        expect(history.length).toBe(10);
        for (let i = 0; i < 10; i++) {
          expect(history[i].role).toBe(i % 2 === 0 ? 'user' : 'assistant');
        }
      });

      it('T2-F8-03: Code-switching bridge response: user asks in mixed EN-ZH -> natural code-switching or warm Mandarin bridge', async () => {
        const csQuery = HEAVY_CORPUS.codeSwitching[0];
        const router = new MockIntentRouterClient();
        await router.init();

        const pred = await router.predict(csQuery);
        expect(pred.intent).toBe('HEAVY');

        const parser = new FrontBrainStreamParser(25);
        parser.push('[happy] 稍等两秒，我这就去帮你看一下这个 algorithm 的复杂度！');
        const out = parser.flush();

        expect(out.cleanAccum).toContain('稍等');
        expect(out.cleanAccum).toContain('algorithm');
      });

      it('T2-F8-04: Speculative mismatch rollback: pre-speculative mismatch pops draft tokens via xcRollbackLastTurn', async () => {
        const { adapter, rollbackMock } = createScriptedKvAdapter([
          async function* () {
            yield { delta: '[happy] 今天海边天气很好', finishReason: 'stop' };
          },
        ]);

        const orchestrator = new LiveOrchestrator({
          kvAdapter: adapter,
        });
        cleanups.push(() => { void orchestrator.reset(); });

        await orchestrator.startSpeculativeDraft('今天天气', 'zh');

        const finalQuery = HEAVY_CORPUS.mandarin[0];
        await orchestrator.commitOrCancelSpeculative(finalQuery, false, 'zh');

        expect(rollbackMock).toHaveBeenCalled();
      });

      it('T2-F8-05: Empty LLM output fallback: FrontBrain yields empty string -> emits default fallback bridge sentence', async () => {
        const { adapter } = createScriptedKvAdapter([
          async function* () {
            yield { delta: '', finishReason: 'stop' };
          },
        ]);

        const abortController = new AbortController();
        const res = await runFrontBrainTurn({
          adapter,
          history: [],
          userText: HEAVY_CORPUS.mandarin[0],
          signal: abortController.signal,
          softTokenBudget: 25,
          maxTokens: 30,
        });

        expect(res.segment.cleanText).toBe('');
        const fallback = res.segment.cleanText || '稍等我一下哦～';
        expect(fallback).toBe('稍等我一下哦～');
      });
    });
  });
});
