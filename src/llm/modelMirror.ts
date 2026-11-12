/**
 * modelMirror.ts — Auto Region / GeoIP + Live CORS Race Mirror Resolver
 *
 * 自动根据用户地区 / IP（服务端 `/api/region` Cloudflare Edge GeoIP + 客户端时区）
 * 与实时浏览器 CORS 连通性竞速，为所有 WebLLM 模型（含自定义模型与内置 Qwen/Llama 等预构建模型）
 * 选择最快的 Hugging Face 权重源与 GitHub WASM CDN 镜像，并保留完整主备故障自动切换链。
 *
 * 关键架构不变量：
 * 1. `hf-mirror.com` 对海外或开启全局 TUN 代理的 IP 会返回无 CORS 头的 `308 -> huggingface.co` 重定向，
 *    浏览器 `mode: 'cors'` 会拦截该响应；因此绝不能仅凭时区盲切，必须结合 `/api/region` IP 提示与真实 CORS 竞速探测。
 * 2. `@firetable/web-runtime` 内部统一将 Cache Storage / IndexedDB / OPFS 缓存键规范化回上游官方域名，
 *    因此切换镜像或开关梯子绝不会导致已下载的 1.5GB 本地模型缓存失效。
 */

import type { ArtifactMirrorConfig } from '@mlc-ai/web-llm';
import { APP_CONFIG } from '@/config';

export const CANONICAL_HF_ORIGIN = 'https://huggingface.co';
export const HF_MIRROR_ORIGIN = 'https://hf-mirror.com';

export const CANONICAL_MLC_WASM_PREFIX =
  'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main';
export const JSDELIVR_CF_MLC_WASM_PREFIX =
  'https://testingcf.jsdelivr.net/gh/mlc-ai/binary-mlc-llm-libs@main';
export const JSDELIVR_CDN_MLC_WASM_PREFIX =
  'https://cdn.jsdelivr.net/gh/mlc-ai/binary-mlc-llm-libs@main';
export const GHFAST_MLC_WASM_PREFIX =
  'https://ghfast.top/https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main';

export const HF_ENDPOINT_STORAGE_KEY = 'xc_hf_endpoint';

const HF_PROBE_PATH = '/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC/resolve/main/mlc-chat-config.json';
const WASM_PROBE_PATH = '/web-llm-models/v0_2_87/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm';

const MAINLAND_CHINA_TIMEZONES = new Set([
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Chungking',
  'Asia/Harbin',
  'Asia/Urumqi',
  'Asia/Kashgar',
  'PRC',
]);

export interface ResolveMirrorOptions {
  fetchImpl?: typeof fetch;
  timeZone?: string;
  explicitHfEndpoint?: string | null;
  regionTimeoutMs?: number;
  probeTimeoutMs?: number;
  skipCache?: boolean;
}

let cachedMirrorConfig: ArtifactMirrorConfig | null = null;
let inFlightMirrorPromise: Promise<ArtifactMirrorConfig> | null = null;

export function resetMirrorProbeCacheForTests(): void {
  cachedMirrorConfig = null;
  inFlightMirrorPromise = null;
}

function cleanOrigin(raw: string | null | undefined): string {
  return (raw || '').trim().replace(/\/+$/, '');
}

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const c = cleanOrigin(item);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function isMainlandChinaTimezone(tz?: string): boolean {
  const resolved =
    tz ??
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return '';
      }
    })();
  return MAINLAND_CHINA_TIMEZONES.has(resolved);
}

