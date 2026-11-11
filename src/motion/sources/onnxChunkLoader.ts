export interface OnnxChunkEntry {
  name: string;
  offset: number;
  size: number;
}

export interface OnnxChunkManifest {
  version?: string;
  file?: string;
  sha256?: string;
  totalSize: number;
  chunkSize: number;
  chunkCount?: number;
  chunks: OnnxChunkEntry[];
}

export interface FetchOnnxOptions {
  /** Canonical single-file URL (used as the CacheStorage key and fallback URL). */
  url: string;
  /** Optional chunk manifest URL (e.g. `<base>/chunks/emage_step_int8.onnx.json`). */
  chunksManifestUrl?: string;
  /** CacheStorage bucket name (e.g. `emage-models-v2`). */
  cacheName: string;
  /** Max concurrent chunk downloads (default: 8). */
  concurrency?: number;
  /** Per-chunk retry count on transient failure (default: 2). */
  maxRetries?: number;
  /** Throttled progress callback during multi-chunk download. */
  onProgress?: (info: {
    loadedBytes: number;
    totalBytes: number;
    completedChunks: number;
    totalChunks: number;
  }) => void;
  fetchImpl?: typeof fetch;
  cachesImpl?: CacheStorage | null;
}

/**
 * Loads an ONNX binary from CacheStorage or network.
 * When `chunksManifestUrl` is reachable, streams slices in parallel into one
 * pre-allocated `Uint8Array(totalSize)` (1x peak RAM on WebKit) and caches the
 * stitched result under `url`; when the manifest 404s, falls back to `url`.
 */
export async function fetchOnnxWithCache(options: FetchOnnxOptions): Promise<ArrayBuffer> {
  const {
    url,
    chunksManifestUrl,
    cacheName,
    concurrency = 8,
    maxRetries = 2,
    onProgress,
    fetchImpl = fetch,
    cachesImpl = typeof caches !== 'undefined' ? caches : null,
  } = options;

  let cache: Cache | null = null;
  if (cachesImpl) {
    try {
      cache = await cachesImpl.open(cacheName);
      const match = await cache.match(url);
      if (match) {
        return await match.arrayBuffer();
      }
    } catch (e) {
      console.warn('[EMAGE Worker] CacheStorage access failed, fallback to direct fetch', e);
    }
  }

  if (chunksManifestUrl) {
    let manifest: OnnxChunkManifest | null = null;
    try {
      const mRes = await fetchImpl(chunksManifestUrl);
      if (mRes.ok) {
        manifest = parseManifest(await mRes.json());
      } else if (mRes.status !== 404) {
        console.warn(
          `[EMAGE Worker] Chunk manifest ${chunksManifestUrl} returned HTTP ${mRes.status}, falling back to ${url}`,
        );
      }
    } catch (e) {
      console.warn(`[EMAGE Worker] Chunk manifest fetch failed for ${chunksManifestUrl}, falling back to ${url}`, e);
    }

    if (manifest) {
      return await streamChunks(
        manifest,
        chunksManifestUrl,
        url,
        cache,
        Math.max(1, concurrency),
        Math.max(0, maxRetries),
        fetchImpl,
        onProgress,
      );
    }
  }

  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Fetch ${url} failed: HTTP ${res.status}`);

  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch (e) {
      console.warn('[EMAGE Worker] Cache put failed', e);
    }
  }
  return await res.arrayBuffer();
}

async function streamChunks(
  manifest: OnnxChunkManifest,
  manifestUrl: string,
  canonicalUrl: string,
  cache: Cache | null,
  concurrency: number,
  maxRetries: number,
  fetchImpl: typeof fetch,
  onProgress?: FetchOnnxOptions['onProgress'],
): Promise<ArrayBuffer> {
  const { chunks, totalSize } = manifest;
  const totalChunks = chunks.length;
  const merged = new Uint8Array(totalSize);
  const loadedPerChunk = new Array<number>(totalChunks).fill(0);
  let completedChunks = 0;
  let lastEmitMs = 0;

  const emit = (force: boolean) => {
    if (!onProgress) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - lastEmitMs < 120) return;
    lastEmitMs = now;
    let sum = 0;
    for (let i = 0; i < totalChunks; i++) sum += loadedPerChunk[i]!;
    onProgress({
      loadedBytes: sum,
      totalBytes: totalSize,
      completedChunks,
      totalChunks,
    });
  };

  emit(true);

  const fetchChunk = async (idx: number): Promise<void> => {
    const entry = chunks[idx]!;
    const chunkUrl = resolveChunkUrl(manifestUrl, entry.name);
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      loadedPerChunk[idx] = 0;
      try {
        const res = await fetchImpl(chunkUrl);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${chunkUrl}`);
        }

        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader();
          let written = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.byteLength > 0) {
                if (written + value.byteLength > entry.size) {
                  throw new Error(
                    `Chunk ${idx} overflow: expected ${entry.size} bytes, got > ${written + value.byteLength}`,
                  );
                }
                merged.set(value, entry.offset + written);
                written += value.byteLength;
                loadedPerChunk[idx] = written;
                emit(false);
              }
            }
          } finally {
            reader.releaseLock();
          }
          if (written !== entry.size) {
            throw new Error(`Chunk ${idx} truncated: expected ${entry.size} bytes, got ${written}`);
          }
        } else {
          const ab = await res.arrayBuffer();
          if (ab.byteLength !== entry.size) {
            throw new Error(`Chunk ${idx} size mismatch: expected ${entry.size} bytes, got ${ab.byteLength}`);
          }
          merged.set(new Uint8Array(ab), entry.offset);
          loadedPerChunk[idx] = ab.byteLength;
        }

        completedChunks++;
        emit(true);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };

  let cursor = 0;
  const workerCount = Math.min(concurrency, totalChunks);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < totalChunks) {
        const idx = cursor++;
        await fetchChunk(idx);
      }
    }),
  );

  if (cache) {
    try {
      // Response(TypedArray) copies bytes without detaching `merged.buffer`.
      await cache.put(
        canonicalUrl,
        new Response(merged, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(merged.byteLength),
          },
        }),
      );
    } catch (e) {
      console.warn('[EMAGE Worker] Cache put failed after chunk stitch', e);
    }
  }

  return merged.buffer;
}

