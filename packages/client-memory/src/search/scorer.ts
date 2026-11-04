export interface ScoredCandidate<T> {
  id: string;
  ts: number;
  importance: number; // 1-10
  bm25Score: number;
  data: T;
}

export interface RankedResult<T> {
  id: string;
  finalScore: number;
  recencyScore: number;
  importanceScore: number;
  bm25Score: number;
  data: T;
}

export function rankByCognitiveScore<T>(
  candidates: ScoredCandidate<T>[],
  options?: {
    now?: number;
    halfLifeDays?: number;
    weights?: { recency: number; importance: number; relevance: number };
  },
): RankedResult<T>[] {
  // Gating invariant: Reject any candidate without lexical match
  const filtered = candidates.filter((c) => c.bm25Score > 0);
  if (filtered.length === 0) return [];

  const now = options?.now ?? Date.now();
  const halfLifeDays = options?.halfLifeDays ?? 7;
  const lambda = Math.LN2 / Math.max(1, halfLifeDays);

  const wR = options?.weights?.recency ?? 0.2;
  const wI = options?.weights?.importance ?? 0.3;
  const wS = options?.weights?.relevance ?? 0.5;

  let maxBm25 = 0.0001;
  for (const c of filtered) {
    if (c.bm25Score > maxBm25) maxBm25 = c.bm25Score;
  }

  const ranked: RankedResult<T>[] = filtered.map((c) => {
    // 1. Recency in days
    const deltaDays = Math.max(0, (now - c.ts) / 86_400_000);
    const recencyScore = Math.exp(-lambda * deltaDays);

    // 2. Importance normalized (1..10 -> 0.1..1.0)
    const importanceScore = Math.min(10, Math.max(1, c.importance)) / 10;

    // 3. Relevance normalized to [0, 1]
    const normRelevance = c.bm25Score / maxBm25;

    // Combined score
    const finalScore = wR * recencyScore + wI * importanceScore + wS * normRelevance;

    return {
      id: c.id,
      finalScore,
      recencyScore,
      importanceScore,
      bm25Score: c.bm25Score,
      data: c.data,
    };
  });

  ranked.sort((a, b) => b.finalScore - a.finalScore);
  return ranked;
}
