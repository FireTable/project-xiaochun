import { describe, it, expect, vi } from 'vitest';
import { handleSTT } from '../sttHandler';

const ORIGIN = 'https://xiaochun.firetable.tech';

const wav = (bytes: number) =>
  new Request('https://x.test/api/stt', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', Origin: ORIGIN },
    body: new Uint8Array(bytes),
  });

describe('handleSTT hardening', () => {
  it('413 when Content-Length is over 10MB, without touching the model', async () => {
    const run = vi.fn();
    const req = new Request('https://x.test/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', Origin: ORIGIN, 'Content-Length': String(11 * 1024 * 1024) },
      body: new Uint8Array(8),
    });
    const res = await handleSTT(req, { AI: { run } });
    expect(res.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it('413 when the buffered body is over 10MB even without a Content-Length', async () => {
    const run = vi.fn();
    const res = await handleSTT(wav(10 * 1024 * 1024 + 1), { AI: { run } });
    expect(res.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it('cancels a chunked body with no Content-Length as soon as it goes over 10MB', async () => {
    const run = vi.fn();
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 100) return controller.close();
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request('https://x.test/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', Origin: ORIGIN },
      body,
      duplex: 'half',
    } as RequestInit);
    const res = await handleSTT(req, { AI: { run } });
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(40);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not retry on the fallback model for an upstream 4xx, and returns a generic message', async () => {
    const err = Object.assign(new Error('secret upstream detail 400 account=abc'), { status: 400 });
    const run = vi.fn().mockRejectedValue(err);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handleSTT(wav(64), { AI: { run } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(text).not.toContain('account=abc');
  });

  it('still falls back to the second model for a non-4xx failure', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('upstream 503')).mockResolvedValueOnce({ text: ' hello ' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await handleSTT(wav(64), { AI: { run } });
    expect(run).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe('hello');
  });
});