function resolveChunkUrl(manifestUrl: string, chunkName: string): string {
  if (/^https?:\/\//i.test(chunkName) || chunkName.startsWith('/')) {
    return chunkName;
  }
  const qIdx = manifestUrl.indexOf('?');
  const baseNoQuery = qIdx >= 0 ? manifestUrl.slice(0, qIdx) : manifestUrl;
  const query = qIdx >= 0 ? manifestUrl.slice(qIdx) : '';
  const slashIdx = baseNoQuery.lastIndexOf('/');
  const dir = slashIdx >= 0 ? baseNoQuery.slice(0, slashIdx + 1) : '';
  return `${dir}${chunkName}${query}`;
}

function parseManifest(raw: unknown): OnnxChunkManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid ONNX chunk manifest: expected object');
  }
  const m = raw as Partial<OnnxChunkManifest>;
  const totalSize = Number(m.totalSize);
  if (!Number.isInteger(totalSize) || totalSize <= 0) {
    throw new Error(`Invalid ONNX chunk manifest totalSize: ${String(m.totalSize)}`);
  }
  if (!Array.isArray(m.chunks) || m.chunks.length === 0) {
    throw new Error('Invalid ONNX chunk manifest: empty chunks array');
  }

  let summed = 0;
  const chunks: OnnxChunkEntry[] = m.chunks.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name) {
      throw new Error(`Invalid chunk entry at index ${i}`);
    }
    const offset = Number(entry.offset);
    const size = Number(entry.size);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(size) || size <= 0) {
      throw new Error(`Invalid offset/size in chunk ${i}`);
    }
    if (offset + size > totalSize) {
      throw new Error(`Chunk ${i} exceeds totalSize (${offset} + ${size} > ${totalSize})`);
    }
    summed += size;
    return { name: entry.name, offset, size };
  });

  if (summed !== totalSize) {
    throw new Error(`Manifest chunk sizes sum (${summed}) !== totalSize (${totalSize})`);
  }

  return {
    version: m.version,
    file: m.file,
    sha256: m.sha256,
    totalSize,
    chunkSize: Number(m.chunkSize) || chunks[0]!.size,
    chunkCount: chunks.length,
    chunks,
  };
}
