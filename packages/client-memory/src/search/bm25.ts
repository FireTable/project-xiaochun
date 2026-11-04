import { tokenize } from './tokenizer';

export interface BM25Doc<T = unknown> {
  id: string;
  length: number;
  data?: T;
}

export interface BM25SearchResult<T = unknown> {
  id: string;
  score: number;
  data?: T;
}

export class BM25Index<T = unknown> {
  private k1: number;
  private b: number;
  private lang: string;

  private docs: Map<string, BM25Doc<T>> = new Map();
  // term -> (docId -> termFreq)
  private invertedIndex: Map<string, Map<string, number>> = new Map();
  private totalLength = 0;

  constructor(options?: { k1?: number; b?: number; lang?: string }) {
    this.k1 = options?.k1 ?? 1.2;
    this.b = options?.b ?? 0.75;
    this.lang = options?.lang ?? 'zh';
  }

  get size(): number {
    return this.docs.size;
  }

  get avgDocLength(): number {
    if (this.docs.size === 0) return 0;
    return this.totalLength / this.docs.size;
  }

  addDocument(id: string, text: string, data?: T): void {
    if (this.docs.has(id)) {
      this.removeDocument(id);
    }

    const tokens = tokenize(text, this.lang);
    const length = tokens.length;
    if (length === 0) return;

    // Term frequencies
    const tfMap = new Map<string, number>();
    for (const t of tokens) {
      tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
    }

    // Update inverted index
    for (const [term, freq] of tfMap.entries()) {
      let postings = this.invertedIndex.get(term);
      if (!postings) {
        postings = new Map();
        this.invertedIndex.set(term, postings);
      }
      postings.set(id, freq);
    }

    this.docs.set(id, { id, length, data });
    this.totalLength += length;
  }

  removeDocument(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;

    for (const [term, postings] of this.invertedIndex.entries()) {
      postings.delete(id);
      if (postings.size === 0) {
        this.invertedIndex.delete(term);
      }
    }
    this.totalLength -= doc.length;
    this.docs.delete(id);
  }

  clear(): void {
    this.docs.clear();
    this.invertedIndex.clear();
    this.totalLength = 0;
  }

  search(query: string, topK = 5): BM25SearchResult<T>[] {
    const queryTokens = tokenize(query, this.lang);
    if (queryTokens.length === 0 || this.docs.size === 0) return [];

    const N = this.docs.size;
    const avgdl = this.avgDocLength;
    const scores = new Map<string, number>();

    for (const term of queryTokens) {
      const postings = this.invertedIndex.get(term);
      if (!postings || postings.size === 0) continue;

      const n_q = postings.size;
      // Robertson-Spärck Jones IDF with smoothing
      const idf = Math.log(1 + (N - n_q + 0.5) / (n_q + 0.5));

      for (const [docId, f_qd] of postings.entries()) {
        const doc = this.docs.get(docId);
        if (!doc) continue;

        const num = f_qd * (this.k1 + 1);
        const den = f_qd + this.k1 * (1 - this.b + this.b * (doc.length / (avgdl || 1)));
        const termScore = idf * (num / den);

        scores.set(docId, (scores.get(docId) ?? 0) + termScore);
      }
    }

    const results: BM25SearchResult<T>[] = [];
    for (const [docId, score] of scores.entries()) {
      if (score > 0) {
        const doc = this.docs.get(docId);
        results.push({ id: docId, score, data: doc?.data });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}
