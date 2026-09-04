import type { EntityProfile } from './types';

function clipItem(s: string, n = 24): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n);
}

function uniqPush(list: string[], item: string, cap = 8): string[] {
  const v = clipItem(item);
  if (!v) return list;
  if (list.some((x) => x === v)) return list;
  return [...list, v].slice(-cap);
}

/** 从用户这句话里抠名字/喜好。吃不准就不动,留给长期笔记。 */
export function extractEntities(user: string, prev: EntityProfile): EntityProfile {
  const next: EntityProfile = {
    name: prev.name,
    nickname: prev.nickname,
    likes: [...prev.likes],
    dislikes: [...prev.dislikes],
    facts: [...prev.facts],
  };
  const ts = Date.now();

  const nameZh = user.match(/(?:我叫|叫我)\s*([^\s，。,.!！？?]{1,12})/);
  if (nameZh?.[1]) next.name = clipItem(nameZh[1], 12);

  const nickZh = user.match(/叫我\s*([^\s，。,.!！？?]{1,12})/);
  if (nickZh?.[1]) next.nickname = clipItem(nickZh[1], 12);

  const nameEn = user.match(/(?:my name is|i(?:['’]m| am))\s+([a-z][a-z\s-]{0,20})/i);
  if (nameEn?.[1]) next.name = clipItem(nameEn[1], 20);

  const nickEn = user.match(/call me\s+([a-z][a-z\s-]{0,20})/i);
  if (nickEn?.[1]) next.nickname = clipItem(nickEn[1], 20);

  const nameJa = user.match(/(?:私は|僕は|俺は)\s*(.+?)(?:です|だよ|だ)/);
  if (nameJa?.[1] && nameJa[1].length <= 12) next.name = clipItem(nameJa[1], 12);

  const likeZh = user.match(/我喜欢\s*([^。！？\n]{1,20})/);
  if (likeZh?.[1]) next.likes = uniqPush(next.likes, likeZh[1]);

  const dislikeZh = user.match(/我不喜欢\s*([^。！？\n]{1,20})/);
  if (dislikeZh?.[1]) next.dislikes = uniqPush(next.dislikes, dislikeZh[1]);

  const likeEn = user.match(/i like\s+([^,.!?\n]{1,24})/i);
  if (likeEn?.[1]) next.likes = uniqPush(next.likes, likeEn[1]);

  const dislikeEn = user.match(/i (?:don['’]t|do not) like\s+([^,.!?\n]{1,24})/i);
  if (dislikeEn?.[1]) next.dislikes = uniqPush(next.dislikes, dislikeEn[1]);

  if (next.name && next.name !== prev.name) {
    next.facts = [
      ...next.facts.filter((f) => f.k !== 'name'),
      { k: 'name', v: next.name, ts },
    ].slice(-16);
  }

  return next;
}
