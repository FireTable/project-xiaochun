/**
 * Project XiaoChun — Standalone Edge-TTS + R2 Cloudflare Worker
 *
 * Ultra-lightweight dedicated speech synthesis microservice.
 * Fully decoupled from TanStack Start SSR & 3D Web frontend assets.
 *
 * Routing:
 * - GET  / (or /health)  → Microservice status, endpoints & R2 cache state
 * - POST /api/tts        → Edge-TTS streaming synthesis (MP3)
 * - GET  /api/tts        → Edge-TTS streaming synthesis (MP3)
 * - Any other path       → Auto-forwarded to handleTTS
 */
import { handleTTS, type TTSHandlerEnv } from './server/ttsHandler';

export default {
  async fetch(request: Request, env: TTSHandlerEnv, ctx?: { waitUntil?: (p: Promise<unknown>) => void }) {
    const url = new URL(request.url);

    // 状态与能力自检接口 (GET / 或 /health)
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(
        JSON.stringify(
          {
            service: 'xiaochun-tts',
            name: 'Project XiaoChun Standalone Edge-TTS Microservice',
            status: 'online',
            endpoints: {
              tts: '/api/tts (POST / GET)',
              health: '/health',
            },
            capabilities: {
              prosody_matrix: ['text', 'voice', 'pitch', 'rate', 'volume'],
              r2_persistent_cache: !!env.TTS_BUCKET,
              l1_pop_cache: true,
            },
            version: '1.0.0',
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ),
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        },
      );
    }

    // 所有其他请求直接转交 TTS 处理器 (支持 /api/tts, /tts 或根路径直接 POST/GET)
    return handleTTS(request, env, ctx);
  },
};
