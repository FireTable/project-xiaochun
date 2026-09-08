// src/lib/edge-tts-core.ts

export const COMMON_CORS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};



export const EDGE_TTS_CONSTANTS = {
    TRUSTED_CLIENT_TOKEN: '6A5AA1D4EAFF4E9FB37E23D68491D6F4',
    CHROMIUM_FULL_VERSION: '143.0.3650.75',
    CHROMIUM_MAJOR_VERSION: '143',
    SEC_MS_GEC_VERSION: '1-143.0.3650.75',
    SYNTHESIS_URL: 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
    SYNTHESIS_WSS_URL: 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
    DEFAULT_OUTPUT_FORMAT: 'audio-24khz-48kbitrate-mono-mp3',
    COMMON_CORS,
} as const;

export function makeConnectionId(): string {
    return crypto.randomUUID().replace(/-/g, '');
}

export function makeMuid(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}

export async function makeSecMsGec(): Promise<string> {
    const winEpoch = 11644473600;
    const secToNs = 1e9;
    let ticks = Date.now() / 1000 + winEpoch;
    ticks -= ticks % 300;
    ticks *= secToNs / 100;
    const payload = `${ticks.toFixed(0)}${EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}

export function normalizeVoiceName(voice: string): string {
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

export function cleanSSMLText(text: string): string {
    const clean = text.replace(/[*\/()\[\]{}$%^@#+=|\\~`><"&]/g, '');
    return clean
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export function buildEdgeTTSPayloads(text: string, voice: string, pitch: string) {
    const reqId = makeConnectionId();
    const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, -1);
    const formattedVoice = normalizeVoiceName(voice);
    const cleanText = cleanSSMLText(text);

    const speechConfig =
        `X-Timestamp:${ts}\r\n` +
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"${EDGE_TTS_CONSTANTS.DEFAULT_OUTPUT_FORMAT}"}}}}\r\n`;

    const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${formattedVoice}'><prosody pitch='${pitch}'>${cleanText}</prosody></voice></speak>`;

    const ssmlMessage =
        `X-RequestId:${reqId}\r\n` +
        'Content-Type:application/ssml+xml\r\n' +
        `X-Timestamp:${ts}Z\r\n` +
        'Path:ssml\r\n\r\n' +
        ssml +
        '\r\n';

    return { speechConfig, ssmlMessage };
}

export function parseHeaders(block: string): Record<string, string> {
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

export function parseBinaryFrame(buf: Uint8Array): { headers: Record<string, string>; body: Uint8Array } {
    if (buf.length < 2) throw new Error('binary frame missing header length');
    const len = (buf[0] << 8) | buf[1];
    if (buf.length < 2 + len) throw new Error('binary frame truncated');
    const head = new TextDecoder().decode(buf.slice(2, 2 + len));
    return { headers: parseHeaders(head), body: buf.slice(2 + len) };
}