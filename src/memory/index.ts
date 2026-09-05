import type { Lang } from '@/i18n';
import { getDeviceMemoryTurns } from '@/llm/deviceDetection';
import { extractEntities } from './extract';
import { appendEntitiesToSystem, historyToMessages } from './inject';
import { appendTurn, loadEntities, loadTurns, saveEntities } from './store';
import { emptyEntities, type Recall } from './types';

export type { EntityProfile, MemoryTurn, Recall } from './types';
export { appendEntitiesToSystem, historyToMessages };

export async function recallForChat(_userText: string, maxTurns?: number): Promise<Recall> {
  const limit = typeof maxTurns === 'number' && maxTurns > 0 ? maxTurns : getDeviceMemoryTurns();
  const [entities, recent] = await Promise.all([loadEntities(), loadTurns()]);
  return {
    entities,
    recent: recent.slice(-limit),
  };
}

export async function rememberTurn(user: string, assistant: string): Promise<void> {
  const ts = Date.now();
  const prev = await loadEntities().catch(() => emptyEntities());
  const next = extractEntities(user, prev);
  await Promise.all([appendTurn({ user, assistant, ts }), saveEntities(next)]);
}

/**
 * ponytail: 把 entities 拼到 system,对话历史单独返回 messages 数组。
 * 返回 { system, history } 让 LLM 走标准 ChatML 多轮结构:
  [{system}, {user}, {assistant}, ..., {user current}]
 */
export function applyRecall(systemPrompt: string, mem: Recall, lang: Lang): {
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
} {
  return {
    system: appendEntitiesToSystem(systemPrompt, mem.entities, lang),
    history: historyToMessages(mem.recent, lang),
  };
}