/**
 * Cloudflare Pages Function: /api/tts
 * 专为 Cloudflare Pages 设计的 Edge-TTS 边缘端点
 * 默认使用 🌸 晓伊 (zh-CN-XiaoyiNeural +10Hz 元气少女)
 */

const DEFAULT_VOICE = "zh-CN-XiaoyiNeural";
const DEFAULT_PITCH = "+10Hz";
const DEFAULT_RATE = "+0%";

const READALOUD_BASE = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SYNTHESIS_URL = `https://${READALOUD_BASE}/edge/v1`;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

const BASE_HEADERS: Record<string, string> = {
  "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  "Accept-Language": "en-US,en;q=0.9",
};

const UPGRADE_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  "Accept-Encoding": "gzip, deflate, br, zstd",
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  "Sec-WebSocket-Version": "13",
  Upgrade: "websocket",
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function normalizeVoiceName(voice: string): string {
  const trimmed = voice.trim();
  const shortMatch = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(trimmed);
  if (!shortMatch) return trimmed;

  const [, lang] = shortMatch;
  let [, , region, name] = shortMatch;
  if (name.includes("-")) {
    const [regionSuffix, ...nameParts] = name.split("-");
    region += `-${regionSuffix}`;
    name = nameParts.join("-");
  }
  return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function removeInvalidXmlCharacters(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ");
}

function makeConnectionId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function makeMuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function makeSecMsGec(): Promise<string> {
  const winEpoch = 11644473600;
  const secondsToNs = 1e9;
  let ticks = Date.now() / 1000;
  ticks += winEpoch;
  ticks -= ticks % 300;
  ticks *= secondsToNs / 100;
  const payload = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, -1);
}

function buildSpeechConfigMessage(): string {
  return (
    `X-Timestamp:${timestamp()}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  );
}

function buildSsmlMessage(requestId: string, voice: string, text: string, pitch = DEFAULT_PITCH, rate = DEFAULT_RATE): string {
  const ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
    `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXml(
      removeInvalidXmlCharacters(text)
    )}</prosody></voice></speak>`;

  return (
    `X-RequestId:${requestId}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${timestamp()}Z\r\n` +
    "Path:ssml\r\n\r\n" +
    ssml
  );
}

function parseTextHeaders(message: string): Record<string, string> {
  const separator = message.indexOf("\r\n\r\n");
  const headerText = separator >= 0 ? message.slice(0, separator) : message;
  const headers: Record<string, string> = {};
  for (const line of headerText.split("\r\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) continue;
    headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
  }
  return headers;
}

function parseBinaryAudioFrame(data: Uint8Array): { headers: Record<string, string>; body: Uint8Array } {
  if (data.length < 2) throw new Error("binary frame missing header length");
  const headerLength = (data[0] << 8) | data[1];
  if (data.length < 2 + headerLength) throw new Error("binary frame truncated");
  const headerText = new TextDecoder().decode(data.slice(2, 2 + headerLength));
  const headers: Record<string, string> = {};
  for (const line of headerText.split("\r\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) continue;
    headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
  }
  return { headers, body: data.slice(2 + headerLength) };
}

async function createEdgeAudioStream(text: string, voice: string, pitch: string): Promise<ReadableStream<Uint8Array>> {
  const secMsGec = await makeSecMsGec();
  const connectionId = makeConnectionId();
  const url = new URL(SYNTHESIS_URL);
  url.searchParams.set("TrustedClientToken", TRUSTED_CLIENT_TOKEN);
  url.searchParams.set("Sec-MS-GEC", secMsGec);
  url.searchParams.set("Sec-MS-GEC-Version", SEC_MS_GEC_VERSION);
  url.searchParams.set("ConnectionId", connectionId);

  const upgradeRes = (await fetch(url.toString(), {
    headers: {
      ...UPGRADE_HEADERS,
      Cookie: `muid=${makeMuid()};`,
    },
  })) as Response & { webSocket?: WebSocket };

  if (upgradeRes.status !== 101 || !upgradeRes.webSocket) {
    throw new Error(`WebSocket upgrade failed with status ${upgradeRes.status}`);
  }

  const socket = upgradeRes.webSocket;
  const requestId = makeConnectionId();
  const formattedVoice = normalizeVoiceName(voice);

  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let settled = false;

  const cleanup = () => {
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
    socket.removeEventListener("error", onError);
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

  const onMessage = (event: MessageEvent) => {
    if (settled) return;
    const data = event.data;
    if (typeof data === "string") {
      const headers = parseTextHeaders(data);
      if (headers.Path === "turn.end") {
        try { socket.close(); } catch { finish(); }
      }
      return;
    }
    const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    const frame = parseBinaryAudioFrame(uint8);
    if (frame.headers.Path === "audio") {
      controllerRef?.enqueue(frame.body);
    }
  };

  const onClose = () => finish();
  const onError = (e: Event) => finishWithError(e);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onError);
      socket.accept();
      socket.send(buildSpeechConfigMessage());
      socket.send(buildSsmlMessage(requestId, formattedVoice, text, pitch));
    },
    cancel(reason) {
      cleanup();
      settled = true;
      try { socket.close(1000, typeof reason === "string" ? reason : "cancelled"); } catch {}
    },
  });
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  const request = context.request;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    let text = "";
    let voice = DEFAULT_VOICE;
    let pitch = DEFAULT_PITCH;

    if (request.method === "GET") {
      const url = new URL(request.url);
      text = url.searchParams.get("text") || "";
      voice = url.searchParams.get("voice") || DEFAULT_VOICE;
      pitch = url.searchParams.get("pitch") || DEFAULT_PITCH;
    } else if (request.method === "POST") {
      const body = (await request.json()) as { text?: string; voice?: string; pitch?: string };
      text = body.text || "";
      voice = body.voice || DEFAULT_VOICE;
      pitch = body.pitch || DEFAULT_PITCH;
    }

    if (!text.trim()) {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const stream = await createEdgeAudioStream(text.trim(), voice, pitch);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
        ...CORS_HEADERS,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
