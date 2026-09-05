/**
 * providers/index.ts — provider 模块入口 + 一键探测常用本地服务。
 *
 * ponytail: UI 上"一键填写部署"按 KNOWN_TEMPLATES 并行探测每个 endpoint,
 * 第一个 200 命中就拿它的 baseURL + 自动拉模型列表,用户确认即可保存。
 */

import { probeProvider, streamCompletion, completeOnce } from './client';
import type { CompletionChunk, CompletionOptions } from './client';
import { deleteProvider, getActiveProvider, getActiveProviderId, getDecryptedApiKey, getProvider, listProviders, saveProvider, setActiveProviderId } from './store';
import type { ChatMessage, ProviderProfile, ProviderTemplate } from './types';
import { KNOWN_TEMPLATES } from './types';

export type { ChatMessage, CompletionChunk, CompletionOptions, ProviderProfile, ProviderTemplate };
export { KNOWN_TEMPLATES };
export { listProviders, getProvider, getActiveProvider, getActiveProviderId, setActiveProviderId, saveProvider, deleteProvider, probeProvider, streamCompletion, completeOnce, getDecryptedApiKey };

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

/** 一键探测所有已知本地服务,只读 GET /models,失败/超时都计入。 */
export async function probeAllKnownTemplates(apiKey = ''): Promise<ProbeResult[]> {
  return Promise.all(
    KNOWN_TEMPLATES.map(async (tpl): Promise<ProbeResult> => {
      const start = performance.now();
      // ponytail: 探测用短超时,不要阻塞 UI。
      const res = await Promise.race([
        probeProvider(tpl.defaultBaseURL, apiKey),
        new Promise<{ ok: false; models: never[]; error: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, models: [] as never[], error: 'timeout' }), 1500)
        ),
      ]);
      const ms = Math.round(performance.now() - start);
      if (res.ok) return { template: tpl, ok: true, models: res.models, ms };
      return { template: tpl, ok: false, error: res.error ?? 'unknown', ms };
    })
  );
}