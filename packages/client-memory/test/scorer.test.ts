import { describe, expect, it } from 'vitest';
import { rankByCognitiveScore, type ScoredCandidate } from '../src/search/scorer';

describe('client-memory > Cognitive Scorer', () => {
  it('filters out candidates with 0 BM25 score (Strict Gating)', () => {
    const candidates: ScoredCandidate<string>[] = [
      { id: '1', ts: Date.now(), importance: 10, bm25Score: 0, data: 'irrelevant but important' },
      { id: '2', ts: Date.now(), importance: 5, bm25Score: 1.5, data: 'relevant' },
    ];

    const ranked = rankByCognitiveScore(candidates);
    expect(ranked.length).toBe(1);
    expect(ranked[0].id).toBe('2');
  });

  it('balances recency, importance, and relevance correctly', () => {
    const now = Date.now();
    const oneDayAgo = now - 86_400_000;
    const thirtyDaysAgo = now - 30 * 86_400_000;

    const candidates: ScoredCandidate<string>[] = [
      { id: 'recent_high', ts: oneDayAgo, importance: 9, bm25Score: 2.0, data: 'recent' },
      { id: 'old_high', ts: thirtyDaysAgo, importance: 9, bm25Score: 2.0, data: 'old' },
    ];

    const ranked = rankByCognitiveScore(candidates, { now, halfLifeDays: 7 });
    expect(ranked[0].id).toBe('recent_high');
    expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore);
  });
});
