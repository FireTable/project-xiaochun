import type { FactCategory, UserFact } from '../types';

function clipInput(s: string, maxLen = 300): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen);
}

function cleanValue(v: string, maxLen = 30): string {
  const t = v.replace(/^(?:一只|一个|一条|只|条)\s*/, '').replace(/[，。,.!！？?~～\s]+$/, '').trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen);
}

export function extractFactsFromUserText(rawText: string, ts = Date.now()): UserFact[] {
  // Strip any leading memory prompt blocks to prevent re-extracting from injected hints
  const stripped = rawText.replace(/^\[(?:相关回忆|已知记忆|Memory Context|関連記憶)[^\]]*\]\s*/i, '');
  const text = clipInput(stripped);
  if (!text) return [];

  const facts: UserFact[] = [];
  const makeFact = (category: FactCategory, key: string, value: string, confidence = 4): UserFact => ({
    id: `f_${category}_${key}_${Math.random().toString(36).slice(2, 8)}`,
    category,
    key,
    value: cleanValue(value),
    confidence,
    ts,
  });

  // 1. Identity (Name, Nickname)
  const nameZh = text.match(/(?:我叫|叫我|你可以叫我|我的名字是)\s*([^\s，。,.!！？?]{1,12})/);
  if (nameZh?.[1]) {
    facts.push(makeFact('identity', 'name', nameZh[1], 5));
  }
  const nameEn = text.match(/(?:my name is|i(?:['’]m| am) called|call me)\s+([a-z][a-z\s-]{0,20})/i);
  if (nameEn?.[1]) {
    facts.push(makeFact('identity', 'name', nameEn[1], 5));
  }
  const nameJa = text.match(/(?:私は|僕は|俺は)\s*(.+?)(?:です|だよ|だ|と呼んで)/);
  if (nameJa?.[1] && nameJa[1].length <= 12) {
    facts.push(makeFact('identity', 'name', nameJa[1], 5));
  }

  // 2. Occupation & Role (Requires strong predicate to avoid false positives like "今天写程序")
  const jobZh = text.match(/(?:我(?:是|在做|做|目前是)|(?:我的职业|工作)是|(?:是一?名|是一?个))\s*([^\s，。,.!！？?]{2,16}(?:设计师|工程师|程序员|开发者|研究员|产品经理|架构师|分析师|学生|医生|老师|教师|律师|翻译|作家|主播|店长))/);
  if (jobZh?.[1]) {
    facts.push(makeFact('occupation', 'occupation', jobZh[1], 4));
  }
  const jobEn = text.match(/(?:i(?:['’]m| am) a|i work as a)\s+([a-z][a-z\s-]{2,24})/i);
  if (jobEn?.[1]) {
    facts.push(makeFact('occupation', 'occupation', jobEn[1], 4));
  }

  // 3. Location / Residence
  const locZh = text.match(/(?:(?:我家在|我住在|住在|定居在|我搬去|我搬到了|搬到了|我人在))\s*([^\s，。,.!！？?]{2,16})/);
  if (locZh?.[1]) {
    facts.push(makeFact('identity', 'location', locZh[1], 5));
  }
  const locEn = text.match(/(?:i live in|i moved to)\s+([a-z][a-z\s-]{2,20})/i);
  if (locEn?.[1]) {
    facts.push(makeFact('identity', 'location', locEn[1], 5));
  }

  // 4. Pets & Companions
  const petZh = text.match(/(?:(?:我养了|养了|我家里有只|家里养了)(?:一只|一个|条)?)\s*([^\s，。,.!！？?]{1,10}(?:猫|狗|柯基|柴犬|金毛|猫咪|修狗|鹦鹉|仓鼠|小鸟|兔子))/);
  if (petZh?.[1]) {
    facts.push(makeFact('relationship', 'pet', petZh[1], 4));
  }

  // 5. Strong Preferences (Likes & Dislikes - Avoid "可爱", "爱心" false positives)
  const likeZh = text.match(/(?:我(?:非常|超级|特别|很|最|平时)?(?:喜欢|喜好|爱|好爱)|(?:非常|超级|特别|最)?喜欢)\s*([^，,。！？!\n]{1,24})/);
  if (likeZh?.[1] && !likeZh[1].startsWith('你') && !likeZh[1].startsWith('小蠢') && !likeZh[1].startsWith('小春')) {
    facts.push(makeFact('preference', 'like', likeZh[1], 4));
  }
  const dislikeZh = text.match(/(?:(?:我)?(?:非常|特别|平时)?(?:不喜欢|讨厌|最讨厌|最烦|最不喜欢|受不了))\s*([^，,。！？!\n]{1,24})/);
  if (dislikeZh?.[1]) {
    facts.push(makeFact('preference', 'dislike', dislikeZh[1], 4));
  }
  const likeEn = text.match(/(?:i (?:really |super )?like|i love)\s+([^,.!?\n]{1,24})/i);
  if (likeEn?.[1]) {
    facts.push(makeFact('preference', 'like', likeEn[1], 4));
  }
  const dislikeEn = text.match(/(?:i (?:don['’]t|do not) like|i hate)\s+([^,.!?\n]{1,24})/i);
  if (dislikeEn?.[1]) {
    facts.push(makeFact('preference', 'dislike', dislikeEn[1], 4));
  }

  // 6. Emotion / Health
  const healthZh = text.match(/(?:我最近(?:总|一直)?|我今天|最近)?(?:总|经常)?\s*(失眠|头疼|感冒|发烧|好累|好疲惫|压力好大|好焦虑|心情不好|心情特别好)/);
  if (healthZh?.[1]) {
    facts.push(makeFact('health', 'recent_state', healthZh[1], 3));
  }

  // 7. Plans & Appointments
  const planZh = text.match(/(?:明天|周末|下周|下个月|过几天)(?:我要|打算|准备去|计划)\s*([^。！？!\n]{2,24})/);
  if (planZh?.[1]) {
    facts.push(makeFact('promise', 'upcoming_plan', planZh[0], 4));
  }

  return facts;
}
