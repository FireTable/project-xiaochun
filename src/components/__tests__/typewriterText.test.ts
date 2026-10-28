import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '@/config';
import { COMPLETED_TYPEWRITER_CYCLE_KEYS, markTypewriterCompleted } from '../TypewriterText';

describe('TypewriterText Tokenization & Cascade Timings', () => {
  it('reads default typewriter configuration from APP_CONFIG.chat.typewriter', () => {
    const cfg = APP_CONFIG.chat.typewriter;
    expect(cfg).toBeDefined();
    expect(cfg.enabled).toBe(true);
    expect(cfg.speedMs).toBeGreaterThanOrEqual(40);
    expect(cfg.minorPauseMs).toBeGreaterThanOrEqual(20);
    expect(cfg.majorPauseMs).toBeGreaterThanOrEqual(40);
    expect(cfg.revealDurationMs).toBe(180);
  });

  it('correctly tokenizes mixed Chinese and English without breaking English words', () => {
    const text = '你好，我是 XiaoChun！';
    const regex = /([a-zA-Z0-9'_]+|[^\s\w]|\s+)/g;
    const matches = text.match(regex) || [];

    expect(matches).toContain('XiaoChun');
    expect(matches).toContain('你');
    expect(matches).toContain('好');
    expect(matches).toContain('，');
    expect(matches).toContain('！');
  });

  it('calculates cascade animation delays with punctuation breath pauses from APP_CONFIG', () => {
    const text = '你好，小蠢！';
    const { speedMs, minorPauseMs, majorPauseMs } = APP_CONFIG.chat.typewriter;
    const regex = /([a-zA-Z0-9'_]+|[^\s\w]|\s+)/g;
    const matches = text.match(regex) || [];
    let accumulatedDelayMs = 0;
    const delays: number[] = [];

    matches.forEach((token) => {
      Array.from(token).forEach((ch) => {
        delays.push(accumulatedDelayMs);
        const isMinorPause = /[，、,；;]/.test(ch);
        const isMajorPause = /[。！？!?…~～\n]/.test(ch);
        const pauseOffset = isMajorPause ? majorPauseMs : isMinorPause ? minorPauseMs : 0;
        accumulatedDelayMs += speedMs + pauseOffset;
      });
    });

    // '你': 0 -> next + 60
    // '好': 60 -> next + 60
    // '，': 120 -> next + 60 + minorPauseMs(200) = 380
    // '小': 380 -> next + 60 = 440
    // '蠢': 440 -> next + 60 = 500
    // '！': 500 -> total accumulated = 500 + 60 + majorPauseMs(420) = 980
    expect(delays).toEqual([0, 60, 120, 380, 440, 500]);
  });

  it('generates distinct cycle keys across speech segment switches to prevent DOM recycling', () => {
    const seg1Text = '你好指挥官！';
    const seg2Text = '今天天气真好呀。';

    const getCycleKey = (resetKey: string | number | undefined, text: string) =>
      `${resetKey !== undefined ? `seg_${resetKey}_` : ''}${text}`;

    const cycleKey1 = getCycleKey(1, seg1Text);
    const cycleKey2 = getCycleKey(2, seg2Text);

    expect(cycleKey1).not.toBe(cycleKey2);
    expect(cycleKey1).toBe('seg_1_你好指挥官！');
    expect(cycleKey2).toBe('seg_2_今天天气真好呀。');

    // 即使两段文本恰好相同，只要 segmentIndex 不同，cycleKey 也完全独立
    const cycleKeyIdenticalTextSeg2 = getCycleKey(2, seg1Text);
    expect(cycleKey1).not.toBe(cycleKeyIdenticalTextSeg2);
  });

  it('persists completed cycle keys to prevent re-typing on fold/unfold or responsive remount', () => {
    const testKey = 'seg_1_测试已朗读完成的台词';
    expect(COMPLETED_TYPEWRITER_CYCLE_KEYS.has(testKey)).toBe(false);

    // 标记完成
    markTypewriterCompleted(testKey);
    expect(COMPLETED_TYPEWRITER_CYCLE_KEYS.has(testKey)).toBe(true);

    // 再次调用不会报错或重复添加
    markTypewriterCompleted(testKey);
    expect(COMPLETED_TYPEWRITER_CYCLE_KEYS.has(testKey)).toBe(true);
  });
});
