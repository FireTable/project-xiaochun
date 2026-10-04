import { describe, expect, it } from 'vitest';
import { BEACH_STRIP, computeStripCenter, coverViewport } from '../beachStrip';

const ASPECTS = [0.2, 0.3, 390 / 844, 600 / 1080, 1, 4 / 3, 16 / 9, 2.4, 3.2, 5, 12];
const HORIZONS = [-1.6, -0.9, -0.45, -0.33, -0.1, 0, 0.3, 0.9];
const PS = Array.from({ length: 41 }, (_, i) => -1 + i / 20); // −1 … +1

describe('beach strip mapping', () => {
  it('cover 视口: 不超过单张源图 (1280×720), 宽高比与屏幕一致', () => {
    for (const a of ASPECTS) {
      const { vw, vh } = coverViewport(a);
      expect(vw).toBeLessThanOrEqual(BEACH_STRIP.width + 1e-6);
      expect(vh).toBeLessThanOrEqual(BEACH_STRIP.tileHeight + 1e-6);
      expect(vw / vh).toBeCloseTo(a, 6);
    }
  });

  it('任意宽高比 / 海平线位置 / 俯仰 (含 ±1 极限) / parallax 都不会采样出长条之外 (不露边)', () => {
    for (const aspect of ASPECTS) for (const horizonNdcY of HORIZONS) for (const parallax of [0.2, 0.5, 1]) for (const p of PS) {
      const { center, vh } = computeStripCenter({ p, aspect, horizonNdcY, parallax });
      expect(center - vh / 2).toBeGreaterThanOrEqual(-1e-6);
      expect(center + vh / 2).toBeLessThanOrEqual(BEACH_STRIP.height + 1e-6);
    }
  });

  it('俯仰极限: parallax=1 时 +1 贴到长条顶, −1 贴到长条底 (仰视看到纯天空, 俯视看到纯沙地)', () => {
    for (const aspect of ASPECTS) for (const horizonNdcY of HORIZONS) {
      const up = computeStripCenter({ p: 1, aspect, horizonNdcY });
      const dn = computeStripCenter({ p: -1, aspect, horizonNdcY });
      expect(up.center - up.vh / 2).toBeCloseTo(0, 6);
      expect(dn.center + dn.vh / 2).toBeCloseTo(BEACH_STRIP.height, 6);
    }
  });

  it('单调: p 增大 (越往上看) 中心行只会减小, 背景不会倒卷', () => {
    for (const aspect of ASPECTS) for (const horizonNdcY of HORIZONS) {
      let prev = -Infinity;
      for (const p of PS) { // p 从 −1 升到 +1, center 应不增 → 反向看: 取 −center 单调不减
        const { center } = computeStripCenter({ p, aspect, horizonNdcY });
        if (prev !== -Infinity) expect(center).toBeLessThanOrEqual(prev + 1e-9);
        prev = center;
      }
    }
  });

  it('平视: 海平线落在请求的屏幕位置 (髋部)', () => {
    for (const aspect of [0.5555, 1, 16 / 9]) {
      const horizonNdcY = -0.27; // 默认取景下髋部上方 4cm
      const { center, vh } = computeStripCenter({ p: 0, aspect, horizonNdcY });
      expect((center - BEACH_STRIP.horizonY) / (vh / 2)).toBeCloseTo(horizonNdcY, 3); // y = c − ndc·vh/2
    }
  });

  it('平视时屏幕里是主景 (海平线、海岸线都在视口内)', () => {
    const { center, vh } = computeStripCenter({ p: 0, aspect: 600 / 1080, horizonNdcY: -0.27 });
    expect(center - vh / 2).toBeLessThan(BEACH_STRIP.horizonY);
    expect(center + vh / 2).toBeGreaterThan(BEACH_STRIP.shoreY);
  });

  it('非法输入 (NaN / 越界 p) 不会产生 NaN 或越界', () => {
    const r = computeStripCenter({ p: Number.NaN, aspect: Number.NaN, horizonNdcY: -0.3 });
    expect(Number.isFinite(r.center)).toBe(true);
    const r2 = computeStripCenter({ p: 9, aspect: 1, horizonNdcY: -0.3 });
    expect(r2.center - r2.vh / 2).toBeGreaterThanOrEqual(-1e-6);
  });
});
