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

/**
 * 棕榈叶冠 (原点 = 树干顶端): fronds 片拱起再下垂的羽状大叶 + 一簇 4 个圆润的椰子。
 * 每片叶 = 一条沿弯曲叶轴的带子 (贴手绘羽叶贴图, 透明处丢弃), 横截面是 V 形: 叶轴在中间略高, 两侧小叶向下折,
 *   越靠叶尖折得越深 (小叶下垂), 整条带子再沿叶长轻微扭转 → 有体积、不像平贴的纸片。
 * 叶片方位按黄金角排布 + 抖动 (没有规则的层); 冠顶 3 片短嫩叶斜向上拱出后就弯下 (不再有竖直的叶轴尖), 其余长叶近乎平伸后大幅下垂。
 * aLeaf = (u: 叶柄 → 叶尖 0..1, v: 横向 0..1, 叶轴 v = 0.5) = 贴图坐标; aPart: 1 叶片, 2 椰子。法线朝上偏 (卡通柔和明暗)。
 * 每片叶 12 节 × 2 条 = 48 三角。
 */
export function buildPalmCrown(fronds = 12, widthScale = 1): THREE.BufferGeometry {
  const F = Math.max(6, Math.min(18, Math.round(fronds)));
  const WS = Math.max(0.6, Math.min(1.5, widthScale));
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
  const nUpper = Math.min(3, Math.round(F * 0.25));
  const T = new THREE.Vector3();
  const S = new THREE.Vector3();
  const N = new THREE.Vector3();
  const e = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let f = 0; f < F; f++) {
    const upper = f < nUpper;
    const az = f * 2.39996 + (rnd() - 0.5) * 0.35; // 黄金角
    const len = upper ? 1.05 + rnd() * 0.25 : 1.85 + rnd() * 0.5;
    const el0 = upper ? 0.6 + rnd() * 0.15 : 0.18 + rnd() * 0.3;  // 叶柄起始仰角
    const droop = upper ? 1.55 + rnd() * 0.3 : 1.75 + rnd() * 0.6; // 沿叶长的下弯 (rad)
    const curl = (rnd() - 0.5) * 0.35;                               // 叶轴在水平面内轻微侧弯
    const twist = (rnd() - 0.5) * 0.7;                               // 沿叶长的扭转 (rad, 叶尖处)
    const W = len * 0.33 * WS * (upper ? 0.85 : 1);                  // 带子全宽 (贴图 1024×320 的比例)
    const p = new THREE.Vector3(Math.cos(az) * 0.05, 0.02, Math.sin(az) * 0.05);
    const base = pos.length / 3;
    for (let k = 0; k <= RS; k++) {
      const s = k / RS;
      const el = el0 - droop * Math.pow(s, 1.5);
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
      // V 形折叠: 叶根附近较平 (0.3 rad), 叶尖附近小叶垂得更深 (0.85 rad); 叶柄一段很窄 (贴图本身在那里也只有叶柄)
      const fold = 0.3 + 0.55 * s;
      const half = (W / 2) * (0.92 + 0.08 * Math.sin(Math.PI * s));
      for (const sg of [-1, 0, 1]) {
        if (sg === 0) {
          n.copy(N2).addScaledVector(up, 0.5).normalize();
          vtx(p, n, s, 0.5, 1);
        } else {
          e.copy(S2).multiplyScalar(sg * Math.cos(fold)).addScaledVector(N2, -Math.sin(fold));
          const q = p.clone().addScaledVector(e, half).addScaledVector(up, -half * 0.12 * s);
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
  }
  // 椰子: 4 个圆润的球 (2 级细分二十面体 180 面, 平滑法线, 略呈蛋形), 一簇挂在叶冠下面; aLeaf.x = 椰子序号 (着色时颜色略有差别)
  const ico = mergeVertices(stripToPosition(new THREE.IcosahedronGeometry(1, 2)));
  const ip = ico.getAttribute('position');
  const ii = ico.getIndex()!;
  const nuts: Array<[number, number, number, number]> = [
    [0.12, -0.13, 0.05, 0.105],
    [-0.08, -0.14, 0.11, 0.1],
    [-0.04, -0.12, -0.13, 0.108],
    [0.03, -0.25, 0.0, 0.098],
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

/** 沙滩椅 / 遮阳伞的材质分区 (顶点属性 aMat)。 */
export const PROP_MAT = { frame: 0, cushion: 1, pole: 2, canopy: 3, pillow: 4 } as const;

/** 靠背与水平面的夹角 (rad)。 */
const BACK_ANGLE = 0.95;
/** 靠背铰点 (椅子局部)。 */
const BACK_PIVOT = new THREE.Vector3(0, 0.33, 0.33);

/**
 * 沙滩躺椅 + 遮阳伞 (椅子局部坐标: 原点 = 椅子中心地面, 头端 / 靠背在 +Z, 脚端在 −Z; mesh 再按 CHAIR 摆放 / 旋转)。
 * 躺椅: 4 条腿 + 两侧扶栏 + 脚端横档 + 倾斜靠背 (带支撑杆) + 圆角坐垫 / 靠垫 + 头端小枕头。
 * 遮阳伞: 插在头端外侧、向椅子一侧微倾的细杆 + 8 片布面的伞 (布面在伞骨之间微微下垂, 边缘呈扇贝形) + 顶珠。
 * 所有部件合并成一个非索引几何 (1 次绘制), 顶点带 aMat (材质分区) 与 aUV (条纹 / 伞面分片用)。约 1.5k 三角。
 */
export function buildBeachProps(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, mat: number, m: THREE.Matrix4) => {
    let gg = g.index ? g.toNonIndexed() : g;
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
    parts.push(gg);
    gg = null as unknown as THREE.BufferGeometry;
  };
  const M = (x: number, y: number, z: number, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1));
  /** 从 a 到 b 的方截面细杆 (厚 t)。 */
  const bar = (a: THREE.Vector3, b: THREE.Vector3, t: number, mat: number) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize());
    add(new THREE.BoxGeometry(t, t, d.length()), mat, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  };
  const hw = CHAIR.width / 2 - 0.03;
  // 腿
  for (const sx of [-1, 1]) for (const z of [-0.86, 0.38]) add(new THREE.BoxGeometry(0.045, 0.27, 0.045), PROP_MAT.frame, M(sx * hw, 0.135, z));
  // 扶栏 + 脚端横档
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.055, 1.4), PROP_MAT.frame, M(sx * hw, 0.29, -0.25));
  add(new THREE.BoxGeometry(CHAIR.width - 0.01, 0.05, 0.05), PROP_MAT.frame, M(0, 0.29, -0.93));
  // 坐垫
  add(new RoundedBoxGeometry(0.58, 0.075, 1.24, 2, 0.032), PROP_MAT.cushion, M(0, 0.352, -0.29));
  // 靠背: 沿 (0, sin, cos) 方向从铰点升起
  const bdir = new THREE.Vector3(0, Math.sin(BACK_ANGLE), Math.cos(BACK_ANGLE));
  const bnrm = new THREE.Vector3(0, Math.cos(BACK_ANGLE), -Math.sin(BACK_ANGLE)); // 靠背正面 (朝上偏脚端)
  const along = (s: number, off: number) => BACK_PIVOT.clone().addScaledVector(bdir, s).addScaledVector(bnrm, off);
  const bc = along(0.37, 0.035);
  add(new RoundedBoxGeometry(0.58, 0.075, 0.74, 2, 0.032), PROP_MAT.cushion, M(bc.x, bc.y, bc.z, -BACK_ANGLE));
  for (const sx of [-1, 1]) {
    const a = along(0.0, -0.01).setX(sx * hw), b = along(0.76, -0.01).setX(sx * hw);
    bar(a, b, 0.045, PROP_MAT.frame);
    // 支撑杆: 扶栏末端 → 靠背背面中段
    bar(new THREE.Vector3(sx * (hw - 0.02), 0.29, 0.62), along(0.42, -0.04).setX(sx * (hw - 0.02)), 0.032, PROP_MAT.frame);
  }
  bar(along(0.76, -0.01).setX(-hw), along(0.76, -0.01).setX(hw), 0.04, PROP_MAT.frame);
  // 小枕头
  const pc = along(0.6, 0.1);
  add(new RoundedBoxGeometry(0.42, 0.085, 0.2, 2, 0.04), PROP_MAT.pillow, M(pc.x, pc.y, pc.z, -BACK_ANGLE));

  // ── 遮阳伞 ──
  const base = new THREE.Vector3(PARASOL.lx, 0, PARASOL.lz);
  const axis = new THREE.Vector3(-Math.sin(PARASOL.tilt), Math.cos(PARASOL.tilt), 0);
  const top = base.clone().addScaledVector(axis, PARASOL.height);
  const qa = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const pole = new THREE.CylinderGeometry(0.02, 0.026, PARASOL.height + 0.25, 8, 1, true);
  add(pole, PROP_MAT.pole, new THREE.Matrix4().compose(base.clone().addScaledVector(axis, (PARASOL.height + 0.25) / 2 - 0.12), qa, new THREE.Vector3(1, 1, 1)));
  // 伞面: 8 片 × 每片 4 细分, 4 圈; 高度剖面 = 中心隆起 + 伞骨之间布面下垂 + 扇贝边
  const PANELS = 8, SUB = 4, RINGS = 4;
  const R = PARASOL.radius, rise = 0.27;
  const cp: number[] = [];
  const cuv: number[] = [];
  const cidx: number[] = [];
  const NU = PANELS * SUB;
  for (let k = 0; k <= RINGS; k++) for (let i = 0; i <= NU; i++) {
    const u = i / NU;               // 0..1 绕一圈
    const fp = (u * PANELS) % 1;    // 片内 0..1
    const sag = Math.sin(Math.PI * fp) ** 2;
    const rr = (k / RINGS) * R * (k === RINGS ? 1 - 0.06 * sag : 1);
    const a = u * Math.PI * 2;
    const y = rise * (1 - Math.pow(rr / R, 1.5)) - 0.05 * sag * (rr / R);
    cp.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
    cuv.push(u * PANELS, k / RINGS); // aUV.x = 第几片 (整数部分), aUV.y = 中心 → 边缘
  }
  for (let k = 0; k < RINGS; k++) for (let i = 0; i < NU; i++) {
    const a = k * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    cidx.push(a, b, d, a, d, c); // 法线朝上
  }
  const canopy = new THREE.BufferGeometry();
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  canopy.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
  canopy.setIndex(cidx);
  canopy.computeVertexNormals();
  add(canopy, PROP_MAT.canopy, new THREE.Matrix4().compose(top.clone().addScaledVector(axis, -rise + 0.02), qa, new THREE.Vector3(1, 1, 1)));
  // 顶珠
  add(new THREE.IcosahedronGeometry(0.035, 1), PROP_MAT.pole, new THREE.Matrix4().makeTranslation(top.x + axis.x * 0.04, top.y + axis.y * 0.04, top.z));
  const out = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

/** 靠背几何参数 (地面着色器画椅子落影要用)。 */
export const CHAIR_BACK = { angle: BACK_ANGLE, pivotY: BACK_PIVOT.y, pivotZ: BACK_PIVOT.z, length: 0.76 } as const;
