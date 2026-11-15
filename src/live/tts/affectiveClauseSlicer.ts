/**
 * affectiveClauseSlicer.ts — Bilingual ZH/EN streaming clause buffer & affective prosody mapper.
 *
 * Responsibilities:
 *  - Buffers streamed LLM text and splits into speakable 20~55 char clauses (or earlier on strong
 *    sentence-end punctuation breaks without splitting inside English words or decimal numbers).
 *  - Extracts inline affective tags: [happy], [laugh], [sigh], [shy], [surprised], [angry], [sad],
 *    [relaxed], [neutral] (plus aliases), removing them cleanly from spoken text while emitting
 *    `emotion` for 3D avatar expression sync.
 *  - Maps `emotion` into:
 *      (a) Edge-TTS `<prosody pitch="..." rate="..." volume="...">` parameters (NEVER `<mstts:express-as>`);
 *      (b) Local Kokoro speed & voice preset tweaks.
 */

import { APP_CONFIG } from '@/config';
import type {
  AffectiveClause,
  EdgeProsodyParams,
  KokoroProsodyParams,
  KokoroVoicePreset,
  LiveEmotionTag,
} from './types';

export interface EmotionProsodyProfile {
  emotion: LiveEmotionTag;
  pitch: string;
  rate: string;
  volume: string;
  kokoroSpeed: number;
  kokoroVoice: KokoroVoicePreset;
}

const INLINE_TAG_ALIASES: Record<string, { emotion: LiveEmotionTag; profileKey: string }> = {
  neutral: { emotion: 'neutral', profileKey: 'neutral' },
  happy: { emotion: 'happy', profileKey: 'happy' },
  cheerful: { emotion: 'happy', profileKey: 'happy' },
  excited: { emotion: 'happy', profileKey: 'happy' },
  laugh: { emotion: 'happy', profileKey: 'laugh' },
  giggle: { emotion: 'happy', profileKey: 'laugh' },
  chuckle: { emotion: 'happy', profileKey: 'laugh' },
  sigh: { emotion: 'relaxed', profileKey: 'sigh' },
  relaxed: { emotion: 'relaxed', profileKey: 'relaxed' },
  calm: { emotion: 'relaxed', profileKey: 'relaxed' },
  soft: { emotion: 'relaxed', profileKey: 'relaxed' },
  shy: { emotion: 'shy', profileKey: 'shy' },
  blush: { emotion: 'shy', profileKey: 'shy' },
  embarrassed: { emotion: 'shy', profileKey: 'shy' },
  surprised: { emotion: 'surprised', profileKey: 'surprised' },
  gasp: { emotion: 'surprised', profileKey: 'surprised' },
  wow: { emotion: 'surprised', profileKey: 'surprised' },
  angry: { emotion: 'angry', profileKey: 'angry' },
  annoyed: { emotion: 'angry', profileKey: 'angry' },
  mad: { emotion: 'angry', profileKey: 'angry' },
  sad: { emotion: 'sad', profileKey: 'sad' },
  cry: { emotion: 'sad', profileKey: 'sad' },
  sorry: { emotion: 'sad', profileKey: 'sad' },
};

const PROSODY_PROFILES: Record<string, EmotionProsodyProfile> = {
  neutral: {
    emotion: 'neutral',
    pitch: '+10Hz',
    rate: '+0%',
    volume: '+0%',
    kokoroSpeed: 1.0,
    kokoroVoice: 'blended',
  },
  happy: {
    emotion: 'happy',
    pitch: '+18Hz',
    rate: '+8%',
    volume: '+5%',
    kokoroSpeed: 1.07,
    kokoroVoice: 'blended',
  },
  laugh: {
    emotion: 'happy',
    pitch: '+22Hz',
    rate: '+10%',
    volume: '+6%',
    kokoroSpeed: 1.1,
    kokoroVoice: 'blended',
  },
  sigh: {
    emotion: 'relaxed',
    pitch: '+2Hz',
    rate: '-8%',
    volume: '-4%',
    kokoroSpeed: 0.93,
    kokoroVoice: 'zf_001',
  },
  relaxed: {
    emotion: 'relaxed',
    pitch: '+4Hz',
    rate: '-5%',
    volume: '-2%',
    kokoroSpeed: 0.95,
    kokoroVoice: 'zf_001',
  },
  shy: {
    emotion: 'shy',
    pitch: '+14Hz',
    rate: '-4%',
    volume: '-6%',
    kokoroSpeed: 0.95,
    kokoroVoice: 'blended',
  },
  surprised: {
    emotion: 'surprised',
    pitch: '+24Hz',
    rate: '+10%',
    volume: '+8%',
    kokoroSpeed: 1.08,
    kokoroVoice: 'blended',
  },
  angry: {
    emotion: 'angry',
    pitch: '-6Hz',
    rate: '+10%',
    volume: '+10%',
    kokoroSpeed: 1.08,
    kokoroVoice: 'zf_002',
  },
  sad: {
    emotion: 'sad',
    pitch: '-8Hz',
    rate: '-10%',
    volume: '-8%',
    kokoroSpeed: 0.9,
    kokoroVoice: 'zf_001',
  },
};

