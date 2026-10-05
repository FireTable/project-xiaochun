import * as THREE from 'three';
import { FAR_PEAKS, NEAR_PEAKS, ridgeHeight } from './beach3dLayout';

/**
 * beach3dGeometry.ts — 海滩 3D 场景的低模几何 (程序化生成, 无贴图)。
 * 每种物体一份几何 + InstancedMesh, 整个场景的植被只有 3 次绘制 (树干 / 叶冠 / 草丛)。
 *
 * 自定义顶点属性:
 *   aPart  — 0 树干, 1 棕榈叶, 2 椰子 (叶冠几何里混合了叶和椰子, 共用一次绘制)
 *   aLeaf  — 叶片参数 (s = 从叶柄到叶尖 0..1, u = 横向 −1..1); 树干上 = (高度 0..1, 环向 0..1)
 */

/** 树干参数: 高 H (m), 顶部相对底部的水平偏移 LEAN (m, 沿局部 +X)。 */
export const PALM_TRUNK = { height: 4.3, lean: 1.5, r0: 0.17, r1: 0.1 } as const;

/** 树干中心线 (t ∈ [0,1]): 向 +X 弯, 越往上越弯 (典型海滩棕榈的弧度)。 */
export function trunkCenter(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(PALM_TRUNK.lean * Math.pow(t, 1.7), PALM_TRUNK.height * t, 0);
}

/** 叶冠挂点 = 树干顶端 (局部坐标)。 */
export function trunkTop(): THREE.Vector3 {
  return trunkCenter(1);
}

/** 弯曲渐细的低模树干: 7 边形 × 10 节。 */
export function buildPalmTrunk(radial = 7, rings = 10): THREE.BufferGeometry {
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
  const up = new THREE.Vector3(0, 1, 0);
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    trunkCenter(t, c);
    trunkCenter(Math.min(1, t + 0.01), c2);
    if (j === rings) { trunkCenter(t - 0.01, c2); tan.subVectors(c, c2).normalize(); } else tan.subVectors(c2, c).normalize();
    side.crossVectors(tan, new THREE.Vector3(0, 0, 1)).normalize();
    fwd.crossVectors(side, tan).normalize();
    // 底部稍微外扩 (根部), 顶部收细
    const r = THREE.MathUtils.lerp(PALM_TRUNK.r0, PALM_TRUNK.r1, t) * (1 + 0.35 * Math.pow(1 - t, 6));
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const nx = Math.cos(a), nz = Math.sin(a);
      const n = side.clone().multiplyScalar(nx).addScaledVector(fwd, nz);
      pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
      nrm.push(n.x, n.y, n.z);
      leaf.push(t, i / radial);
      part.push(0);
    }
  }
  void up;
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
 * 棕榈叶冠 (原点 = 树干顶端): 11 片下垂的羽状叶 (每片 8 节, 横截面 V 形中脊) + 3 个低模椰子。
 * 叶片的锯齿 / 小叶缺口在片元着色器里按 aLeaf 裁出来 (不用贴图)。
 */
export function buildPalmCrown(fronds = 11, segs = 8): THREE.BufferGeometry {
  const rnd = mulberry32(0x9a1e);
  const pos: number[] = [];
  const nrm: number[] = [];
  const leaf: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const sideV = new THREE.Vector3();
  const nV = new THREE.Vector3();
  for (let f = 0; f < fronds; f++) {
    const az = (f / fronds) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
    const upFrond = f % 4 === 1; // 少量上扬的嫩叶, 让叶冠更饱满
    const len = (upFrond ? 1.35 : 1.9) + rnd() * 0.5;
    const el0 = upFrond ? 0.95 : 0.25 + rnd() * 0.35; // 叶柄起始仰角
    const droop = upFrond ? 1.1 : 2.0 + rnd() * 0.5; // 沿叶长的下弯量 (rad)
    const width = 0.36 + rnd() * 0.1;
    const h = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    sideV.set(-Math.sin(az), 0, Math.cos(az));
    p.set(0, 0, 0);
    const base = pos.length / 3;
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      const el = el0 - droop * s * s;
      dir.copy(h).multiplyScalar(Math.cos(el)).add(new THREE.Vector3(0, Math.sin(el), 0));
      if (k > 0) p.addScaledVector(dir, len / segs);
      const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.92 + 0.08)), 0.75) * (s < 0.08 ? s / 0.08 : 1);
      nV.crossVectors(sideV, dir).normalize(); // 叶面法线 (朝上)
      const fold = 0.28 * w; // V 形中脊: 两边缘比中脊低
      // 左缘 / 中脊 / 右缘
      pos.push(p.x - sideV.x * w, p.y - fold, p.z - sideV.z * w);
      pos.push(p.x, p.y, p.z);
      pos.push(p.x + sideV.x * w, p.y - fold, p.z + sideV.z * w);
      for (let q = 0; q < 3; q++) nrm.push(nV.x, nV.y, nV.z);
      leaf.push(s, -1, s, 0, s, 1);
      part.push(1, 1, 1);
    }
    for (let k = 0; k < segs; k++) {
      const a = base + k * 3;
      const b = a + 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
  }
  // 椰子: 三个低模球 (icosahedron detail 0, 每个 20 三角)
  const ico = new THREE.IcosahedronGeometry(0.11, 0).toNonIndexed();
  const ip = ico.getAttribute('position');
  for (let c = 0; c < 3; c++) {
    const a = (c / 3) * Math.PI * 2 + 0.4;
    const ox = Math.cos(a) * 0.13, oz = Math.sin(a) * 0.13, oy = -0.12 - (c === 1 ? 0.05 : 0);
    const base = pos.length / 3;
    for (let i = 0; i < ip.count; i++) {
      const x = ip.getX(i), y = ip.getY(i), z = ip.getZ(i);
      pos.push(x + ox, y + oy, z + oz);
      const l = Math.hypot(x, y, z) || 1;
      nrm.push(x / l, y / l, z / l);
      leaf.push(0, 0);
      part.push(2);
      idx.push(base + i);
    }
  }
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

