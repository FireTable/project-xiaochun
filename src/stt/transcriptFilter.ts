/**
 * SenseVoice transcript cleanup + filler / unreadable gate (aligned with otoji).
 */

/** Strip SenseVoice tags / BPE markers (rich_transcription_postprocess-ish). */
export function richTranscriptionPostprocess(raw: string): string {
  return raw
    .replace(/<\|[^|>]*\|>/g, '')
    .replace(/▁/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when text is empty, punctuation-only, or pure filler (嗯/啊/呃…). */
export function isFillerOrUnreadable(text: string): boolean {
  const t = richTranscriptionPostprocess(text);
  if (!t) return true;
  const core = t.replace(/[\s\p{P}\p{S}]+/gu, '');
  if (!core) return true;
  if (/^(?:uh|um|ah|er|hmm|m+)+$/i.test(core)) return true;
  if (/^[嗯啊呃唔哦噢喔欸诶哼嘿哈]+$/u.test(core)) return true;
  return false;
}

/** Mean RMS of mono float PCM. */
export function meanRms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}
