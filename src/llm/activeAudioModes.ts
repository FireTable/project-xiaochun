/**
 * activeAudioModes.ts — 当前激活的 STT / TTS 模式与 Provider 选择。
 *
 * 遵循项目架构设计：
 * STT (语音识别):
 *   - 'builtin': 官方内置智能 (Cloudflare Whisper Turbo -> 本地 SenseVoice 兜底)
 *   - { kind: 'custom', providerId: string }: 用户自定义 (MiniMax / Groq -> 本地 SenseVoice 兜底)
 *   - 'local': 纯端侧离线 (本地 SenseVoice，零网络请求)
 *
 * TTS (语音合成):
 *   - 'builtin': 官方内置 (Edge-TTS / CF -> 失败时降级为 ttsUnavailable 胶囊)
 *   - { kind: 'custom', providerId: string }: 用户自定义 (OpenAI /v1/audio/speech 兼容服务)
 */

export type ActiveSttMode =
  | { kind: 'builtin' }
  | { kind: 'custom'; providerId: string }
  | { kind: 'local' };

export type ActiveTtsMode =
  | { kind: 'builtin' }
  | { kind: 'custom'; providerId: string };

export const STT_MODE_KEY = 'xiaochun.stt.mode';
export const TTS_MODE_KEY = 'xiaochun.tts.mode';

export function parseActiveSttMode(raw: string | null | undefined): ActiveSttMode {
  if (!raw || raw === 'builtin') return { kind: 'builtin' };
  if (raw === 'local') return { kind: 'local' };
  if (raw.startsWith('custom:')) {
    const providerId = raw.slice(7).trim();
    if (providerId) return { kind: 'custom', providerId };
  }
  return { kind: 'builtin' };
}

export function parseActiveTtsMode(raw: string | null | undefined): ActiveTtsMode {
  if (!raw || raw === 'builtin') return { kind: 'builtin' };
  if (raw.startsWith('custom:')) {
    const providerId = raw.slice(7).trim();
    if (providerId) return { kind: 'custom', providerId };
  }
  return { kind: 'builtin' };
}

export function readActiveSttMode(): ActiveSttMode {
  if (typeof window === 'undefined') return { kind: 'local' };
  try {
    return parseActiveSttMode(window.localStorage.getItem(STT_MODE_KEY));
  } catch {
    return { kind: 'builtin' };
  }
}

export function writeActiveSttMode(mode: ActiveSttMode): void {
  if (typeof window === 'undefined') return;
  try {
    const val = mode.kind === 'custom' ? `custom:${mode.providerId}` : mode.kind;
    window.localStorage.setItem(STT_MODE_KEY, val);
  } catch {
    /* noop */
  }
  notifySttListeners();
}

export function readActiveTtsMode(): ActiveTtsMode {
  if (typeof window === 'undefined') return { kind: 'builtin' };
  try {
    return parseActiveTtsMode(window.localStorage.getItem(TTS_MODE_KEY));
  } catch {
    return { kind: 'builtin' };
  }
}

export function writeActiveTtsMode(mode: ActiveTtsMode): void {
  if (typeof window === 'undefined') return;
  try {
    const val = mode.kind === 'custom' ? `custom:${mode.providerId}` : mode.kind;
    window.localStorage.setItem(TTS_MODE_KEY, val);
  } catch {
    /* noop */
  }
  notifyTtsListeners();
}

const sttListeners = new Set<(m: ActiveSttMode) => void>();
export function subscribeActiveSttMode(cb: (m: ActiveSttMode) => void): () => void {
  sttListeners.add(cb);
  return () => {
    sttListeners.delete(cb);
  };
}
function notifySttListeners(): void {
  const current = readActiveSttMode();
  sttListeners.forEach((cb) => {
    try {
      cb(current);
    } catch {
      /* noop */
    }
  });
}

const ttsListeners = new Set<(m: ActiveTtsMode) => void>();
export function subscribeActiveTtsMode(cb: (m: ActiveTtsMode) => void): () => void {
  ttsListeners.add(cb);
  return () => {
    ttsListeners.delete(cb);
  };
}
function notifyTtsListeners(): void {
  const current = readActiveTtsMode();
  ttsListeners.forEach((cb) => {
    try {
      cb(current);
    } catch {
      /* noop */
    }
  });
}
