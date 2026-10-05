import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FAR_PEAKS, NEAR_PEAKS, ridgeHeight } from './beach3dLayout';

/**
 * beach3dGeometry.ts — 海滩 3D 场景的低模几何 (程序化生成, 无贴图)。
 * 每种物体一份几何 + InstancedMesh, 整个场景的植被只有 3 次绘制 (树干 / 叶冠 / 草丛)。
 *
 * 棕榈的自定义顶点属性:
 *   aPart  — 0 树干, 1 小叶, 2 椰子, 3 叶轴 (叶冠几何里混合了叶和椰子, 共用一次绘制)
 *   aLeaf  — 叶片 = (s: 叶柄 → 叶尖 0..1, t: 小叶根 → 小叶尖 0..1); 树干 = (高度 0..1, 环向 0..1)
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

/**
 * 弯曲渐细的树干: 10 边形 × 18 节, 根部外扩 (喇叭口), 顶部收细。
 * 一节一节的卡通分节纹理 / 柔和明暗在片元着色器里按 aLeaf (高度, 环向) 画, 几何保持平滑。
 */
export function buildPalmTrunk(radial = 10, rings = 18): THREE.BufferGeometry {
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
  for (let j = 0; j <= rings; j++) {
    // 节点向底部加密 (根部喇叭口弧度更顺)
    const t = Math.pow(j / rings, 1.25);
    trunkCenter(t, c);
    if (j === rings) { trunkCenter(t - 0.01, c2); tan.subVectors(c, c2).normalize(); } else { trunkCenter(Math.min(1, t + 0.01), c2); tan.subVectors(c2, c).normalize(); }
    side.crossVectors(tan, new THREE.Vector3(0, 0, 1)).normalize();
    fwd.crossVectors(side, tan).normalize();
    const flare = 1 + 0.55 * Math.pow(1 - t, 7); // 根部略粗
    const r = THREE.MathUtils.lerp(PALM_TRUNK.r0, PALM_TRUNK.r1, Math.pow(t, 0.8)) * flare;
    // 根部喇叭口: 法线略朝上 (dr/dy < 0), 明暗更立体
    const slope = 0.55 * 7 * Math.pow(1 - t, 6) * PALM_TRUNK.r0 / PALM_TRUNK.height;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      n.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a));
      pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
      const nn = n.clone().addScaledVector(tan, slope * 4).normalize();
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
 * 棕榈叶冠 (原点 = 树干顶端): 10 片羽状复叶 + 3 个低模椰子。
 * 每片叶 = 一根拱起再下垂的叶轴 (细带) + 两侧各一排独立的小叶 (菱形尖叶, 斜向叶尖、向下张开成 V 形, 自身再微微下垂),
 * 所以叶片有体积和层次 (不是平面锯齿片)。上层 3 片短而上扬的嫩叶 + 下层 7 片长而下垂的老叶。
 * aLeaf = (s: 叶柄 → 叶尖 0..1, t: 小叶根 → 小叶尖 0..1; 叶轴 t = 0), aPart: 1 小叶, 3 叶轴, 2 椰子。
 * 法线朝上偏 (卡通柔和明暗, 不出现一片片黑面)。
 */
