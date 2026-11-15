/**
 * bimodalTurnFusion.ts — Layer 1B Bimodal (Acoustic + Bilingual Lexical) Turn Decision Fusion.
 *
 * Fuses calibrated Whisper-tiny 4-class acoustic probabilities (`COMPLETE`, `INCOMPLETE`,
 * `BACKCHANNEL`, `WAIT_INTERRUPT`) with ZH / EN / EN-ZH Code-Switching lexical cues,
 * pause duration (`pauseMs`), and assistant speaking state (`assistantSpeaking`).
 */

import {
  DUPLEX_TURN_CLASSES,
  type BimodalTurnDecision,
  type BimodalTurnInput,
  type DuplexTurnClass,
  type DuplexTurnProbs,
} from './types';

const ZH_BACKCHANNEL_ITEMS = [
  '嗯', '嗯嗯', '嗯嗯嗯', '哦', '哦哦', '喔', '对', '对对', '对对对', '是的', '是啊', '是呢',
  '好', '好的', '好啊', '好吧', '行', '行行', '了解', '明白', '明白了', '收到', '知道了',
  '原来如此', '也是', '没问题', '可以', '没错', '确实', '嗯哼', '啊哈', '哈哈', '嘿嘿',
];

const EN_BACKCHANNEL_ITEMS = [
  'mm', 'mmm', 'mm-hmm', 'mmhmm', 'mhm', 'uh-huh', 'uhhuh', 'aha', 'yeah', 'yep', 'yup',
  'yes', 'right', 'okay', 'ok', 'sure', 'got it', 'i see', 'makes sense', 'cool', 'nice',
  'true', 'exactly', 'totally', 'alright', 'all right', 'fine', 'sounds good',
];

const ZH_WAIT_ITEMS = [
  '等一下', '等等', '等一会', '等会儿', '等会', '稍等', '稍等一下', '先等一下',
  '停', '停一下', '先停一下', '先停', '别说', '等下', '等一下下', '打断一下',
  '不好意思等一下', '抱歉等一下',
];

const EN_WAIT_ITEMS = [
  'wait', 'wait a sec', 'wait a second', 'wait a minute', 'hold on', 'hold up', 'hang on',
  'stop', 'pause', 'one sec', 'one second', 'just a sec', 'just a second', 'sorry wait',
  'excuse me', 'shh', 'quiet',
];

const ZH_WAIT_PREFIX_RE = /^(?:(?:不好意思|抱歉|sorry|hey|uh|um|哎|喂)\s*[,，]?\s*)*(?:等一下下|等一下|等等|等一会|等会儿|等会|等下|稍等一下|稍等|先停一下|先停|停一下|打断一下|停)\b|(?:等一下|等等|先停一下|打断一下|wait a second|wait a sec|hold on|hang on|sorry wait|wait)/i;

const EN_WAIT_PREFIX_RE = /^(?:(?:sorry|hey|oh|uh|um|excuse me)\s*[,，]?\s*)*(?:wait a second|wait a sec|wait a minute|wait|hold on|hold up|hang on|stop|pause|one sec|one second|just a sec)\b/i;

const ZH_TRAILING_INCOMPLETE_RE = /(?:因为|所以|但是|可是|不过|然而|而且|并且|或者|还是|如果|假如|要是|虽然|尽管|哪怕|既然|只要|除非|不仅|除了|关于|对于|至于|然后|接着|之后|另外|比如|例如|尤其是|特别是|主要是|其实就是|就是说|我的意思是|我是说|我想问|帮我查|帮我看看|帮我|请问一下|那个(?:吧)?|这个(?:吧)?|那什么(?:吧)?|怎么说呢|的话|嘛|呢|呀|啊|哦)[，,、\s…\.]*$/;

const ZH_UNCLOSED_CLAUSE_PREFIX_RE = /(?:如果|假如|要是|虽然|尽管|哪怕|既然|只要|除非|不仅|不但)(?!.*(?:就|那|那么|但是|可是|不过|然而|还是|也|还|而且|并且|却|吧|吗|？|\?|。|！|!))/;

