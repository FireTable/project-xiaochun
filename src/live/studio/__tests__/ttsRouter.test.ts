import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StudioTtsRouter, DEFAULT_ONLINE_VOICE } from '../ttsRouter';
import { resolveEdgeVoiceForLanguage } from '@/live/tts/affectiveClauseSlicer';
import type { TtsAudioResult, TtsSynthesisRequest } from '@/live/tts/types';

vi.mock('@/live/tts/warmEdgeTtsClient', () => {
  class MockWarmEdgeTtsClient {
    prewarm = vi.fn().mockResolvedValue({ ok: true, warmSockets: 2 });
    synthesize = vi.fn().mockImplementation(async (_req: TtsSynthesisRequest): Promise<TtsAudioResult> => ({
      pcm24k: new Float32Array(2400),
      sampleRate: 24000,
      durationMs: 100,
      ttfaMs: 280,
      engine: 'edge-warm',
      warmHit: true,
    }));
    dispose = vi.fn();
  }
  return {
    WarmEdgeTtsClient: MockWarmEdgeTtsClient,
  };
});

vi.mock('@/live/tts/kokoroTtsClient', () => {
  class MockKokoroTtsClient {
    private ready = false;
    init = vi.fn().mockImplementation(async () => {
      this.ready = true;
    });
    isReady = vi.fn().mockImplementation(() => this.ready);
    synthesize = vi.fn().mockImplementation(async (_req: TtsSynthesisRequest): Promise<TtsAudioResult> => ({
      pcm24k: new Float32Array(2400),
      sampleRate: 24000,
      durationMs: 100,
      ttfaMs: 850,
      engine: 'kokoro-local',
    }));
    dispose = vi.fn();
  }
  return {
    KokoroTtsClient: MockKokoroTtsClient,
  };
});

