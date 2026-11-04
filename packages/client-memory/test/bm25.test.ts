import { describe, expect, it } from 'vitest';
import { BM25Index } from '../src/search/bm25';

describe('client-memory > BM25Index', () => {
  it('indexes documents and returns ranked results by relevance', () => {
    const bm25 = new BM25Index();
    bm25.addDocument('doc1', '用户在杭州做独立游戏开发');
    bm25.addDocument('doc2', '今天天气晴朗，非常适合在海滩看日落');
    bm25.addDocument('doc3', '我养了一只柯基犬，名字叫旺财');

    const results = bm25.search('游戏开发');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('doc1');

    const petResults = bm25.search('柯基犬 宠物');
    expect(petResults.length).toBeGreaterThan(0);
    expect(petResults[0].id).toBe('doc3');
  });

  it('supports document removal and clearing', () => {
    const bm25 = new BM25Index();
    bm25.addDocument('d1', '测试文档一');
    expect(bm25.size).toBe(1);

    bm25.removeDocument('d1');
    expect(bm25.size).toBe(0);
    expect(bm25.search('测试')).toEqual([]);

    bm25.addDocument('d2', '测试文档二');
    bm25.clear();
    expect(bm25.size).toBe(0);
  });
});
