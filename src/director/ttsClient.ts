/**
 * src/director/ttsClient.ts — 统一语音合成客户端（支持内置 Edge-TTS 与自定义 OpenAI /v1/audio/speech 服务）。
 *
 * 调度机制：
 * 1. 官方内置 (builtin)：向 /api/tts 发送请求，调用 Edge-TTS + R2 缓存；
 * 2. 用户自定义 (custom)：向自备 OpenAI 兼容接口 (${baseURL}/audio/speech) 发送标准请求，获取 MP3 音频流；
 * 3. 容错保障：若接口不可用，抛出带有详细状态码的错误，由 ChatDirector 统一捕获降级为 ttsUnavailable 胶囊。
 */

import { readActiveTtsMode, type ActiveTtsMode } from '../llm/activeAudioModes';
import { getProviderDecrypted } from '../llm/customProvider/store';

export interface TTSRequestOptions {
  text: string;
  voice: string;
  pitch: string;
  rate: string;
  volume: string;
  signal?: AbortSignal;
}

export async function requestTTSAudio(
  opts: TTSRequestOptions,
  mode?: ActiveTtsMode,
): Promise<Response> {
  const currentMode = mode ?? readActiveTtsMode();

  let res: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (currentMode.kind === 'builtin') {
        // 官方内置 Edge-TTS (经由 Cloudflare Worker /api/tts)
        res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: opts.text,
            voice: opts.voice,
            pitch: opts.pitch,
            rate: opts.rate,
            volume: opts.volume,
          }),
          signal: opts.signal,
        });
      } else if (currentMode.kind === 'custom') {
        // 用户自定义 OpenAI-compatible TTS: POST /v1/audio/speech
        const profile = await getProviderDecrypted(currentMode.providerId);
        if (!profile) {
          throw new Error(`Custom TTS provider ${currentMode.providerId} not found`);
        }

        const url = `${profile.baseURL.replace(/\/+$/, '')}/audio/speech`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (profile.apiKey) {
          headers['Authorization'] = `Bearer ${profile.apiKey}`;
        }

        const voice = profile.voice?.trim() || opts.voice || 'alloy';

        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: profile.model || 'tts-1',
            input: opts.text,
            voice,
            response_format: 'mp3',
          }),
          signal: opts.signal,
        });
      }

      if (res && res.ok && res.body) break;
    } catch (fetchErr) {
      lastError = fetchErr;
      if (attempt === 2) throw fetchErr;
    }

    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  if (!res || !res.ok) {
    throw new Error(
      `语音合成服务异常: HTTP ${res?.status ?? 'Unknown'}${
        lastError ? ` (${String((lastError as Error)?.message ?? lastError)})` : ''
      }`,
    );
  }
  if (!res.body) {
    throw new Error('语音合成响应无 body');
  }

  return res;
}
