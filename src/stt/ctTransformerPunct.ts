/**
 * ctTransformerPunct.ts — On-Device CT-Transformer Punctuation Model for STT.
 *
 * Runs official Alibaba FunASR / sherpa-onnx CT-Transformer (int8) via onnxruntime-web.
 * Accurately restores Chinese/English commas (，), periods (。), question marks (？), and pause marks (、).
 */
import * as ort from 'onnxruntime-web';
import { APP_CONFIG } from '@/config';

const PUNCT = APP_CONFIG.stt.punctuation;
const PUNC_LIST = ['<unk>', '_', '，', '。', '？', '、'];

export class CtTransformerPunct {
  private session: ort.InferenceSession | null = null;
  private token2id: Map<string, number> | null = null;
  private unkId = 0;
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  public isReady(): boolean {
    return this.isLoaded && this.session !== null;
  }

  public async load(): Promise<void> {
    if (this.isLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        console.log('[CT-Transformer] 开始在 Worker 中下载/加载标点模型...');
        const [modelBuf, tokensBuf] = await Promise.all([
          this.fetchAsset(PUNCT.modelFile),
          this.fetchAsset(PUNCT.tokensFile),
        ]);

        const tokensJson = JSON.parse(new TextDecoder().decode(tokensBuf)) as string[];
        const map = new Map<string, number>();
        for (let i = 0; i < tokensJson.length; i++) {
          map.set(tokensJson[i]!, i);
        }
        this.token2id = map;
        this.unkId = map.get('<unk>') ?? 0;

        // Match emageWorker & sttWorker: buffer load; typings lag runtime (URL-only overload in .d.ts).
        this.session = await ort.InferenceSession.create(new Uint8Array(modelBuf) as any, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });

        this.isLoaded = true;
        console.log(
          '%c[CT-Transformer] 标点模型加载就绪，接管全局标点！',
          'color: #10b981; font-weight: bold;',
        );
      } catch (e) {
        this.isLoaded = false;
        this.session = null;
        this.loadPromise = null;
        console.warn('[CT-Transformer] 标点模型加载失败，继续使用启发式保底:', e);
      }
    })();

    return this.loadPromise;
  }

  private async fetchAsset(file: string): Promise<ArrayBuffer> {
    const key = `https://xiaochun.local/${PUNCT.cacheName}/${file}`;
    let cache: Cache | null = null;
    try {
      if (typeof caches !== 'undefined') {
        cache = await caches.open(PUNCT.cacheName);
        const hit = await cache.match(key);
        if (hit) {
          return await hit.arrayBuffer();
        }
      }
    } catch {
      // cache storage fallback
    }

    const url = `${PUNCT.base}/${file}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Fetch ${url} failed: HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (cache) {
      try {
        await cache.put(key, new Response(buf.slice(0), { headers: res.headers }));
      } catch {
        // ignore cache write error
      }
    }
    return buf;
  }

  public tokenize(text: string): string[] {
    const tokens: string[] = [];
    const regex = /[a-zA-Z0-9]+|[^\x00-\x7F\s]/gu;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      tokens.push(m[0]);
    }
    return tokens;
  }

  public async punctuate(text: string): Promise<string> {
    if (!text || !text.trim() || !this.session || !this.token2id) {
      return text;
    }

    // Strip existing punctuation and symbols before tokenizing to avoid <unk> pollution and duplicate punctuation (e.g. ，， or ，。)
    const cleanText = text.replace(/[\p{P}\p{S}]+/gu, ' ').trim();
    if (!cleanText) return text;

    const tokens = this.tokenize(cleanText);
    if (tokens.length === 0) return text;

    const tokenIds = new Int32Array(tokens.length);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      tokenIds[i] = this.token2id.get(t.toLowerCase()) ?? this.token2id.get(t) ?? this.unkId;
    }

    const inputsTensor = new ort.Tensor('int32', tokenIds, [1, tokens.length]);
    const lengthsTensor = new ort.Tensor('int32', new Int32Array([tokens.length]), [1]);

    const feeds: Record<string, ort.Tensor> = {
      inputs: inputsTensor,
      text_lengths: lengthsTensor,
    };

    const out = await this.session.run(feeds);
    const logits = (out.logits ?? out[Object.keys(out)[0]!]) as ort.Tensor;
    const data = logits.data as Float32Array;
    const numPunc = PUNC_LIST.length;

    const result: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const word = tokens[i]!;
      // Space between consecutive English/ASCII tokens
      if (i > 0 && /^[a-zA-Z0-9]/.test(word) && /^[a-zA-Z0-9]/.test(tokens[i - 1]!)) {
        result.push(' ');
      }
      result.push(word);

      // Argmax over punctuation classes
      const offset = i * numPunc;
      let maxIdx = 1; // default '_' (no punctuation)
      let maxScore = -Infinity;
      for (let p = 0; p < numPunc; p++) {
        const score = data[offset + p]!;
        if (score > maxScore) {
          maxScore = score;
          maxIdx = p;
        }
      }

      const punc = PUNC_LIST[maxIdx];
      if (punc && punc !== '_' && punc !== '<unk>') {
        result.push(punc);
      }
    }

    let punctuated = result.join('');
    // Terminal punctuation guarantee
    punctuated = punctuated.replace(/[，、]\s*$/, '。');
    if (!/[。？！?!.]$/.test(punctuated)) {
      punctuated += '。';
    }

    return punctuated;
  }
}

export const ctTransformerPunct = new CtTransformerPunct();
