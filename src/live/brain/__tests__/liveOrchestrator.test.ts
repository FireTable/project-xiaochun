import { describe, expect, it, vi } from 'vitest';
import {
  Conversation,
  compareConversationObject,
  EMPTY_THINKING_BLOCK,
  Role,
  type ConvTemplateConfig,
} from '@mlc-ai/web-llm';
import {
  buildBridgeOnlyUserCue,
  estimateBilingualTokens,
  FRONT_BRAIN_PROMPT_MAX_TOKENS,
  FrontBrainStreamParser,
  SOPHON_LIVE_FRONT_BRAIN_PROMPT,
} from '../frontBrain';
import { HeavyWorker } from '../heavyWorker';
import { LiveOrchestrator } from '../liveOrchestrator';
import type {
  BrainGenerateRequest,
  BrainKVRuntimeAdapter,
  BrainMemoryAdapter,
  BrainStreamChunk,
  LiveSpeakChunk,
  LiveTurnEvents,
} from '../types';

const CHATML_TEMPLATE: ConvTemplateConfig = {
  system_template: '<|im_start|>system\n{system_message}<|im_end|>\n',
  system_message: SOPHON_LIVE_FRONT_BRAIN_PROMPT,
  roles: {
    [Role.user]: '<|im_start|>user',
    [Role.assistant]: '<|im_start|>assistant',
    [Role.tool]: '<|im_start|>tool',
  },
  role_content_sep: '\n',
  role_empty_sep: '\n',
  seps: ['<|im_end|>\n'],
  stop_str: ['<|im_end|>'],
  stop_token_ids: [2],
};

