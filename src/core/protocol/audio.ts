/**
 * protocol/audio.ts — action 'audio' (及 speak+audioUrl) 的输入解析与校验。
 * 两个传输层 (xiaochun:// 与 xc.*) 共用; 全部错误抛 ProtocolError。
 */
import {
  HOST_AUDIO,
  decodeEncodedAudio,
  downmixToMono,
  pcm16ToFloat32,
  singleChunkInput,
  type HostAudioInput,
} from '@/director/hostAudio';
import { ProtocolError, type AudioPayload } from './types';

/** 只放行 https:// 或同源地址 (不限扩展名: 音频 URL 常是带签名的无后缀链接)。 */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  let u: URL;
  try { u = new URL(raw, window.location.origin); } catch { return null; }
  if (u.origin !== window.location.origin && u.protocol !== 'https:') return null;
  return u.href;
}

export function checkSampleRate(v: unknown, fallback?: number): number {
  const n = v === undefined ? fallback : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < HOST_AUDIO.minSampleRate || n > HOST_AUDIO.maxSampleRate) {
    throw new ProtocolError('bad_request', `sampleRate must be ${HOST_AUDIO.minSampleRate}~${HOST_AUDIO.maxSampleRate}`);
  }
  return Math.round(n);
}

/** 原始 PCM (pcm16 / float32, 小端, 可交错) → 单声道 Float32。长度不对齐 → bad_request。 */
export function rawPcmToMono(data: unknown, format: 'pcm16' | 'float32', channels: unknown): Float32Array {
  if (!(data instanceof ArrayBuffer)) throw new ProtocolError('bad_request', 'PCM data must be an ArrayBuffer');
  if (channels !== undefined && channels !== 1 && channels !== 2) throw new ProtocolError('bad_request', 'channels must be 1 or 2');
  const ch = channels === 2 ? 2 : 1;
  const bytes = format === 'pcm16' ? 2 : 4;
  if (data.byteLength === 0 || data.byteLength % (bytes * ch) !== 0) {
    throw new ProtocolError('bad_request', `PCM byteLength must be a non-zero multiple of ${bytes * ch}`);
  }
  const f32 = format === 'pcm16' ? pcm16ToFloat32(new Int16Array(data)) : new Float32Array(data);
  return downmixToMono(f32, ch);
}

/** 整段音频 payload.source → 单声道 PCM (+ 采样率)。 */
export async function resolveWholeAudio(p: AudioPayload): Promise<HostAudioInput> {
  const format = p.format ?? 'encoded';
  if (format !== 'encoded' && format !== 'pcm16' && format !== 'float32') throw new ProtocolError('bad_request', `invalid format: ${String(format)}`);
  let buf: ArrayBuffer;
  const src = p.source as unknown;
  if (src instanceof ArrayBuffer) {
    buf = src;
  } else if (typeof Blob !== 'undefined' && src instanceof Blob) {
    if (src.size > HOST_AUDIO.maxBytes) throw new ProtocolError('bad_request', `audio exceeds ${HOST_AUDIO.maxBytes} bytes`);
    buf = await src.arrayBuffer();
  } else if (typeof src === 'string') {
    const url = safeHttpUrl(src);
    if (!url) throw new ProtocolError('bad_request', 'audio url must be https or same-origin');
    let res: Response;
    try { res = await fetch(url, { credentials: 'omit', mode: 'cors' }); }
    catch { throw new ProtocolError('failed', 'audio fetch failed (CORS or network)'); }
    if (!res.ok) throw new ProtocolError('failed', `audio fetch failed: HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > HOST_AUDIO.maxBytes) throw new ProtocolError('bad_request', `audio exceeds ${HOST_AUDIO.maxBytes} bytes`);
    buf = await res.arrayBuffer();
  } else {
    throw new ProtocolError('bad_request', 'source must be an ArrayBuffer, Blob or URL string');
  }
  if (buf.byteLength === 0) throw new ProtocolError('bad_request', 'audio is empty');
  if (buf.byteLength > HOST_AUDIO.maxBytes) throw new ProtocolError('bad_request', `audio exceeds ${HOST_AUDIO.maxBytes} bytes`);

  let pcm: Float32Array;
  let sampleRate: number;
  if (format === 'encoded') {
    try { ({ pcm, sampleRate } = await decodeEncodedAudio(buf)); }
    catch (e) { throw new ProtocolError('bad_request', `cannot decode audio${p.mimeType ? ` (${p.mimeType})` : ''}: ${e instanceof Error ? e.message : String(e)}`); }
  } else {
    sampleRate = checkSampleRate(p.sampleRate, 16000);
    pcm = rawPcmToMono(buf, format, p.channels);
  }
  if (pcm.length / sampleRate > HOST_AUDIO.maxSec) throw new ProtocolError('bad_request', `audio exceeds ${HOST_AUDIO.maxSec}s`);
  return singleChunkInput(pcm, sampleRate);
}
