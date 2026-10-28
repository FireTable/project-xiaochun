import type {
  LocalizedStoryBeat,
  LocalizedStoryChoice,
  LocalizedText,
  StoryBeat,
  StoryChoice,
  StoryLang,
} from './schema';
import { STORY_LANGS } from './schema';

/** 把任意语言标识归一到剧本支持的三种语言 (`en-US` → `en`，`zh`/`zh-TW` → `zh-CN`，未知 → zh-CN) */
export function normalizeStoryLang(raw: string | null | undefined): StoryLang {
  if (!raw) return 'zh-CN';
  if ((STORY_LANGS as readonly string[]).includes(raw)) return raw as StoryLang;
  const lower = raw.toLowerCase();
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('en')) return 'en';
  return 'zh-CN';
}

/**
 * 浏览器语言 → 剧本语言：zh* → zh-CN，ja* → ja，en* → en，其余一律回退 en
 * (和 normalizeStoryLang 不同：这里的“未知”是英文，而不是中文)。
 */
export function detectBrowserStoryLang(
  languages: readonly string[] | undefined = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : undefined,
): StoryLang {
  for (const raw of languages ?? []) {
    const l = (raw || '').toLowerCase();
    if (l.startsWith('zh')) return 'zh-CN';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

/** 取当前语言的文本；缺失回退 zh-CN，再回退空串。对象属性在这里才被读取，所以 getter 会在“进入该拍”时求值。 */
export function resolveLocalized(text: LocalizedText | undefined, lang: StoryLang): string {
  if (text === undefined || text === null) return '';
  if (typeof text === 'string') return text;
  return text[lang] ?? text['zh-CN'] ?? '';
}

function resolveOptional(text: LocalizedText | undefined, lang: StoryLang): string | undefined {
  return text === undefined ? undefined : resolveLocalized(text, lang);
}

export function resolveChoice(choice: LocalizedStoryChoice, lang: StoryLang): StoryChoice {
  return {
    ...choice,
    text: resolveLocalized(choice.text, lang),
    subText: resolveOptional(choice.subText, lang),
  };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 把本拍 `variants[branch]` 逐层合并到基础拍上 (对象字段浅合并，其余整体替换；不改动原对象) */
export function applyVariant(beat: LocalizedStoryBeat, branch: string | null | undefined): LocalizedStoryBeat {
  const v = branch ? beat.variants?.[branch] : undefined;
  if (!isPlainObject(v)) return beat;
  const out: Record<string, unknown> = { ...beat };
  for (const [k, val] of Object.entries(v)) {
    const base = (beat as Record<string, unknown>)[k];
    out[k] = isPlainObject(val) && isPlainObject(base) ? { ...base, ...val } : val;
  }
  return out as LocalizedStoryBeat;
}

/** 把一拍解析成单一语言 (不改动原对象；actionPayload / 函数原样保留) */
export function resolveBeat(beat: LocalizedStoryBeat, lang: StoryLang): StoryBeat {
  const cinematics = beat.cinematics
    ? {
        ...beat.cinematics,
        intertitle: beat.cinematics.intertitle
          ? { ...beat.cinematics.intertitle, text: resolveLocalized(beat.cinematics.intertitle.text, lang) }
          : undefined,
      }
    : undefined;
  return {
    ...beat,
    cinematics,
    actor: { ...beat.actor, speechText: resolveLocalized(beat.actor.speechText, lang) },
    choices: beat.choices?.map((c) => resolveChoice(c, lang)),
    confirmChoice: beat.confirmChoice ? resolveChoice(beat.confirmChoice, lang) : undefined,
    inputPlaceholder: resolveOptional(beat.inputPlaceholder, lang),
    hint: resolveOptional(beat.hint, lang),
  };
}
