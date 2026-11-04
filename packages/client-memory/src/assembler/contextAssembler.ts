import type { EpisodeRecord, LorebookEntry, TurnRecord, UserProfile } from '../types';

export interface ChatMessageItem {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AssembleContextOptions {
  systemPrompt: string;
  userQuery: string;
  historyTurns: TurnRecord[];
  profile?: UserProfile;
  episodes?: EpisodeRecord[];
  lorebookHits?: LorebookEntry[];
  matchedFacts?: import('../types').UserFact[];
  lang?: 'zh-CN' | 'en' | 'ja';
  turnMaxChars?: number;
}

function clipText(s: string, maxLen: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`;
}

/**
 * KV Cache Friendly Context Assembler.
 * - System Prompt remains static.
 * - History messages remain pure raw text.
 * - Recalls are packed into a strictly budgeted hint block (<= 80 chars) on current turn.
 */
export function assembleChatMessages(opts: AssembleContextOptions): {
  systemPrompt: string;
  messages: ChatMessageItem[];
  recalledSummary: string;
} {
  const maxTurnChars = opts.turnMaxChars ?? 140;
  const lang = opts.lang ?? 'zh-CN';

  // 1. Stable System Prompt: Append only stable identity if available
  let stableSystem = opts.systemPrompt.trim();
  if (opts.profile?.name) {
    const moniker =
      lang === 'en'
        ? `User's name is ${opts.profile.name}.`
        : lang === 'ja'
          ? `相手の名前は${opts.profile.name}です。`
          : `对方的名字是${opts.profile.name}。`;
    if (!stableSystem.includes(opts.profile.name)) {
      stableSystem = `${stableSystem}\n\n${moniker}`;
    }
  }

  // 2. Assemble pure history turns (No prompt debris!)
  const messages: ChatMessageItem[] = [{ role: 'system', content: stableSystem }];

  for (const t of opts.historyTurns) {
    messages.push({ role: 'user', content: clipText(t.user, maxTurnChars) });
    messages.push({ role: 'assistant', content: clipText(t.assistant, maxTurnChars) });
  }

  // 3. Compact hint block for current user message (<= 80 chars)
  const hints: string[] = [];

  // Matched Facts (preferences, pets, etc.)
  if (opts.matchedFacts && opts.matchedFacts.length > 0) {
    for (const f of opts.matchedFacts.slice(0, 2)) {
      hints.push(`对方${f.key === 'like' ? '喜欢' : f.key === 'dislike' ? '讨厌' : f.key}: ${f.value}`);
    }
  }

  // Top episode
  if (opts.episodes && opts.episodes.length > 0) {
    const topEp = opts.episodes[0];
    if (topEp.title) {
      hints.push(topEp.title.slice(0, 28));
    }
  }

  // Lorebook hit
  if (opts.lorebookHits && opts.lorebookHits.length > 0) {
    const topLore = opts.lorebookHits[0];
    if (topLore.content) {
      hints.push(topLore.content.slice(0, 45));
    }
  }

  const recalledSummary = hints.join('；');

  let currentUserContent = opts.userQuery.trim();
  if (hints.length > 0) {
    const hintHeader =
      lang === 'en'
        ? `[Memory Context: ${recalledSummary}]\n\n`
        : lang === 'ja'
          ? `[関連記憶: ${recalledSummary}]\n\n`
          : `[相关回忆/背景: ${recalledSummary}]\n\n`;
    currentUserContent = `${hintHeader}${currentUserContent}`;
  }

  messages.push({ role: 'user', content: currentUserContent });

  return {
    systemPrompt: stableSystem,
    messages,
    recalledSummary,
  };
}
