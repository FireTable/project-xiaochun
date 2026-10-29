import { describe, it, expect, vi } from 'vitest';
import { isAllowedOrigin, corsHeadersFor } from '../originGuard';
import { handleTTS } from '../ttsHandler';
import { handleSTT } from '../sttHandler';

const PROD = 'https://xiaochun.firetable.tech';

describe('isAllowedOrigin', () => {
  it.each([
    PROD,
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
    'http://localhost',
    'http://localhost:5173',
    'https://localhost:8443',
    'http://127.0.0.1:3000',
    'https://127.0.0.1',
    'http://[::1]:3000',
    'https://[::1]',
    'http://192.168.1.20:5173',
    'https://192.168.0.1',
    'http://10.0.0.5:8080',
    'https://10.255.255.255',
    'http://172.16.0.1',
    'http://172.20.10.2:3000',
    'https://172.31.255.254:8443',
  ])('allows %s', (origin) => {
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  it.each([
    'https://evil.example',
    'http://xiaochun.firetable.tech', // prod is https only
    'https://xiaochun.firetable.tech:8443',
    'https://xiaochun.firetable.tech.evil.com',
    'https://evilxiaochun.firetable.tech',
    'https://firetable.tech',
    'https://sub.xiaochun.firetable.tech',
    'https://xiaochun.firetable.tech@evil.com',
    'https://evil.com/https://xiaochun.firetable.tech',
    'https://localhost.evil.com',
    'http://127.0.0.1.evil.com',
    'http://localhost@evil.com',
    'http://172.32.0.1',
    'http://172.15.255.255',
    'http://192.169.1.1',
    'http://11.0.0.1',
    'http://192.168.1.1.evil.com',
    'http://192.168.1',
    'http://192.168.1.256',
    'http://0.0.0.0',
    'http://[::2]',
    'http://[fe80::1]',
    'ftp://localhost',
    'file://',
    'tauri://localhost:1420',
    'tauri://tauri.localhost',
    'tauri://localhost/',
    'tauri://evil.localhost',
    'tauri://localhost.evil.com',
    'http://tauri.localhost:8080',
    'http://tauri.localhost.evil.com',
    'http://evil.tauri.localhost',
    'ftp://tauri.localhost',
  ])('denies %s', (origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });

  it.each([null, undefined, '', 'null', 'not a url', 'localhost', '//localhost', 'http://', ' http://localhost'])(
    'denies missing or malformed %j',
    (origin) => {
      expect(isAllowedOrigin(origin as string | null | undefined)).toBe(false);
    },
  );

  it.each([
    'http://localhost/',
    'http://localhost/path',
    'http://localhost?x=1',
    'http://LOCALHOST',
    'http://0x7f.0.0.1',
    'http://2130706433',
    'http://user:pw@localhost',
  ])('denies non-canonical origin %s', (origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });
});

describe('corsHeadersFor', () => {
  it('echoes only the allowed origin and sets Vary: Origin, never *', () => {
    const h = corsHeadersFor(new Request('https://x.test/api/tts', { headers: { Origin: 'http://localhost:5173' } }));
    expect(h?.['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(h?.Vary).toBe('Origin');
  });

  it('returns null without an Origin header', () => {
    expect(corsHeadersFor(new Request('https://x.test/api/tts'))).toBeNull();
  });
});

describe.each([
  ['tts', handleTTS],
  ['stt', handleSTT],
] as const)('/api/%s origin enforcement', (name, handler) => {
  const url = `https://x.test/api/${name}`;
  const run = vi.fn();
  const env = { AI: { run }, TTS_BUCKET: { get: vi.fn(), put: vi.fn() } };

  const req = (method: string, origin?: string) =>
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: method === 'POST' ? JSON.stringify({ text: '' }) : undefined,
    });

  it.each([
    ['missing Origin', undefined],
    ['foreign Origin', 'https://evil.example'],
    ['look-alike host', 'https://xiaochun.firetable.tech.evil.com'],
    ['public-range 172.32 host', 'http://172.32.0.1'],
    ['malformed Origin', 'null'],
  ])('403 with a generic body and no CORS grant for %s (POST and OPTIONS)', async (_label, origin) => {
    for (const method of ['POST', 'OPTIONS']) {
      const res = await handler(req(method, origin), env);
      expect(res.status).toBe(403);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(await res.json()).toEqual({ error: 'Forbidden' });
    }
    expect(run).not.toHaveBeenCalled();
    expect(env.TTS_BUCKET.get).not.toHaveBeenCalled();
  });

  it('OPTIONS preflight from an allowed origin echoes that origin with Vary: Origin', async () => {
    const res = await handler(req('OPTIONS', 'http://192.168.1.5:5173'), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://192.168.1.5:5173');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('prod same-origin POST passes the guard and responses echo the prod origin, not *', async () => {
    const res = await handler(req('POST', PROD), env);
    expect(res.status).not.toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PROD);
    expect(res.headers.get('Vary')).toBe('Origin');
  });
});
