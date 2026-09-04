import { APP_CONFIG } from '@/config';
import type { Lang } from '@/i18n';
import { extractEntities } from './extract';
import { appendMemoryToSystem, historyAsUserPrompt, pickNotes } from './inject';
import { appendNote, appendTurn, loadEntities, loadNotes, loadTurns, saveEntities } from './store';
import { emptyEntities, type Recall } from './types';

export type { EntityProfile, LongNote, MemoryTurn, Recall } from './types';
export { appendMemoryToSystem, historyAsUserPrompt };

function clipNote(user: string, assistant: string): string {
  const max = APP_CONFIG.memory.turnMaxChars;
  const u = user.replace(/\s+/g, ' ').trim();
  const a = assistant.replace(/\s+/g, ' ').trim();
  const left = u.length <= max ? u : `${u.slice(0, max)}…`;
  const right = a.length <= 80 ? a : `${a.slice(0, 80)}…`;
  return `${left} → ${right}`;
}

export async function recallForChat(userText: string): Promise<Recall> {
  const [entities, recent, notes] = await Promise.all([
    loadEntities(),
    loadTurns(),
    loadNotes(),
  ]);
  return {
    entities,
    recent: recent.slice(-APP_CONFIG.memory.shortTermTurns),
    notes: pickNotes(notes, userText),
  };
}

export async function rememberTurn(user: string, assistant: string): Promise<void> {
  const ts = Date.now();
  const prev = await loadEntities().catch(() => emptyEntities());
  const next = extractEntities(user, prev);
  await Promise.all([
    appendTurn({ user, assistant, ts }),
    saveEntities(next),
    appendNote({ text: clipNote(user, assistant), ts }),
  ]);
}

export function applyRecall(systemPrompt: string, mem: Recall, lang: Lang) {
  // ponytail: 历史压成单条 user 消息的 prefix,拼到当前 user 输入前 — 根治 2B 模型复读。
  return {
    system: appendMemoryToSystem(systemPrompt, mem, lang),
    historyPrefix: historyAsUserPrompt(mem.recent, lang),
  };
}
