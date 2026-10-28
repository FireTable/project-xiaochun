/**
 * punctuation.ts — Two-Stage Punctuation Restoration Pipeline for STT
 *
 * Stage 1 (Heuristic / VAD-Boundary):
 *   - 0-latency, 0-weight deterministic linguistic inference.
 *   - Auto-detects sentence terminal punctuation based on VAD cut boundary + question/exclamation particles:
 *     * Questions: 吗/呢/吧/谁/什么/怎么/哪儿/几点/多少/为何/是不是/好不好/A不A ... -> '？'
 *     * Exclamations: 哇/太棒了/好厉害/太好了/天哪/真棒 ... -> '！'
 *     * Statements: standard declarative -> '。'
 *   - Intra-sentence conjunction commas (，) inserted before conjunctions (但是/不过/可是/所以/而且/然后...).
 *   - CJK / ASCII spacing normalization and idempotency protection (never duplicate existing punctuation).
 *
 * Stage 2 (Punctuation Restoration Model):
 *   - Extensible ML model interface (e.g., CT-Transformer / BiLSTM ONNX).
 *   - Runs before Stage 1 when available; gracefully falls back to Stage 1 when offline or loading.
 *   - Stage 1 acts as a terminal sanitizer after Stage 2 to ensure natural end marks.
 */

export interface PunctuationRestorer {
  restore(text: string): Promise<string> | string;
}

// ---------------------------------------------------------------------------
// Stage 1: Linguistic & VAD-Boundary Heuristics
// ---------------------------------------------------------------------------

const CHINESE_QUESTION_PARTICLES = /(?:吗|么|嘛)$/u;

const CHINESE_QUESTION_WORDS =
  /(?:谁|什么|怎么|怎样|如何|哪儿|哪里|哪个|几点|多少|多大|多久|为何|何处|何必|何时|干嘛|干啥|作甚|为什么|真的假的)/u;

const CHINESE_INTERROGATIVE_STRUCTURES =
  /(?:是不是|能不能|可不可以|好不好|行不行|对不对|有没有|会不会|要不要|想不想|算不算|知不知道|在不在|好吗|行吗|对吗|可以吗)/u;

// A-not-A question pattern (e.g. 去不去, 冷不冷, 买不买)
const CHINESE_A_NOT_A_PATTERN = /([\u4e00-\u9fa5])不\1/u;

// Soft ending particles that become questions when accompanied by question structure
const CHINESE_SOFT_QUESTION_PARTICLES = /(?:呢|吧|呀|啊|啦)$/u;

const CHINESE_EXCLAMATIONS =
  /(?:^|.*)(?:哇|太棒了|好厉害|太厉害|太好了|真棒|好美|救命|天哪|天啊|太牛了|太赞了|加油|真好看|太香了)/u;

// Pre-conjunction comma insertion: requires at least 2 Chinese characters prior without existing punctuation
const CONJUNCTION_COMMA_REGEX =
  /(?<=[\u4e00-\u9fa5]{2,})(?<![，。？！,.?!])(但是|不过|可是|然而|所以|因此|而且|然后|另外|此外|只是)(?=[^，。？！\s])/g;

// Conversational head particles/interjections: e.g. "是吗", "对了", "你好", "等等"
const CHINESE_HEAD_PARTICLES_REGEX =
  /^(是吗|对吧|对了|你好|小春|等等|喂|哈喽|话说|我说|那啥)(?=[^，。？！\s])/;

// Topic/conditional markers: e.g. "的话", "一般来说", "基本上"
const CHINESE_TOPIC_MARKERS_REGEX =
  /(?<=[\u4e00-\u9fa5]{2,})(的话|一般来说|基本上|老实说|总的来说)(?=[^，。？！\s])/g;

const ENGLISH_WH_WORDS = /\b(?:what|why|how|who|where|when|which|whose|whom)\b/i;
const ENGLISH_QUESTION_INVERSION =
  /^(?:is|are|am|was|were|do|does|did|can|could|will|would|should|may|might|have|has|had)\b/i;

/** Normalizes whitespace and fullwidth/halfwidth punctuation. */
export function normalizePunctuationSpacing(raw: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/\s+([，。？！,.?!])/g, '$1')
    .replace(/([，。？！,.?!])\s+/g, '$1')
    .replace(/([\u4e00-\u9fa5])\?/g, '$1？')
    .replace(/([\u4e00-\u9fa5])!/g, '$1！')
    .replace(/([\u4e00-\u9fa5]),/g, '$1，')
    .replace(/([\u4e00-\u9fa5])\./g, '$1。');
}

