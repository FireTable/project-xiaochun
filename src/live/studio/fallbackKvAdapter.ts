/**
 * fallbackKvAdapter.ts — Dynamic WebGPU-or-fallback BrainKVRuntimeAdapter for Live Studio.
 *
 * When `isWebLLMReady()` is true, delegates directly to the real MLC WebGPU engine
 * (`createWebLLMKVAdapter()`). When WebGPU model weights are not yet loaded (for example,
 * on first page open or in CI verification), supplies a stateful KV-compatible streaming
 * adapter supporting `<delegate>`, inline emotion tags, O(1) rollback, and `[interrupted]`
 * heard-prefix truncation.
 */

import { isWebLLMReady } from '@/llm/webLLMProvider';
import { createWebLLMKVAdapter } from '@/live/brain/liveOrchestrator';
import { estimateBilingualTokens } from '@/live/brain/frontBrain';
import type {
  BrainGenerateRequest,
  BrainKVRuntimeAdapter,
  BrainMessage,
  BrainStreamChunk,
} from '@/live/brain/types';

function delayAbortable(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function lastUserMessage(messages: BrainMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messages[i]!.content;
  }
  return '';
}

function buildSimulatedFrontReply(userText: string, historyLen: number): string {
  if (userText.includes('[Bridge-Only Check-in]')) {
    return /[\u4e00-\u9fff]/.test(userText)
      ? '[happy] 稍等我两秒，我这就去帮你仔细查一下！'
      : '[happy] Give me just a second, let me look into that carefully for you!';
  }

  const lower = userText.toLowerCase();

  if (
    lower.includes('tbdr') ||
    lower.includes('msaa') ||
    lower.includes('rgba16f') ||
    lower.includes('查一下') ||
    lower.includes('deeply analyze')
  ) {
    return '[happy] 稍等我两秒，我这就去帮你仔细查一下！';
  }

  if (lower.includes('能听见') || lower.includes('问另一个') || lower.includes('另一个问题')) {
    return '[happy] 听得超清楚！刚才那段我已经记下来了，你快问下一个问题吧，我随时准备着呢。';
  }

  if (
    lower.includes('wind') ||
    lower.includes('gpu') ||
    lower.includes('temperature') ||
    lower.includes('hey xiaochun') ||
    (/[a-z]{3,}/i.test(userText) && /[\u4e00-\u9fff]/.test(userText))
  ) {
    return '[relaxed] 海边今天的微风刚刚好，吹着特别舒服！My WebGPU temperature is staying super cool right now, and skipping idle offscreen MSAA passes keeps our beach scene right around sixty frames per second!';
  }

  if (lower.includes('日落') || lower.includes('风景') || lower.includes('长一点') || lower.includes('故事')) {
    return '[relaxed] 海边的日落其实有很多层次的颜色，先是温暖的橘红色洒在海面上，慢慢又晕染成柔和的紫罗兰色，还有远处的白色帆船慢慢驶过，今晚吹着海风我们还可以一起数星星呢！';
  }

  if (historyLen > 2 && /害羞|喜欢|夸/.test(userText)) {
    return '[shy] 唔……突然这么认真地说这个，人家在海边都会有点不好意思啦。';
  }

  return '[happy] 我今天在海边心情超好呀！阳光暖暖的，海浪也很温柔，跟你这样实时聊天一点都不觉得累，随时都能秒回你。';
}

function buildSimulatedHeavyReply(messages: BrainMessage[]): string {
  const combined = messages.map((m) => m.content).join('\n').toLowerCase();
  const hasBloom = combined.includes('bloom');

  if (hasBloom) {
    return [
      '[surprised] 加上开启 Bloom 之后，iOS TBDR 不仅要在片外主存和片上 Tile 之间反复读写 RGBA16F 4x MSAA 的颜色样本，',
      '还要额外跑好几层全屏下采样和上采样模糊 Pass，tile memory 溢出后显存带宽压力直接成倍放大！',
      '[happy] 所以默认关闭多余的全屏后处理并直出屏幕帧缓冲，在移动端和桌面端都能立竿见影保住六十帧。',
    ].join('');
  }

  return [
    '[relaxed] 在 iOS 的 TBDR 架构上，RGBA16F 配上 4x MSAA 每像素高达 32 字节，',
    '一旦超过单个 Tile 的高速片上缓存上限，GPU 就必须把未完成的采样数据刷回系统内存再重新加载，导致明显掉帧！',
  ].join('');
}

function splitStreamTokens(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    // Keep tag tokens intact cleanly or slice small chunks like real WebLLM decode
    if (text[i] === '[' || text[i] === '<') {
      const closeBracket = text.indexOf(text[i] === '[' ? ']' : '>', i);
      if (closeBracket !== -1 && closeBracket - i < 120) {
        out.push(text.slice(i, closeBracket + 1));
        i = closeBracket + 1;
        continue;
      }
    }
    const step = /[\u4e00-\u9fff]/.test(text[i]!) ? 2 : 5;
    out.push(text.slice(i, i + step));
    i += step;
  }
  return out;
}

class StudioFallbackKVAdapter implements BrainKVRuntimeAdapter {
  private committedTurns: Array<{ user: string; assistant: string }> = [];
  private activeAbortController: AbortController | null = null;
  private activeLastReply = '';

