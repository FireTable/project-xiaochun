/**
 * providers/client.ts — OpenAI-compatible HTTP fetch + SSE 流式解析。
 *
 * ponytail: 不引入 ai-sdk,fetch + ReadableStream 解析 `data: {json}\n\n` 帧,
 * 流式产出 content delta。前端能直接 connect 的都是 OpenAI-compatible 服务,
 * Anthropic 等另算(暂时走同一 fetch,body 走 anthropic-specific 路径)。
 */

import type { ChatMessage, ProviderProfile } from './types';

export interface CompletionOptions {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionChunk {
  content: string;
  finishReason?: string;
}

/** 调用 baseURL + apiKey 探测可达性 + 拉模型列表(`GET /v1/models`)。 */
export async function probeProvider(baseURL: string, apiKey: string): Promise<{
  ok: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const url = `${baseURL.replace(/\/+$/, '')}/models`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    if (!resp.ok) {
      return { ok: false, models: [], error: `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    const ids = Array.isArray(data?.data)
      ? data.data.map((m: any) => String(m.id)).filter(Boolean)
      : Array.isArray(data)
        ? data.map((m: any) => String(m.id ?? m)).filter(Boolean)
        : [];
    return { ok: true, models: ids };
  } catch (err) {
    return { ok: false, models: [], error: String((err as Error)?.message ?? err) };
  }
}

/** ponytail: 一次性非流式调用,用于轻量测试 / fallback。 */
export async function completeOnce(
  profile: ProviderProfile,
  opts: CompletionOptions,
): Promise<string> {
  const url = `${profile.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 1024,
      stream: false,
    }),
    signal: opts.signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return String(data?.choices?.[0]?.message?.content ?? '');
}

/** 流式调用,产出 AsyncIterable<CompletionChunk>。 */
export async function* streamCompletion(
  profile: ProviderProfile,
  opts: CompletionOptions,
): AsyncGenerator<CompletionChunk, void, void> {
  const url = `${profile.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 1024,
      stream: true,
    }),
    signal: opts.signal,
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  // ponytail: SSE 帧以 \n\n 结束,每帧多行 `data: ...`,`[DONE]` 终止。
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content
            ?? json?.choices?.[0]?.message?.content
            ?? '';
          if (delta) yield { content: String(delta) };
          const finish = json?.choices?.[0]?.finish_reason;
          if (finish) yield { content: '', finishReason: String(finish) };
        } catch {
          // ponytail: 帧解析失败时丢掉这帧,常见于跨 chunk 切分
        }
      }
    }
  }
}