import * as THREE from 'three';
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
  PALM_TRUNK,
  SANDCASTLE_RADIUS,
  SHELL_HERO_COUNT,
  SHELL_KEEP_OUT,
  buildCloudLayout,
  buildRockLayout,
  buildShellLayout,
  chairToWorld,
  insideChairFootprint,
  insideSandcastleFootprint,
  islandRidge,
  palmTop,
  parasolCanopy,
  sandcastlePlacement,
  shoreLineZ,
} from '../beach3d/beach3dLayout';
import {
  buildBeachProps,
  buildBeachPropParts,
  buildLighthouse,
  buildLighthouseParts,
  buildIslandStrip,
  buildPalmCrown,
  buildPalmTrunk,
  buildRock,
  buildSandcastle,
  buildSandcastleParts,
  buildScallop,
  SANDCASTLE_DIM,
  SCALLOP_RIBS,
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
      expect(Math.abs(top.x)).toBeGreaterThan(1.0);
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
    // 原先岸边那棵矮小幼树 (x ≈ -1.95) 已移除: 角色左侧 2.2m 以内没有棕榈
    for (const p of PALMS) expect(p.x < 0 && p.x > -2.2).toBe(false);
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
  it('低模: 单棵棕榈 < 2200 三角 (叶冠是贴图叶带, 每片叶 48 + 叶柄 6 三角, 冠顶叶鞘包, 4 个椰子), 场景总计 < 60000 三角', () => {
    const crown = triangleCount(buildPalmCrown(cfg.vegetation.fronds, cfg.vegetation.frondWidth));
    expect(crown).toBeLessThan(1700);
    const palm = triangleCount(buildPalmTrunk()) + crown;
    expect(palm).toBeLessThan(2200);
    const rocks = triangleCount(buildRock(cfg.rocks.detail)) * buildRockLayout(shore).length;
    const castle = sandcastlePlacement(cfg.sandcastle);
    const shells = triangleCount(buildScallop()) * buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp, castle).length;
    const islands = triangleCount(buildIslandStrip(6));
    const props = triangleCount(buildBeachProps()) + triangleCount(buildLighthouse()) + triangleCount(buildSandcastle());
    expect(triangleCount(buildLighthouse())).toBeLessThan(1500);
    expect(triangleCount(buildSandcastle())).toBeLessThan(2000);
    expect(props).toBeLessThan(6000);
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

  it('叶冠是挺拔的星芒形: 叶轴先笔直上扬再拱形下弯, 冠顶叶朝上、老叶下垂; 贴图坐标 0..1', () => {
    const g = buildPalmCrown(cfg.vegetation.fronds);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('aLeaf');
    const part = g.getAttribute('aPart');
    // 按叶轴顶点 (v = 0.5) 把每片叶的叶轴折线取出来 (u 回到 0 = 下一片叶)
    const fronds: THREE.Vector3[][] = [];
    for (let i = 0; i < pos.count; i++) {
      if (part.getX(i) !== 1) continue;
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect([0, 0.5, 1]).toContain(uv.getY(i));
      if (uv.getY(i) !== 0.5) continue;
      if (uv.getX(i) === 0) fronds.push([]);
      fronds[fronds.length - 1].push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
    }
    expect(fronds.length).toBe(Math.round(cfg.vegetation.fronds));
    const elev = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    let rising = 0;
    let tipsUp = 0;
    let tipsDown = 0;
    for (const r of fronds) {
      const n = r.length - 1;
      const e0 = elev(r[0], r[1]);
      const eMid = elev(r[n / 2 - 1], r[n / 2]);
      const eTip = elev(r[n - 1], r[n]);
      expect(e0).toBeLessThan((80 * Math.PI) / 180);                 // 没有竖直戳出来的叶轴
      expect(Math.abs(elev(r[2], r[3]) - e0)).toBeLessThan(0.05);    // 叶柄一段笔直硬挺
      expect(e0 - eMid).toBeLessThan(eMid - eTip);                   // 下弯集中在后半段 (拱形, 不是拖把)
      if (r[n / 3].y > r[0].y + 0.1) rising++;
      if (r[n].y > r[0].y + 0.3) tipsUp++;
      if (r[n].y < r[0].y - 0.5) tipsDown++;
    }
    expect(rising / fronds.length).toBeGreaterThan(0.6);  // 大多数叶先向上拱起
    expect(tipsUp).toBeGreaterThanOrEqual(2);             // 冠顶嫩叶叶尖仍朝上
    expect(tipsDown).toBeGreaterThanOrEqual(2);           // 下层老叶下垂
    expect(tipsDown).toBeLessThan(fronds.length / 2);     // 但不是全部下垂
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

  it('躺椅撑杆: 两端端面 (4 个角) 都在相接的梁里 —— 下端在头端腿正上方的座梁里, 上端在靠背侧梁里', () => {
    const parts = buildBeachPropParts();
    const get = (name: string) => parts.find((p) => p.name === name)!;
    /** 方截面杆一端端面的 4 个角 (与 buildBeachPropParts 里 bar() 的朝向一致)。 */
    const corners = (seg: { a: THREE.Vector3; b: THREE.Vector3; t: number }, end: 'a' | 'b') => {
      const d = seg.b.clone().sub(seg.a).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      const c = end === 'a' ? seg.a : seg.b;
      return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, y]) => c.clone().add(new THREE.Vector3((x * seg.t) / 2, (y * seg.t) / 2, 0).applyQuaternion(q)));
    };
    /** 点是否在方截面杆 (边长 t) 的体积里 (用内切圆柱, 偏严)。 */
    const insideBar = (p: THREE.Vector3, seg: { a: THREE.Vector3; b: THREE.Vector3; t: number }) => {
      const ab = seg.b.clone().sub(seg.a);
      const L = ab.length();
      const along = p.clone().sub(seg.a).dot(ab) / L;
      const perp = p.clone().sub(seg.a).sub(ab.clone().multiplyScalar(along / L)).length();
      return along >= 0 && along <= L && perp <= seg.t / 2 + 1e-6;
    };
    for (const sx of [-1, 1]) {
      const prop = get(`chair:prop${sx}`).seg!;
      const rail = get(`chair:rail${sx}`).geo;
      rail.computeBoundingBox();
      const railBox = rail.boundingBox!.clone().expandByScalar(1e-6);
      for (const c of corners(prop, 'a')) expect(railBox.containsPoint(c)).toBe(true);
      const backRail = get(`chair:backRail${sx}`).seg!;
      for (const c of corners(prop, 'b')) expect(insideBar(c, backRail)).toBe(true);
      // 下端正好在一条腿的正上方
      const legs = parts.filter((p) => p.name.startsWith(`chair:leg${sx}:`)).map((p) => { p.geo.computeBoundingBox(); return p.geo.boundingBox!; });
      expect(legs.some((b) => prop.a.z >= b.min.z && prop.a.z <= b.max.z)).toBe(true);
    }
    parts.forEach((p) => p.geo.dispose());
  });

  it('叶冠: 每片叶的叶柄都从冠顶中心 (树干顶端) 长出, 起点离中心 < 0.08m, 且被冠顶叶鞘包包住', () => {
    const g = buildPalmCrown(cfg.vegetation.fronds);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('aLeaf');
    const part = g.getAttribute('aPart');
    let bases = 0;
    let bootR = 0;
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (part.getX(i) === 1 && uv.getX(i) === 0 && uv.getY(i) === 0.5) {
        bases++;
        expect(p.length()).toBeLessThan(0.08);
      }
      if (part.getX(i) === 3 && uv.getY(i) === 0 && Math.abs(p.y) < 0.05) bootR = Math.max(bootR, Math.hypot(p.x, p.z));
    }
    expect(bases).toBe(Math.round(cfg.vegetation.fronds));
    expect(bootR).toBeGreaterThan(0.1); // 叶鞘包在叶柄起点高度处比起点半径更粗
  });

  it('海上灯塔: 在角色右前方的海里 (岸线外 10m 以上), 部件彼此相连, 礁石底座没入水中, < 1500 三角', () => {
    const lh = cfg.lighthouse;
    expect(lh.x).toBeGreaterThan(0);
    expect(lh.z).toBeLessThan(shoreLineZ(lh.x, shore) - 10);
    const az = (Math.atan2(lh.x, -lh.z) * 180) / Math.PI;
    expect(az).toBeGreaterThan(8);
    expect(az).toBeLessThan(40);
    const parts = buildLighthouseParts();
    const boxes = parts.map((p) => { p.geo.computeBoundingBox(); return { name: p.name, box: p.geo.boundingBox!.clone().expandByScalar(0.002) }; });
    const seen = new Set(boxes.filter((b) => b.box.min.y < 0).map((b) => b.name));
    expect(seen.has('lighthouse:rock')).toBe(true);
    let grew = true;
    while (grew) {
      grew = false;
      for (const a of boxes) {
        if (seen.has(a.name)) continue;
        if (boxes.some((b) => seen.has(b.name) && a.box.intersectsBox(b.box))) { seen.add(a.name); grew = true; }
      }
    }
    expect(boxes.filter((b) => !seen.has(b.name)).map((b) => b.name)).toEqual([]);
    parts.forEach((p) => p.geo.dispose());
  });

  it('远岛只在左侧: 右侧海平线 (方位 > 3°) 没有任何一层岛 (那里是灯塔)', () => {
    for (let az = 3; az <= 95; az += 0.5) {
      for (const layer of [FAR_ISLANDS, MID_ISLANDS, NEAR_ISLANDS]) expect(islandRidge(az, layer)).toBe(0);
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
  const castle = sandcastlePlacement(cfg.sandcastle);
  const shells = buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp, castle);
  const wetTop = (x: number) => shoreLineZ(x, shore) + cfg.sea.swashAmp * 1.35;

  it('数量符合配置 (稀疏: 默认 8 ~ 14 个), 避开角色脚下 / 椅子 / 沙堡, 都在冲刷浪推不到的沙上, 彼此至少隔 0.8m', () => {
    expect(cfg.shells.count).toBeGreaterThanOrEqual(8);
    expect(cfg.shells.count).toBeLessThanOrEqual(14);
    expect(shells.length).toBe(cfg.shells.count);
    for (const s of shells) {
      expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(SHELL_KEEP_OUT);
      expect(s.z).toBeGreaterThan(wetTop(s.x));
      expect(insideChairFootprint(s.x, s.z, 0.1)).toBe(false);
      expect(insideSandcastleFootprint(s.x, s.z, castle, 0.1)).toBe(false);
      expect(s.size).toBeGreaterThan(0.02);
      expect(s.size).toBeLessThan(0.24);
      expect(s.color).toBeGreaterThanOrEqual(0);
      expect(s.color).toBeLessThan(cfg.shells.colors.length);
    }
    for (let i = 0; i < shells.length; i++) for (let j = 0; j < i; j++) {
      expect(Math.hypot(shells[i].x - shells[j].x, shells[i].z - shells[j].z)).toBeGreaterThan(0.44);
    }
  });

  it('沙堡打开时, 扇贝布局避开沙堡占地 (含外扩), 关掉沙堡时不受影响', () => {
    // 把沙堡放到默认近景大扇贝的落点上, 那个大扇贝必须让开
    const onHero = { x: 0.95, z: 2.3, scale: 1, yaw: 0 };
    const moved = buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp, onHero);
    for (const s of moved) expect(insideSandcastleFootprint(s.x, s.z, onHero, 0.1)).toBe(false);
    const none = buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp, null);
    expect(none.some((s) => insideSandcastleFootprint(s.x, s.z, onHero))).toBe(true);
  });

  it('分布: 靠近湿沙线更密, 近景只有两个更大的; 颜色以米白 / 奶油色为主', () => {
    // 基础分布不含沙堡避让 (沙堡可能正好落在近景大扇贝上, 避让单独在下面测); 贝壳默认关闭
    const shells = buildShellLayout(cfg.shells.count, shore, cfg.sea.swashAmp, null);
    const rest = shells.slice(SHELL_HERO_COUNT);
    const nearWet = rest.filter((s) => s.z - wetTop(s.x) < 1.4).length;
    expect(nearWet).toBeGreaterThan(rest.length * 0.4);
    const heroes = shells.slice(0, SHELL_HERO_COUNT);
    expect(SHELL_HERO_COUNT).toBe(2);
    const maxRest = Math.max(...rest.map((s) => s.size));
    for (const h of heroes) {
      expect(h.size).toBeGreaterThanOrEqual(maxRest * 0.95);
      expect(h.z).toBeGreaterThan(0); // 在角色和镜头之间
    }
    expect(shells.filter((s) => s.z > 0).length).toBeLessThanOrEqual(4); // 近场只有零星几个
    expect(shells.filter((s) => s.color <= 1).length).toBeGreaterThan(shells.length / 2);
    // 默认色都不是纯白, 且不比沙子主色更亮 (哑光, 不像在反光)
    const lum = (h: number) => 0.2126 * ((h >> 16) & 255) + 0.7152 * ((h >> 8) & 255) + 0.0722 * (h & 255);
    for (const c of cfg.shells.colors) expect(lum(c)).toBeLessThanOrEqual(lum(cfg.sand.base) + 1);
  });

  it('扇贝几何: 放射肋条 (壳面高度沿横向起伏) + 波浪壳缘 + 铰合部一对小耳朵, 底面贴地, < 700 三角', () => {
    const g = buildScallop();
    expect(triangleCount(g)).toBeLessThan(700);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('aUV');
    let minY = Infinity, ears = 0;
    const edgeR: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      minY = Math.min(minY, pos.getY(i));
      if (uv.getX(i) < 0 || uv.getX(i) > 1) ears++;
      if (uv.getY(i) === 1) edgeR.push(Math.hypot(pos.getX(i), pos.getZ(i) + 0.42));
    }
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(minY).toBeLessThan(0.03);
    expect(ears).toBeGreaterThanOrEqual(4);
    // 壳缘半径随肋条起伏: 相邻顶点之间有升有降, 波峰数 ≈ 肋条数
    let peaks = 0;
    for (let i = 1; i + 1 < edgeR.length; i++) if (edgeR[i] > edgeR[i - 1] && edgeR[i] > edgeR[i + 1]) peaks++;
    expect(peaks).toBeGreaterThanOrEqual(SCALLOP_RIBS - 3);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i += 5) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
  });
});

