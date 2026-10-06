import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CHAIR, PALM_TRUNK, PARASOL, trunkLeanProfile } from './beach3dLayout';

/**
 * beach3dGeometry.ts — 海滩 3D 场景的低模几何 (程序化生成; 只有棕榈叶贴手绘羽叶贴图)。
 * 每种物体一份几何 + InstancedMesh, 棕榈只有 2 次绘制 (树干 / 叶冠); 沙滩椅 + 遮阳伞合并成 1 个几何 (1 次绘制)。
 *
 * 棕榈的自定义顶点属性:
 *   aPart  — 0 树干, 1 叶片 (贴手绘羽叶贴图), 2 椰子 (叶冠几何里混合了叶和椰子, 共用一次绘制), 3 冠顶叶鞘包 / 叶柄
 *   aNut   — 椰子: (中心 xyz, 槽位序号 0..3); 顶点着色器按每棵树的种子决定画几颗 (多余的塌成一点) 和每颗的大小
 *   aLeaf  — 叶片 = 贴图坐标 (u: 叶柄 → 叶尖 0..1, v: 横向 0..1, 叶轴 v = 0.5); 树干 = (高度 0..1, 环向 0..1)
 */

export { PALM_TRUNK };

/** 基准树干中心线 (lean = 1, height = 1; 每棵树的倾斜 / 高度倍率在顶点着色器里按 aLeaf.x 再变形)。 */
export function trunkCenter(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(PALM_TRUNK.lean * trunkLeanProfile(t), PALM_TRUNK.height * t, 0);
}

/** 叶冠挂点 = 基准树干顶端 (局部坐标)。 */
export function trunkTop(): THREE.Vector3 {
  return trunkCenter(1);
}

/** 树干顶端平滑放粗的比例 (冠部: 顶端半径 = r1 × (1 + 此值), 从 t = 0.88 开始过渡), 冠部不另接一个大鼓包。 */
export const TRUNK_CROWN_FLARE = 0.2;
/** 冠顶圆顶的剖面 (沿树干顶端轴向的高度 m, 半径 / 顶端半径), 接在树干最后一环上, 收成圆润的顶。 */
const TRUNK_CAP: ReadonlyArray<readonly [number, number]> = [[0.035, 1.03], [0.075, 0.92], [0.11, 0.66], [0.13, 0.34], [0.14, 0]];

/**
 * 树干: 10 边形 × 24 节的平滑管 (节点向根部加密), 粗细从根部向顶部平滑收窄, 根部微微外扩入沙;
 * 顶端最后一段平滑放粗约 1.3 倍成冠部, 再接 5 环收成圆润的冠顶 (aLeaf.x > 1), 与树干是同一张连续的面 (没有接缝)。
 * 表面的柔和明暗 / 细环纹 / 冠部的橄榄色过渡在片元着色器里按 aLeaf (高度 0..1(+冠顶), 环向 0..1) 画, 几何本身没有分节。
 */