/**
 * 前景框景叶 (相机空间, 每帧贴在画面左上 / 右上角, 见 Beach3DWorld): 每侧一簇 6 片从画外伸进来的下垂羽状叶。
 * 局部坐标: 叶簇根部 = 原点 (略在画框外), +X 向画面内, −Y 向下, +Z 朝相机; 叶长约 1 (按画面高度缩放)。
 * aSide = −1 左簇 / +1 右簇 (右簇是左簇的镜像, 已翻转绕序和法线, 正面仍朝相机); 顶点着色器按 aSide 把两簇推到左右两角。
 * 属性与叶冠一致 (aLeaf / aPart = 1), 直接复用棕榈着色器的叶片裁切 / 明暗。
 */
export function buildFrameFronds(fronds = 6, segs = 8): THREE.BufferGeometry {
  const rnd = mulberry32(0xf20d);
  const pos: number[] = [];
  const nrm: number[] = [];
  const leaf: number[] = [];
  const part: number[] = [];
  const side: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const sv = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const left: Array<{ pos: number[]; nrm: number[]; leaf: number[]; tris: number[] }> = [];
  for (let f = 0; f < fronds; f++) {
    const a0 = THREE.MathUtils.degToRad(18 - (f / (fronds - 1)) * 92 + (rnd() - 0.5) * 8); // 起始方向: 从偏右上到几乎朝下
    const len = 0.8 + rnd() * 0.3 - (f === 0 || f === fronds - 1 ? 0.12 : 0);
    const droop = 0.9 + rnd() * 0.5;
    const width = 0.15 + rnd() * 0.04;
    const z0 = (f % 2) * -0.06; // 前后错开, 叶片之间有层次
    p.set(-0.12, 0.08, z0);
    const fp: number[] = [], fn: number[] = [], fl: number[] = [], ft: number[] = [];
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      const el = Math.max(a0 - droop * s * s, THREE.MathUtils.degToRad(-105));
      dir.set(Math.cos(el), Math.sin(el), 0.28 * s).normalize();
      if (k > 0) p.addScaledVector(dir, len / segs);
      const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.92 + 0.08)), 0.75) * (s < 0.08 ? s / 0.08 : 1);
      sv.crossVectors(dir, zAxis).normalize();
      nv.crossVectors(sv, dir).normalize(); // 朝相机 (+Z)
      if (nv.z < 0) nv.negate();
      const fold = 0.3 * w; // 中脊朝相机凸起, 两缘向后
      fp.push(p.x - sv.x * w, p.y - sv.y * w, p.z - fold, p.x, p.y, p.z, p.x + sv.x * w, p.y + sv.y * w, p.z - fold);
      for (let q = 0; q < 3; q++) fn.push(nv.x, nv.y, nv.z);
      fl.push(s, -1, s, 0, s, 1);
    }
    for (let k = 0; k < segs; k++) {
      const a = k * 3;
      const b = a + 3;
      ft.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
    left.push({ pos: fp, nrm: fn, leaf: fl, tris: ft });
  }
  for (const sgn of [-1, 1]) {
    for (const fr of left) {
      const base = pos.length / 3;
      for (let i = 0; i < fr.pos.length; i += 3) {
        // 右簇 = 左簇沿 X 镜像 (sgn = +1 时 x 取反)
        pos.push(sgn > 0 ? -fr.pos[i] : fr.pos[i], fr.pos[i + 1], fr.pos[i + 2]);
        nrm.push(sgn > 0 ? -fr.nrm[i] : fr.nrm[i], fr.nrm[i + 1], fr.nrm[i + 2]);
        part.push(1);
        side.push(sgn);
      }
      leaf.push(...fr.leaf);
      for (let t = 0; t < fr.tris.length; t += 3) {
        // 左簇按 (左缘, 下一节左缘, 中脊) 的顺序从相机看是顺时针, 需反转; 右簇镜像后本身就是逆时针 → 正面朝相机
        if (sgn < 0) idx.push(base + fr.tris[t], base + fr.tris[t + 2], base + fr.tris[t + 1]);
        else idx.push(base + fr.tris[t], base + fr.tris[t + 1], base + fr.tris[t + 2]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** 草丛: 3 片互成 60° 的竖直面片 (单位高 1m、宽 1.1m, 底边在 y=0); 草叶形状在片元里画。 */
export function buildGrassClump(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let q = 0; q < 3; q++) {
    const a = (q / 3) * Math.PI;
    const cx = Math.cos(a) * 0.55, cz = Math.sin(a) * 0.55;
    const base = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * 远山剪影: 两层弧形条带 (以相机为圆心, 半径 R, 方位 ±70°), 底边在 y=0 (= 远景层里的海平线), 顶边 = 山脊。
 * 顶点属性 aH = 归一化高度 (0 底 → 1 该层最高峰), aLayer = 0 远层 / 1 近层。
 */
export function buildMountains(heightScale = 1, segments = 72, farR = 80, nearR = 70): THREE.BufferGeometry {
  const pos: number[] = [];
  const aH: number[] = [];
  const aLayer: number[] = [];
  const aLit: number[] = [];
  const idx: number[] = [];
  const layers: Array<{ peaks: typeof FAR_PEAKS; r: number; layer: number }> = [
    { peaks: FAR_PEAKS, r: farR, layer: 0 },
    { peaks: NEAR_PEAKS, r: nearR, layer: 1 },
  ];
  for (const L of layers) {
    // 每层按"有山的方位"切段, 没有山的地方不出三角形 (省三角面, 也避免贴着海平线的零高度细条)
    let maxH = 0;
    for (let i = 0; i <= segments; i++) maxH = Math.max(maxH, ridgeHeight(-70 + (140 * i) / segments, L.peaks, heightScale));
    maxH = Math.max(maxH, 1e-3);
    let prev = -1;
    for (let i = 0; i <= segments; i++) {
      const az = -70 + (140 * i) / segments;
      const h = ridgeHeight(az, L.peaks, heightScale);
      const a = THREE.MathUtils.degToRad(az);
      const x = Math.sin(a) * L.r, z = -Math.cos(a) * L.r;
      const base = pos.length / 3;
      pos.push(x, -0.05, z, x, h, z); // 底边贴着海平线 (略低 5cm, 防止抗锯齿露缝)
      aH.push(0, h / maxH, 0, h / maxH);
      aLayer.push(L.layer, L.layer, L.layer, L.layer);
      // 山坡朝向: 山脊往 +X (太阳一侧) 下降 = 向阳坡 (1), 往 +X 上升 = 背阳坡 (0)
      const slope = ridgeHeight(az + 1.5, L.peaks, heightScale) - ridgeHeight(az - 1.5, L.peaks, heightScale);
      const lit = slope < -0.02 ? 1 : slope > 0.02 ? 0 : 0.5;
      aLit.push(lit, lit, lit, lit);
      if (prev >= 0 && (h > 0 || ridgeHeight(-70 + (140 * (i - 1)) / segments, L.peaks, heightScale) > 0)) {
        idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
      }
      prev = base;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(aLayer, 1));
  g.setAttribute('aLit', new THREE.Float32BufferAttribute(aLit, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * 礁石: icosahedron (detail 0~2) 顶点按确定性噪声推拉, 底部压平 (坐在地面上), 非索引 + 面法线 → 卡通块面感。
 * 单位半径 1, 底面 y≈0; 实例矩阵里缩放 / 压扁 / 旋转。
 */
export function buildRock(detail = 1): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, Math.max(0, Math.min(2, Math.round(detail))));
  const pos = ico.getAttribute('position');
  const v = new THREE.Vector3();
  // 同一位置的顶点 (非索引几何里重复) 推拉量必须相同, 否则会裂缝: 按坐标哈希
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453;
    const n = h - Math.floor(h);
    v.multiplyScalar(0.82 + 0.3 * n);
    v.y = v.y < -0.15 ? -0.15 : v.y; // 底部压平
    v.y += 0.15;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const g = ico.index ? ico.toNonIndexed() : ico;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** 三角面数 (有索引按索引, 否则按顶点)。 */
export function triangleCount(g: THREE.BufferGeometry): number {
  const index = g.getIndex();
  return Math.floor((index ? index.count : g.getAttribute('position').count) / 3);
}
