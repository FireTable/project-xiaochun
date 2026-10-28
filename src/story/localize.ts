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
  };
}