export function buildPalmTrunk(radial = 10, rings = 24): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const leaf: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ss = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const radius = (t: number) => THREE.MathUtils.lerp(PALM_TRUNK.r0, PALM_TRUNK.r1, Math.pow(t, 0.75)) * (1 + 0.45 * Math.pow(1 - t, 9)) * (1 + TRUNK_CROWN_FLARE * ss(0.88, 1, t));
  for (let j = 0; j <= rings; j++) {
    const t = Math.pow(j / rings, 1.2);
    trunkCenter(t, c);
    if (j === rings) { trunkCenter(t - 0.01, c2); tan.subVectors(c, c2).normalize(); } else { trunkCenter(Math.min(1, t + 0.01), c2); tan.subVectors(c2, c).normalize(); }
    side.crossVectors(tan, new THREE.Vector3(0, 0, 1)).normalize();
    fwd.crossVectors(side, tan).normalize();
    const r = radius(t);
    const dr = (radius(Math.min(1, t + 0.01)) - radius(Math.max(0, t - 0.01))) / (0.02 * PALM_TRUNK.height);
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      n.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a));
      pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
      const nn = n.clone().addScaledVector(tan, -dr).normalize();
      nrm.push(nn.x, nn.y, nn.z);
      leaf.push(t, i / radial);
      part.push(0);
    }
  }
  // 冠顶圆顶: 沿顶端切线方向再接几环, 半径收到 0 (法线由剖面坡度算, 越往上越朝上)
  const rTop = radius(1);
  TRUNK_CAP.forEach(([h, k], ci) => {
    const [hp, kp] = ci === 0 ? [0, 1] : TRUNK_CAP[ci - 1];
    const [hn, kn] = TRUNK_CAP[Math.min(TRUNK_CAP.length - 1, ci + 1)];
    const dH = hn - hp, dR = (kn - kp) * rTop;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      n.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a));
      pos.push(c.x + tan.x * h + n.x * k * rTop, c.y + tan.y * h + n.y * k * rTop, c.z + tan.z * h + n.z * k * rTop);
      const nn = n.clone().multiplyScalar(dH).addScaledVector(tan, -dR).normalize();
      nrm.push(nn.x, nn.y, nn.z);
      leaf.push(1 + h, i / radial);
      part.push(0);
    }
  });
  const row = radial + 1;
  for (let j = 0; j < rings + TRUNK_CAP.length; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * row + i, b = a + 1, d = a + row, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** 只保留 position (uv / normal 在接缝处不同, 会让 mergeVertices 合不上 → 平滑法线出缝)。 */
function stripToPosition(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 叶冠造型参数 (对应 APP_CONFIG.beach3dScene.vegetation 里的 frondRiseDeg / frondTierSpreadDeg / frondDroop / frondStiffness / frondFoldDeg)。 */
export interface FrondShape {
  /** 中层叶叶柄的起始仰角 (°)。 */
  riseDeg: number;
  /** 冠顶嫩叶 / 最下层老叶相对中层的仰角差 (°): 冠顶 = rise + spread, 最下层 = rise − spread。 */
  tierSpreadDeg: number;
  /** 叶轴过了硬挺段之后的下弯量倍率 (1 = 冠顶叶尖仍上扬、中层叶尖斜向下、老叶下垂)。 */
  droop: number;
  /** 叶轴从叶柄起保持笔直上扬的比例 (0 ~ 0.7)。 */
  stiffness: number;
  /** V 形折叠: 两侧小叶相对水平面向下折的角度 (°, 叶尖处再深一点)。 */
  foldDeg: number;
}
export const DEFAULT_FROND_SHAPE: FrondShape = { riseDeg: 36, tierSpreadDeg: 34, droop: 1, stiffness: 0.35, foldDeg: 24 };

/**
 * 棕榈叶冠 (原点 = 树干顶端, +Y = 树干顶端的轴向): 两圈冠顶叶鞘 + fronds 片羽状大叶 + 4 个椰子槽位, 按椰子树的真实形态排布:
 *   - 分层: 每片叶有个"叶龄" tier (0 = 冠顶嫩叶, 1 = 最下层老叶), 叶柄起始仰角从冠顶的 rise + spread 递减到最下层的 rise − spread,
 *     下弯量随叶龄增大 → 冠顶叶斜向上伸出、中层叶拱起后斜向下、只有老叶下垂; 整体是向四周放射的"喷泉 / 星芒"轮廓;
 *   - 每片叶的叶轴: 前 stiffness 段笔直上扬 (硬挺的叶柄), 之后才逐渐弯下 (下弯集中在后半段 → 拱形, 不是从冠顶直接垂下的拖把);
 *   - 横截面是倒 V 形 (叶轴在中间最高, 两侧小叶向下折 foldDeg, 叶尖处略深), 小叶仍向两侧张开成羽毛状, 不竖直下垂;
 *   - 长度 / 宽度 / 下弯 / 方位 / 侧弯 / 扭转每片都有随机差异; 方位按黄金角排布, 层与方位交错, 没有规则的环。
 * 每片叶 = 一条沿叶轴的带子 (贴手绘羽叶贴图, 透明处丢弃), aLeaf = (u: 叶柄 → 叶尖 0..1, v: 横向 0..1, 叶轴 v = 0.5) = 贴图坐标;
 * aPart: 1 叶片, 2 椰子, 3 冠顶叶鞘 (aLeaf.y = 0) / 叶柄 (aLeaf.y = 1)。法线朝上偏 (卡通柔和明暗)。每片叶 12 节 × 2 条 = 48 三角 + 叶柄 (2 节三棱管) 12 三角; 冠顶叶鞘 13 片 × 16 三角。
 */
export function buildPalmCrown(fronds = 14, widthScale = 1, shape: Partial<FrondShape> = {}): THREE.BufferGeometry {
  const F = Math.max(6, Math.min(18, Math.round(fronds)));
  const WS = Math.max(0.6, Math.min(1.5, widthScale));
  const sh = { ...DEFAULT_FROND_SHAPE, ...shape };
  const D = Math.PI / 180;
  const rise = Math.max(0, Math.min(75, sh.riseDeg)) * D;
  const spread = Math.max(0, Math.min(45, sh.tierSpreadDeg)) * D;
  const droopK = Math.max(0, Math.min(2, sh.droop));
  const stiff = Math.max(0, Math.min(0.7, sh.stiffness));
  const fold0 = Math.max(0, Math.min(60, sh.foldDeg)) * D;
  const rnd = mulberry32(0x9a1e);
  const pos: number[] = [];
  const nrm: number[] = [];
  const leaf: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const RS = 12; // 叶轴节数
  const up = new THREE.Vector3(0, 1, 0);
  const vtx = (p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, pa: number) => {
    pos.push(p.x, p.y, p.z);
    nrm.push(n.x, n.y, n.z);
    leaf.push(u, v);
    part.push(pa);
    return pos.length / 3 - 1;
  };
  const T = new THREE.Vector3();
  const S = new THREE.Vector3();
  const N = new THREE.Vector3();
  const e = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let f = 0; f < F; f++) {
    const tier = Math.max(0, Math.min(1, (f + 0.5) / F + (rnd() - 0.5) * 0.5 / F)); // 叶龄: 0 冠顶嫩叶 → 1 最下层老叶
    const az = f * 2.39996 + (rnd() - 0.5) * 0.4;                                     // 黄金角 + 抖动
    const el0 = rise + spread * (1 - 2 * tier) + (rnd() - 0.5) * 0.12;                // 叶柄起始仰角
    const droop = droopK * (0.85 + 0.85 * tier) * (0.85 + rnd() * 0.3);               // 硬挺段之后的总下弯 (rad)
    const len = (1.25 + 0.85 * Math.min(1, tier * 1.5)) * (0.88 + rnd() * 0.24);      // 嫩叶短, 中 / 下层叶长
    const W = len * 0.33 * WS * (0.8 + 0.2 * Math.min(1, tier * 2));                  // 带子全宽 (贴图 1024×320 的比例)
    const curl = (rnd() - 0.5) * 0.3;                                                 // 叶轴在水平面内轻微侧弯
    const twist = (rnd() - 0.5) * 0.5;                                                // 沿叶长的扭转 (rad, 叶尖处)
    // 叶柄从冠顶叶鞘包里长出: 起点离冠顶中心 < 0.07m (单测检查), 被叶鞘包包住, 任何角度都看不到缝
    const p = new THREE.Vector3(Math.cos(az) * 0.05, 0.02 + 0.04 * (1 - tier), Math.sin(az) * 0.05);
    const stalk: { p: THREE.Vector3; s: THREE.Vector3 }[] = [];
    const base = pos.length / 3;
    for (let k = 0; k <= RS; k++) {
      const s = k / RS;
      const b = Math.max(0, (s - stiff) / (1 - stiff));
      const el = el0 - droop * Math.pow(b, 1.6);
      const a = az + curl * s;
      const h = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      T.copy(h).multiplyScalar(Math.cos(el)).addScaledVector(up, Math.sin(el)).normalize();
      if (k > 0) p.addScaledVector(T, len / RS);
      // 横向 S (水平, 垂直于叶轴) 与叶面"上"方向 N, 再绕叶轴扭转
      S.set(-Math.sin(a), 0, Math.cos(a));
      N.crossVectors(S, T).normalize();
      if (N.y < 0) N.negate();
      const tw = twist * s;
      const cs = Math.cos(tw), sn = Math.sin(tw);
      const S2 = S.clone().multiplyScalar(cs).addScaledVector(N, sn);
      const N2 = N.clone().multiplyScalar(cs).addScaledVector(S, -sn);
      if (s <= 0.34 && k % 2 === 0) stalk.push({ p: p.clone(), s: S2.clone() });
      // 倒 V 形折叠: 两侧小叶向下折 fold (叶尖处略深), 但仍向两侧张开
      const fold = fold0 * (0.8 + 0.5 * s);
      const half = (W / 2) * (0.92 + 0.08 * Math.sin(Math.PI * s));
      for (const sg of [-1, 0, 1]) {
        if (sg === 0) {
          n.copy(N2).addScaledVector(up, 0.5).normalize();
          vtx(p, n, s, 0.5, 1);
        } else {
          e.copy(S2).multiplyScalar(sg * Math.cos(fold)).addScaledVector(N2, -Math.sin(fold));
          const q = p.clone().addScaledVector(e, half);
          n.copy(N2).multiplyScalar(Math.cos(fold)).addScaledVector(S2, sg * Math.sin(fold)).addScaledVector(up, 0.5).normalize();
          vtx(q, n, s, sg < 0 ? 0 : 1, 1);
        }
      }
    }
    for (let k = 0; k < RS; k++) {
      const r0 = base + k * 3, r1 = r0 + 3;
      idx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
      idx.push(r0 + 1, r1 + 1, r0 + 2, r0 + 2, r1 + 1, r1 + 2);
    }
    // 叶柄: 沿叶轴前 1/3 的一根细的三棱管 (从冠顶里面长出, 越往外越细), 从侧面 / 下面看也是一根连到冠顶的实心叶柄
    const sb = pos.length / 3;
    stalk.forEach(({ p: sp, s: ss }, k) => {
      const t = k / Math.max(1, stalk.length - 1);
      const hw = 0.019 * (1 - t) + 0.006;
      const nv = new THREE.Vector3().crossVectors(ss, up).normalize();
      const fin = new THREE.Vector3().crossVectors(nv, ss).normalize(); // 竖直方向 (叶面法线一侧)
      if (fin.y < 0) fin.negate();
      for (let j = 0; j < 3; j++) {
        const th = (j / 3) * Math.PI * 2;
        const d = fin.clone().multiplyScalar(Math.cos(th)).addScaledVector(ss, Math.sin(th));
        vtx(sp.clone().addScaledVector(d, hw).addScaledVector(fin, -hw * 0.5), d, t, 1, 3);
      }
    });
    for (let k = 0; k + 1 < stalk.length; k++) {
      for (let j = 0; j < 3; j++) {
        const a = sb + k * 3 + j, b = sb + k * 3 + ((j + 1) % 3);
        idx.push(a, a + 3, b, b, a + 3, b + 3);
      }
    }
  }
  // 冠顶叶鞘: 两圈小的、彼此交叠的尖瓣形叶鞘包住树干顶端的冠部 (像收拢的花苞), 叶柄从冠顶中间长出。
  // 每片 = 贴着冠部圆柱面弯曲的叶形瓣 (根部窄、中段最宽、叶尖收尖、中段微鼓、中脊略高), 外圈 7 片根部收窄、贴着树干放粗段的表面 (没有台阶 / 横向接缝), 往上外翻, 内圈 6 片错开半格贴着冠顶往里收。
  {
    const shRnd = mulberry32(0x5eed);
    const layers = [
      { n: 7, y0: -0.17, y1: 0.05, r0: 0.112, r1: 0.136, w: 0.13, off: 0 },
      { n: 6, y0: -0.07, y1: 0.13, r0: 0.117, r1: 0.08, w: 0.115, off: 0.5 },
    ];
    const SEG = 4;
    for (const ly of layers) for (let i = 0; i < ly.n; i++) {
      const az = ((i + ly.off) / ly.n) * Math.PI * 2 + (shRnd() - 0.5) * 0.3;
      const lk = 0.9 + shRnd() * 0.2;
      const bb = pos.length / 3;
      for (let k = 0; k <= SEG; k++) {
        const sv = k / SEG;
        const y = ly.y0 + (ly.y1 - ly.y0) * sv * lk;
        const r = ly.r0 + (ly.r1 - ly.r0) * sv + 0.008 * Math.sin(Math.PI * sv);
        const hw = (ly.w / 2) * Math.pow(Math.sin(Math.PI * (0.05 + 0.95 * sv)), 0.75) + 0.003; // 叶形: 根部窄 → 中段最宽 → 叶尖收尖
        const dR = (ly.r1 - ly.r0) + 0.008 * Math.PI * Math.cos(Math.PI * sv), dY = (ly.y1 - ly.y0) * lk;
        for (const sg of [-1, 0, 1]) {
          const aa = az + (sg * hw) / r;
          const radial = new THREE.Vector3(Math.cos(aa), 0, Math.sin(aa));
          const pp = radial.clone().multiplyScalar(r + (sg === 0 ? 0.006 : 0)).setY(y);
          const nn = radial.clone().multiplyScalar(dY).add(new THREE.Vector3(0, -dR, 0)).normalize();
          vtx(pp, nn, sv, sg === 0 ? 0 : 0.3, 3); // aLeaf.y: 中脊 0 → 叶缘 0.3 (着色时叶缘略深, 交叠处有层次)
        }
      }
      for (let k = 0; k < SEG; k++) {
        const r0 = bb + k * 3, r1 = r0 + 3;
        idx.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1, r0 + 1, r1 + 1, r0 + 2, r0 + 2, r1 + 1, r1 + 2);
      }
    }
  }
  // 椰子: 4 个槽位, 紧凑地挤在冠部叶鞘下沿的同一侧 (顶部被叶鞘挡住一点) (叶冠每棵树自转不同 → 每棵树朝向不同), 刚好挂在叶柄根部下方;
  // 略呈蛋形 (沿"向外下垂"的轴拉长), 每颗的倾斜带一点确定性随机, 相邻的稍有重叠。2 级细分二十面体 (每颗 180 三角), 平滑法线。
  // 每棵树画几颗 / 每颗大小在顶点着色器里按树的种子决定 (aNut = 中心 + 槽位序号); aLeaf.x = 槽位 (着色时冷暖略有差别)
  const ico = mergeVertices(stripToPosition(new THREE.IcosahedronGeometry(1, 2)));
  const ip = ico.getAttribute('position');
  const ii = ico.getIndex()!;
  const nutRnd = mulberry32(0xc0c0);
  // [方位 (°, 叶冠局部, 0 = +X), 中心高度 y, 离轴距离, 半径]: 槽位 0 ~ 2 一排, 3 在下面塞进 0 / 1 之间
  const nuts: Array<[number, number, number, number]> = [
    [0, -0.07, 0.128, 0.076],
    [50, -0.085, 0.124, 0.073],
    [-47, -0.095, 0.124, 0.074],
    [22, -0.17, 0.118, 0.07],
  ];
  const nutStart = pos.length / 3;
  const nutCenters: number[] = [];
  nuts.forEach(([azDeg, oy, d, r], c) => {
    const az = azDeg * D;
    const ctr = new THREE.Vector3(Math.cos(az) * d, oy, Math.sin(az) * d);
    const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    // 长轴: 向外下垂 + 一点随机倾斜
    const ax = new THREE.Vector3(0, -1, 0).addScaledVector(out, 0.35 + (nutRnd() - 0.5) * 0.3)
      .add(new THREE.Vector3(-out.z, 0, out.x).multiplyScalar((nutRnd() - 0.5) * 0.4)).normalize();
    const u1 = new THREE.Vector3().crossVectors(ax, out).normalize();
    const v1 = new THREE.Vector3().crossVectors(u1, ax).normalize();
    const LA = 1.18, LB = 0.95; // 长轴 / 短轴比例
    const base = pos.length / 3;
    for (let i = 0; i < ip.count; i++) {
      const sp = new THREE.Vector3(ip.getX(i), ip.getY(i), ip.getZ(i)).normalize();
      const su = sp.dot(u1), sa = sp.dot(ax), sv = sp.dot(v1);
      const q = ctr.clone().addScaledVector(u1, su * r * LB).addScaledVector(ax, sa * r * LA).addScaledVector(v1, sv * r * LB);
      const nn = new THREE.Vector3().addScaledVector(u1, su / LB).addScaledVector(ax, sa / LA).addScaledVector(v1, sv / LB).normalize();
      vtx(q, nn, (c + 0.5) / nuts.length, 0, 2);
      nutCenters.push(ctr.x, ctr.y, ctr.z, c);
    }
    for (let i = 0; i < ii.count; i++) idx.push(base + ii.getX(i));
  });
  ico.dispose();
  const nutAttr = new Float32Array((pos.length / 3) * 4);
  nutAttr.set(nutCenters, nutStart * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aNut', new THREE.Float32BufferAttribute(nutAttr, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** 远岛条带的半径 (m, 远景层; 须小于相机远裁剪面 100m)。 */
export const ISLAND_RADIUS = 80;

/**
 * 远岛条带: 方位 −95° ~ 95°、仰角 −0.6° ~ maxDeg 的一圈竖直条带 (每 1° 一段, 约 380 三角), 只负责覆盖像素;
 * 岛屿剪影 / 明暗 / 雾全在片元着色器里按每个像素的方位角与仰角解析求值 (任何分辨率下轮廓都是清晰的曲线, 没有多边形折角)。
 * 顶点带 aAz (方位角 °)。
 */
export function buildIslandStrip(maxDeg: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const aAz: number[] = [];
  const idx: number[] = [];
  const R = ISLAND_RADIUS;
  const y0 = -Math.tan(THREE.MathUtils.degToRad(0.6)) * R;
  const y1 = Math.tan(THREE.MathUtils.degToRad(Math.max(1, maxDeg))) * R;
  const n = 190;
  for (let i = 0; i <= n; i++) {
    const az = -95 + i;
    const a = THREE.MathUtils.degToRad(az);
    const x = Math.sin(a) * R, z = -Math.cos(a) * R;
    pos.push(x, y0, z, x, y1, z);
    aAz.push(az, az);
    if (i > 0) {
      const b = i * 2, p = b - 2;
      idx.push(p, b, p + 1, p + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAz', new THREE.Float32BufferAttribute(aAz, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * 圆润的卡通礁石: 细分二十面体 (合并顶点 → 平滑法线) + 低频起伏 (几个方向的正弦叠加, 不会裂缝) + 底部压平。
 * detail: 0 → 80 三角, 1 → 320 三角 (默认), 2 → 1280 三角。
 */
export function buildRock(detail = 1): THREE.BufferGeometry {
  const d = [1, 3, 7][Math.max(0, Math.min(2, Math.round(detail)))];
  const g = mergeVertices(stripToPosition(new THREE.IcosahedronGeometry(1, d)));
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const bump = 0.1 * Math.sin(v.x * 2.3 + v.z * 1.7 + 0.4) + 0.07 * Math.sin(v.y * 3.1 - v.x * 2.2 + 1.3) + 0.05 * Math.sin(v.z * 4.3 + v.y * 2.7);
    v.multiplyScalar(1 + bump);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.06;
    v.y += 0.27;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function triangleCount(g: THREE.BufferGeometry): number {
  const index = g.getIndex();
  return Math.floor((index ? index.count : g.getAttribute('position').count) / 3);
}

/** 扇贝的放射肋条数。 */
export const SCALLOP_RIBS = 15;

/**
 * 扇贝 (单位尺寸: 壳宽约 1, 底面贴 y = 0, 铰合部在 −Z, 壳缘朝 +Z): 凸面朝上平放在沙上的一片扇贝壳。
 *   - 扇形壳面: 张角约 ±64°, 两肩收圆; 壳顶微微隆起 (中间高、壳缘和铰合部低);
 *   - 放射肋条: SCALLOP_RIBS 道凸起的肋 (几何上真的起伏), 壳缘随肋条起伏成波浪形的"扇贝边";
 *   - 铰合部两侧一对小"耳朵" (一大一小的扁平三角翼, 微微翘起)。
 * 顶点带 aUV (u: 横向 0..1 跨过整个扇面 / 耳朵 u < 0 或 > 1, v: 铰合部 → 壳缘 0..1), 着色器据此画肋沟 / 生长纹。约 560 三角。
 */
export function buildScallop(): THREE.BufferGeometry {
  const NU = SCALLOP_RIBS * 3, NV = 6;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const HZ = -0.42;      // 铰合部 z
  const R = 0.88;        // 壳缘半径 (从铰合部量)
  const OPEN = 1.12;     // 半张角 (rad)
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = i / NU, v = Math.pow(j / NV, 0.85);
    const th = (u - 0.5) * 2 * OPEN;
    const rib = 0.5 + 0.5 * Math.cos(u * SCALLOP_RIBS * Math.PI * 2);           // 1 = 肋条脊, 0 = 肋沟
    const edge = R * (1 - 0.1 * th * th) * (1 + 0.035 * rib * v * v);           // 壳缘: 收圆的两肩 + 肋条端头的波浪边
    const rr = 0.05 + v * (edge - 0.05);
    const dome = 0.3 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + v * 0.95)), 0.75) * (1 - 0.35 * Math.pow(Math.abs(th) / OPEN, 2));
    const y = 0.012 + dome + 0.03 * rib * Math.sin(Math.PI * Math.min(1, v * 1.1));
    pos.push(Math.sin(th) * rr, y, HZ + Math.cos(th) * rr);
    uv.push(u, j / NV);
  }
  const row = NU + 1;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * row + i;
    idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
  }
  // 两只耳朵: 铰合部两侧的扁平三角翼 (左大右小), 外缘略翘
  for (const [sx, w] of [[-1, 0.27], [1, 0.22]] as const) {
    const b = pos.length / 3;
    const pts: Array<[number, number, number, number, number]> = [
      [0, 0.05, HZ + 0.02, 0.5, 0],
      [sx * 0.05, 0.05, HZ + 0.17, 0.5, 0.15],
      [sx * w, 0.035, HZ - 0.005, sx < 0 ? -0.15 : 1.15, 0.05],
      [sx * (w - 0.03), 0.04, HZ + 0.1, sx < 0 ? -0.12 : 1.12, 0.12],
    ];
    for (const [x, y, z, u, v] of pts) { pos.push(x, y, z); uv.push(u, v); }
    idx.push(b, b + 2, b + 3, b, b + 3, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** 沙滩椅 / 遮阳伞 / 灯塔 / 沙堡的材质分区 (顶点属性 aMat)。 */
export const PROP_MAT = { frame: 0, cushion: 1, pole: 2, canopy: 3, pillow: 4, lighthouse: 5, sandcastle: 6 } as const;

/**
 * 躺椅框架尺寸 (椅子局部坐标, m): 两根侧梁 (截面 宽 railW × 高 railH, 中心高 railY) 从脚端 z0 到头端 z1;
 * 4 条腿在 legZ 处直落沙地; 靠背铰接在侧梁顶面 hingeZ 处, 与水平面成 backAngle, 长 backLen;
 * 撑杆从侧梁内侧 propZ 处 (正好在头端腿的上方) 撑到靠背侧梁的 propS 处。
 */
const FRAME = {
  railY: 0.3, railH: 0.055, railW: 0.05, z0: -0.95, z1: 0.65,
  legZ: [-0.87, 0.57] as const, legW: 0.045, legSink: 0.03,
  hingeZ: 0.15, backAngle: 0.95, backLen: 0.8, backT: 0.045,
  propZ: 0.57, propS: 0.45, propT: 0.03,
  cushionT: 0.07, cushionW: 0.62,
} as const;
const RAIL_TOP = FRAME.railY + FRAME.railH / 2;
/** 靠背侧梁中心线在铰点处的高度 (侧梁底角略嵌进座梁, 看起来是铰在一起的)。 */
const HINGE_Y = RAIL_TOP + 0.02;

/** 遮阳伞伞面: 伞骨长 (= 半径 PARASOL.radius)、伞顶到伞骨末端的落差 rise、伞骨之间布面的下垂 sag、边缘内凹的扇贝 scallop、下摆高 hem。 */
const CANOPY = { rise: 0.24, sag: 0.05, scallop: 0.025, hem: 0.022, panels: 8, sub: 6, rings: 6 } as const;

/** 一个部件; seg = 方截面细杆的两端中心点与截面边长 (单测用来检查杆端是否藏在相接的梁里)。 */
export interface PropPart { name: string; geo: THREE.BufferGeometry; seg?: { a: THREE.Vector3; b: THREE.Vector3; t: number } }

/**
 * 沙滩躺椅 + 遮阳伞的各个部件 (椅子局部坐标: 原点 = 椅子中心地面, 头端 / 靠背在 +Z, 脚端在 −Z)。
 * 躺椅: 两根侧梁 + 脚端 / 头端横档 + 4 条插进沙里的腿; 靠背侧梁与座梁同一 x、铰在座梁顶面 (外侧有铰钉),
 *   由两根与梁同平面的撑杆撑住 (下端插在头端腿正上方的座梁里, 上端插在靠背侧梁里); 坐垫平放在座梁上, 靠垫贴在靠背侧梁上, 小枕头贴在靠垫上。没有扶手。
 * 遮阳伞: 插进沙里的细杆一直通到伞顶; 8 片布面在伞骨之间微微下垂, 边缘是伞骨之间的直边 + 很浅的内凹, 外加一圈很窄的下摆;
 *   伞面下有 8 根细伞骨 + 伞杆上的伞巢和 8 根撑骨; 伞顶一个小帽 + 顶珠。
 * 单测检查: 每个物体 (椅子 / 伞) 的所有部件彼此相连, 且都连到插进沙里的腿 / 伞杆上 (没有悬空零件)。
 */
export function buildBeachPropParts(): PropPart[] {
  const parts: PropPart[] = [];
  const add = (name: string, g: THREE.BufferGeometry, mat: number, m: THREE.Matrix4, seg?: PropPart['seg']) => {
    const gg = g.index ? g.toNonIndexed() : g;
    if (gg !== g) g.dispose();
    gg.applyMatrix4(m);
    const n = gg.getAttribute('position').count;
    const uv = gg.getAttribute('uv');
    const auv = new Float32Array(n * 2);
    if (uv) for (let i = 0; i < n; i++) { auv[i * 2] = uv.getX(i); auv[i * 2 + 1] = uv.getY(i); }
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k);
    if (!gg.getAttribute('normal')) gg.computeVertexNormals();
    gg.setAttribute('aUV', new THREE.BufferAttribute(auv, 2));
    gg.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
    parts.push({ name, geo: gg, seg });
  };
  const ONE = new THREE.Vector3(1, 1, 1);
  const M = (x: number, y: number, z: number, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), ONE);
  /** 从 a 到 b 的方截面细杆 (厚 t), 可再套一层父矩阵 parent。 */
  const bar = (name: string, a: THREE.Vector3, b: THREE.Vector3, t: number, mat: number, parent?: THREE.Matrix4) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, ONE);
    add(name, new THREE.BoxGeometry(t, t, d.length()), mat, parent ? parent.clone().multiply(m) : m, parent ? undefined : { a: a.clone(), b: b.clone(), t });
  };
  const F = FRAME;
  const hw = CHAIR.width / 2 - 0.03; // 侧梁中心的 |x|
  const railBot = F.railY - F.railH / 2;

  // ── 躺椅框架 ──
  for (const sx of [-1, 1]) {
    add(`chair:rail${sx}`, new THREE.BoxGeometry(F.railW, F.railH, F.z1 - F.z0), PROP_MAT.frame, M(sx * hw, F.railY, (F.z0 + F.z1) / 2));
    for (const z of F.legZ) {
      const h = railBot + 0.01 + F.legSink; // 上端插进侧梁 1cm, 下端埋进沙里
      add(`chair:leg${sx}:${z}`, new THREE.BoxGeometry(F.legW, h, F.legW), PROP_MAT.frame, M(sx * hw, railBot + 0.01 - h / 2, z));
    }
  }
  // 横档: 夹在两根侧梁内侧面之间 (端面不与侧梁共面)
  const inner = 2 * hw - F.railW;
  add('chair:footBar', new THREE.BoxGeometry(inner, 0.045, 0.045), PROP_MAT.frame, M(0, F.railY, F.z0 + 0.025));
  add('chair:headBar', new THREE.BoxGeometry(inner, 0.045, 0.045), PROP_MAT.frame, M(0, F.railY, F.z1 - 0.025));
  // 坐垫: 平放在座梁顶面, 从脚端一直铺到靠背铰点前
  const seatZ0 = F.z0 + 0.02, seatZ1 = F.hingeZ - 0.045;
  add('chair:seat', new RoundedBoxGeometry(F.cushionW, F.cushionT, seatZ1 - seatZ0, 2, 0.03), PROP_MAT.cushion, M(0, RAIL_TOP + F.cushionT / 2, (seatZ0 + seatZ1) / 2));

  // ── 靠背: 沿 bdir 从铰点升起, bnrm = 靠背正面 (朝上偏脚端) ──
  const bdir = new THREE.Vector3(0, Math.sin(F.backAngle), Math.cos(F.backAngle));
  const bnrm = new THREE.Vector3(0, Math.cos(F.backAngle), -Math.sin(F.backAngle));
  const along = (s: number, off = 0, x = 0) => new THREE.Vector3(x, HINGE_Y, F.hingeZ).addScaledVector(bdir, s).addScaledVector(bnrm, off);
  for (const sx of [-1, 1]) {
    bar(`chair:backRail${sx}`, along(-0.03, 0, sx * hw), along(F.backLen, 0, sx * hw), F.backT, PROP_MAT.frame);
    // 铰钉: 横穿座梁与靠背侧梁的外侧面
    add(`chair:hinge${sx}`, new THREE.CylinderGeometry(0.016, 0.016, 0.022, 8), PROP_MAT.frame,
      new THREE.Matrix4().compose(new THREE.Vector3(sx * (hw + 0.03), RAIL_TOP - 0.004, F.hingeZ), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), ONE));
    // 撑杆: 与座梁 / 靠背侧梁在同一竖直面内 (同一 x, 比梁细), 下端插进头端腿正上方的座梁中心, 上端插进靠背侧梁中心;
    //   杆截面的半对角线 (≈ 0.021m) 小于两根梁的半厚, 两端端面完全藏在梁里, 不会从框架侧面或底下露出杆头
    bar(`chair:prop${sx}`, new THREE.Vector3(sx * hw, F.railY, F.propZ), along(F.propS, 0, sx * hw), F.propT, PROP_MAT.frame);
  }
  const topS = F.backLen - F.backT / 2;
  bar('chair:backTopBar', along(topS, 0, -hw + F.backT / 2), along(topS, 0, hw - F.backT / 2), 0.04, PROP_MAT.frame);
  // 靠垫: 底面贴在靠背侧梁的正面上
  const bLen = F.backLen - 0.04;
  const bc = along(0.02 + bLen / 2, F.backT / 2 + F.cushionT / 2);
  add('chair:backCushion', new RoundedBoxGeometry(F.cushionW, F.cushionT, bLen, 2, 0.03), PROP_MAT.cushion, M(bc.x, bc.y, bc.z, -F.backAngle));
  // 小枕头: 贴在靠垫上部
  const pc = along(F.backLen * 0.7, F.backT / 2 + F.cushionT + 0.045 - 0.004);
  add('chair:pillow', new RoundedBoxGeometry(0.4, 0.09, 0.2, 2, 0.04), PROP_MAT.pillow, M(pc.x, pc.y, pc.z, -F.backAngle));

  // ── 遮阳伞 ──
  const base = new THREE.Vector3(PARASOL.lx, 0, PARASOL.lz);
  const axis = new THREE.Vector3(-Math.sin(PARASOL.tilt), Math.cos(PARASOL.tilt), 0);
  const apex = base.clone().addScaledVector(axis, PARASOL.height);
  const qa = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const Mc = new THREE.Matrix4().compose(apex, qa, ONE); // 伞面局部: 原点 = 伞顶, +Y = 伞杆方向
  const local = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z).premultiply(Mc);
  // 伞杆: 下端埋进沙里 0.2m, 上端止于伞顶帽下
  const poleLen = PARASOL.height + 0.2 - 0.01;
  add('parasol:pole', new THREE.CylinderGeometry(0.018, 0.022, poleLen, 8, 1, true), PROP_MAT.pole, local(0, -0.01 - poleLen / 2, 0));
  // 伞面
  const R = PARASOL.radius;
  const { rise, sag, scallop, hem, panels: P, sub: SUB, rings: RINGS } = CANOPY;
  const NU = P * SUB;
  const ribY = (t: number) => -rise * Math.pow(t, 1.6);
  const edgeR = (fp: number) => R * (Math.cos(Math.PI / P) / Math.cos((fp - 0.5) * (2 * Math.PI / P))) * (1 - scallop * Math.sin(Math.PI * fp));
  const cp: number[] = [];
  const cuv: number[] = [];
  const cidx: number[] = [];
  for (let k = 0; k <= RINGS + 1; k++) for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    const fp = (i % SUB) / SUB;
    const a = u * Math.PI * 2;
    const re = edgeR(fp);
    const isHem = k === RINGS + 1;
    const rr = isHem ? re * 1.004 : (k / RINGS) * re;
    const t = Math.min(rr / R, 1);
    let y = ribY(t) - sag * Math.sin(Math.PI * fp) * t;
    if (isHem) y -= hem;
    cp.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
    cuv.push(u * P, Math.min(k / RINGS, 1)); // aUV.x = 第几片 (整数部分), aUV.y = 中心 → 边缘
  }
  for (let k = 0; k <= RINGS; k++) for (let i = 0; i < NU; i++) {
    const a = k * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    cidx.push(a, b, d, a, d, c);
  }
  const canopy = new THREE.BufferGeometry();
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  canopy.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
  canopy.setIndex(cidx);
  canopy.computeVertexNormals();
  add('parasol:canopy', canopy, PROP_MAT.canopy, Mc);
  // 伞骨 (贴在布面下 1.4cm) + 伞巢 + 撑骨
  const runnerY = -0.36;
  add('parasol:runner', new THREE.CylinderGeometry(0.026, 0.026, 0.05, 8), PROP_MAT.pole, local(0, runnerY, 0));
  for (let k = 0; k < P; k++) {
    const a = (k / P) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const rib = (t: number) => new THREE.Vector3(ca * t * R, ribY(t) - 0.014, sa * t * R);
    bar(`parasol:rib${k}a`, rib(0.03), rib(0.5), 0.012, PROP_MAT.pole, Mc);
    bar(`parasol:rib${k}b`, rib(0.49), rib(0.985), 0.012, PROP_MAT.pole, Mc); // 末端藏在下摆后面
    bar(`parasol:stretcher${k}`, new THREE.Vector3(ca * 0.02, runnerY, sa * 0.02), rib(0.45), 0.009, PROP_MAT.pole, Mc);
  }
  // 伞顶帽 + 顶珠
  add('parasol:cap', new THREE.CylinderGeometry(0.014, 0.046, 0.026, 8), PROP_MAT.pole, local(0, 0.004, 0));
  add('parasol:finialNeck', new THREE.CylinderGeometry(0.009, 0.011, 0.04, 6, 1, true), PROP_MAT.pole, local(0, 0.035, 0));
  add('parasol:finial', new THREE.IcosahedronGeometry(0.024, 1), PROP_MAT.pole, local(0, 0.07, 0));
  return parts;
}

