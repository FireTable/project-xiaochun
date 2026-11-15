/**
 * frontBrain.ts — Sophon-style Front-Brain prompt, streaming tag/delegate parser,
 * and punctuation-grace soft budget controller (`<= 900` token prompt, `enable_thinking: false`).
 */

import type {
  BrainKVRuntimeAdapter,
  BrainMessage,
  LiveEmotionTag,
  LiveLanguageHint,
} from './types';
import type { FrontBrainSegment } from './types';

export const FRONT_BRAIN_SOFT_TOKEN_BUDGET = 90;
export const FRONT_BRAIN_MAX_TOKENS = 160;
export const FRONT_BRAIN_PROMPT_MAX_TOKENS = 900;

/**
 * Isolated <= 900-token Front-Brain persona prompt (`sophon_live`).
 * Bilingual ZH/EN + natural code-switching, warm close-bestie tone.
 * Stays constant across turns so MLC KV prefix cache hits 100% cleanly.
 */
export const SOPHON_LIVE_FRONT_BRAIN_PROMPT = [
  'You are XiaoChun (小春), a warm, witty, lively bestie chatting live on a sunlit beach in natural Chinese, English, or code-switching.',
  'Spoken Style: Reply in 1-3 natural conversational sentences ready for live voice; never output markdown, bullet lists, emojis, or stage directions.',
  'Emotion Tags: Prefix mood shifts ONLY with [happy], [laugh], [sigh], [shy], [surprised], [relaxed], [sad].',
].join('\n');

const INLINE_TAG_TO_EMOTION: Record<string, LiveEmotionTag> = {
  neutral: 'neutral',
  happy: 'happy',
  laugh: 'happy',
  excited: 'happy',
  angry: 'angry',
  sad: 'sad',
  sigh: 'sad',
  relaxed: 'relaxed',
  calm: 'relaxed',
  surprised: 'surprised',
  shy: 'shy',
  blush: 'shy',
};

const SENTENCE_TERMINATORS = /[。！？!?.~～\n]/;
const CLAUSE_SPLIT_RE = /^([\s\S]*?[。！？!?；;~\n]|[\s\S]{10,}?[，,])\s*/;

export interface ParsedDelegateDirective {
  task: string;
  urgency: 'quick' | 'deep';
  rawTag: string;
}

export interface FrontStreamStepOutput {
  cleanDelta: string;
  cleanAccum: string;
  emotion: LiveEmotionTag;
  newDelegates: ParsedDelegateDirective[];
  speakClauses: Array<{ text: string; emotion: LiveEmotionTag }>;
  shouldGraceStop: boolean;
}

/**
 * Lightweight deterministic bilingual token count estimator.
 * Treats CJK characters conservatively (~1.1 tok/char) and Latin/whitespace (~0.28 tok/char).
 */
export function estimateBilingualTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.max(1, Math.ceil(cjk * 1.1 + other / 3.6));
}

export function normalizeEmotionTag(rawTag: string): LiveEmotionTag | null {
  const key = rawTag.trim().toLowerCase();
  return INLINE_TAG_TO_EMOTION[key] ?? null;
}

export function formatInterruptedAssistantText(heardText: string): string {
  if (heardText.endsWith('[interrupted]')) return heardText;
  return heardText.length > 0 ? `${heardText} [interrupted]` : '[interrupted]';
}

function parseDelegateTagAttributes(rawTag: string): ParsedDelegateDirective | null {
  if (!/^<delegate\b/i.test(rawTag.trim())) return null;
  const taskMatch =
    rawTag.match(/\btask\s*=\s*"([^"]*)"/i) ??
    rawTag.match(/\btask\s*=\s*'([^']*)'/i);
  const urgencyMatch =
    rawTag.match(/\burgency\s*=\s*"([^"]*)"/i) ??
    rawTag.match(/\burgency\s*=\s*'([^']*)'/i);
  const innerMatch = rawTag.match(/^<delegate\b[^>]*>([\s\S]*?)<\/delegate>$/i);
  const task = taskMatch?.[1]?.trim() || innerMatch?.[1]?.trim() || '';
  const urgencyRaw = urgencyMatch?.[1]?.trim().toLowerCase();
  const urgency: 'quick' | 'deep' = urgencyRaw === 'quick' ? 'quick' : 'deep';
  return { task, urgency, rawTag };
}

