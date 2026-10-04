import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GUIDE_ARC_SHADOW_COLOR, GUIDE_COLOR_CSS, GUIDE_OPACITY, GUIDE_SHADOW_RGB, guideRgba } from './guideStyle';
import { GUIDE_SHADOW, attachMeshShadow, bakeGuideShadowCanvas, disposeGuideShadow, setGuideShadowOpacity } from './guideShadow';

/** node 环境没有 DOM: 用最小假 canvas 记录绘制调用。 */
function fakeCanvas(w = 64, h = 32) {
  const calls: Array<{ x: number; y: number; blur: number; offX: number }> = [];
  const state = { shadowBlur: 0, shadowOffsetX: 0, shadowColor: '' };
  const ctx = Object.assign(state, {
    drawImage: (_img: unknown, x: number, y: number) => { calls.push({ x, y, blur: state.shadowBlur, offX: state.shadowOffsetX }); },
  });
  return { width: w, height: h, getContext: () => ctx, calls, state } as unknown as HTMLCanvasElement & { calls: typeof calls; state: typeof state };
}

describe('guideShadow', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => fakeCanvas(0, 0) });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('参数 (guideStyle 共用常量): 淡、低透明度 + 较大模糊, 不是硬边; 3D 提示与弧线同一组', () => {
    expect(GUIDE_SHADOW.alpha).toBeGreaterThan(0.1);
    expect(GUIDE_SHADOW.alpha).toBeLessThanOrEqual(0.3);
    expect(GUIDE_SHADOW.arcAlpha).toBeGreaterThan(0.1);
    expect(GUIDE_SHADOW.arcAlpha).toBeLessThanOrEqual(0.3);
    expect(GUIDE_SHADOW.blur).toBeGreaterThanOrEqual(6);
    expect(GUIDE_ARC_SHADOW_COLOR).toBe(`rgba(${GUIDE_SHADOW_RGB}, ${GUIDE_SHADOW.arcAlpha})`);
    expect(GUIDE_OPACITY).toBeGreaterThan(0.5);
    expect(GUIDE_OPACITY).toBeLessThan(1);
    expect(guideRgba(0.45)).toBe(`rgba(255, 255, 255, ${Math.round(0.45 * GUIDE_OPACITY * 1000) / 1000})`);
    expect(guideRgba(1, '#102030', 1)).toBe('rgba(16, 32, 48, 1)');
    expect(GUIDE_COLOR_CSS).toBe('rgba(255, 255, 255, 0.75)');
  });

  it('烘焙: 原图画到画布外 (只留 shadow), 9 个偏移 x 2 遍, 再抠掉主体 3 遍, 带留白', () => {
    const src = fakeCanvas(64, 32);
    const out = bakeGuideShadowCanvas(src, { padX: 10, padY: 4 }) as unknown as ReturnType<typeof fakeCanvas>;
    expect(out.width).toBe(84);
    expect(out.height).toBe(40);
    expect(out.calls).toHaveLength(21);
    expect(out.calls.slice(0, 18).every((c) => c.blur === GUIDE_SHADOW.blur && c.offX > out.width)).toBe(true); // 原图本体在画布外, 只留 shadow
    expect(out.calls.slice(18).every((c) => c.blur === 0 && c.offX === 0)).toBe(true); // 抠孔不再产生阴影
    expect(out.calls.slice(0, 18).every((c) => c.x + 64 < 0)).toBe(true); // 原图本体不在可见区内, 只剩阴影; 最后 3 次是抠孔
  });

  it('挂载: 子 mesh 共用几何、不参与拾取、不透明度跟随引导 x alpha、可释放', () => {
    const parent = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const layer = attachMeshShadow(parent, fakeCanvas(64, 32), { padX: 16 });
    const mesh = layer.obj as THREE.Mesh;
    expect(parent.children).toContain(mesh);
    expect(mesh.geometry).toBe(parent.geometry);
    expect(mesh.scale.x).toBeCloseTo(1.5);
    expect(mesh.renderOrder).toBeLessThan(20); // 画在引导本体之前
    expect(layer.mat.blending).toBe(THREE.NormalBlending);
    const hits: THREE.Intersection[] = [];
    mesh.raycast(new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)), hits);
    expect(hits).toHaveLength(0);
    setGuideShadowOpacity(layer, 1);
    expect(layer.mat.opacity).toBeCloseTo(GUIDE_SHADOW.alpha);
    setGuideShadowOpacity(layer, 0);
    expect(layer.mat.opacity).toBe(0);
    setGuideShadowOpacity(null, 1); // 容错
    disposeGuideShadow(layer);
    disposeGuideShadow(null);
  });
});
