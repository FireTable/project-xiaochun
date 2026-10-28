/**
 * src/server/sttHandler.ts — Cloudflare Workers AI STT 处理器。
 *
 * 模型：@cf/openai/whisper-large-v3-turbo (多语种：中日英混语原生高精识别)
 * 路由：POST /api/stt
 * 协议兼容：支持标准 multipart/form-data (file/audio) 与 raw audio/wav 二进制流。
 */

import { Buffer } from 'node:buffer';
import { COMMON_CORS } from '../lib/edge-tts-core';
import type { ExecutionContext } from '@cloudflare/workers-types';

export interface STTHandlerEnv {
  AI?: {
    run: (model: string, input: Record<string, unknown>) => Promise<any>;
  };
}

export async function handleSTT(
  request: Request,
  env?: STTHandlerEnv,
  _ctx?: ExecutionContext,
): Promise<Response> {
  // 处理 OPTIONS 跨域探测
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...COMMON_CORS,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...COMMON_CORS },
    });
  }

  if (!env?.AI) {
    return new Response(
      JSON.stringify({
        error: 'Cloudflare Workers AI binding (AI) not found. Fallback to local on-device STT.',
        code: 'AI_NOT_BOUND',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...COMMON_CORS },
      },
    );
  }

  try {
    let audioBytes: Uint8Array | null = null;
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') ?? formData.get('audio');
      if (file && typeof (file as Blob).arrayBuffer === 'function') {
        const buf = await (file as Blob).arrayBuffer();
        audioBytes = new Uint8Array(buf);
      }
    } else {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > 0) {
        audioBytes = new Uint8Array(buf);
      }
    }

    if (!audioBytes || audioBytes.byteLength === 0) {
      return new Response(JSON.stringify({ error: 'No audio data provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...COMMON_CORS },
      });
    }

    // 转换为 base64 字符串供 Workers AI Whisper 模型调用
    const base64Audio = Buffer.from(
      audioBytes.buffer,
      audioBytes.byteOffset,
      audioBytes.byteLength,
    ).toString('base64');

    // 调用 Cloudflare Workers AI Whisper Large v3 Turbo
    let result: any;
    try {
      result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
        audio: base64Audio,
      });
    } catch (err1) {
      console.warn('[STT] whisper-large-v3-turbo base64 failed, trying @cf/openai/whisper:', err1);
      result = await env.AI.run('@cf/openai/whisper', {
        audio: base64Audio,
      });
    }

    const text = typeof result?.text === 'string' ? result.text.trim() : '';

    return new Response(
      JSON.stringify({
        text,
        word_count: result?.word_count ?? (text ? text.length : 0),
        vtt: result?.vtt,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...COMMON_CORS,
        },
      },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[STT Handle Error]:', msg);

    const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('rate limit');
    const status = isRateLimit ? 429 : 502;

    return new Response(
      JSON.stringify({
        error: msg,
        code: isRateLimit ? 'RATE_LIMIT_EXCEEDED' : 'INFERENCE_FAILED',
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json', ...COMMON_CORS },
      },
    );
  }
}
