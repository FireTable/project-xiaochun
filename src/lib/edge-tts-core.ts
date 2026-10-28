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
    SEC_MS_GEC_VERSION: '2-143.0.3650.75',
    SYNTHESIS_URL: 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
    SYNTHESIS_URL_V2: 'https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1',
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

/* ==========================================================================
 * Sec-MS-GEC v2 (Edge-TTS 7.3.0+ DRM Token Generator)
 * Pure TypeScript implementation for Browser, Cloudflare Workers, and Node.js
 * ========================================================================== */

const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

const _SHA256_INITIAL = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const _SHA256_STATE = [
    0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a,
    0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];
const _SHA256_SCHEDULE = [
    0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba,
    0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
    0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33,
    0xd258b060, 0x72766564,
];
const _SHA256_ROUND_CONSTANTS = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const _SHA256_ADJUSTMENT = 0xc9dc06a7;
const _SHA256_BLOCK_CONSTANTS = [
    ..._SHA256_ROUND_CONSTANTS.slice(0, 14),
    _SHA256_ADJUSTMENT,
    ..._SHA256_ROUND_CONSTANTS.slice(15),
];
const _SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const _SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const _CS64_COEFFICIENTS: [number, number][] = [
    [0xe82e91b1, 0xb32700d0], [0x44de24c6, 0x88dff51d],
    [0x3beb65bc, 0x29514038], [0xc89c5933, 0xb328cbdf],
    [0x8d1ec211, 0xd405b4d5], [0x314ef5d5, 0x26e55f3c],
    [0xe92491b1, 0x607801c6], [0xf0a5b9d5, 0x82b2c1fb],
    [0x06064cf3, 0xfa51a3da], [0xda79fa60, 0x207cc464],
    [0xbed20560, 0x3c3c74f3], [0x89f9c9f8, 0xd2d14b61],
    [0x35fa38c6, 0xbb04a2c1], [0xcb49e3c6, 0xc5626167],
];
const _CS64_FACTOR = 0x82893933;
const _CS64_ADJUSTMENT0 = 0xf2f90b1a;
const _CS64_ADJUSTMENT1 = 0x0b1a0000;

function rol16(v: number): number {
    return (((v << 16) | (v >>> 16)) >>> 0);
}

function wordsLe4Even(data: Uint8Array): number[] {
    const rem = (-data.length) & 3;
    const paddedLen = data.length + rem;
    const buf = new Uint8Array(paddedLen);
    buf.set(data);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const words: number[] = [];
    for (let i = 0; i < paddedLen; i += 4) {
        words.push(view.getUint32(i, true));
    }
    if (words.length % 2 !== 0) {
        words.push(0);
    }
    return words;
}

function sigma0(value: number): number {
    const v = value >>> 0;
    return (((v >>> 7) ^ (v << 25) ^ (v >>> 18) ^ (v << 14) ^ (v >>> 3)) >>> 0);
}

function sigma1(value: number): number {
    const v = value >>> 0;
    return (((v >>> 17) ^ (v << 15) ^ (v >>> 19) ^ (v << 13) ^ (v >>> 10)) >>> 0);
}

function rotr(v: number, n: number): number {
    return ((v >>> n) | (v << (32 - n))) >>> 0;
}

