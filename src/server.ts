/**
 * Custom Cloudflare Worker entry — wraps TanStack Start handler with /api/tts.
 *
 * ponytail: Cloudflare Workers 不支持 Pages 的 `functions/` 目录 + _headers,
 * 路由逻辑全塞进这个 fetch handler 里:
 * - /api/tts → 跑 Edge-TTS WebSocket,返回 audio/mpeg
 * - 其他所有路径 → 交给 TanStack Start SSR
 * - 静态资源(/assets/*, /xiaochun_v1.vrm, /robots.txt 等) → 走 assets binding
 */
import handler from '@tanstack/react-start/server-entry';

// Edge-TTS helper — Workers 环境下用原生 fetch + WebSocket(替代 edge-tts-universal)
async function handleTTS(request: Request): Promise<Response> {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  const CHROMIUM_FULL_VERSION = '143.0.3650.75';
  const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
  const SYNTHESIS_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`;

  function makeConnectionId(): string {
    return crypto.randomUUID().replace(/-/g, '');
  }
  function makeMuid(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  async function makeSecMsGec(): Promise<string> {
    const winEpoch = 11644473600;
    const secToNs = 1e9;
    let ticks = Date.now() / 1000 + winEpoch;
    ticks -= ticks % 300;
    ticks *= secToNs / 100;
    const payload = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(payload)
    );
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  function escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  function timestamp(): string {
    return new Date().toISOString().replace(/[-:.]/g, '').slice(0, -1);
  }

  function normalizeVoiceName(voice: string): string {
    const trimmed = voice.trim();
    const m = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(trimmed);
    if (!m) return trimmed;
    const lang = m[1];
    let [, , region, name] = m;
    if (name.includes('-')) {
      const [r, ...rest] = name.split('-');
      region += `-${r}`;
      name = rest.join('-');
    }
    return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
  }

  function buildSpeechConfig(): string {
    return (
      `X-Timestamp:${timestamp()}\r\n` +
      'Content-Type:application/json; charset=utf-8\r\n' +
      'Path:speech.config\r\n\r\n' +
      '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
    );
  }

  function buildSsml(reqId: string, voice: string, text: string, pitch: string, rate: string): string {
    const ssml =
      "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
      `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
    return (
      `X-RequestId:${reqId}\r\n` +
      'Content-Type:application/ssml+xml\r\n' +
      `X-Timestamp:${timestamp()}Z\r\n` +
      'Path:ssml\r\n\r\n' +
      ssml
    );
  }

  function parseHeaders(block: string): Record<string, string> {
    const sep = block.indexOf('\r\n\r\n');
    const txt = sep >= 0 ? block.slice(0, sep) : block;
    const out: Record<string, string> = {};
    for (const line of txt.split('\r\n')) {
      const i = line.indexOf(':');
      if (i <= 0) continue;
      out[line.slice(0, i)] = line.slice(i + 1).trim();
    }
    return out;
  }

  function parseBinaryFrame(buf: Uint8Array): { headers: Record<string, string>; body: Uint8Array } {
    if (buf.length < 2) throw new Error('binary frame missing header length');
    const len = (buf[0] << 8) | buf[1];
    if (buf.length < 2 + len) throw new Error('binary frame truncated');
    const head = new TextDecoder().decode(buf.slice(2, 2 + len));
    const h = parseHeaders(head);
    return { headers: h, body: buf.slice(2 + len) };
  }

  async function streamTTS(text: string, voice: string, pitch: string): Promise<ReadableStream<Uint8Array>> {
    const secMsGec = await makeSecMsGec();
    const connId = makeConnectionId();
    const url = new URL(SYNTHESIS_URL);
    url.searchParams.set('TrustedClientToken', TRUSTED_CLIENT_TOKEN);
    url.searchParams.set('Sec-MS-GEC', secMsGec);
    url.searchParams.set('Sec-MS-GEC-Version', SEC_MS_GEC_VERSION);
    url.searchParams.set('ConnectionId', connId);

    const upgradeRes = (await fetch(url.toString(), {
      headers: {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0`,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'Sec-WebSocket-Version': '13',
        Upgrade: 'websocket',
        Cookie: `muid=${makeMuid()};`,
      },
    })) as Response & { webSocket?: WebSocket };

    if (upgradeRes.status !== 101 || !upgradeRes.webSocket) {
      throw new Error(`WebSocket upgrade failed: HTTP ${upgradeRes.status}`);
    }

    const socket = upgradeRes.webSocket;
    const reqId = makeConnectionId();
    const formattedVoice = normalizeVoiceName(voice);
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    let settled = false;

    const cleanup = () => {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      controllerRef?.close();
    };
    const finishWithError = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      controllerRef?.error(err instanceof Error ? err : new Error(String(err)));
    };

    const onMessage = (e: MessageEvent) => {
      if (settled) return;
      const data = e.data;
      if (typeof data === 'string') {
        const h = parseHeaders(data);
        if (h.Path === 'turn.end') {
          try { socket.close(); } catch { finish(); }
        }
        return;
      }
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      const f = parseBinaryFrame(u8);
      if (f.headers.Path === 'audio') controllerRef?.enqueue(f.body);
    };
    const onClose = () => finish();
    const onError = (_e: Event) => finishWithError(new Error('WebSocket error'));

    return new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        socket.addEventListener('message', onMessage);
        socket.addEventListener('close', onClose);
        socket.addEventListener('error', onError);
        socket.accept();
        socket.send(buildSpeechConfig());
        socket.send(buildSsml(reqId, formattedVoice, text, pitch, '+0%'));
      },
      cancel(reason) {
        cleanup();
        settled = true;
        try { socket.close(1000, typeof reason === 'string' ? reason : 'cancelled'); } catch { /* noop */ }
      },
    });
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
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const stream = await streamTTS(text.trim(), voice, pitch);
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
        ...CORS,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}

export default {
  async fetch(request: Request, env: unknown) {
    const url = new URL(request.url);
    if (url.pathname === '/api/tts') {
      return handleTTS(request);
    }
    // ponytail: 静态资源(robots.txt / sitemap.xml / llms.txt / .vrm / og.jpg 等)由 assets binding 自动服务,
    // 不进 TanStack Start handler。其他路径全交给 SSR。
    return handler.fetch(request, env as Parameters<typeof handler.fetch>[1]);
  },
};
