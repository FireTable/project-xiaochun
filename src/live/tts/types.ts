/**
 * types.ts — Shared contracts for Layer 3 Bilingual TTS Subsystem (Warm Edge + Local Kokoro).
 */

export type LiveEmotionTag =
  | 'neutral'
  | 'happy'
  | 'angry'
  | 'sad'
  | 'relaxed'
  | 'surprised'
  | 'shy';

export type TtsEngineMode = 'edge-warm' | 'kokoro-local' | 'auto';

export type KokoroVoicePreset = 'blended' | 'zf_001' | 'zf_002' | 'af_maple';

export interface TtsSynthesisRequest {
  text: string;
  emotion?: LiveEmotionTag;
  languageHint?: 'zh' | 'en' | 'mixed';
  speed?: number;
  voicePreset?: string;
  signal?: AbortSignal;
}

export interface TtsAudioResult {
  pcm24k: Float32Array;
  sampleRate: 24000;
  durationMs: number;
  ttfaMs: number;
  engine: 'edge-warm' | 'kokoro-local';
  warmHit?: boolean;
}

export interface EdgeProsodyParams {
  voice: string;
  pitch: string;
  rate: string;
  volume: string;
}

export interface KokoroProsodyParams {
  speed: number;
  voicePreset: KokoroVoicePreset;
}

export interface AffectiveClause {
  seq: number;
  rawText: string;
  cleanText: string;
  emotion: LiveEmotionTag;
  inlineTags: string[];
  languageHint: 'zh' | 'en' | 'mixed';
  edgeProsody: EdgeProsodyParams;
  kokoroProsody: KokoroProsodyParams;
}
