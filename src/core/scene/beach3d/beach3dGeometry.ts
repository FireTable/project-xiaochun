import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FAR_PEAKS, MID_PEAKS, NEAR_PEAKS, ridgeHeight } from './beach3dLayout';

/**
 * beach3dGeometry.ts — 海滩 3D 场景的低模几何 (程序化生成, 无贴图)。
 * 每种物体一份几何 + InstancedMesh, 棕榈只有 2 次绘制 (树干 / 叶冠)。
 *
 * 棕榈的自定义顶点属性:
 *   aPart  — 0 树干, 1 小叶, 2 椰子, 3 叶轴 (叶冠几何里混合了叶和椰子, 共用一次绘制)
 *   aLeaf  — 叶片 = (s: 叶柄 → 叶尖 0..1, t: 小叶根 → 小叶尖 0..1); 树干 = (高度 0..1, 环向 0..1)
 */

/** 树干参数: 高 H (m), 顶部相对底部的水平偏移 LEAN (m, 沿局部 +X)。 */
export const PALM_TRUNK = { height: 4.3, lean: 1.5, r0: 0.18, r1: 0.095 } as const;

/**
 * 树干中心线 (t ∈ [0,1]): 优雅的弧线, 略带 S 形 —— 根部近乎竖直地从沙里长出, 中段向 +X 倾出, 顶部再微微回正托起叶冠。
 * x = lean · (0.65 · smoothstep(t) + 0.35 · t²): smoothstep 两端斜率为 0 (S 形), t² 让上半段整体更倾。
 */
export function trunkCenter(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const s = t * t * (3 - 2 * t);
  return out.set(PALM_TRUNK.lean * (0.65 * s + 0.35 * t * t), PALM_TRUNK.height * t, 0);
}