function sha256Rounds(state: number[], words: number[], firstRound = 0): number[] {
    let [a, b, c, d, e, f, g, h] = state;
    const constants = firstRound === 14 ? _SHA256_BLOCK_CONSTANTS : _SHA256_ROUND_CONSTANTS;

    const aligned = Math.min(64, Math.floor((firstRound + 7) / 8) * 8);
    for (let index = firstRound; index < aligned; index++) {
        const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = (g ^ (e & (f ^ g))) >>> 0;
        const t1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
        const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) | (c & (a | b))) >>> 0;
        const t2 = (s0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
    }

    for (let index = aligned; index < 64; index += 8) {
        let s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        let ch = (g ^ (e & (f ^ g))) >>> 0;
        let t1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
        let s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        let maj = ((a & b) | (c & (a | b))) >>> 0;
        d = (d + t1) >>> 0;
        h = (t1 + s0 + maj) >>> 0;

        s1 = (rotr(d, 6) ^ rotr(d, 11) ^ rotr(d, 25)) >>> 0;
        ch = (f ^ (d & (e ^ f))) >>> 0;
        t1 = (g + s1 + ch + constants[index + 1] + words[index + 1]) >>> 0;
        s0 = (rotr(h, 2) ^ rotr(h, 13) ^ rotr(h, 22)) >>> 0;
        maj = ((h & a) | (b & (h | a))) >>> 0;
        c = (c + t1) >>> 0;
        g = (t1 + s0 + maj) >>> 0;

        s1 = (rotr(c, 6) ^ rotr(c, 11) ^ rotr(c, 25)) >>> 0;
        ch = (e ^ (c & (d ^ e))) >>> 0;
        t1 = (f + s1 + ch + constants[index + 2] + words[index + 2]) >>> 0;
        s0 = (rotr(g, 2) ^ rotr(g, 13) ^ rotr(g, 22)) >>> 0;
        maj = ((g & h) | (a & (g | h))) >>> 0;
        b = (b + t1) >>> 0;
        f = (t1 + s0 + maj) >>> 0;

        s1 = (rotr(b, 6) ^ rotr(b, 11) ^ rotr(b, 25)) >>> 0;
        ch = (d ^ (b & (c ^ d))) >>> 0;
        t1 = (e + s1 + ch + constants[index + 3] + words[index + 3]) >>> 0;
        s0 = (rotr(f, 2) ^ rotr(f, 13) ^ rotr(f, 22)) >>> 0;
        maj = ((f & g) | (h & (f | g))) >>> 0;
        a = (a + t1) >>> 0;
        e = (t1 + s0 + maj) >>> 0;

        s1 = (rotr(a, 6) ^ rotr(a, 11) ^ rotr(a, 25)) >>> 0;
        ch = (c ^ (a & (b ^ c))) >>> 0;
        t1 = (d + s1 + ch + constants[index + 4] + words[index + 4]) >>> 0;
        s0 = (rotr(e, 2) ^ rotr(e, 13) ^ rotr(e, 22)) >>> 0;
        maj = ((e & f) | (g & (e | f))) >>> 0;
        h = (h + t1) >>> 0;
        d = (t1 + s0 + maj) >>> 0;

        s1 = (rotr(h, 6) ^ rotr(h, 11) ^ rotr(h, 25)) >>> 0;
        ch = (b ^ (h & (a ^ b))) >>> 0;
        t1 = (c + s1 + ch + constants[index + 5] + words[index + 5]) >>> 0;
        s0 = (rotr(d, 2) ^ rotr(d, 13) ^ rotr(d, 22)) >>> 0;
        maj = ((d & e) | (f & (d | e))) >>> 0;
        g = (g + t1) >>> 0;
        c = (t1 + s0 + maj) >>> 0;

        s1 = (rotr(g, 6) ^ rotr(g, 11) ^ rotr(g, 25)) >>> 0;
        ch = (a ^ (g & (h ^ a))) >>> 0;
        t1 = (b + s1 + ch + constants[index + 6] + words[index + 6]) >>> 0;
        s0 = (rotr(c, 2) ^ rotr(c, 13) ^ rotr(c, 22)) >>> 0;
        maj = ((c & d) | (e & (c | d))) >>> 0;
        f = (f + t1) >>> 0;
        b = (t1 + s0 + maj) >>> 0;

        s1 = (rotr(f, 6) ^ rotr(f, 11) ^ rotr(f, 25)) >>> 0;
        ch = (h ^ (f & (g ^ h))) >>> 0;
        t1 = (a + s1 + ch + constants[index + 7] + words[index + 7]) >>> 0;
        s0 = (rotr(b, 2) ^ rotr(b, 13) ^ rotr(b, 22)) >>> 0;
        maj = ((b & c) | (d & (b | c))) >>> 0;
        e = (e + t1) >>> 0;
        a = (t1 + s0 + maj) >>> 0;
    }

    return [a, b, c, d, e, f, g, h];
}

function expandSha256Schedule(words: number[], firstWord = 16): void {
    for (let index = firstWord; index < 64; index++) {
        const s1 = sigma1(words[index - 2]);
        const s0 = sigma0(words[index - 15]);
        words.push((s1 + words[index - 7] + s0 + words[index - 16]) >>> 0);
    }
}