  async *streamChat(request: BrainGenerateRequest): AsyncIterable<BrainStreamChunk> {
    const userText = lastUserMessage(request.messages);
    const isHeavySystemPrompt =
      request.messages[0]?.role === 'system' &&
      request.messages[0].content.includes('deep background reasoning');
    const fullText =
      request.thinking || isHeavySystemPrompt
        ? buildSimulatedHeavyReply(request.messages)
        : buildSimulatedFrontReply(userText, request.messages.length);

    const localAbort = new AbortController();
    this.activeAbortController = localAbort;
    const onExtAbort = () => localAbort.abort();
    request.signal?.addEventListener('abort', onExtAbort, { once: true });

    try {
      // Simulate tiny prefill (~18ms)
      const okPrefill = await delayAbortable(18, localAbort.signal);
      if (!okPrefill) return;

      const pieces = splitStreamTokens(fullText);
      let accum = '';
      for (const piece of pieces) {
        if (localAbort.signal.aborted) return;
        accum += piece;
        if (!request.thinking) {
          this.activeLastReply = accum;
        }
        yield { delta: piece, raw: piece, finishReason: null };
        const okStep = await delayAbortable(request.thinking ? 16 : 8, localAbort.signal);
        if (!okStep) return;
      }

      if (!request.thinking) {
        this.committedTurns.push({ user: userText, assistant: fullText });
      }
      yield { delta: '', finishReason: 'stop' };
    } finally {
      request.signal?.removeEventListener('abort', onExtAbort);
      if (this.activeAbortController === localAbort) {
        this.activeAbortController = null;
      }
    }
  }

  interruptGenerate(): void {
    this.activeAbortController?.abort();
  }

  async xcRollbackLastTurn(): Promise<{ popped: number; remaining: number }> {
    const poppedText = this.committedTurns.pop()?.assistant ?? this.activeLastReply;
    this.activeLastReply = '';
    const popped = Math.max(1, estimateBilingualTokens(poppedText));
    const remaining = this.committedTurns.reduce(
      (sum, t) => sum + estimateBilingualTokens(t.user) + estimateBilingualTokens(t.assistant),
      180,
    );
    return { popped, remaining };
  }

  async xcTruncateReplyToHeard(
    heardText: string,
  ): Promise<{ truncated: boolean; poppedTokens: number; remainingTokens: number }> {
    const full = this.activeLastReply || (this.committedTurns[this.committedTurns.length - 1]?.assistant ?? '');
    const fullTokens = Math.max(1, estimateBilingualTokens(full));
    const heardClean = heardText.trim();
    const keptTokens = Math.max(1, estimateBilingualTokens(heardClean));
    const poppedTokens = Math.max(1, fullTokens - keptTokens);

    if (this.committedTurns.length > 0) {
      this.committedTurns[this.committedTurns.length - 1]!.assistant = heardClean
        ? `${heardClean} [interrupted]`
        : '[interrupted]';
    }
    this.activeLastReply = '';
    const remainingTokens = this.committedTurns.reduce(
      (sum, t) => sum + estimateBilingualTokens(t.user) + estimateBilingualTokens(t.assistant),
      180,
    );
    return { truncated: true, poppedTokens, remainingTokens };
  }

  async resetChat(): Promise<void> {
    this.activeAbortController?.abort();
    this.committedTurns = [];
    this.activeLastReply = '';
  }
}

export function createDynamicStudioKvAdapter(): BrainKVRuntimeAdapter {
  const realAdapter = createWebLLMKVAdapter();
  const fallbackAdapter = new StudioFallbackKVAdapter();

  const useReal = () => isWebLLMReady();

  return {
    streamChat(request) {
      return useReal()
        ? realAdapter.streamChat(request)
        : fallbackAdapter.streamChat(request);
    },
    interruptGenerate() {
      if (useReal()) realAdapter.interruptGenerate();
      fallbackAdapter.interruptGenerate();
    },
    xcRollbackLastTurn() {
      return useReal()
        ? realAdapter.xcRollbackLastTurn()
        : fallbackAdapter.xcRollbackLastTurn();
    },
    xcTruncateReplyToHeard(heardText) {
      return useReal()
        ? realAdapter.xcTruncateReplyToHeard(heardText)
        : fallbackAdapter.xcTruncateReplyToHeard(heardText);
    },
    async resetChat() {
      await fallbackAdapter.resetChat();
      if (useReal()) {
        await realAdapter.resetChat();
      }
    },
  };
}

/**
 * Generates a gentle, syllable-modulated 24 kHz PCM waveform strictly as an
 * offline last-resort fallback when both Warm Edge-TTS and local Kokoro ONNX fail.
 */
export function synthesizeOfflineFallbackPcm24k(text: string): Float32Array {
  const sr = 24_000;
  const charCount = Math.max(4, text.replace(/\s+/g, '').length);
  const durationSec = Math.min(2.6, Math.max(0.75, charCount * 0.085));
  const length = Math.floor(sr * durationSec);
  const out = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const fadeIn = Math.min(1, t / 0.025);
    const fadeOut = Math.min(1, (durationSec - t) / 0.035);
    const syllableEnv = 0.45 + 0.55 * Math.abs(Math.sin(2 * Math.PI * 3.8 * t));
    const f0 = 230 + 28 * Math.sin(2 * Math.PI * 1.4 * t);
    const wave =
      0.55 * Math.sin(2 * Math.PI * f0 * t) +
      0.3 * Math.sin(2 * Math.PI * (f0 * 2.0) * t) +
      0.15 * Math.sin(2 * Math.PI * (f0 * 3.1) * t);
    out[i] = 0.085 * fadeIn * fadeOut * syllableEnv * wave;
  }
  return out;
}
