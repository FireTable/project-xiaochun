import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  swapOutfit: vi.fn(),
  engine: { currentVRM: {} as object | null, currentOutfitKey: null as string | null, isSwappingOutfit: false },
}));

vi.mock('@/core/vrmEngine', () => ({
  vrmEngine: {
    swapOutfit: h.swapOutfit,
    get currentVRM() { return h.engine.currentVRM; },
    get currentOutfitKey() { return h.engine.currentOutfitKey; },
    get isSwappingOutfit() { return h.engine.isSwappingOutfit; },
  },
}));

import { changeOutfit, resolveOutfit } from './outfit';

describe('outfit (single entry for header menu + story try-on cards)', () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    h.swapOutfit.mockReset();
    h.engine.currentVRM = {};
    h.engine.currentOutfitKey = null;
    h.engine.isSwappingOutfit = false;
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
  });

  it('resolves addon keys, short aliases and base', () => {
    expect(resolveOutfit('xiaochun_maid')?.key).toBe('xiaochun_maid');
    expect(resolveOutfit('maid')?.key).toBe('xiaochun_maid');
    expect(resolveOutfit('base')?.key).toBeNull();
    expect(resolveOutfit('nope')).toBeNull();
  });

  it('swaps and persists WEARING_OUTFIT_KEY after the swap lands', async () => {
    h.swapOutfit.mockResolvedValue(true);
    const t = resolveOutfit('xiaochun_maid')!;
    expect(await changeOutfit(t, { showcase: false })).toBe(true);
    expect(h.swapOutfit).toHaveBeenCalledWith(t.source, t.name, { showcase: false });
    expect(store.xiaochun_wearing_outfit).toBe('xiaochun_maid');
  });

  it('does not persist a request that was superseded by a newer swap', async () => {
    h.swapOutfit.mockResolvedValue(false);
    expect(await changeOutfit(resolveOutfit('xiaochun_maid')!)).toBe(false);
    expect(store.xiaochun_wearing_outfit).toBeUndefined();
  });

  it('skips the whole reload when that outfit is already worn (no re-compose / re-parse), but still persists', async () => {
    h.engine.currentOutfitKey = 'xiaochun_maid';
    expect(await changeOutfit(resolveOutfit('xiaochun_maid')!)).toBe(true);
    expect(h.swapOutfit).not.toHaveBeenCalled();
    expect(store.xiaochun_wearing_outfit).toBe('xiaochun_maid');
  });

  it('does not short-circuit while another swap is in flight (current key is about to change)', async () => {
    h.engine.currentOutfitKey = 'xiaochun_maid';
    h.engine.isSwappingOutfit = true;
    h.swapOutfit.mockResolvedValue(true);
    await changeOutfit(resolveOutfit('xiaochun_maid')!);
    expect(h.swapOutfit).toHaveBeenCalledTimes(1);
  });

  it('base clears the saved outfit', async () => {
    store.xiaochun_wearing_outfit = 'xiaochun_maid';
    h.swapOutfit.mockResolvedValue(true);
    await changeOutfit(resolveOutfit('base')!);
    expect(store.xiaochun_wearing_outfit).toBeUndefined();
  });
});
