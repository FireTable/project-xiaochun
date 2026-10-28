import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { prologueStory } from '../prologueStory';
import { StoryScriptSchema, STORY_LANGS, type LocalizedText, type StoryLang } from '../schema';
import { applyVariant, resolveBeat } from '../localize';
import { resolveStoryScene } from '../scenes';
import { SHOT_PRESETS } from '@/core/scene/cameraDirector';
import { isMotionCatalogId } from '@/motion/catalog';
import { BGM_MOODS, BGM_MOOD_ALIASES, AMBIENCE_IDS, SFX_IDS, SFX_ALIASES } from '../audioDirector';
import { APP_CONFIG } from '@/config';
import { TRANSITION_SPECS } from '../transitions';

const beats = Object.values(prologueStory.beats);
const SCRIPT_BEATS = ['beat_1', 'beat_2', 'beat_3', 'beat_outfit_choice', 'beat_4', 'beat_5', 'beat_5_reply', 'beat_brain_choice', 'beat_6'];

/** 每拍一句台词：中文 ≤50 字，日文相当，英文相当 */
const LIMIT: Record<StoryLang, number> = { 'zh-CN': 50, ja: 70, en: 140 };
const CJK = /[\u3400-\u9fff]/;
const KANA = /[\u3040-\u30ff]/;
/** 台词里不许出现的操作词 / 界面词 / 评审测试词 (操作提示由卡片自己的标题 / 副标题承担) */
const FORBIDDEN = /点击|点一下|轻触|下面的卡片|右上角|API|评审|测试|麦克风|键盘|tap |click|card below|microphone|keyboard|タップ|クリック/i;

