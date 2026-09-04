/**
 * Custom Cloudflare Worker entry — wraps TanStack Start SSR handler with /api/tts.
 *
 * Request routing:
 * - /api/tts → Native Edge-TTS WebSocket proxy, returns audio/mpeg stream
 * - Other dynamic paths → TanStack Start streaming SSR handler
 * - Static assets (/assets/*, /xiaochun_v1.vrm, /robots.txt, etc.) → Served directly via Cloudflare Assets
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
  const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
  const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
  const SYNTHESIS_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

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

  function normalizeVoiceName(voice: string): string {
    const match = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(voice.trim());
    if (match) {
      const [, lang] = match;
      let [, , region, name] = match;
      if (name.includes('-')) {
        const parts = name.split('-');
        region += `-${parts[0]}`;
        name = parts[1];
      }
      return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
    }
    return voice.trim();
  }

  function removeIncompatibleCharacters(str: string): string {
    const charsToRemove = '*/()[]{}$%^@#+=|\\~`><"&';
    let cleanStr = str;
    for (const char of charsToRemove) {
      cleanStr = cleanStr.replace(new RegExp('\\' + char, 'g'), '');
    }
    return cleanStr;
  }

  function dateToString(date?: Date): string {
    const d = date ?? new Date();
    return d.toISOString().replace(/[-:.]/g, '').slice(0, -1);
  }

  function escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
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

  async function fetchTTSAudio(text: string, voice: string, pitch: string): Promise<Uint8Array> {
    const secMsGec = await makeSecMsGec();
    const connId = makeConnectionId();
    const url = new URL(SYNTHESIS_URL);
    url.searchParams.set('TrustedClientToken', TRUSTED_CLIENT_TOKEN);
    url.searchParams.set('Sec-MS-GEC', secMsGec);
    url.searchParams.set('Sec-MS-GEC-Version', SEC_MS_GEC_VERSION);
    url.searchParams.set('ConnectionId', connId);

    const upgradeRes = (await fetch(url.toString(), {
      headers: {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
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
    } catch {}

    const reqId = makeConnectionId();
    const ts = dateToString();
    const formattedVoice = normalizeVoiceName(voice);
    const cleanText = escapeXml(removeIncompatibleCharacters(text));

    const speechConfig =
      `X-Timestamp:${ts}\r\n` +
      'Content-Type:application/json; charset=utf-8\r\n' +
      'Path:speech.config\r\n\r\n' +
      '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';

    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
      `<voice name='${formattedVoice}'><prosody pitch='${pitch}' rate='+0%' volume='+0%'>${cleanText}</prosody></voice></speak>`;

    const ssmlMessage =
      `X-RequestId:${reqId}\r\n` +
      'Content-Type:application/ssml+xml\r\n' +
      `X-Timestamp:${ts}Z\r\n` +
      'Path:ssml\r\n\r\n' +
      ssml;

    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      const textLogs: string[] = [];
      let pendingAsyncBinary = 0;
      let turnEnded = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let finished = false;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        socket.removeEventListener('message', onMessage as any);
        socket.removeEventListener('close', onClose);
        socket.removeEventListener('error', onError);
      };

      const checkFinish = () => {
        if (!turnEnded || pendingAsyncBinary > 0 || finished) return;
        finished = true;
        cleanup();
        if (chunks.length === 0) {
          reject(new Error(`No audio chunks received from TTS service. Responses: ${textLogs.slice(-4).join('; ') || 'none'}`));
          return;
        }
        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        resolve(merged);
      };

      const onMessage = async (e: MessageEvent) => {
        const data = e.data;
        if (typeof data === 'string') {
          const h = parseHeaders(data);
          if (h.Path === 'turn.end') {
            turnEnded = true;
            try { socket.close(); } catch { /* noop */ }
            checkFinish();
          } else {
            textLogs.push(`Txt:${h.Path || 'no-path'}`);
          }
          return;
        }

        pendingAsyncBinary++;
        try {
          let u8: Uint8Array;
          if (data instanceof ArrayBuffer) {
            u8 = new Uint8Array(data);
          } else if (data instanceof Uint8Array) {
            u8 = data;
          } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
            u8 = new Uint8Array(await data.arrayBuffer());
          } else if (data && typeof data === 'object' && 'buffer' in data && (data as any).buffer instanceof ArrayBuffer) {
            u8 = new Uint8Array((data as any).buffer);
          } else {
            textLogs.push(`UnknownBin:${typeof data}:${data?.constructor?.name}`);
            return;
          }

          const f = parseBinaryFrame(u8);
          if (f.headers.Path === 'audio' && f.body.length > 0) {
            chunks.push(f.body);
          } else {
            textLogs.push(`BinNotAudio:${f.headers.Path || 'no-path'}:len=${f.body.length}`);
          }
        } catch (parseErr: any) {
          textLogs.push(`ParseErr:${parseErr?.message || String(parseErr)}`);
        } finally {
          pendingAsyncBinary--;
          checkFinish();
        }
      };

      const onClose = () => finish();
      const onError = (_e: Event) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error('WebSocket connection error during synthesis'));
      };

      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onError);

      // 10 秒超时保护
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        cleanup();
        try { socket.close(); } catch {}
        if (chunks.length > 0) {
          finish();
        } else {
          reject(new Error('TTS request timed out after 10s'));
        }
      }, 10000);

      try {
        socket.send(speechConfig);
        socket.send(ssmlMessage);
      } catch (sendErr) {
        if (finished) return;
        finished = true;
        cleanup();
        reject(sendErr);
      }
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

    const audioBuffer = await fetchTTSAudio(text.trim(), voice, pitch);
    return new Response(audioBuffer.buffer as ArrayBuffer, {
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
