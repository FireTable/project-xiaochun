import * as THREE from 'three';
import { GUIDE_SHADOW, GUIDE_SHADOW_RGB } from './guideStyle';

/**
 * 3D 调整引导 (turn / pitch / cameraY) 的柔和深色阴影 — 与窗口四角弧线 (components/CornerHandle) 同一视觉规范:
 * 白色主体不变, 底下垫一层低透明度 (约 30%)、大模糊半径、无硬边的深色光晕。
 *
 * 阴影在主体覆盖的区域是被抠掉的 (主体半透明时不会透出阴影的脏边)。
 * 引导本体用 AdditiveBlending (只会加亮), 浅色背景上白色会"隐形", 加亮混合也画不出暗色, 所以阴影是单独一层
 * NormalBlending 的 mesh / sprite: 把引导贴图的 alpha 先"膨胀"再高斯模糊, 烘焙成纯黑贴图, 作为引导 mesh 的子对象
 * (继承位置 / 缩放 / 悬停放大), 渲染顺序在引导之前。深色背景上黑色光晕几乎不可见, 不显脏。
 */
// 参数集中在 guideStyle.ts (与四角弧线共用), 这里 re-export 方便同目录引用
export { GUIDE_SHADOW } from './guideStyle';

export interface GuideShadowLayer {
  obj: THREE.Mesh | THREE.Sprite;
  mat: THREE.MeshBasicMaterial | THREE.SpriteMaterial;
  tex: THREE.CanvasTexture;
}

interface BakeOpts {
  /** 画布四周额外留白 (px), 给模糊溢出用 */
  padX?: number;
  padY?: number;
}

/** 把 src 的 alpha 烘焙成"膨胀 + 高斯模糊"的黑色阴影画布。canvas 不可用 (测试环境) 时返回空白画布。 */
export function bakeGuideShadowCanvas(src: HTMLCanvasElement, { padX = 0, padY = 0 }: BakeOpts = {}): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width + padX * 2;
  out.height = src.height + padY * 2;
  const ctx = out.getContext('2d');
  if (!ctx) return out;
  // 经典技巧: 把原图画到画布外, 只留下它的 shadow
  const off = out.width + 64;
  ctx.shadowColor = `rgba(${GUIDE_SHADOW_RGB}, 1)`;
  ctx.shadowBlur = GUIDE_SHADOW.blur;
  ctx.shadowOffsetX = off;
  ctx.shadowOffsetY = 0;
  const s = GUIDE_SHADOW.spread;
  const offsets: Array<[number, number]> = [[0, 0]];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    offsets.push([Math.cos(a) * s, Math.sin(a) * s]);
  }
  // 每个偏移画两遍, 让低 alpha 的点 (0.4) 的阴影也能积到接近饱和
  for (const [dx, dy] of offsets) {
    ctx.drawImage(src, padX + dx - off, padY + dy);
    ctx.drawImage(src, padX + dx - off, padY + dy);
  }
  // 把主体自己覆盖的区域从阴影里抠掉: 主体半透明时 (GUIDE_OPACITY) 才不会透出下面阴影的脏边,
  // 阴影只留在主体外围 (需要先关掉 shadow, 否则 destination-out 也会画出阴影)
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 3; i++) ctx.drawImage(src, padX, padY);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

function noRaycast(): void {}

function bakeTexture(src: HTMLCanvasElement, opts: BakeOpts, wrapS: THREE.Wrapping, wrapT: THREE.Wrapping): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(bakeGuideShadowCanvas(src, opts));
  tex.wrapS = wrapS;
  tex.wrapT = wrapT;
  return tex;
}

/** 给引导 mesh 挂一层阴影 (共用其几何体; 作为子对象跟随变换)。padX/padY>0 时子 mesh 按比例放大以容纳模糊溢出。 */
export function attachMeshShadow(
  parent: THREE.Mesh,
  src: HTMLCanvasElement,
  opts: BakeOpts & { wrapS?: THREE.Wrapping; wrapT?: THREE.Wrapping; depthTest?: boolean; renderOrder?: number } = {},
): GuideShadowLayer {
  const tex = bakeTexture(src, opts, opts.wrapS ?? THREE.ClampToEdgeWrapping, opts.wrapT ?? THREE.ClampToEdgeWrapping);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthTest: opts.depthTest ?? true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(parent.geometry, mat);
  mesh.renderOrder = opts.renderOrder ?? 19;
  mesh.frustumCulled = false;
  mesh.raycast = noRaycast; // 绝不参与拾取
  mesh.scale.set(1 + (2 * (opts.padX ?? 0)) / src.width, 1 + (2 * (opts.padY ?? 0)) / src.height, 1);
  parent.add(mesh);
  return { obj: mesh, mat, tex };
}

/** 给引导 sprite (相机图标) 挂一层阴影子 sprite。 */
export function attachSpriteShadow(parent: THREE.Sprite, src: HTMLCanvasElement, opts: BakeOpts = {}): GuideShadowLayer {
  const tex = bakeTexture(src, opts, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    color: 0x000000,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 19;
  sprite.raycast = noRaycast;
  sprite.scale.set(1 + (2 * (opts.padX ?? 0)) / src.width, 1 + (2 * (opts.padY ?? 0)) / src.height, 1);
  parent.add(sprite);
  return { obj: sprite, mat, tex };
}

/** 跟随引导自身 opacity (0..1) 设置阴影不透明度。 */
export function setGuideShadowOpacity(layer: GuideShadowLayer | null, guideOpacity: number): void {
  if (layer) layer.mat.opacity = guideOpacity * GUIDE_SHADOW.alpha;
}

export function disposeGuideShadow(layer: GuideShadowLayer | null): void {
  if (!layer) return;
  layer.mat.dispose();
  layer.tex.dispose();
}
