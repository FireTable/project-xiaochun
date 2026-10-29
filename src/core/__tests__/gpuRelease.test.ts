import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetGpuReleaseForTests,
  handlePageHide,
  loseGlContext,
  registerGpuReleaser,
  releaseAllGpu,
  releaseRendererGpu,
} from '../gpuRelease';

afterEach(() => {
  __resetGpuReleaseForTests();
  vi.unstubAllGlobals();
});

const fakeRenderer = () => ({ dispose: vi.fn(), forceContextLoss: vi.fn() });

describe('releaseRendererGpu', () => {
  it('disposes and loses the context exactly once, even when called repeatedly', () => {
    const r = fakeRenderer();
    releaseRendererGpu(r, { loseContext: true });
    releaseRendererGpu(r, { loseContext: true });
    expect(r.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(r.dispose).toHaveBeenCalled();
  });

  it('does not lose the context unless asked (same-canvas re-attach)', () => {
    const r = fakeRenderer();
    releaseRendererGpu(r);
    expect(r.dispose).toHaveBeenCalledTimes(1);
    expect(r.forceContextLoss).not.toHaveBeenCalled();
  });

  it('never throws when dispose / forceContextLoss throw', () => {
    const r = { dispose: () => { throw new Error('x'); }, forceContextLoss: () => { throw new Error('y'); } };
    expect(() => releaseRendererGpu(r, { loseContext: true })).not.toThrow();
  });
});

describe('loseGlContext', () => {
  it('calls loseContext once and skips already-lost contexts', () => {
    const loseContext = vi.fn();
    const gl = { isContextLost: () => false, getExtension: vi.fn(() => ({ loseContext })) } as unknown as WebGLRenderingContext;
    loseGlContext(gl);
    loseGlContext(gl);
    expect(loseContext).toHaveBeenCalledTimes(1);
    const lost = { isContextLost: () => true, getExtension: vi.fn() } as unknown as WebGLRenderingContext;
    loseGlContext(lost);
    expect(lost.getExtension).not.toHaveBeenCalled();
    expect(() => loseGlContext(null)).not.toThrow();
  });
});

describe('pagehide wiring', () => {
  it('installs a single pagehide listener and releases on non-persisted pagehide', () => {
    const add = vi.fn();
    vi.stubGlobal('window', { addEventListener: add });
    const a = vi.fn();
    const b = vi.fn();
    registerGpuReleaser(a);
    registerGpuReleaser(b);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toBe('pagehide');
    const handler = add.mock.calls[0][1] as (e: { persisted: boolean }) => void;
    handler({ persisted: false });
    handler({ persisted: false });
    expect(a).toHaveBeenCalledTimes(2); // releasers are re-run; idempotency is each releaser's job
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('skips the hard release when the page enters the bfcache (persisted)', () => {
    const fn = vi.fn();
    registerGpuReleaser(fn);
    handlePageHide({ persisted: true });
    expect(fn).not.toHaveBeenCalled();
    handlePageHide({ persisted: false });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps releasing the rest if one releaser throws; unregister removes it', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    const off = registerGpuReleaser(bad);
    registerGpuReleaser(good);
    releaseAllGpu();
    expect(good).toHaveBeenCalledTimes(1);
    off();
    releaseAllGpu();
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