describe('prologue story (Act 0 v4 · Backstage Catch)', () => {
  it('passes the story schema and asks the engine to start in the browser language', () => {
    expect(StoryScriptSchema.safeParse(prologueStory).success).toBe(true);
    expect(prologueStory.startLang).toBe('browser');
  });

  it('keeps the wake step (black intertitle + the one required tap) and chains straight into beat 1', () => {
    const greet = prologueStory.beats.beat_greet;
    expect(prologueStory.initialBeatId).toBe('beat_greet');
    expect(greet.cinematics?.intertitle?.requireClick).toBe(true);
    expect(greet.autoNextBeatId).toBe('beat_1');
    expect(greet.choices ?? []).toEqual([]);
    expect(resolveBeat(greet, 'en').actor.speechText).toBe('');
    // 叫醒屏是旁白：门后有人在自言自语，轻触 = 推门进去 (不再是“叫醒她”)
    const wake = (l: StoryLang) => resolveBeat(greet, l);
    expect(wake('zh-CN').cinematics?.intertitle?.text).toBe('门后有人在小声嘀咕……好像在排练什么。');
    expect(wake('en').cinematics?.intertitle?.text).toBe('Someone behind the door is muttering to herself... rehearsing something?');
    expect(wake('ja').cinematics?.intertitle?.text).toBe('扉の向こうで誰かがぶつぶつ……何かの練習？');
    expect([wake('zh-CN').cinematics?.intertitle?.subtitle, wake('en').cinematics?.intertitle?.subtitle, wake('ja').cinematics?.intertitle?.subtitle]).toEqual(['轻触推门进去', 'Tap to step in', 'タップして中へ']);
    const clickRequired = beats.filter((b) => b.cinematics?.intertitle?.requireClick);
    expect(clickRequired.map((b) => b.id)).toEqual(['beat_greet']);
  });

  it('has the 6 script beats + the outfit beat, each with exactly one spoken line, plus the wake step', () => {
    expect(Object.keys(prologueStory.beats)).toEqual(['beat_greet', ...SCRIPT_BEATS]);
    for (const id of SCRIPT_BEATS) {
      expect(resolveBeat(prologueStory.beats[id], 'en').actor.speechText.trim().length, id).toBeGreaterThan(0);
    }
  });

  it('every spoken line, subtitle, placeholder and choice exists in zh-CN, en and ja (beat 2 cards are own-language plain strings)', () => {
    for (const b of beats) {
      const fields: Array<[string, LocalizedText | undefined]> = [
        [`${b.id}.speech`, b.actor.speechText],
        [`${b.id}.intertitle`, b.cinematics?.intertitle?.text],
        [`${b.id}.placeholder`, b.inputPlaceholder],
        [`${b.id}.subtitle`, b.cinematics?.intertitle?.subtitle],
      ];
      if (b.id !== 'beat_2') {
        for (const c of b.choices ?? []) fields.push([`${b.id}.${c.id}.text`, c.text], [`${b.id}.${c.id}.sub`, c.subText]);
      }
      for (const [name, t] of fields) {
        if (t === undefined || t === '') continue;
        expect(typeof t, `${name} must be localized`).toBe('object');
        for (const l of STORY_LANGS) {
          const text = (t as Record<string, string | undefined>)[l];
          expect(text && text.trim().length > 0, `${name} has ${l}`).toBe(true);
        }
      }
    }
    expect(prologueStory.beats.beat_greet.cinematics?.intertitle?.text).toBeTypeOf('object');
  });

  it('beat 2 language cards each show only their own language, and picking one switches the language for beat 3 on', () => {
    const cards = prologueStory.beats.beat_2.choices ?? [];
    expect(cards.map((c) => c.actionPayload)).toEqual([...STORY_LANGS]);
    const texts = cards.map((c) => c.text as string);
    expect(texts.every((t) => typeof t === 'string')).toBe(true);
    expect(CJK.test(texts[0]) && !KANA.test(texts[0])).toBe(true);
    expect(texts[1]).toMatch(/^[\x20-\x7e]+$/);
    expect(KANA.test(texts[2])).toBe(true);
    for (const c of cards) {
      expect(c.actionType).toBe('change_lang');
      expect(c.nextBeatId).toBe('beat_3');
      for (const l of STORY_LANGS) expect(resolveBeat(prologueStory.beats.beat_2, l).choices?.find((x) => x.id === c.id)?.text).toBe(c.text);
    }
  });

  it('keeps every line short, in its own language, free of UI instructions, and says 小蠢 (never 小春)', () => {
    for (const b of beats) {
      for (const lang of STORY_LANGS) {
        const beat = resolveBeat(b, lang);
        const lines = [beat.actor.speechText];
        for (const line of lines) {
          if (line.trim() === '') continue;
          expect(line.length, `${b.id} ${lang}: "${line}"`).toBeLessThanOrEqual(LIMIT[lang]);
          expect(FORBIDDEN.test(line), `${b.id} ${lang} has no UI/meta words: "${line}"`).toBe(false);
          expect(line.includes('小春'), `${b.id} ${lang}`).toBe(false);
          if (lang === 'en') expect(CJK.test(line), `${b.id} en has no CJK`).toBe(false);
          if (lang === 'ja') expect(KANA.test(line), `${b.id} ja has kana`).toBe(true);
          if (lang === 'zh-CN') expect(KANA.test(line), `${b.id} zh has no kana`).toBe(false);
        }
      }
    }
  });

  it('has no hint chips anywhere (the field no longer exists) and no beat sets a hint', () => {
    for (const b of beats) expect(Object.keys(b), b.id).not.toContain('hint');
  });

  it('beat 4 (scene cards) has no colour grading, and nothing leaks into it from earlier beats', () => {
    const order = ['beat_greet', 'beat_1', 'beat_2', 'beat_3', 'beat_outfit_choice', 'beat_4'];
    let grading = 'default';
    for (const id of order) {
      const g = prologueStory.beats[id].cinematics?.grading;
      if (g !== undefined) grading = g;
    }
    expect(prologueStory.beats.beat_4.cinematics?.grading).toBe('default');
    expect(grading).toBe('default');
  });

  it('all confirm cards share the plain card style: no icon, no emoji, a sub-line', () => {
    for (const b of beats) {
      const c = b.confirmChoice;
      if (!c) continue;
      expect(c.icon, `${b.id} confirm icon`).toBeUndefined();
      expect(c.subText, `${b.id} confirm subText`).toBeDefined();
    }
  });

  it('wires the four advance modes the way the script says', () => {
    const b = prologueStory.beats;
    // 1 auto 400ms
    expect(b.beat_1.autoNextBeatId).toBe('beat_2');
    expect(b.beat_1.autoNextDelayMs).toBe(400);
    // 2 choice → 3
    expect((b.beat_2.choices ?? []).every((c) => c.nextBeatId === 'beat_3')).toBe(true);
    // 3 camera_drag tutorial card + the user's button → 3.5 (no auto-detection, no fallback)
    expect(b.beat_3.interaction).toBe('camera_drag');
    expect((b.beat_3.choices ?? []).map((c) => [c.id, c.nextBeatId])).toEqual([['look_done', 'beat_outfit_choice']]);
    // 3.5 outfit cards (preview in place) + confirm → 4
    expect(b.beat_outfit_choice.confirmChoice?.nextBeatId).toBe('beat_4');
    // 4 scene cards (preview in place, each sets the branch) + confirm → 5
    expect((b.beat_4.choices ?? []).map((c) => [c.actionType, c.actionPayload, c.branch, c.nextBeatId])).toEqual([
      ['change_scene', 'beach3d', 'beach', undefined],
      ['change_scene', 'light', 'day', undefined],
      ['change_scene', 'dark', 'night', undefined],
    ]);
    expect(b.beat_4.confirmChoice?.nextBeatId).toBe('beat_5');
    // 5 fixed-reply password cards only (no input bar) → 5.5 reply → 5.8 brain cards → 6
    expect(b.beat_5.allowInput).toBeUndefined();
    expect(b.beat_5.inputPlaceholder).toBeUndefined();
    expect((b.beat_5.choices ?? []).length).toBeGreaterThanOrEqual(2);
    expect((b.beat_5.choices ?? []).every((c) => c.actionType === 'next_beat' && c.nextBeatId === 'beat_5_reply')).toBe(true);
    expect(b.beat_5_reply).toMatchObject({ autoNextBeatId: 'beat_brain_choice', camera: { shot: 'close_up', movement: 'arc_sweep', durationSec: 1.5 }, actor: { expression: { base: 'playful' } } });
    expect((b.beat_brain_choice.choices ?? []).map((c) => [c.id, c.actionType, c.nextBeatId])).toEqual([
      ['brain_webllm', 'custom', 'beat_6'],
      ['brain_custom', 'open_provider_config', 'beat_6'],
    ]);
    expect(typeof b.beat_brain_choice.choices?.[0].actionPayload).toBe('function');
    expect(b.beat_brain_choice.allowInput).toBeUndefined();
    // 6 auto 300ms → finish
    expect(b.beat_6.autoFinish).toBe(true);
    expect(b.beat_6.autoNextDelayMs).toBe(300);
  });

  it('starts in the void scene and offers three distinct destinations, each with its own look and sound', () => {
    expect(prologueStory.beats.beat_1.scene).toBe('void');
    expect(Object.keys(APP_CONFIG.scenes.items)).toContain('void');
    const day = applyVariant(prologueStory.beats.beat_5, 'day');
    expect(day.scene).toBe('lineart_day');
    expect(day.cinematics).toMatchObject({ grading: 'dream_bloom', wind: 1 });
    expect(day.cinematics?.timeOfDay).toBeUndefined();
    expect(day.audio?.bgmMood).toBe('calm');
    expect(day.audio?.sfx?.map((s) => s.id)).toEqual(['crystal', 'wind']);
    const looks = ['beach', 'day', 'night'].map((v) => {
      const b = applyVariant(prologueStory.beats.beat_5, v);
      return JSON.stringify([b.scene, b.cinematics?.grading, b.cinematics?.wind, b.audio?.bgmMood]);
    });
    expect(new Set(looks).size).toBe(3);
    expect(prologueStory.beats.beat_4.choices?.length).toBe(3);
    expect(prologueStory.beats.beat_outfit_choice.choices?.length).toBe(3);
  });

  it('beat 5 differs per branch: scene-matched grading, wind, BGM and SFX', () => {
    const base = prologueStory.beats.beat_5;
    const night = applyVariant(base, 'night');
    const beach = applyVariant(base, 'beach');
    expect(beach.cinematics).toMatchObject({ transition: 'white_flash', grading: 'default', wind: 3 });
    expect(beach.audio?.bgmMood).toBe('bright');
    expect(beach.audio?.ambience).toBe('sea_waves');
    expect(beach.scene).toBe('beach');
    expect(beach.cinematics?.timeOfDay).toMatchObject({ from: 14.5, to: 17.6 });
    expect(beach.audio?.sfx?.map((s) => [s.id, s.delaySec])).toEqual([['waves', 0.1], ['wind', 1.2]]);
    expect(night.cinematics).toMatchObject({ transition: 'white_flash', grading: 'rainy_noir', wind: 2 });
    expect(night.audio?.bgmMood).toBe('mystic');
    expect(night.audio?.ambience).toBe('none');
    expect(night.scene).toBe('lineart_night');
    expect(night.cinematics?.timeOfDay).toBeUndefined();
    expect(night.audio?.sfx?.map((s) => [s.id, s.delaySec])).toEqual([['bell', 0.1], ['wind', 1.2]]);
    // 台词、镜头、动作两个分支一致
    expect(night.actor).toEqual(base.actor);
    expect(night.camera).toEqual(base.camera);
  });

  it('uses only ids the engine really implements (motions, moods, ambience, sfx, scenes, shots, transitions)', () => {
    const shots = new Set(Object.keys(SHOT_PRESETS));
    const scenes = new Set(Object.keys(APP_CONFIG.scenes.items));
    const check = (b: (typeof beats)[number], tag: string) => {
      for (const m of [b.actor.motion, b.actor.leadInMotion]) {
        if (m) expect(isMotionCatalogId(m), `${tag} motion ${m}`).toBe(true);
      }
      for (const cam of [b.camera]) {
        if (cam?.shot) expect(shots.has(cam.shot), `${tag} shot ${cam.shot}`).toBe(true);
      }
      const t = b.cinematics?.transition;
      if (t) expect(Object.keys(TRANSITION_SPECS), `${tag} transition`).toContain(t);
      if (b.scene) expect(scenes.has(resolveStoryScene(b.scene)), `${tag} scene ${b.scene}`).toBe(true);
      for (const c of b.choices ?? []) {
        if (c.scene) expect(scenes.has(resolveStoryScene(c.scene)), `${tag} choice scene ${c.scene}`).toBe(true);
      }
      const a = b.audio;
      if (!a) return;
      if (a.bgmMood) expect(Object.keys(BGM_MOODS).includes(BGM_MOOD_ALIASES[a.bgmMood] ?? a.bgmMood), `${tag} mood ${a.bgmMood}`).toBe(true);
      if (a.ambience && a.ambience !== 'none') expect((AMBIENCE_IDS as readonly string[]).includes(a.ambience), `${tag} ambience`).toBe(true);
      const sfx = [...(a.playSfx ? [a.playSfx] : []), ...(a.sfx ?? []).map((s) => s.id)];
      for (const id of sfx) expect((SFX_IDS as readonly string[]).includes(SFX_ALIASES[id] ?? id), `${tag} sfx ${id}`).toBe(true);
    };
    for (const b of beats) {
      check(b, b.id);
      for (const name of Object.keys(b.variants ?? {})) check(applyVariant(b, name), `${b.id}/${name}`);
    }
  });

  it('brings back the old showcase: outfit cards with previews + confirm, scene cards with previews + confirm, in the user\'s voice', () => {
    const outfit = prologueStory.beats.beat_outfit_choice;
    expect((outfit.choices ?? []).map((c) => [c.id, c.actionType, c.actionPayload])).toEqual([
      ['outfit_dress', 'swap_outfit', 'xiaochun_dinner_dress'],
      ['outfit_maid', 'swap_outfit', 'xiaochun_maid'],
      ['outfit_qipao', 'swap_outfit', 'xiaochun_cheongsam'],
    ]);
    const addons = Object.keys(APP_CONFIG.model.addons ?? {});
    for (const c of outfit.choices ?? []) expect(addons, `${c.id} outfit exists`).toContain(c.actionPayload);
    expect(outfit.confirmChoice?.id).toBe('outfit_confirm');
    const sceneCards = prologueStory.beats.beat_4.choices ?? [];
    expect(prologueStory.beats.beat_4.confirmChoice?.id).toBe('scene_confirm');
    for (const c of [...(outfit.choices ?? []), ...sceneCards]) {
      expect(c.image, `${c.id} has a preview`).toBeTruthy();
      expect(existsSync(resolve(__dirname, '../../../public', String(c.image).replace(/^\//, ''))), `${c.id} preview file`).toBe(true);
      expect(c.subText, `${c.id} has a sub line`).toBeDefined();
    }
    for (const c of sceneCards) expect(Object.keys(APP_CONFIG.scenes.items)).toContain(c.actionPayload);
  });

  it('maps the script scene names to real scene ids', () => {
    expect(resolveStoryScene('lineart_day')).toBe('light');
    expect(resolveStoryScene('lineart_night')).toBe('dark');
    expect(resolveStoryScene('beach')).toBe('beach3d');
    expect(resolveStoryScene('void')).toBe('void');
  });

  it('shows the cinematic rhythm: letterbox on → off, eye_blink in/out, white_flash to the new set, grading/wind per beat', () => {
    const b = prologueStory.beats;
    expect(b.beat_1.cinematics).toMatchObject({ letterbox: true, transition: 'eye_blink', grading: 'dream_bloom', wind: 0 });
    expect(b.beat_2.cinematics).toMatchObject({ letterbox: false, wind: 0 });
    expect(b.beat_3.camera?.movement).toBe('dutch_tilt');
    expect(b.beat_outfit_choice.camera).toMatchObject({ shot: 'full', movement: 'arc_sweep' });
    expect(b.beat_4.cinematics).toMatchObject({ grading: 'default', wind: 1 });
    expect(b.beat_6.cinematics).toMatchObject({ transition: 'eye_blink', grading: 'default', wind: 1 });
    expect(b.beat_1.scene).toBe('void');
    // 1: far behind her, slow dolly-in over about one line, never cuts to the front; 2: only then orbit round to her front
    expect(b.beat_1.camera).toMatchObject({ shot: 'full', movement: 'slow_push_in', startDistance: 6.5, startAzimuthOffsetDeg: 25, durationSec: 9 });
    expect(b.beat_1.actor.facing).toBe('back');
    expect(b.beat_2.camera).toMatchObject({ shot: 'medium_close_up', movement: 'orbit_to_front', durationSec: 2.4 });
    expect(b.beat_2.actor.facing).toBeUndefined(); // she is not told to step around: the orbit brings the camera to her front
    expect(b.beat_4.camera).toMatchObject({ shot: 'full', movement: 'pull_out', durationSec: 2.5 });
    expect(b.beat_5.camera).toMatchObject({ shot: 'wide', movement: 'hero_spiral_orbit', durationSec: 3.0 });
    expect(b.beat_6.camera).toMatchObject({ shot: 'medium', movement: 'none', durationSec: 2.0 });
  });
});
