import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEdgeTTSPayloads } from '@/lib/edge-tts-core';
import {
  KOKORO_MAX_TOTAL_TOKENS,
  KOKORO_ZH_VOCAB,
  textToKokoroTokens,
  zhSegmentToMisakiPhones,
} from '../kokoroBilingualG2P';
import {
  AffectiveClauseSlicer,
  mapEmotionToProsody,
  sliceAffectiveClauses,
  stripAffectiveTags,
} from '../affectiveClauseSlicer';

const TOKENIZER_PATH = resolve(process.cwd(), 'public/models/kokoro-zh/tokenizer.json');
const REAL_TOKENIZER = JSON.parse(readFileSync(TOKENIZER_PATH, 'utf8')) as {
  model: { vocab: Record<string, number> };
};
const REAL_VOCAB = REAL_TOKENIZER.model.vocab;
const VALID_ID_SET = new Set(Object.values(REAL_VOCAB));

describe('Kokoro-82M-v1.1-zh Bilingual G2P & Vocab', () => {
  it('matches public/models/kokoro-zh/tokenizer.json 172-token vocab identically', () => {
    expect(Object.keys(REAL_VOCAB).length).toBe(172);
    expect(Object.keys(KOKORO_ZH_VOCAB).length).toBe(172);
    expect(KOKORO_ZH_VOCAB).toEqual(REAL_VOCAB);
  });

  it('applies Mandarin tone sandhi for 3+3, multi-char 3rd-tone chains, 一, 不, and erhua', () => {
    // 3+3 -> 2+3: "你好" (ni3 hao3 -> ni2 hao3)
    const niHao = zhSegmentToMisakiPhones('你好');
    expect(niHao).toContain('2');
    expect(niHao).toContain('3');
    expect(niHao.indexOf('2')).toBeLessThan(niHao.indexOf('3'));

    // Continuous 3rd tone chains (e.g. "展览馆", "纸老虎")
    const zhanLanGuan = zhSegmentToMisakiPhones('展览馆');
    expect(zhanLanGuan).toMatch(/2.*2.*3/);

    // "一" tone sandhi rules:
    // "一天" (yi before 1st tone -> yi4)
    expect(zhSegmentToMisakiPhones('一天')).toMatch(/4.*1/);
    // "一个" (yi before neutral-reduced ge5, historical 4th tone -> yi2 + ge5)
    expect(zhSegmentToMisakiPhones('一个')).toBe('ㄧ2ㄍㄜ5');
    // "一样" (yi before 4th tone -> yi2 + yang4)
    expect(zhSegmentToMisakiPhones('一样')).toMatch(/2.*4/);
    // "看一看" (X一X reduplication -> neutral tone 5)
    expect(zhSegmentToMisakiPhones('看一看')).toContain('5');
    // "第一" (ordinal -> original tone 1)
    expect(zhSegmentToMisakiPhones('第一')).toMatch(/4.*1/);

    // "不" tone sandhi rules:
    // "不怕" (bu before 4th tone -> bu2)
    expect(zhSegmentToMisakiPhones('不怕')).toMatch(/2.*4/);
    // "看不懂" (V不C -> neutral tone 5)
    expect(zhSegmentToMisakiPhones('看不懂')).toContain('5');

    // Erhua produces Kokoro R phoneme token while NOT_ERHUA stays regular er
    const xiaoYuanEr = zhSegmentToMisakiPhones('小院儿');
    expect(xiaoYuanEr).toContain('R');
    const huaEr = zhSegmentToMisakiPhones('花儿');
    expect(huaEr).not.toContain('R');

    // Special syllables: 嗯 -> n2, 知道/思考 apical vowels
    const en = zhSegmentToMisakiPhones('嗯');
    expect(en).toContain('2');
  });

  it('tokenizes mixed ZH+EN code-switched sentences cleanly against real 172-token vocab', async () => {
    const sample1 = '你好 XiaoChun，today is great！';
    const res1 = await textToKokoroTokens(sample1);

    expect(res1.tokenIds[0]).toBe(0);
    expect(res1.tokenIds[res1.tokenIds.length - 1]).toBe(0);
    expect(res1.tokenIds.length).toBeGreaterThan(15);
    expect(res1.tokenIds.length).toBeLessThanOrEqual(KOKORO_MAX_TOTAL_TOKENS);
    expect(res1.inputIds.length).toBe(res1.tokenIds.length);
    for (const id of res1.tokenIds) {
      expect(VALID_ID_SET.has(id)).toBe(true);
    }
    // Punctuation mapped cleanly into Misaki tokens
    expect(res1.phonemes).toContain(',');
    expect(res1.phonemes).toContain('!');

    const sample2 = "你好 XiaoChun，let's test WebGPU！";
    const res2 = await textToKokoroTokens(sample2);
    expect(res2.tokenIds[0]).toBe(0);
    expect(res2.tokenIds[res2.tokenIds.length - 1]).toBe(0);
    for (const id of res2.tokenIds) {
      expect(VALID_ID_SET.has(id)).toBe(true);
    }

    // Synchronous fallback EN lexicon path (usePhonemizer: false) also produces valid IDs
    const syncRes = await textToKokoroTokens(sample1, { usePhonemizer: false });
    expect(syncRes.tokenIds.length).toBeGreaterThan(15);
    for (const id of syncRes.tokenIds) {
      expect(VALID_ID_SET.has(id)).toBe(true);
    }
  });

  it('clamps overly long mixed utterances strictly to <= 510 total tokens ([0, ...<=508, 0])', async () => {
    const longText = '你好 XiaoChun，today is great！ '.repeat(40);
    const res = await textToKokoroTokens(longText, { usePhonemizer: false });

    expect(res.tokenIds.length).toBe(KOKORO_MAX_TOTAL_TOKENS);
    expect(res.inputIds.length).toBe(KOKORO_MAX_TOTAL_TOKENS);
    expect(res.tokenIds[0]).toBe(0);
    expect(res.tokenIds[res.tokenIds.length - 1]).toBe(0);
    for (const id of res.tokenIds) {
      expect(VALID_ID_SET.has(id)).toBe(true);
    }
  });
});

