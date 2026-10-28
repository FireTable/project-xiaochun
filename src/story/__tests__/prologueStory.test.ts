import { describe, it, expect, vi } from 'vitest';

vi.mock('@/core/vrmEngine', () => ({ vrmEngine: { setEnvironmentTime: vi.fn() } }));
vi.mock('@/core/scene/sceneManager', () => ({ sceneManager: { setScene: vi.fn() } }));

import { prologueStory } from '../prologueStory';
import { StoryScriptSchema, STORY_LANGS, type LocalizedText, type StoryLang } from '../schema';
import { resolveBeat } from '../localize';
import { isMotionCatalogId } from '@/motion/catalog';
import { BGM_MOODS, BGM_MOOD_ALIASES, AMBIENCE_IDS, SFX_IDS } from '../audioDirector';

const beats = Object.values(prologueStory.beats);

/** 每拍台词的长度上限：一拍说完 (不再拆短句)，但也不能长到 TTS 首包等太久 */
const LIMIT: Record<StoryLang, number> = { 'zh-CN': 100, ja: 125, en: 250 };
/** 走一遍典型路径：自动推进就跟着走，要选择时选第一张卡 */
function typicalPath(): string[] {
  const path: string[] = [];
  let id: string | undefined = prologueStory.initialBeatId;
  while (id && path.length < 50) {
    path.push(id);
    const b: (typeof prologueStory.beats)[string] = prologueStory.beats[id];
    id = b.autoNextBeatId ?? b.choices?.find((c) => c.nextBeatId)?.nextBeatId;
  }
  return path;
}
const isSpoken = (id: string) => resolveBeat(prologueStory.beats[id], 'en').actor.speechText.trim() !== '';
const CJK = /[\u3400-\u9fff]/;
const KANA = /[\u3040-\u30ff]/;