/**
 * 沙滩躺椅 + 遮阳伞合并成一个非索引几何 (1 次绘制), 顶点带 aMat (材质分区) 与 aUV (伞面分片用)。约 2k 三角。
 * 部件见 buildBeachPropParts()。
 */
export function buildBeachProps(): THREE.BufferGeometry {
  const parts = buildBeachPropParts();
  const out = mergeGeometries(parts.map((p) => p.geo));
  parts.forEach((p) => p.geo.dispose());
  out.computeBoundingSphere();
  return out;
}

/** 椅子几何参数 (地面着色器画椅子落影要用): 靠背铰点高 / 铰点 z / 与水平面夹角 / 长度; 坐垫顶高; 腿的 |x| 与 z。 */
export const CHAIR_BACK = {
  angle: FRAME.backAngle, pivotY: HINGE_Y, pivotZ: FRAME.hingeZ, length: FRAME.backLen,
  seatTop: RAIL_TOP + FRAME.cushionT, legX: CHAIR.width / 2 - 0.03, legZ: FRAME.legZ,
} as const;

/**
 * 海上小灯塔 (局部坐标: 原点 = 海面上的塔基中心, 单位 m, scale = 1 时总高约 5.2m; 门朝 +Z = 朝岸)。
 * 自下而上: 半没在水里的圆润礁石底座 → 奶白塔基 → 奶白 / 珊瑚粉相间的锥形塔身 (5 段, 正面一扇门两扇小窗)
 *   → 珊瑚粉观景平台 + 一圈细栏杆 → 透出暖光的灯室 → 薰衣草色圆锥顶 + 顶珠。
 * 非索引几何, 属性与 buildBeachProps() 一致 (position / normal / aUV / aMat), 可直接合并进同一次绘制;
 * aMat = PROP_MAT.lighthouse, aUV.x = 配色槽 (LIGHTHOUSE_SLOT)。约 900 三角。
 */
