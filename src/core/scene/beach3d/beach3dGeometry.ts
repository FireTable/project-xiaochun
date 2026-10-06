import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CHAIR, PALM_TRUNK, PARASOL, trunkLeanProfile } from './beach3dLayout';

/**
 * beach3dGeometry.ts — 海滩 3D 场景的低模几何 (程序化生成; 只有棕榈叶贴手绘羽叶贴图)。
 * 每种物体一份几何 + InstancedMesh, 棕榈只有 2 次绘制 (树干 / 叶冠); 沙滩椅 + 遮阳伞合并成 1 个几何 (1 次绘制)。
 *
 * 棕榈的自定义顶点属性:
 *   aPart  — 0 树干, 1 叶片 (贴手绘羽叶贴图), 2 椰子 (叶冠几何里混合了叶和椰子, 共用一次绘制)
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

/**
 * 树干: 10 边形 × 24 节的平滑管 (节点向根部加密), 粗细从根部向顶部平滑收窄, 根部微微外扩入沙。
 * 表面的柔和明暗 / 细环纹在片元着色器里按 aLeaf (高度 0..1, 环向 0..1) 画, 几何本身没有分节。
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
  const radius = (t: number) => THREE.MathUtils.lerp(PALM_TRUNK.r0, PALM_TRUNK.r1, Math.pow(t, 0.75)) * (1 + 0.45 * Math.pow(1 - t, 9));
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
  const row = radial + 1;
  for (let j = 0; j < rings; j++) {
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
 * 棕榈叶冠 (原点 = 树干顶端): fronds 片羽状大叶 + 一簇 4 个圆润的椰子, 按椰子树的真实形态排布:
 *   - 分层: 每片叶有个"叶龄" tier (0 = 冠顶嫩叶, 1 = 最下层老叶), 叶柄起始仰角从冠顶的 rise + spread 递减到最下层的 rise − spread,
 *     下弯量随叶龄增大 → 冠顶叶斜向上伸出、中层叶拱起后斜向下、只有老叶下垂; 整体是向四周放射的"喷泉 / 星芒"轮廓;
 *   - 每片叶的叶轴: 前 stiffness 段笔直上扬 (硬挺的叶柄), 之后才逐渐弯下 (下弯集中在后半段 → 拱形, 不是从冠顶直接垂下的拖把);
 *   - 横截面是倒 V 形 (叶轴在中间最高, 两侧小叶向下折 foldDeg, 叶尖处略深), 小叶仍向两侧张开成羽毛状, 不竖直下垂;
 *   - 长度 / 宽度 / 下弯 / 方位 / 侧弯 / 扭转每片都有随机差异; 方位按黄金角排布, 层与方位交错, 没有规则的环。
 * 每片叶 = 一条沿叶轴的带子 (贴手绘羽叶贴图, 透明处丢弃), aLeaf = (u: 叶柄 → 叶尖 0..1, v: 横向 0..1, 叶轴 v = 0.5) = 贴图坐标;
 * aPart: 1 叶片, 2 椰子, 3 冠顶叶鞘包 (aLeaf.y = 0) / 叶柄 (aLeaf.y = 1)。法线朝上偏 (卡通柔和明暗)。每片叶 12 节 × 2 条 = 48 三角 + 叶柄 6 三角。
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
      if (s <= 0.34) stalk.push({ p: p.clone(), s: S2.clone() });
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
    // 叶柄: 沿叶轴前 1/3 的一条竖直窄片 (与叶面十字交叉), 从侧面 / 下面看也是一根连到冠顶的实心叶柄, 越往外越细
    const sb = pos.length / 3;
    stalk.forEach(({ p: sp, s: ss }, k) => {
      const t = k / Math.max(1, stalk.length - 1);
      const hw = 0.032 * (1 - t) + 0.01;
      const nv = new THREE.Vector3().crossVectors(ss, up).normalize();
      const fin = new THREE.Vector3().crossVectors(nv, ss).normalize(); // 竖直方向 (叶面法线一侧)
      if (fin.y < 0) fin.negate();
      vtx(sp.clone().addScaledVector(fin, hw * 0.6), ss, t, 1, 3);
      vtx(sp.clone().addScaledVector(fin, -hw * 1.4), ss, t, 1, 3);
    });
    for (let k = 0; k + 1 < stalk.length; k++) {
      const a = sb + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  // 冠顶叶鞘包: 树干顶端略微鼓起的一圈叶基 (旋转体, 10 × 5 段), 所有叶柄都从它里面长出来
  {
    const prof: Array<[number, number]> = [[0.085, -0.3], [0.112, -0.2], [0.132, -0.08], [0.124, 0.02], [0.085, 0.08], [0.03, 0.11]];
    const RAD = 10;
    const bb = pos.length / 3;
    for (let j = 0; j < prof.length; j++) {
      const [r, y] = prof[j];
      const [rp, yp] = prof[Math.max(0, j - 1)];
      const [rn, yn] = prof[Math.min(prof.length - 1, j + 1)];
      const dr = rn - rp, dy = yn - yp; // 剖面切线 → 法线 (dy, -dr)
      for (let i = 0; i <= RAD; i++) {
        const a = (i / RAD) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        vtx(new THREE.Vector3(c * r, y, sn * r), new THREE.Vector3(c * dy, -dr, sn * dy).normalize(), j / (prof.length - 1), 0, 3);
      }
    }
    for (let j = 0; j + 1 < prof.length; j++) for (let i = 0; i < RAD; i++) {
      const a = bb + j * (RAD + 1) + i, b = a + RAD + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // 椰子: 4 个圆润的球 (2 级细分二十面体 180 面, 平滑法线, 略呈蛋形), 一簇挂在叶冠下面; aLeaf.x = 椰子序号 (着色时颜色略有差别)
  const ico = mergeVertices(stripToPosition(new THREE.IcosahedronGeometry(1, 2)));
  const ip = ico.getAttribute('position');
  const ii = ico.getIndex()!;
  const nuts: Array<[number, number, number, number]> = [
    [0.21, -0.13, 0.08, 0.105],
    [-0.13, -0.14, 0.19, 0.1],
    [-0.08, -0.12, -0.22, 0.108],
    [0.07, -0.27, -0.19, 0.098],
  ];
  nuts.forEach(([ox, oy, oz, r], c) => {
    const base = pos.length / 3;
    for (let i = 0; i < ip.count; i++) {
      const x = ip.getX(i), y = ip.getY(i), z = ip.getZ(i);
      const l = Math.hypot(x, y, z) || 1;
      const sy = 1.1;
      vtx(new THREE.Vector3(ox + (x / l) * r, oy + (y / l) * r * sy, oz + (z / l) * r),
        new THREE.Vector3(x / l, y / l / sy, z / l).normalize(), (c + 0.5) / nuts.length, 0, 2);
    }
    for (let i = 0; i < ii.count; i++) idx.push(base + ii.getX(i));
  });
  ico.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
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

/**
 * 沙滩小物件 (单位尺寸, 底面贴 y = 0): 扇贝 / 海螺 / 海星三种形状合在一个几何里, 每个顶点带 aKind (0 / 1 / 2) 与 aUV (着色用的局部坐标)。
 * 实例化时每个实例只显示自己那一种 (顶点着色器把其余两种塌成退化三角形), 所以三种小物件只要 1 次绘制。
 */
