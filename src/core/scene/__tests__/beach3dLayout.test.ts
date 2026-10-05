import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '@/config';
import { FAR_PEAKS, GRASS_KEEP_OUT_X, NEAR_PEAKS, PALMS, buildGrassLayout, ridgeHeight, shoreLineZ } from '../beach3d/beach3dLayout';
import { buildGrassClump, buildMountains, buildPalmCrown, buildPalmTrunk, trunkTop, triangleCount } from '../beach3d/beach3dGeometry';

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

  it('远山: 角色正后方只有低矮山脊 (留出海面), 高度非负', () => {
    for (let az = -70; az <= 70; az += 0.5) {
      expect(ridgeHeight(az, FAR_PEAKS)).toBeGreaterThanOrEqual(0);
      expect(ridgeHeight(az, NEAR_PEAKS)).toBeGreaterThanOrEqual(0);
    }
    for (let az = -6; az <= 6; az += 0.5) expect(ridgeHeight(az, FAR_PEAKS)).toBeLessThan(2.2);
  });
});

describe('beach3d geometry budget', () => {
  it('低模: 单棵棕榈 < 800 三角, 全部植被 + 远山 < 12000 三角', () => {
    const trunk = triangleCount(buildPalmTrunk());
    const crown = triangleCount(buildPalmCrown());
    const grass = triangleCount(buildGrassClump());
    const mountains = triangleCount(buildMountains(1));
    expect(trunk + crown).toBeLessThan(800);
    const total = (trunk + crown) * PALMS.length + grass * buildGrassLayout(shore).length + mountains + 2 /* 地面 */ + 2 /* 天空 */;
    expect(total).toBeLessThan(12000);
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