const EN_TRAILING_INCOMPLETE_RE = /\b(?:and|or|but|so|because|since|although|though|however|if|unless|when|while|where|whereas|until|before|after|that|which|who|whose|to|for|with|without|from|about|into|onto|of|at|by|as|like|well|actually|basically|maybe|probably|uh|um|er|erm)\s*[,，\-…\.]*$/i;

const EN_UNCLOSED_CLAUSE_PREFIX_RE =
  /\b(?:because of|due to|even though|as long as|even if|in order to)\b(?!.*[,，;:：.?!。？！])/i;

const TERMINAL_PUNCT_RE = /[。？！?!.]$/;
const TRAILING_CONTINUATION_PUNCT_RE = /(?:[,，、:：;；\-—]|\.{2,}|…+)\s*$/;

function normalizeText(stableText: string, tailText: string): string {
  const s = (stableText || '').trim();
  const t = (tailText || '').trim();
  if (!s) return t;
  if (!t) return s;
  // Avoid gluing ASCII words together without space
  const needsSpace = /[A-Za-z0-9]$/.test(s) && /^[A-Za-z0-9]/.test(t);
  return needsSpace ? `${s} ${t}` : `${s}${t}`;
}

function stripPunctAndSpaces(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s,，。？！?!、.．…~～'’"“”\-—]+/g, ' ')
    .trim();
}

function tokenizeMixedUnits(normalized: string): string[] {
  // Split into English/alphanumeric tokens and individual/grouped CJK sequences
  const compact = normalized
    .toLowerCase()
    .replace(/[,，。？！?!、.．…~～'’"“”\-—]+/g, ' ')
    .trim();
  if (!compact) return [];
  return compact.split(/\s+/).filter(Boolean);
}

function isPureBackchannelText(text: string): boolean {
  const stripped = stripPunctAndSpaces(text);
  if (!stripped) return false;

  const noSpace = stripped.replace(/\s+/g, '');
  for (const item of ZH_BACKCHANNEL_ITEMS) {
    if (noSpace === item) return true;
  }
  if (EN_BACKCHANNEL_ITEMS.includes(stripped)) return true;

  // Handle repeated or mixed EN+ZH backchannel phrases like "yeah 对对", "mm-hmm 好的", "ok ok"
  const parts = tokenizeMixedUnits(stripped);
  if (parts.length === 0 || parts.length > 4) return false;

  const combinedWhitelist = new Set([
    ...ZH_BACKCHANNEL_ITEMS,
    ...EN_BACKCHANNEL_ITEMS,
    'uh',
    'huh',
    'mm',
    'hmm',
    'got',
    'it',
    'i',
    'see',
    'makes',
    'sense',
    'sounds',
    'good',
    'all',
  ]);

  let matchedUnits = 0;
  for (const p of parts) {
    if (combinedWhitelist.has(p)) {
      matchedUnits++;
      continue;
    }
    // Check concatenation of two ZH backchannel tokens e.g. "嗯嗯对"
    let zhOk = false;
    for (const zh of ZH_BACKCHANNEL_ITEMS) {
      if (p === zh || p === `${zh}${zh}`) {
        zhOk = true;
        break;
      }
    }
    if (!zhOk) return false;
    matchedUnits++;
  }
  return matchedUnits > 0;
}

function isPureWaitCueText(text: string): boolean {
  const stripped = stripPunctAndSpaces(text);
  if (!stripped) return false;
  const noSpace = stripped.replace(/\s+/g, '');

  for (const item of ZH_WAIT_ITEMS) {
    if (noSpace === item) return true;
  }
  if (EN_WAIT_ITEMS.includes(stripped)) return true;

  // Mixed pure wait phrases like "wait 等一下", "sorry wait 先停一下"
  const parts = tokenizeMixedUnits(stripped);
  if (parts.length === 0 || parts.length > 5) return false;
  const waitTokens = new Set([
    'wait', 'a', 'sec', 'second', 'minute', 'hold', 'on', 'up', 'hang',
    'stop', 'pause', 'one', 'just', 'sorry', 'excuse', 'me', 'hey', 'shh',
    ...ZH_WAIT_ITEMS,
  ]);
  return parts.every((p) => waitTokens.has(p));
}

function hasWaitCueWithPayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isPureWaitCueText(trimmed)) return false;
  return ZH_WAIT_PREFIX_RE.test(trimmed) || EN_WAIT_PREFIX_RE.test(trimmed);
}

