import { describe, it, expect } from 'vitest';
import { applyVariant, detectBrowserStoryLang, normalizeStoryLang, resolveBeat, resolveLocalized } from '../localize';
import { LocalizedStoryBeatSchema, StoryBeatSchema } from '../schema';

describe('story i18n resolution', () => {
  it('normalizes language tags to the three story languages', () => {
    expect(normalizeStoryLang('zh-CN')).toBe('zh-CN');
    expect(normalizeStoryLang('en')).toBe('en');
    expect(normalizeStoryLang('en-US')).toBe('en');
    expect(normalizeStoryLang('ja-JP')).toBe('ja');
    expect(normalizeStoryLang('zh-TW')).toBe('zh-CN');
    expect(normalizeStoryLang('fr')).toBe('zh-CN');
    expect(normalizeStoryLang(undefined)).toBe('zh-CN');
  });

  it('keeps plain strings language-agnostic and falls back to zh-CN for missing languages', () => {
    expect(resolveLocalized('hello', 'ja')).toBe('hello');
    expect(resolveLocalized({ 'zh-CN': '你好', en: 'Hello' }, 'en')).toBe('Hello');
    expect(resolveLocalized({ 'zh-CN': '你好', en: 'Hello' }, 'ja')).toBe('你好');
    expect(resolveLocalized(undefined, 'en')).toBe('');
  });

  it('evaluates getters lazily, at resolve time', () => {
    let calls = 0;
    const text = {
      get 'zh-CN'() {
        calls++;
        return '中';
      },
      en: 'en',
    };
    expect(calls).toBe(0);
    expect(resolveLocalized(text, 'en')).toBe('en');
    expect(calls).toBe(0);
    expect(resolveLocalized(text, 'zh-CN')).toBe('中');
    expect(calls).toBe(1);
  });

  it('resolves every text field of a beat to a single language', () => {
    const raw = LocalizedStoryBeatSchema.parse({
      id: 'b',
      cinematics: { intertitle: { text: { 'zh-CN': '黑', en: 'dark' } } },
      actor: { speechText: { 'zh-CN': '你好', en: 'Hi', ja: 'やあ' } },
      inputPlaceholder: { 'zh-CN': '说', en: 'say' },
      choices: [{ id: 'c', text: { 'zh-CN': '好', en: 'OK' }, subText: { 'zh-CN': '子', en: 'sub' }, nextBeatId: 'x' }],
    });
    const beat = resolveBeat(raw, 'en');
    expect(beat.actor.speechText).toBe('Hi');
    expect(beat.cinematics?.intertitle?.text).toBe('dark');
    expect(beat.inputPlaceholder).toBe('say');
    expect(beat.choices?.[0].text).toBe('OK');
    expect(beat.choices?.[0].subText).toBe('sub');
    // 解析结果是纯字符串 beat，能通过“单语”schema
    expect(StoryBeatSchema.safeParse(beat).success).toBe(true);
  });

  it('keeps function payloads intact', () => {
    const fn = () => undefined;
    const beat = resolveBeat(
      { id: 'b', actor: { expression: { base: 'neutral' }, speechText: 'x' }, choices: [{ id: 'c', text: 't', actionType: 'custom', actionPayload: fn }] },
      'ja',
    );
    expect(beat.choices?.[0].actionPayload).toBe(fn);
  });

  it('detects the browser language (zh / en / ja), falling back to en — unlike normalizeStoryLang, which falls back to zh', () => {
    expect(detectBrowserStoryLang(['ja-JP', 'en-US'])).toBe('ja');
    expect(detectBrowserStoryLang(['zh-TW'])).toBe('zh-CN');
    expect(detectBrowserStoryLang(['en-GB'])).toBe('en');
    expect(detectBrowserStoryLang(['fr-FR', 'de'])).toBe('en');
    expect(detectBrowserStoryLang(['fr-FR', 'ja'])).toBe('ja'); // 取偏好列表里第一个支持的
    expect(detectBrowserStoryLang([])).toBe('en');
  });

  it('merges a branch variant over the base beat without mutating it', () => {
    const base = LocalizedStoryBeatSchema.parse({
      id: 'b',
      cinematics: { transition: 'white_flash', grading: 'default', wind: 3 },
      audio: { bgmMood: 'bright', sfx: [{ id: 'waves' }] },
      actor: { speechText: 'line' },
      variants: { night: { cinematics: { grading: 'rainy_noir', wind: 2 }, audio: { bgmMood: 'mystic', sfx: [{ id: 'bell' }] } } },
    });
    const night = applyVariant(base, 'night');
    expect(night.cinematics).toMatchObject({ transition: 'white_flash', grading: 'rainy_noir', wind: 2 });
    expect(night.audio).toMatchObject({ bgmMood: 'mystic', sfx: [{ id: 'bell' }] });
    expect(night.actor).toEqual(base.actor);
    expect(base.cinematics).toMatchObject({ grading: 'default', wind: 3 });
    expect(applyVariant(base, 'beach')).toBe(base);
    expect(applyVariant(base, null)).toBe(base);
  });

  it('resolves hint, camera-task fallback and input reply text in the story language', () => {
    const beat = LocalizedStoryBeatSchema.parse({
      id: 'b',
      hint: { 'zh-CN': '环绕观察', en: 'Orbit', ja: '回す' },
      actor: { speechText: 'x' },
      cameraTask: { nextBeatId: 'n', fallback: { speechText: { 'zh-CN': '兜底', en: 'fallback', ja: 'フォールバック' } } },
      inputReply: { nextBeatId: 'n', speechText: { 'zh-CN': '回复', en: 'reply', ja: '返事' } },
    });
    const ja = resolveBeat(beat, 'ja');
    expect(ja.hint).toBe('回す');
    expect(ja.cameraTask?.fallback.speechText).toBe('フォールバック');
    expect(ja.cameraTask).toMatchObject({ orbitDeg: 35, zoomRatio: 0.2, timeoutMs: 6000 });
    expect(resolveBeat(beat, 'en').inputReply?.speechText).toBe('reply');
  });
});
