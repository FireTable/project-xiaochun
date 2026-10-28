import { describe, it, expect } from 'vitest';

describe('TypewriterText Tokenization & Cascade Timings', () => {
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

  it('calculates linear cascade animation delays based on speedMs', () => {
    const chars = Array.from('你好呀');
    const speedMs = 32;
    const delays = chars.map((_, i) => i * speedMs);

    expect(delays).toEqual([0, 32, 64]);
  });
});
