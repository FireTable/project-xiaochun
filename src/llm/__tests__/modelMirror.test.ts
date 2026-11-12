import { afterEach, describe, expect, it } from 'vitest';
import {
  CANONICAL_HF_ORIGIN,
  CANONICAL_MLC_WASM_PREFIX,
  fetchArtifactResponseWithAcceleration,
  fetchArtifactWithMirrorFailover,
  resolveArtifactMirrorUrls,
  setArtifactMirrorConfig,
  setWebGPUFramePacing,
  toCanonicalArtifactUrl,
} from '@mlc-ai/web-llm';
import {
  GHFAST_MLC_WASM_PREFIX,
  HF_MIRROR_ORIGIN,
  JSDELIVR_CDN_MLC_WASM_PREFIX,
  JSDELIVR_CF_MLC_WASM_PREFIX,
  resetMirrorProbeCacheForTests,
  resolveBestMirrorConfig,
} from '../modelMirror';

afterEach(() => {
  setArtifactMirrorConfig(null);
  setWebGPUFramePacing({ preset: 'desktop', enabled: true });
  resetMirrorProbeCacheForTests();
});

describe('Auto Region / IP + Live CORS Race Mirror Resolver', () => {
  it('selects hf-mirror.com and jsdelivr when edge IP is CN and domestic mirrors succeed', async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url === '/api/region') {
        return new Response(JSON.stringify({ country: 'CN' }), { status: 200 });
      }
      if (url.startsWith(HF_MIRROR_ORIGIN)) {
        return new Response('{}', { status: 200 });
      }
      if (url.startsWith(JSDELIVR_CF_MLC_WASM_PREFIX)) {
        return new Response(null, { status: 200 });
      }
      throw new TypeError('Failed to fetch (blocked)');
    };

    const cfg = await resolveBestMirrorConfig({
      fetchImpl: fakeFetch,
      timeZone: 'Asia/Shanghai',
      skipCache: true,
    });

    expect(cfg.hfOrigins).toEqual([HF_MIRROR_ORIGIN, CANONICAL_HF_ORIGIN]);
    expect(cfg.wasmLibPrefixes?.[0]).toBe(JSDELIVR_CF_MLC_WASM_PREFIX);
    expect(cfg.wasmLibPrefixes).toContain(CANONICAL_MLC_WASM_PREFIX);
  });

  it('auto-falls back to huggingface.co when CN user has TUN VPN and hf-mirror geo-308 fails CORS', async () => {
    const start = performance.now();
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url === '/api/region') {
        // Local dev or split-tunnel where /api/region still sees CN or null
        return new Response(JSON.stringify({ country: 'CN' }), { status: 200 });
      }
      if (url.startsWith(HF_MIRROR_ORIGIN)) {
        // Simulate browser CORS rejection on hf-mirror 308 -> huggingface.co without ACAO header
        throw new TypeError('CORS error on 308 redirect');
      }
      if (url.startsWith(CANONICAL_HF_ORIGIN)) {
        return new Response('{}', { status: 200 });
      }
      if (url.startsWith(JSDELIVR_CDN_MLC_WASM_PREFIX)) {
        return new Response(null, { status: 200 });
      }
      throw new TypeError('Failed to fetch');
    };

    const cfg = await resolveBestMirrorConfig({
      fetchImpl: fakeFetch,
      timeZone: 'Asia/Shanghai',
      skipCache: true,
    });
    const elapsed = performance.now() - start;

    expect(cfg.hfOrigins).toEqual([CANONICAL_HF_ORIGIN, HF_MIRROR_ORIGIN]);
    expect(cfg.wasmLibPrefixes?.[0]).toBe(JSDELIVR_CDN_MLC_WASM_PREFIX);
    // Failure of primary candidate wakes staggered backup immediately (< 60ms)
    expect(elapsed).toBeLessThan(60);
  });

  it('prioritizes huggingface.co immediately when edge IP is non-CN even if timezone is Asia/Shanghai', async () => {
    const requestedUrls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === '/api/region') {
        return new Response(JSON.stringify({ country: 'SG' }), { status: 200 });
      }
      if (url.startsWith(CANONICAL_HF_ORIGIN) || url.startsWith(CANONICAL_MLC_WASM_PREFIX)) {
        return new Response('{}', { status: 200 });
      }
      return new Response(null, { status: 503 });
    };

    const cfg = await resolveBestMirrorConfig({
      fetchImpl: fakeFetch,
      timeZone: 'Asia/Shanghai',
      skipCache: true,
    });

    expect(cfg.hfOrigins).toEqual([CANONICAL_HF_ORIGIN, HF_MIRROR_ORIGIN]);
    expect(cfg.wasmLibPrefixes?.[0]).toBe(CANONICAL_MLC_WASM_PREFIX);
    // Staggered hf-mirror should not even need to fire when huggingface.co wins at 0ms
    expect(requestedUrls.some((u) => u.startsWith(HF_MIRROR_ORIGIN))).toBe(false);
  });

  it('honors explicit custom HF endpoint while retaining canonical & mirror fallbacks', async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url === '/api/region') return new Response(JSON.stringify({ country: null }), { status: 200 });
      return new Response(null, { status: 200 });
    };

    const cfg = await resolveBestMirrorConfig({
      fetchImpl: fakeFetch,
      explicitHfEndpoint: 'https://custom-hf.example.com/',
      skipCache: true,
    });

    expect(cfg.hfOrigins?.[0]).toBe('https://custom-hf.example.com');
    expect(cfg.hfOrigins).toContain(CANONICAL_HF_ORIGIN);
    expect(cfg.hfOrigins).toContain(HF_MIRROR_ORIGIN);
  });
});

