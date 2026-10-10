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
    }, 4500);

    const onAbort = () => {
      clearTimeout(timeoutId);
      cleanup();
      reject(new Error('Flight aborted'));
    };
    flightSignal.addEventListener('abort', onAbort, { once: true });

    try {
      const secMsGec = await makeSecMsGec();
      const connId = makeConnectionId();
      const url = new URL(EDGE_TTS_CONSTANTS.SYNTHESIS_URL);
      url.searchParams.set('TrustedClientToken', EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN);
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
      socket.accept?.();
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

      const onSocketError = (err?: any) => {
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
 * Hedged Dual-Flight execution:
 * 启动通道 1；若 300ms 内未收到首包音频或出错，立即并发拉起通道 2。
 * 两路通过 Promise.any 进行竞速，谁先就绪谁胜出，另一路立即被 abort 取消。
 */
async function hedgeFlightRound(
  text: string,
  voice: string,
  pitch: string,
  roundSignal: AbortSignal,
): Promise<SingleFlightResult> {
  const ctrl1 = new AbortController();
  const ctrl2 = new AbortController();

  const onRoundAbort = () => {
    ctrl1.abort();
    ctrl2.abort();
  };
  roundSignal.addEventListener('abort', onRoundAbort, { once: true });

  const p1 = executeSingleFlight(text, voice, pitch, ctrl1.signal);

  const hedgeDelay = new Promise<void>((r) => setTimeout(r, 300));
  const p2Starter = Promise.race([
    hedgeDelay,
    p1.then(() => {}, () => {}),
  ]).then(() => {
    if (roundSignal.aborted) throw new Error('Round aborted');
    return executeSingleFlight(text, voice, pitch, ctrl2.signal);
  });

  try {
    const winner = await Promise.any([
      p1.then((res) => ({ res, flight: 1 })),
      p2Starter.then((p) => p).then((res) => ({ res, flight: 2 })),
    ]);

    if (winner.flight === 1) {
      ctrl2.abort();
    } else {
      ctrl1.abort();
    }

    return winner.res;
  } catch (err) {
    ctrl1.abort();
    ctrl2.abort();
    throw err;
  } finally {
    roundSignal.removeEventListener('abort', onRoundAbort);
  }
}

/**
 * 多轮对冲调度器：最多执行 4 轮对冲竞速，带指数退避与 Jitter
 */
async function synthesizeWithHedgedRetry(
  text: string,
  voice: string,
  pitch: string,
  clientSignal: AbortSignal,
  maxRounds = 4,
): Promise<SingleFlightResult> {
  let lastError: Error | null = null;

  for (let round = 1; round <= maxRounds; round++) {
    if (clientSignal.aborted) {
      throw new Error('TTS request aborted by client');
    }

    if (round > 1) {
      const backoffMs = 150 * (round - 1) + Math.floor(Math.random() * 200);
      console.warn(`[TTS] Hedged Round #${round} retry in ${backoffMs}ms...`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    const roundCtrl = new AbortController();
    const onClientAbort = () => roundCtrl.abort();
    clientSignal.addEventListener('abort', onClientAbort, { once: true });

    try {
      const result = await hedgeFlightRound(text, voice, pitch, roundCtrl.signal);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[TTS] Hedged Round #${round} failed:`, lastError.message);
    } finally {
      clientSignal.removeEventListener('abort', onClientAbort);
    }
  }

  throw lastError ?? new Error('Failed to synthesize audio after hedged attempts');
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
    const { stream, collectedChunks, onFinished } = await synthesizeWithHedgedRetry(
      cleanText,
      voice,
      pitch,
      abortController.signal,
      4,
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
    console.error('[TTS Handle Error]:', msg);
    return new Response(JSON.stringify({ error: msg }), {
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