const INLINE_AFFECT_TAG_RE =
  /\[(neutral|happy|cheerful|excited|laugh|giggle|chuckle|sigh|relaxed|calm|soft|shy|blush|embarrassed|surprised|gasp|wow|angry|annoyed|mad|sad|cry|sorry)\]/gi;
const DELEGATE_TAG_RE = /<delegate\b[^>]*>[\s\S]*?<\/delegate>|<delegate\b[^>]*\/?>/gi;

export function detectLanguageHint(text: string): 'zh' | 'en' | 'mixed' {
  const hasZh = /[\u4E00-\u9FFF]/.test(text);
  const hasEn = /[A-Za-z]/.test(text);
  if (hasZh && hasEn) return 'mixed';
  if (hasEn) return 'en';
  return 'zh';
}

export function resolveEdgeVoiceForLanguage(
  languageHint?: 'zh' | 'en' | 'mixed' | 'ja',
  text?: string,
): string {
  const voices = APP_CONFIG.tts?.voices;
  if (languageHint === 'ja' || (text && /[\u3040-\u309F\u30A0-\u30FF]/.test(text))) {
    return voices?.ja?.voice ?? 'ja-JP-NanamiNeural';
  }
  if (languageHint === 'en') {
    return voices?.en?.voice ?? 'zh-CN-XiaoyiNeural';
  }
  return voices?.['zh-CN']?.voice ?? 'zh-CN-XiaoyiNeural';
}

export function mapEmotionToProsody(
  emotionOrTag: LiveEmotionTag | string,
  languageHint: 'zh' | 'en' | 'mixed' = 'zh',
): { emotion: LiveEmotionTag; edgeProsody: EdgeProsodyParams; kokoroProsody: KokoroProsodyParams } {
  const key = emotionOrTag.toLowerCase().replace(/^\[|\]$/g, '');
  const mappedKey = INLINE_TAG_ALIASES[key]?.profileKey ?? (key in PROSODY_PROFILES ? key : 'neutral');
  const profile = PROSODY_PROFILES[mappedKey] ?? PROSODY_PROFILES.neutral!;

  return {
    emotion: profile.emotion,
    edgeProsody: {
      voice: resolveEdgeVoiceForLanguage(languageHint),
      pitch: profile.pitch,
      rate: profile.rate,
      volume: profile.volume,
    },
    kokoroProsody: {
      speed: profile.kokoroSpeed,
      voicePreset: profile.kokoroVoice,
    },
  };
}

export function stripAffectiveTags(raw: string): {
  cleanText: string;
  emotion: LiveEmotionTag;
  profileKey: string;
  inlineTags: string[];
} {
  const inlineTags: string[] = [];
  let emotion: LiveEmotionTag = 'neutral';
  let profileKey = 'neutral';

  let withoutDelegate = raw.replace(DELEGATE_TAG_RE, ' ');
  INLINE_AFFECT_TAG_RE.lastIndex = 0;
  withoutDelegate = withoutDelegate.replace(INLINE_AFFECT_TAG_RE, (_full, tagName: string) => {
    const normalized = tagName.toLowerCase();
    inlineTags.push(normalized);
    const alias = INLINE_TAG_ALIASES[normalized];
    if (alias) {
      emotion = alias.emotion;
      profileKey = alias.profileKey;
    }
    return ' ';
  });

  const cleanText = withoutDelegate
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/⌘/g, 'Command')
    .replace(/([~～])(?=[^\s，。！？、,!?….\n\r])/g, '$1，')
    .replace(/\s+/g, ' ')
    .replace(/([，。！？；：])\s+(?=[\u4E00-\u9FFF])/g, '$1')
    .trim();

  return { cleanText, emotion, profileKey, inlineTags };
}