function hasLexicalIncompleteCue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (TRAILING_CONTINUATION_PUNCT_RE.test(trimmed)) return true;
  if (ZH_TRAILING_INCOMPLETE_RE.test(trimmed)) return true;
  if (ZH_UNCLOSED_CLAUSE_PREFIX_RE.test(trimmed)) return true;
  if (EN_TRAILING_INCOMPLETE_RE.test(trimmed)) return true;
  if (EN_UNCLOSED_CLAUSE_PREFIX_RE.test(trimmed)) return true;
  return false;
}

function hasTerminalCompletionPunct(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Trailing ellipsis ("..." or "…") is hesitation/continuation, not terminal completion
  if (/(?:\.{2,}|…+)\s*$/.test(trimmed)) return false;
  return TERMINAL_PUNCT_RE.test(trimmed);
}

function normalizeProbs(raw: DuplexTurnProbs): DuplexTurnProbs {
  const c = Math.max(0, raw.COMPLETE || 0);
  const i = Math.max(0, raw.INCOMPLETE || 0);
  const b = Math.max(0, raw.BACKCHANNEL || 0);
  const w = Math.max(0, raw.WAIT_INTERRUPT || 0);
  const sum = c + i + b + w;
  if (sum <= 0) {
    return { COMPLETE: 0.25, INCOMPLETE: 0.25, BACKCHANNEL: 0.25, WAIT_INTERRUPT: 0.25 };
  }
  return {
    COMPLETE: c / sum,
    INCOMPLETE: i / sum,
    BACKCHANNEL: b / sum,
    WAIT_INTERRUPT: w / sum,
  };
}

function argmaxClass(probs: DuplexTurnProbs): DuplexTurnClass {
  let bestCls: DuplexTurnClass = 'COMPLETE';
  let bestVal = -1;
  for (const cls of DUPLEX_TURN_CLASSES) {
    if (probs[cls] > bestVal) {
      bestVal = probs[cls];
      bestCls = cls;
    }
  }
  return bestCls;
}

function textLenScore(text: string): number {
  const clean = text.replace(/[\s,，。？！?!、.．…]/g, '');
  return clean.length;
}

