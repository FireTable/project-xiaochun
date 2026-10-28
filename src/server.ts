/**
 * Custom Cloudflare Worker entry — wraps TanStack Start SSR handler with /api/tts and /api/stt.
 *
 * Request routing:
 * - /api/tts → Native Edge-TTS WebSocket proxy, returns audio/mpeg stream
 * - /api/stt → Cloudflare Workers AI Whisper Large v3 Turbo, returns JSON transcription
 * - Other dynamic paths → TanStack Start streaming SSR handler
 * - Static assets → Served directly via Cloudflare Assets
 */
import handler from '@tanstack/react-start/server-entry';
import { applySecurityHeaders, type SecurityEnv } from './lib/securityHeaders';
import { handleTTS, type TTSHandlerEnv } from './server/ttsHandler';
import { handleSTT, type STTHandlerEnv } from './server/sttHandler';
import type { ExecutionContext } from '@cloudflare/workers-types';

export interface ServerEnv extends SecurityEnv, TTSHandlerEnv, STTHandlerEnv {
  ASSETS?: { fetch: typeof fetch };
  EMAGE_MODELS_BASE?: string;
  EMBED_FRAME_ANCESTORS?: string;
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
  async fetch(request: Request, env: unknown, ctx?: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/api/tts') {
      return handleTTS(request, env as ServerEnv, ctx);
    }
    if (url.pathname === '/api/stt') {
      return handleSTT(request, env as ServerEnv, ctx);
    }
    const res = await handler.fetch(request, env as Parameters<typeof handler.fetch>[1]);
    return withSecurityHeaders(res, url.pathname, (env ?? {}) as SecurityEnv);
  },
};
