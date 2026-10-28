import {
  EDGE_TTS_CONSTANTS,
  makeConnectionId,
  makeMuid,
  makeSecMsGec,
  buildEdgeTTSPayloads,
  parseHeaders,
  parseBinaryFrame,
  isValidTTSVoice,
  isValidTTSProsody,
  TTS_MAX_TEXT_LENGTH,
} from '../lib/edge-tts-core';

export interface TTSHandlerEnv {
  /** 【可选】持久化语音缓存 Bucket (xiaochun-tts)；未绑定时自动优雅降级 */
  TTS_BUCKET?: {
    get: (key: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> } | null>;
    put: (
      key: string,
      value: ArrayBuffer | ArrayBufferView | ReadableStream | string | null,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
}

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

export async function computeTextHash(
  text: string,
  voice: string,
  pitch: string,
  rate: string = '+0%',
  volume: string = '+0%',
): Promise<string> {
  const data = new TextEncoder().encode(`${voice}|${pitch}|${rate}|${volume}|${text}`);
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
  rate: string,
  volume: string,
  flightSignal: AbortSignal,
  endpoint: 'bing' | 'msedgeservices' = 'bing',
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
      // 主端点：speech.platform.bing.com + TrustedClientToken（Sec-MS-GEC v2 标准端点）
      // 备用端点：api.msedgeservices.com + Ocp-Apim-Subscription-Key
      const url = new URL(endpoint === 'bing' ? EDGE_TTS_CONSTANTS.SYNTHESIS_URL : EDGE_TTS_CONSTANTS.SYNTHESIS_URL_V2);
      url.searchParams.set(
        endpoint === 'bing' ? 'TrustedClientToken' : 'Ocp-Apim-Subscription-Key',
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

      const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads(text, voice, pitch, rate, volume);

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

function unwrapAggregateError(err: unknown): Error {
  if (!(err instanceof AggregateError) || !Array.isArray(err.errors) || err.errors.length === 0) {
    return err instanceof Error ? err : new Error(String(err));
  }

  const inner = err.errors.map((e) => (e instanceof Error ? e : new Error(String(e))));

  const meaningful = inner.find(
    (e) =>
      /HTTP \d{3}/.test(e.message) ||
      /Upstream rejected/i.test(e.message) ||
      /Timeout waiting for first audio chunk/i.test(e.message),
  );
  const picked = meaningful ?? inner[inner.length - 1];

  return new Error(picked.message, { cause: err });
}

async function singleFlightRound(
  text: string,
  voice: string,
  pitch: string,
  rate: string,
  volume: string,
  roundSignal: AbortSignal,
): Promise<SingleFlightResult> {
  try {
    return await executeSingleFlight(text, voice, pitch, rate, volume, roundSignal, 'bing');
  } catch (err) {
    const e = unwrapAggregateError(err);
    if ((/HTTP (403|200)/.test(e.message) || /Handshake failed/.test(e.message)) && !roundSignal.aborted) {
      console.warn('[TTS] Primary bing host handshake failed, falling back to msedgeservices host:', e.message);
      try {
        return await executeSingleFlight(text, voice, pitch, rate, volume, roundSignal, 'msedgeservices');
      } catch (fallbackErr) {
        const fe = unwrapAggregateError(fallbackErr);
        throw new Error(`bing: ${e.message}; msedgeservices: ${fe.message}`, { cause: fallbackErr });
      }
    }
    throw e;
  }
}

async function synthesizeWithRetry(
  text: string,
  voice: string,
  pitch: string,
  rate: string,
  volume: string,
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
      if (Date.now() - startedAt + backoffMs + 3500 > budgetMs) break;
      console.warn(`[TTS] Round #${round} retry in ${backoffMs}ms...`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    const roundCtrl = new AbortController();
    const onClientAbort = () => roundCtrl.abort();
    clientSignal.addEventListener('abort', onClientAbort, { once: true });
    roundsRun = round;

    try {
      return await singleFlightRound(text, voice, pitch, rate, volume, roundCtrl.signal);
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

export async function handleTTS(
  request: Request,
  env?: TTSHandlerEnv,
  ctx?: { waitUntil?: (promise: Promise<unknown>) => void },
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: EDGE_TTS_CONSTANTS.COMMON_CORS });
  }

  try {
    let text = '';
    let voice = 'zh-CN-XiaoyiNeural';
    let pitch = '+10Hz';
    let rate = '+0%';
    let volume = '+0%';

    if (request.method === 'GET') {
      const u = new URL(request.url);
      text = u.searchParams.get('text') ?? '';
      voice = u.searchParams.get('voice') ?? voice;
      pitch = u.searchParams.get('pitch') ?? pitch;
      rate = u.searchParams.get('rate') ?? rate;
      volume = u.searchParams.get('volume') ?? volume;
    } else if (request.method === 'POST') {
      const body = (await request.json()) as {
        text?: string;
        voice?: string;
        pitch?: string;
        rate?: string;
        volume?: string;
      };
      text = body.text ?? '';
      voice = body.voice ?? voice;
      pitch = body.pitch ?? pitch;
      rate = body.rate ?? rate;
      volume = body.volume ?? volume;
    }

    const badRequest = (message: string) =>
      new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...EDGE_TTS_CONSTANTS.COMMON_CORS },
      });

    const cleanText = typeof text === 'string' ? text.trim() : '';
    if (!cleanText) return badRequest('text is required');
    if (cleanText.length > TTS_MAX_TEXT_LENGTH) return badRequest('text too long');
    // 白名单校验: 通过后 voice 才会进入 R2 key / SSML, 非法值既不合成也不落缓存
    if (!isValidTTSVoice(voice)) return badRequest('invalid voice');
    if (!isValidTTSProsody(pitch) || !isValidTTSProsody(rate) || !isValidTTSProsody(volume)) {
      return badRequest('invalid prosody parameter');
    }

    const hashKey = await computeTextHash(cleanText, voice, pitch, rate, volume);
    const objectKey = `v1/${voice}/${hashKey}.mp3`;
    const cache = (caches as any)?.default;
    const cacheUrl = new Request(`https://internal-cache.xiaochun.local/tts/${hashKey}`);

    // 1. 尝试 L1 边缘 PoP 缓存命中 (极速 <20ms, 100% 可用率)
    if (cache) {
      try {
        const cachedRes = await cache.match(cacheUrl);
        if (cachedRes) {
          return new Response(cachedRes.body, {
            status: 200,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'public, max-age=86400',
              'X-TTS-Cache': 'HIT',
              'X-TTS-Storage': env?.TTS_BUCKET ? 'r2+pop' : 'pop',
              ...EDGE_TTS_CONSTANTS.COMMON_CORS,
            },
          });
        }
      } catch { }
    }

    // 2. 尝试 L2 R2 持久化 Bucket 缓存命中 (持久存储, 跨区域 20~50ms, 0 Egress 费用)
    const r2 = env?.TTS_BUCKET;
    if (r2) {
      try {
        const r2Object = await r2.get(objectKey);
        if (r2Object) {
          const audioArrayBuffer = await r2Object.arrayBuffer();
          // 异步回写 L1 PoP 缓存，加速后续同节点快速访问
          if (cache) {
            const l1WritePromise = (async () => {
              try {
                const cacheItem = new Response(audioArrayBuffer.slice(0), {
                  status: 200,
                  headers: {
                    'Content-Type': 'audio/mpeg',
                    'Cache-Control': 'public, max-age=86400',
                  },
                });
                await cache.put(cacheUrl, cacheItem);
              } catch { }
            })();
            if (ctx?.waitUntil) ctx.waitUntil(l1WritePromise);
          }

          return new Response(audioArrayBuffer, {
            status: 200,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'public, max-age=86400',
              'X-TTS-Cache': 'R2-HIT',
              'X-TTS-Storage': 'r2',
              ...EDGE_TTS_CONSTANTS.COMMON_CORS,
            },
          });
        }
      } catch (r2Err) {
        console.warn('[TTS] R2 cache read failed, falling back to live synthesis:', r2Err);
      }
    }