export function buildShellSet(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const make = (kind: number, pos: number[], uv: number[], idx: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(kind), 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  };
  const grid = (nu: number, nv: number, f: (u: number, v: number) => [number, number, number], kind: number, closeU = false) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      pos.push(...f(closeU && i === nu ? 0 : u, v));
      uv.push(u, v);
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
    make(kind, pos, uv, idx);
  };
  grid(14, 4, (u, v) => {
    const th = (u - 0.5) * 2.6;
    const rr = v * (1 - 0.05 * Math.abs(Math.sin(u * Math.PI * 9)));
    return [Math.sin(th) * rr, 0.42 * (1 - v * v) * Math.pow(Math.cos((u - 0.5) * 2.2), 0.5) + 0.02, -0.45 + Math.cos(th) * rr];
  }, 0);
  grid(10, 7, (u, v) => {
    const a = u * Math.PI * 2;
    const r = (0.36 * Math.pow(1 - v, 0.9) + 0.03) * (1 + 0.12 * Math.sin(v * Math.PI * 2 * 3.5));
    return [-0.5 + v * 1.25, r * 0.95 + Math.sin(a) * r, Math.cos(a) * r];
  }, 1, true);
  grid(30, 3, (u, v) => {
    const a = u * Math.PI * 2;
    const arm = Math.pow(Math.abs(Math.cos(a * 2.5)), 2.2);
    const R = 0.34 + 0.66 * arm;
    const rr = v * R;
    return [Math.cos(a) * rr, 0.16 * (1 - v * v) * (0.55 + 0.45 * arm) + 0.01, -Math.sin(a) * rr];
  }, 2, true);
  const out = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

/** 沙滩椅 / 遮阳伞 / 灯塔的材质分区 (顶点属性 aMat)。 */
export const PROP_MAT = { frame: 0, cushion: 1, pole: 2, canopy: 3, pillow: 4, lighthouse: 5 } as const;

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
