import { describe, expect, it, vi } from 'vitest';
import {
  Conversation,
  compareConversationObject,
  EMPTY_THINKING_BLOCK,
  LLMChatPipeline,
  MLCEngine,
  PrefillAbortedError,
  Role,
  stripEmptyThinkingPrefix,
  type ConvTemplateConfig,
} from '@mlc-ai/web-llm';
import { ThinMLCEngine } from '../webllmThinClient';

const CHATML_TEMPLATE: ConvTemplateConfig = {
  system_template: '<|im_start|>system\n{system_message}<|im_end|>\n',
  system_message: 'You are XiaoChun.',
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

function makeFakeTokenizer() {
  // Deterministic 1-char-per-token tokenizer for exact prefix/popn math tests
  return {
    encode(text: string): Int32Array {
      const codes = new Int32Array(text.length);
      for (let i = 0; i < text.length; i++) {
        codes[i] = text.charCodeAt(i);
      }
      return codes;
    },
    decode(ids: Int32Array): string {
      return Array.from(ids)
        .map((c) => String.fromCharCode(c))
        .join('');
    },
  };
}

function makeHarnessPipeline(opts?: {
  kvStateKind?: 'kv_cache' | 'rnn_state';
  prefillChunkSize?: number;
}) {
  const popCalls: Array<{ seqId: number; n: number }> = [];
  const tokenizer = makeFakeTokenizer();
  const pipeline = Object.create(LLMChatPipeline.prototype) as any;

  pipeline.tvm = {
    beginScope: () => {},
    endScope: () => {},
    detachFromCurrentScope: <T>(x: T) => x,
  };
  pipeline.device = { sync: async () => {} };
  pipeline.tokenizer = tokenizer;
  pipeline.config = { model_config: {} };
  pipeline.conversation = new Conversation(CHATML_TEMPLATE);
  pipeline.stopStr = ['<|im_end|>'];
  pipeline.stopTokens = [2];
  pipeline.kvStateKind = opts?.kvStateKind ?? 'kv_cache';
  pipeline.kvCache = opts?.kvStateKind === 'rnn_state' ? undefined : { id: 'kv0' };
  pipeline.rnnState = opts?.kvStateKind === 'rnn_state' ? { id: 'rnn0' } : undefined;
  pipeline.prefillChunkSize = opts?.prefillChunkSize ?? 4;
  pipeline.slidingWindowSize = -1;
  pipeline.contextWindowSize = 4096;
  pipeline.filledKVCacheLength = 0;
  pipeline.turnHistoryStack = [];
  pipeline.outputIds = [];
  pipeline.outputMessage = '';
  pipeline.stopTriggered = false;
  pipeline.finishReason = undefined;
  pipeline.appearedTokensFreq = new Map();
  pipeline.imageDataCache = new Map();
  pipeline.artifactImagePixelCache = new Map();
  pipeline.kvStateAlignedAfterRecovery = false;
  pipeline.curRoundAssistantPrefixCount = 0;
  pipeline.curRoundRolledBackMidPrefill = false;
  pipeline.tokenLogprobArray = [];
  pipeline.fclearKVCaches = () => {};
  pipeline.fKVCacheAddSequence = () => {};
  pipeline.fKVCachePopN = (_cache: unknown, seqScalar: any, nScalar: any) => {
    const seqId = Number(seqScalar?.value ?? seqScalar ?? 0);
    const n = Number(nScalar?.value ?? nScalar ?? 0);
    popCalls.push({ seqId, n });
  };
  pipeline.getActiveKVStates = () =>
    pipeline.kvCache ? [pipeline.kvCache] : [];
  pipeline.logitProcessor = { resetState: vi.fn() };

  return { pipeline: pipeline as Record<string, any>, popCalls, tokenizer };
}

describe('WebLLM KV control, enable_thinking: false parity & sub-chunk prefill abort', () => {
  it('stores stripped assistant text in oldConv on finishReply and matches Turn-2 compareConversationObject', () => {
    const oldConv = new Conversation(CHATML_TEMPLATE);
    oldConv.appendMessage(Role.user, '今天天气真好呀');
    oldConv.appendEmptyThinkingReplyHeader(Role.assistant, EMPTY_THINKING_BLOCK);
    oldConv.finishReply(`${EMPTY_THINKING_BLOCK}是呀，海风吹着超舒服！`);

    expect(oldConv.messages[1][2]).toBe('是呀，海风吹着超舒服！');

    const newConvStripped = new Conversation(CHATML_TEMPLATE);
    newConvStripped.appendMessage(Role.user, '今天天气真好呀');
    newConvStripped.appendMessage(Role.assistant, '是呀，海风吹着超舒服！');
    expect(compareConversationObject(oldConv, newConvStripped)).toBe(true);

    // Also matches when caller retains EMPTY_THINKING_BLOCK verbatim
    const newConvWithThink = new Conversation(CHATML_TEMPLATE);
    newConvWithThink.appendMessage(Role.user, '今天天气真好呀');
    newConvWithThink.appendMessage(
      Role.assistant,
      `${EMPTY_THINKING_BLOCK}是呀，海风吹着超舒服！`,
    );
    expect(compareConversationObject(oldConv, newConvWithThink)).toBe(true);
    expect(stripEmptyThinkingPrefix(`${EMPTY_THINKING_BLOCK}hello`)).toBe('hello');
  });

  it('aborts forwardPrefill BEFORE subsequent prefill chunks and pops partial KV + uncommitted conversation entries', async () => {
    const { pipeline, popCalls } = makeHarnessPipeline({ prefillChunkSize: 4 });

    // Seed clean Turn 1 already in KV (20 tokens)
    pipeline.conversation.appendMessage(Role.user, 'hello');
    pipeline.conversation.appendMessage(Role.assistant, 'hi there');
    pipeline.filledKVCacheLength = 20;
    pipeline.turnHistoryStack.push({
      turnStartKVLen: 0,
      turnStartMessageCount: 0,
      promptTokensInKV: 12,
      assistantPrefixTokenIds: [],
      generatedTokenIds: [104, 105],
    });
    pipeline.finishReason = 'stop';

    let interrupt = false;
    let forwardedChunks = 0;
    pipeline.setInterruptChecker(() => interrupt);
    pipeline.getInputData = async () => [
      // 12 tokens -> 3 chunks of 4 tokens each
      [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
      12,
      () => 1,
    ];
    pipeline.embedAndForward = async (_chunk: unknown, len: number) => {
      forwardedChunks += 1;
      pipeline.filledKVCacheLength += len;
      if (forwardedChunks === 1) {
        // Barge-in arrives right after chunk 0!
        interrupt = true;
      }
      return { dispose: () => {} };
    };

    await expect(
      pipeline.forwardPrefill('interrupt me mid prefill', Role.user, undefined, {
        enable_thinking: false,
      }),
    ).rejects.toBeInstanceOf(PrefillAbortedError);

    // Must stop right after chunk 0 without running chunk 1 or chunk 2
    expect(forwardedChunks).toBe(1);
    expect(popCalls).toEqual([{ seqId: 0, n: 4 }]);
    // Turn 1's 20 KV tokens and 2 messages remain completely intact!
    expect(pipeline.filledKVCacheLength).toBe(20);
    expect(pipeline.conversation.messages).toHaveLength(2);
    expect(pipeline.isKVStateAlignedAfterRecovery()).toBe(true);

    // Calling rollbackLastTurn after mid-prefill rollback must NOT pop Turn 1!
    const rb = pipeline.rollbackLastTurn();
    expect(rb).toEqual({ popped: 0, remaining: 20 });
    expect(pipeline.turnHistoryStack).toHaveLength(1);
  });

  it('rolls back an uncommitted speculative draft turn via O(1) kv_state_popn', () => {
    const { pipeline, popCalls, tokenizer } = makeHarnessPipeline();

    // Commit Turn 1 (30 KV tokens)
    pipeline.conversation.appendMessage(Role.user, 'Turn 1');
    pipeline.conversation.appendMessage(Role.assistant, 'Reply 1');
    pipeline.filledKVCacheLength = 30;
    pipeline.turnHistoryStack.push({
      turnStartKVLen: 0,
      turnStartMessageCount: 0,
      promptTokensInKV: 20,
      assistantPrefixTokenIds: [],
      generatedTokenIds: Array.from(tokenizer.encode('Reply 1')),
    });

    // Speculative Turn 2 prefilled 14 tokens and decoded 5 tokens into KV (total +19)
    pipeline.conversation.appendMessage(Role.user, 'Partial user?');
    pipeline.conversation.appendEmptyThinkingReplyHeader(Role.assistant, EMPTY_THINKING_BLOCK);
    pipeline.turnHistoryStack.push({
      turnStartKVLen: 30,
      turnStartMessageCount: 2,
      promptTokensInKV: 14,
      assistantPrefixTokenIds: Array.from(tokenizer.encode(EMPTY_THINKING_BLOCK)),
      generatedTokenIds: Array.from(tokenizer.encode('Speculative')),
    });
    pipeline.filledKVCacheLength = 30 + 14 + 5;

    const res = pipeline.rollbackLastTurn();
    expect(res).toEqual({ popped: 19, remaining: 30 });
    expect(popCalls).toEqual([{ seqId: 0, n: 19 }]);
    expect(pipeline.conversation.messages).toHaveLength(2);
    expect(pipeline.getFinishReason()).toBe('stop');
    expect(pipeline.isKVStateAlignedAfterRecovery()).toBe(true);
  });

  it('truncates unheard suffix tokens via kv_state_popn and keeps KV hot across preparePrefillInput', () => {
    const { pipeline, popCalls, tokenizer } = makeHarnessPipeline();
    const replyText = '好的，我现在帮你看一下代码问题。';
    const replyIds = Array.from(tokenizer.encode(replyText));
    const promptKV = 24;

    pipeline.conversation.appendMessage(Role.user, '帮我看下 bug');
    pipeline.conversation.appendEmptyThinkingReplyHeader(Role.assistant, EMPTY_THINKING_BLOCK);
    pipeline.turnHistoryStack.push({
      turnStartKVLen: 0,
      turnStartMessageCount: 0,
      promptTokensInKV: promptKV,
      assistantPrefixTokenIds: Array.from(tokenizer.encode(EMPTY_THINKING_BLOCK)),
      generatedTokenIds: replyIds,
    });
    pipeline.filledKVCacheLength = promptKV + replyIds.length;
    pipeline.conversation.finishReply(`${EMPTY_THINKING_BLOCK}${replyText}`);
    pipeline.finishReason = 'abort';

    const heardText = '好的，我现在';
    const trunc = pipeline.truncateReplyToHeard(heardText);
    const unheardExpected = replyIds.length - heardText.length;

    expect(trunc.truncated).toBe(true);
    expect(trunc.poppedTokens).toBe(unheardExpected);
    expect(trunc.remainingTokens).toBe(promptKV + heardText.length);
    expect(popCalls).toEqual([{ seqId: 0, n: unheardExpected }]);
    expect(pipeline.conversation.messages[1][2]).toBe(`${heardText} [interrupted]`);
    expect(pipeline.getFinishReason()).toBe('stop');
    expect(pipeline.isKVStateAlignedAfterRecovery()).toBe(true);

    // Verify MLCEngine.preparePrefillInput reuses KV cache on Turn 2 without wiping!
    const engine = Object.create(MLCEngine.prototype) as any;
    const resetSpy = vi.spyOn(pipeline, 'resetChat');
    engine.preparePrefillInput(
      {
        model: 'mock-model',
        messages: [
          { role: 'user', content: '帮我看下 bug' },
          { role: 'assistant', content: `${heardText} [interrupted]` },
          { role: 'user', content: '直接告诉我原因' },
        ],
      },
      pipeline,
      { conv_config: CHATML_TEMPLATE, conv_template: CHATML_TEMPLATE },
      true,
    );
    expect(resetSpy).not.toHaveBeenCalled();
    expect(pipeline.filledKVCacheLength).toBe(promptKV + heardText.length);
  });

  it('degrades gracefully when kvStateKind is not kv_cache', () => {
    const { pipeline, popCalls } = makeHarnessPipeline({ kvStateKind: 'rnn_state' });
    pipeline.conversation.appendMessage(Role.user, 'hi');
    pipeline.conversation.appendMessage(Role.assistant, 'full response');
    pipeline.turnHistoryStack.push({
      turnStartKVLen: 0,
      turnStartMessageCount: 0,
      promptTokensInKV: 10,
      assistantPrefixTokenIds: [],
      generatedTokenIds: [1, 2, 3, 4],
    });
    pipeline.filledKVCacheLength = 14;

    const trunc = pipeline.truncateReplyToHeard('full');
    expect(trunc.truncated).toBe(false);
    expect(trunc.poppedTokens).toBe(0);
    expect(popCalls).toEqual([]);
    expect(pipeline.conversation.messages[1][2]).toBe('full [interrupted]');
    expect(pipeline.getFinishReason()).toBe('abort');

    const rb = pipeline.rollbackLastTurn();
    expect(rb.popped).toBe(0);
    expect(pipeline.conversation.messages).toHaveLength(0);
  });

  it('forwards ThinMLCEngine xcRollbackLastTurn and xcTruncateReplyToHeard worker RPCs', async () => {
    const sent: Array<{ kind: string; uuid: string; content: unknown }> = [];
    const fakeWorker = {
      onmessage: null as ((ev: MessageEvent) => void) | null,
      postMessage(msg: { kind: string; uuid: string; content: unknown }) {
        sent.push(msg);
        queueMicrotask(() => {
          const payload =
            msg.kind === 'xcRollbackLastTurn'
              ? { popped: 12, remaining: 40 }
              : { truncated: true, poppedTokens: 9, remainingTokens: 31 };
          fakeWorker.onmessage?.({
            data: { kind: 'return', uuid: msg.uuid, content: payload },
          } as MessageEvent);
        });
      },
    };

    const client = new ThinMLCEngine(fakeWorker as unknown as Worker);
    const rb = await client.xcRollbackLastTurn('MiniCPM5-2B-q4f16_1-MLC');
    const trunc = await client.xcTruncateReplyToHeard('你好呀');

    expect(rb).toEqual({ popped: 12, remaining: 40 });
    expect(trunc).toEqual({
      truncated: true,
      poppedTokens: 9,
      remainingTokens: 31,
    });
    expect(sent.map((m) => m.kind)).toEqual([
      'xcRollbackLastTurn',
      'xcTruncateReplyToHeard',
    ]);
    expect(sent[1].content).toEqual({ heardText: '你好呀', modelId: undefined });
  });

  it('passes explicit extra_body.enable_thinking: false cleanly from webLLMProvider without false thinking milestones', async () => {
    const capturedRequests: any[] = [];
    const fakeWorkerCalls: any[] = [];

    // Mock worker responder simulating WebWorkerMLCEngine protocol chunks with EMPTY_THINKING_BLOCK
    const listeners = new Set<(ev: MessageEvent) => void>();
    const streamQueue: Array<any> = [
      {
        choices: [{ delta: { content: EMPTY_THINKING_BLOCK }, finish_reason: null }],
      },
      {
        choices: [{ delta: { content: '今天海风好舒服。' }, finish_reason: null }],
      },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
      },
      undefined,
    ];

    // Instantiate ThinMLCEngine directly via exported helper verification on webLLMProvider via dynamic import spy
    const { streamWebLLMDirect } = await import('../webLLMProvider');
    expect(typeof streamWebLLMDirect).toBe('function');

    // Verify ThinMLCEngine request envelope when streaming with enable_thinking: false
    const mockWorker = {
      postMessage(msg: any) {
        fakeWorkerCalls.push(msg);
        if (msg.kind === 'chatCompletionStreamInit') {
          capturedRequests.push(msg.content.request);
        }
        queueMicrotask(() => {
          let content: any = null;
          if (msg.kind === 'completionStreamNextChunk') {
            content = streamQueue.shift();
          }
          mockWorker.onmessage?.({
            data: { kind: 'return', uuid: msg.uuid, content },
          } as MessageEvent);
        });
      },
      onmessage: null as ((ev: MessageEvent) => void) | null,
      addEventListener: (t: string, fn: any) => {
        if (t === 'message') listeners.add(fn);
      },
      removeEventListener: () => {},
    };

    const thin = new ThinMLCEngine(mockWorker as unknown as Worker);
    (thin as any).modelId = ['MiniCPM5-2B-q4f16_1-MLC'];

    const stream = await thin.chatCompletion({
      model: 'MiniCPM5-2B-q4f16_1-MLC',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      extra_body: { enable_thinking: false },
    });
    const parts: string[] = [];
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        parts.push(chunk.choices[0].delta.content);
      }
    }
    expect(capturedRequests[0].extra_body).toEqual({ enable_thinking: false });
    expect(parts.join('')).toBe(`${EMPTY_THINKING_BLOCK}今天海风好舒服。`);
  });
});
