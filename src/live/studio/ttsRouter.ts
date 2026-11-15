/**
 * ttsRouter.ts — Unified TTS dispatcher for Live Studio (`WarmEdgeTtsClient` + `KokoroTtsClient`).
 * Supports `edge-warm`, `kokoro-local`, and `auto` fallback selection without blocking barge-in aborts.
 */

import { APP_CONFIG } from '@/config';
import { WarmEdgeTtsClient } from '@/live/tts/warmEdgeTtsClient';
import { KokoroTtsClient } from '@/live/tts/kokoroTtsClient';
import { detectLanguageHint, resolveEdgeVoiceForLanguage } from '@/live/tts/affectiveClauseSlicer';
import type { TtsAudioResult, TtsEngineMode, TtsSynthesisRequest } from '@/live/tts/types';

export const DEFAULT_ONLINE_VOICE =
  APP_CONFIG.tts?.voices?.['zh-CN']?.voice ?? 'zh-CN-XiaoyiNeural';

export class StudioTtsRouter {
  public readonly edge: WarmEdgeTtsClient;
  public readonly kokoro: KokoroTtsClient;
  private mode: TtsEngineMode = 'auto';

  constructor() {
    this.edge = new WarmEdgeTtsClient();
    this.kokoro = new KokoroTtsClient();
  }

  getMode(): TtsEngineMode {
    return this.mode;
  }

  setMode(mode: TtsEngineMode): void {
    this.mode = mode;
  }

  async warmEdge(): Promise<{ ok: boolean; warmSockets: number }> {
    return this.edge.prewarm();
  }

  async loadKokoro(): Promise<void> {
    await this.kokoro.init();
  }

  /**
   * Warmup selected TTS engines.
   * In 'auto' or 'edge-warm' mode: only prewarms Edge-TTS; Kokoro is strictly lazy-loaded.
   * In 'kokoro-local' mode: eagerly warms Kokoro.
   */
  async warmupSelected(): Promise<{ edgeOk: boolean; kokoroReady: boolean }> {
    const [edgeRes, kokoroOk] = await Promise.all([
      this.edge.prewarm().catch(() => ({ ok: false, warmSockets: 0 })),
      this.mode === 'kokoro-local'
        ? this.kokoro.init().then(() => true).catch(() => false)
        : Promise.resolve(this.kokoro.isReady()),
    ]);
    return { edgeOk: edgeRes.ok, kokoroReady: kokoroOk };
  }

  async synthesize(req: TtsSynthesisRequest): Promise<TtsAudioResult> {
    const langHint = req.languageHint ?? detectLanguageHint(req.text);
    const defaultVoice = /[\u3040-\u309F\u30A0-\u30FF]/.test(req.text)
      ? resolveEdgeVoiceForLanguage('ja', req.text)
      : DEFAULT_ONLINE_VOICE;
    const enriched: TtsSynthesisRequest = {
      ...req,
      languageHint: langHint,
      voicePreset: req.voicePreset ?? defaultVoice,
    };

    if (this.mode === 'kokoro-local') {
      return this.kokoro.synthesize(enriched);
    }

    if (this.mode === 'edge-warm') {
      return this.edge.synthesize(enriched);
    }

    // Auto mode: consistently route ALL online utterances (ZH, EN, mixed)
    // to Warm Edge-TTS for uniform ~320ms latency and single voice persona (zh-CN-XiaoyiNeural).
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!online) {
      return this.kokoro.synthesize(enriched);
    }

    try {
      return await this.edge.synthesize(enriched);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      return await this.kokoro.synthesize(enriched);
    }
  }

  dispose(): void {
    this.edge.dispose();
    this.kokoro.dispose();
  }
}
