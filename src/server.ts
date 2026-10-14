/**
 * Custom Cloudflare Worker entry — wraps TanStack Start SSR handler with /api/tts.
 *
 * Request routing:
 * - /api/tts → Native Edge-TTS WebSocket proxy, returns audio/mpeg stream
 * - Other dynamic paths → TanStack Start streaming SSR handler
 * - Static assets → Served directly via Cloudflare Assets
 */
import handler from '@tanstack/react-start/server-entry';
import {
  EDGE_TTS_CONSTANTS,
  makeConnectionId,
  makeMuid,
  makeSecMsGec,
  buildEdgeTTSPayloads,
  parseHeaders,
  parseBinaryFrame,
} from './lib/edge-tts-core';
import { applySecurityHeaders, type SecurityEnv } from './lib/securityHeaders';

const EDGE_UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
];

function getRandomEdgeUA(): string {
  return EDGE_UA_POOL[Math.floor(Math.random() * EDGE_UA_POOL.length)]!;
}

async function computeTextHash(text: string, voice: string, pitch: string): Promise<string> {
  const data = new TextEncoder().encode(`${voice}|${pitch}|${text}`);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface SingleFlightResult {
  stream: ReadableStream<Uint8Array>;
  collectedChunks: Uint8Array[];
  onFinished: Promise<void>;
}

function executeSingleFlight(
  text: string,
  voice: string,
  pitch: string,
  flightSignal: AbortSignal,
  endpoint: 'v2' | 'legacy' = 'v2',
): Promise<SingleFlightResult> {
  return new Promise<SingleFlightResult>(async (resolve, reject) => {
    let socket: WebSocket | null = null;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let streamClosed = false;
    let ended = false;
    let pendingAsync = 0;
    let receivedFirstChunk = false;
    const collectedChunks: Uint8Array[] = [];

    let resolveFinished: () => void = () => {};
    const onFinished = new Promise<void>((r) => {
      resolveFinished = r;
    });

    const cleanup = () => {
      if (streamClosed) return;
      streamClosed = true;
      try {
        socket?.close();
      } catch { }
      resolveFinished();
    };

    const timeoutId = setTimeout(() => {
      if (!receivedFirstChunk) {
        cleanup();
        reject(new Error('Timeout waiting for first audio chunk'));
      }
    }, 3500);

    const onAbort = () => {
      clearTimeout(timeoutId);
      cleanup();
      reject(new Error('Flight aborted'));
    };
    flightSignal.addEventListener('abort', onAbort, { once: true });

    try {
      const secMsGec = await makeSecMsGec();
      const connId = makeConnectionId();
      // v2: api.msedgeservices.com + Ocp-Apim-Subscription-Key（同一 token）；legacy: 旧 bing host
      const url = new URL(endpoint === 'v2' ? EDGE_TTS_CONSTANTS.SYNTHESIS_URL_V2 : EDGE_TTS_CONSTANTS.SYNTHESIS_URL);
      url.searchParams.set(
        endpoint === 'v2' ? 'Ocp-Apim-Subscription-Key' : 'TrustedClientToken',
        EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN,
      );
      url.searchParams.set('Sec-MS-GEC', secMsGec);
      url.searchParams.set('Sec-MS-GEC-Version', EDGE_TTS_CONSTANTS.SEC_MS_GEC_VERSION);
      url.searchParams.set('ConnectionId', connId);

      const res = (await fetch(url.toString(), {
        headers: {
          'User-Agent': getRandomEdgeUA(),
          'Accept-Language': 'en-US,en;q=0.9',
          Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          Upgrade: 'websocket',
          Cookie: `muid=${makeMuid()};`,
        },
      })) as Response & { webSocket?: WebSocket };

      if (res.status !== 101 || !res.webSocket) {
        clearTimeout(timeoutId);
        cleanup();
        reject(new Error(`Handshake failed: HTTP ${res.status}`));
        return;
      }

      socket = res.webSocket;
      (socket as any).accept?.();
      try {
        (socket as any).binaryType = 'arraybuffer';
      } catch { }

      const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads(text, voice, pitch);

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
        cancel() {
          cleanup();
        },
      });

      const onMessage = async (e: MessageEvent) => {
        const data = e.data;
        if (typeof data === 'string') {
          const h = parseHeaders(data);
          if (data.includes('turn.failed') || data.includes('403 Forbidden') || data.includes('Unauthorized')) {
            ended = true;
            clearTimeout(timeoutId);
            cleanup();
            const err = new Error(`Upstream rejected: ${data.slice(0, 150)}`);
            if (!receivedFirstChunk) {
              reject(err);
            } else if (streamController) {
              try {
                streamController.error(err);
              } catch { }
            }
            return;
          }
          if (h.Path === 'turn.end') {
            ended = true;
            try {
              socket?.close();
            } catch { }
            const wait = () => {
              if (pendingAsync === 0) {
                if (!streamClosed && streamController) {
                  streamClosed = true;
                  try {
                    streamController.close();
                  } catch { }
                }
                resolveFinished();
              } else {
                setTimeout(wait, 5);
              }
            };
            wait();
          }
          return;
        }

        pendingAsync++;
        try {
          let u8: Uint8Array;
          if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
          else if (data instanceof Uint8Array) u8 = data;
          else if (typeof Blob !== 'undefined' && data instanceof Blob) u8 = new Uint8Array(await data.arrayBuffer());
          else return;

          const f = parseBinaryFrame(u8);
          if (f.headers.Path === 'audio' && f.body.length > 0) {
            collectedChunks.push(f.body);
            if (!receivedFirstChunk) {
              receivedFirstChunk = true;
              clearTimeout(timeoutId);
              if (!streamClosed && streamController) {
                try {
                  streamController.enqueue(f.body);
                } catch { }
              }
              resolve({ stream, collectedChunks, onFinished });
            } else {
              if (!streamClosed && streamController) {
                try {
                  streamController.enqueue(f.body);
                } catch { }
              }
            }
          }
        } catch (parseErr) {
          console.error('[TTS Parse Error]:', parseErr);
        } finally {
          pendingAsync--;
        }
      };

      const onClose = (evt?: any) => {
        if (!receivedFirstChunk) {
          clearTimeout(timeoutId);
          cleanup();
          reject(new Error(`Socket closed before audio (code: ${evt?.code})`));
          return;
        }
        if (!ended) {
          ended = true;
          if (!streamClosed && streamController) {
            streamClosed = true;
            try {
              streamController.close();
            } catch { }
          }
          resolveFinished();
        }
      };

      const onSocketError = (_err?: any) => {
        if (!receivedFirstChunk) {
          clearTimeout(timeoutId);
          cleanup();
          reject(new Error('WebSocket connection error'));
          return;
        }
        if (ended) return;
        ended = true;
        cleanup();
        if (!streamClosed && streamController) {
          try {
            streamController.error(new Error('WebSocket error'));
          } catch { }
        }
      };

      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onSocketError);

      try {
        socket.send(speechConfig);
        socket.send(ssmlMessage);
      } catch (sendErr) {
        clearTimeout(timeoutId);
        cleanup();
        reject(sendErr);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      cleanup();
      reject(err);
    }
  });
}