/**
 * Strip `<think>...</think>`, `<delegate .../>`, and inline emotion brackets cleanly.
 */
export function stripFrontBrainMarkup(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<delegate\b[^>]*\/>/gi, '')
    .replace(/<delegate\b[^>]*>[\s\S]*?<\/delegate>/gi, '')
    .replace(
      /\[(neutral|happy|laugh|excited|angry|sad|sigh|relaxed|calm|surprised|shy|blush)\]\s*/gi,
      '',
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Synchronously parse a completed Front-Brain raw string into a structured `FrontBrainSegment`.
 */
export function parseFrontBrainOutput(raw: string): FrontBrainSegment {
  const parser = new FrontBrainStreamParser(Number.MAX_SAFE_INTEGER);
  parser.push(raw);
  parser.flush();
  return parser.toSegment();
}

/**
 * Streaming stateful parser that handles token-split `[emotion]` tags,
 * `<think>...</think>` blocks, incremental `<delegate .../>` XML, spoken clause buffering,
 * and punctuation-grace stopping after `softTokenBudget` tokens.
 */
export class FrontBrainStreamParser {
  private readonly softTokenBudget: number;
  private rawAccum = '';
  private pending = '';
  private inThinkBlock = false;
  private cleanAccum = '';
  private speechPending = '';
  private currentEmotion: LiveEmotionTag = 'neutral';
  private delegates: ParsedDelegateDirective[] = [];
  private softBudgetReached = false;
  private graceStopTriggered = false;

  constructor(softTokenBudget = FRONT_BRAIN_SOFT_TOKEN_BUDGET) {
    this.softTokenBudget = softTokenBudget;
  }

  getRawText(): string {
    return this.rawAccum;
  }

  getCleanText(): string {
    return this.cleanAccum.trim();
  }

  getEmotion(): LiveEmotionTag {
    return this.currentEmotion;
  }

  getDelegates(): readonly ParsedDelegateDirective[] {
    return this.delegates;
  }

  toSegment(): FrontBrainSegment {
    const primary = this.delegates[0];
    return {
      text: this.rawAccum,
      cleanText: this.cleanAccum.trim(),
      emotion: this.currentEmotion,
      ...(primary
        ? {
            isDelegate: true,
            delegateTask: primary.task,
            delegateUrgency: primary.urgency,
          }
        : {}),
    };
  }

  push(delta: string): FrontStreamStepOutput {
    if (!delta) {
      return {
        cleanDelta: '',
        cleanAccum: this.cleanAccum.trim(),
        emotion: this.currentEmotion,
        newDelegates: [],
        speakClauses: [],
        shouldGraceStop: this.graceStopTriggered,
      };
    }

    this.rawAccum += delta;
    if (estimateBilingualTokens(this.rawAccum) >= this.softTokenBudget) {
      this.softBudgetReached = true;
    }

    this.pending += delta;
    const emittedCleanParts: string[] = [];
    const newDelegates: ParsedDelegateDirective[] = [];
    const speakClauses: Array<{ text: string; emotion: LiveEmotionTag }> = [];

    this.drainPending(false, emittedCleanParts, newDelegates, speakClauses);

    const cleanDelta = emittedCleanParts.join('');
    if (
      this.softBudgetReached &&
      !this.graceStopTriggered &&
      !this.hasOpenTagPending() &&
      SENTENCE_TERMINATORS.test(cleanDelta)
    ) {
      this.graceStopTriggered = true;
      this.flushSpeechRemainder(speakClauses);
    }

    return {
      cleanDelta,
      cleanAccum: this.cleanAccum.trim(),
      emotion: this.currentEmotion,
      newDelegates,
      speakClauses,
      shouldGraceStop: this.graceStopTriggered,
    };
  }

  flush(): FrontStreamStepOutput {
    const emittedCleanParts: string[] = [];
    const newDelegates: ParsedDelegateDirective[] = [];
    const speakClauses: Array<{ text: string; emotion: LiveEmotionTag }> = [];

    this.drainPending(true, emittedCleanParts, newDelegates, speakClauses);
    this.flushSpeechRemainder(speakClauses);

    return {
      cleanDelta: emittedCleanParts.join(''),
      cleanAccum: this.cleanAccum.trim(),
      emotion: this.currentEmotion,
      newDelegates,
      speakClauses,
      shouldGraceStop: this.graceStopTriggered,
    };
  }

  private hasOpenTagPending(): boolean {
    return this.pending.includes('<') || this.pending.includes('[');
  }

  private appendClean(
    text: string,
    emittedCleanParts: string[],
    speakClauses: Array<{ text: string; emotion: LiveEmotionTag }>,
  ): void {
    if (!text) return;
    // Avoid leading whitespace right after stripped leading tags
    const normalized =
      this.cleanAccum.length === 0 ? text.replace(/^\s+/, '') : text;
    if (!normalized) return;

    this.cleanAccum += normalized;
    emittedCleanParts.push(normalized);
    this.speechPending += normalized;

    while (true) {
      const m = this.speechPending.match(CLAUSE_SPLIT_RE);
      if (!m) break;
      const clause = m[1].trim();
      this.speechPending = this.speechPending.slice(m[0].length);
      if (clause.length > 0 && !/^[。！？!?；;，,.\s~～]+$/.test(clause)) {
        speakClauses.push({ text: clause, emotion: this.currentEmotion });
      }
    }
  }

  private flushSpeechRemainder(
    speakClauses: Array<{ text: string; emotion: LiveEmotionTag }>,
  ): void {
    const tail = this.speechPending.trim();
    this.speechPending = '';
    if (tail.length > 0 && !/^[。！？!?；;，,.\s~～]+$/.test(tail)) {
      speakClauses.push({ text: tail, emotion: this.currentEmotion });
    }
  }

  private drainPending(
    isFlush: boolean,
    emittedCleanParts: string[],
    newDelegates: ParsedDelegateDirective[],
    speakClauses: Array<{ text: string; emotion: LiveEmotionTag }>,
  ): void {
    while (this.pending.length > 0) {
      if (this.inThinkBlock) {
        const endIdx = this.pending.search(/<\/think>/i);
        if (endIdx === -1) {
          // Keep trailing up to 7 chars in case "</think>" is split across chunks
          if (!isFlush && this.pending.length > 8) {
            this.pending = this.pending.slice(-8);
          } else if (isFlush) {
            this.pending = '';
          }
          break;
        }
        this.pending = this.pending.slice(endIdx + '</think>'.length);
        this.inThinkBlock = false;
        continue;
      }

      const nextBracket = this.pending.indexOf('[');
      const nextAngle = this.pending.indexOf('<');
      let nextSpecial = -1;
      if (nextBracket !== -1 && nextAngle !== -1) {
        nextSpecial = Math.min(nextBracket, nextAngle);
      } else {
        nextSpecial = Math.max(nextBracket, nextAngle);
      }

      if (nextSpecial === -1) {
        this.appendClean(this.pending, emittedCleanParts, speakClauses);
        this.pending = '';
        break;
      }

      if (nextSpecial > 0) {
        this.appendClean(
          this.pending.slice(0, nextSpecial),
          emittedCleanParts,
          speakClauses,
        );
        this.pending = this.pending.slice(nextSpecial);
      }

      if (this.pending.startsWith('[')) {
        const closeIdx = this.pending.indexOf(']');
        if (closeIdx === -1) {
          if (isFlush || this.pending.length > 24) {
            this.appendClean(this.pending[0], emittedCleanParts, speakClauses);
            this.pending = this.pending.slice(1);
            continue;
          }
          break;
        }
        const tagInner = this.pending.slice(1, closeIdx);
        const mapped = normalizeEmotionTag(tagInner);
        if (mapped !== null) {
          this.currentEmotion = mapped;
          this.pending = this.pending.slice(closeIdx + 1).replace(/^[ ]+/, '');
          continue;
        }
        // Not one of our emotion tags -> emit literally up to `]`
        this.appendClean(
          this.pending.slice(0, closeIdx + 1),
          emittedCleanParts,
          speakClauses,
        );
        this.pending = this.pending.slice(closeIdx + 1);
        continue;
      }

      // Starts with '<'
      const lower = this.pending.toLowerCase();
      const couldBeThink =
        '<think>'.startsWith(lower) || lower.startsWith('<think>');
      const couldBeDelegate =
        '<delegate'.startsWith(lower) || lower.startsWith('<delegate');

      if (!couldBeThink && !couldBeDelegate) {
        this.appendClean('<', emittedCleanParts, speakClauses);
        this.pending = this.pending.slice(1);
        continue;
      }

      if (lower.startsWith('<think>')) {
        this.inThinkBlock = true;
        this.pending = this.pending.slice('<think>'.length);
        continue;
      }

      if (lower.startsWith('<delegate')) {
        const selfCloseIdx = this.pending.indexOf('/>');
        const fullCloseIdx = lower.indexOf('</delegate>');
        if (
          selfCloseIdx !== -1 &&
          (fullCloseIdx === -1 || selfCloseIdx < fullCloseIdx)
        ) {
          const rawTag = this.pending.slice(0, selfCloseIdx + 2);
          const parsed = parseDelegateTagAttributes(rawTag);
          if (parsed) {
            this.flushSpeechRemainder(speakClauses);
            this.delegates.push(parsed);
            newDelegates.push(parsed);
          }
          this.pending = this.pending.slice(selfCloseIdx + 2).replace(/^[ ]+/, '');
          continue;
        }
        if (fullCloseIdx !== -1) {
          const rawTag = this.pending.slice(
            0,
            fullCloseIdx + '</delegate>'.length,
          );
          const parsed = parseDelegateTagAttributes(rawTag);
          if (parsed) {
            this.flushSpeechRemainder(speakClauses);
            this.delegates.push(parsed);
            newDelegates.push(parsed);
          }
          this.pending = this.pending.slice(fullCloseIdx + '</delegate>'.length).replace(/^[ ]+/, '');
          continue;
        }
        if (isFlush || this.pending.length > 512) {
          this.appendClean('<', emittedCleanParts, speakClauses);
          this.pending = this.pending.slice(1);
          continue;
        }
        break;
      }

      // Partial `<think` or `<delegate` prefix buffered waiting for more chars
      if (isFlush) {
        this.appendClean(this.pending, emittedCleanParts, speakClauses);
        this.pending = '';
        break;
      }
      break;
    }
  }
}

export interface RunFrontBrainTurnOptions {
  adapter: BrainKVRuntimeAdapter;
  history: BrainMessage[];
  userText: string;
  language?: LiveLanguageHint;
  signal: AbortSignal;
  softTokenBudget?: number;
  maxTokens?: number;
  bridgeOnly?: boolean;
  onFirstToken?: (ttftMs: number) => void;
  onStep?: (step: FrontStreamStepOutput) => void;
}

export interface RunFrontBrainTurnResult {
  segment: FrontBrainSegment;
  delegates: ParsedDelegateDirective[];
  ttftMs: number;
  aborted: boolean;
  graceStopped: boolean;
}

export function buildBridgeOnlyUserCue(
  rawUserText: string,
  language?: LiveLanguageHint,
): string {
  const preferZh =
    language === 'zh' ||
    (language !== 'en' && /[\u4e00-\u9fff]/.test(rawUserText));
  if (preferZh) {
    return '[Bridge-Only Check-in] 我刚问了一个需要后台深度分析的问题（后台已经在查了）。请先用 [happy] 开头，只说一句自然温暖的中文口语（12到22个字）让我稍等两秒、你马上帮我仔细查一下，不要提及或解释任何具体问题内容。';
  }
  return '[Bridge-Only Check-in] I just asked a complex question that your background engine is already analyzing. Start with [happy] and reply in ONLY one warm, natural spoken English sentence (10 to 18 words) asking me to hang on a second while you look into it—do not mention or explain any topic details.';
}

export function buildFrontBrainMessages(
  history: BrainMessage[],
  userText: string,
  systemPrompt = SOPHON_LIVE_FRONT_BRAIN_PROMPT,
): BrainMessage[] {
  const nonSystem = history.filter((m) => m.role !== 'system');
  return [
    { role: 'system', content: systemPrompt },
    ...nonSystem,
    { role: 'user', content: userText },
  ];
}

/**
 * Execute one Front-Brain streaming pass against the KV adapter with `enable_thinking: false`
 * and punctuation-grace soft budget stopping.
 */
export async function runFrontBrainTurn(
  opts: RunFrontBrainTurnOptions,
): Promise<RunFrontBrainTurnResult> {
  const tStart = performance.now();
  let ttftMs = 0;
  let firstTokenSeen = false;
  let graceStopped = false;

  const localAbort = new AbortController();
  const forwardAbort = () => localAbort.abort();
  opts.signal.addEventListener('abort', forwardAbort, { once: true });

  const parser = new FrontBrainStreamParser(
    opts.softTokenBudget ?? FRONT_BRAIN_SOFT_TOKEN_BUDGET,
  );
  const allDelegates: ParsedDelegateDirective[] = [];
  const effectiveUserText = opts.bridgeOnly
    ? buildBridgeOnlyUserCue(opts.userText, opts.language)
    : opts.userText;
  const messages = buildFrontBrainMessages(opts.history, effectiveUserText);

  try {
    const stream = opts.adapter.streamChat({
      messages,
      maxTokens: opts.maxTokens ?? FRONT_BRAIN_MAX_TOKENS,
      temperature: 0.72,
      thinking: false,
      signal: localAbort.signal,
    });

    for await (const chunk of stream) {
      if (opts.signal.aborted || localAbort.signal.aborted) break;
      if (!chunk.delta) continue;

      if (!firstTokenSeen) {
        firstTokenSeen = true;
        ttftMs = Math.max(0, performance.now() - tStart);
        opts.onFirstToken?.(ttftMs);
      }

      const step = parser.push(chunk.delta);
      if (step.newDelegates.length > 0) {
        allDelegates.push(...step.newDelegates);
      }
      opts.onStep?.(step);

      const bridgeCleanLen = step.cleanAccum.trim().length;
      if (
        step.shouldGraceStop ||
        (opts.bridgeOnly &&
          (step.speakClauses.length > 0 ||
            (bridgeCleanLen >= 8 && SENTENCE_TERMINATORS.test(step.cleanAccum))))
      ) {
        graceStopped = true;
        opts.adapter.interruptGenerate();
        localAbort.abort();
        break;
      }
    }

    if (!opts.signal.aborted) {
      const tailStep = parser.flush();
      if (tailStep.newDelegates.length > 0) {
        allDelegates.push(...tailStep.newDelegates);
      }
      if (
        tailStep.cleanDelta ||
        tailStep.newDelegates.length > 0 ||
        tailStep.speakClauses.length > 0
      ) {
        opts.onStep?.(tailStep);
      }
    }
  } finally {
    opts.signal.removeEventListener('abort', forwardAbort);
  }

  return {
    segment: parser.toSegment(),
    delegates: allDelegates,
    ttftMs,
    aborted: opts.signal.aborted,
    graceStopped,
  };
}
