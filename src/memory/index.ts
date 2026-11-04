import type { Lang } from '@/i18n';
import { getDeviceMemoryTurns } from '@/llm/deviceDetection';
import {
  createClientMemory,
  type ClientMemoryEngine,
  type RecallResult,
  type TurnRecord,
  type UserProfile,
} from '@firetable/client-memory';
import { appendEntitiesToSystem, historyToMessages } from './inject';
import type { EntityProfile, MemoryTurn, Recall } from './types';

export type { EntityProfile, MemoryTurn, Recall } from './types';
export { appendEntitiesToSystem, historyToMessages };

export interface ExtendedRecall extends Recall {
  rawResult?: RecallResult;
}

// Singleton instance of ClientMemoryEngine
let memoryInstance: ClientMemoryEngine | null = null;

export function getClientMemory(): ClientMemoryEngine {
  if (!memoryInstance) {
    memoryInstance = createClientMemory({
      dbName: 'client-memory-db',
    });
  }
  return memoryInstance;
}

function userProfileToEntityProfile(profile: UserProfile): EntityProfile {
  const likes: string[] = [];
  const dislikes: string[] = [];
  const facts: { k: string; v: string; ts: number }[] = [];

  for (const f of profile.facts) {
    if (f.category === 'preference') {
      if (f.key === 'like') likes.push(f.value);
      else if (f.key === 'dislike') dislikes.push(f.value);
    } else {
      facts.push({ k: f.key, v: f.value, ts: f.ts });
    }
  }

  return {
    name: profile.name,
    nickname: profile.nickname,
    likes,
    dislikes,
    facts,
  };
}

export async function recallForChat(userText: string, maxTurns?: number): Promise<ExtendedRecall> {
  const limit = typeof maxTurns === 'number' && maxTurns > 0 ? maxTurns : getDeviceMemoryTurns();
  const engine = getClientMemory();
  const result = await engine.recall(userText, { workingMemoryTurns: limit });

  const entities = userProfileToEntityProfile(result.profile);
  const recent: MemoryTurn[] = result.workingTurns.map((t: TurnRecord) => ({
    id: t.id,
    user: t.user,
    assistant: t.assistant,
    ts: t.ts,
  }));

  return {
    entities,
    recent,
    rawResult: result,
  };
}

// Tracks the exact user message content assembled for current turns (keyed by normalized user query).
// Storing this exact string into `turns` ensures that in subsequent turns, WebLLM's compareConversationObject
// matches oldConv.messages word-for-word, giving 100% KV Cache hits across multi-round chat!
// Using a query-keyed cache with TTL ensures that turn interrupts, TTS failures, or concurrency
// never cross-contaminate unrelated turns.
interface AssembledCacheEntry {
  assembled: string;
  ts: number;
}

const assembledUserContentMap = new Map<string, AssembledCacheEntry>();
const ASSEMBLED_TTL_MS = 60_000; // 60s conversational window

function pruneExpiredAssembledCache(): void {
  const now = Date.now();
  for (const [key, entry] of assembledUserContentMap.entries()) {
    if (now - entry.ts > ASSEMBLED_TTL_MS) {
      assembledUserContentMap.delete(key);
    }
  }
}

/**
 * Clear pending assembled user content.
 * If query is provided, clears only that specific query; otherwise clears all entries.
 */
export function clearAssembledUserContent(query?: string): void {
  if (query) {
    assembledUserContentMap.delete(query.trim());
  } else {
    assembledUserContentMap.clear();
  }
}

export async function rememberTurn(
  user: string,
  assistant: string,
  explicitAssembledUser?: string,
): Promise<void> {
  const engine = getClientMemory();
  pruneExpiredAssembledCache();

  let textToStore = user;
  if (explicitAssembledUser) {
    textToStore = explicitAssembledUser;
  } else {
    const key = user.trim();
    const cached = assembledUserContentMap.get(key);
    if (cached && Date.now() - cached.ts <= ASSEMBLED_TTL_MS) {
      textToStore = cached.assembled;
      assembledUserContentMap.delete(key); // Single-use consumption prevents reuse across turns
    }
  }

  await engine.remember({ user: textToStore, assistant });
}

export function applyRecall(
  systemPrompt: string,
  mem: ExtendedRecall,
  lang: Lang,
  userQuery?: string,
): {
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  currentUserContent?: string;
  recalledSummary?: string;
} {
  const engine = getClientMemory();

  // If rawResult is present and userQuery is provided, use the KV-Cache safe assembler
  if (mem.rawResult && typeof userQuery === 'string') {
    const assembled = engine.assemble({
      systemPrompt,
      userQuery,
      historyTurns: mem.rawResult.workingTurns,
      profile: mem.rawResult.profile,
      episodes: mem.rawResult.episodes,
      lorebookHits: mem.rawResult.lorebookHits,
      matchedFacts: mem.rawResult.matchedFacts,
      lang: lang as 'zh-CN' | 'en' | 'ja',
    });

    const historyOnly = assembled.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(0, -1) as { role: 'user' | 'assistant'; content: string }[];

    const currentMsg = assembled.messages[assembled.messages.length - 1];
    const finalContent = currentMsg?.content || userQuery;

    pruneExpiredAssembledCache();
    assembledUserContentMap.set(userQuery.trim(), {
      assembled: finalContent,
      ts: Date.now(),
    });

    return {
      system: assembled.systemPrompt,
      history: historyOnly,
      currentUserContent: finalContent,
      recalledSummary: assembled.recalledSummary,
    };
  }

  // Fallback for legacy calls without userQuery
  return {
    system: appendEntitiesToSystem(systemPrompt, mem.entities, lang),
    history: historyToMessages(mem.recent, lang),
  };
}