/**
 * 解包 Promise.any 抛出的 AggregateError，取出底层真实错误。
 *
 * Promise.any 全部 reject 时抛 AggregateError，其 .message 是字面量
 * "All promises were rejected" —— 会把真实原因（如 "Handshake failed: HTTP 403"）
 * 完全吞掉。必须遍历 .errors[] 还原真实 message，否则排障时只能看到
 * 一句无信息量的文案。这里保留最有诊断价值的那条：优先带 HTTP 状态码 /
 * 超时语义的消息，其次取最后一条；全部丢失时才退回原始 message。
 */
function unwrapAggregateError(err: unknown): Error {
  if (!(err instanceof AggregateError) || !Array.isArray(err.errors) || err.errors.length === 0) {
    return err instanceof Error ? err : new Error(String(err));
  }

  const inner = err.errors.map((e) => (e instanceof Error ? e : new Error(String(e))));

  // 有诊断价值的错误优先：握手 HTTP 状态码 / 上游拒绝 / 首包超时
  const meaningful = inner.find(
    (e) =>
      /HTTP \d{3}/.test(e.message) ||
      /Upstream rejected/i.test(e.message) ||
      /Timeout waiting for first audio chunk/i.test(e.message),
  );
  const picked = meaningful ?? inner[inner.length - 1];

  return new Error(picked.message, { cause: err });
}

