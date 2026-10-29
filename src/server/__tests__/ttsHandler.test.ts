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