export async function fetchEdgeRegionCountry(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 500,
): Promise<string | null> {
  // Tauri 本地协议无同源 /api/region 路由，直接走时区 + 实时竞速
  if (
    typeof window !== 'undefined' &&
    (window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost')
  ) {
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl('/api/region', {
      method: 'GET',
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { country?: unknown };
    const code = typeof data?.country === 'string' ? data.country.trim().toUpperCase() : '';
    return /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface CandidateSpec {
  base: string;
  delayMs: number;
}

/**
 * 带错峰起跑 (Happy Eyeballs) 与失败即刻唤醒下一候选的并发 CORS 竞速器。
 * 任一候选率先返回 `res.ok` 即胜出并立即中止其余在途探测连接；若排在前面的候选提前失败，
 * 立即唤醒尚未过延迟窗的后备候选，零无效等待。
 */
async function raceHealthyCandidate(
  candidates: readonly CandidateSpec[],
  probePath: string,
  method: 'GET' | 'HEAD',
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  if (candidates.length === 0) return null;

  const controllers = candidates.map(() => new AbortController());
  const wakeups: Array<() => void> = [];
  let settled = false;
  let globalTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelAllExcept = (winnerIdx: number) => {
    for (let i = 0; i < controllers.length; i++) {
      if (i !== winnerIdx) {
        try {
          controllers[i]!.abort();
        } catch {
          // ignore
        }
      }
    }
  };

  const sleepOrWake = (ms: number, signal: AbortSignal): Promise<void> => {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(done, ms);
      wakeups.push(done);
      signal.addEventListener('abort', done, { once: true });
    });
  };

  return new Promise<string | null>((resolve) => {
    let remaining = candidates.length;
    const finish = (winner: string | null, winnerIdx = -1) => {
      if (settled) return;
      settled = true;
      if (globalTimer !== undefined) clearTimeout(globalTimer);
      cancelAllExcept(winnerIdx);
      resolve(winner);
    };

    globalTimer = setTimeout(() => finish(null), timeoutMs);

    candidates.forEach((cand, idx) => {
      void (async () => {
        const ctrl = controllers[idx]!;
        await sleepOrWake(cand.delayMs, ctrl.signal);
        if (settled || ctrl.signal.aborted) return;
        try {
          const res = await fetchImpl(`${cand.base}${probePath}`, {
            method,
            mode: 'cors',
            cache: 'no-store',
            signal: ctrl.signal,
          });
          // 释放探测响应流，避免占用连接池
          try {
            await res.body?.cancel();
          } catch {
            // ignore
          }
          if (res.ok) {
            finish(cand.base, idx);
            return;
          }
        } catch {
          // CORS block / timeout / DNS reset
        }
        // 当前候选失败：立即唤醒所有尚在 stagger 等待中的后备候选！
        for (const wake of wakeups) wake();
        remaining -= 1;
        if (remaining <= 0) {
          finish(null);
        }
      })();
    });
  });
}

function readExplicitHfEndpoint(override?: string | null): string | null {
  if (override !== undefined) {
    const cleaned = cleanOrigin(override);
    return cleaned && cleaned !== CANONICAL_HF_ORIGIN ? cleaned : null;
  }
  if (typeof window !== 'undefined') {
    try {
      const saved = cleanOrigin(window.localStorage.getItem(HF_ENDPOINT_STORAGE_KEY));
      if (saved && saved !== CANONICAL_HF_ORIGIN) return saved;
    } catch {
      // ignore storage access errors
    }
  }
  const envEndpoint = cleanOrigin(APP_CONFIG.llm?.hfEndpoint);
  if (envEndpoint && envEndpoint !== CANONICAL_HF_ORIGIN) {
    return envEndpoint;
  }
  return null;
}

export async function resolveBestMirrorConfig(
  options?: ResolveMirrorOptions,
): Promise<ArtifactMirrorConfig> {
  const useCache = !options?.skipCache && !options?.fetchImpl && options?.timeZone === undefined && options?.explicitHfEndpoint === undefined;
  if (useCache && cachedMirrorConfig) {
    return cachedMirrorConfig;
  }
  if (useCache && inFlightMirrorPromise) {
    return inFlightMirrorPromise;
  }

  const run = async (): Promise<ArtifactMirrorConfig> => {
    const fetchImpl = options?.fetchImpl ?? fetch;
    const regionTimeoutMs = options?.regionTimeoutMs ?? 500;
    const probeTimeoutMs = options?.probeTimeoutMs ?? 1500;
    const explicitHf = readExplicitHfEndpoint(options?.explicitHfEndpoint);

    const ipCountry = await fetchEdgeRegionCountry(fetchImpl, regionTimeoutMs);
    const cnTz = isMainlandChinaTimezone(options?.timeZone);
    // 若边缘 IP 明确判定为非 CN（例如海外用户或开启了全局代理到 US/SG/JP/HK），直接按海外优先；
    // 若边缘 IP 为 CN，或本地开发 / Tauri 无法获知边缘 IP 且系统时区为中国大陆，则按国内提示优先探测镜像。
    const isMainlandHint = ipCountry === 'CN' || (ipCountry === null && cnTz);

    const hfCandidates: CandidateSpec[] = isMainlandHint
      ? [
          { base: HF_MIRROR_ORIGIN, delayMs: 0 },
          { base: CANONICAL_HF_ORIGIN, delayMs: 80 },
        ]
      : [
          { base: CANONICAL_HF_ORIGIN, delayMs: 0 },
          { base: HF_MIRROR_ORIGIN, delayMs: 220 },
        ];

    const wasmCandidates: CandidateSpec[] = isMainlandHint
      ? [
          { base: JSDELIVR_CF_MLC_WASM_PREFIX, delayMs: 0 },
          { base: JSDELIVR_CDN_MLC_WASM_PREFIX, delayMs: 40 },
          { base: GHFAST_MLC_WASM_PREFIX, delayMs: 80 },
          { base: CANONICAL_MLC_WASM_PREFIX, delayMs: 160 },
        ]
      : [
          { base: CANONICAL_MLC_WASM_PREFIX, delayMs: 0 },
          { base: JSDELIVR_CDN_MLC_WASM_PREFIX, delayMs: 120 },
          { base: JSDELIVR_CF_MLC_WASM_PREFIX, delayMs: 200 },
          { base: GHFAST_MLC_WASM_PREFIX, delayMs: 300 },
        ];

    const [hfWinner, wasmWinner] = await Promise.all([
      explicitHf
        ? Promise.resolve(explicitHf)
        : raceHealthyCandidate(hfCandidates, HF_PROBE_PATH, 'GET', probeTimeoutMs, fetchImpl),
      raceHealthyCandidate(wasmCandidates, WASM_PROBE_PATH, 'HEAD', probeTimeoutMs, fetchImpl),
    ]);

    const defaultHfOrder = isMainlandHint
      ? [HF_MIRROR_ORIGIN, CANONICAL_HF_ORIGIN]
      : [CANONICAL_HF_ORIGIN, HF_MIRROR_ORIGIN];
    const hfOrigins = dedupe([
      ...(explicitHf ? [explicitHf] : []),
      ...(hfWinner ? [hfWinner] : []),
      ...defaultHfOrder,
    ]);

    const defaultWasmOrder = wasmCandidates.map((c) => c.base);
    const wasmLibPrefixes = dedupe([
      ...(wasmWinner ? [wasmWinner] : []),
      ...defaultWasmOrder,
    ]);

    const resolved: ArtifactMirrorConfig = {
      hfOrigins,
      wasmLibPrefixes,
    };

    if (typeof window !== 'undefined') {
      console.info(
        `[WebLLM Mirror] region=${ipCountry ?? (cnTz ? 'tz:CN' : 'auto')} -> primary HF=${hfOrigins[0]}, WASM=${wasmLibPrefixes[0]}`,
      );
    }
    return resolved;
  };

  if (!useCache) {
    return run();
  }

  inFlightMirrorPromise = run()
    .then((cfg) => {
      cachedMirrorConfig = cfg;
      return cfg;
    })
    .finally(() => {
      inFlightMirrorPromise = null;
    });
  return inFlightMirrorPromise;
}