function sha256Init(data: Uint8Array): number[] {
    const words: number[] = new Array(14).fill(0);
    const w14 = ((data[0] << 16) | (data[1] << 8) | data[2]) >>> 0;
    const w15 = ((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0;
    words.push(w14, w15);

    for (let index = 16; index < 30; index++) {
        let value = _SHA256_SCHEDULE[index - 16];
        if (index - 2 >= 14) {
            value += (index === 16 ? (sigma1(words[index - 2]) ^ _SHA256_SIGMA1_ADJUSTMENT) : sigma1(words[index - 2]));
        }
        if (index - 7 >= 14) {
            value += words[index - 7];
        }
        if (index - 15 >= 14) {
            value += (index === 29 ? (sigma0(words[index - 15]) ^ _SHA256_SIGMA0_ADJUSTMENT) : sigma0(words[index - 15]));
        }
        words.push(value >>> 0);
    }

    words.push(
        (
            sigma1(words[28]) +
            words[23] +
            sigma0(words[15]) +
            words[14] +
            _SHA256_ADJUSTMENT -
            _SHA256_ROUND_CONSTANTS[14]
        ) >>> 0
    );

    expandSha256Schedule(words, 31);
    const working = sha256Rounds(_SHA256_STATE, words, 14);
    return _SHA256_INITIAL.map((x, i) => (x + working[i]) >>> 0);
}

function sha256Digest(data: Uint8Array): Uint8Array {
    if (data.length < 7) {
        throw new Error('Token salt must contain at least seven bytes');
    }
    const length = 57 + data.length;
    const padLen = (55 - length) % 64 >= 0 ? (55 - length) % 64 : ((55 - length) % 64) + 64;
    const totalPaddedLen = (data.length - 7) + 1 + padLen + 8;
    const padded = new Uint8Array(totalPaddedLen);
    padded.set(data.subarray(7), 0);
    padded[data.length - 7] = 0x80;
    const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
    const bitLengthBigInt = BigInt(length) * 8n;
    view.setBigUint64(totalPaddedLen - 8, bitLengthBigInt, false);

    let state = sha256Init(data.subarray(0, 7));
    for (let offset = 0; offset < totalPaddedLen; offset += 64) {
        const words: number[] = [];
        for (let i = 0; i < 16; i++) {
            words.push(view.getUint32(offset + i * 4, false));
        }
        expandSha256Schedule(words);
        const working = sha256Rounds(state, words);
        state = state.map((x, i) => (x + working[i]) >>> 0);
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) {
        outView.setUint32(i * 4, state[i], false);
    }
    return out;
}

function cs64Digest(data: Uint8Array, digest: Uint8Array): [number, number] {
    const dView = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
    const keyA = (dView.getUint32(0, true) | 1) >>> 0;
    const keyB = (dView.getUint32(4, true) | 1) >>> 0;

    const factorA = Math.imul(keyA, _CS64_FACTOR) >>> 0;
    const factorB = Math.imul(keyB, _CS64_FACTOR) >>> 0;

    const terms: number[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < _CS64_COEFFICIENTS.length; i++) {
        const [coef, off] = _CS64_COEFFICIENTS[i];
        const factor = (i % 2 === 0) ? factorA : factorB;
        terms.push(Math.imul(coef, factor) >>> 0);
        offsets.push(off >>> 0);
    }

    const prepended = new Uint8Array(data.length + 1);
    prepended.set(data, 1);
    const words = wordsLe4Even(prepended);

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const k = (i % 2 === 0) ? keyA : keyB;
        let term = Math.imul(word, k) >>> 0;
        const mul = (i % 2 === 0) ? 0xef0569fb : 0xc31713db;
        let offset = Math.imul(rol16(word), mul) >>> 0;

        if (i === 0) {
            term = (term + Math.imul(_CS64_ADJUSTMENT0, factorA)) >>> 0;
            offset = (offset + _CS64_ADJUSTMENT1) >>> 0;
        }
        terms.push(term);
        offsets.push(offset);
    }

    let swapAcc = 0;
    let swapLast = 0;
    let state = 0;
    let acc = 0;

    for (let index = 0; index < terms.length; index += 2) {
        const x = terms[index];
        const y = terms[index + 1];

        let t = rol16((offsets[index] + x) >>> 0);
        let q = Math.imul(t, 0x76f50f34) >>> 0;
        swapAcc = (swapAcc + Math.imul(rol16(q), 0xc3efea97) + q) >>> 0;

        t = rol16((offsets[index + 1] + y) >>> 0);
        q = Math.imul(t, 0x1881ce3c) >>> 0;
        swapLast = (Math.imul(rol16(q), 0x35bd1ec9) + q) >>> 0;
        swapAcc = (swapAcc + swapLast) >>> 0;

        state = (Math.imul(state, keyA) + x) >>> 0;
        state = Math.imul(rol16(state), 0xcf98b111) >>> 0;
        state = Math.imul(rol16(state), 0x87085b9f) >>> 0;
        state = Math.imul(rol16(state), 0x12ceb96d) >>> 0;
        state = Math.imul(rol16(state), 0x257e1d83) >>> 0;
        acc = (acc + state) >>> 0;

        t = (Math.imul(state, keyB) + y) >>> 0;
        t = Math.imul(rol16(t), 0xa27416f5) >>> 0;
        t = Math.imul(rol16(t), 0xd38396ff) >>> 0;
        state = Math.imul(rol16(Math.imul(rol16(t), 0x7c932b89) >>> 0), 0xbfa49f69) >>> 0;
        acc = (acc + state) >>> 0;
    }

    return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

function hexUpper(buf: Uint8Array): string {
    return Array.from(buf)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}

/**
 * Generates the Sec-MS-GEC v2 token (<16 hex>-<64 hex>).
 */
export function generateSecMsGecV2(unixTimestamp?: number): string {
    const ts = unixTimestamp ?? (Date.now() / 1000);
    let ticks = ts + WIN_EPOCH;
    ticks -= ticks % 300;
    ticks *= S_TO_NS / 100;
    const strToHash = `${ticks.toFixed(0)}${EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN}`;
    const data = new TextEncoder().encode(strToHash);

    const digest = sha256Digest(data);
    const [cs0, cs1] = cs64Digest(data, digest);

    const csBuf = new Uint8Array(8);
    const csView = new DataView(csBuf.buffer);
    csView.setUint32(0, cs0, true); // little endian
    csView.setUint32(4, cs1, true); // little endian

    const csHex = hexUpper(csBuf);
    const shaHex = hexUpper(digest);
    return `${csHex}-${shaHex}`;
}

export async function makeSecMsGec(unixTimestamp?: number): Promise<string> {
    return generateSecMsGecV2(unixTimestamp);
}

/** 单次合成文本长度上限 (客户端已按句切片, 正常请求远低于此值)。 */
export const TTS_MAX_TEXT_LENGTH = 2000;

/** Edge 神经语音名白名单: zh-CN-XiaoyiNeural / zh-CN-liaoning-XiaobeiNeural / en-US-Ava:DragonHDLatestNeural。 */
const TTS_VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}(?:-[A-Za-z]+)?-[A-Za-z0-9:]+Neural$/;
/** prosody 数值 (pitch / rate / volume): +10Hz / +0% / -2st / 5。 */
const TTS_PROSODY_RE = /^[+-]?\d{1,3}(\.\d+)?(%|Hz|st)?$/;

export function isValidTTSVoice(voice: unknown): voice is string {
    return typeof voice === 'string' && voice.length <= 80 && TTS_VOICE_RE.test(voice);
}

export function isValidTTSProsody(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 12 && TTS_PROSODY_RE.test(value);
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

export function buildEdgeTTSPayloads(
    text: string,
    voice: string,
    pitch: string = '+10Hz',
    rate: string = '+0%',
    volume: string = '+0%',
) {
    // 纵深防御: 这些值会被拼进 SSML 属性, 非白名单格式一律拒绝 (防 SSML 注入)
    if (!isValidTTSVoice(voice) || !isValidTTSProsody(pitch) || !isValidTTSProsody(rate) || !isValidTTSProsody(volume)) {
        throw new Error('invalid tts parameter');
    }
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
        `<voice name='${formattedVoice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${cleanText}</prosody></voice></speak>`;

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
