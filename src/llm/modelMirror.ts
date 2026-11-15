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
export const CF_TRACE_ENDPOINT = 'https://www.cloudflare.com/cdn-cgi/trace';

/**
 * 使用 `/api/models/<repo>` 元数据端点 (`HEAD`) 作为连通性探针：
 * - 相比 `/resolve/main/...`（会触发 `307 -> /api/resolve-cache/...` 二次跳转并拉取正文），
 *   `/api/models/...` 在 `huggingface.co` 与国内直连 `hf-mirror.com` 下均单次往返直接返回 `200 OK` + CORS 头（0 字节响应体）；
 * - 海外或代理 IP 命中 `hf-mirror.com` 时返回无 CORS 头的 `308`，被 `mode: 'cors'` 拦截后立即唤醒后备源并降级。
 */
export const HF_PROBE_PATH = '/api/models/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC';
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

async function fetchCloudflareTraceCountry(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(CF_TRACE_ENDPOINT, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/^loc=([A-Z]{2})$/m);
    const code = match?.[1] ?? '';
    return code && code !== 'XX' && code !== 'T1' ? code : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchEdgeRegionCountry(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 600,
): Promise<string | null> {
  const isTauriProtocol =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost');

  if (!isTauriProtocol) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl('/api/region', {
        method: 'GET',
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = (await res.json()) as { country?: unknown };
        const code = typeof data?.country === 'string' ? data.country.trim().toUpperCase() : '';
        if (/^[A-Z]{2}$/.test(code)) return code;
      }
    } catch {
      // Fall through to Cloudflare CORS trace fallback
    } finally {
      clearTimeout(timer);
    }
  }

  // Tauri 本地协议、纯静态托管或 /api/region 未返回有效国家码时，使用支持 CORS (*) 的 Cloudflare Trace 兜底探测真实出口 IP
  return fetchCloudflareTraceCountry(fetchImpl, timeoutMs);
}

interface CandidateSpec {
  base: string;
  delayMs: number;
}

interface RaceResult {
  winner: string | null;
  failed: ReadonlySet<string>;
}

/**
 * 带错峰起跑 (Happy Eyeballs) 与失败即刻唤醒下一候选的并发 CORS 竞速器。
 * 任一候选率先返回 `res.ok` 即胜出并立即中止其余在途探测连接；若排在前面的候选提前失败，
 * 立即唤醒尚未过延迟窗的后备候选，并将明确失败的节点记录在 `failed` 集合中以便排到主备链末尾。
 */
async function raceHealthyCandidate(
  candidates: readonly CandidateSpec[],
  probePath: string,
  method: 'GET' | 'HEAD',
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<RaceResult> {
  const failed = new Set<string>();
  if (candidates.length === 0) return { winner: null, failed };

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

  return new Promise<RaceResult>((resolve) => {
    let remaining = candidates.length;
    const finish = (winner: string | null, winnerIdx = -1) => {
      if (settled) return;
      settled = true;
      if (globalTimer !== undefined) clearTimeout(globalTimer);
      cancelAllExcept(winnerIdx);
      resolve({ winner, failed });
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
          if (!settled && !ctrl.signal.aborted) {
            failed.add(cand.base);
          }
        } catch {
          // CORS block / timeout / DNS reset (排除因其他候选胜出或全局超时触发的 abort)
          if (!settled && !ctrl.signal.aborted) {
            failed.add(cand.base);
          }
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
    const probeTimeoutMs = options?.probeTimeoutMs ?? 2500;
    const explicitHf = readExplicitHfEndpoint(options?.explicitHfEndpoint);

    const ipCountry = await fetchEdgeRegionCountry(fetchImpl, regionTimeoutMs);
    const cnTz = isMainlandChinaTimezone(options?.timeZone);
    // 若边缘 IP 明确判定为非 CN（例如海外用户或开启了全局代理到 US/SG/JP/HK），直接按海外优先；
    // 若边缘 IP 为 CN，或本地开发 / Tauri 无法获知边缘 IP 且系统时区为中国大陆，则按国内提示优先探测镜像。
    const isMainlandHint = ipCountry === 'CN' || (ipCountry === null && cnTz);

    // 仅在疑似中国大陆直连 (`isMainlandHint === true`) 时对 `hf-mirror.com` 发起 CORS 竞速探测；
    // 当出口 IP 已确认为非 CN（如海外用户或开启代理到 NL/US/SG/HK/JP）时，`hf-mirror.com` 必返回无 CORS 头的 308，
    // 若在跨洋 TLS 握手 (>220ms) 期间唤醒 `hf-mirror.com` 探测反而会污染 DevTools Console，故直接采用官方源为主、镜像殿后。
    const hfCandidates: CandidateSpec[] = [
      { base: HF_MIRROR_ORIGIN, delayMs: 0 },
      { base: CANONICAL_HF_ORIGIN, delayMs: 600 },
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

    const [hfRace, wasmRace] = await Promise.all([
      explicitHf
        ? Promise.resolve<RaceResult>({ winner: explicitHf, failed: new Set() })
        : isMainlandHint
          ? raceHealthyCandidate(hfCandidates, HF_PROBE_PATH, 'HEAD', probeTimeoutMs, fetchImpl)
          : Promise.resolve<RaceResult>({ winner: CANONICAL_HF_ORIGIN, failed: new Set() }),
      raceHealthyCandidate(wasmCandidates, WASM_PROBE_PATH, 'HEAD', probeTimeoutMs, fetchImpl),
    ]);

    const defaultHfOrder = isMainlandHint
      ? [HF_MIRROR_ORIGIN, CANONICAL_HF_ORIGIN]
      : [CANONICAL_HF_ORIGIN, HF_MIRROR_ORIGIN];
    const hfOrigins = dedupe([
      ...(explicitHf ? [explicitHf] : []),
      ...(hfRace.winner ? [hfRace.winner] : []),
      ...defaultHfOrder.filter((base) => !hfRace.failed.has(base)),
      ...defaultHfOrder.filter((base) => hfRace.failed.has(base)),
    ]);

    const defaultWasmOrder = wasmCandidates.map((c) => c.base);
    const wasmLibPrefixes = dedupe([
      ...(wasmRace.winner ? [wasmRace.winner] : []),
      ...defaultWasmOrder.filter((base) => !wasmRace.failed.has(base)),
      ...defaultWasmOrder.filter((base) => wasmRace.failed.has(base)),
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
