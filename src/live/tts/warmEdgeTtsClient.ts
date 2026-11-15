/**
 * warmEdgeTtsClient.ts — Browser client for the pre-warmed `/api/tts` Edge-TTS pool.
 *
 * - Pre-warms `/api/tts/warm` on Live Studio load.
 * - Sends `POST /api/tts` with `AbortSignal` support for instant barge-in cancellation.
 * - Decodes returned 24 kHz mono MP3 via WASM `mpg123-decoder` (with AudioContext fallback)
 *   into 24000 Hz mono Float32Array PCM, returning exact `ttfaMs` and `warmHit` telemetry.
 */

import { MPEGDecoder } from 'mpg123-decoder';
import { isValidTTSVoice } from '@/lib/edge-tts-core';
import { readActiveTtsMode } from '@/llm/activeAudioModes';
import { getProviderDecrypted } from '@/llm/customProvider/store';
import {
  detectLanguageHint,
  mapEmotionToProsody,
  stripAffectiveTags,
} from './affectiveClauseSlicer';
import type { TtsAudioResult, TtsSynthesisRequest } from './types';

export interface WarmEdgeClientOptions {
  baseUrl?: string;
  buffered?: boolean;
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac;
  }
  return out;
}

function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!;
  const len = channels[0]!.length;
  const out = new Float32Array(len);
  const inv = 1 / channels.length;
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c]!;
    for (let i = 0; i < len; i++) {
      out[i] = out[i]! + ch[i]! * inv;
    }
  }
  return out;
}

function applySpeedToEdgeRate(baseRate: string, speed?: number): string {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || Math.abs(speed - 1) < 0.01) {
    return baseRate;
  }
  const baseMatch = /^([+-]?\d+(?:\.\d+)?)%$/.exec(baseRate);
  const basePct = baseMatch ? Number(baseMatch[1]) : 0;
  const deltaPct = Math.round((speed - 1) * 100);
  const combined = Math.max(-50, Math.min(100, Math.round(basePct + deltaPct)));
  return `${combined >= 0 ? '+' : ''}${combined}%`;
}

export class WarmEdgeTtsClient {
  private readonly baseUrl: string;
  private readonly buffered: boolean;
  private readonly maxConcurrent: number;
  private decoder: MPEGDecoder | null = null;
  private decoderReadyPromise: Promise<MPEGDecoder> | null = null;
  private decodeQueue: Promise<unknown> = Promise.resolve();
  private lastWarmStatus = { ok: false, warmSockets: 0 };
  private activeCount = 0;
  private slotWaiters: Array<() => void> = [];
  private lastReplenishAt = 0;

