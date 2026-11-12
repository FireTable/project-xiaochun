/**
 * customProvider/speech.ts — 自定义 OpenAI 兼容 HTTP provider 的 runChat。
 *
 * ponytail: provider 唯一对外方法 — 拿 messages + opts → 返 raw 字符串。
 * 跟 webLLMProvider.runChat 同形,chatWorkflow 用同一段代码调度两者。
 */

import { getActiveProvider } from './store';
import { completeOnce as customCompleteOnce } from './client';
import type { ChatMessage } from './types';
import type { ChatProvider, RunChatOptions } from '../chatTypes';

export async function runChat(opts: RunChatOptions): Promise<string> {
  const profile = await getActiveProvider();
  if (!profile) {
    throw new Error('active custom provider not found');
  }
  const messages: ChatMessage[] = opts.messages;
  return customCompleteOnce(profile, {
    model: profile.model,
    messages,
    temperature: 0.8,
    maxTokens: opts.maxTokens,
    thinking: opts.thinking,
  });
}

/** ponytail: 跟 webllmChatProvider 完全同形 — 仅当 `custom:*` 在存储中真实存在且可解密时命中，否则自愈回退 WebLLM。 */
export const customChatProvider: ChatProvider = {
  isActive: async () => (await getActiveProvider()) !== null,
  runChat,
};