export const LIGHTHOUSE_SLOT = { body: 0, band: 1, roof: 2, glass: 3, rock: 4 } as const;
export interface LighthousePart { name: string; geo: THREE.BufferGeometry }
export function buildLighthouseParts(): LighthousePart[] {
  const parts: LighthousePart[] = [];
  const add = (name: string, g: THREE.BufferGeometry, slot: number, m: THREE.Matrix4) => {
    const gg = g.index ? g.toNonIndexed() : g;
    if (gg !== g) g.dispose();
    gg.applyMatrix4(m);
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k);
    if (!gg.getAttribute('normal')) gg.computeVertexNormals();
    const n = gg.getAttribute('position').count;
    const auv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) auv[i * 2] = slot;
    gg.setAttribute('aUV', new THREE.BufferAttribute(auv, 2));
    gg.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(PROP_MAT.lighthouse), 1));
    parts.push({ name, geo: gg });
  };
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const S = LIGHTHOUSE_SLOT;
  // 礁石底座: 2 级细分前的二十面体 (80 面) 随机推拉成不规则的圆石, 一半没在水里
  const rock = mergeVertices(stripToPosition(new THREE.IcosahedronGeometry(1, 1)));
  const rp = rock.getAttribute('position');
  const rnd = mulberry32(0x11ce);
  for (let i = 0; i < rp.count; i++) {
    const k = 0.85 + rnd() * 0.3;
    rp.setXYZ(i, rp.getX(i) * 1.5 * k, Math.min(rp.getY(i) * 0.75 * k, 0.68), rp.getZ(i) * 1.3 * k); // 顶部压平, 塔基稳稳坐在上面
  }
  rock.computeVertexNormals();
  add('lighthouse:rock', rock, S.rock, T(0, -0.25, 0));
  // 塔基
  add('lighthouse:plinth', new THREE.CylinderGeometry(0.78, 0.86, 0.3, 12), S.body, T(0, 0.45, 0));
  // 塔身: 下粗上细, 5 段奶白 / 珊瑚粉相间
  const y0 = 0.6, y1 = 3.85, r0 = 0.62, r1 = 0.44;
  const rAt = (y: number) => r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
  const bands = [0.26, 0.16, 0.2, 0.16, 0.22];
  let y = y0;
  bands.forEach((f, i) => {
    const h = f * (y1 - y0);
    add(`lighthouse:tower${i}`, new THREE.CylinderGeometry(rAt(y + h), rAt(y), h, 12, 1, true), i % 2 ? S.band : S.body, T(0, y + h / 2, 0));
    y += h;
  });
  // 门 + 两扇小窗 (朝岸, 略嵌进塔身)
  add('lighthouse:door', new THREE.BoxGeometry(0.28, 0.48, 0.08), S.band, T(0, y0 + 0.26, rAt(y0 + 0.26) - 0.02));
  for (const wy of [2.15, 3.25]) add(`lighthouse:window${wy}`, new THREE.BoxGeometry(0.13, 0.2, 0.06), S.glass, T(0, wy, rAt(wy) - 0.015));
  // 观景平台 + 栏杆
  add('lighthouse:deck', new THREE.CylinderGeometry(0.68, 0.6, 0.1, 12), S.band, T(0, y1 + 0.05, 0));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    add(`lighthouse:post${k}`, new THREE.BoxGeometry(0.03, 0.27, 0.03), S.body, T(Math.cos(a) * 0.62, y1 + 0.235, Math.sin(a) * 0.62));
  }
  add('lighthouse:rail', new THREE.TorusGeometry(0.62, 0.02, 4, 24), S.body, T(0, y1 + 0.37, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
  // 灯室: 底圈 + 透光玻璃 + 顶圈
  add('lighthouse:lanternBase', new THREE.CylinderGeometry(0.38, 0.38, 0.08, 12), S.roof, T(0, y1 + 0.14, 0));
  add('lighthouse:glass', new THREE.CylinderGeometry(0.33, 0.33, 0.48, 12, 1, true), S.glass, T(0, y1 + 0.42, 0));
  add('lighthouse:lanternTop', new THREE.CylinderGeometry(0.4, 0.38, 0.07, 12), S.roof, T(0, y1 + 0.69, 0));
  // 圆锥顶 + 顶珠
  add('lighthouse:roof', new THREE.CylinderGeometry(0.0, 0.47, 0.44, 12, 1, true), S.roof, T(0, y1 + 0.94, 0));
  add('lighthouse:spire', new THREE.CylinderGeometry(0.015, 0.02, 0.16, 6, 1, true), S.roof, T(0, y1 + 1.22, 0));
  add('lighthouse:finial', new THREE.IcosahedronGeometry(0.06, 1), S.roof, T(0, y1 + 1.32, 0));
  return parts;
}

/** 灯塔合并成一个几何 (再按摆放矩阵 m 变换), 属性与沙滩道具一致。 */
export function buildLighthouse(m?: THREE.Matrix4): THREE.BufferGeometry {
  const parts = buildLighthouseParts();
  const out = mergeGeometries(parts.map((p) => p.geo));
  parts.forEach((p) => p.geo.dispose());
  if (m) out.applyMatrix4(m);
  out.computeBoundingSphere();
  return out;
}

/**
 * 沙堡 (局部坐标: 原点 = 底台中心的地面, 单位 m, scale = 1 时最高的塔顶约 0.45m、旗尖约 0.52m; 城门朝 +Z)。
 * 二次元卡通造型, 像用小桶 / 小铲子压出来的湿沙堡:
 *   手拍压实的方形底台 (圆角、底宽顶窄、边缘有轻微的手拍起伏, 城门前一道小坡道) → 正中一座方形主堡 (顶上一圈城垛, 正面一扇拱门) → 四角四座高矮不同的塔:
 *   左后 / 左前 / 右后三座是上粗下细一点点的"小桶"圆塔, 顶部外沿一圈唇边 + 城垛 (缺口), 右后那座最高, 顶上插一面小三角旗;
 *   右前一座是尖顶的圆锥小塔 (锥形模具压出来的)。塔身上有小拱窗。
 * 非索引几何, 属性与 buildBeachProps() 一致 (position / normal / aUV / aMat), 合并进沙滩道具的同一次绘制;
 * aMat = PROP_MAT.sandcastle, aUV.x = 配色槽 (SANDCASTLE_SLOT)。约 1.4k 三角。
 * 地面上的落影与棕榈一起烘焙进落影遮罩 (见 beach3dWorld.ts)。
 */
export const SANDCASTLE_SLOT = { sand: 0, door: 1, flag: 2, pole: 3 } as const;
/** 沙堡底台的关键尺寸: 宽 (x) / 深 (z) / 顶面高 (m, scale = 1)。 */
export const SANDCASTLE_DIM = { baseW: 0.52, baseD: 0.44, baseTop: 0.07 } as const;
export interface SandcastlePart { name: string; geo: THREE.BufferGeometry }
export function buildSandcastleParts(): SandcastlePart[] {
  const parts: SandcastlePart[] = [];
  const add = (name: string, g: THREE.BufferGeometry, slot: number, m: THREE.Matrix4) => {
    const gg = g.index ? g.toNonIndexed() : g;
    if (gg !== g) g.dispose();
    gg.applyMatrix4(m);
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k);
    if (!gg.getAttribute('normal')) gg.computeVertexNormals();
    const n = gg.getAttribute('position').count;
    const auv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) auv[i * 2] = slot;
    gg.setAttribute('aUV', new THREE.BufferAttribute(auv, 2));
    gg.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(PROP_MAT.sandcastle), 1));
    parts.push({ name, geo: gg });
  };
  const S = SANDCASTLE_SLOT;
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const TR = (x: number, y: number, z: number, ry: number) => T(x, y, z).multiply(new THREE.Matrix4().makeRotationY(ry));
  const top = SANDCASTLE_DIM.baseTop;
  // ── 底台: 手拍压实的方形沙台 (圆角方块, 上面略收、四边微微外斜, 边缘有轻微的不规则起伏; 底边略埋进沙里) + 城门前的小坡道 ──
  {
    const BW = SANDCASTLE_DIM.baseW, BD = SANDCASTLE_DIM.baseD, BH = top + 0.012;
    const g = new RoundedBoxGeometry(BW, BH, BD, 2, 0.026);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    const mg = mergeVertices(g, 1e-5);
    g.dispose();
    const pos = mg.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const lo = 0.5 - y / BH;                                            // 0 顶面 → 1 底面
      const taper = 1 + 0.07 * lo;                                        // 拍出来的斜边: 底宽顶窄
      const wob = 0.008 * Math.sin(z * 31 + 0.7) + 0.006 * Math.sin(x * 23 + z * 9 + 2.1); // 手拍的小起伏
      const sx = Math.sign(x) * Math.min(1, Math.abs(x) / (BW / 2 - 0.02));
      const sz = Math.sign(z) * Math.min(1, Math.abs(z) / (BD / 2 - 0.02));
      const dy = y > BH / 2 - 0.004 ? 0.004 * Math.sin(x * 19 + 1.3) * Math.sin(z * 17) : 0; // 顶面不是完全平的
      pos.setXYZ(i, x * taper + sx * wob, y + BH / 2 - 0.012 + dy, z * taper + sz * wob);
    }
    mg.computeVertexNormals();
    add('castle:base', mg, S.sand, new THREE.Matrix4());
    // 城门前的小坡道 (从底台前沿斜下到沙地)
    const rampL = 0.12, ang = Math.atan2(top, 0.09);
    add('castle:ramp', new RoundedBoxGeometry(0.09, 0.03, rampL, 1, 0.01), S.sand,
      new THREE.Matrix4().compose(new THREE.Vector3(0, top / 2 - 0.006, BD / 2 + 0.035), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang), new THREE.Vector3(1, 1, 1)));
  }
  // ── 主堡: 圆角方块 + 顶上一圈城垛; 正面拱门 ──
  const KW = 0.22, KH = 0.17, KD = 0.17, KZ = -0.01;
  add('castle:keep', new RoundedBoxGeometry(KW, KH + 0.02, KD, 1, 0.012), S.sand, T(0, top + KH / 2 - 0.01, KZ));
  const merlon = (name: string, x: number, y: number, z: number, w = 0.034, h = 0.03, d = 0.034, ry = 0) =>
    add(name, new THREE.BoxGeometry(w, h, d), S.sand, TR(x, y, z, ry));
  const ky = top + KH + 0.013; // 城垛 (高 0.03) 底面略嵌进主堡顶面
  for (let i = 0; i < 4; i++) {
    const x = -KW / 2 + 0.017 + (i * (KW - 0.034)) / 3;
    merlon(`castle:keepMerlonF${i}`, x, ky, KZ + KD / 2 - 0.017);
    merlon(`castle:keepMerlonB${i}`, x, ky, KZ - KD / 2 + 0.017);
  }
  for (const sx of [-1, 1]) merlon(`castle:keepMerlonS${sx}`, sx * (KW / 2 - 0.017), ky, KZ);
  // 拱门 (平面拱形, 贴在主堡正面外 2mm) + 门上一扇小拱窗
  const arch = (w: number, h: number) => {
    const sh = new THREE.Shape();
    const r = w / 2;
    sh.moveTo(-r, 0);
    sh.lineTo(r, 0);
    sh.lineTo(r, h - r);
    sh.absarc(0, h - r, r, 0, Math.PI, false);
    sh.lineTo(-r, 0);
    return new THREE.ShapeGeometry(sh, 6);
  };
  add('castle:door', arch(0.064, 0.092), S.door, T(0, top - 0.004, KZ + KD / 2 + 0.002));
  add('castle:keepWindow', arch(0.026, 0.036), S.door, T(0, top + 0.112, KZ + KD / 2 + 0.002));
  // ── 塔: [名字, x, z, 塔身高 (从底座顶面算), 底半径, 顶半径, 是否尖顶] ──
  const towers: Array<[string, number, number, number, number, number, boolean]> = [
    ['backLeft', -0.125, -0.105, 0.27, 0.078, 0.07, false],
    ['backRight', 0.125, -0.11, 0.335, 0.084, 0.074, false],
    ['frontLeft', -0.135, 0.095, 0.2, 0.068, 0.062, false],
    ['frontRight', 0.14, 0.105, 0.15, 0.07, 0.03, true],
  ];
  for (const [name, x, z, h, rb, rt, cone] of towers) {
    if (cone) {
      // 圆锥小塔: 截头圆锥 + 圆顶珠 (锥形模具压出来的, 顶端不尖锐)
      add(`castle:${name}`, new THREE.CylinderGeometry(rt, rb, h, 14, 2, true), S.sand, T(x, top + h / 2 - 0.01, z));
      add(`castle:${name}Tip`, new THREE.SphereGeometry(rt * 1.05, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), S.sand, T(x, top + h - 0.012, z));
      const cr = rb + (rt - rb) * (0.055 / h) + 0.004;
      add(`castle:${name}Window`, arch(0.02, 0.03), S.door, TR(x + Math.sin(0.5) * cr, top + 0.03, z + Math.cos(0.5) * cr, 0.5));
      continue;
    }
    // 小桶圆塔: 上细一点点的塔身 (顶盖封口) + 外沿唇边 + 6 个城垛
    add(`castle:${name}`, new THREE.CylinderGeometry(rt, rb, h, 14, 1, false), S.sand, T(x, top + h / 2 - 0.01, z));
    const lipR = rt + 0.01, lipH = 0.026;
    const ly = top + h - 0.01 + lipH / 2 - 0.004;
    add(`castle:${name}Lip`, new THREE.CylinderGeometry(lipR, rt, lipH, 14, 1, false), S.sand, T(x, ly, z));
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.3;
      const mr = lipR - 0.013;
      merlon(`castle:${name}Merlon${k}`, x + Math.cos(a) * mr, ly + lipH / 2 + 0.013, z + Math.sin(a) * mr, 0.028, 0.03, 0.026, Math.PI / 2 - a);
    }
    // 朝镜头一侧的小拱窗 (贴在塔身外 2mm, 跟着塔身朝向转)
    const wa = x < 0 ? -0.35 : 0.35;
    const wy = top + h * 0.55;
    const rw = rb + (rt - rb) * 0.55 + 0.002;
    add(`castle:${name}Window`, arch(0.022, 0.034), S.door, TR(x + Math.sin(wa) * rw, wy, z + Math.cos(wa) * rw, wa));
  }
  // ── 最高塔顶的小旗: 细旗杆 + 微微飘动的三角旗 (3 段) ──
  {
    const [, x, z, h] = towers[1];
    const y0 = top + h - 0.012;
    const poleH = 0.13;
    add('castle:flagPole', new THREE.CylinderGeometry(0.0045, 0.005, poleH, 6, 1, false), S.pole, T(x, y0 + poleH / 2, z));
    const pos: number[] = [];
    const L = 0.1, H = 0.06, SEG = 3;
    const pt = (u: number, v: number) => [x + 0.004 + u * L, y0 + poleH - 0.006 - H / 2 + (v - 0.5) * H * (1 - u), z + 0.008 * Math.sin(u * Math.PI * 1.5)];
    for (let k = 0; k < SEG; k++) {
      const u0 = k / SEG, u1 = (k + 1) / SEG;
      const a = pt(u0, 0), b = pt(u1, 0), c = pt(u1, 1), d = pt(u0, 1);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.computeVertexNormals();
    add('castle:flag', fg, S.flag, new THREE.Matrix4());
  }
  return parts;
}

/** 沙堡合并成一个几何 (再按摆放矩阵 m 变换), 属性与沙滩道具一致。 */
export function buildSandcastle(m?: THREE.Matrix4): THREE.BufferGeometry {
  const parts = buildSandcastleParts();
  const out = mergeGeometries(parts.map((p) => p.geo));
  parts.forEach((p) => p.geo.dispose());
  if (m) out.applyMatrix4(m);
  out.computeBoundingSphere();
  return out;
}