export function buildPalmCrown(fronds = 10, leaflets = 11): THREE.BufferGeometry {
  const rnd = mulberry32(0x9a1e);
  const pos: number[] = [];
  const nrm: number[] = [];
  const leaf: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const RS = 10; // 叶轴节数
  const P: THREE.Vector3[] = [];
  const T: THREE.Vector3[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const S = new THREE.Vector3();
  const N = new THREE.Vector3();
  const D = new THREE.Vector3();
  const fn = new THREE.Vector3();
  const vtx = (p: THREE.Vector3, n: THREE.Vector3, s: number, t: number, pa: number) => {
    pos.push(p.x, p.y, p.z);
    nrm.push(n.x, n.y, n.z);
    leaf.push(s, t);
    part.push(pa);
    return pos.length / 3 - 1;
  };
  for (let f = 0; f < fronds; f++) {
    const young = f < 3;
    const az = young ? (f / 3) * Math.PI * 2 + 0.5 + (rnd() - 0.5) * 0.4 : ((f - 3) / (fronds - 3)) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
    const len = young ? 1.25 + rnd() * 0.3 : 1.85 + rnd() * 0.45;
    const el0 = young ? 1.0 + rnd() * 0.2 : 0.35 + rnd() * 0.3; // 叶柄起始仰角
    const droop = young ? 1.05 : 1.9 + rnd() * 0.5; // 沿叶长的下弯 (rad)
    const h = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    S.set(-Math.sin(az), 0, Math.cos(az)); // 叶片横向 (水平)
    P.length = 0; T.length = 0;
    const p = new THREE.Vector3();
    for (let k = 0; k <= RS; k++) {
      const s = k / RS;
      const el = el0 - droop * s * s;
      const dir = h.clone().multiplyScalar(Math.cos(el)).addScaledVector(up, Math.sin(el));
      if (k > 0) p.addScaledVector(dir, len / RS);
      P.push(p.clone());
      T.push(dir.clone());
    }
    // 叶轴: 细带 (宽 3cm → 0)
    const rBase = pos.length / 3;
    for (let k = 0; k <= RS; k++) {
      const s = k / RS;
      const w = 0.03 * (1 - s * 0.85);
      N.crossVectors(S, T[k]).normalize();
      fn.copy(N).add(up).normalize();
      vtx(P[k].clone().addScaledVector(S, -w), fn, s, 0, 3);
      vtx(P[k].clone().addScaledVector(S, w), fn, s, 0, 3);
    }
    for (let k = 0; k < RS; k++) {
      const a = rBase + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    // 小叶: 沿叶轴均布, 中段最长, 两端短
    for (let j = 0; j < leaflets; j++) {
      const s = 0.1 + 0.86 * (j + 0.5) / leaflets;
      const fk = s * RS;
      const k0 = Math.min(RS - 1, Math.floor(fk));
      const fr = fk - k0;
      const base = P[k0].clone().lerp(P[k0 + 1], fr);
      const tng = T[k0].clone().lerp(T[k0 + 1], fr).normalize();
      N.crossVectors(S, tng).normalize(); // 叶片"上"方向
      const L = len * (young ? 0.34 : 0.4) * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * s)), 0.6) * (0.9 + rnd() * 0.2);
      const wdt = L * 0.13;
      for (const sg of [-1, 1]) {
        const beta = 0.5 + rnd() * 0.25; // 向下张开角 (V 形)
        D.copy(S).multiplyScalar(sg * Math.cos(beta)).addScaledVector(N, -Math.sin(beta)).addScaledVector(tng, 0.75).normalize();
        const mid = base.clone().addScaledVector(D, L * 0.45);
        const tip = base.clone().addScaledVector(D, L).addScaledVector(up, -L * 0.22); // 小叶自身下垂
        // 面法线 (朝上), 再往上偏, 明暗柔和
        const side = new THREE.Vector3().crossVectors(D, tng).normalize();
        if (side.dot(N) < 0) side.negate();
        fn.copy(side).addScaledVector(up, 0.8).normalize();
        const wv = new THREE.Vector3().crossVectors(D, side).normalize().multiplyScalar(wdt);
        const i0 = vtx(base, fn, s, 0, 1);
        const i1 = vtx(mid.clone().add(wv), fn, s, 0.45, 1);
        const i2 = vtx(mid.clone().sub(wv).addScaledVector(side, wdt * 0.35), fn, s, 0.45, 1); // 中脊微折
        const i3 = vtx(tip, fn, s, 1, 1);
        idx.push(i0, i1, i2, i2, i1, i3);
      }
    }
  }
  // 椰子: 三个低模球 (20 面, 平滑法线)
  const ico = mergeVertices(stripToPosition(new THREE.IcosahedronGeometry(0.11, 0)));
  const ip = ico.getAttribute('position');
  const ii = ico.getIndex()!;
  for (let c = 0; c < 3; c++) {
    const a = (c / 3) * Math.PI * 2 + 0.4;
    const ox = Math.cos(a) * 0.13, oz = Math.sin(a) * 0.13, oy = -0.12 - (c === 1 ? 0.05 : 0);
    const base = pos.length / 3;
    for (let i = 0; i < ip.count; i++) {
      const x = ip.getX(i), y = ip.getY(i), z = ip.getZ(i);
      const l = Math.hypot(x, y, z) || 1;
      vtx(new THREE.Vector3(x + ox, y + oy, z + oz), new THREE.Vector3(x / l, y / l, z / l), 0, 0, 2);
    }
    for (let i = 0; i < ii.count; i++) idx.push(base + ii.getX(i));
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
 * 卡通草丛: 26 根宽而圆头的草叶 (外圈 16 根微微向外拱, 内圈 10 根短而直立, 每根 4 节), 整丛读起来是一团柔软的草球, 外加 2 朵小花 (5 瓣扇形, 只在开花的实例显示)。
 * 圆头在片元里按 uv 裁出; 法线用"球形法线" (从丛中心指向外上方), 整丛像一团柔和的绒球受光, 不会出现一片片硬面。
 * 属性: uv = (横向 −1..1, 高度 0..1); aGPart: 0 草叶, 1 花瓣, 2 花心; aBlade: 每根草叶的随机数 (色相微差)。
 */
export function buildGrassClump(outer = 16, inner = 10): THREE.BufferGeometry {
  const rnd = mulberry32(0x6a55);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const gpart: number[] = [];
  const blade: number[] = [];
  const idx: number[] = [];
  const sph = (x: number, y: number, z: number) => {
    const n = new THREE.Vector3(x, Math.max(0, y) * 0.8 + 0.45, z).normalize();
    nrm.push(n.x, n.y, n.z);
  };
  const SEG = 4;
  for (let b = 0; b < outer + inner; b++) {
    const isIn = b >= outer;
    const az = isIn ? ((b - outer) / inner) * Math.PI * 2 + 0.4 + (rnd() - 0.5) * 0.6 : (b / outer) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    const h = isIn ? 0.5 + rnd() * 0.25 : 0.45 + rnd() * 0.3;
    const lean = isIn ? 0.1 + rnd() * 0.15 : 0.3 + rnd() * 0.3; // 向外拱的程度
    const r0 = isIn ? rnd() * 0.04 : 0.04 + rnd() * 0.05;
    const w0 = 0.1 + rnd() * 0.035;
    const ox = Math.cos(az), oz = Math.sin(az);
    const sx = -oz, sz = ox; // 横向
    const rb = rnd();
    const base = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const v = k / SEG;
      const out = r0 + lean * h * v * v; // 二次弧线外拱
      const y = h * (v - 0.2 * lean * v * v * v);
      const w = w0 * (1 - v * 0.35); // 宽叶, 圆头
      const cx = ox * out, cz = oz * out;
      pos.push(cx - sx * w, y, cz - sz * w, cx + sx * w, y, cz + sz * w);
      sph(cx, y, cz); sph(cx, y, cz);
      uv.push(-1, v, 1, v);
      gpart.push(0, 0);
      blade.push(rb, rb);
    }
    for (let k = 0; k < SEG; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  // 小花: 两朵, 5 瓣扇形 (略朝上倾斜)
  for (let f = 0; f < 2; f++) {
    const az = f * 2.6 + 0.7;
    const cx = Math.cos(az) * 0.2, cz = Math.sin(az) * 0.2, cy = 0.7 + 0.08 * f; // 高出草叶, 从侧面也看得见
    const R = 0.09;
    const c = pos.length / 3;
    pos.push(cx, cy + 0.01, cz); nrm.push(0, 1, 0); uv.push(0, 0); gpart.push(2); blade.push(0);
    const tilt = new THREE.Vector3(Math.cos(az), 0.0, Math.sin(az));
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rr = R * (0.55 + 0.45 * Math.abs(Math.cos(a * 2.5))); // 5 个花瓣
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const lift = (x * tilt.x + z * tilt.z) * 0.6; // 朝外上倾
      pos.push(cx + x, cy + lift, cz + z); nrm.push(0, 1, 0); uv.push(rr / R, 1); gpart.push(1); blade.push(0);
    }
    for (let i = 0; i < 10; i++) idx.push(c, c + 1 + i, c + 2 + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aGPart', new THREE.Float32BufferAttribute(gpart, 1));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

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
 * 圆润的卡通礁石: 细分二十面体 (合并顶点 → 平滑法线) + 低频起伏 (几个方向的正弦叠加, 不会裂缝) + 底部压平。
 * detail: 0 → 80 三角, 1 → 320 三角 (默认), 2 → 1280 三角。
 */
export function buildRock(detail = 1): THREE.BufferGeometry {
  // three 的 IcosahedronGeometry(detail = n) 有 20·(n+1)² 个三角: n = 1 / 3 / 7 → 80 / 320 / 1280
  const d = [1, 3, 7][Math.max(0, Math.min(2, Math.round(detail)))];
  const g = mergeVertices(stripToPosition(new THREE.IcosahedronGeometry(1, d)));
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const bump = 0.1 * Math.sin(v.x * 2.3 + v.z * 1.7 + 0.4) + 0.07 * Math.sin(v.y * 3.1 - v.x * 2.2 + 1.3) + 0.05 * Math.sin(v.z * 4.3 + v.y * 2.7);
    v.multiplyScalar(1 + bump);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.06; // 底部压平 (圆角过渡)
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
