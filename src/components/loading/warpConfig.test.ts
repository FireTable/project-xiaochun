import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from '@/config';
import { createWarpGL, makeVS, makeFS, C } from './warpGL';
import kvSrc from './keyvisualWarp.ts?raw';
import workerSrc from './keyvisualWarp.worker.ts?raw';
import warpSrc from './warpGL.ts?raw';

const W = APP_CONFIG.loading.warp;

/** Minimal WebGL stub that records uniform calls by name. */
function fakeGL() {
  const u: Record<string, number[]> = {}; let shaders: string[] = [];
  const gl: any = new Proxy({}, {
    get(_t, k: string) {
      if (k === 'getUniformLocation') return (_p: unknown, n: string) => n;
      if (k === 'shaderSource') return (_s: unknown, src: string) => shaders.push(src);
      if (k.startsWith('uniform')) return (loc: string, ...v: any[]) => { u[loc] = v.flat(); };
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return () => true;
      if (k === 'getError') return () => 0;
      if (/^[A-Z_0-9]+$/.test(k)) return 0;
      return () => ({});
    },
  });
  return { gl, u, shaders: () => shaders };
}

describe('loading warp reads APP_CONFIG.loading.warp', () => {
  it('has every tunable as a number (values are user-tuned, not pinned)', () => {
    expect(Object.keys(W).sort()).toEqual(['amp', 'breathW', 'rampMs', 'warmMs']);
    expect(Object.keys(W.amp).sort()).toEqual(['arm', 'armLLift', 'armLRot', 'breath', 'bust', 'flare', 'hair', 'lipPeriod', 'lipPress', 'skirt', 'tilt', 'waist']);
    for (const v of [W.breathW, W.rampMs, W.warmMs, ...Object.values(W.amp)]) expect(Number.isFinite(v)).toBe(true);
  });
  it('uniforms come from config, not warpGL literals', () => {
    const f = fakeGL();
    const cfg = { ...W, amp: { ...W.amp, bust: 99, flare: 77, lipPeriod: 5, waist: 0.5 } };
    createWarpGL(f.gl, {} as any, {} as any, cfg);
    expect(f.u.A).toEqual([cfg.amp.hair, 99, cfg.amp.skirt, 77]);
    expect(f.u.am).toEqual([cfg.amp.breath, cfg.amp.tilt]);
    expect(f.u.lp).toEqual([cfg.amp.lipPress, 5, C.amp.lipIn]);
    expect(f.u.J![3]).toBe(0.5);
    expect(f.u.LA!.slice(2)).toEqual([cfg.amp.armLRot, cfg.amp.armLLift]);
  });
  it('shader breath constant derives from breathW', () => {
    expect(makeVS(W.breathW)).toContain(`fract(t*${(W.breathW / (2 * Math.PI)).toFixed(6)})`);
    expect(makeFS(2)).toContain('fract(t*0.318310)');
    expect(makeVS(1)).toContain('fract(t*0.159155)');
  });
  it('worker init payload carries the config; no tuned literals left in warp code', () => {
    expect(kvSrc).toContain('warp: APP_CONFIG.loading.warp');
    expect(workerSrc).toContain('createWarpGL(gl, m.img, m.mask, m.warp)');
    expect(workerSrc).not.toMatch(/from '@\/config'/); // worker stays config-free (three.js etc.)
    for (const lit of ['bust: 14', 'flare: 20', 'lipPeriod: 3', 'BREATH_W', '.21645', '.318310', 'RAMP_MS = 1200', 'WARM_MS = 3000'])
      expect(warpSrc + kvSrc).not.toContain(lit);
  });
});
