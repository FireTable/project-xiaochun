import type { Lang } from '@/i18n';
import { APP_CONFIG } from '@/config';
import type { EntityProfile, MemoryTurn } from './types';

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

/**
 * ponytail: entities 拼到 system 末尾;对话历史拆到 messages 数组,
 * 不再跟 system 串成一块。system prompt 保持短,模型指令空间不被挤压。
 */
export function appendEntitiesToSystem(system: string, entities: EntityProfile, lang: Lang): string {
  const ent = formatEntities(entities, lang);
  return ent ? `${system}\n\n${ent}` : system;
}

/**
 * 把对话历史转成 messages 数组 — 标准的 ChatML 多轮对话格式。
 * ponytail: 对话历史从 system 拆出来之后,长度不再卡 system prompt 的字符预算;
 * 唯一需要的是把每条 turn 截到 turnMaxChars 防止单条太长刷屏。
 */
export function historyToMessages(recent: MemoryTurn[], lang: Lang): { role: 'user' | 'assistant'; content: string }[] {
  void lang;
  const max = APP_CONFIG.memory.turnMaxChars;
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of recent) {
    out.push({ role: 'user', content: clip(t.user, max) });
    out.push({ role: 'assistant', content: clip(t.assistant, max) });
  }
  return out;
}