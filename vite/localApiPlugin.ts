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
import { getSharedWarmEdgePool } from '../src/server/warmEdgePool';

const TTS_PROXY_TIMEOUT_MS = 12_000;
const DEV_REGION_CACHE_TTL_MS = 3 * 60_000;
const DEV_REGION_MISS_TTL_MS = 15_000;
const DEV_REGION_PROBE_TIMEOUT_MS = 1500;
const CF_TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
const HF_MIRROR_GEO_PROBE_URL = 'https://hf-mirror.com/api/models/ozhyhinas/MiniCPM5-2B-q4f16_1-MLC';

let cachedDevRegion: { country: string | null; expiresAt: number } | null = null;
let inFlightDevRegion: Promise<string | null> | null = null;

async function probeOutboundCountryNode(): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEV_REGION_PROBE_TIMEOUT_MS);

  const tracePromise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(CF_TRACE_URL, {
        method: 'GET',
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const text = await res.text();
      const match = text.match(/^loc=([A-Z]{2})$/m);
      const code = match?.[1] ?? '';
      return code && code !== 'XX' && code !== 'T1' ? code : null;
    } catch {
      return null;
    }
  })();

  const mirrorGeoPromise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(HF_MIRROR_GEO_PROBE_URL, {
        method: 'HEAD',
        redirect: 'manual',
        signal: ctrl.signal,
      });
      if (res.status === 200) return 'CN';
      if (res.status >= 300 && res.status < 400) return 'ZZ';
      return null;
    } catch {
      return null;
    }
  })();

  try {
    const traceCountry = await tracePromise;
    if (traceCountry) {
      ctrl.abort();
      return traceCountry;
    }
    return await mirrorGeoPromise;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

async function resolveDevCountry(): Promise<string | null> {
  const rawCountry = (process.env.XC_DEV_COUNTRY || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(rawCountry)) {
    return rawCountry;
  }

  const now = Date.now();
  if (cachedDevRegion && now < cachedDevRegion.expiresAt) {
    return cachedDevRegion.country;
  }

  const refresh =
    inFlightDevRegion ??
    (inFlightDevRegion = probeOutboundCountryNode()
      .then((country) => {
        cachedDevRegion = {
          country,
          expiresAt: Date.now() + (country ? DEV_REGION_CACHE_TTL_MS : DEV_REGION_MISS_TTL_MS),
        };
        return country;
      })
      .finally(() => {
        inFlightDevRegion = null;
      }));

  // Stale-while-revalidate: 已有历史探测值时 0ms 立即返回，后台异步刷新代理切换状态
  if (cachedDevRegion?.country) {
    void refresh.catch(() => {});
    return cachedDevRegion.country;
  }
  return refresh;
}

export async function streamNativeEdgeTTSNode(
  text: string,
  voice: string,
  pitch: string = '+10Hz',
  rate: string = '+0%',
  volume: string = '+0%',
  onChunk: (chunk: Uint8Array) => Promise<boolean> | boolean,
  signal: AbortSignal
): Promise<void> {
  // 先校验 / 构造 payload: 非法参数在这里抛出 (async 函数 → reject), 由调用方转成错误响应; 不能等到 socket 'open' 监听器里再抛 (那里没有 try/catch, 会变成未捕获异常)
  const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads(text, voice, pitch, rate, volume);
  const secMsGec = await makeSecMsGec();
  const connId = makeConnectionId();
  // 采用 Sec-MS-GEC v2 签名直连主端点 speech.platform.bing.com
  const url = new URL(EDGE_TTS_CONSTANTS.SYNTHESIS_URL.replace(/^https:/, 'wss:'));
  url.searchParams.set('TrustedClientToken', EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN);
  url.searchParams.set('Sec-MS-GEC', secMsGec);
  url.searchParams.set('Sec-MS-GEC-Version', EDGE_TTS_CONSTANTS.SEC_MS_GEC_VERSION);
  url.searchParams.set('ConnectionId', connId);

  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url.toString(), {
      headers: {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0`,
        'Accept-Language': 'en-US,en;q=0.9',
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

export function localApiPlugin(ttsProxyUrl?: string, sttProxyUrl?: string): Plugin {
  const resolvedSttProxy =
    sttProxyUrl ||
    (ttsProxyUrl && !ttsProxyUrl.includes('/api/tts')
      ? `${ttsProxyUrl.replace(/\/+$/, '')}/api/stt`
      : '');

  return {
    name: 'local-api-plugin',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        void resolveDevCountry().catch(() => {});
      });

      if (!ttsProxyUrl) {
        const pool = getSharedWarmEdgePool();
        server.httpServer?.once('listening', () => {
          void pool.warm().catch(() => {});
        });
        server.httpServer?.once('close', () => {
          pool.dispose();
        });
      }

      server.middlewares.use(async (req, res, next) => {
        const host = req.headers.host || 'localhost:5185';
        const url = new URL(req.url || '', `http://${host}`);

        if (url.pathname === '/api/region' && (req.method === 'GET' || req.method === 'HEAD')) {
          const country = await resolveDevCountry();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ country }));
          return;
        }

        if (url.pathname === '/api/stt') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            for (const [k, v] of Object.entries(EDGE_TTS_CONSTANTS.COMMON_CORS)) {
              res.setHeader(k, v);
            }
            res.end();
            return;
          }

          if (resolvedSttProxy) {
            try {
              const controller = new AbortController();
              req.on('close', () => controller.abort());
              const chunks: Buffer[] = [];
              req.on('data', (c) => chunks.push(c));
              req.on('end', async () => {
                try {
                  const body = Buffer.concat(chunks);
                  const upstream = await fetch(resolvedSttProxy, {
                    method: 'POST',
                    headers: {
                      'Content-Type': req.headers['content-type'] ?? 'audio/wav',
                    },
                    body,
                    signal: controller.signal,
                  });
                  res.statusCode = upstream.status;
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  const text = await upstream.text();
                  res.end(text);
                } catch (fetchErr: any) {
                  console.warn('[Vite Local STT Proxy Fetch Error]', fetchErr);
                  res.statusCode = 502;
                  res.setHeader('Content-Type', 'application/json');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  res.end(JSON.stringify({ error: String(fetchErr?.message || fetchErr), code: 'PROXY_ERROR' }));
                }
              });
              return;
            } catch (err: any) {
              console.warn('[Vite Local STT Proxy Error]', err);
            }
          }

          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(
            JSON.stringify({
              error: 'Local Vite Dev: Cloudflare Workers AI runs in Cloudflare Workers. Falling back to on-device SenseVoice.',
              code: 'LOCAL_DEV_FALLBACK',
            }),
          );
          return;
        }

        if (url.pathname === '/api/tts/warm') {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            for (const [k, v] of Object.entries(EDGE_TTS_CONSTANTS.COMMON_CORS)) {
              res.setHeader(k, v);
            }
            res.end();
            return;
          }
          if (req.method !== 'GET' && req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Access-Control-Allow-Origin', '*');
          if (ttsProxyUrl) {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, proxied: true, warmSockets: 0 }));
            return;
          }
          const stats = await getSharedWarmEdgePool().warm();
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              ok: stats.idleSockets > 0,
              warmSockets: stats.idleSockets,
              ...stats,
            }),
          );
          return;
        }

        if (url.pathname !== '/api/tts') {
          next();
          return;
        }

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          for (const [k, v] of Object.entries(EDGE_TTS_CONSTANTS.COMMON_CORS)) {
            res.setHeader(k, v);
          }
          res.setHeader('Access-Control-Expose-Headers', 'X-TTS-Warm, X-TTS-TTFA-Ms');
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

          // 模式 2：未配置 ttsProxyUrl，使用预热 WebSocket 连接池直连流式/缓冲下发
          try {
            let text = url.searchParams.get('text') || '';
            let voice = url.searchParams.get('voice') || 'zh-CN-XiaoyiNeural';
            let pitch = url.searchParams.get('pitch') || '+10Hz';
            let rate = url.searchParams.get('rate') || '+0%';
            let volume = url.searchParams.get('volume') || '+0%';
            let buffered =
              url.searchParams.get('buffered') === '1' ||
              url.searchParams.get('buffered') === 'true' ||
              url.searchParams.get('mode') === 'raw';

            if (bodyText) {
              try {
                const parsed = JSON.parse(bodyText);
                if (parsed.text) text = parsed.text;
                if (parsed.voice) voice = parsed.voice;
                if (parsed.pitch) pitch = parsed.pitch;
                if (parsed.rate) rate = parsed.rate;
                if (parsed.volume) volume = parsed.volume;
                if (parsed.buffered === true || parsed.mode === 'raw') buffered = true;
              } catch { }
            }

            if (!text.trim()) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(JSON.stringify({ error: 'text is required' }));
              return;
            }

            // 非法 voice / pitch / rate / volume: 在打开上游 socket 之前就返回 400
            try {
              buildEdgeTTSPayloads(text.trim(), voice, pitch, rate, volume);
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(JSON.stringify({ error: 'invalid tts parameter' }));
              return;
            }

            const abortController = new AbortController();
            res.on('close', () => {
              if (!res.writableEnded) {
                abortController.abort();
              }
            });

            const pool = getSharedWarmEdgePool();

            if (buffered) {
              const { audio, meta } = await pool.synthesizeBuffer({
                text: text.trim(),
                voice,
                pitch,
                rate,
                volume,
                signal: abortController.signal,
              });
              if (abortController.signal.aborted) return;
              res.statusCode = 200;
              res.setHeader('Content-Type', 'audio/mpeg');
              res.setHeader('Content-Length', String(audio.byteLength));
              res.setHeader('Cache-Control', 'no-store');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Expose-Headers', 'X-TTS-Warm, X-TTS-TTFA-Ms');
              res.setHeader('X-TTS-Warm', meta.warmHit ? '1' : '0');
              res.setHeader('X-TTS-TTFA-Ms', String(Math.round(meta.ttfaMs)));
              res.end(audio);
              return;
            }

            let headersSent = false;
            await pool.synthesizeStream({
              text: text.trim(),
              voice,
              pitch,
              rate,
              volume,
              signal: abortController.signal,
              onFirstAudio: ({ warmHit, ttfaMs }) => {
                if (headersSent || abortController.signal.aborted) return;
                headersSent = true;
                res.statusCode = 200;
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Expose-Headers', 'X-TTS-Warm, X-TTS-TTFA-Ms');
                res.setHeader('X-TTS-Warm', warmHit ? '1' : '0');
                res.setHeader('X-TTS-TTFA-Ms', String(Math.round(ttfaMs)));
              },
              onChunk: async (chunk) => {
                if (abortController.signal.aborted || res.writableEnded) return;
                const flushed = res.write(chunk);
                if (!flushed) {
                  await new Promise<void>((r) => res.once('drain', () => r()));
                }
              },
            });

            if (!headersSent && !res.headersSent) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(JSON.stringify({ error: 'Upstream returned no audio' }));
              return;
            }
            if (!res.writableEnded) {
              res.end();
            }
          } catch (err: any) {
            if (err?.message === 'TTS client aborted') {
              if (!res.writableEnded) res.end();
              return;
            }
            console.error('[Local Native Node TTS Error]', err);
            if (!res.headersSent) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.end(JSON.stringify({ error: String(err?.message || err) }));
            } else if (!res.writableEnded) {
              res.end();
            }
          }
        });
      });
    },
  };
}