/** 叶冠挂点 = 树干顶端 (局部坐标)。 */
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
    // 收窄 / 根部外扩使表面微微朝上: 法线沿切线方向偏 −dr/ds
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
 * 棕榈叶冠 (原点 = 树干顶端): 10 片羽状复叶 + 一簇 4 个圆润的椰子。
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
  // 椰子: 4 个圆润的球 (2 级细分二十面体 180 面, 平滑法线, 略呈蛋形), 一簇挂在叶冠下面; aLeaf.x = 椰子序号 (着色时颜色略有差别)
  const ico = mergeVertices(stripToPosition(new THREE.IcosahedronGeometry(1, 2)));
  const ip = ico.getAttribute('position');
  const ii = ico.getIndex()!;
  const nuts: Array<[number, number, number, number]> = [
    // [x, y, z, 半径]
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
      const sy = 1.1; // 略呈蛋形
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

/**
 * 远景岛屿: 远 / 中 / 近三层卡通岛屿剪影 (竖直条带, 底边贴海平线), 按层从远到近排在同一个索引缓冲里 (不写深度, 按顺序叠画)。
 * 每个顶点带: aH (该层归一化高度) / aRel (0 底边, 1 轮廓) / aLayer / aLit (向阳程度, 按平滑穹顶的坡向) / aAz (方位角 °)。
 * 只在有岛的方位出三角形; 近 / 中层顶上有树冠鼓包, 所以按 0.4° 一段细分。
 */
export function buildMountains(heightScale = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const aH: number[] = [];
  const aRel: number[] = [];
  const aLayer: number[] = [];
  const aLit: number[] = [];
  const aAz: number[] = [];
  const idx: number[] = [];
  const layers = [
    { peaks: FAR_PEAKS, r: 84, layer: 0, bump: 0, bw: 1, step: 0.8 },
    { peaks: MID_PEAKS, r: 77, layer: 1, bump: 0.32, bw: 2.2, step: 0.5 },
    { peaks: NEAR_PEAKS, r: 70, layer: 2, bump: 0.26, bw: 1.3, step: 0.4 },
  ];
  for (const L of layers) {
    const n = Math.round(140 / L.step);
    const azAt = (i: number) => -70 + (140 * i) / n;
    const hAt = (i: number) => ridgeHeight(azAt(i), L.peaks, heightScale, L.bump * heightScale, L.bw);
    let maxH = 1e-3;
    for (let i = 0; i <= n; i++) maxH = Math.max(maxH, hAt(i));
    let prev = -1;
    for (let i = 0; i <= n; i++) {
      const az = azAt(i);
      const h = hAt(i);
      const a = THREE.MathUtils.degToRad(az);
      const x = Math.sin(a) * L.r, z = -Math.cos(a) * L.r;
      const base = pos.length / 3;
      pos.push(x, -0.05, z, x, h, z); // 底边贴着海平线 (略低 5cm, 防止抗锯齿露缝)
      aH.push(0, h / maxH);
      aRel.push(0, 1);
      aLayer.push(L.layer, L.layer);
      // 向阳程度: 平滑穹顶 (不含鼓包) 往 +X (太阳一侧) 下降 = 向阳坡
      const slope = (ridgeHeight(az + 1, L.peaks, heightScale) - ridgeHeight(az - 1, L.peaks, heightScale)) / Math.max(0.5, h);
      const lit = THREE.MathUtils.clamp(0.5 - slope * 2.2, 0, 1);
      aLit.push(lit, lit);
      aAz.push(az, az);
      if (prev >= 0 && (h > 0 || hAt(i - 1) > 0)) idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
      prev = base;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
  g.setAttribute('aRel', new THREE.Float32BufferAttribute(aRel, 1));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(aLayer, 1));
  g.setAttribute('aLit', new THREE.Float32BufferAttribute(aLit, 1));
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

/**
 * 沙滩小物件 (单位尺寸, 底面贴 y = 0): 扇贝 / 海螺 / 海星三种形状合在一个几何里, 每个顶点带 aKind (0 / 1 / 2) 与 aUV (着色用的局部坐标)。
 * 实例化时每个实例只显示自己那一种 (顶点着色器把其余两种塌成退化三角形), 所以三种小物件只要 1 次绘制。共 432 三角面 (每个实例实际只画其中 112 ~ 180 个)。
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
  // 扇贝: 扇形穹壳, 边缘呈波浪 (肋数 9), u = 扇形角 0..1, v = 从铰合部到边缘 0..1
  grid(14, 4, (u, v) => {
    const th = (u - 0.5) * 2.6;
    const rr = v * (1 - 0.05 * Math.abs(Math.sin(u * Math.PI * 9)));
    return [Math.sin(th) * rr, 0.42 * (1 - v * v) * Math.pow(Math.cos((u - 0.5) * 2.2), 0.5) + 0.02, -0.45 + Math.cos(th) * rr];
  }, 0);
  // 海螺: 躺在沙上的螺旋锥, u = 绕圈 0..1, v = 从螺口到螺尖 0..1 (每圈鼓一下 = 螺纹)
  grid(10, 7, (u, v) => {
    const a = u * Math.PI * 2;
    const r = (0.36 * Math.pow(1 - v, 0.9) + 0.03) * (1 + 0.12 * Math.sin(v * Math.PI * 2 * 3.5));
    return [-0.5 + v * 1.25, r * 0.95 + Math.sin(a) * r, Math.cos(a) * r];
  }, 1, true);
  // 海星: 五角星的圆润鼓包, u = 方位 0..1, v = 从中心到边缘 0..1
  grid(30, 3, (u, v) => {
    const a = u * Math.PI * 2;
    const arm = Math.pow(Math.abs(Math.cos(a * 2.5)), 2.2);
    const R = 0.34 + 0.66 * arm;
    const rr = v * R;
    return [Math.cos(a) * rr, 0.16 * (1 - v * v) * (0.55 + 0.45 * arm) + 0.01, -Math.sin(a) * rr]; // −sin: 让三角形朝上
  }, 2, true);
  const out = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}
