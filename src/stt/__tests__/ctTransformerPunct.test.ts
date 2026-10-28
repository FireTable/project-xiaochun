import { describe, it, expect } from 'vitest';
import { CtTransformerPunct } from '../ctTransformerPunct';

describe('CtTransformerPunct Tokenization & Pipeline', () => {
  it('tokenizes Chinese characters into individual characters and English into words', () => {
    const punct = new CtTransformerPunct();
    const tokens = punct.tokenize('简单说两句Hello world测试123');
    expect(tokens).toEqual([
      '简', '单', '说', '两', '句',
      'Hello', 'world',
      '测', '试',
      '123',
    ]);
  });

  it('safely passes through original text when model is not yet loaded', async () => {
    const punct = new CtTransformerPunct();
    expect(punct.isReady()).toBe(false);
    const res = await punct.punctuate('简单说两句我们这个项目');
    expect(res).toBe('简单说两句我们这个项目');
  });

  it('punctuate with mock session inserts commas and terminal periods', async () => {
    const punct = new CtTransformerPunct();
    const mockMap = new Map<string, number>([
      ['你', 1],
      ['好', 2],
      ['小', 3],
      ['春', 4],
    ]);
    (punct as any).token2id = mockMap;
    (punct as any).unkId = 0;
    (punct as any).isLoaded = true;

    // Mock ORT session: 4 tokens: '你' (punc=1 _), '好' (punc=2 ，), '小' (punc=1 _), '春' (punc=3 。)
    (punct as any).session = {
      run: async () => {
        // Logits shape: [1, 4, 6]
        const data = new Float32Array(4 * 6);
        // Token 0 ('你'): max at index 1 ('_')
        data[0 * 6 + 1] = 5.0;
        // Token 1 ('好'): max at index 2 ('，')
        data[1 * 6 + 2] = 5.0;
        // Token 2 ('小'): max at index 1 ('_')
        data[2 * 6 + 1] = 5.0;
        // Token 3 ('春'): max at index 3 ('。')
        data[3 * 6 + 3] = 5.0;

        return {
          logits: { data },
        };
      },
    };

    const res = await punct.punctuate('你好小春');
    expect(res).toBe('你好，小春。');
  });

  it('strips existing punctuation before tokenizing to avoid double punctuation', async () => {
    const punct = new CtTransformerPunct();
    const mockMap = new Map<string, number>([
      ['你', 1],
      ['好', 2],
      ['小', 3],
      ['春', 4],
    ]);
    (punct as any).token2id = mockMap;
    (punct as any).unkId = 0;
    (punct as any).isLoaded = true;

    (punct as any).session = {
      run: async (feeds: Record<string, any>) => {
        // Assert token input length is 4 (no punctuation tokens entered)
        expect(feeds.inputs.dims[1]).toBe(4);
        const data = new Float32Array(4 * 6);
        data[0 * 6 + 1] = 5.0; // 你: _
        data[1 * 6 + 2] = 5.0; // 好: ，
        data[2 * 6 + 1] = 5.0; // 小: _
        data[3 * 6 + 3] = 5.0; // 春: 。
        return { logits: { data } };
      },
    };

    const res = await punct.punctuate('你好，小春。');
    expect(res).toBe('你好，小春。');
  });
});
