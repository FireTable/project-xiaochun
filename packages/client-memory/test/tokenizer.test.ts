import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/search/tokenizer';

describe('client-memory > Tokenizer', () => {
  it('tokenizes Chinese sentences and extracts meaningful tokens', () => {
    const tokens = tokenize('我特别喜欢喝冰美式咖啡');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.some((t) => t.includes('咖啡') || t.includes('美式') || t.includes('喜欢'))).toBe(true);
  });

  it('tokenizes English sentences and filters stopwords', () => {
    const tokens = tokenize('The quick brown fox jumps over the lazy dog');
    expect(tokens).toContain('quick');
    expect(tokens).toContain('brown');
    expect(tokens).toContain('fox');
    expect(tokens).not.toContain('the');
  });

  it('tokenizes Japanese sentences', () => {
    const tokens = tokenize('私はアイスコーヒーが好きです');
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('handles empty or whitespace strings gracefully', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});
