import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** 最小 indexedDB 假实现: 按脚本决定每次 open 是失败还是成功。 */
function installFakeIndexedDb(script: Array<'error' | 'success' | 'hang'>) {
  const opens: Array<{ db?: { onversionchange: (() => void) | null; close: ReturnType<typeof vi.fn> } }> = [];
  const open = vi.fn(() => {
    const step = script[Math.min(opens.length, script.length - 1)];
    const rec: (typeof opens)[number] = {};
    opens.push(rec);
    const req: any = { error: new Error('boom'), result: null };
    queueMicrotask(() => {
      if (step === 'error') req.onerror?.();
      else if (step === 'success') {
        const stores = new Map<string, unknown>();
        const db = {
          onversionchange: null as (() => void) | null,
          onclose: null,
          close: vi.fn(),
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const tx: any = {};
            tx.objectStore = () => ({
              get: (k: string) => {
                const r: any = {};
                queueMicrotask(() => { r.result = stores.get(k); r.onsuccess?.(); });
                return r;
              },
              put: (v: unknown, k: string) => {
                stores.set(k, v);
                queueMicrotask(() => tx.oncomplete?.());
              },
            });
            return tx;
          },
        };
        rec.db = db;
        req.result = db;
        req.onsuccess?.();
      }
    });
    return req;
  });
  vi.stubGlobal('indexedDB', { open });
  return { open, opens };
}

describe('idb-vrm-cache resilience (swap path must never hang or stay disabled)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a failed open resolves null (miss) and is retried on the next call instead of disabling the cache forever', async () => {
    const fake = installFakeIndexedDb(['error', 'success']);
    const m = await import('./idb-vrm-cache');
    expect(await m.idbGet('u', 's')).toBeNull();
    await m.idbPut('u', 's', new ArrayBuffer(4));
    expect(fake.open).toHaveBeenCalledTimes(2);
    expect(await m.idbGet('u', 's')).not.toBeNull();
  });

  it('an open that never answers times out to a miss rather than hanging the caller', async () => {
    vi.useFakeTimers();
    installFakeIndexedDb(['hang']);
    const m = await import('./idb-vrm-cache');
    const p = m.idbGet('u', 's');
    await vi.advanceTimersByTimeAsync(6000);
    await expect(p).resolves.toBeNull();
  });

  it('onversionchange closes the connection and the next call reopens', async () => {
    const fake = installFakeIndexedDb(['success']);
    const m = await import('./idb-vrm-cache');
    await m.idbGet('u', 's');
    const first = fake.opens[0].db!;
    first.onversionchange?.();
    expect(first.close).toHaveBeenCalled();
    await Promise.resolve();
    await m.idbGet('u', 's');
    expect(fake.open).toHaveBeenCalledTimes(2);
  });

  it('motion keys use the bumped v2 default so pre-branch v1 entries just miss', async () => {
    const fake = installFakeIndexedDb(['success']);
    const m = await import('./idb-vrm-cache');
    await m.idbPutMotion('/vrm/motion/a.vrma', undefined, new ArrayBuffer(4));
    expect(await m.idbGetMotion('/vrm/motion/a.vrma', undefined)).not.toBeNull();
    expect(await m.idbGetMotion('/vrm/motion/a.vrma', 'v1')).toBeNull();
    expect(fake.open).toHaveBeenCalled();
  });
});
