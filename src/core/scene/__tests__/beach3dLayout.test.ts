import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '@/config';
import { FAR_PEAKS, MID_PEAKS, NEAR_PEAKS, PALMS, SHELL_KEEP_OUT, buildRockLayout, buildShellLayout, ridgeHeight, shoreLineZ } from '../beach3d/beach3dLayout';
import { buildMountains, buildPalmCrown, buildPalmTrunk, buildRock, buildShellSet, trunkTop, triangleCount } from '../beach3d/beach3dGeometry';
import { computeHorizonDip } from '../beach3d/beach3dWorld';

const shore = APP_CONFIG.beach3dScene.layout;

describe('beach3d layout', () => {
  it('岸线: 角色身后 (x≈0) 在 shoreZ 附近, 两侧往后弯', () => {
    expect(Math.abs(shoreLineZ(0, shore) - shore.shoreZ)).toBeLessThan(shore.shoreWiggle * 1.4 + 1e-6);
    expect(shoreLineZ(15, shore)).toBeLessThan(shoreLineZ(0, shore));
    expect(shoreLineZ(-15, shore)).toBeLessThan(shoreLineZ(0, shore));
  });

  it('角色站在沙地上 (脚下离水边至少 2m, 浪冲到最远也不会到脚下)', () => {
    expect(shoreLineZ(0, shore) + APP_CONFIG.beach3dScene.sea.swashAmp).toBeLessThan(-2);
  });

  it('棕榈全部种在沙地上, 且离角色足够远 (不挡角色)', () => {
    for (const p of PALMS) {
      expect(p.z).toBeGreaterThan(shoreLineZ(p.x, shore) + 0.8);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(2.4);
      // 叶冠 (树干顶端) 也不能悬在角色正上方附近
      const top = trunkTop().multiplyScalar(p.scale);
      const tx = p.x + top.x * Math.cos(p.yaw);
      const tz = p.z - top.x * Math.sin(p.yaw);
      expect(Math.abs(tx)).toBeGreaterThan(0.9);
      void tz;
    }
    // 左右都有 (框景)
    expect(PALMS.some((p) => p.x < 0)).toBe(true);
    expect(PALMS.some((p) => p.x > 0)).toBe(true);
  });

  it('礁石: 只在两侧, 不挡角色正后方的海面; 有一部分在水里', () => {
    const rocks = buildRockLayout(shore);
    expect(rocks.length).toBeGreaterThan(10);
    for (const r of rocks) {
      expect(Math.abs(r.x)).toBeGreaterThanOrEqual(2.2);
      expect(r.inWater).toBe(r.z < shoreLineZ(r.x, shore) - 0.1);
    }
    expect(rocks.some((r) => r.inWater)).toBe(true);
    expect(rocks.some((r) => !r.inWater)).toBe(true);
  });

  it('地平线弧度: 下沉角为正、随相机升高变大、R 越大越接近 0', () => {
    const R = shore.horizonCurveR;
    const a = computeHorizonDip(0.96, 5.5, R);
    expect(a).toBeGreaterThan(0.02);
    expect(a).toBeLessThan(0.08);
    expect(computeHorizonDip(3, 5.5, R)).toBeGreaterThan(a);
    expect(computeHorizonDip(0.96, 5.5, 1e6)).toBeLessThan(0.01);
    expect(Number.isFinite(computeHorizonDip(-5, 5.5, R))).toBe(true); // 相机在地面以下
  });

  it('远山: 角色正后方只有低矮山脊 (留出海面), 高度非负', () => {
    for (let az = -70; az <= 70; az += 0.5) {
      expect(ridgeHeight(az, FAR_PEAKS)).toBeGreaterThanOrEqual(0);
      expect(ridgeHeight(az, NEAR_PEAKS)).toBeGreaterThanOrEqual(0);
      expect(ridgeHeight(az, MID_PEAKS, 1, 0.3, 2)).toBeGreaterThanOrEqual(0);
    }
    for (let az = -6; az <= 6; az += 0.5) expect(ridgeHeight(az, FAR_PEAKS)).toBeLessThan(2.2);
  });
});

describe('beach3d geometry budget', () => {
  it('低模: 单棵棕榈 (含 4 个圆椰子) < 2000 三角, 场景总计 < 40000 三角', () => {
    const trunk = triangleCount(buildPalmTrunk());
    const crown = triangleCount(buildPalmCrown());
    const mountains = triangleCount(buildMountains(1));
    expect(trunk + crown).toBeLessThan(2000);
    const rocks = triangleCount(buildRock(APP_CONFIG.beach3dScene.rocks.detail)) * buildRockLayout(shore).length;
    const cfg = APP_CONFIG.beach3dScene;
    const shells = triangleCount(buildShellSet()) * buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp).length;
    const total = (trunk + crown) * PALMS.length + mountains + rocks + shells + 40 * 48 * 2 /* 地面 */ + 2 /* 天空 */;
    expect(total).toBeLessThan(40000);
  });

  it('叶冠几何带 aPart / aLeaf 属性, 法线已归一化', () => {
    const g = buildPalmCrown();
    expect(g.getAttribute('aPart')).toBeTruthy();
    expect(g.getAttribute('aLeaf')).toBeTruthy();
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i += 7) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
    }
  });

  it('礁石: 平滑法线 (合并顶点后无裂缝), 底部压平贴地', () => {
    const g = buildRock(1);
    expect(g.getIndex()).toBeTruthy();
    const pos = g.getAttribute('position');
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
    expect(minY).toBeGreaterThan(-0.05);
    expect(minY).toBeLessThan(0.1);
    expect(triangleCount(g)).toBe(320);
  });
});

describe('beach3d shells', () => {
  const cfg = APP_CONFIG.beach3dScene;
  const shells = buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp);

  it('数量符合配置, 避开角色脚下, 都在冲刷浪推不到的沙上', () => {
    expect(shells.length).toBe(cfg.shells.count);
    for (const s of shells) {
      expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(SHELL_KEEP_OUT);
      expect(s.z).toBeGreaterThan(shoreLineZ(s.x, shore) + cfg.sea.swashAmp * 1.35);
      expect(s.size).toBeGreaterThan(0.02);
      expect(s.size).toBeLessThan(0.16);
    }
  });

  it('三种形状合在一个几何里, 每个顶点带 aKind', () => {
    const g = buildShellSet();
    const k = g.getAttribute('aKind');
    const seen = new Set<number>();
    for (let i = 0; i < k.count; i++) seen.add(k.getX(i));
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(triangleCount(g)).toBeLessThan(500);
  });
});