/**
 * Stage 1: Heuristic punctuation restoration based on VAD boundaries and linguistic particles.
 * Idempotent: If text already has terminal punctuation, preserves it and avoids duplication.
 */
export function applyHeuristicPunctuation(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = normalizePunctuationSpacing(raw);
  if (!text) return '';

  // 1. Insert commas after conversational head particles (e.g. "是吗" -> "是吗，", "对了" -> "对了，")
  text = text.replace(CHINESE_HEAD_PARTICLES_REGEX, '$1，');

  // 2. Insert commas after topic/conditional markers (e.g. "现在的话" -> "现在的话，")
  text = text.replace(CHINESE_TOPIC_MARKERS_REGEX, '$1，');

  // 3. Insert commas before conjunctions in compound phrases (e.g. "很好但是" -> "很好，但是")
  text = text.replace(CONJUNCTION_COMMA_REGEX, '，$1');

  // 4. Idempotency guard: If already ends with terminal punctuation, keep clean
  if (/[。？！?!.]$/.test(text)) {
    return text;
  }

  // 3. Pure English / Latin text handling
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  if (!hasChinese) {
    const isEnQuestion =
      ENGLISH_WH_WORDS.test(text) || ENGLISH_QUESTION_INVERSION.test(text);
    return isEnQuestion ? `${text}?` : `${text}.`;
  }

  // 4. Chinese question detection
  const isQuestion =
    CHINESE_QUESTION_PARTICLES.test(text) ||
    CHINESE_QUESTION_WORDS.test(text) ||
    CHINESE_INTERROGATIVE_STRUCTURES.test(text) ||
    CHINESE_A_NOT_A_PATTERN.test(text) ||
    (CHINESE_SOFT_QUESTION_PARTICLES.test(text) &&
      (CHINESE_QUESTION_WORDS.test(text) ||
        CHINESE_INTERROGATIVE_STRUCTURES.test(text) ||
        CHINESE_A_NOT_A_PATTERN.test(text)));

  if (isQuestion) {
    return `${text}？`;
  }

  // 5. Chinese exclamation detection
  if (CHINESE_EXCLAMATIONS.test(text)) {
    return `${text}！`;
  }

  // 6. Default declarative statement -> period
  return `${text}。`;
}

// ---------------------------------------------------------------------------
// Stage 2: Pluggable ML Model Restorer & Dual-Stage Pipeline
// ---------------------------------------------------------------------------

export type ModelInferenceFn = (rawText: string) => Promise<string> | string;

export class PunctuationPipeline implements PunctuationRestorer {
  private modelInference: ModelInferenceFn | null = null;
  private isModelReady = false;

  /**
   * Registers or updates an on-device ML punctuation model inference handler (e.g. CT-Transformer).
   */
  public setModelInference(fn: ModelInferenceFn | null): void {
    this.modelInference = fn;
    this.isModelReady = Boolean(fn);
  }

  /**
   * Whether the Stage 2 ML model is loaded and ready.
   */
  public hasModel(): boolean {
    return this.isModelReady && this.modelInference !== null;
  }

  /**
   * Executes the dual-stage punctuation pipeline:
   * 1. Stage 2 (ML Model): If available, infers complex intra-sentence punctuation.
   * 2. Stage 1 (Heuristic / VAD-Boundary): Always runs as the terminal sanitizer,
   *    guaranteeing terminal punctuation, question/exclamation matching, and proper spacing.
   */
  public async restore(rawText: string): Promise<string> {
    if (!rawText || !rawText.trim()) return '';

    let text = rawText.trim();
    let stageUsed = '阶段一 (启发式规则)';

    // Stage 2: Attempt ML model inference if ready
    if (this.isModelReady && this.modelInference) {
      try {
        const modelOutput = await this.modelInference(text);
        if (modelOutput && modelOutput.trim()) {
          text = modelOutput.trim();
          stageUsed = '阶段二 (ML模型 + 阶段一规范)';
        }
      } catch (err) {
        console.warn('[PunctuationPipeline] Stage 2 model inference failed, falling back to Stage 1:', err);
      }
    }

    // Stage 1: Terminal boundary sanitizer & heuristic completion
    const result = applyHeuristicPunctuation(text);

    if (typeof console !== 'undefined' && typeof console.log === 'function') {
      console.log(
        `%c[STT 标点引擎]%c [${stageUsed}] "${rawText}" ➔ "${result}"`,
        'color: #38bdf8; font-weight: bold;',
        'color: inherit;',
      );
    }

    return result;
  }
}

/** Global singleton instance for STT Web Worker and main thread. */
export const punctuationPipeline = new PunctuationPipeline();
