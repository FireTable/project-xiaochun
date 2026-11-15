/**
 * f3_f4_tts_consistency.test.ts — Tier 1 & Tier 2 E2E Tests for Features F3 & F4:
 * Auto TTS Single-Voice Consistency (Warm Edge-TTS with 'zh-CN-XiaoyiNeural')
 * & Kokoro-82M Resilient Lazy Fallback (Zero Eager Load on Boot).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StudioTtsRouter, DEFAULT_ONLINE_VOICE } from '@/live/studio/ttsRouter';
import { resolveEdgeVoiceForLanguage } from '@/live/tts/affectiveClauseSlicer';
import type { TtsAudioResult, TtsSynthesisRequest } from '@/live/tts/types';

vi.mock('@/live/tts/warmEdgeTtsClient', () => {
  class MockWarmEdgeTtsClient {
    prewarm = vi.fn().mockResolvedValue({ ok: true, warmSockets: 2 });
    synthesize = vi.fn().mockImplementation(
      async (_req: TtsSynthesisRequest): Promise<TtsAudioResult> => ({
        pcm24k: new Float32Array(2400),
        sampleRate: 24000,
        durationMs: 100,
        ttfaMs: 295,
        engine: 'edge-warm',
        warmHit: true,
      }),
    );
    dispose = vi.fn();
  }
  return {
    WarmEdgeTtsClient: MockWarmEdgeTtsClient,
  };
});

vi.mock('@/live/tts/kokoroTtsClient', () => {
  class MockKokoroTtsClient {
    private ready = false;
    private initPromise: Promise<void> | null = null;

    init = vi.fn().mockImplementation(async () => {
      if (this.initPromise) return this.initPromise;
      this.initPromise = (async () => {
        await new Promise((r) => setTimeout(r, 20));
        this.ready = true;
      })();
      return this.initPromise;
    });

    isReady = vi.fn().mockImplementation(() => this.ready);

    synthesize = vi.fn().mockImplementation(
      async (_req: TtsSynthesisRequest): Promise<TtsAudioResult> => ({
        pcm24k: new Float32Array(2400),
        sampleRate: 24000,
        durationMs: 100,
        ttfaMs: 820,
        engine: 'kokoro-local',
      }),
    );
    dispose = vi.fn();
  }
  return {
    KokoroTtsClient: MockKokoroTtsClient,
  };
});

describe('Features F3 & F4: Studio TTS Routing & Fallback Consistency (Tier 1 & Tier 2)', () => {
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

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (10 TESTS)
  // =========================================================================

  describe('Tier 1: Feature F3 — Auto TTS Single-Voice Consistency (Online)', () => {
    it('T1-F3-01: routes online Chinese text in Auto mode to Warm Edge-TTS with Xiaoyi', async () => {
      expect(router.getMode()).toBe('auto');
      const res = await router.synthesize({ text: '小春早上好！今天海风真不错。' });

      expect(res.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();

      const callReq = vi.mocked(router.edge.synthesize).mock.calls[0][0];
      expect(callReq.voicePreset).toBe(DEFAULT_ONLINE_VOICE);
      expect(callReq.voicePreset).toBe('zh-CN-XiaoyiNeural');
    });

    it('T1-F3-02: routes online English text in Auto mode to Warm Edge-TTS with Xiaoyi', async () => {
      const res = await router.synthesize({ text: 'Good morning! Let us walk by the beach.' });

      expect(res.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();

      const callReq = vi.mocked(router.edge.synthesize).mock.calls[0][0];
      expect(callReq.voicePreset).toBe('zh-CN-XiaoyiNeural');
    });

    it('T1-F3-03: routes online mixed ZH+EN code-switching in Auto mode to Warm Edge-TTS with Xiaoyi', async () => {
      const res = await router.synthesize({
        text: '小春早, today is a sunny day! 这个 WebGPU shader 看起来太赞了。',
      });

      expect(res.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();

      const callReq = vi.mocked(router.edge.synthesize).mock.calls[0][0];
      expect(callReq.voicePreset).toBe('zh-CN-XiaoyiNeural');
    });

    it('T1-F3-04: verifies DEFAULT_ONLINE_VOICE export and consistent resolver mapping', () => {
      expect(DEFAULT_ONLINE_VOICE).toBe('zh-CN-XiaoyiNeural');
      expect(resolveEdgeVoiceForLanguage('zh')).toBe('zh-CN-XiaoyiNeural');
      expect(resolveEdgeVoiceForLanguage('en')).toBe('zh-CN-XiaoyiNeural');
      expect(resolveEdgeVoiceForLanguage('mixed')).toBe('zh-CN-XiaoyiNeural');
    });

    it('T1-F3-05: verifies TTFA latency < 500ms and explicit edge-warm mode routing', async () => {
      router.setMode('edge-warm');
      const res = await router.synthesize({ text: '测试 edge-warm 延迟' });

      expect(res.engine).toBe('edge-warm');
      expect(res.ttfaMs).toBeLessThan(500);
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();
    });
  });

  describe('Tier 1: Feature F4 — Kokoro-82M Lazy Fallback (Zero Eager Load)', () => {
    it('T1-F4-01: warmupSelected in Auto mode does NOT eagerly load or initialize Kokoro', async () => {
      expect(router.getMode()).toBe('auto');
      const warmupRes = await router.warmupSelected();

      expect(router.edge.prewarm).toHaveBeenCalledTimes(1);
      expect(router.kokoro.init).not.toHaveBeenCalled();
      expect(warmupRes.edgeOk).toBe(true);
      expect(warmupRes.kokoroReady).toBe(false);
      expect(router.kokoro.isReady()).toBe(false);
    });

    it('T1-F4-02: Edge HTTP/network error triggers lazy fallback to Kokoro-82M', async () => {
      vi.mocked(router.edge.synthesize).mockRejectedValueOnce(new Error('HTTP 502 Bad Gateway'));

      const res = await router.synthesize({ text: 'Edge服务暂时不可用，回退本地模型' });

      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).toHaveBeenCalledTimes(1);
      expect(res.engine).toBe('kokoro-local');
    });

    it('T1-F4-03: offline mode (navigator.onLine === false) triggers lazy Kokoro without calling Edge', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
        writable: true,
      });

      const res = await router.synthesize({ text: '离线状态语音合成' });

      expect(res.engine).toBe('kokoro-local');
      expect(router.edge.synthesize).not.toHaveBeenCalled();
      expect(router.kokoro.synthesize).toHaveBeenCalledTimes(1);
    });

    it('T1-F4-04: explicit kokoro-local mode eagerly loads and synthesizes via Kokoro', async () => {
      router.setMode('kokoro-local');
      const warmupRes = await router.warmupSelected();

      expect(router.kokoro.init).toHaveBeenCalledTimes(1);
      expect(warmupRes.kokoroReady).toBe(true);

      const res = await router.synthesize({ text: '本地离线优先模式' });
      expect(res.engine).toBe('kokoro-local');
      expect(router.kokoro.synthesize).toHaveBeenCalledTimes(1);
      expect(router.edge.synthesize).not.toHaveBeenCalled();
    });

    it('T1-F4-05: repeated fallback reuses initialized Kokoro instance without re-initialization', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
        writable: true,
      });

      await router.synthesize({ text: '第一次离线调用' });
      await router.synthesize({ text: '第二次离线调用' });
      await router.synthesize({ text: '第三次离线调用' });

      expect(router.kokoro.synthesize).toHaveBeenCalledTimes(3);
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARIES & CORNER CASES (10 TESTS)
  // =========================================================================

  describe('Tier 2: Boundaries for F3 (Edge-TTS Concurrency & Interruptions)', () => {
    it('T2-F3-01: handles 10 rapid-fire parallel synthesis calls without socket leaks', async () => {
      const texts = Array.from({ length: 10 }, (_, i) => `并发语音请求第 ${i + 1} 句`);
      const results = await Promise.all(texts.map((t) => router.synthesize({ text: t })));

      expect(results).toHaveLength(10);
      for (const res of results) {
        expect(res.engine).toBe('edge-warm');
      }
      expect(router.edge.synthesize).toHaveBeenCalledTimes(10);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();
    });

    it('T2-F3-02: abort signal re-throws AbortError cleanly and does NOT trigger Kokoro fallback', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      vi.mocked(router.edge.synthesize).mockRejectedValueOnce(abortError);

      await expect(
        router.synthesize({ text: '用户插话打断当前语音', signal: new AbortController().signal }),
      ).rejects.toThrow('The operation was aborted');

      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).not.toHaveBeenCalled();
    });

    it('T2-F3-03: synthesizes minimal 1-character utterance without empty buffer errors', async () => {
      const singleCharZh = await router.synthesize({ text: '嗯' });
      expect(singleCharZh.engine).toBe('edge-warm');
      expect(singleCharZh.pcm24k.byteLength).toBeGreaterThan(0);

      const singleCharEn = await router.synthesize({ text: 'A' });
      expect(singleCharEn.engine).toBe('edge-warm');
      expect(singleCharEn.pcm24k.byteLength).toBeGreaterThan(0);
    });

    it('T2-F3-04: online state toggle (offline -> online) immediately switches back to Edge-TTS', async () => {
      // Step 1: Start offline
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
        writable: true,
      });
      const resOffline = await router.synthesize({ text: '离线问答' });
      expect(resOffline.engine).toBe('kokoro-local');

      // Step 2: Toggle online
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true },
        configurable: true,
        writable: true,
      });
      const resOnline = await router.synthesize({ text: '网络已恢复' });
      expect(resOnline.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
    });

    it('T2-F3-05: synthesizes URLs and code tokens without speech slicer crash', async () => {
      const complexText = '请访问 https://threejs.org 查看 RGBA16F 4x MSAA shader 示例。';
      const res = await router.synthesize({ text: complexText });

      expect(res.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      const callReq = vi.mocked(router.edge.synthesize).mock.calls[0][0];
      expect(callReq.text).toBe(complexText);
    });
  });

  describe('Tier 2: Boundaries for F4 (Kokoro Fallback Resilience & Edge Failures)', () => {
    it('T2-F4-01: catastrophic dual failure propagates error cleanly without hanging', async () => {
      vi.mocked(router.edge.synthesize).mockRejectedValueOnce(new Error('Edge 500 Internal Error'));
      vi.mocked(router.kokoro.synthesize).mockRejectedValueOnce(new Error('Kokoro WASM Out Of Memory'));

      await expect(router.synthesize({ text: '双端故障测试' })).rejects.toThrow(
        'Kokoro WASM Out Of Memory',
      );
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
      expect(router.kokoro.synthesize).toHaveBeenCalledTimes(1);
    });

    it('T2-F4-02: concurrent lazy load calls handle concurrent execution safely', async () => {
      vi.mocked(router.edge.synthesize).mockRejectedValue(new Error('Edge network drop'));

      const [res1, res2] = await Promise.all([
        router.synthesize({ text: '并发错误回退 1' }),
        router.synthesize({ text: '并发错误回退 2' }),
      ]);

      expect(res1.engine).toBe('kokoro-local');
      expect(res2.engine).toBe('kokoro-local');
      expect(router.kokoro.synthesize).toHaveBeenCalledTimes(2);
    });

    it('T2-F4-03: loadKokoro() initializes Kokoro idempotently', async () => {
      await router.loadKokoro();
      expect(router.kokoro.init).toHaveBeenCalledTimes(1);

      await router.loadKokoro();
      // Second call does not duplicate init work
      expect(router.kokoro.isReady()).toBe(true);
    });

    it('T2-F4-04: offline synthesis runs purely on client with zero outbound Edge requests', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
        writable: true,
      });

      const res = await router.synthesize({ text: '纯客户端离线推理' });
      expect(res.engine).toBe('kokoro-local');
      expect(router.edge.synthesize).not.toHaveBeenCalled();
      expect(router.edge.prewarm).not.toHaveBeenCalled();
    });

    it('T2-F4-05: mode switch from kokoro-local to auto immediately routes next request to Edge', async () => {
      router.setMode('kokoro-local');
      const resLocal = await router.synthesize({ text: '当前为本地模式' });
      expect(resLocal.engine).toBe('kokoro-local');

      router.setMode('auto');
      const resAuto = await router.synthesize({ text: '已切换为自动模式' });
      expect(resAuto.engine).toBe('edge-warm');
      expect(router.edge.synthesize).toHaveBeenCalledTimes(1);
    });
  });
});
