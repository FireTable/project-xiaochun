/**
 * warmEdgePool.ts — Persistent pre-warmed Edge-TTS Sec-MS-GEC v2 WebSocket Pool.
 *
 * Keeps `poolSize` (default 2) persistent WebSocket connections warm against
 * `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1` so synthesis
 * requests avoid the ~500-900ms cold TCP + TLS + WS handshake.
 *
 * CRITICAL PROTOCOL RULE:
 *   All SSML sent through this pool uses `buildEdgeTTSPayloads(...)` which ONLY
 *   emits `<prosody pitch="..." rate="..." volume="...">` inside `<voice>`.
 *   Never emit `<mstts:express-as>` on this endpoint (upstream silently drops turn.end).
 */

import {
  EDGE_TTS_CONSTANTS,
  makeConnectionId,
  makeMuid,
  makeSecMsGec,
  buildEdgeTTSPayloads,
  parseHeaders,
  parseBinaryFrame,
} from '../lib/edge-tts-core';

export interface EdgeWebSocketLike {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (ev: any) => void): void;
  removeEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (ev: any) => void): void;
}

export type EdgeSocketFactory = (url: string, headers: Record<string, string>) => EdgeWebSocketLike;

export interface WarmEdgePoolOptions {
  poolSize?: number;
  heartbeatIntervalMs?: number;
  idleTtlMs?: number;
  maxSocketAgeMs?: number;
  connectTimeoutMs?: number;
  firstChunkTimeoutMs?: number;
  turnTimeoutMs?: number;
  socketFactory?: EdgeSocketFactory;
}

export interface WarmPoolStats {
  poolSize: number;
  idleSockets: number;
  connectingSockets: number;
  busySockets: number;
  totalWarmHits: number;
  totalColdMisses: number;
  lastError: string | null;
}

export interface WarmStreamRequest {
  text: string;
  voice?: string;
  pitch?: string;
  rate?: string;
  volume?: string;
  signal?: AbortSignal;
  onFirstAudio?: (info: { warmHit: boolean; ttfaMs: number }) => void;
  onChunk: (chunk: Uint8Array) => Promise<void> | void;
}