/**
 * 单发一轮：先走新 host（v2）；若握手 403 则同轮回退旧 host 一次。
 * 不再并发双发——新 host 对突发更敏感（429），双发只会放大限流。
 */
async function singleFlightRound(
  text: string,
  voice: string,
  pitch: string,
  roundSignal: AbortSignal,
): Promise<SingleFlightResult> {
  try {
    return await executeSingleFlight(text, voice, pitch, roundSignal, 'v2');
  } catch (err) {
    const e = unwrapAggregateError(err);
    if (/HTTP 403/.test(e.message) && !roundSignal.aborted) {
      console.warn('[TTS] v2 host 403, falling back to legacy host');
      try {
        return await executeSingleFlight(text, voice, pitch, roundSignal, 'legacy');
      } catch (legacyErr) {
        const le = unwrapAggregateError(legacyErr);
        throw new Error(`v2: ${e.message}; legacy: ${le.message}`, { cause: legacyErr });
      }
    }
    throw e;
  }
}

/**
 * 顺序重试调度器：每轮单发；429 等 3s；其余短退避。
 * 总预算 ~7s，保证客户端 8s withTimeout 仍能拿到 502 + reasons。
 */
async function synthesizeWithRetry(
  text: string,
  voice: string,
  pitch: string,
  clientSignal: AbortSignal,
  maxRounds = 3,
  budgetMs = 7000,
): Promise<SingleFlightResult> {
  let lastError: Error | null = null;
  const seenMessages: string[] = [];
  const startedAt = Date.now();
  let roundsRun = 0;

  for (let round = 1; round <= maxRounds; round++) {
    if (clientSignal.aborted) {
      throw new Error('TTS request aborted by client');
    }

    if (round > 1) {
      const rateLimited = !!lastError && /HTTP 429/.test(lastError.message);
      const backoffMs = rateLimited ? 3000 : 200 * (round - 1) + Math.floor(Math.random() * 200);
      // 等待 + 一次首包超时（3.5s）会超预算就不再重试
      if (Date.now() - startedAt + backoffMs + 3500 > budgetMs) break;
      console.warn(`[TTS] Round #${round} retry in ${backoffMs}ms...`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    const roundCtrl = new AbortController();
    const onClientAbort = () => roundCtrl.abort();
    clientSignal.addEventListener('abort', onClientAbort, { once: true });
    roundsRun = round;

    try {
      return await singleFlightRound(text, voice, pitch, roundCtrl.signal);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!seenMessages.includes(lastError.message)) {
        seenMessages.push(lastError.message);
      }
      console.warn(`[TTS] Round #${round} failed:`, lastError.message);
    } finally {
      clientSignal.removeEventListener('abort', onClientAbort);
    }
  }

  const root = lastError ?? new Error('Failed to synthesize audio');
  const error = new Error(`${root.message} (after ${roundsRun} attempts)`, { cause: root });
  (error as Error & { reasons?: string[] }).reasons = seenMessages;
  throw error;
}

async function handleTTS(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: EDGE_TTS_CONSTANTS.COMMON_CORS });
  }

  try {
    let text = '';
    let voice = 'zh-CN-XiaoyiNeural';
    let pitch = '+10Hz';

    if (request.method === 'GET') {
      const u = new URL(request.url);
      text = u.searchParams.get('text') ?? '';
      voice = u.searchParams.get('voice') ?? voice;
      pitch = u.searchParams.get('pitch') ?? pitch;
    } else if (request.method === 'POST') {
      const body = (await request.json()) as { text?: string; voice?: string; pitch?: string };
      text = body.text ?? '';
      voice = body.voice ?? voice;
      pitch = body.pitch ?? pitch;
    }

    const cleanText = text.trim();
    if (!cleanText) {
      return new Response(JSON.stringify({ error: 'text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...EDGE_TTS_CONSTANTS.COMMON_CORS },
      });
    }

    const hashKey = await computeTextHash(cleanText, voice, pitch);
    const cache = (caches as any)?.default;
    const cacheUrl = new Request(`https://internal-cache.xiaochun.local/tts/${hashKey}`);

    // 1. 尝试边缘缓存命中 (极速 <20ms, 100% 可用率)
    if (cache) {
      try {
        const cachedRes = await cache.match(cacheUrl);
        if (cachedRes) {
          return new Response(cachedRes.body, {
            status: 200,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'public, max-age=3600',
              'X-TTS-Cache': 'HIT',
              ...EDGE_TTS_CONSTANTS.COMMON_CORS,
            },
          });
        }
      } catch { }
    }

    // 2. 双通道并发对冲竞速合成
    const abortController = new AbortController();
    const { stream, collectedChunks, onFinished } = await synthesizeWithRetry(
      cleanText,
      voice,
      pitch,
      abortController.signal,
      3,
    );

    // 3. 流完成后异步写入边缘缓存，供后续并发高频复用
    if (cache && cleanText.length <= 150) {
      onFinished.then(async () => {
        try {
          let totalLen = 0;
          for (const c of collectedChunks) totalLen += c.length;
          const merged = new Uint8Array(totalLen);
          let offset = 0;
          for (const c of collectedChunks) {
            merged.set(c, offset);
            offset += c.length;
          }
          if (merged.length > 0) {
            const cacheItem = new Response(merged, {
              status: 200,
              headers: {
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'public, max-age=3600',
              },
            });
            await cache.put(cacheUrl, cacheItem);
          }
        } catch { }
      });
    }

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-TTS-Cache': 'MISS',
        ...EDGE_TTS_CONSTANTS.COMMON_CORS,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const reasons = e instanceof Error ? (e as Error & { reasons?: string[] }).reasons : undefined;
    console.error('[TTS Handle Error]:', msg, reasons ? { reasons } : '');

    // 返回真实原因而非 "All promises were rejected"。
    // reason 取真实根因（已由 unwrapAggregateError 解包），attempts 说明重试轮数，
    // 两者分开是为了让调用方既能读 error 字段，也能拿到轮次这类上下文。
    const body: Record<string, unknown> = { error: msg };
    if (reasons && reasons.length > 0) {
      body.reasons = reasons;
    }

    return new Response(JSON.stringify(body), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...EDGE_TTS_CONSTANTS.COMMON_CORS },
    });
  }
}

/** P0b B1: document must be crossOriginIsolated for ORT wasm multi-thread (SAB).
 * Workers+Assets ignores public/_headers for SSR responses — set COOP/COEP here on HTML/SSR responses.
 * credentialless: allow cross-origin R2/CDN onnx without CORP (require-corp breaks SAB path).
 * 主站 X-Frame-Options: DENY; /embed 改发 CSP frame-ancestors (见 lib/securityHeaders.ts, docs/EMBED.md)。
 */
function withSecurityHeaders(res: Response, pathname: string, env: SecurityEnv): Response {
  const headers = new Headers(res.headers);
  applySecurityHeaders(headers, pathname, env);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown) {
    const url = new URL(request.url);
    if (url.pathname === '/api/tts') {
      return handleTTS(request);
    }
    const res = await handler.fetch(request, env as Parameters<typeof handler.fetch>[1]);
    return withSecurityHeaders(res, url.pathname, (env ?? {}) as SecurityEnv);
  },
};
