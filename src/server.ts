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

interface SynthesisResult {
  stream: ReadableStream<Uint8Array>;
}

async function synthesizeWithRetry(
  text: string,
  voice: string,
  pitch: string,
  clientSignal: AbortSignal,
  maxAttempts = 3,
): Promise<SynthesisResult> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (clientSignal.aborted) {
      throw new Error('TTS request aborted by client');
    }

    if (attempt > 1) {
      const backoffMs = 150 * (attempt - 1) + Math.floor(Math.random() * 150);
      console.warn(`[TTS] Synthesis attempt #${attempt} in ${backoffMs}ms...`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    let socket: WebSocket | null = null;
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let streamClosed = false;
    let ended = false;
    let pendingAsync = 0;
    let receivedFirstChunk = false;

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
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0`,
          'Accept-Language': 'en-US,en;q=0.9',
          Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          Upgrade: 'websocket',
          Cookie: `muid=${makeMuid()};`,
        },
      })) as Response & { webSocket?: WebSocket };

      if (res.status !== 101 || !res.webSocket) {
        throw new Error(`Edge-TTS handshake failed: HTTP ${res.status}`);
      }

      socket = res.webSocket;
      (socket as any).accept?.();
      try {
        (socket as any).binaryType = 'arraybuffer';
      } catch { }

      const closeSocket = () => {
        try {
          socket?.close();
        } catch { }
      };

      const cleanup = () => {
        if (streamClosed) return;
        streamClosed = true;
        closeSocket();
      };

      const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads(text, voice, pitch);

      const result = await new Promise<SynthesisResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (!receivedFirstChunk) {
            cleanup();
            reject(new Error('Timeout waiting for first audio chunk from Edge-TTS'));
          }
        }, 5000);

        const onAbort = () => {
          clearTimeout(timeoutId);
          cleanup();
          reject(new Error('TTS request aborted by client'));
        };
        clientSignal.addEventListener('abort', onAbort, { once: true });

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
              console.error('[Edge-TTS Error Msg]:', data);
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
              closeSocket();
              const wait = () => {
                if (pendingAsync === 0) {
                  if (!streamClosed && streamController) {
                    streamClosed = true;
                    try {
                      streamController.close();
                    } catch { }
                  }
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
              if (!receivedFirstChunk) {
                receivedFirstChunk = true;
                clearTimeout(timeoutId);
                if (!streamClosed && streamController) {
                  try {
                    streamController.enqueue(f.body);
                  } catch { }
                }
                resolve({ stream });
              } else {
                if (!streamClosed && streamController) {
                  try {
                    streamController.enqueue(f.body);
                  } catch { }
                }
              }
            }
          } catch (parseErr) {
            console.error('[TTS Frame Parse Error]:', parseErr);
          } finally {
            pendingAsync--;
          }
        };

        const onClose = (evt?: any) => {
          console.log('[TTS] Socket closed, code:', evt?.code, 'ended:', ended, 'receivedFirstChunk:', receivedFirstChunk);
          if (!receivedFirstChunk) {
            clearTimeout(timeoutId);
            cleanup();
            reject(new Error(`Edge-TTS socket closed before audio data (code: ${evt?.code})`));
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
          }
        };

        const onSocketError = (err?: any) => {
          console.error('[TTS] Socket error:', err?.message || err);
          if (!receivedFirstChunk) {
            clearTimeout(timeoutId);
            cleanup();
            reject(new Error('WebSocket connection error during synthesis'));
            return;
          }
          if (ended) return;
          ended = true;
          cleanup();
          if (!streamClosed && streamController) {
            try {
              streamController.error(new Error('WebSocket connection error during synthesis'));
            } catch { }
          }
        };

        socket!.addEventListener('message', onMessage);
        socket!.addEventListener('close', onClose);
        socket!.addEventListener('error', onSocketError);

        try {
          socket!.send(speechConfig);
          socket!.send(ssmlMessage);
        } catch (sendErr) {
          clearTimeout(timeoutId);
          cleanup();
          reject(sendErr);
        }
      });

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[TTS] Attempt ${attempt}/${maxAttempts} failed:`, lastError.message);
      try {
        socket?.close();
      } catch { }
    }
  }

  throw lastError ?? new Error('Failed to synthesize audio after retries');
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

    if (!text.trim()) {
      return new Response(JSON.stringify({ error: 'text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...EDGE_TTS_CONSTANTS.COMMON_CORS },
      });
    }

    const abortController = new AbortController();
    const { stream } = await synthesizeWithRetry(
      text.trim(),
      voice,
      pitch,
      abortController.signal,
      3,
    );

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
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