export interface AffectiveClauseSlicerOptions {
  minClauseChars?: number;
  maxClauseChars?: number;
  strongBreakMinChars?: number;
}

/** Counts visible spoken characters ignoring inline affective tags. */
function estimateSpokenLength(raw: string): number {
  return raw
    .replace(DELEGATE_TAG_RE, '')
    .replace(INLINE_AFFECT_TAG_RE, '')
    .trim().length;
}

/** True when buffer ends with an unfinished `[tag` or `<delegate...` token. */
function hasIncompleteTrailingTag(buf: string): boolean {
  const lastOpenBracket = buf.lastIndexOf('[');
  const lastCloseBracket = buf.lastIndexOf(']');
  if (lastOpenBracket > lastCloseBracket && buf.length - lastOpenBracket <= 24) {
    return true;
  }
  const lastOpenAngle = buf.lastIndexOf('<');
  const lastCloseAngle = buf.lastIndexOf('>');
  if (lastOpenAngle > lastCloseAngle && buf.length - lastOpenAngle <= 180) {
    return true;
  }
  return false;
}

function isSentencePeriodAt(text: string, dotIdx: number): boolean {
  const prev = dotIdx > 0 ? text[dotIdx - 1]! : '';
  const next = dotIdx + 1 < text.length ? text[dotIdx + 1]! : '';
  // Do not split inside decimal numbers or version strings (e.g., 1.1, 3.14)
  if (/\d/.test(prev) && /\d/.test(next)) return false;
  // Do not split inside acronyms like e.g. or U.S.
  if (/[A-Za-z]/.test(prev) && /[A-Za-z0-9]/.test(next)) return false;
  return next === '' || /[\s"'”’)\]]/.test(next);
}

export class AffectiveClauseSlicer {
  private readonly minClauseChars: number;
  private readonly maxClauseChars: number;
  private readonly strongBreakMinChars: number;
  private buffer = '';
  private seq = 0;
  private stickyProfileKey = 'neutral';

  constructor(options: AffectiveClauseSlicerOptions = {}) {
    this.minClauseChars = Math.max(8, options.minClauseChars ?? 20);
    this.maxClauseChars = Math.max(this.minClauseChars + 10, options.maxClauseChars ?? 55);
    this.strongBreakMinChars = Math.max(4, options.strongBreakMinChars ?? 8);
  }

  reset(): void {
    this.buffer = '';
    this.seq = 0;
    this.stickyProfileKey = 'neutral';
  }

  push(delta: string): AffectiveClause[] {
    if (!delta) return [];
    this.buffer += delta;
    return this.drain(false);
  }

  flush(): AffectiveClause[] {
    return this.drain(true);
  }

  private drain(isEnd: boolean): AffectiveClause[] {
    const out: AffectiveClause[] = [];

    while (this.buffer.length > 0) {
      if (!isEnd && hasIncompleteTrailingTag(this.buffer)) {
        break;
      }

      const trimmed = this.buffer.trimStart();
      if (!trimmed) {
        this.buffer = '';
        break;
      }
      this.buffer = trimmed;

      // Consume leading tag-only prefix so it updates sticky emotion without delaying cut math
      const spokenLen = estimateSpokenLength(this.buffer);
      if (spokenLen === 0) {
        if (isEnd) {
          const parsed = stripAffectiveTags(this.buffer);
          if (parsed.inlineTags.length > 0) {
            this.stickyProfileKey = parsed.profileKey;
          }
          this.buffer = '';
        }
        break;
      }

      const cutIdx = this.findCutIndex(this.buffer, isEnd);
      if (cutIdx === -1) {
        break;
      }

      const rawSlice = this.buffer.slice(0, cutIdx);
      this.buffer = this.buffer.slice(cutIdx).trimStart();

      const clause = this.buildClause(rawSlice);
      if (clause) {
        out.push(clause);
      }
    }

    return out;
  }

  private buildClause(rawSlice: string): AffectiveClause | null {
    const parsed = stripAffectiveTags(rawSlice);
    if (parsed.inlineTags.length > 0) {
      this.stickyProfileKey = parsed.profileKey;
    }
    if (!parsed.cleanText) {
      return null;
    }

    const activeProfileKey =
      parsed.inlineTags.length > 0 ? parsed.profileKey : this.stickyProfileKey;
    const languageHint = detectLanguageHint(parsed.cleanText);
    const { emotion, edgeProsody, kokoroProsody } = mapEmotionToProsody(
      activeProfileKey,
      languageHint,
    );

    return {
      seq: ++this.seq,
      rawText: rawSlice.trim(),
      cleanText: parsed.cleanText,
      emotion,
      inlineTags: parsed.inlineTags,
      languageHint,
      edgeProsody,
      kokoroProsody,
    };
  }

  private findCutIndex(text: string, isEnd: boolean): number {
    // Walk character by character tracking spoken length outside tags
    let inBracket = false;
    let inAngle = false;
    let spokenCount = 0;

    let firstStrongBreak = -1;
    let lastSoftBreakInRange = -1;
    let lastSpaceInRange = -1;
    let hardBreakIdx = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '[' && !inAngle) {
        inBracket = true;
        continue;
      }
      if (ch === ']' && inBracket) {
        inBracket = false;
        continue;
      }
      if (ch === '<' && !inBracket) {
        inAngle = true;
        continue;
      }
      if (ch === '>' && inAngle) {
        inAngle = false;
        continue;
      }
      if (inBracket || inAngle) continue;

      spokenCount++;

      const isStrong =
        ch === '。' ||
        ch === '！' ||
        ch === '？' ||
        ch === '!' ||
        ch === '?' ||
        ch === '\n' ||
        (ch === '.' && isSentencePeriodAt(text, i));

      const isSoft =
        ch === '，' ||
        ch === ',' ||
        ch === '；' ||
        ch === ';' ||
        ch === '：' ||
        ch === ':' ||
        ch === '…' ||
        ch === '—';

      if (isStrong && spokenCount >= this.strongBreakMinChars) {
        // Consume any consecutive closing punctuation (e.g., "?!" or "。”")
        let endIdx = i + 1;
        while (endIdx < text.length && /[。！？!?…”’"'）)]/.test(text[endIdx]!)) {
          endIdx++;
        }
        firstStrongBreak = endIdx;
        break;
      }

      if (isSoft && spokenCount >= this.minClauseChars && spokenCount <= this.maxClauseChars) {
        lastSoftBreakInRange = i + 1;
      }

      if (/\s/.test(ch) && spokenCount >= this.minClauseChars && spokenCount <= this.maxClauseChars) {
        lastSpaceInRange = i + 1;
      }

      if (spokenCount >= this.maxClauseChars && hardBreakIdx === -1) {
        // Do not split inside an ASCII word or surrogate pair
        const next = i + 1 < text.length ? text[i + 1]! : '';
        const isAsciiWordBoundary =
          /[A-Za-z0-9]/.test(ch) && /[A-Za-z0-9]/.test(next);
        if (!isAsciiWordBoundary) {
          hardBreakIdx = i + 1;
        }
      }
    }

    if (firstStrongBreak !== -1) return firstStrongBreak;
    if (lastSoftBreakInRange !== -1 && (isEnd || spokenCount >= this.minClauseChars + 6)) {
      return lastSoftBreakInRange;
    }
    if (spokenCount >= this.maxClauseChars) {
      if (lastSpaceInRange !== -1) return lastSpaceInRange;
      if (hardBreakIdx !== -1) {
        // Surrogate-pair guard
        if (hardBreakIdx > 0 && hardBreakIdx < text.length) {
          const prevCode = text.charCodeAt(hardBreakIdx - 1);
          const currCode = text.charCodeAt(hardBreakIdx);
          if (prevCode >= 0xd800 && prevCode <= 0xdbff && currCode >= 0xdc00 && currCode <= 0xdfff) {
            return hardBreakIdx - 1;
          }
        }
        return hardBreakIdx;
      }
      return text.length;
    }
    if (isEnd) return text.length;
    return -1;
  }
}

export function sliceAffectiveClauses(
  text: string,
  options?: AffectiveClauseSlicerOptions,
): AffectiveClause[] {
  const slicer = new AffectiveClauseSlicer(options);
  const first = slicer.push(text);
  const rest = slicer.flush();
  return [...first, ...rest];
}