    // 3. 缓存未命中：上游 Edge-TTS 实时流式合成
    const abortController = new AbortController();
    const { stream, collectedChunks, onFinished } = await synthesizeWithRetry(
      cleanText,
      voice,
      pitch,
      rate,
      volume,
      abortController.signal,
      3,
    );

    // 4. 流完成后异步双写：L1 边缘 PoP 缓存 + L2 R2 持久化存储
    if (cache || r2) {
      const persistPromise = onFinished.then(async () => {
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
            // 写入 L1 边缘 PoP 缓存 (短文本或常用短语)
            if (cache && cleanText.length <= 200) {
              try {
                const cacheItem = new Response(merged.buffer.slice(0), {
                  status: 200,
                  headers: {
                    'Content-Type': 'audio/mpeg',
                    'Cache-Control': 'public, max-age=86400',
                  },
                });
                await cache.put(cacheUrl, cacheItem);
              } catch { }
            }

            // 写入 L2 R2 持久化存储 (全量留存，带 prosody 元数据)
            if (r2) {
              try {
                await r2.put(objectKey, merged.buffer, {
                  httpMetadata: {
                    contentType: 'audio/mpeg',
                    cacheControl: 'public, max-age=31536000, immutable',
                  },
                  customMetadata: {
                    voice,
                    pitch,
                    rate,
                    volume,
                    createdAt: new Date().toISOString(),
                  },
                });
              } catch (r2PutErr) {
                console.warn('[TTS] R2 cache put failed:', r2PutErr);
              }
            }
          }
        } catch (persistErr) {
          console.warn('[TTS] Cache persist failed:', persistErr);
        }
      });

      if (ctx?.waitUntil) {
        ctx.waitUntil(persistPromise);
      }
    }

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-TTS-Cache': 'MISS',
        'X-TTS-Storage': r2 ? 'r2' : 'none',
        ...EDGE_TTS_CONSTANTS.COMMON_CORS,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const reasons = e instanceof Error ? (e as Error & { reasons?: string[] }).reasons : undefined;
    console.error('[TTS Handle Error]:', msg, reasons ? { reasons } : '');

    // 上游细节只进服务端日志, 对客户端返回通用文案
    const isBadBody = e instanceof SyntaxError;
    return new Response(JSON.stringify({ error: isBadBody ? 'invalid request body' : 'TTS synthesis failed' }), {
      status: isBadBody ? 400 : 502,
      headers: { 'Content-Type': 'application/json', ...EDGE_TTS_CONSTANTS.COMMON_CORS },
    });
  }
}