  constructor(options: WarmEdgeClientOptions & { maxConcurrent?: number } = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.buffered = options.buffered ?? false;
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 2);
  }

  private async ensureDecoderReady(): Promise<MPEGDecoder> {
    if (this.decoder) return this.decoder;
    if (!this.decoderReadyPromise) {
      this.decoderReadyPromise = (async () => {
        const dec = new MPEGDecoder();
        await dec.ready;
        this.decoder = dec;
        return dec;
      })().catch((err) => {
        this.decoderReadyPromise = null;
        throw err;
      });
    }
    return this.decoderReadyPromise;
  }

  private async acquireSlot(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const releaseWaiter = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const idx = this.slotWaiters.indexOf(releaseWaiter);
        if (idx !== -1) this.slotWaiters.splice(idx, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.slotWaiters.push(releaseWaiter);
    });
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    this.activeCount++;
  }

  private releaseSlot(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.slotWaiters.shift();
    if (next) next();
  }

  getLastWarmStatus(): { ok: boolean; warmSockets: number } {
    return this.lastWarmStatus;
  }

  async prewarm(): Promise<{ ok: boolean; warmSockets: number }> {
    void this.ensureDecoderReady().catch(() => {});
    try {
      const res = await fetch(`${this.baseUrl}/api/tts/warm`, {
        method: 'GET',
        cache: 'no-store',
      });
      if (!res.ok) {
        this.lastWarmStatus = { ok: false, warmSockets: 0 };
        return this.lastWarmStatus;
      }
      const json = (await res.json()) as { ok?: boolean; warmSockets?: number };
      this.lastWarmStatus = {
        ok: Boolean(json.ok),
        warmSockets: Number(json.warmSockets ?? 0),
      };
      return this.lastWarmStatus;
    } catch {
      this.lastWarmStatus = { ok: false, warmSockets: 0 };
      return this.lastWarmStatus;
    }
  }

  private async decodeMp3To24kMono(mp3Bytes: Uint8Array): Promise<Float32Array> {
    if (mp3Bytes.byteLength === 0) return new Float32Array(0);
    const task = this.decodeQueue.then(async () => {
      try {
        const dec = await this.ensureDecoderReady();
        await dec.reset();
        const decoded = dec.decode(mp3Bytes);
        const mono = mixToMono(decoded.channelData);
        const sr = decoded.sampleRate || 24000;
        return sr === 24000 ? new Float32Array(mono) : resampleLinear(mono, sr, 24000);
      } catch (err) {
        // Fallback to WebAudio decodeAudioData if browser runtime is available
        const AudioCtx =
          typeof globalThis !== 'undefined'
            ? (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext
            : undefined;
        if (!AudioCtx) throw err;
        const ctx: AudioContext = new AudioCtx({ sampleRate: 24000 });
        try {
          const copy = new Uint8Array(mp3Bytes.byteLength);
          copy.set(mp3Bytes);
          const audioBuf = await ctx.decodeAudioData(copy.buffer);
          const channels: Float32Array[] = [];
          for (let c = 0; c < audioBuf.numberOfChannels; c++) {
            channels.push(audioBuf.getChannelData(c));
          }
          const mono = mixToMono(channels);
          return audioBuf.sampleRate === 24000
            ? new Float32Array(mono)
            : resampleLinear(mono, audioBuf.sampleRate, 24000);
        } finally {
          void ctx.close().catch(() => {});
        }
      }
    });
    this.decodeQueue = task.catch(() => {});
    return task;
  }

  async synthesize(req: TtsSynthesisRequest): Promise<TtsAudioResult> {
    if (req.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const stripped = stripAffectiveTags(req.text);
    const cleanText = stripped.cleanText;
    if (!cleanText) {
      return {
        pcm24k: new Float32Array(0),
        sampleRate: 24000,
        durationMs: 0,
        ttfaMs: 0,
        engine: 'edge-warm',
        warmHit: false,
      };
    }

    const langHint = req.languageHint ?? detectLanguageHint(cleanText);
    const emotion = req.emotion ?? stripped.emotion;
    const { edgeProsody } = mapEmotionToProsody(emotion, langHint);
    const voice =
      req.voicePreset && isValidTTSVoice(req.voicePreset)
        ? req.voicePreset
        : edgeProsody.voice;
    const rate = applySpeedToEdgeRate(edgeProsody.rate, req.speed);

    const activeTtsMode = readActiveTtsMode();
    const customProfile =
      activeTtsMode.kind === 'custom'
        ? await getProviderDecrypted(activeTtsMode.providerId).catch(() => null)
        : null;
    const useCustomEndpoint = Boolean(customProfile?.baseURL?.trim());

    await this.acquireSlot(req.signal);
    let warmHit = false;
    let firstChunkAt = 0;
    let totalBytes = 0;
    let serverTtfaHeader: string | null = null;
    const chunks: Uint8Array[] = [];
    let t0 = 0;

    try {
      t0 = performance.now();
      let res: Response;
      if (useCustomEndpoint && customProfile) {
        const url = `${customProfile.baseURL.replace(/\/+$/, '')}/audio/speech`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (customProfile.apiKey) {
          headers['Authorization'] = `Bearer ${customProfile.apiKey}`;
        }
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: customProfile.model || 'tts-1',
            input: cleanText,
            voice: customProfile.voice?.trim() || 'alloy',
            response_format: 'mp3',
          }),
          signal: req.signal,
        });
      } else {
        res = await fetch(`${this.baseUrl}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleanText,
            voice,
            pitch: edgeProsody.pitch,
            rate,
            volume: edgeProsody.volume,
            buffered: this.buffered,
          }),
          signal: req.signal,
        });
      }

      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(
          `${useCustomEndpoint ? 'CustomTts' : 'WarmEdgeTts'} HTTP ${res.status}: ${msg.slice(0, 160)}`,
        );
      }

      const warmHeader = useCustomEndpoint ? null : res.headers.get('X-TTS-Warm');
      warmHit = warmHeader === '1';
      serverTtfaHeader = useCustomEndpoint ? null : res.headers.get('X-TTS-TTFA-Ms');

      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        try {
          while (true) {
            if (req.signal?.aborted) {
              await reader.cancel().catch(() => {});
              throw new DOMException('Aborted', 'AbortError');
            }
            const { value, done } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              if (firstChunkAt === 0) {
                firstChunkAt = performance.now();
              }
              chunks.push(value);
              totalBytes += value.byteLength;
            }
          }
        } catch (err) {
          await reader.cancel().catch(() => {});
          throw err;
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        firstChunkAt = performance.now();
        chunks.push(buf);
        totalBytes = buf.byteLength;
      }
    } finally {
      this.releaseSlot();
    }

    if (!useCustomEndpoint && !warmHit) {
      const now = Date.now();
      if (now - this.lastReplenishAt > 1500) {
        this.lastReplenishAt = now;
        void this.prewarm().catch(() => {});
      }
    }

    if (req.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const mp3Bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const c of chunks) {
      mp3Bytes.set(c, offset);
      offset += c.byteLength;
    }

    const pcm24k = await this.decodeMp3To24kMono(mp3Bytes);
    const clientTtfa = firstChunkAt > 0 ? firstChunkAt - t0 : performance.now() - t0;
    const ttfaMs =
      serverTtfaHeader && Number.isFinite(Number(serverTtfaHeader))
        ? Math.max(Number(serverTtfaHeader), Math.round(clientTtfa))
        : Math.round(clientTtfa);

    return {
      pcm24k,
      sampleRate: 24000,
      durationMs: Math.round((pcm24k.length / 24000) * 1000),
      ttfaMs,
      engine: 'edge-warm',
      warmHit,
    };
  }

  dispose(): void {
    if (this.decoder) {
      try {
        this.decoder.free();
      } catch {
        /* ignore */
      }
      this.decoder = null;
    }
  }
}
