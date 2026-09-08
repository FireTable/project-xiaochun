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

async function fetchTTSAudioStream(
  text: string,
  voice: string,
  pitch: string,
  onAudioChunk: (chunk: Uint8Array) => void,
  onStreamEnd: () => void,
  onErrCb: (err: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  const secMsGec = await makeSecMsGec();
  const connId = makeConnectionId();
  const url = new URL(EDGE_TTS_CONSTANTS.SYNTHESIS_URL);
  url.searchParams.set('TrustedClientToken', EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN);
  url.searchParams.set('Sec-MS-GEC', secMsGec);
  url.searchParams.set('Sec-MS-GEC-Version', EDGE_TTS_CONSTANTS.SEC_MS_GEC_VERSION);
  url.searchParams.set('ConnectionId', connId);

  const upgradeRes = (await fetch(url.toString(), {
    headers: {
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0`,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'Sec-WebSocket-Version': '13',
      Upgrade: 'websocket',
      Cookie: `muid=${makeMuid()};`,
    },
  })) as Response & { webSocket?: WebSocket };

  if (upgradeRes.status !== 101 || !upgradeRes.webSocket) {
    throw new Error(`WebSocket upgrade failed: HTTP ${upgradeRes.status}`);
  }

  const socket = upgradeRes.webSocket;
  (socket as any).accept?.();
  try {
    (socket as any).binaryType = 'arraybuffer';
  } catch { }

  const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads(text, voice, pitch);

  let pendingAsync = 0;
  let ended = false;

  const closeSocket = () => {
    try {
      socket.close();
    } catch { }
  };

  const onMessage = async (e: MessageEvent) => {
    const data = e.data;
    if (typeof data === 'string') {
      const h = parseHeaders(data);
      if (data.includes('turn.failed') || data.includes('403 Forbidden') || data.includes('Unauthorized')) {
        console.error('[Edge-TTS Error Msg]:', data);
        ended = true;
        closeSocket();
        onErrCb(new Error(`Upstream rejected: ${data.slice(0, 150)}`));
        return;
      }
      if (h.Path === 'turn.end') {
        ended = true;
        closeSocket();
        const wait = () => {
          if (pendingAsync === 0) onStreamEnd();
          else setTimeout(wait, 5);
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
        onAudioChunk(f.body);
      }
    } catch (parseErr) {
      console.error('[TTS Frame Parse Error]:', parseErr);
    } finally {
      pendingAsync--;
    }
  };

  const onClose = () => {
    if (!ended) {
      ended = true;
      onStreamEnd();
    }
  };

  const onSocketError = () => {
    if (ended) return;
    onErrCb(new Error('WebSocket connection error during synthesis'));
  };

  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', onClose);
  socket.addEventListener('error', onSocketError);

  signal?.addEventListener('abort', () => {
    ended = true;
    closeSocket();
    onErrCb(new Error('TTS stream aborted by client'));
  });

  try {
    socket.send(speechConfig);
    socket.send(ssmlMessage);
  } catch (sendErr) {
    ended = true;
    closeSocket();
    onErrCb(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
  }
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

    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let streamClosed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        streamClosed = true;
        try {
          abortController.abort();
        } catch { }
      },
    });

    const abortController = new AbortController();
    fetchTTSAudioStream(
      text.trim(),
      voice,
      pitch,
      (chunk) => {
        if (streamClosed || !streamController) return;
        try {
          streamController.enqueue(chunk);
        } catch { }
      },
      () => {
        if (streamClosed || !streamController) return;
        streamClosed = true;
        try {
          streamController.close();
        } catch { }
      },
      (err) => {
        if (streamClosed || !streamController) return;
        streamClosed = true;
        try {
          streamController.error(err);
        } catch { }
      },
      abortController.signal,
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
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...EDGE_TTS_CONSTANTS.COMMON_CORS },
    });
  }
}

/** P0b B1: document must be crossOriginIsolated for ORT wasm multi-thread (SAB).
 * Workers+Assets ignores public/_headers — set COOP/COEP here on HTML/SSR responses.
 * credentialless: allow cross-origin R2/CDN onnx without CORP (require-corp breaks SAB path).
 */
const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

function withIsolationHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(ISOLATION_HEADERS)) headers.set(k, v);
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
    return withIsolationHeaders(res);
  },
};
