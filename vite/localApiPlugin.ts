/**
 * localApiPlugin — 本地 dev /api/tts 中间件。
 *
 * 1. 若配置了 ttsProxyUrl，通过 Node 原生流式管道反向代理到远端 Worker；
 * 2. 若未配置 ttsProxyUrl，使用 Node.js 原生 WebSocket 直连 Edge-TTS，
 *    实现真正的端到端 MP3 流式下发。
 */

import type { Plugin } from 'vite';
import {
  EDGE_TTS_CONSTANTS,
  makeConnectionId,
  makeMuid,
  makeSecMsGec,
  buildEdgeTTSPayloads,
  parseHeaders,
  parseBinaryFrame,
} from '../src/lib/edge-tts-core';

const TTS_PROXY_TIMEOUT_MS = 12_000;

async function streamNativeEdgeTTSNode(
  text: string,
  voice: string,
  pitch: string,
  onChunk: (chunk: Uint8Array) => Promise<boolean> | boolean,
  signal: AbortSignal
): Promise<void> {
  const secMsGec = await makeSecMsGec();
  const connId = makeConnectionId();
  const url = new URL(EDGE_TTS_CONSTANTS.SYNTHESIS_WSS_URL);
  url.searchParams.set('TrustedClientToken', EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN);
  url.searchParams.set('Sec-MS-GEC', secMsGec);
  url.searchParams.set('Sec-MS-GEC-Version', EDGE_TTS_CONSTANTS.SEC_MS_GEC_VERSION);
  url.searchParams.set('ConnectionId', connId);

  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url.toString(), {
      headers: {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0`,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        Cookie: `muid=${makeMuid()};`,
      },
    } as any);

    socket.binaryType = 'arraybuffer';

    let ended = false;
    const closeSocket = () => {
      try {
        socket.close();
      } catch { }
    };

    signal.addEventListener('abort', () => {
      ended = true;
      closeSocket();
      reject(new Error('TTS client aborted'));
    });

    socket.addEventListener('open', () => {
      const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads(text, voice, pitch);
      try {
        socket.send(speechConfig);
        socket.send(ssmlMessage);
      } catch (err) {
        ended = true;
        closeSocket();
        reject(err);
      }
    });

    socket.addEventListener('message', async (e: MessageEvent) => {
      const data = e.data;
      if (typeof data === 'string') {
        const h = parseHeaders(data);
        if (data.includes('turn.failed') || data.includes('403 Forbidden') || data.includes('Unauthorized')) {
          ended = true;
          closeSocket();
          reject(new Error(`Upstream rejected: ${data.slice(0, 150)}`));
          return;
        }
        if (h.Path === 'turn.end') {
          ended = true;
          closeSocket();
          resolve();
        }
        return;
      }

      let u8: Uint8Array;
      if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
      else if (data instanceof Uint8Array) u8 = data;
      else if (typeof Blob !== 'undefined' && data instanceof Blob) u8 = new Uint8Array(await data.arrayBuffer());
      else return;

      try {
        const f = parseBinaryFrame(u8);
        if (f.headers.Path === 'audio' && f.body.length > 0) {
          await onChunk(f.body);
        }
      } catch (err) {
        console.error('[Vite Local TTS Frame Parse Error]', err);
      }
    });

    socket.addEventListener('close', () => {
      if (!ended) {
        ended = true;
        resolve();
      }
    });

    socket.addEventListener('error', (err) => {
      if (!ended) {
        ended = true;
        reject(new Error(`WebSocket error: ${String((err as any)?.message || 'connection failed')}`));
      }
    });
  });
}

export function localApiPlugin(ttsProxyUrl: string): Plugin {
  return {
    name: 'local-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const host = req.headers.host || 'localhost:5185';
        const url = new URL(req.url || '', `http://${host}`);

        if (url.pathname !== '/api/tts') {
          next();
          return;
        }

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          for (const [k, v] of Object.entries(EDGE_TTS_CONSTANTS.COMMON_CORS)) {
            res.setHeader(k, v);
          }
          res.end();
          return;
        }

        let bodyText = '';
        req.on('data', (chunk) => {
          bodyText += chunk;
        });

        req.on('end', async () => {
          // 模式 1：配置了 ttsProxyUrl，代理到远端 Worker
          if (ttsProxyUrl) {
            const target = /\/api\/tts(\/|$|\?)/.test(ttsProxyUrl)
              ? ttsProxyUrl
              : `${ttsProxyUrl.replace(/\/+$/, '')}/api/tts`;
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), TTS_PROXY_TIMEOUT_MS);

              req.on('close', () => {
                controller.abort();
              });

              const upstream = await fetch(target, {
                method: req.method,
                headers: {
                  'Content-Type': req.headers['content-type'] ?? 'application/json',
                },
                body: req.method === 'GET' ? undefined : bodyText,
                signal: controller.signal,
              });
              clearTimeout(timer);

              res.statusCode = upstream.status;
              res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg');
              res.setHeader('Cache-Control', upstream.headers.get('cache-control') ?? 'no-store');
              res.setHeader('Access-Control-Allow-Origin', '*');

              if (!upstream.body) {
                res.end();
                return;
              }

              const reader = upstream.body.getReader();
              const pump = async () => {
                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  if (value) {
                    const flushed = res.write(value, (err) => {
                      if (err) {
                        controller.abort();
                        reader.cancel();
                      }
                    });
                    if (!flushed) {
                      await new Promise<void>((r) => res.once('drain', () => r()));
                    }
                  }
                }
                res.end();
              };

              pump().catch((err) => {
                console.error('[Local Vite TTS Proxy Pump Error]', err);
                try {
                  res.end();
                } catch { }
              });
            } catch (err: any) {
              console.error('[Local Vite TTS Proxy Error]', err);
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `TTS proxy failed: ${String(err?.message || err)}` }));
            }
            return;
          }

          // 模式 2：未配置 ttsProxyUrl，本地直接流式下发
          try {
            let text = url.searchParams.get('text') || '';
            let voice = url.searchParams.get('voice') || 'zh-CN-XiaoyiNeural';
            let pitch = url.searchParams.get('pitch') || '+10Hz';

            if (bodyText) {
              try {
                const parsed = JSON.parse(bodyText);
                if (parsed.text) text = parsed.text;
                if (parsed.voice) voice = parsed.voice;
                if (parsed.pitch) pitch = parsed.pitch;
              } catch { }
            }

            if (!text.trim()) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'text is required' }));
              return;
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Access-Control-Allow-Origin', '*');

            const abortController = new AbortController();
            req.on('close', () => {
              abortController.abort();
            });

            await streamNativeEdgeTTSNode(
              text.trim(),
              voice,
              pitch,
              async (chunk) => {
                const flushed = res.write(chunk);
                if (!flushed) {
                  await new Promise<void>((r) => res.once('drain', () => r()));
                }
                return true;
              },
              abortController.signal
            );

            res.end();
          } catch (err: any) {
            console.error('[Local Native Node TTS Error]', err);
            if (!res.headersSent) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: String(err?.message || err) }));
            } else {
              res.end();
            }
          }
        });
      });
    },
  };
}