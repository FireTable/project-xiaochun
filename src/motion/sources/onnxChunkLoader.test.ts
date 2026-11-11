import { describe, expect, it, vi } from 'vitest';
import { fetchOnnxWithCache } from './onnxChunkLoader';

function makeMockCacheStorage() {
  const buckets = new Map<string, Map<string, Uint8Array>>();
  const cachesImpl = {
    async open(name: string) {
      let bucket = buckets.get(name);
      if (!bucket) {
        bucket = new Map();
        buckets.set(name, bucket);
      }
      return {
        async match(req: RequestInfo | URL) {
          const key = typeof req === 'string' ? req : req.toString();
          const bytes = bucket!.get(key);
          if (!bytes) return undefined;
          return new Response(bytes.slice());
        },
        async put(req: RequestInfo | URL, res: Response) {
          const key = typeof req === 'string' ? req : req.toString();
          const ab = await res.arrayBuffer();
          bucket!.set(key, new Uint8Array(ab));
        },
      } as unknown as Cache;
    },
  } as unknown as CacheStorage;
  return { cachesImpl, buckets };
}

function makeStreamResponse(bytes: Uint8Array, packetSize = 7): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.byteLength; i += packetSize) {
        controller.enqueue(bytes.subarray(i, Math.min(i + packetSize, bytes.byteLength)));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('fetchOnnxWithCache', () => {
  it('streams chunks in parallel into a single buffer and caches under canonical URL for 0-fetch warm reload', async () => {
    const expected = new Uint8Array(100);
    for (let i = 0; i < expected.length; i++) expected[i] = (i * 37 + 13) & 0xff;

    const c0 = expected.subarray(0, 40);
    const c1 = expected.subarray(40, 80);
    const c2 = expected.subarray(80, 100);

    const manifest = {
      version: '1.0.0',
      file: 'emage_step_int8.onnx',
      totalSize: 100,
      chunkSize: 40,
      chunks: [
        { name: 'emage_step_int8.onnx.0', offset: 0, size: 40 },
        { name: 'emage_step_int8.onnx.1', offset: 40, size: 40 },
        { name: 'emage_step_int8.onnx.2', offset: 80, size: 20 },
      ],
    };

    const { cachesImpl, buckets } = makeMockCacheStorage();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u === 'https://cdn.firetable.tech/xiaochun/emage/chunks/emage_step_int8.onnx.json') {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      if (u.endsWith('.onnx.0')) return makeStreamResponse(c0, 11);
      if (u.endsWith('.onnx.1')) return makeStreamResponse(c1, 9);
      if (u.endsWith('.onnx.2')) return makeStreamResponse(c2, 6);
      return new Response('Not Found', { status: 404 });
    });

    const progressSnapshots: number[] = [];
    const ab1 = await fetchOnnxWithCache({
      url: 'https://cdn.firetable.tech/xiaochun/emage/emage_step_int8.onnx',
      chunksManifestUrl: 'https://cdn.firetable.tech/xiaochun/emage/chunks/emage_step_int8.onnx.json',
      cacheName: 'emage-models-v2',
      concurrency: 3,
      fetchImpl: fetchMock as unknown as typeof fetch,
      cachesImpl,
      onProgress: ({ completedChunks }) => progressSnapshots.push(completedChunks),
    });

    expect(new Uint8Array(ab1)).toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 manifest + 3 chunks
    expect(progressSnapshots[progressSnapshots.length - 1]).toBe(3);
    expect(buckets.get('emage-models-v2')?.has('https://cdn.firetable.tech/xiaochun/emage/emage_step_int8.onnx')).toBe(
      true,
    );

    // Warm reload: hits CacheStorage directly with 0 network calls
    fetchMock.mockClear();
    const ab2 = await fetchOnnxWithCache({
      url: 'https://cdn.firetable.tech/xiaochun/emage/emage_step_int8.onnx',
      chunksManifestUrl: 'https://cdn.firetable.tech/xiaochun/emage/chunks/emage_step_int8.onnx.json',
      cacheName: 'emage-models-v2',
      fetchImpl: fetchMock as unknown as typeof fetch,
      cachesImpl,
    });
    expect(new Uint8Array(ab2)).toEqual(expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a transiently failing chunk without restarting completed chunks', async () => {
    const expected = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const manifest = {
      totalSize: 8,
      chunkSize: 4,
      chunks: [
        { name: 'm.0', offset: 0, size: 4 },
        { name: 'm.1', offset: 4, size: 4 },
      ],
    };

    let c1Attempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith('/emage/chunks/m.json')) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      if (u === '/emage/chunks/m.0') {
        return makeStreamResponse(expected.subarray(0, 4), 2);
      }
      if (u === '/emage/chunks/m.1') {
        c1Attempts++;
        if (c1Attempts === 1) {
          return new Response('Bad Gateway', { status: 502 });
        }
        return makeStreamResponse(expected.subarray(4, 8), 2);
      }
      return new Response('Not Found', { status: 404 });
    });

    const ab = await fetchOnnxWithCache({
      url: '/emage/m.onnx',
      chunksManifestUrl: '/emage/chunks/m.json',
      cacheName: 'emage-models-v2',
      maxRetries: 1,
      fetchImpl: fetchMock as unknown as typeof fetch,
      cachesImpl: null,
    });

    expect(new Uint8Array(ab)).toEqual(expected);
    expect(c1Attempts).toBe(2);
  });

  it('falls back seamlessly to single-file ONNX when chunk manifest returns 404 (local dev /onnx)', async () => {
    const singleBytes = new Uint8Array([9, 8, 7, 6, 5]);
    const { cachesImpl } = makeMockCacheStorage();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u === '/onnx/chunks/emage_step_int8.onnx.json') {
        return new Response('Not Found', { status: 404 });
      }
      if (u === '/onnx/emage_step_int8.onnx') {
        return new Response(singleBytes, { status: 200 });
      }
      return new Response('Unexpected', { status: 500 });
    });

    const ab = await fetchOnnxWithCache({
      url: '/onnx/emage_step_int8.onnx',
      chunksManifestUrl: '/onnx/chunks/emage_step_int8.onnx.json',
      cacheName: 'emage-models-v2',
      fetchImpl: fetchMock as unknown as typeof fetch,
      cachesImpl,
    });

    expect(new Uint8Array(ab)).toEqual(singleBytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects truncated chunks and never caches corrupt bytes', async () => {
    const { cachesImpl, buckets } = makeMockCacheStorage();
    const manifest = {
      totalSize: 10,
      chunkSize: 10,
      chunks: [{ name: 'bad.0', offset: 0, size: 10 }],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith('bad.json')) return new Response(JSON.stringify(manifest), { status: 200 });
      return makeStreamResponse(new Uint8Array([1, 2, 3, 4]), 2); // Only 4 of 10 bytes!
    });

    await expect(
      fetchOnnxWithCache({
        url: 'https://cdn.firetable.tech/bad.onnx',
        chunksManifestUrl: 'https://cdn.firetable.tech/chunks/bad.json',
        cacheName: 'emage-models-v2',
        maxRetries: 0,
        fetchImpl: fetchMock as unknown as typeof fetch,
        cachesImpl,
      }),
    ).rejects.toThrow(/truncated/i);

    expect(buckets.get('emage-models-v2')?.size ?? 0).toBe(0);
  });
});
