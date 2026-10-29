/**
 * providers/index.ts — provider 模块入口 + 一键探测常用服务（支持多模态）。
 *
 * ponytail: UI 上"一键填写部署"按 templates 并行探测每个 endpoint，
 * 第一个 200 命中就拿它的 baseURL + 自动拉模型列表，用户确认即可保存。
 */

import { probeProvider, streamCompletion } from './client';
import type { CompletionChunk, CompletionOptions } from './client';
import {
  deleteProvider,
  getActiveProvider,
  getActiveProviderId,
  getDecryptedApiKey,
  getProvider,
  getProviderDecrypted,
  listProviders,
  listProvidersDecrypted,
  saveProvider,
  setActiveProviderId,
  subscribeProvidersChange,
} from './store';
import type { ChatMessage, ProviderProfile, ProviderTemplate, ProviderType } from './types';
import {
  KNOWN_TEMPLATES,
  KNOWN_LLM_TEMPLATES,
  KNOWN_STT_TEMPLATES,
  KNOWN_TTS_TEMPLATES,
} from './types';

export type { ChatMessage, CompletionChunk, CompletionOptions, ProviderProfile, ProviderTemplate, ProviderType };
export {
  KNOWN_TEMPLATES,
  KNOWN_LLM_TEMPLATES,
  KNOWN_STT_TEMPLATES,
  KNOWN_TTS_TEMPLATES,
};
export {
  listProviders,
  listProvidersDecrypted,
  getProvider,
  getProviderDecrypted,
  getActiveProvider,
  getActiveProviderId,
  setActiveProviderId,
  saveProvider,
  deleteProvider,
  probeProvider,
  streamCompletion,
  getDecryptedApiKey,
  subscribeProvidersChange,
};

export {
  type ActiveSttMode,
  type ActiveTtsMode,
  type SttStrategy,
  STT_STRATEGY_KEY,
  readSttStrategy,
  writeSttStrategy,
  readActiveSttMode,
  writeActiveSttMode,
  subscribeActiveSttMode,
  readActiveTtsMode,
  writeActiveTtsMode,
  subscribeActiveTtsMode,
} from '../activeAudioModes';

export { runChat, customChatProvider } from './speech';

export interface ProbeHit {
  template: ProviderTemplate;
  ok: true;
  models: string[];
  ms: number;
}

export interface ProbeMiss {
  template: ProviderTemplate;
  ok: false;
  error: string;
  ms: number;
}

export type ProbeResult = ProbeHit | ProbeMiss;

/** 一键探测所有已知服务模板，只读 GET /models，失败/超时都计入。可传入指定模态模板。 */
export async function probeAllKnownTemplates(
  apiKey = '',
  templates: ProviderTemplate[] = KNOWN_LLM_TEMPLATES,
): Promise<ProbeResult[]> {
  return Promise.all(
    templates.map(async (tpl): Promise<ProbeResult> => {
      const start = performance.now();
      const res = await Promise.race([
        probeProvider(tpl.defaultBaseURL, apiKey),
        new Promise<{ ok: false; models: never[]; error: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, models: [] as never[], error: 'timeout' }), 1500),
        ),
      ]);
      const ms = Math.round(performance.now() - start);
      if (res.ok) return { template: tpl, ok: true, models: res.models, ms };
      return { template: tpl, ok: false, error: res.error ?? 'unknown', ms };
    }),
  );
}