export function decideBimodalTurn(input: BimodalTurnInput): BimodalTurnDecision {
  const probs = normalizeProbs(input.probs);
  const combinedText = normalizeText(input.stableText, input.tailText);
  const pauseMs = Math.max(0, input.pauseMs || 0);
  const speechDurationMs = Math.max(0, input.speechDurationMs || 0);
  const charCount = textLenScore(combinedText);
  const topClass = argmaxClass(probs);

  const pureBackchannel = isPureBackchannelText(combinedText);
  const pureWait = isPureWaitCueText(combinedText);
  const waitWithPayload = hasWaitCueWithPayload(combinedText);
  const lexicalIncomplete = hasLexicalIncompleteCue(combinedText);
  const terminalPunct = hasTerminalCompletionPunct(combinedText);

  const isLexicalComplete =
    charCount >= 2 &&
    !lexicalIncomplete &&
    !pureBackchannel &&
    !pureWait &&
    !waitWithPayload;

  // Silence / sub-noise guard (no lexical text and tiny speech energy/duration)
  if (
    charCount === 0 &&
    speechDurationMs < 180 &&
    (input.rmsDb === undefined || input.rmsDb < -52)
  ) {
    return {
      action: 'CONTINUE_WAITING',
      turnClass: topClass,
      probs,
      reason: 'silence_or_subthreshold_noise',
      pauseMs,
      combinedText,
    };
  }

  // =========================================================================
  // Branch A: Assistant IS currently speaking (Full-Duplex Barge-In / Backchannel)
  // =========================================================================
  if (input.assistantSpeaking) {
    // 1. Explicit WAIT_INTERRUPT + substantive follow-up (e.g. "等一下 wait a second，我问另一个问题")
    if (waitWithPayload && (pauseMs >= 160 || terminalPunct || charCount >= 8)) {
      return {
        action: 'BARGE_IN_COMMIT',
        turnClass: 'WAIT_INTERRUPT',
        probs,
        reason: 'barge_in_wait_with_substantive_query',
        pauseMs,
        combinedText,
      };
    }

    // 2. Pure WAIT / HOLD cue ("等一下", "wait", "hold on", "先停一下") -> stop TTS and hold silently
    if (
      pureWait ||
      (topClass === 'WAIT_INTERRUPT' &&
        probs.WAIT_INTERRUPT >= 0.45 &&
        !waitWithPayload &&
        charCount <= 10)
    ) {
      return {
        action: 'WAIT_SILENT_HOLD',
        turnClass: 'WAIT_INTERRUPT',
        probs,
        reason: pureWait ? 'lexical_wait_hold_cue' : 'acoustic_wait_interrupt_hold',
        pauseMs,
        combinedText,
      };
    }

    // 3. Backchannel ("mm-hmm", "yeah", "对对", "嗯嗯", "yeah 对对") -> NEVER barge-in!
    if (
      pureBackchannel ||
      (topClass === 'BACKCHANNEL' &&
        probs.BACKCHANNEL >= 0.42 &&
        charCount <= 10 &&
        speechDurationMs <= 2000 &&
        !waitWithPayload &&
        !terminalPunct)
    ) {
      return {
        action: 'BACKCHANNEL_ACK',
        turnClass: 'BACKCHANNEL',
        probs,
        reason: pureBackchannel ? 'lexical_backchannel_hold' : 'acoustic_backchannel_hold',
        pauseMs,
        combinedText,
      };
    }

    // 4. Substantive user interruption while assistant speaks
    if (
      charCount >= 6 &&
      ((!lexicalIncomplete &&
        ((topClass === 'COMPLETE' && probs.COMPLETE >= 0.5 && pauseMs >= 200) ||
          (terminalPunct && pauseMs >= 180) ||
          (probs.WAIT_INTERRUPT >= 0.55 && charCount >= 8 && pauseMs >= 220) ||
          pauseMs >= 950)) ||
        pauseMs >= 1500)
    ) {
      return {
        action: 'BARGE_IN_COMMIT',
        turnClass: probs.WAIT_INTERRUPT > probs.COMPLETE ? 'WAIT_INTERRUPT' : 'COMPLETE',
        probs,
        reason: 'substantive_barge_in_commit',
        pauseMs,
        combinedText,
      };
    }

    // User just started speaking over TTS and hasn't finished yet
    return {
      action: 'CONTINUE_WAITING',
      turnClass: topClass === 'WAIT_INTERRUPT' ? 'WAIT_INTERRUPT' : 'INCOMPLETE',
      probs,
      reason: 'assistant_speaking_barge_in_pending',
      pauseMs,
      combinedText,
    };
  }

  // =========================================================================
  // Branch B: Assistant is NOT speaking (Standard Turn Endpointing)
  // =========================================================================

  // 1. Explicit standalone wait/hold cue when assistant is idle -> hold patiently if short pause,
  // unless they already waited > 1.2s
  if (pureWait && pauseMs < 1200) {
    return {
      action: 'WAIT_SILENT_HOLD',
      turnClass: 'WAIT_INTERRUPT',
      probs,
      reason: 'idle_wait_hold_cue',
      pauseMs,
      combinedText,
    };
  }

  // 2. If lexical cues strongly signal incomplete utterance, resist premature commit!
  if (lexicalIncomplete) {
    if ((pauseMs >= 1500 && charCount >= 6) || (pauseMs >= 1800 && charCount >= 1)) {
      return {
        action: 'COMMIT_USER_TURN',
        turnClass: 'COMPLETE',
        probs,
        reason: 'incomplete_cue_timeout_commit',
        pauseMs,
        combinedText,
      };
    }
    if (pauseMs >= 650) {
      return {
        action: 'HOLD_SOFT',
        turnClass: 'INCOMPLETE',
        probs,
        reason: 'lexical_incomplete_soft_hold',
        pauseMs,
        combinedText,
      };
    }
    return {
      action: 'CONTINUE_WAITING',
      turnClass: 'INCOMPLETE',
      probs,
      reason: 'lexical_incomplete_continue_waiting',
      pauseMs,
      combinedText,
    };
  }

  // 3. Acoustic INCOMPLETE dominates (even without explicit trailing word cue)
  if (topClass === 'INCOMPLETE' && probs.INCOMPLETE >= 0.48 && !terminalPunct) {
    if ((pauseMs >= 1400 && charCount >= 4) || (pauseMs >= 1800 && charCount >= 1)) {
      return {
        action: 'COMMIT_USER_TURN',
        turnClass: 'COMPLETE',
        probs,
        reason: 'acoustic_incomplete_long_pause_commit',
        pauseMs,
        combinedText,
      };
    }
    if (pauseMs >= 650) {
      return {
        action: 'HOLD_SOFT',
        turnClass: 'INCOMPLETE',
        probs,
        reason: 'acoustic_incomplete_soft_hold',
        pauseMs,
        combinedText,
      };
    }
    return {
      action: 'CONTINUE_WAITING',
      turnClass: 'INCOMPLETE',
      probs,
      reason: 'acoustic_incomplete_continue_waiting',
      pauseMs,
      combinedText,
    };
  }

  // 4. Standalone short filler/backchannel when assistant is idle
  if (pureBackchannel && pauseMs < 480) {
    return {
      action: 'CONTINUE_WAITING',
      turnClass: 'BACKCHANNEL',
      probs,
      reason: 'idle_short_ack_wait_for_continuation',
      pauseMs,
      combinedText,
    };
  }

  // 5. Fast COMPLETE commit (lexical completeness, acoustic COMPLETE, or terminal punctuation with sufficient pause)
  if (isLexicalComplete && pauseMs >= 220 && (charCount > 0 || speechDurationMs >= 220)) {
    return {
      action: 'COMMIT_USER_TURN',
      turnClass: 'COMPLETE',
      probs,
      reason: 'lexical_complete_commit',
      pauseMs,
      combinedText,
    };
  }

  const effectiveCompleteScore =
    probs.COMPLETE + (terminalPunct ? 0.18 : 0) + (pauseMs >= 450 ? 0.1 : 0);

  if (
    (effectiveCompleteScore >= 0.52 && pauseMs >= 220 && (charCount > 0 || speechDurationMs >= 220)) ||
    (terminalPunct && pauseMs >= 200 && charCount > 0) ||
    (pureBackchannel && pauseMs >= 480) ||
    (pauseMs >= 950 && charCount > 0)
  ) {
    return {
      action: 'COMMIT_USER_TURN',
      turnClass: 'COMPLETE',
      probs,
      reason: terminalPunct
        ? 'bimodal_complete_with_terminal_punct'
        : 'acoustic_complete_commit',
      pauseMs,
      combinedText,
    };
  }

  // 6. Very brief micro-pause (< 220ms) -> wait before firing final commit
  const fallbackTurnClass: DuplexTurnClass =
    isLexicalComplete && topClass === 'BACKCHANNEL' ? 'COMPLETE' : topClass;

  return {
    action: pauseMs >= 650 ? 'HOLD_SOFT' : 'CONTINUE_WAITING',
    turnClass: fallbackTurnClass,
    probs,
    reason: 'awaiting_pause_threshold',
    pauseMs,
    combinedText,
  };
}
