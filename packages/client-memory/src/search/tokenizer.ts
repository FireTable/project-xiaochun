/**
 * Multilingual Tokenizer for Chinese, English, and Japanese.
 * Prioritizes native Intl.Segmenter, with robust fallback to Latin word + CJK Uni/Bigram.
 */

const STOPWORDS = new Set([
  '的', '了', '和', '是', '就', '都', '而', '及', '與', '着',
  'の', 'に', 'は', 'を', 'た', 'が', 'で', 'て', 'と', 'し', 'れ', 'さ',
  'a', 'an', 'the', 'and', 'or', 'is', 'are', 'was', 'were', 'to', 'in', 'of', 'for', 'it', 'on', 'at'
]);

function isCjkChar(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff)    // Katakana
  );
}

const SEGMENTER_CACHE = new Map<string, Intl.Segmenter>();

function getSegmenter(lang: string): Intl.Segmenter {
  let seg = SEGMENTER_CACHE.get(lang);
  if (!seg) {
    seg = new Intl.Segmenter(lang, { granularity: 'word' });
    SEGMENTER_CACHE.set(lang, seg);
  }
  return seg;
}

export function tokenize(text: string, lang = 'zh'): string[] {
  if (!text) return [];
  const clean = text.trim();
  if (!clean) return [];

  // 1. Try native Intl.Segmenter (Chrome 87+, Safari 14.1+, Node 16+)
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = getSegmenter(lang);
      const rawTokens: string[] = [];
      for (const segment of segmenter.segment(clean)) {
        if (segment.isWordLike) {
          const t = segment.segment.toLowerCase().trim();
          if (t && !STOPWORDS.has(t)) {
            rawTokens.push(t);
            // If token is a multi-char CJK word, also include bigrams for recall
            if (t.length > 2 && isCjkChar(t.charCodeAt(0))) {
              for (let i = 0; i < t.length - 1; i++) {
                rawTokens.push(t.slice(i, i + 2));
              }
            }
          }
        }
      }
      return rawTokens;
    } catch {
      // Fall through to manual tokenizer
    }
  }

  // 2. Fallback Tokenizer
  const tokens: string[] = [];
  let latinBuffer = '';

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const code = clean.charCodeAt(i);

    if (isCjkChar(code)) {
      if (latinBuffer) {
        const word = latinBuffer.toLowerCase();
        if (!STOPWORDS.has(word)) tokens.push(word);
        latinBuffer = '';
      }
      // Single character (Unigram)
      if (!STOPWORDS.has(ch)) tokens.push(ch);
      // Bigram with next char if next char is also CJK
      if (i + 1 < clean.length && isCjkChar(clean.charCodeAt(i + 1))) {
        tokens.push(clean.slice(i, i + 2));
      }
    } else if (/[a-zA-Z0-9_]/.test(ch)) {
      latinBuffer += ch;
    } else {
      if (latinBuffer) {
        const word = latinBuffer.toLowerCase();
        if (!STOPWORDS.has(word)) tokens.push(word);
        latinBuffer = '';
      }
    }
  }

  if (latinBuffer) {
    const word = latinBuffer.toLowerCase();
    if (!STOPWORDS.has(word)) tokens.push(word);
  }

  return tokens;
}