describe('Canonical Cache Keys, Per-Request Failover & Parallel HTTP Range Acceleration', () => {
  it('normalizes mirror URLs back to canonical Hugging Face and MLC WASM cache keys', () => {
    setArtifactMirrorConfig({
      hfOrigins: ['https://custom-hf.example.com', HF_MIRROR_ORIGIN, CANONICAL_HF_ORIGIN],
      wasmLibPrefixes: [JSDELIVR_CF_MLC_WASM_PREFIX, GHFAST_MLC_WASM_PREFIX, CANONICAL_MLC_WASM_PREFIX],
    });

    const canonicalShard =
      'https://huggingface.co/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC/resolve/main/params_shard_0.bin';
    expect(
      toCanonicalArtifactUrl(
        'https://hf-mirror.com/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC/resolve/main/params_shard_0.bin',
      ),
    ).toBe(canonicalShard);
    expect(
      toCanonicalArtifactUrl(
        'https://custom-hf.example.com/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC/resolve/main/params_shard_0.bin',
      ),
    ).toBe(canonicalShard);

    const canonicalWasm =
      'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm';
    expect(
      toCanonicalArtifactUrl(
        `${JSDELIVR_CF_MLC_WASM_PREFIX}/web-llm-models/v0_2_87/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm`,
      ),
    ).toBe(canonicalWasm);
    expect(
      toCanonicalArtifactUrl(
        `${GHFAST_MLC_WASM_PREFIX}/web-llm-models/v0_2_87/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm`,
      ),
    ).toBe(canonicalWasm);

    expect(resolveArtifactMirrorUrls(canonicalShard)).toEqual([
      'https://custom-hf.example.com/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC/resolve/main/params_shard_0.bin',
      'https://hf-mirror.com/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC/resolve/main/params_shard_0.bin',
      canonicalShard,
    ]);
  });

  it('fails over across mirrors on CORS/5xx errors but stops immediately on AbortSignal', async () => {
    setArtifactMirrorConfig({
      hfOrigins: [HF_MIRROR_ORIGIN, CANONICAL_HF_ORIGIN],
    });

    const attempts: string[] = [];
    const res = await fetchArtifactWithMirrorFailover(
      'https://huggingface.co/repo/resolve/main/config.json',
      undefined,
      async (input) => {
        const u = String(input);
        attempts.push(u);
        if (u.startsWith(HF_MIRROR_ORIGIN)) {
          throw new TypeError('CORS blocked 308');
        }
        return new Response('{"ok":true}', { status: 200 });
      },
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(attempts).toEqual([
      'https://hf-mirror.com/repo/resolve/main/config.json',
      'https://huggingface.co/repo/resolve/main/config.json',
    ]);

    const abortCtrl = new AbortController();
    const abortCalls: string[] = [];
    await expect(
      fetchArtifactWithMirrorFailover(
        'https://huggingface.co/repo/resolve/main/config.json',
        { signal: abortCtrl.signal },
        async (input) => {
          abortCalls.push(String(input));
          abortCtrl.abort();
          throw new DOMException('Aborted', 'AbortError');
        },
      ),
    ).rejects.toThrow(/Aborted/);
    expect(abortCalls).toHaveLength(1);
  });

  it('downloads giant shards via 4-way concurrent HTTP Range requests and reassembles exact bytes', async () => {
    const totalBytes = 8 * 1024 * 1024 + 137; // non-power-of-two byte size to test boundary math
    const source = new Uint8Array(totalBytes);
    for (let i = 0; i < totalBytes; i++) {
      source[i] = (i * 31 + 7) & 0xff;
    }

    setArtifactMirrorConfig({
      hfOrigins: [CANONICAL_HF_ORIGIN],
      enableParallelRange: true,
      parallelRangeMinBytes: 4 * 1024 * 1024,
      parallelRangeConnections: 4,
    });

    const seenRanges: string[] = [];
    let reportedBytes = 0;

    const response = await fetchArtifactResponseWithAcceleration(
      'https://huggingface.co/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC/resolve/main/params_shard_0.bin',
      {
        expectedBytes: totalBytes,
        onBytes: (delta) => {
          reportedBytes += delta;
        },
        fetchImpl: async (_input, init) => {
          const headers = new Headers(init?.headers);
          const rangeHeader = headers.get('Range');
          expect(rangeHeader).toMatch(/^bytes=\d+-\d+$/);
          seenRanges.push(rangeHeader!);
          const [, startStr, endStr] = rangeHeader!.match(/^bytes=(\d+)-(\d+)$/)!;
          const start = Number(startStr);
          const end = Number(endStr);
          const slice = source.slice(start, end + 1);
          return new Response(slice, {
            status: 206,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
            },
          });
        },
      },
    );

    expect(seenRanges).toHaveLength(4);
    expect(reportedBytes).toBe(totalBytes);
    const assembled = new Uint8Array(await response.arrayBuffer());
    expect(assembled.byteLength).toBe(totalBytes);
    expect(assembled[0]).toBe(source[0]);
    expect(assembled[1048576]).toBe(source[1048576]);
    expect(assembled[totalBytes - 1]).toBe(source[totalBytes - 1]);
  });

  it('falls back cleanly with monotonic progress if a Range slice fails mid-flight', async () => {
    const totalBytes = 6 * 1024 * 1024;
    const source = new Uint8Array(totalBytes).fill(0x5a);

    setArtifactMirrorConfig({
      hfOrigins: [CANONICAL_HF_ORIGIN],
      enableParallelRange: true,
      parallelRangeMinBytes: 4 * 1024 * 1024,
      parallelRangeConnections: 4,
    });

    let reportedBytes = 0;
    const response = await fetchArtifactResponseWithAcceleration(
      'https://huggingface.co/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC/resolve/main/params_shard_1.bin',
      {
        expectedBytes: totalBytes,
        onBytes: (delta) => {
          reportedBytes += delta;
        },
        fetchImpl: async (_input, init) => {
          const rangeHeader = new Headers(init?.headers).get('Range');
          if (rangeHeader) {
            const [, s, e] = rangeHeader.match(/^bytes=(\d+)-(\d+)$/)!;
            if (Number(s) === 0) {
              return new Response(source.slice(0, Number(e) + 1), { status: 206 });
            }
            return new Response(null, { status: 502 });
          }
          // Single-stream fallback succeeds
          return new Response(source, { status: 200 });
        },
      },
    );

    const assembled = new Uint8Array(await response.arrayBuffer());
    expect(assembled.byteLength).toBe(totalBytes);
    expect(assembled[12345]).toBe(0x5a);
    expect(reportedBytes).toBe(totalBytes);
  });
});