describe('StudioTtsRouter & Persona Consistency', () => {
  let router: StudioTtsRouter;
  let originalNavigator: typeof globalThis.navigator | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalNavigator = globalThis.navigator;
    router = new StudioTtsRouter();
  });

  afterEach(() => {
    router.dispose();
    if (originalNavigator !== undefined) {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    }
  });

  describe('DEFAULT_ONLINE_VOICE and voice resolution', () => {
    it('defines and exports DEFAULT_ONLINE_VOICE as zh-CN-XiaoyiNeural', () => {
      expect(DEFAULT_ONLINE_VOICE).toBe('zh-CN-XiaoyiNeural');
    });

    it('resolveEdgeVoiceForLanguage returns zh-CN-XiaoyiNeural for ZH/EN/mixed and ja-JP-NanamiNeural for Japanese', () => {
      expect(resolveEdgeVoiceForLanguage('zh')).toBe('zh-CN-XiaoyiNeural');
      expect(resolveEdgeVoiceForLanguage('en')).toBe('zh-CN-XiaoyiNeural');
      expect(resolveEdgeVoiceForLanguage('mixed')).toBe('zh-CN-XiaoyiNeural');
      expect(resolveEdgeVoiceForLanguage(undefined)).toBe('zh-CN-XiaoyiNeural');
      expect(resolveEdgeVoiceForLanguage('ja')).toBe('ja-JP-NanamiNeural');
    });
  });

  describe('Auto mode routing and voice persona consistency', () => {
    it('routes Chinese text online to Warm Edge-TTS with DEFAULT_ONLINE_VOICE', async () => {
      expect(router.getMode()).toBe('auto');
      const res = await router.synthesize({ text: '你好，欢迎来到海边工作室！' });

      expect(res.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();

      const callReq = vi.mocked(router.edge.synthesize).mock.calls[0][0];
      expect(callReq.voicePreset).toBe('zh-CN-XiaoyiNeural');
      expect(callReq.languageHint).toBe('zh');
    });

    it('routes English text online to Warm Edge-TTS with DEFAULT_ONLINE_VOICE', async () => {
      const res = await router.synthesize({ text: 'Welcome to XiaoChun live studio.' });

      expect(res.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();

      const callReq = vi.mocked(router.edge.synthesize).mock.calls[0][0];
      expect(callReq.voicePreset).toBe('zh-CN-XiaoyiNeural');
      expect(callReq.languageHint).toBe('en');
    });

    it('routes mixed Chinese-English text online to Warm Edge-TTS with DEFAULT_ONLINE_VOICE', async () => {
      const res = await router.synthesize({
        text: 'Hey XiaoChun, 这里的 WebGPU frame pacing 表现非常 stable!',
      });

      expect(res.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();

      const callReq = vi.mocked(router.edge.synthesize).mock.calls[0][0];
      expect(callReq.voicePreset).toBe('zh-CN-XiaoyiNeural');
      expect(callReq.languageHint).toBe('mixed');
    });

    it('routes Japanese kana text online to ja-JP-NanamiNeural', async () => {
      const res = await router.synthesize({
        text: 'おはようございます、今日もいい天気ですね！',
      });

      expect(res.engine).toBe('edge-warm');
      const callReq = vi.mocked(router.edge.synthesize).mock.calls[0][0];
      expect(callReq.voicePreset).toBe('ja-JP-NanamiNeural');
    });

    it('preserves an explicit voicePreset if supplied by the caller', async () => {
      const res = await router.synthesize({
        text: '自定义声音测试',
        voicePreset: 'zh-CN-YunxiNeural',
      });

      expect(res.engine).toBe('edge-warm');
      const callReq = vi.mocked(router.edge.synthesize).mock.calls[0][0];
      expect(callReq.voicePreset).toBe('zh-CN-YunxiNeural');
    });
  });

  describe('Lazy-loading Kokoro-82M in warmupSelected()', () => {
    it('does NOT call kokoro.init() in auto mode during warmupSelected()', async () => {
      expect(router.getMode()).toBe('auto');

      const warmupRes = await router.warmupSelected();

      expect(router.edge.prewarm).toHaveBeenCalledTimes(1);
      expect(router.kokoro.init).not.toHaveBeenCalled();
      expect(warmupRes.edgeOk).toBe(true);
      expect(warmupRes.kokoroReady).toBe(false);
    });

    it('does NOT call kokoro.init() in edge-warm mode during warmupSelected()', async () => {
      router.setMode('edge-warm');
      const warmupRes = await router.warmupSelected();

      expect(router.edge.prewarm).toHaveBeenCalledTimes(1);
      expect(router.kokoro.init).not.toHaveBeenCalled();
      expect(warmupRes.edgeOk).toBe(true);
      expect(warmupRes.kokoroReady).toBe(false);
    });

    it('DOES call kokoro.init() in kokoro-local mode during warmupSelected()', async () => {
      router.setMode('kokoro-local');
      const warmupRes = await router.warmupSelected();

      expect(router.edge.prewarm).toHaveBeenCalledTimes(1);
      expect(router.kokoro.init).toHaveBeenCalledTimes(1);
      expect(warmupRes.edgeOk).toBe(true);
      expect(warmupRes.kokoroReady).toBe(true);
    });

    it('loadKokoro() explicitly initializes Kokoro', async () => {
      expect(router.kokoro.isReady()).toBe(false);
      await router.loadKokoro();
      expect(router.kokoro.init).toHaveBeenCalledTimes(1);
      expect(router.kokoro.isReady()).toBe(true);
    });
  });

  describe('Offline and failure fallback behavior in Auto mode', () => {
    it('falls back to Kokoro when offline (navigator.onLine === false)', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
        writable: true,
      });

      const res = await router.synthesize({ text: '网络断开，回退到离线本地 Kokoro' });

      expect(res.engine).toBe('kokoro-local');
      expect(router.edge.synthesize).not.toHaveBeenCalled();
      expect(router.kokoro.synthesize).toHaveBeenCalledTimes(1);
      const callReq = vi.mocked(router.kokoro.synthesize).mock.calls[0][0];
      expect(callReq.text).toBe('网络断开，回退到离线本地 Kokoro');
    });

    it('falls back to Kokoro when Edge-TTS synthesis rejects with a network or HTTP error', async () => {
      vi.mocked(router.edge.synthesize).mockRejectedValueOnce(new Error('HTTP 502 Bad Gateway'));

      const res = await router.synthesize({ text: 'Edge服务暂时不可用' });

      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).toHaveBeenCalledTimes(1);
      expect(res.engine).toBe('kokoro-local');
    });

    it('re-throws AbortError without swallowing or routing to Kokoro when interrupted', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      vi.mocked(router.edge.synthesize).mockRejectedValueOnce(abortError);

      await expect(
        router.synthesize({ text: '用户插话打断当前语音' }),
      ).rejects.toThrow('The operation was aborted');

      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();
    });
  });

  describe('Explicit modes: edge-warm and kokoro-local', () => {
    it('routes strictly to Edge in edge-warm mode', async () => {
      router.setMode('edge-warm');
      const res = await router.synthesize({ text: '仅使用 Edge 模式' });

      expect(res.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();
    });

    it('throws directly in edge-warm mode if Edge fails without falling back to Kokoro', async () => {
      router.setMode('edge-warm');
      vi.mocked(router.edge.synthesize).mockRejectedValueOnce(new Error('Edge down'));

      await expect(router.synthesize({ text: '测试错误' })).rejects.toThrow('Edge down');
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();
    });

    it('routes strictly to Kokoro in kokoro-local mode', async () => {
      router.setMode('kokoro-local');
      const res = await router.synthesize({ text: '本地 Kokoro 模式' });

      expect(res.engine).toBe('kokoro-local');
      expect(router.kokoro.synthesize).toHaveBeenCalledTimes(1);
      expect(router.edge.synthesize).not.toHaveBeenCalled();
    });
  });

  describe('Lifecycle and utilities', () => {
    it('warmEdge calls edge.prewarm()', async () => {
      const res = await router.warmEdge();
      expect(router.edge.prewarm).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(true);
      expect(res.warmSockets).toBe(2);
    });

    it('dispose() delegates to edge.dispose() and kokoro.dispose()', () => {
      router.dispose();
      expect(router.edge.dispose).toHaveBeenCalledTimes(1);
      expect(router.kokoro.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