describe('AffectiveClauseSlicer & Prosody Mapping', () => {
  it('strips inline affective tags and delegate tags while preserving target emotions', () => {
    const cleaned = stripAffectiveTags(
      '[laugh] 太棒了吧！<delegate task="search">notes</delegate> [shy] 其实我也有点紧张呢。',
    );
    expect(cleaned.cleanText).toBe('太棒了吧！其实我也有点紧张呢。');
    expect(cleaned.inlineTags).toEqual(['laugh', 'shy']);
    expect(cleaned.emotion).toBe('shy');

    for (const tag of ['happy', 'laugh', 'sigh', 'shy', 'surprised', 'angry', 'sad'] as const) {
      const { emotion, edgeProsody, kokoroProsody } = mapEmotionToProsody(`[${tag}]`, 'zh');
      expect(edgeProsody.pitch).toMatch(/^[+-]\d+Hz$/);
      expect(edgeProsody.rate).toMatch(/^[+-]\d+%$/);
      expect(edgeProsody.volume).toMatch(/^[+-]\d+%$/);
      expect(kokoroProsody.speed).toBeGreaterThanOrEqual(0.85);
      expect(kokoroProsody.speed).toBeLessThanOrEqual(1.2);

      // Critical Edge protocol guard: ONLY <prosody>, NEVER <mstts:express-as>
      const { ssmlMessage } = buildEdgeTTSPayloads(
        '测试语音合成',
        edgeProsody.voice,
        edgeProsody.pitch,
        edgeProsody.rate,
        edgeProsody.volume,
      );
      expect(ssmlMessage).toContain('<prosody ');
      expect(ssmlMessage).not.toContain('mstts:express-as');

      if (tag === 'laugh') expect(emotion).toBe('happy');
      else if (tag === 'sigh') expect(emotion).toBe('relaxed');
      else expect(emotion).toBe(tag);
    }
  });

  it('streams bilingual clauses cleanly across token deltas without cutting decimals or tags', () => {
    const slicer = new AffectiveClauseSlicer({ minClauseChars: 20, maxClauseChars: 55 });
    const deltas = [
      '[happ',
      'y] 你好呀',
      ' XiaoChun，我',
      '今天测了 Kokoro v1.1 的',
      ' 3.14 版本！',
      '[shy] 要不我们',
      '一起去沙滩走走，看看今天傍晚的',
      '海风和晚霞吧？',
    ];

    const emitted = deltas.flatMap((d) => slicer.push(d));
    emitted.push(...slicer.flush());

    expect(emitted.length).toBeGreaterThanOrEqual(2);
    expect(emitted[0]!.seq).toBe(1);
    expect(emitted[0]!.emotion).toBe('happy');
    expect(emitted[0]!.cleanText).toContain('3.14');
    expect(emitted[0]!.cleanText).not.toContain('[happy]');

    expect(emitted[1]!.seq).toBe(2);
    expect(emitted[1]!.emotion).toBe('shy');
    expect(emitted[1]!.cleanText).not.toContain('[shy]');

    // Also test direct sliceAffectiveClauses with long text exceeding 55 chars
    const longSingle = sliceAffectiveClauses(
      '[surprised] 哇原来浏览器里真的可以直接运行零显存占用的本地双语语音合成模型而且还能切英文句子呢！',
    );
    expect(longSingle.length).toBeGreaterThanOrEqual(1);
    for (const c of longSingle) {
      expect(c.cleanText.length).toBeLessThanOrEqual(60);
      expect(c.cleanText).not.toMatch(/\[.*\]/);
    }
  });
});
