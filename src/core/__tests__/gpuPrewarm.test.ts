import { describe, expect, it, vi } from 'vitest';
import { PREWARM_EXTENSIONS, runTimeSliced, warmExtensions } from '../gpuPrewarm';

/** Fake clock: every `init` advances time by `cost` ms. */
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('runTimeSliced', () => {
  it('yields once the slice budget is used, so work is split into batches', async () => {
    const c = clock();
    const yieldFn = vi.fn(async () => {});
    const init = vi.fn(() => c.advance(3)); // 8 ms budget -> yield after every 3rd item (9 ms)
    const r = await runTimeSliced([1, 2, 3, 4, 5, 6, 7], init, { budgetMs: 8, now: c.now, yieldFn });
    expect(r).toEqual({ done: 7, yields: 2 });
    expect(yieldFn).toHaveBeenCalledTimes(2);
    expect(init).toHaveBeenCalledTimes(7);
  });

  it('does not yield for cheap work within a single slice', async () => {
    const c = clock();
    const yieldFn = vi.fn(async () => {});
    const r = await runTimeSliced([1, 2, 3], () => c.advance(1), { budgetMs: 8, now: c.now, yieldFn });
    expect(r.yields).toBe(0);
    expect(yieldFn).not.toHaveBeenCalled();
  });

  it('keeps going when an upload throws, and stops when aborted', async () => {
    const c = clock();
    const seen: number[] = [];
    let abort = false;
    await runTimeSliced([1, 2, 3, 4], (n) => {
      seen.push(n);
      if (n === 1) throw new Error('lost');
      if (n === 3) abort = true;
    }, { now: c.now, yieldFn: async () => {}, aborted: () => abort });
    expect(seen).toEqual([1, 2, 3]);
  });

  it('reports a single slow step', async () => {
    const c = clock();
    const onSlow = vi.fn();
    await runTimeSliced(['a'], () => c.advance(120), { now: c.now, yieldFn: async () => {}, onSlow });
    expect(onSlow).toHaveBeenCalledWith('texture', 120);
  });
});

describe('warmExtensions', () => {
  it('touches each extension once with a yield between them (one sync GPU call per task)', async () => {
    const order: string[] = [];
    const ext = { get: (n: string) => { order.push(`get:${n}`); return null; } };
    const yieldFn = vi.fn(async () => { order.push('yield'); });
    await warmExtensions(ext, PREWARM_EXTENSIONS, { yieldFn });
    expect(order.filter((o) => o.startsWith('get:'))).toHaveLength(PREWARM_EXTENSIONS.length);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i].startsWith('get:')).toBe(true);
      expect(order[i + 1]).toBe('yield');
    }
  });

  it('survives a throwing getExtension and stops when aborted', async () => {
    const get = vi.fn((n: string) => { if (n === 'a') throw new Error('lost'); return null; });
    let calls = 0;
    await warmExtensions({ get }, ['a', 'b', 'c'], { yieldFn: async () => {}, aborted: () => ++calls > 2 });
    expect(get.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });

  it('flags a slow extension query', async () => {
    let t = 0;
    const onSlow = vi.fn();
    await warmExtensions({ get: () => { t += 11000; return null; } }, ['OES_texture_float_linear'], { now: () => t, yieldFn: async () => {}, onSlow });
    expect(onSlow).toHaveBeenCalledWith('OES_texture_float_linear', 11000);
  });
});
