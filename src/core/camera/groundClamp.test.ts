import { describe, expect, it } from 'vitest';
import {
  adjustZoomInWhileClamped,
  compensatedFov,
  solveGroundClamp,
  visibleRatioCap,
  type GroundClampSettings,
} from './groundClamp';

const S: GroundClampSettings = { minHeight: 0.15, minDollyDistance: 0.6, fovCompensation: 0.5, baseFov: 30, maxFov: 60 };
const up = (deg: number) => Math.PI / 2 + (deg * Math.PI) / 180;
const camY = (targetY: number, polar: number, r: { distance: number; pivotRaise: number }) =>
  targetY + r.pivotRaise + r.distance * Math.cos(polar);

describe('solveGroundClamp', () => {
  it('相机在 地面 + minHeight 以上: 原样返回', () => {
    const r = solveGroundClamp({ targetY: 1.18, polar: up(0), distance: 2.5, floorY: 0 }, S);
    expect(r).toEqual({ clamped: false, distance: 2.5, pivotRaise: 0, fov: 30 });
    // 仰视但还在地面以上 (视距近)
    expect(solveGroundClamp({ targetY: 1.18, polar: up(60), distance: 1.0, floorY: 0 }, S).clamped).toBe(false);
  });

  it('请求的机位在地下: 俯仰不变, 沿视线推近到刚好贴着 minHeight', () => {
    for (const deg of [30, 40, 60, 85, 89.4]) {
      const polar = up(deg);
      const r = solveGroundClamp({ targetY: 1.18, polar, distance: 2.5, floorY: 0 }, S);
      expect(r.clamped).toBe(true);
      expect(r.pivotRaise).toBe(0);
      expect(r.distance).toBeLessThan(2.5);
      expect(camY(1.18, polar, r)).toBeCloseTo(0.15, 9);
    }
  });

  it('推近越多 FOV 补偿越大, 但不超过 maxFov', () => {
    const a = solveGroundClamp({ targetY: 1.18, polar: up(40), distance: 2.5, floorY: 0 }, S);
    const b = solveGroundClamp({ targetY: 1.18, polar: up(60), distance: 2.5, floorY: 0 }, S);
    const far = solveGroundClamp({ targetY: 1.18, polar: up(60), distance: 15, floorY: 0 }, S);
    expect(a.fov).toBeGreaterThan(30);
    expect(b.fov).toBeGreaterThan(a.fov);
    expect(far.fov).toBe(60);
    expect(solveGroundClamp({ targetY: 1.18, polar: up(60), distance: 2.5, floorY: 0 }, { ...S, fovCompensation: 0 }).fov).toBe(30);
  });

  it('推近不到 minDollyDistance 以内: 改为抬高环绕中心, 相机仍贴着 minHeight', () => {
    // 相机 Y 偏移把目标点压到 0.3m: 只能推到 0.6m, 剩下的靠抬高中心
    const polar = up(80);
    const r = solveGroundClamp({ targetY: 0.3, polar, distance: 2.5, floorY: 0 }, S);
    expect(r.clamped).toBe(true);
    expect(r.distance).toBeCloseTo(0.6, 9);
    expect(r.pivotRaise).toBeGreaterThan(0);
    expect(camY(0.3, polar, r)).toBeCloseTo(0.15, 9);
  });

  it('目标点本身在 minHeight 以下且俯视: 只抬高中心, 视距不变', () => {
    const polar = up(-30);
    const r = solveGroundClamp({ targetY: 0.05, polar, distance: 2.0, floorY: 0 }, { ...S, minHeight: 2 });
    expect(r.distance).toBe(2.0);
    expect(camY(0.05, polar, r)).toBeCloseTo(2, 9);
  });

  it('非法输入不产生 NaN', () => {
    const r = solveGroundClamp({ targetY: 1, polar: NaN, distance: NaN, floorY: 0 }, S);
    expect(Number.isFinite(r.distance) && Number.isFinite(r.fov) && Number.isFinite(r.pivotRaise)).toBe(true);
  });
});

describe('FOV 补偿 / 缩放', () => {
  it('compensatedFov: ratio = 1 不变, k = 1 时人物大小不变 (tan 比 = 视距比)', () => {
    expect(compensatedFov(30, 1, 0.5, 60)).toBe(30);
    const f = compensatedFov(30, 1.5, 1, 179);
    expect(Math.tan((f * Math.PI) / 360) / Math.tan((30 * Math.PI) / 360)).toBeCloseTo(1.5, 9);
  });

  it('visibleRatioCap: FOV 刚好顶到 maxFov 的视距比', () => {
    const cap = visibleRatioCap(30, 0.5, 60);
    expect(compensatedFov(30, cap, 0.5, 60)).toBeCloseTo(60, 6);
    expect(compensatedFov(30, cap * 0.9, 0.5, 60)).toBeLessThan(60);
    expect(visibleRatioCap(30, 0, 60)).toBe(1);
  });

  it('adjustZoomInWhileClamped: 拉近从"画面开始有变化"处起算, 拉远原样', () => {
    const cap = visibleRatioCap(30, 0.5, 60); // ≈ 4.64
    // 实际 1.2m, 想要 15m (远超 1.2 × 4.64), 滚一格拉近 10%
    const next = adjustZoomInWhileClamped(15, 13.5, 1.2, cap);
    expect(next).toBeCloseTo(1.2 * cap * 0.9, 9);
    // 还在可见范围内: 原样
    expect(adjustZoomInWhileClamped(3, 2.7, 1.2, cap)).toBe(2.7);
    // 浮点误差级别的变化不算拉近
    expect(adjustZoomInWhileClamped(10, 10 - 1e-12, 1.2, cap)).toBe(10 - 1e-12);
    // 拉远: 原样
    expect(adjustZoomInWhileClamped(3, 3.3, 1.2, cap)).toBe(3.3);
    // 不补偿 FOV: 拉近起点 = 实际视距
    expect(adjustZoomInWhileClamped(5, 4.5, 1.2, 1)).toBeCloseTo(1.2 * 0.9, 9);
  });
});
