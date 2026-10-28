import { describe, it, expect } from 'vitest';
import { normalizeStoryLang, resolveBeat, resolveLocalized } from '../localize';
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
});