function makeFakeKVAdapter(
  scriptedTurns: Array<
    (req: BrainGenerateRequest) => AsyncGenerator<BrainStreamChunk, void, void>
  >,
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

function makeMemoryAdapter(): {
  adapter: BrainMemoryAdapter;
  recallSpy: ReturnType<typeof vi.fn>;
  rememberSpy: ReturnType<typeof vi.fn>;
} {
  const recallSpy = vi.fn(async () => ({
    profileText: 'Nickname: 船长 | Facts: GPU=M1 Ultra',
    recalledSummary: 'Earlier discussed Three.js beach lighting and WebGPU budget.',
    episodeLines: ['Investigated RGBA16F render target bandwidth on TBDR GPUs.'],
    lorebookLines: ['TBDR Bloom: half-res separable blur avoids tile-memory spills.'],
  }));
  const rememberSpy = vi.fn(async () => {});
  return {
    adapter: { recall: recallSpy, remember: rememberSpy },
    recallSpy,
    rememberSpy,
  };
}

describe('LiveOrchestrator & Sophon Layer-2 Brain', () => {
  it('(a) executes micro-pause speculative hit without re-prefill, and rolls back cleanly on mismatch via xcRollbackLastTurn', async () => {
    // Verify Front-Brain prompt fits cleanly under 900 tokens
    expect(estimateBilingualTokens(SOPHON_LIVE_FRONT_BRAIN_PROMPT)).toBeLessThanOrEqual(
      FRONT_BRAIN_PROMPT_MAX_TOKENS,
    );

    const { adapter, requests, rollbackMock, interruptMock } = makeFakeKVAdapter([
      // Speculative draft #1 -> will HIT
      async function* () {
        yield { delta: '[happy] 今天海风微凉，', finishReason: null };
        await new Promise((r) => setTimeout(r, 8));
        yield { delta: '超适合出来走走！', finishReason: 'stop' };
      },
      // Speculative draft #2 -> will MISMATCH
      async function* (req) {
        yield { delta: '[relaxed] 嗯，关于这个', finishReason: null };
        await new Promise((r) => setTimeout(r, 40));
        if (!req.signal?.aborted) {
          yield { delta: '旧话题', finishReason: 'stop' };
        }
      },
      // Clean recovery turn after mismatch rollback
      async function* () {
        yield { delta: '[surprised] 哇，WebGPU Bloom 可以优化到半分辨率哦！', finishReason: 'stop' };
      },
    ]);

    const spoken: LiveSpeakChunk[] = [];
    const specStarts: number[] = [];
    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      events: {
        onSpeculativeStart: (id) => specStarts.push(id),
        onSpeakChunk: (chunk) => spoken.push(chunk),
      },
    });

    // 1. Speculative Hit path (punctuation-normalized match)
    const specId = await orch.startSpeculativeDraft('今天海边风大吗', 'zh');
    expect(specId).toBe(1);
    await new Promise((r) => setTimeout(r, 15));
    const hitMetrics = await orch.commitOrCancelSpeculative('今天海边风大吗？', true);

    expect(hitMetrics).not.toBeNull();
    expect(hitMetrics!.wasSpeculativeHit).toBe(true);
    expect(hitMetrics!.speculativeMsSaved).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].thinking).toBe(false);
    expect(requests[0].maxTokens).toBe(160);
    expect(rollbackMock).not.toHaveBeenCalled();
    expect(spoken.map((s) => s.text).join('')).toBe('今天海风微凉，超适合出来走走！');
    expect(spoken[0].emotion).toBe('happy');

    // 2. Speculative Mismatch -> MUST interrupt & call xcRollbackLastTurn, then re-run clean turn
    await orch.startSpeculativeDraft('那明天天气', 'zh');
    await new Promise((r) => setTimeout(r, 8));
    const missMetrics = await orch.commitOrCancelSpeculative(
      '我想问一下 WebGPU Bloom 的耗电情况',
      true,
    );

    expect(missMetrics).not.toBeNull();
    expect(missMetrics!.wasSpeculativeHit).toBe(false);
    expect(interruptMock).toHaveBeenCalled();
    expect(rollbackMock).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(3);
    expect(requests[2].messages.at(-1)?.content).toBe(
      '我想问一下 WebGPU Bloom 的耗电情况',
    );
    const stats = orch.getStats();
    expect(stats.rollbackCount).toBe(1);
    expect(stats.speculativeHitCount).toBe(1);
    expect(stats.speculativeMissCount).toBe(1);
  });

  it('(b) preserves active generation on backchannel ack and performs O(1) xcTruncateReplyToHeard on barge-in with [interrupted] history', async () => {
    const { adapter, requests, truncateMock, interruptMock } = makeFakeKVAdapter([
      async function* (req) {
        yield { delta: '[happy] 好的我马上', finishReason: null };
        yield { delta: '帮你展开讲讲细节，', finishReason: null };
        await new Promise((r) => setTimeout(r, 60));
        if (!req.signal?.aborted) {
          yield { delta: '其实还有第三点没说完呢。', finishReason: 'stop' };
        }
      },
      async function* () {
        yield { delta: '[neutral] 好呀，我们直接聊新问题！', finishReason: 'stop' };
      },
    ]);

    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
    });

    // Start streaming Turn 1 without awaiting full completion yet
    const turnPromise = orch.handleUserTurn('详细跟我说说这个架构', 'zh');
    await new Promise((r) => setTimeout(r, 10));

    // Backchannel "嗯嗯" during active speech MUST NOT interrupt or truncate
    const bc = orch.handleBackchannelAck('嗯嗯');
    expect(bc.logged).toBe(true);
    expect(bc.wasActiveGenerationPreserved).toBe(true);
    expect(interruptMock).not.toHaveBeenCalled();
    expect(truncateMock).not.toHaveBeenCalled();

    // Real barge-in interrupt while assistant output has partially played
    const bargeResult = await orch.handleBargeIn('好的我马上帮你展开讲讲');
    expect(interruptMock).toHaveBeenCalled();
    expect(truncateMock).toHaveBeenCalledWith('好的我马上帮你展开讲讲');
    expect(bargeResult.truncated).toBe(true);
    expect(bargeResult.interruptedText).toBe('好的我马上帮你展开讲讲 [interrupted]');
    await turnPromise;

    const historyAfterBarge = orch.getHistory();
    expect(historyAfterBarge.at(-1)).toEqual({
      role: 'assistant',
      content: '好的我马上帮你展开讲讲 [interrupted]',
    });

    // Continue Turn 2 cleanly right after barge-in
    await orch.handleUserTurn('先别展开，直接说重点', 'zh');
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toEqual([
      { role: 'system', content: SOPHON_LIVE_FRONT_BRAIN_PROMPT },
      { role: 'user', content: '详细跟我说说这个架构' },
      { role: 'assistant', content: '好的我马上帮你展开讲讲 [interrupted]' },
      { role: 'user', content: '先别展开，直接说重点' },
    ]);
    expect(orch.getStats().backchannelCount).toBe(1);
    expect(orch.getStats().truncationCount).toBe(1);
  });

  it('(c) parses token-split tags & <delegate/>, streams Heavyworker commentary with client-memory recall, and supports mid-flight amend()', async () => {
    // 1. Validate incremental tag/delegate parser under 3-char splits
    const parser = new FrontBrainStreamParser(90);
    const rawSample =
      '<think>\n\n</think>\n\n[sh' +
      'y] Wait a sec, I am checking it now! <dele' +
      'gate task="analyze iOS TBDR RGBA16F bloom drops" urgency="deep"/>';
    let lastClean = '';
    const delegates: string[] = [];
    for (let i = 0; i < rawSample.length; i += 3) {
      const step = parser.push(rawSample.slice(i, i + 3));
      lastClean = step.cleanAccum;
      for (const d of step.newDelegates) delegates.push(d.task);
    }
    parser.flush();
    expect(parser.getCleanText()).toBe('Wait a sec, I am checking it now!');
    expect(lastClean).toBe('Wait a sec, I am checking it now!');
    expect(parser.getEmotion()).toBe('shy');
    expect(delegates).toEqual(['analyze iOS TBDR RGBA16F bloom drops']);

    // 2. End-to-end Orchestrator delegation + mid-flight amend()
    const { adapter } = makeFakeKVAdapter([
      async function* () {
        yield { delta: '[happy] 稍等我两秒，', finishReason: null };
        yield {
          delta:
            '我去翻一下渲染管线！<delegate task="analyze iOS TBDR WebGPU bloom drops" urgency="deep"/>',
          finishReason: 'stop',
        };
      },
    ]);

    const openAICalls: Array<{ url: string; body: any }> = [];
    let attempt = 0;
    const openAITransport = async function* (
      url: string,
      _headers: Record<string, string>,
      body: Record<string, unknown>,
      signal: AbortSignal,
    ): AsyncGenerator<BrainStreamChunk, void, void> {
      attempt += 1;
      openAICalls.push({ url, body });
      if (attempt === 1) {
        yield { delta: '<think>checking msaa tile memory</think>', finishReason: null };
        yield { delta: '[relaxed] 先看基础带宽：RGBA16F 加 4x MSAA 很吃片上内存。', finishReason: null };
        await new Promise((r) => setTimeout(r, 80));
        if (!signal.aborted) {
          yield { delta: '未修正分支。', finishReason: 'stop' };
        }
      } else {
        yield {
          delta: '[surprised] 收到你补充的 bloom 条件啦！开启 full-res bloom 会额外多三次 tile store/load。',
          finishReason: 'stop',
        };
      }
    };

    const { adapter: memAdapter, recallSpy } = makeMemoryAdapter();
    const speakEvents: LiveSpeakChunk[] = [];
    const delegateEvents: string[] = [];
    const heavyDeltas: string[] = [];

    const events: LiveTurnEvents = {
      onSpeakChunk: (c) => speakEvents.push(c),
      onDelegateStarted: (task) => delegateEvents.push(task),
      onHeavyDelta: (_d, accum) => heavyDeltas.push(accum),
    };

    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: memAdapter,
      openAITransport,
      heavyConfig: {
        mode: 'custom-openai',
        apiBaseUrl: 'https://api.example.com',
        apiKey: 'sk-test-redacted',
        model: 'gpt-4o-mini',
      },
      events,
    });

    const metrics = await orch.handleUserTurn(
      '帮我查一下 why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA',
      'mixed',
    );
    expect(metrics?.delegated).toBe(true);
    expect(delegateEvents).toEqual(['analyze iOS TBDR WebGPU bloom drops']);
    expect(speakEvents.some((c) => c.source === 'front' && c.text.includes('我去翻一下渲染管线'))).toBe(true);

    // Give Heavyworker attempt #1 a moment to recall memory and emit its first clause, then amend mid-flight!
    await new Promise((r) => setTimeout(r, 25));
    const amended = orch.amendActiveHeavyTask('尤其是开启 bloom 的时候');
    expect(amended).toBe(true);

    const finalHeavy = await orch.waitForActiveHeavyTask();
    expect(recallSpy).toHaveBeenCalledTimes(1);
    expect(attempt).toBe(2);
    expect(openAICalls[0].url).toBe('https://api.example.com/v1/chat/completions');
    // Memory snapshot + amendment reached Heavyworker messages
    const secondPromptMsgs = JSON.stringify(openAICalls[1].body.messages);
    expect(secondPromptMsgs).toContain('GPU=M1 Ultra');
    expect(secondPromptMsgs).toContain('尤其是开启 bloom 的时候');
    expect(finalHeavy).toContain('full-res bloom');
    expect(speakEvents.some((c) => c.source === 'heavy' && c.text.includes('full-res bloom'))).toBe(true);
    expect(heavyDeltas.length).toBeGreaterThan(0);
  });

  it('(d) triggers 3000/4096 watermark compaction ONLY when system state is idle', async () => {
    const compactedEvents: Array<{ summary: string; before: number; after: number }> = [];
    const { adapter, resetMock } = makeFakeKVAdapter([
      async function* (req) {
        // While running, simulate attempt to trigger compaction right inside stream (must NOT compact!)
        yield { delta: '[happy] 记下啦！', finishReason: 'stop' };
        expect(req.thinking).toBe(false);
      },
    ]);

    const summarizer = vi.fn(async (msgs) => `Summary of ${msgs.length} older messages`);
    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      compactionWatermarkTokens: 3000,
      compactionSummarizer: summarizer,
      events: {
        onCompacted: (summary, stats) =>
          compactedEvents.push({
            summary,
            before: stats.beforeTokens,
            after: stats.afterTokens,
          }),
      },
    });

    // Seed 12 long turns exceeding 3000 estimated tokens inside 4096 window
    const longFiller = '今天海边阳光和微风真的太棒了，我们讨论了 WebGPU 优化与缓存策略。'.repeat(12);
    const seed = [];
    for (let i = 0; i < 6; i++) {
      seed.push({ role: 'user' as const, content: `Turn ${i}: ${longFiller}` });
      seed.push({ role: 'assistant' as const, content: `Reply ${i}: ${longFiller}` });
    }
    orch.seedHistory(seed);
    expect(orch.getStats().estimatedKvTokens).toBeGreaterThanOrEqual(3000);

    // While non-idle (`speculating`), compaction MUST defer / refuse to run
    await orch.startSpeculativeDraft('先聊聊下一个问题', 'zh');
    const busyRan = await orch.runIdleCompactionIfNeeded();
    expect(busyRan).toBe(false);
    expect(summarizer).not.toHaveBeenCalled();

    // Commit turn -> transitions to `idle`, scheduling background idle compaction
    await orch.commitOrCancelSpeculative('我想继续问一下', true);
    await new Promise((r) => setTimeout(r, 20));

    expect(summarizer).toHaveBeenCalledTimes(1);
    expect(compactedEvents).toHaveLength(1);
    expect(compactedEvents[0].before).toBeGreaterThanOrEqual(3000);
    expect(compactedEvents[0].after).toBeLessThan(3000);
    expect(orch.getStats().compactionCount).toBe(1);
    expect(orch.getStats().estimatedKvTokens).toBeLessThan(3000);
    expect(resetMock).toHaveBeenCalled();
  });

  it('(e) maintains Turn-1 -> Turn-2 -> Barge-in Turn-3 KV parity with WebLLM Conversation under enable_thinking: false', async () => {
    // Regression check uniting WebLLM oldConv finishReply + LiveOrchestrator stripped history
    const { adapter } = makeFakeKVAdapter([
      async function* () {
        yield { delta: `${EMPTY_THINKING_BLOCK}[happy] 晚上好，今天海风很轻呢～`, finishReason: 'stop' };
      },
      async function* () {
        yield { delta: `${EMPTY_THINKING_BLOCK}[relaxed] 当然记得啦，`, finishReason: null };
        yield { delta: '你刚才问过海风的事。', finishReason: 'stop' };
      },
      async function* () {
        yield { delta: `${EMPTY_THINKING_BLOCK}[happy] 收到，直接聊下一条！`, finishReason: 'stop' };
      },
    ]);

    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
    });

    // Simulate WebLLM worker's internal `oldConv` synchronized with Turn 1
    const oldConv = new Conversation(CHATML_TEMPLATE);
    await orch.handleUserTurn('晚上好', 'zh');
    oldConv.appendMessage(Role.user, '晚上好');
    oldConv.appendEmptyThinkingReplyHeader(Role.assistant, EMPTY_THINKING_BLOCK);
    oldConv.finishReply(`${EMPTY_THINKING_BLOCK}晚上好，今天海风很轻呢～`);

    const newConvTurn2 = new Conversation(CHATML_TEMPLATE);
    for (const msg of orch.getHistory()) {
      newConvTurn2.appendMessage(
        msg.role === 'user' ? Role.user : Role.assistant,
        msg.content,
      );
    }
    expect(compareConversationObject(oldConv, newConvTurn2)).toBe(true);

    // Turn 2 followed by barge-in -> Turn 3 also maintains byte-exact parity!
    await orch.handleUserTurn('你还记得我刚刚问啥吗', 'zh');
    await orch.handleBargeIn('当然记得啦');
    oldConv.appendMessage(Role.user, '你还记得我刚刚问啥吗');
    oldConv.appendEmptyThinkingReplyHeader(Role.assistant, EMPTY_THINKING_BLOCK);
    oldConv.finishReply(`${EMPTY_THINKING_BLOCK}当然记得啦，你刚才问过海风的事。`);
    oldConv.setLastAssistantReplyText('当然记得啦 [interrupted]');

    const newConvTurn3 = new Conversation(CHATML_TEMPLATE);
    for (const msg of orch.getHistory()) {
      newConvTurn3.appendMessage(
        msg.role === 'user' ? Role.user : Role.assistant,
        msg.content,
      );
    }
    expect(compareConversationObject(oldConv, newConvTurn3)).toBe(true);
  });

  it('enforces Front-Brain 90-token soft budget with punctuation grace stop', async () => {
    const { adapter, interruptMock } = makeFakeKVAdapter([
      async function* (req) {
        // Long stream exceeding 90 tokens — stops gracefully right after first terminator beyond 90
        yield { delta: 'First short warm reply sentence without issues. ', finishReason: null };
        yield {
          delta: 'Second fairly long explanatory sentence filled with coastal breeze and WebGPU latency telemetry details '.repeat(
            4,
          ),
          finishReason: null,
        };
        yield { delta: 'Done right here.', finishReason: null };
        if (!req.signal?.aborted) {
          yield { delta: ' Extra sentence that must be trimmed by grace stop.', finishReason: 'stop' };
        }
      },
    ]);

    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      softTokenBudget: 90,
      maxFrontTokens: 160,
    });

    const completedReplies: string[] = [];
    orch.setEvents({
      onTurnComplete: (_id, reply) => completedReplies.push(reply),
    });

    await orch.handleUserTurn('Tell me a long story', 'en');
    expect(interruptMock).toHaveBeenCalled();
    expect(completedReplies[0]).toContain('Done right here.');
    expect(completedReplies[0]).not.toContain('Extra sentence');
  });

  it('supports compact zero-attribute <delegate/> shorthand and falls back to user utterance', async () => {
    const parser = new FrontBrainStreamParser(128);
    parser.push('[happy]<delegate/> 稍等我两秒！');
    parser.flush();
    const seg = parser.toSegment();
    expect(seg.isDelegate).toBe(true);
    expect(seg.delegateUrgency).toBe('deep');
    expect(seg.cleanText).toBe('稍等我两秒！');

    const { adapter } = makeFakeKVAdapter([
      async function* (req) {
        expect(req.thinking).toBe(false);
        yield { delta: '[happy]<delegate/> 稍等我两秒！', finishReason: 'stop' };
      },
      async function* (req) {
        expect(req.thinking).toBe(true);
        yield { delta: '<think>brief check</think>[relaxed] 核心瓶颈是 TBDR tile 内存。', finishReason: 'stop' };
      },
    ]);

    const delegateEvents: string[] = [];
    const speakEvents: LiveSpeakChunk[] = [];
    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      heavyConfig: { mode: 'local-thinking' },
      events: {
        onDelegateStarted: (task) => delegateEvents.push(task),
        onSpeakChunk: (chunk) => speakEvents.push(chunk),
      },
    });

    const userPrompt = 'Analyze WebGPU TBDR RGBA16F tile bandwidth';
    const metrics = await orch.handleUserTurn(userPrompt, 'mixed');
    const heavyResult = await orch.waitForActiveHeavyTask();

    expect(metrics?.delegated).toBe(true);
    expect(delegateEvents).toEqual([userPrompt]);
    expect(heavyResult).toContain('核心瓶颈是 TBDR tile 内存');
    expect(speakEvents.some((c) => c.source === 'heavy' && c.text.includes('TBDR'))).toBe(true);
  });

  it('evaluates external IntentRouter to trigger zero-latency bridge delegation (< 15ms) and constrains FrontBrain bridge', async () => {
    const { adapter, requests } = makeFakeKVAdapter([
      async function* () {
        yield { delta: '[happy] 稍等我两秒，我这就去仔细算一下管线！', finishReason: 'stop' };
      },
      async function* () {
        yield { delta: '<think>calculating tile bandwidth</think>[relaxed] RGBA16F 4x MSAA 在 TBDR 架构下需要特别关注 tile store。', finishReason: 'stop' };
      },
    ]);

    const delegateEvents: Array<{ task: string; turnId: number; latencyMs: number }> = [];
    let t0 = 0;
    const router = {
      init: vi.fn(async () => {}),
      predict: vi.fn(async (text: string) => ({
        intent: (/tbdr|heavy|analyze|算法|代码/i.test(text) ? 'HEAVY' : 'CHAT') as 'CHAT' | 'HEAVY',
        confidence: 0.95,
        probabilities: { CHAT: 0.05, HEAVY: 0.95 },
        scores: { CHAT: 0.05, HEAVY: 0.95 },
        latencyMs: 1.8,
        source: 'guardrail' as const,
      })),
      classify: vi.fn(async (text: string) => ({
        intent: (/tbdr|heavy|analyze|算法|代码/i.test(text) ? 'HEAVY' : 'CHAT') as 'CHAT' | 'HEAVY',
        confidence: 0.95,
        probabilities: { CHAT: 0.05, HEAVY: 0.95 },
        scores: { CHAT: 0.05, HEAVY: 0.95 },
        latencyMs: 1.8,
        source: 'guardrail' as const,
      })),
      warmup: vi.fn(async () => 1.8),
      isReady: () => true,
      dispose: vi.fn(),
    };

    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      heavyConfig: { mode: 'local-thinking' },
      intentRouter: router,
      events: {
        onDelegateStarted: (task, turnId) => {
          delegateEvents.push({ task, turnId, latencyMs: performance.now() - t0 });
        },
      },
    });

    const heavyQuery = '深度分析一下 iOS TBDR WebGPU 掉帧原因';
    t0 = performance.now();
    const metrics = await orch.handleUserTurn(heavyQuery, 'zh');

    expect(metrics?.delegated).toBe(true);
    expect(delegateEvents).toHaveLength(1);
    expect(delegateEvents[0].task).toBe(heavyQuery);
    expect(delegateEvents[0].latencyMs).toBeLessThan(15);
    expect(router.predict).toHaveBeenCalledWith(heavyQuery);

    // FrontBrain request was constrained to bridge token budget
    expect(requests[0].maxTokens).toBeLessThanOrEqual(30);

    const heavyResult = await orch.waitForActiveHeavyTask();
    expect(heavyResult).toContain('TBDR');

    // KV Cache continuity: FrontBrain spoken bridge recorded in history
    const history = orch.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: 'user', content: heavyQuery });
    expect(history[1].role).toBe('assistant');
    expect(history[1].content).toContain('稍等我两秒');
  });

  it('speculative hit evaluates IntentRouter and launches HeavyWorker immediately on HEAVY commit', async () => {
    const { adapter } = makeFakeKVAdapter([
      async function* () {
        yield { delta: '[happy] 好的稍等我一下～', finishReason: 'stop' };
      },
    ]);

    let delegateFired = false;
    const router = {
      init: vi.fn(async () => {}),
      predict: vi.fn(async (text: string) => ({
        intent: (/tbdr|heavy|analyze|算法|代码|内存/i.test(text) ? 'HEAVY' : 'CHAT') as 'CHAT' | 'HEAVY',
        confidence: 0.95,
        probabilities: { CHAT: 0.05, HEAVY: 0.95 },
        scores: { CHAT: 0.05, HEAVY: 0.95 },
        latencyMs: 1.5,
        source: 'guardrail' as const,
      })),
      classify: vi.fn(async (_text: string) => ({
        intent: 'HEAVY' as const,
        confidence: 0.95,
        probabilities: { CHAT: 0.05, HEAVY: 0.95 },
        scores: { CHAT: 0.05, HEAVY: 0.95 },
        latencyMs: 1.5,
        source: 'guardrail' as const,
      })),
      warmup: vi.fn(async () => 1.5),
      isReady: () => true,
      dispose: vi.fn(),
    };

    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      intentRouter: router,
      events: {
        onDelegateStarted: () => {
          delegateFired = true;
        },
      },
    });

    await orch.startSpeculativeDraft('帮我查一下 WebGPU 内存泄露', 'zh');
    const hitMetrics = await orch.commitOrCancelSpeculative('帮我查一下 WebGPU 内存泄露？', true, 'zh');

    expect(hitMetrics?.wasSpeculativeHit).toBe(true);
    expect(hitMetrics?.delegated).toBe(true);
    expect(delegateFired).toBe(true);
  });

  it('synchronous amendment inside onDelegateStarted succeeds (amendActiveHeavyTask returns true)', async () => {
    const { adapter } = makeFakeKVAdapter([
      async function* () {
        yield { delta: '[relaxed] 好的，后台开始分析。', finishReason: 'stop' };
      },
    ]);

    const router = {
      init: vi.fn(async () => {}),
      predict: vi.fn(async () => ({
        intent: 'HEAVY' as const,
        confidence: 0.98,
        probabilities: { CHAT: 0.02, HEAVY: 0.98 },
        scores: { CHAT: 0.02, HEAVY: 0.98 },
        latencyMs: 1.0,
        source: 'guardrail' as const,
      })),
      classify: vi.fn(async () => ({
        intent: 'HEAVY' as const,
        confidence: 0.98,
        probabilities: { CHAT: 0.02, HEAVY: 0.98 },
        scores: { CHAT: 0.02, HEAVY: 0.98 },
        latencyMs: 1.0,
        source: 'guardrail' as const,
      })),
      warmup: vi.fn(async () => 1.0),
      isReady: () => true,
      dispose: vi.fn(),
    };

    let amendSuccess = false;
    let delegateTurnId = -1;

    let orch!: LiveOrchestrator;
    orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      heavyConfig: { mode: 'local-thinking' },
      intentRouter: router,
      events: {
        onDelegateStarted: (_task, turnId) => {
          delegateTurnId = turnId;
          // Synchronous amendment inside onDelegateStarted
          amendSuccess = orch.amendActiveHeavyTask('另外注意检查移动端 TBDR 架构细节');
        },
      },
    });

    const metrics = await orch.handleUserTurn('深度分析 WebGPU 渲染管线', 'zh');
    expect(metrics?.delegated).toBe(true);
    expect(delegateTurnId).toBeGreaterThan(0);
    expect(amendSuccess).toBe(true);
  });

  it('synchronous barge-in inside onDelegateStarted aborts the turn cleanly without zombie tasks', async () => {
    let frontBrainExecuted = false;
    const { adapter, truncateMock } = makeFakeKVAdapter([
      async function* () {
        frontBrainExecuted = true;
        yield { delta: '[relaxed] 稍等我分析一下', finishReason: 'stop' };
      },
    ]);

    const router = {
      init: vi.fn(async () => {}),
      predict: vi.fn(async () => ({
        intent: 'HEAVY' as const,
        confidence: 0.98,
        probabilities: { CHAT: 0.02, HEAVY: 0.98 },
        scores: { CHAT: 0.02, HEAVY: 0.98 },
        latencyMs: 1.0,
        source: 'guardrail' as const,
      })),
      classify: vi.fn(async () => ({
        intent: 'HEAVY' as const,
        confidence: 0.98,
        probabilities: { CHAT: 0.02, HEAVY: 0.98 },
        scores: { CHAT: 0.02, HEAVY: 0.98 },
        latencyMs: 1.0,
        source: 'guardrail' as const,
      })),
      warmup: vi.fn(async () => 1.0),
      isReady: () => true,
      dispose: vi.fn(),
    };

    let delegateCalled = false;
    let bargeInResult: unknown = null;

    let orch!: LiveOrchestrator;
    orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      heavyConfig: { mode: 'local-thinking' },
      intentRouter: router,
      events: {
        onDelegateStarted: (_task, _turnId) => {
          delegateCalled = true;
          // Synchronously trigger barge-in during delegation event
          void orch.handleBargeIn('等等不用查了').then((res) => {
            bargeInResult = res;
          });
        },
      },
    });

    const metrics = await orch.handleUserTurn('深度排查 WebGPU 掉帧原因', 'zh');
    // Turn should be aborted cleanly
    expect(metrics).toBeNull();
    expect(delegateCalled).toBe(true);
    expect(frontBrainExecuted).toBe(false);

    // Give microtasks time to settle
    await new Promise((r) => setTimeout(r, 20));

    expect(bargeInResult).not.toBeNull();
    expect(truncateMock).toHaveBeenCalledWith('等等不用查了');
    expect(orch.getState()).toBe('listening');
    expect(orch.getStats().activeHeavyTaskId).toBeNull();
  });

  it('synchronous amendment in speculative draft commit succeeds', async () => {
    const { adapter } = makeFakeKVAdapter([
      async function* () {
        yield { delta: '[happy] 好的稍等我一下～', finishReason: 'stop' };
      },
    ]);

    const router = {
      init: vi.fn(async () => {}),
      predict: vi.fn(async () => ({
        intent: 'HEAVY' as const,
        confidence: 0.98,
        probabilities: { CHAT: 0.02, HEAVY: 0.98 },
        scores: { CHAT: 0.02, HEAVY: 0.98 },
        latencyMs: 1.0,
        source: 'guardrail' as const,
      })),
      classify: vi.fn(async () => ({
        intent: 'HEAVY' as const,
        confidence: 0.98,
        probabilities: { CHAT: 0.02, HEAVY: 0.98 },
        scores: { CHAT: 0.02, HEAVY: 0.98 },
        latencyMs: 1.0,
        source: 'guardrail' as const,
      })),
      warmup: vi.fn(async () => 1.0),
      isReady: () => true,
      dispose: vi.fn(),
    };

    let amendSuccess = false;
    let orch!: LiveOrchestrator;
    orch = new LiveOrchestrator({
      kvAdapter: adapter,
      intentRouter: router,
      events: {
        onDelegateStarted: () => {
          amendSuccess = orch.amendActiveHeavyTask('只针对 M4 Max 芯片');
        },
      },
    });

    await orch.startSpeculativeDraft('帮我排查一下 WebGPU 内存泄露', 'zh');
    const hitMetrics = await orch.commitOrCancelSpeculative('帮我排查一下 WebGPU 内存泄露？', true, 'zh');

    expect(hitMetrics?.wasSpeculativeHit).toBe(true);
    expect(hitMetrics?.delegated).toBe(true);
    expect(amendSuccess).toBe(true);
  });

  it('recovers automatically with thinking:false when local <think> starves or closes empty', async () => {
    const adapterCalls: Array<{ thinking?: boolean }> = [];
    let attempt = 0;

    const adapter: BrainKVRuntimeAdapter = {
      async *streamChat(request) {
        adapterCalls.push({ thinking: request.thinking });
        attempt += 1;

        if (request.messages[0]?.role === 'system' && request.messages[0].content.includes('deep background reasoning')) {
          if (attempt === 2) {
            // Simulate unclosed <think> burning >240 chars without emitting </think>
            yield {
              delta: `<think>${'Analyzing tile memory bandwidth constraints in iOS TBDR WebGPU pipelines. '.repeat(5)}`,
              finishReason: null,
            };
            await new Promise((r) => setTimeout(r, 40));
            return;
          }
          // Fallback retry (thinking: false) emits spoken commentary cleanly
          yield {
            delta: '[relaxed] RGBA16F 配 4x MSAA 很容易超出 iOS TBDR 的 Tile Cache 上限，导致反复写回片外主存！',
            finishReason: 'stop',
          };
          return;
        }

        // Front-Brain turn #1
        yield { delta: '[happy] 稍等一下哦，我这就去帮你查！', finishReason: 'stop' };
      },
      interruptGenerate: vi.fn(),
      xcRollbackLastTurn: vi.fn(async () => ({ popped: 0, remaining: 0 })),
      xcTruncateReplyToHeard: vi.fn(async () => ({ truncated: false, poppedTokens: 0, remainingTokens: 0 })),
      resetChat: vi.fn(async () => {}),
    };

    const router = {
      init: vi.fn(async () => {}),
      predict: vi.fn(async () => ({
        intent: 'HEAVY' as const,
        confidence: 0.99,
        probabilities: { CHAT: 0.01, HEAVY: 0.99 },
        scores: { CHAT: 0.01, HEAVY: 0.99 },
        latencyMs: 0.8,
        source: 'guardrail' as const,
      })),
      classify: vi.fn(),
      warmup: vi.fn(async () => 1.0),
      isReady: () => true,
      dispose: vi.fn(),
    };

    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      heavyConfig: { mode: 'local-thinking' },
      intentRouter: router,
    });

    const query = '深入分析 iOS TBDR WebGPU RGBA16F 4x MSAA 掉帧问题';
    await orch.handleUserTurn(query, 'zh');
    const heavyText = await orch.waitForActiveHeavyTask();

    expect(heavyText).toContain('Tile Cache');
    // Call 0: FrontBrain (thinking: false), Call 1: Heavy attempt #1 (thinking: true), Call 2: Heavy fallback retry (thinking: false)
    expect(adapterCalls.length).toBeGreaterThanOrEqual(3);
    expect(adapterCalls[1].thinking).toBe(true);
    expect(adapterCalls[2].thinking).toBe(false);
    // History stayed clean without transient bridge prompt hint
    expect(orch.getHistory()[0].content).toBe(query);
  });

  it('retries local HeavyWorker directly with thinking:false if <think> closes stream with zero clean chars', async () => {
    const adapterCalls: Array<{ thinking?: boolean }> = [];
    const adapter: BrainKVRuntimeAdapter = {
      async *streamChat(request) {
        adapterCalls.push({ thinking: request.thinking });
        if (request.messages[0]?.role === 'system' && request.messages[0].content.includes('deep background reasoning')) {
          if (request.thinking) {
            // Stream finishes with short unclosed <think> -> empty cleanText
            yield { delta: '<think>Short unclosed thought', finishReason: 'length' };
            return;
          }
          yield { delta: '[happy] 闭环重试成功啦！开启 Bloom 会增加额外全屏带宽开销。', finishReason: 'stop' };
          return;
        }
        yield { delta: '[happy] 稍等我查一下！', finishReason: 'stop' };
      },
      interruptGenerate: vi.fn(),
      xcRollbackLastTurn: vi.fn(async () => ({ popped: 0, remaining: 0 })),
      xcTruncateReplyToHeard: vi.fn(async () => ({ truncated: false, poppedTokens: 0, remainingTokens: 0 })),
      resetChat: vi.fn(async () => {}),
    };

    const router = {
      init: vi.fn(async () => {}),
      predict: vi.fn(async () => ({
        intent: 'HEAVY' as const,
        confidence: 0.99,
        probabilities: { CHAT: 0.01, HEAVY: 0.99 },
        scores: { CHAT: 0.01, HEAVY: 0.99 },
        latencyMs: 0.8,
        source: 'guardrail' as const,
      })),
      classify: vi.fn(),
      warmup: vi.fn(async () => 1.0),
      isReady: () => true,
      dispose: vi.fn(),
    };

    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      heavyConfig: { mode: 'local-thinking' },
      intentRouter: router,
    });

    await orch.handleUserTurn('分析 Bloom 后处理开销', 'zh');
    const heavyText = await orch.waitForActiveHeavyTask();
    expect(heavyText).toContain('Bloom');
    expect(adapterCalls[1].thinking).toBe(true);
    expect(adapterCalls[2].thinking).toBe(false);
  });

  it('keeps SOPHON_LIVE_FRONT_BRAIN_PROMPT free of check-in examples and isolates [Bridge-Only Check-in] to HEAVY FrontBrain turns without polluting history', async () => {
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toContain('稍等');
    expect(SOPHON_LIVE_FRONT_BRAIN_PROMPT).not.toContain('Deep/Technical Queries');
    expect(buildBridgeOnlyUserCue('analyze RGBA16F', 'en')).toContain('[Bridge-Only Check-in]');

    const adapterRequests: BrainGenerateRequest[] = [];
    const adapter: BrainKVRuntimeAdapter = {
      async *streamChat(request) {
        adapterRequests.push(request);
        if (request.messages[0]?.content.includes('deep background reasoning')) {
          yield { delta: '[relaxed] RGBA16F 4x MSAA 会导致 iOS TBDR Tile Buffer 溢出并掉帧。', finishReason: 'stop' };
          return;
        }
        if (request.messages.at(-1)?.content.includes('[Bridge-Only Check-in]')) {
          yield { delta: '[happy] 稍等我两秒，我这就去帮你仔细查一下！', finishReason: 'stop' };
          return;
        }
        yield { delta: '[happy] 今天海风超舒服呀！', finishReason: 'stop' };
      },
      interruptGenerate: vi.fn(),
      xcRollbackLastTurn: vi.fn(async () => ({ popped: 0, remaining: 0 })),
      xcTruncateReplyToHeard: vi.fn(async () => ({ truncated: false, poppedTokens: 0, remainingTokens: 0 })),
      resetChat: vi.fn(async () => {}),
    };

    const router = {
      init: vi.fn(async () => {}),
      predict: vi.fn(async (text: string) => {
        const isHeavy = text.includes('RGBA16F') || text.includes('TBDR');
        return {
          intent: (isHeavy ? 'HEAVY' : 'CHAT') as 'HEAVY' | 'CHAT',
          confidence: 0.99,
          probabilities: { CHAT: isHeavy ? 0.01 : 0.99, HEAVY: isHeavy ? 0.99 : 0.01 },
          scores: { CHAT: isHeavy ? 0.01 : 0.99, HEAVY: isHeavy ? 0.99 : 0.01 },
          latencyMs: 0.4,
          source: 'guardrail' as const,
        };
      }),
      classify: vi.fn(),
      warmup: vi.fn(async () => 0.4),
      isReady: () => true,
      dispose: vi.fn(),
    };

    const orch = new LiveOrchestrator({
      kvAdapter: adapter,
      memoryAdapter: makeMemoryAdapter().adapter,
      heavyConfig: { mode: 'local-thinking' },
      intentRouter: router,
    });

    const chatQuery = '小春，今天在海边心情怎么样呀？';
    await orch.handleUserTurn(chatQuery, 'zh');
    expect(adapterRequests[0].messages.at(-1)?.content).toBe(chatQuery);

    const heavyQuery = '帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA';
    await orch.handleUserTurn(heavyQuery, 'mixed');
    await orch.waitForActiveHeavyTask();

    const frontHeavyReq = adapterRequests[1];
    const heavyWorkerReq = adapterRequests[2];
    expect(frontHeavyReq.messages[0].content).toBe(SOPHON_LIVE_FRONT_BRAIN_PROMPT);
    expect(frontHeavyReq.messages[1]).toEqual({ role: 'user', content: chatQuery });
    expect(frontHeavyReq.messages.at(-1)?.content).toContain('[Bridge-Only Check-in]');
    expect(frontHeavyReq.messages.at(-1)?.content).not.toContain('RGBA16F');
    expect(frontHeavyReq.messages.at(-1)?.content).not.toContain('TBDR');
    expect(frontHeavyReq.messages.at(-1)?.content).not.toContain('MSAA');

    expect(heavyWorkerReq.messages.at(-1)?.content).toContain(heavyQuery);

    const hist = orch.getHistory();
    expect(hist[2]).toEqual({ role: 'user', content: heavyQuery });
    expect(hist[3]).toEqual({ role: 'assistant', content: '稍等我两秒，我这就去帮你仔细查一下！' });
  });

  it('defers memoryAdapter.recall() in local-thinking HeavyWorker until FrontBrain is no longer busy', async () => {
    let localBusy = true;
    const eventsOrder: string[] = [];

    const memoryAdapter: BrainMemoryAdapter = {
      recall: vi.fn(async () => {
        eventsOrder.push(localBusy ? 'recall_while_busy' : 'recall_after_idle');
        return { profileText: 'User likes WebGPU' };
      }),
      remember: vi.fn(async () => {}),
    };

    const localAdapter: BrainKVRuntimeAdapter = {
      async *streamChat() {
        eventsOrder.push('heavy_stream_start');
        yield { delta: '[relaxed] Tile buffer flush avoided.', finishReason: 'stop' };
      },
      interruptGenerate: vi.fn(),
      xcRollbackLastTurn: vi.fn(async () => ({ popped: 0, remaining: 0 })),
      xcTruncateReplyToHeard: vi.fn(async () => ({ truncated: false, poppedTokens: 0, remainingTokens: 0 })),
      resetChat: vi.fn(async () => {}),
    };

    const worker = new HeavyWorker({
      config: { mode: 'local-thinking' },
      localAdapter,
      memoryAdapter,
      isLocalModelBusy: () => localBusy,
    });

    const handle = worker.startTask({
      taskId: 'heavy-lazy-recall-1',
      turnId: 1,
      task: 'Analyze WebGPU TBDR',
      urgency: 'deep',
      userUtterance: 'Analyze WebGPU TBDR',
      bridgeSpokenText: 'Hang on a second!',
      history: [],
    });

    await new Promise((r) => setTimeout(r, 40));
    expect(memoryAdapter.recall).not.toHaveBeenCalled();

    localBusy = false;
    const result = await handle.result;

    expect(result).toContain('Tile buffer flush avoided.');
    expect(memoryAdapter.recall).toHaveBeenCalledTimes(1);
    expect(eventsOrder).toEqual(['recall_after_idle', 'heavy_stream_start']);
  });
});
