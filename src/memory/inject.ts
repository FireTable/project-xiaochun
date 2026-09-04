import type { Lang } from '@/i18n';
import { APP_CONFIG } from '@/config';
import type { EntityProfile, LongNote, MemoryTurn, Recall } from './types';

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function formatEntities(e: EntityProfile, lang: Lang): string {
  const bits: string[] = [];
  if (e.nickname) bits.push(lang === 'en' ? `nickname ${e.nickname}` : lang === 'ja' ? `呼び名 ${e.nickname}` : `称呼 ${e.nickname}`);
  else if (e.name) bits.push(lang === 'en' ? `name ${e.name}` : lang === 'ja' ? `名前 ${e.name}` : `名叫 ${e.name}`);
  if (e.likes.length) bits.push(lang === 'en' ? `likes ${e.likes.join('、')}` : lang === 'ja' ? `好き ${e.likes.join('、')}` : `喜欢 ${e.likes.join('、')}`);
  if (e.dislikes.length) bits.push(lang === 'en' ? `dislikes ${e.dislikes.join('、')}` : lang === 'ja' ? `嫌い ${e.dislikes.join('、')}` : `不喜欢 ${e.dislikes.join('、')}`);
  for (const f of e.facts.slice(-6)) {
    if (f.k === 'name') continue;
    bits.push(`${f.k} ${f.v}`);
  }
  if (!bits.length) return '';
  if (lang === 'en') return `You remember them: ${bits.join('. ')}.`;
  if (lang === 'ja') return `相手について覚えていること：${bits.join('。')}。`;
  return `你还记得对方：${bits.join('。')}。`;
}

function gramScore(note: string, query: string): number {
  const q = query.toLowerCase();
  const n = note.toLowerCase();
  if (!q || !n) return 0;
  let hit = 0;
  const step = /[a-z0-9]/.test(q) ? 3 : 2;
  const seen = new Set<string>();
  for (let i = 0; i <= q.length - step; i++) {
    const g = q.slice(i, i + step);
    if (seen.has(g)) continue;
    seen.add(g);
    if (n.includes(g)) hit += 1;
  }
  return hit;
}

export function pickNotes(notes: LongNote[], query: string, k = APP_CONFIG.memory.longTermTopK): LongNote[] {
  if (!notes.length) return [];
  return [...notes]
    .map((note) => ({ note, s: gramScore(note.text, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.note.ts - a.note.ts)
    .slice(0, k)
    .map((x) => x.note);
}

export function appendMemoryToSystem(system: string, mem: Recall, lang: Lang): string {
  const max = APP_CONFIG.memory.turnMaxChars;
  const parts: string[] = [];
  const ent = formatEntities(mem.entities, lang);
  if (ent) parts.push(ent);
  if (mem.notes.length) {
    const lines = mem.notes.map((n) => clip(n.text, max));
    if (lang === 'en') parts.push(`Older bits you recall:\n- ${lines.join('\n- ')}`);
    else if (lang === 'ja') parts.push(`前に話したこと：\n- ${lines.join('\n- ')}`);
    else parts.push(`以前聊过的事：\n- ${lines.join('\n- ')}`);
  }
  if (!parts.length) return system;
  const rule =
    lang === 'en'
      ? 'These are things you remember. Answer their latest reply first.'
      : lang === 'ja'
        ? 'これは覚えていること。まずは最新の返信に乗る。'
        : '这些是你还记得的事。先接这次最新的回复。';
  return `${system}\n\n${rule}\n${parts.join('\n')}`;
}

export function historyMessages(recent: MemoryTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  const max = APP_CONFIG.memory.turnMaxChars;
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of recent) {
    out.push({ role: 'user', content: clip(t.user, max) });
    out.push({ role: 'assistant', content: clip(t.assistant, max) });
  }
  return out;
}
