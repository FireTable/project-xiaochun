import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '@/config';
import { FAR_PEAKS, GRASS_KEEP_OUT_X, NEAR_PEAKS, PALMS, buildGrassLayout, buildRockLayout, ridgeHeight, shoreLineZ } from '../beach3d/beach3dLayout';
import { buildFrameFronds, buildGrassClump, buildMountains, buildPalmCrown, buildPalmTrunk, buildRock, trunkTop, triangleCount } from '../beach3d/beach3dGeometry';
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

  it('草丛在沙地上、不进角色禁区, 布局确定 (两次结果一致)', () => {
    const a = buildGrassLayout(shore);
    const b = buildGrassLayout(shore);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    for (const g of a) {
      expect(g.z).toBeGreaterThan(shoreLineZ(g.x, shore) + 0.8 - 1e-9);
      expect(Math.abs(g.x) >= GRASS_KEEP_OUT_X || g.z <= -2.2).toBe(true);
    }
  });

  it('框景叶: 左右两簇镜像对称, 叶片都向画面内 (左簇 x ≥ 根部, 右簇相反) 且向下垂', () => {
    const g = buildFrameFronds();
    const pos = g.getAttribute('position');
    const side = g.getAttribute('aSide');
    let nl = 0, nr = 0, minY = 0;
    for (let i = 0; i < pos.count; i++) {
      const sx = side.getX(i);
      if (sx < 0) nl++; else nr++;
      expect(pos.getX(i) * sx).toBeLessThan(0.3); // 左簇 (−1) 向 +X 伸, 右簇 (+1) 向 −X 伸
      minY = Math.min(minY, pos.getY(i));
    }
    expect(nl).toBe(nr);
    expect(minY).toBeLessThan(-0.4);
    expect(minY).toBeGreaterThan(-1.3);
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
    }
    for (let az = -6; az <= 6; az += 0.5) expect(ridgeHeight(az, FAR_PEAKS)).toBeLessThan(2.2);
  });
});

describe('beach3d geometry budget', () => {
  it('低模: 单棵棕榈 < 800 三角, 场景总计 < 20000 三角', () => {
    const trunk = triangleCount(buildPalmTrunk());
    const crown = triangleCount(buildPalmCrown());
    const grass = triangleCount(buildGrassClump());
    const mountains = triangleCount(buildMountains(1));
    expect(trunk + crown).toBeLessThan(800);
    const rocks = triangleCount(buildRock(APP_CONFIG.beach3dScene.rocks.detail)) * buildRockLayout(shore).length;
    const frame = triangleCount(buildFrameFronds());
    const total = (trunk + crown) * PALMS.length + grass * buildGrassLayout(shore).length + mountains + rocks + frame + 40 * 48 * 2 /* 地面 */ + 2 /* 天空 */;
    expect(total).toBeLessThan(20000);
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
});