describe('prologue story (Act 0 v3)', () => {
  it('passes the story schema', () => {
    const r = StoryScriptSchema.safeParse(prologueStory);
    expect(r.success).toBe(true);
  });

  it('has a connected graph: no dangling targets, no dead ends, every beat reachable', () => {
    const ids = new Set(Object.keys(prologueStory.beats));
    const reachable = new Set<string>();
    const queue = [prologueStory.initialBeatId];
    while (queue.length) {
      const id = queue.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const b = prologueStory.beats[id];
      expect(b, `beat ${id} exists`).toBeDefined();
      const outs: string[] = [];
      if (b.autoNextBeatId) outs.push(b.autoNextBeatId);
      for (const c of [...(b.choices ?? []), ...(b.confirmChoice ? [b.confirmChoice] : [])]) {
        if (c.nextBeatId) outs.push(c.nextBeatId);
        if (c.actionType === 'custom') {
          expect(typeof c.actionPayload, `${id}/${c.id} custom payload`).toBe('function');
          expect(c.nextBeatId, `${id}/${c.id} custom needs nextBeatId`).toBeTruthy();
        }
        const terminal = c.actionType === 'finish' || c.actionType === 'open_provider_config';
        expect(Boolean(c.nextBeatId) || terminal, `${id}/${c.id} leads somewhere`).toBe(true);
      }
      for (const o of outs) {
        expect(ids.has(o), `${id} -> ${o}`).toBe(true);
        queue.push(o);
      }
      // 非终点拍必须有出口
      expect(outs.length > 0 || (b.choices ?? []).some((c) => c.actionType === 'finish'), `${id} has an exit`).toBe(true);
      // autoNext 与选项互斥
      expect(!(b.autoNextBeatId && b.choices?.length), `${id} autoNext xor choices`).toBe(true);
    }
    expect([...ids].filter((i) => !reachable.has(i))).toEqual([]);
  });

  it('every spoken line, choice, subtitle and intertitle exists in zh-CN, en and ja', () => {
    for (const b of beats) {
      const fields: Array<[string, LocalizedText | undefined]> = [
        [`${b.id}.speech`, b.actor.speechText],
        [`${b.id}.intertitle`, b.cinematics?.intertitle?.text],
        [`${b.id}.placeholder`, b.inputPlaceholder],
      ];
      for (const c of b.choices ?? []) {
        fields.push([`${b.id}.${c.id}.text`, c.text], [`${b.id}.${c.id}.sub`, c.subText]);
      }
      for (const [name, t] of fields) {
        if (t === undefined || t === '') continue;
        if (typeof t === 'string') {
          // 纯字符串只允许语言名这类通用文本
          expect(['中文', 'English', '日本語', '简体中文'], name).toContain(t);
          continue;
        }
        for (const l of STORY_LANGS) {
          expect(t[l] && t[l]!.trim().length > 0, `${name} has ${l}`).toBe(true);
        }
      }
    }
  });

  it('keeps lines short per language, and each language reads like itself', () => {
    for (const b of beats) {
      for (const lang of STORY_LANGS) {
        const beat = resolveBeat(b, lang);
        const line = beat.actor.speechText;
        if (line.trim() === '') continue;
        expect(line.length, `${b.id} ${lang}: "${line}"`).toBeLessThanOrEqual(LIMIT[lang]);
        // 语气克制：省略号不堆叠
        expect((line.match(/…/g) ?? []).length, `${b.id} ${lang} ellipses`).toBeLessThanOrEqual(4);
        if (lang === 'en') expect(CJK.test(line), `${b.id} en has no CJK`).toBe(false);
        if (lang === 'ja') expect(KANA.test(line), `${b.id} ja has kana`).toBe(true);
        if (lang === 'zh-CN') expect(KANA.test(line), `${b.id} zh has no kana`).toBe(false);
        for (const l of [line, ...(beat.choices ?? []).map((c) => c.text)]) {
          expect(l.includes('小春'), `${b.id} must say 小蠢 not 小春`).toBe(false);
        }
      }
    }
  });

  it('the look and wrap beats answer the first choice differently, in every language', () => {
    const ask = prologueStory.beats.beat_ask;
    for (const id of ['beat_look', 'beat_wrap']) {
      for (const l of STORY_LANGS) {
        const seen = new Set<string>();
        for (const c of ask.choices ?? []) {
          (c.actionPayload as () => void)();
          seen.add(resolveBeat(prologueStory.beats[id], l).actor.speechText);
        }
        expect(seen.size, `${id} ${l} differs per answer`).toBe(3);
      }
    }
    (ask.choices![0].actionPayload as () => void)();
  });

  it('asks for the language on the very first card (greet) and switches every supported language', () => {
    const greet = prologueStory.beats.beat_greet;
    const payloads = (greet.choices ?? []).map((c) => c.actionPayload);
    expect(payloads).toEqual([...STORY_LANGS]);
    for (const c of greet.choices ?? []) {
      expect(c.actionType).toBe('change_lang');
      expect(c.nextBeatId).toBe('beat_ask');
    }
  });

  it('is short: few beats, few TTS requests, no chains of spoken auto-beats', () => {
    expect(beats.length).toBeLessThanOrEqual(14);
    const path = typicalPath();
    expect(path.at(-1), 'typical path ends in a finish card').toBe('beat_ramble');
    expect(path.length).toBeGreaterThanOrEqual(8);
    expect(path.length).toBeLessThanOrEqual(10);
    const spoken = path.filter(isSpoken);
    expect(spoken.length).toBeLessThanOrEqual(9);
    expect(spoken.length).toBeLessThan(path.length); // 至少一拍无台词 (镜头 / 环境声)
    // 连续两拍以上的“自动连播台词”会让人觉得在不停等语音
    let run = 0;
    let maxRun = 0;
    for (const id of path) {
      run = isSpoken(id) && prologueStory.beats[id].autoNextBeatId ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBeLessThanOrEqual(2);
  });

  it('uses only motions, sfx, moods and ambience the engine really implements', () => {
    for (const b of beats) {
      for (const m of [b.actor.motion, b.actor.leadInMotion]) {
        if (m) expect(isMotionCatalogId(m), `${b.id} motion ${m}`).toBe(true);
      }
      const a = b.audio;
      if (!a) continue;
      if (a.bgmMood) expect(Object.keys(BGM_MOODS).includes(BGM_MOOD_ALIASES[a.bgmMood] ?? a.bgmMood), `${b.id} mood ${a.bgmMood}`).toBe(true);
      if (a.ambience && a.ambience !== 'none') expect((AMBIENCE_IDS as readonly string[]).includes(a.ambience), `${b.id} ambience`).toBe(true);
      if (a.playSfx) expect((SFX_IDS as readonly string[]).includes(a.playSfx), `${b.id} sfx ${a.playSfx}`).toBe(true);
      for (const s of a.sfx ?? []) expect((SFX_IDS as readonly string[]).includes(s.id), `${b.id} sfx ${s.id}`).toBe(true);
    }
  });

  it('showcases the real cinematic features (and the single required tap)', () => {
    const transitions = new Set(beats.map((b) => b.cinematics?.transition).filter(Boolean));
    expect(transitions).toEqual(new Set(['fade_to_black', 'white_flash']));
    const gradings = new Set(beats.map((b) => b.cinematics?.grading).filter((g) => g && g !== 'default'));
    expect(gradings).toEqual(new Set(['sepia_memory', 'dream_bloom']));
    const moves = new Set(beats.map((b) => b.camera?.movement));
    expect(moves.has('hero_backlight_reveal')).toBe(true);
    expect(moves.has('dutch_tilt')).toBe(true);
    expect(beats.some((b) => (b.camera?.windMultiplier ?? 1) > 1)).toBe(true);
    expect(beats.some((b) => b.audio?.bgmMood)).toBe(true);
    expect(beats.some((b) => b.audio?.ambience)).toBe(true);
    expect(beats.some((b) => b.actor.leadInMotion)).toBe(true);
    const clickRequired = beats.filter((b) => b.cinematics?.intertitle?.requireClick);
    expect(clickRequired.map((b) => b.id)).toEqual(['beat_greet']);
  });
});
