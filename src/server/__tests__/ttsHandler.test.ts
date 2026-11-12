import { describe, it, expect, vi } from 'vitest';
import { handleTTS } from '../ttsHandler';

const ORIGIN = 'https://xiaochun.firetable.tech';

const post = (body: unknown) =>
  new Request('https://x.test/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(body),
  });

describe('handleTTS input validation (rejects before any synthesis or cache write)', () => {
  const r2 = { get: vi.fn(), put: vi.fn() };
  const env = { TTS_BUCKET: r2 };

  it.each([
    ['voice with SSML injection', { text: 'hi', voice: "x'><break/><voice name='y" }],
    ['voice that would escape the R2 key prefix', { text: 'hi', voice: '../../evilNeural' }],
    ['non-numeric pitch', { text: 'hi', pitch: 'very-high' }],
    ['rate with attribute injection', { text: 'hi', rate: "+0%' volume='1000" }],
    ['text over the length cap', { text: 'a'.repeat(2001) }],
  ])('400 for %s, no R2 access', async (_name, body) => {
    const res = await handleTTS(post(body), env);
    expect(res.status).toBe(400);
    expect(r2.get).not.toHaveBeenCalled();
    expect(r2.put).not.toHaveBeenCalled();
  });

  it('malformed JSON body is a generic 400 (no parser message echoed)', async () => {
    const res = await handleTTS(
      new Request('https://x.test/api/tts', { method: 'POST', headers: { Origin: ORIGIN }, body: '{not json' }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid request body' });
  });
});

function makeAudioBinaryFrame(payload: Uint8Array): ArrayBuffer {
  const headerBytes = new TextEncoder().encode('Path:audio\r\nContent-Type:audio/mpeg\r\n\r\n');
  const out = new Uint8Array(2 + headerBytes.length + payload.length);
  out[0] = (headerBytes.length >> 8) & 0xff;
  out[1] = headerBytes.length & 0xff;
  out.set(headerBytes, 2);
  out.set(payload, 2 + headerBytes.length);
  return out.buffer;
}

class FakeEdgeSocket {
  private listeners: Record<string, Array<(ev: any) => void>> = {};
  sentCount = 0;
  closed = false;
  onSecondSend?: (sock: FakeEdgeSocket) => void;

  accept() {}
  addEventListener(type: string, fn: (ev: any) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(_msg: string) {
    this.sentCount++;
    if (this.sentCount === 2) {
      queueMicrotask(() => this.onSecondSend?.(this));
    }
  }
  close() {
    this.closed = true;
  }
  emit(type: string, ev: any) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
}

describe('handleTTS truncated-stream cache poisoning guard (AI-1)', () => {
  it('persists to R2 and L1 PoP cache ONLY when Path:turn.end completes cleanly', async () => {
    const r2 = { get: vi.fn(async () => null), put: vi.fn(async () => {}) };
    const popPut = vi.fn(async () => {});
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => undefined), put: popPut } });

    const sock = new FakeEdgeSocket();
    sock.onSecondSend = (s) => {
      s.emit('message', { data: makeAudioBinaryFrame(new Uint8Array([0xff, 0xfb, 0x90, 0x01])) });
      s.emit('message', { data: makeAudioBinaryFrame(new Uint8Array([0x02, 0x03])) });
      s.emit('message', { data: 'Path:turn.end\r\n\r\n' });
    };
    // Cloudflare Workers WebSocket handshake returns status 101; Node Response constructor rejects 101 so mock plain object
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 101, webSocket: sock })));

    const waitPromises: Promise<unknown>[] = [];
    const res = await handleTTS(post({ text: '完整合成测试' }), { TTS_BUCKET: r2 }, {
      waitUntil: (p) => waitPromises.push(p),
    });

    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0xff, 0xfb, 0x90, 0x01, 0x02, 0x03]);

    await Promise.all(waitPromises);
    expect(r2.put).toHaveBeenCalledTimes(1);
    expect(popPut).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('does NOT poison R2 or L1 PoP cache when client cancels stream mid-playback', async () => {
    const r2 = { get: vi.fn(async () => null), put: vi.fn(async () => {}) };
    const popPut = vi.fn(async () => {});
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => undefined), put: popPut } });

    const sock = new FakeEdgeSocket();
    sock.onSecondSend = (s) => {
      s.emit('message', { data: makeAudioBinaryFrame(new Uint8Array([0xff, 0xfb, 0x90, 0x11])) });
      // Never sends turn.end before client cancels
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 101, webSocket: sock })));

    const waitPromises: Promise<unknown>[] = [];
    const res = await handleTTS(post({ text: '被打断的半截语音' }), { TTS_BUCKET: r2 }, {
      waitUntil: (p) => waitPromises.push(p),
    });

    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel('user barge-in');

    await Promise.all(waitPromises);
    expect(r2.put).not.toHaveBeenCalled();
    expect(popPut).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does NOT poison R2 or L1 PoP cache when upstream WebSocket drops before Path:turn.end', async () => {
    const r2 = { get: vi.fn(async () => null), put: vi.fn(async () => {}) };
    const popPut = vi.fn(async () => {});
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => undefined), put: popPut } });

    const sock = new FakeEdgeSocket();
    sock.onSecondSend = (s) => {
      s.emit('message', { data: makeAudioBinaryFrame(new Uint8Array([0xff, 0xfb, 0x90, 0x22])) });
      setTimeout(() => s.emit('close', { code: 1006 }), 5);
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 101, webSocket: sock })));

    const waitPromises: Promise<unknown>[] = [];
    const res = await handleTTS(post({ text: '上游断连的半截语音' }), { TTS_BUCKET: r2 }, {
      waitUntil: (p) => waitPromises.push(p),
    });

    await res.arrayBuffer();
    await Promise.all(waitPromises);
    expect(r2.put).not.toHaveBeenCalled();
    expect(popPut).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
