import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '@/config';
import {
  CHAIR,
  CLOUD_FILLERS,
  CLOUD_SPRITES,
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
  buildBeachPropParts,
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

  it('竖屏左侧: 近处斜出的棕榈 + 身后一棵更高更直的伴生棕榈; 角色和左侧棕榈之间没有岸边幼树', () => {
    const left = PALMS.filter((p) => p.x < 0 && p.x > -6).sort((a, b) => b.z - a.z);
    expect(left.length).toBe(2);
    const [nearPalm, companion] = left;
    expect(companion.z).toBeLessThan(nearPalm.z);
    expect(companion.height * companion.scale).toBeGreaterThan(nearPalm.height * nearPalm.scale);
    expect(companion.lean).toBeLessThan(nearPalm.lean);
    // 原先岸边那棵矮小幼树 (x ≈ -1.95) 已移除: 角色左侧 2.5m 以内没有棕榈
    for (const p of PALMS) expect(p.x < 0 && p.x > -2.5).toBe(false);
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

  it('云: 数量符合云量配置, 主角云在正面视野里, 全部在海平线以上', () => {
    const clouds = buildCloudLayout(cfg.clouds.density);
    expect(clouds.length).toBe(HERO_CLOUDS.length + Math.round(CLOUD_FILLERS * cfg.clouds.density));
    expect(buildCloudLayout(0).length).toBe(HERO_CLOUDS.length);
    expect(HERO_CLOUDS.filter((c) => Math.abs(c.az) < 12 && c.el < 15).length).toBeGreaterThanOrEqual(2);
    for (const c of clouds) {
      expect(c.el).toBeGreaterThan(0.5);
      expect(c.el).toBeLessThanOrEqual(45);
      expect([0, 1, 2, 3]).toContain(c.kind);
    }
    // 按仰角从低 (远) 到高 (近) 排序
    for (let i = 1; i < clouds.length; i++) expect(clouds[i].el).toBeGreaterThanOrEqual(clouds[i - 1].el);
  });

  it('云图集格子: 都在贴图内、互不重叠, aspect 与格子像素比例一致', () => {
    expect(CLOUD_SPRITES.length).toBe(4);
    for (const sp of CLOUD_SPRITES) {
      const [u, v, du, dv] = sp.rect;
      expect(u).toBeGreaterThanOrEqual(0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(u + du).toBeLessThanOrEqual(1 + 1e-6);
      expect(v + dv).toBeLessThanOrEqual(1 + 1e-6);
      expect(sp.aspect).toBeCloseTo(dv / du, 2); // 图集是正方形
    }
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const [a0, b0, c0, d0] = CLOUD_SPRITES[i].rect;
        const [a1, b1, c1, d1] = CLOUD_SPRITES[j].rect;
        const overlap = a0 < a1 + c1 && a1 < a0 + c0 && b0 < b1 + d1 && b1 < b0 + d0;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe('beach3d geometry budget', () => {
  it('低模: 单棵棕榈 < 2000 三角 (叶冠是贴图叶带, 每片叶 48 三角), 场景总计 < 60000 三角', () => {
    const crown = triangleCount(buildPalmCrown(cfg.vegetation.fronds, cfg.vegetation.frondWidth));
    expect(crown).toBeLessThan(1500);
    const palm = triangleCount(buildPalmTrunk()) + crown;
    expect(palm).toBeLessThan(2000);
    const rocks = triangleCount(buildRock(cfg.rocks.detail)) * buildRockLayout(shore).length;
    const shells = triangleCount(buildShellSet()) * buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp).length;
    const islands = triangleCount(buildIslandStrip(6));
    const props = triangleCount(buildBeachProps());
    expect(props).toBeLessThan(3000);
    const total = palm * PALMS.length + rocks + shells + islands + props + buildCloudLayout(cfg.clouds.density).length * 2 + 40 * 48 * 2 /* 地面 */ + 2 /* 天空 */;
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

  it('叶冠是下垂的拱形叶带 (叶尖低于叶柄), 贴图坐标 0..1, 冠顶没有竖直的叶轴尖', () => {
    const g = buildPalmCrown();
    const pos = g.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(minY).toBeLessThan(-0.8); // 叶尖垂到叶冠中心以下
    expect(maxY).toBeGreaterThan(0.08); // 冠顶嫩叶先向上拱起
    expect(maxY).toBeLessThan(0.5); // 但没有竖直戳出来的叶轴尖
    const uv = g.getAttribute('aLeaf');
    const part = g.getAttribute('aPart');
    for (let i = 0; i < uv.count; i++) {
      if (part.getX(i) !== 1) continue;
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect([0, 0.5, 1]).toContain(uv.getY(i));
    }
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

  it('沙滩道具: 椅子 / 伞各自的所有部件彼此相连并连到插进沙里的腿 / 伞杆 (没有悬空零件)', () => {
    const parts = buildBeachPropParts();
    const boxes = parts.map((p) => {
      p.geo.computeBoundingBox();
      return { name: p.name, box: p.geo.boundingBox!.clone().expandByScalar(0.002) };
    });
    for (const obj of ['chair', 'parasol']) {
      const list = boxes.filter((b) => b.name.startsWith(obj + ':'));
      expect(list.length).toBeGreaterThan(3);
      // 从埋进沙里的部件出发做连通搜索
      const seen = new Set(list.filter((b) => b.box.min.y < 0).map((b) => b.name));
      expect(seen.size).toBeGreaterThan(0);
      let grew = true;
      while (grew) {
        grew = false;
        for (const a of list) {
          if (seen.has(a.name)) continue;
          if (list.some((b) => seen.has(b.name) && a.box.intersectsBox(b.box))) { seen.add(a.name); grew = true; }
        }
      }
      expect(list.filter((b) => !seen.has(b.name)).map((b) => b.name)).toEqual([]);
    }
    // 椅子 4 条腿都插进沙里; 伞杆插进沙里并一直通到伞顶
    const legs = boxes.filter((b) => b.name.startsWith('chair:leg'));
    expect(legs.length).toBe(4);
    for (const l of legs) expect(l.box.min.y).toBeLessThan(0);
    const pole = boxes.find((b) => b.name === 'parasol:pole')!.box;
    const canopy = boxes.find((b) => b.name === 'parasol:canopy')!.box;
    expect(pole.min.y).toBeLessThan(0);
    expect(pole.max.y).toBeGreaterThan(canopy.max.y - 0.03);
    parts.forEach((p) => p.geo.dispose());
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