describe('beach3d sandcastle', () => {
  const castle = sandcastlePlacement(cfg.sandcastle);

  it('在角色左前方的沙地上 (镜头与角色之间), 离角色 / 角色落影足够远, 不压在棕榈树干 / 椅子上', () => {
    expect(castle.x).toBeLessThan(-0.8);
    expect(castle.z).toBeGreaterThan(0.6);
    expect(Math.hypot(castle.x, castle.z) - SANDCASTLE_RADIUS * castle.scale).toBeGreaterThan(1.1);
    expect(castle.z).toBeGreaterThan(shoreLineZ(castle.x, shore) + cfg.sea.swashAmp * 1.35 + 2);
    // 太阳从镜头一侧 (+Z) 照来, 角色 / 棕榈的落影都往 −Z (海的方向) 延伸; 沙堡在角色和棕榈的 +Z 一侧, 不会落在它们的影子里
    for (const p of PALMS) {
      expect(Math.hypot(p.x - castle.x, p.z - castle.z)).toBeGreaterThan(SANDCASTLE_RADIUS + PALM_TRUNK.r0 * 2 + 0.5);
      if (Math.abs(p.x - castle.x) < 3) expect(castle.z).toBeGreaterThan(p.z + 1.5);
    }
    expect(insideChairFootprint(castle.x, castle.z, SANDCASTLE_RADIUS)).toBe(false);
    expect(insideSandcastleFootprint(0, 0, castle, 1.2)).toBe(false);
  });

  it('沙堡几何: 35 ~ 55cm 高, 方形底台 (不是圆盘), 所有部件彼此相连并坐在底台上, < 2000 三角', () => {
    const parts = buildSandcastleParts();
    const boxes = parts.map((p) => { p.geo.computeBoundingBox(); return { name: p.name, box: p.geo.boundingBox!.clone().expandByScalar(0.004) }; });
    const all = boxes.reduce((b, x) => b.union(x.box), boxes[0].box.clone());
    const towers = boxes.filter((b) => /^castle:(backLeft|backRight|frontLeft|frontRight)$/.test(b.name));
    expect(towers.length).toBe(4);
    const tallest = Math.max(...boxes.filter((b) => !b.name.startsWith('castle:flag')).map((b) => b.box.max.y));
    expect(tallest).toBeGreaterThan(0.35);
    expect(tallest).toBeLessThan(0.55);
    expect(all.max.y).toBeLessThan(0.6);
    // 底台: 方形 (四角都在底台里, 不是旋转体), 底边略埋进沙里
    const base = boxes.find((b) => b.name === 'castle:base')!.box;
    expect(base.min.y).toBeLessThan(0);
    expect(base.max.x - base.min.x).toBeGreaterThan(SANDCASTLE_DIM.baseW * 0.95);
    expect(base.max.z - base.min.z).toBeGreaterThan(SANDCASTLE_DIM.baseD * 0.95);
    const baseGeo = parts.find((p) => p.name === 'castle:base')!.geo.getAttribute('position');
    let cornerR = 0;
    for (let i = 0; i < baseGeo.count; i++) cornerR = Math.max(cornerR, Math.hypot(baseGeo.getX(i), baseGeo.getZ(i)));
    expect(cornerR).toBeGreaterThan(Math.hypot(SANDCASTLE_DIM.baseW, SANDCASTLE_DIM.baseD) / 2 * 0.88); // 有角, 不是椭圆
    // 占地圆盖住整个沙堡 (贝壳避让用)
    for (const b of boxes) for (const [x, z] of [[b.box.min.x, b.box.min.z], [b.box.max.x, b.box.max.z], [b.box.min.x, b.box.max.z], [b.box.max.x, b.box.min.z]]) {
      expect(Math.hypot(x, z)).toBeLessThan(SANDCASTLE_RADIUS + 0.03);
    }
    // 连通: 从底台出发, 所有部件都能连上
    const seen = new Set(['castle:base']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const a of boxes) {
        if (seen.has(a.name)) continue;
        if (boxes.some((b) => seen.has(b.name) && a.box.intersectsBox(b.box))) { seen.add(a.name); grew = true; }
      }
    }
    expect(boxes.filter((b) => !seen.has(b.name)).map((b) => b.name)).toEqual([]);
    expect(triangleCount(buildSandcastle())).toBeLessThan(2000);
    parts.forEach((p) => p.geo.dispose());
  });

  it('沙堡合并进沙滩道具的同一次绘制: 属性一致 (position / normal / aUV / aMat = 6)', () => {
    const g = buildSandcastle();
    expect(Object.keys(g.attributes).sort()).toEqual(Object.keys(buildBeachProps().attributes).sort());
    const m = g.getAttribute('aMat');
    for (let i = 0; i < m.count; i += 13) expect(m.getX(i)).toBe(6);
  });
});
