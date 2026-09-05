/**
 * localApiPlugin — 本地 dev /api/tts 中间件。
 *
 * ponytail: EU 出口连不上 Microsoft TTS, 设了 TTS_PROXY_URL 就转发到远端
 * (生产 Cloudflare Worker 上的 /api/tts), 没设就走本地 edge-tts-universal (Mac 上大概率超时)。
 */

import { EdgeTTS } from 'edge-tts-universal';
import type { Plugin } from 'vite';

const TTS_PROXY_TIMEOUT_MS = 12_000;

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

        // CORS preflight
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.end();
          return;
        }

        let bodyText = '';
        req.on('data', (chunk) => { bodyText += chunk; });
        req.on('end', async () => {
          // ponytail: TTS_PROXY_URL 设了就转发到远端, 不走本地 EdgeTTS。
          if (ttsProxyUrl) {
            // ponytail: 兼容两种配置 —— 完整 endpoint (含 /api/tts) 或纯 base URL,
            // 没 /api/tts 就自动追加, 避免配错直接 POST 到首页。
            const target = /\/api\/tts(\/|$|\?)/.test(ttsProxyUrl)
              ? ttsProxyUrl
              : `${ttsProxyUrl.replace(/\/+$/, '')}/api/tts`;
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), TTS_PROXY_TIMEOUT_MS);
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
              const cache = upstream.headers.get('cache-control');
              if (cache) res.setHeader('Cache-Control', cache);
              res.setHeader('Access-Control-Allow-Origin', '*');
              if (!upstream.body) {
                res.end();
                return;
              }
              const buf = Buffer.from(await upstream.arrayBuffer());
              res.end(buf);
            } catch (err: any) {
              console.error('[Local Vite TTS Proxy Error]', err);
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `TTS proxy failed: ${String(err?.message || err)}` }));
            }
            return;
          }

          // 没设 TTS_PROXY_URL, 走本地 EdgeTTS。
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
              } catch { /* ignore */ }
            }

            if (!text.trim()) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'text is required' }));
              return;
            }

            const tts = new EdgeTTS(text.trim(), voice, { pitch, rate: '+0%' });
            const result = await tts.synthesize();
            const buffer = Buffer.from(await result.audio.arrayBuffer());
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.end(buffer);
          } catch (err: any) {
            console.error('[Local Vite TTS Error]', err);
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String(err?.message || err) }));
          }
        });
      });
    },
  };
}