export interface WarmSynthesisMeta {
  warmHit: boolean;
  ttfaMs: number;
  totalMs: number;
  totalBytes: number;
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;

const EDGE_USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CONSTANTS.CHROMIUM_MAJOR_VERSION}.0.0.0`;

type EndpointKind = 'msedgeservices' | 'bing';

interface PooledSocket {
  id: number;
  endpoint: EndpointKind;
  ws: EdgeWebSocketLike;
  state: 'connecting' | 'idle' | 'busy' | 'closed';
  createdAt: number;
  lastUsedAt: number;
  lastHeartbeatAt: number;
  turnsServed: number;
  assigned: boolean;
  readyPromise: Promise<void>;
}

function defaultSocketFactory(url: string, headers: Record<string, string>): EdgeWebSocketLike {
  const WS = globalThis.WebSocket as unknown as new (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => EdgeWebSocketLike;
  const ws = new WS(url, { headers });
  ws.binaryType = 'arraybuffer';
  return ws;
}

function makeHeartbeatSpeechConfig(): string {
  const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, -1);
  return (
    `X-Timestamp:${ts}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"${EDGE_TTS_CONSTANTS.DEFAULT_OUTPUT_FORMAT}"}}}}\r\n`
  );
}

async function decodeBinaryMessage(data: unknown): Promise<Uint8Array | null> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return new Uint8Array(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  return null;
}

export class WarmEdgeSocketPool {
  private readonly poolSize: number;
  private readonly heartbeatIntervalMs: number;
  private readonly idleTtlMs: number;
  private readonly maxSocketAgeMs: number;
  private readonly connectTimeoutMs: number;
  private readonly firstChunkTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private readonly socketFactory: EdgeSocketFactory;

  private slots: PooledSocket[] = [];
  private nextSlotId = 1;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private totalWarmHits = 0;
  private totalColdMisses = 0;
  private lastError: string | null = null;

  constructor(options: WarmEdgePoolOptions = {}) {
    this.poolSize = Math.max(1, options.poolSize ?? 2);
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25_000;
    this.idleTtlMs = options.idleTtlMs ?? 150_000;
    this.maxSocketAgeMs = options.maxSocketAgeMs ?? 240_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 6_000;
    this.firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? 6_500;
    this.turnTimeoutMs = options.turnTimeoutMs ?? 20_000;
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
  }

  getStats(): WarmPoolStats {
    this.pruneStale();
    let idleSockets = 0;
    let connectingSockets = 0;
    let busySockets = 0;
    for (const slot of this.slots) {
      if (slot.state === 'idle' && slot.ws.readyState === WS_OPEN) idleSockets++;
      else if (slot.state === 'connecting' && slot.ws.readyState === WS_CONNECTING) connectingSockets++;
      else if (slot.state === 'busy') busySockets++;
    }
    return {
      poolSize: this.poolSize,
      idleSockets,
      connectingSockets,
      busySockets,
      totalWarmHits: this.totalWarmHits,
      totalColdMisses: this.totalColdMisses,
      lastError: this.lastError,
    };
  }

  async warm(): Promise<WarmPoolStats> {
    if (this.disposed) return this.getStats();
    this.ensureHeartbeat();
    this.pruneStale();

    const target = this.poolSize;
    const liveSlots = this.slots.filter(
      (s) => s.endpoint === 'msedgeservices' && s.state !== 'closed' && s.ws.readyState <= WS_OPEN,
    );
    const toSpawn = Math.max(0, target - liveSlots.length);
    const pending: Promise<void>[] = liveSlots
      .filter((s) => s.state === 'connecting')
      .map((s) => s.readyPromise.catch(() => {}));

    for (let i = 0; i < toSpawn; i++) {
      const slot = await this.spawnSocket('msedgeservices');
      pending.push(slot.readyPromise.catch(() => {}));
    }

    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
    return this.getStats();
  }

  private replenishAsync(): void {
    if (this.disposed) return;
    this.ensureHeartbeat();
    this.pruneStale();
    const liveCount = this.slots.filter(
      (s) => s.endpoint === 'msedgeservices' && s.state !== 'closed' && s.ws.readyState <= WS_OPEN,
    ).length;
    const needed = Math.max(0, this.poolSize - liveCount);
    for (let i = 0; i < needed; i++) {
      void this.spawnSocket('msedgeservices')
        .then((slot) => slot.readyPromise)
        .catch(() => {});
    }
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer || this.disposed) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.disposed) return;
      const now = Date.now();
      this.pruneStale();
      for (const slot of this.slots) {
        if (slot.state !== 'idle' || slot.ws.readyState !== WS_OPEN) continue;
        if (now - slot.createdAt >= this.maxSocketAgeMs || now - slot.lastUsedAt >= this.idleTtlMs) {
          this.discardSlot(slot);
          continue;
        }
        if (now - slot.lastHeartbeatAt >= this.heartbeatIntervalMs) {
          try {
            slot.ws.send(makeHeartbeatSpeechConfig());
            slot.lastHeartbeatAt = now;
          } catch {
            this.discardSlot(slot);
          }
        }
      }
      this.replenishAsync();
    }, Math.min(this.heartbeatIntervalMs, 10_000));
    if (typeof (this.heartbeatTimer as any).unref === 'function') {
      (this.heartbeatTimer as any).unref();
    }
  }

  private pruneStale(): void {
    const now = Date.now();
    const keep: PooledSocket[] = [];
    for (const slot of this.slots) {
      const expired =
        slot.state === 'closed' ||
        slot.ws.readyState > WS_OPEN ||
        (slot.state === 'idle' &&
          (now - slot.createdAt >= this.maxSocketAgeMs || now - slot.lastUsedAt >= this.idleTtlMs));
      if (expired) {
        slot.state = 'closed';
        try {
          slot.ws.close();
        } catch {
          /* ignore */
        }
      } else {
        keep.push(slot);
      }
    }
    this.slots = keep;
  }

  private discardSlot(slot: PooledSocket): void {
    slot.state = 'closed';
    this.slots = this.slots.filter((s) => s.id !== slot.id);
    try {
      slot.ws.close();
    } catch {
      /* ignore */
    }
  }

  private async buildSocketUrl(endpoint: EndpointKind): Promise<string> {
    const secMsGec = await makeSecMsGec();
    const connId = makeConnectionId();
    const base =
      endpoint === 'msedgeservices'
        ? EDGE_TTS_CONSTANTS.SYNTHESIS_URL_V2
        : EDGE_TTS_CONSTANTS.SYNTHESIS_URL;
    const url = new URL(base.replace(/^https:/, 'wss:'));
    url.searchParams.set(
      endpoint === 'msedgeservices' ? 'Ocp-Apim-Subscription-Key' : 'TrustedClientToken',
      EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN,
    );
    url.searchParams.set('Sec-MS-GEC', secMsGec);
    url.searchParams.set('Sec-MS-GEC-Version', EDGE_TTS_CONSTANTS.SEC_MS_GEC_VERSION);
    url.searchParams.set('ConnectionId', connId);
    return url.toString();
  }

  private async spawnSocket(endpoint: EndpointKind): Promise<PooledSocket> {
    const url = await this.buildSocketUrl(endpoint);
    const headers: Record<string, string> = {
      'User-Agent': EDGE_USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      Cookie: `muid=${makeMuid()};`,
    };
    const ws = this.socketFactory(url, headers);
    const now = Date.now();
    const slot: PooledSocket = {
      id: this.nextSlotId++,
      endpoint,
      ws,
      state: 'connecting',
      createdAt: now,
      lastUsedAt: now,
      lastHeartbeatAt: now,
      turnsServed: 0,
      assigned: false,
      readyPromise: Promise.resolve(),
    };

    slot.readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupInit();
        this.lastError = `Edge WS connect timeout (${endpoint})`;
        this.discardSlot(slot);
        reject(new Error(this.lastError));
      }, this.connectTimeoutMs);
      if (typeof (timer as any).unref === 'function') {
        (timer as any).unref();
      }

      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanupInit();
        if (this.disposed || slot.state === 'closed') {
          this.discardSlot(slot);
          reject(new Error('Pool disposed during socket open'));
          return;
        }
        if (slot.state === 'connecting') {
          slot.state = 'idle';
        }
        slot.lastHeartbeatAt = Date.now();
        resolve();
      };

      const onError = (err: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanupInit();
        this.lastError = `Edge WS connect error (${endpoint}): ${String(err?.message || 'handshake failed')}`;
        this.discardSlot(slot);
        reject(new Error(this.lastError));
      };

      const onClose = (ev: any) => {
        if (settled) {
          if (slot.state === 'idle') {
            this.discardSlot(slot);
          }
          return;
        }
        settled = true;
        clearTimeout(timer);
        cleanupInit();
        this.lastError = `Edge WS closed before open (code ${ev?.code ?? 'unknown'})`;
        this.discardSlot(slot);
        reject(new Error(this.lastError));
      };

      const cleanupInit = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        ws.removeEventListener('close', onClose);
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
    });

    // Keep passive close/error cleanup attached for idle sockets
    ws.addEventListener('close', () => {
      if (slot.state === 'idle') {
        this.discardSlot(slot);
        this.replenishAsync();
      }
    });
    ws.addEventListener('error', () => {
      if (slot.state === 'idle') {
        this.discardSlot(slot);
      }
    });

    this.slots.push(slot);
    return slot;
  }

  private async acquireSocket(
    endpoint: EndpointKind,
    signal?: AbortSignal,
  ): Promise<{ slot: PooledSocket; warmHit: boolean }> {
    this.pruneStale();
    const now = Date.now();

    // 1. Prefer an already-open idle socket (0-handshake warm hit)
    const idleIdx = this.slots.findIndex(
      (s) =>
        s.endpoint === endpoint &&
        s.state === 'idle' &&
        !s.assigned &&
        s.ws.readyState === WS_OPEN &&
        now - s.createdAt < this.maxSocketAgeMs,
    );
    if (idleIdx !== -1) {
      const slot = this.slots[idleIdx]!;
      slot.assigned = true;
      slot.state = 'busy';
      this.totalWarmHits++;
      this.replenishAsync();
      return { slot, warmHit: true };
    }

    // 2. Join an unassigned connecting socket if available, otherwise dial fresh
    this.totalColdMisses++;
    let slot = this.slots.find(
      (s) => s.endpoint === endpoint && s.state === 'connecting' && !s.assigned,
    );
    if (!slot) {
      slot = await this.spawnSocket(endpoint);
    }
    slot.assigned = true;

    if (signal?.aborted) {
      slot.assigned = false;
      throw new Error('TTS client aborted');
    }

    await slot.readyPromise;
    if (signal?.aborted) {
      slot.assigned = false;
      this.discardSlot(slot);
      throw new Error('TTS client aborted');
    }
    slot.state = 'busy';
    this.replenishAsync();
    return { slot, warmHit: false };
  }

  async synthesizeStream(req: WarmStreamRequest): Promise<WarmSynthesisMeta> {
    if (this.disposed) {
      throw new Error('WarmEdgeSocketPool is disposed');
    }
    const text = req.text.trim();
    if (!text) {
      throw new Error('text is required');
    }

    const voice = req.voice ?? 'zh-CN-XiaoyiNeural';
    const pitch = req.pitch ?? '+10Hz';
    const rate = req.rate ?? '+0%';
    const volume = req.volume ?? '+0%';
    // Validate and construct SSML upfront (ONLY <prosody>, never <mstts:express-as>).
    const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads(text, voice, pitch, rate, volume);

    const reqStart = performance.now();
    this.ensureHeartbeat();

    // Try warm/cold msedgeservices first; if a warm socket failed before emitting any audio
    // (e.g., silent remote close), retry cleanly with a fresh socket, then bing fallback.
    let lastErr: Error | null = null;
    const attempts: Array<{ endpoint: EndpointKind; allowWarm: boolean }> = [
      { endpoint: 'msedgeservices', allowWarm: true },
      { endpoint: 'msedgeservices', allowWarm: false },
      { endpoint: 'bing', allowWarm: false },
    ];

    for (const attempt of attempts) {
      if (req.signal?.aborted) {
        throw new Error('TTS client aborted');
      }
      if (!attempt.allowWarm && lastErr === null) continue;

      let acquired: { slot: PooledSocket; warmHit: boolean };
      try {
        if (attempt.allowWarm) {
          acquired = await this.acquireSocket(attempt.endpoint, req.signal);
        } else {
          this.totalColdMisses++;
          const fresh = await this.spawnSocket(attempt.endpoint);
          fresh.assigned = true;
          await fresh.readyPromise;
          fresh.state = 'busy';
          acquired = { slot: fresh, warmHit: false };
        }
      } catch (err: any) {
        if (req.signal?.aborted) throw new Error('TTS client aborted');
        lastErr = err instanceof Error ? err : new Error(String(err));
        continue;
      }

      const result = await this.runTurnOnSlot(
        acquired.slot,
        acquired.warmHit,
        speechConfig,
        ssmlMessage,
        reqStart,
        req,
      );

      if (result.ok) {
        return result.meta;
      }
      if (req.signal?.aborted || result.receivedBytes > 0) {
        // Never duplicate audio if bytes were already streamed to caller
        throw result.error;
      }
      lastErr = result.error;
    }

    throw lastErr ?? new Error('Edge-TTS synthesis failed');
  }

  private runTurnOnSlot(
    slot: PooledSocket,
    warmHit: boolean,
    speechConfig: string,
    ssmlMessage: string,
    reqStart: number,
    req: WarmStreamRequest,
  ): Promise<
    | { ok: true; meta: WarmSynthesisMeta }
    | { ok: false; error: Error; receivedBytes: number }
  > {
    return new Promise((resolve) => {
      const ws = slot.ws;
      let finished = false;
      let firstAudioSeen = false;
      let ttfaMs = 0;
      let totalBytes = 0;
      let writeChain: Promise<void> = Promise.resolve();
      let firstChunkTimer: ReturnType<typeof setTimeout> | null = null;
      let turnTimer: ReturnType<typeof setTimeout> | null = null;

      const clearTimers = () => {
        if (firstChunkTimer) {
          clearTimeout(firstChunkTimer);
          firstChunkTimer = null;
        }
        if (turnTimer) {
          clearTimeout(turnTimer);
          turnTimer = null;
        }
      };

      const cleanupListeners = () => {
        ws.removeEventListener('message', onMessage);
        ws.removeEventListener('close', onClose);
        ws.removeEventListener('error', onError);
        req.signal?.removeEventListener('abort', onAbort);
      };

      const failTurn = (err: Error) => {
        if (finished) return;
        finished = true;
        clearTimers();
        cleanupListeners();
        slot.assigned = false;
        this.lastError = err.message;
        this.discardSlot(slot);
        this.replenishAsync();
        resolve({ ok: false, error: err, receivedBytes: totalBytes });
      };

      const succeedTurn = () => {
        if (finished) return;
        finished = true;
        clearTimers();
        cleanupListeners();
        slot.assigned = false;
        slot.lastUsedAt = Date.now();
        slot.lastHeartbeatAt = Date.now();
        slot.turnsServed++;
        const ageExpired = Date.now() - slot.createdAt >= this.maxSocketAgeMs;
        if (ageExpired || this.disposed || ws.readyState !== WS_OPEN) {
          this.discardSlot(slot);
        } else {
          slot.state = 'idle';
        }
        this.replenishAsync();
        resolve({
          ok: true,
          meta: {
            warmHit,
            ttfaMs,
            totalMs: performance.now() - reqStart,
            totalBytes,
          },
        });
      };

      const onAbort = () => {
        failTurn(new Error('TTS client aborted'));
      };

      const onClose = (ev: any) => {
        failTurn(new Error(`Edge WS closed during turn (code ${ev?.code ?? 'unknown'})`));
      };

      const onError = (err: any) => {
        failTurn(new Error(`Edge WS error during turn: ${String(err?.message || 'socket error')}`));
      };

      const onMessage = async (e: MessageEvent) => {
        if (finished) return;
        const data = e.data;
        if (typeof data === 'string') {
          const h = parseHeaders(data);
          if (data.includes('turn.failed') || data.includes('403 Forbidden') || data.includes('Unauthorized')) {
            failTurn(new Error(`Upstream rejected: ${data.slice(0, 150)}`));
            return;
          }
          if (h.Path === 'turn.end') {
            try {
              await writeChain;
              if (!finished) succeedTurn();
            } catch (err: any) {
              failTurn(err instanceof Error ? err : new Error(String(err)));
            }
          }
          return;
        }

        const u8 = await decodeBinaryMessage(data);
        if (!u8 || finished) return;

        try {
          const frame = parseBinaryFrame(u8);
          if (frame.headers.Path === 'audio' && frame.body.length > 0) {
            if (!firstAudioSeen) {
              firstAudioSeen = true;
              ttfaMs = performance.now() - reqStart;
              if (firstChunkTimer) {
                clearTimeout(firstChunkTimer);
                firstChunkTimer = null;
              }
              req.onFirstAudio?.({ warmHit, ttfaMs });
            }
            totalBytes += frame.body.length;
            const bodyCopy = frame.body;
            writeChain = writeChain.then(async () => {
              if (!finished) {
                await req.onChunk(bodyCopy);
              }
            });
            writeChain.catch((err) => {
              failTurn(err instanceof Error ? err : new Error(String(err)));
            });
          }
        } catch (parseErr: any) {
          failTurn(parseErr instanceof Error ? parseErr : new Error(String(parseErr)));
        }
      };

      firstChunkTimer = setTimeout(() => {
        if (!firstAudioSeen) {
          failTurn(new Error('Edge TTS timeout waiting for first audio chunk'));
        }
      }, this.firstChunkTimeoutMs);
      if (typeof (firstChunkTimer as any).unref === 'function') {
        (firstChunkTimer as any).unref();
      }

      turnTimer = setTimeout(() => {
        failTurn(new Error('Edge TTS turn timeout'));
      }, this.turnTimeoutMs);
      if (typeof (turnTimer as any).unref === 'function') {
        (turnTimer as any).unref();
      }

      req.signal?.addEventListener('abort', onAbort, { once: true });
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', onClose);
      ws.addEventListener('error', onError);

      try {
        ws.send(speechConfig);
        ws.send(ssmlMessage);
      } catch (sendErr: any) {
        failTurn(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
      }
    });
  }

  async synthesizeBuffer(
    req: Omit<WarmStreamRequest, 'onChunk' | 'onFirstAudio'>,
  ): Promise<{ audio: Uint8Array; meta: WarmSynthesisMeta }> {
    const chunks: Uint8Array[] = [];
    const meta = await this.synthesizeStream({
      ...req,
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });
    const out = new Uint8Array(meta.totalBytes);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return { audio: out, meta };
  }

  dispose(): void {
    this.disposed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const slot of this.slots) {
      slot.state = 'closed';
      try {
        slot.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.slots = [];
  }
}

let sharedWarmEdgePool: WarmEdgeSocketPool | null = null;

export function getSharedWarmEdgePool(): WarmEdgeSocketPool {
  if (!sharedWarmEdgePool) {
    sharedWarmEdgePool = new WarmEdgeSocketPool({ poolSize: 2 });
  }
  return sharedWarmEdgePool;
}
