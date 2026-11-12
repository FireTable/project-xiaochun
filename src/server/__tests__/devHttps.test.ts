import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectLocalCertHosts, resolveDevHttps } from '../../../vite/devHttps';

describe('vite/devHttps smart mkcert & HTTP fallback', () => {
  const origViteHttp = process.env.VITE_HTTP;
  const origViteHttps = process.env.VITE_HTTPS;

  afterEach(() => {
    if (origViteHttp === undefined) delete process.env.VITE_HTTP;
    else process.env.VITE_HTTP = origViteHttp;
    if (origViteHttps === undefined) delete process.env.VITE_HTTPS;
    else process.env.VITE_HTTPS = origViteHttps;
  });

  it('always includes localhost, 127.0.0.1, and ::1 in local certificate SANs', () => {
    const hosts = collectLocalCertHosts();
    expect(hosts).toContain('localhost');
    expect(hosts).toContain('127.0.0.1');
    expect(hosts).toContain('::1');
  });

  it('forces plain HTTP when isServe=false, isTauri=true, or VITE_HTTP=1', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xc-devhttps-'));
    try {
      expect(resolveDevHttps(tmpDir, false, false)).toEqual({
        https: undefined,
        useBasicSsl: false,
        mode: 'http-forced',
      });
      expect(resolveDevHttps(tmpDir, true, true)).toEqual({
        https: undefined,
        useBasicSsl: false,
        mode: 'http-forced',
      });
      process.env.VITE_HTTP = '1';
      expect(resolveDevHttps(tmpDir, true, false)).toEqual({
        https: undefined,
        useBasicSsl: false,
        mode: 'http-forced',
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
