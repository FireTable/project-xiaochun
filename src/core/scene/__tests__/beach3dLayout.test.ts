import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '@/config';
import {
  CHAIR,
  FAR_ISLANDS,
  HERO_CLOUDS,
  MID_ISLANDS,
  NEAR_ISLANDS,
  PALMS,
  SHELL_HERO_COUNT,
  SHELL_KEEP_OUT,
  buildCloudLayout,
  buildRockLayout,
  buildShellLayout,
  chairToWorld,
  insideChairFootprint,
  islandRidge,
  palmTop,
  parasolCanopy,
  shoreLineZ,
} from '../beach3d/beach3dLayout';
import {
  buildBeachProps,
  buildIslandStrip,
  buildPalmCrown,
  buildPalmTrunk,
  buildRock,
  buildShellSet,
  triangleCount,
} from '../beach3d/beach3dGeometry';
import { computeHorizonDip } from '../beach3d/beach3dWorld';

const cfg = APP_CONFIG.beach3dScene;
const shore = cfg.layout;

describe('beach3d layout', () => {
  it('岸线: 角色身后 (x≈0) 在 shoreZ 附近, 两侧往后弯', () => {
    expect(Math.abs(shoreLineZ(0, shore) - shore.shoreZ)).toBeLessThan(shore.shoreWiggle * 1.4 + 1e-6);
    expect(shoreLineZ(15, shore)).toBeLessThan(shoreLineZ(0, shore));
    expect(shoreLineZ(-15, shore)).toBeLessThan(shoreLineZ(0, shore));
  });

  it('角色站在沙地上 (脚下离水边至少 2m, 浪冲到最远也不会到脚下)', () => {
    expect(shoreLineZ(0, shore) + cfg.sea.swashAmp).toBeLessThan(-2);
  });

  it('棕榈: 全部种在沙地上, 离角色足够远, 叶冠不悬在角色正上方', () => {
    for (const p of PALMS) {
      expect(p.z).toBeGreaterThan(shoreLineZ(p.x, shore) + 0.8);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(2.4);
      const top = palmTop(p);
      expect(Math.abs(top.x)).toBeGreaterThan(1.2);
      expect(top.y).toBeGreaterThan(2.5);
    }
  });

  it('棕榈构图不对称: 左右都有, 但数量 / 高度 / 倾斜各不相同', () => {
    const near = PALMS.filter((p) => Math.abs(p.x) < 6);
    const left = near.filter((p) => p.x < 0);
    const right = near.filter((p) => p.x > 0);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(left.length).not.toBe(right.length);
    const uniq = (xs: number[]) => new Set(xs.map((v) => v.toFixed(2))).size;
    expect(uniq(PALMS.map((p) => p.height))).toBeGreaterThan(PALMS.length / 2);
    expect(uniq(PALMS.map((p) => p.lean))).toBeGreaterThan(PALMS.length / 2);
  });

  it('沙滩椅 + 遮阳伞: 在角色右侧沙地上, 不挡角色, 棕榈不压在椅子上', () => {
    expect(CHAIR.x).toBeGreaterThan(1.2);
    expect(insideChairFootprint(CHAIR.x, CHAIR.z)).toBe(true);
    expect(insideChairFootprint(0, 0, 0.3)).toBe(false);
    for (const [lx, lz] of [[-0.5, -1], [0.5, -1], [-0.5, 1], [0.5, 1]] as const) {
      const w = chairToWorld(lx * CHAIR.width, lz * CHAIR.length * 0.5);
      expect(w.x).toBeGreaterThan(0.9);
      expect(w.z).toBeGreaterThan(shoreLineZ(w.x, shore) + cfg.sea.swashAmp * 1.35);
    }
    for (const p of PALMS) expect(insideChairFootprint(p.x, p.z, 0.4)).toBe(false);
    const c = parasolCanopy();
    expect(c.y).toBeGreaterThan(1.5);
    expect(c.x - c.r).toBeGreaterThan(0.6); // 伞面不伸到角色身后
  });

  it('礁石: 只在两侧, 不挡角色正后方的海面; 有一部分在水里', () => {
    const rocks = buildRockLayout(shore);
    expect(rocks.length).toBeGreaterThan(10);
    for (const r of rocks) {
      expect(Math.abs(r.x)).toBeGreaterThanOrEqual(2.2);
      expect(r.inWater).toBe(r.z < shoreLineZ(r.x, shore) - 0.1);
      expect(insideChairFootprint(r.x, r.z, 0.3)).toBe(false);
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

  it('远岛: 三层剪影高度非负, 角色正后方只有低矮岛影 (留出海面)', () => {
    for (let az = -90; az <= 90; az += 0.5) {
      for (const layer of [FAR_ISLANDS, MID_ISLANDS, NEAR_ISLANDS]) expect(islandRidge(az, layer)).toBeGreaterThanOrEqual(0);
    }
    for (let az = -5; az <= 5; az += 0.5) {
      expect(islandRidge(az, FAR_ISLANDS)).toBeLessThan(1.5);
      expect(islandRidge(az, MID_ISLANDS)).toBeLessThan(0.3);
      expect(islandRidge(az, NEAR_ISLANDS)).toBe(0);
    }
    expect(FAR_ISLANDS.length + MID_ISLANDS.length + NEAR_ISLANDS.length).toBeLessThanOrEqual(12); // ISL_MAX
  });

  it('云: 数量符合配置, 主角云在正面视野里, 全部在海平线以上', () => {
    const clouds = buildCloudLayout(cfg.clouds.count);
    expect(clouds.length).toBe(cfg.clouds.count);
    expect(HERO_CLOUDS.filter((c) => Math.abs(c.az) < 12 && c.el < 15).length).toBeGreaterThanOrEqual(2);
    for (const c of clouds) {
      expect(c.el).toBeGreaterThan(0.5);
      expect(c.el).toBeLessThan(60);
      expect([0, 1, 2]).toContain(c.kind);
    }
  });
});

describe('beach3d geometry budget', () => {
  it('低模: 单棵棕榈 < 2600 三角, 场景总计 < 60000 三角', () => {
    const palm = triangleCount(buildPalmTrunk()) + triangleCount(buildPalmCrown(cfg.vegetation.fronds, cfg.vegetation.leaflets));
    expect(palm).toBeLessThan(2600);
    const rocks = triangleCount(buildRock(cfg.rocks.detail)) * buildRockLayout(shore).length;
    const shells = triangleCount(buildShellSet()) * buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp).length;
    const islands = triangleCount(buildIslandStrip(6));
    const props = triangleCount(buildBeachProps());
    expect(props).toBeLessThan(3000);
    const total = palm * PALMS.length + rocks + shells + islands + props + cfg.clouds.count * 2 + 40 * 48 * 2 /* 地面 */ + 2 /* 天空 */;
    expect(total).toBeLessThan(60000);
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

  it('叶冠是下垂的拱形叶 (叶尖低于叶柄), 不是一层层松树枝', () => {
    const g = buildPalmCrown();
    const pos = g.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(minY).toBeLessThan(-0.8); // 叶尖垂到叶冠中心以下
    expect(maxY).toBeGreaterThan(0.3); // 上层叶先向上拱起
  });

  it('沙滩道具: 一个合并几何, 带材质分区 aMat, 法线已归一化', () => {
    const g = buildBeachProps();
    const m = g.getAttribute('aMat');
    expect(m).toBeTruthy();
    const seen = new Set<number>();
    for (let i = 0; i < m.count; i++) seen.add(Math.round(m.getX(i)));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i += 11) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 2);
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
  const shells = buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp);
  const wetTop = (x: number) => shoreLineZ(x, shore) + cfg.sea.swashAmp * 1.35;

  it('数量符合配置, 避开角色脚下 / 椅子, 都在冲刷浪推不到的沙上', () => {
    expect(shells.length).toBe(cfg.shells.count);
    for (const s of shells) {
      expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(SHELL_KEEP_OUT);
      expect(s.z).toBeGreaterThan(wetTop(s.x));
      expect(insideChairFootprint(s.x, s.z, 0.1)).toBe(false);
      expect(s.size).toBeGreaterThan(0.02);
      expect(s.size).toBeLessThan(0.24);
    }
  });

  it('分布: 靠近湿沙线更密, 镜头前有几个更大的', () => {
    const rest = shells.slice(SHELL_HERO_COUNT);
    const nearWet = rest.filter((s) => s.z - wetTop(s.x) < 1.4).length;
    expect(nearWet).toBeGreaterThan(rest.length * 0.4);
    const heroes = shells.slice(0, SHELL_HERO_COUNT);
    const maxRest = Math.max(...rest.map((s) => s.size));
    for (const h of heroes) {
      expect(h.size).toBeGreaterThanOrEqual(maxRest * 0.95);
      expect(h.z).toBeGreaterThan(0); // 在角色和镜头之间
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
