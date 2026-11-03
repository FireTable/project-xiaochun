import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLoopbackHost } from '../loopback';

function stubLocation(url: string) {
  const u = new URL(url);
  vi.stubGlobal('location', { hostname: u.hostname, search: u.search });
}

describe('isLoopbackHost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('DEV 下永远 false（即使 localhost / loopback=1）', () => {
    vi.stubEnv('DEV', true);
    stubLocation('https://localhost:5185/?loopback=1');
    expect(isLoopbackHost()).toBe(false);
  });

  it('非 DEV：loopback=1 → true（即使域名不是回环）', () => {
    vi.stubEnv('DEV', false);
    stubLocation('https://example.com/embed/?loopback=1');
    expect(isLoopbackHost()).toBe(true);
  });

  it('非 DEV：无参数时回退旧规则', () => {
    vi.stubEnv('DEV', false);
    stubLocation('http://127.0.0.1:8080/embed/?host=x');
    expect(isLoopbackHost()).toBe(true);
    stubLocation('https://xiaochun.example.com/');
    expect(isLoopbackHost()).toBe(false);
  });
});
