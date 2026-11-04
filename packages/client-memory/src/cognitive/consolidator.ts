import type { EpisodeRecord, TurnRecord } from '../types';
import { tokenize } from '../search/tokenizer';

function cleanTurnUserText(raw: string): string {
  return raw.replace(/^\[(?:相关回忆|已知记忆|Memory Context|関連記憶)[^\]]*\]\s*/i, '').trim();
}

export function consolidateTurnsToEpisode(turns: TurnRecord[]): { episode: EpisodeRecord; turnIds: number[] } | null {
  if (turns.length === 0) return null;

  const validTurns = turns.filter((t) => t.id != null);
  if (validTurns.length === 0) return null;

  const turnIds = validTurns.map((t) => t.id as number);
  const latestTs = Math.max(...validTurns.map((t) => t.ts));

  // Extract frequent meaningful entities from clean user & assistant turns
  const entityFreq = new Map<string, number>();
  for (const t of validTurns) {
    const cleanUser = cleanTurnUserText(t.user);
    const tokens = tokenize(`${cleanUser} ${t.assistant}`);
    for (const token of tokens) {
      if (token.length >= 2) {
        entityFreq.set(token, (entityFreq.get(token) ?? 0) + 1);
      }
    }
  }

  // Top entities by frequency
  const topEntities = Array.from(entityFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([e]) => e);

  // Generate concise episode title & summary
  const cleanFirstUser = cleanTurnUserText(validTurns[0].user).replace(/\s+/g, ' ').slice(0, 30);
  const title = topEntities.length > 0 ? `关于 ${topEntities.slice(0, 3).join('、')} 的倾谈` : `日常对白: ${cleanFirstUser}`;

  const summary =
    validTurns.length === 1
      ? `用户说: "${cleanTurnUserText(validTurns[0].user).slice(0, 50)}"，小蠢回应了对方。`
      : `围绕 ${topEntities.slice(0, 4).join('、')} 进行了 ${validTurns.length} 轮互动，交流了相关日常与想法。`;

  const episode: EpisodeRecord = {
    id: `ep_${latestTs}_${Math.random().toString(36).slice(2, 6)}`,
    ts: latestTs,
    title,
    summary,
    entities: topEntities,
    importance: Math.min(8, Math.max(3, topEntities.length + 2)),
    lastRecalledAt: 0,
    recallCount: 0,
  };

  return { episode, turnIds };
}
