import * as THREE from 'three';
import { APP_CONFIG } from '@/config';
import { VOID_SKY_FRAG, VOID_SKY_VERT } from './voidSkyShaders';

/** sRGB 十六进制 → sRGB 0..1 向量 (不做线性化: 渐变要像 CSS 一样在 sRGB 空间插值, 着色器里再转线性) */
function srgbVec(hex: number): THREE.Vector3 {
  return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

function clampN(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

/**
 * VoidWorld — 纯粹虚空场景世界 (新手向导第一相遇空间)
 *
 * 核心美学设计：
 * 1. 纯背景纵深，杜绝任何地台束缚，角色静谧悬浮于深空。
 * 2. 深梅紫渐变夜空 (与 LoadingOverlay / webgl-warp 同一 CSS 径向渐变, 场景内全屏着色器实现, 叠加极淡星云与抖动),
 *    参数见 APP_CONFIG.voidScene (src/core/scene/void/voidConfig.ts)。输出不透明, 兼容 Tauri 透明窗口 + 圆角裁切。
 * 3. 真实三维空间星尘微粒系统 (3D Stardust with Parallax)，用户旋转视角时呈现立体的三维视差流动。
 */
export class VoidWorld {
  public readonly id = 'void';
  public readonly group = new THREE.Group();

  private isBuilt = false;
  private active = false;
  private sceneRef: THREE.Scene | null = null;

  // 兜底背景色 (= 渐变 100% 色标); 夜空四边形未绘制的瞬间也不会露出别的颜色
  private readonly bgColor = new THREE.Color().setHex(APP_CONFIG.voidScene.sky.outer, THREE.SRGBColorSpace);

  // 渐变夜空 (全屏四边形)
  private sky: THREE.Mesh | null = null;
  private skyUniforms: Record<string, THREE.IUniform> | null = null;
  // 后期调色来源 (vrmEngine 注入 postFx.config): OutputPass 在线性 HDR 上做 contrast/brightness,
  // 会把 < ~0.017 的深色直接压成纯黑; 夜空在着色器里做反向补偿, 保证画面 = CSS 取色
  private gradingSource: (() => { enabled: boolean; bc: { brightness: number; contrast: number } } | null) | null = null;

  // 三维深空浮游星尘流系统 (细致微光流萤/星尘)
  private particlesMesh: THREE.Points | null = null;
  private particleGeo: THREE.BufferGeometry | null = null;
  private particleMat: THREE.PointsMaterial | null = null;
  private particleCount = 380; // 细腻微尘流，密度充盈且极速无压力
  private particleSpeeds: Float32Array | null = null;
  private particlePhases: Float32Array | null = null;
  private particleRadii: Float32Array | null = null;
  private particleAngles: Float32Array | null = null;
  private baseColors: Float32Array | null = null;

  // 资源回收清单
  private disposables: Array<{ dispose: () => void }> = [];

  /**
   * 生成极细发光星尘微粒贴图 (Pinpoint Crystal Stardust)
   * 采用高斯指数衰减发光微核，告别大面积肥硕白球，呈现晶莹剔透的高级星钻感
   */
  private createStardustParticleTexture(): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = size / 2;
    const cy = size / 2;

    // 柔光微核 (高锐度中心点 + 极柔散焦外晕)
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx * 0.85);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.08, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.22, 'rgba(239, 246, 255, 0.55)');
    grad.addColorStop(0.48, 'rgba(219, 232, 255, 0.18)');
    grad.addColorStop(0.78, 'rgba(202, 219, 255, 0.04)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, cx * 0.85, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    // 同上: canvas 是 sRGB 像素, 必须显式标注, 否则加色混合的星尘会整体过曝
    texture.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(texture);
    return texture;
  }

  /** 构建 3D 深空细致微尘流系统 (上升微光流萤/星尘) */
  private buildStardustSystem(): void {
    const count = this.particleCount;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);
    const radii = new Float32Array(count);
    const angles = new Float32Array(count);
    const baseColors = new Float32Array(count * 3);

    // 4 种精雕细琢的高级星光基色 (钻石白 / 冰魄蓝 / 丁香微紫 / 浅金珊瑚)
    const palette = [
      new THREE.Color(0xffffff), // 钻石纯白 (45%)
      new THREE.Color(0xd6e8ff), // 冰魄微蓝 (25%)
      new THREE.Color(0xe8ddff), // 丁香微紫 (20%)
      new THREE.Color(0xffecea), // 浅金珊瑚微温 (10%)
    ];

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      // 以角色为中心立体环抱 (半径 0.75m ~ 3.6m，避开面部核心遮挡)
      const r = 0.75 + Math.random() * 2.85;
      const angle = Math.random() * Math.PI * 2;
      // 高度自脚底下方 -0.4m 到头顶上方 2.6m 之间均匀散布
      const y = -0.4 + Math.random() * 3.0;

      radii[i] = r;
      angles[i] = angle;
      // 轻灵微上升速率 (0.07m/s ~ 0.16m/s，柔美诗意缓浮)
      speeds[i] = 0.07 + Math.random() * 0.09;
      phases[i] = Math.random() * Math.PI * 2;

      positions[idx] = Math.cos(angle) * r;
      positions[idx + 1] = y;
      positions[idx + 2] = Math.sin(angle) * r * 0.75; // Z 轴略微压扁，形成自然环绕光幕

      // 赋予微弱不同星系基色
      const pColor = palette[Math.floor(Math.random() * palette.length)];
      colors[idx] = pColor.r;
      colors[idx + 1] = pColor.g;
      colors[idx + 2] = pColor.b;

      baseColors[idx] = pColor.r;
      baseColors[idx + 1] = pColor.g;
      baseColors[idx + 2] = pColor.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.particleGeo = geo;
    this.particleSpeeds = speeds;
    this.particlePhases = phases;
    this.particleRadii = radii;
    this.particleAngles = angles;
    this.baseColors = baseColors;
    this.disposables.push(geo);

    const pTex = this.createStardustParticleTexture();
    const mat = new THREE.PointsMaterial({
      size: 0.052, // 极其细腻的晶莹微尘尺寸 (0.052m，远离原先 0.38m 肥硕大球)
      map: pTex ?? undefined,
      transparent: true,
      opacity: 0.72,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      sizeAttenuation: true,
    });
    this.particleMat = mat;
    this.disposables.push(mat);

    const points = new THREE.Points(geo, mat);
    points.renderOrder = -1; // 保持在后景
    this.particlesMesh = points;
    this.group.add(points);
  }

  /** 构建渐变夜空: 全屏四边形, 最先绘制 (renderOrder -1000), 不写深度, 不参与视锥剔除 */
  private buildSky(): void {
    const cfg = APP_CONFIG.voidScene;
    const midStop = clampN(cfg.sky.midStop, 0.1, 0.9);
    const uniforms: Record<string, THREE.IUniform> = {
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uInner: { value: srgbVec(cfg.sky.inner) },
      uMid: { value: srgbVec(cfg.sky.mid) },
      uOuter: { value: srgbVec(cfg.sky.outer) },
      uMidStop: { value: midStop },
      uCenter: { value: new THREE.Vector2(cfg.sky.center[0], cfg.sky.center[1]) },
      uRadius: { value: new THREE.Vector2(Math.max(0.05, cfg.sky.radius[0]), Math.max(0.05, cfg.sky.radius[1])) },
      uPlum: { value: srgbVec(cfg.nebula.plum) },
      uApricot: { value: srgbVec(cfg.nebula.apricot) },
      uNebula: { value: clampN(cfg.nebula.strength, 0, 0.15) },
      uScale: { value: clampN(cfg.nebula.scale, 0.5, 4) },
      uTime: { value: 0 },
      uDither: { value: clampN(cfg.dither, 0, 2) },
      uComp: { value: 1 },
      uContrast: { value: 0 },
      uBright: { value: 0 },
    };
    this.skyUniforms = uniforms;

    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VOID_SKY_VERT,
      fragmentShader: VOID_SKY_FRAG,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.disposables.push(geo, mat);

    const sky = new THREE.Mesh(geo, mat);
    sky.name = 'VoidSky';
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    sky.onBeforeRender = (renderer, _s, camera) => {
      (uniforms.uInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
      (uniforms.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
      // 抵消线性色调映射曝光, 让画面颜色 = 配置色 (= CSS 取色); 与 Beach3DSky 同一规则
      const exp = renderer.toneMapping === THREE.LinearToneMapping ? renderer.toneMappingExposure : 1;
      uniforms.uComp.value = 1 / Math.max(0.2, exp || 1);
      // 只有画进 composer 的离屏 RT 时才会再经过 OutputPass 调色; 直出屏幕 (postfx 关闭) 不补偿
      const grading = renderer.getRenderTarget() !== null ? this.gradingSource?.() : null;
      const on = !!grading && grading.enabled;
      uniforms.uContrast.value = on ? clampN(grading!.bc.contrast, -0.9, 2) : 0;
      uniforms.uBright.value = on ? clampN(grading!.bc.brightness, -1, 1) : 0;
    };
    this.sky = sky;
    this.group.add(sky);
  }

  /** 注入后期调色参数来源 (通常是 postFxPipeline.config), 用于反向补偿 OutputPass 的 contrast / brightness */
  public setGradingSource(
    source: (() => { enabled: boolean; bc: { brightness: number; contrast: number } } | null) | null,
  ): void {
    this.gradingSource = source;
  }

  /** 获取渐变夜空网格（用于测试或外部调试） */
  public get skyMesh(): THREE.Mesh | null {
    return this.sky;
  }

  /** 构建虚空世界 */
  public build(scene: THREE.Scene): void {
    if (this.isBuilt) return;
    this.sceneRef = scene;

    this.buildSky();
    this.buildStardustSystem();

    this.group.visible = false;
    scene.add(this.group);
    this.isBuilt = true;
  }

  /** 挂载至主场景 */
  public attach(scene: THREE.Scene): void {
    if (!this.isBuilt) {
      this.build(scene);
    } else if (this.sceneRef !== scene) {
      this.sceneRef = scene;
      scene.add(this.group);
    }
  }

  /** 激活 / 隐藏虚空世界 */
  public setActive(active: boolean, scene?: THREE.Scene): void {
    this.active = active;
    const targetScene = scene || this.sceneRef;

    this.group.visible = active;
    if (active && targetScene) {
      targetScene.background = this.bgColor;
    }
  }

  /** 获取星尘粒子网格（用于测试或外部调试） */
  public get mesh(): THREE.Points | null {
    return this.particlesMesh;
  }

  /** 每帧动画：驱动星尘微粒轻灵上升流动与自然呼吸 */
  public update(delta: number, time: number): void {
    if (!this.isBuilt || !this.active) return;

    if (this.skyUniforms) {
      this.skyUniforms.uTime.value = time * clampN(APP_CONFIG.voidScene.nebula.driftSpeed, 0, 0.03);
    }

    // 1. 驱动微光流萤/星尘自下而上缓缓飘散
    if (
      this.particleGeo &&
      this.particleRadii &&
      this.particleAngles &&
      this.particleSpeeds &&
      this.particlePhases &&
      this.baseColors &&
      this.particleMat
    ) {
      const posAttr = this.particleGeo.attributes.position as THREE.BufferAttribute;
      const colAttr = this.particleGeo.attributes.color as THREE.BufferAttribute;
      const pos = posAttr.array as Float32Array;
      const col = colAttr.array as Float32Array;
      const baseCol = this.baseColors;
      const count = this.particleCount;
      const dt = Math.min(delta, 0.05);

      const topLimit = 2.65;
      const bottomLimit = -0.45;
      const totalHeight = topLimit - bottomLimit;

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const speed = this.particleSpeeds[i];
        const phase = this.particlePhases[i];
        const r = this.particleRadii[i];
        const angle = this.particleAngles[i];

        // 持续微速上升
        pos[idx + 1] += speed * dt;

        // 飞出顶界后平滑循环回底部，并重新随机径向角度
        if (pos[idx + 1] > topLimit) {
          pos[idx + 1] = bottomLimit + Math.random() * 0.15;
          this.particleRadii[i] = 0.75 + Math.random() * 2.85;
          this.particleAngles[i] = Math.random() * Math.PI * 2;
        }

        // 空间极柔和对流微摇摆 (幅度仅 3~5cm)
        const currentAngle = angle + Math.sin(time * 0.25 + phase) * 0.08;
        pos[idx] = Math.cos(currentAngle) * r + Math.sin(time * 0.45 + phase) * 0.04;
        pos[idx + 2] = Math.sin(currentAngle) * r * 0.75 + Math.cos(time * 0.35 + phase) * 0.04;

        // 上下边界渐隐渐现 (底部生发淡入，顶部消散淡出)，确保流动毫无突兀
        const normalizedY = (pos[idx + 1] - bottomLimit) / totalHeight;
        let fade = 1.0;
        if (normalizedY < 0.15) {
          fade = normalizedY / 0.15;
        } else if (normalizedY > 0.85) {
          fade = (1.0 - normalizedY) / 0.15;
        }

        // 微弱单个微尘明灭闪烁 (Scintillation)
        const twinkle = 0.70 + Math.sin(time * (speed * 18.0) + phase) * 0.30;
        const lum = Math.max(0, fade * twinkle);

        col[idx] = baseCol[idx] * lum;
        col[idx + 1] = baseCol[idx + 1] * lum;
        col[idx + 2] = baseCol[idx + 2] * lum;
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;

      // 整体氛围微弱宏观呼吸
      this.particleMat.opacity = 0.70 + Math.sin(time * 0.45) * 0.08;
    }
  }

  /** 销毁释放全部资源 */
  public dispose(scene?: THREE.Scene): void {
    this.active = false;
    const targetScene = scene || this.sceneRef;

    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];

    if (targetScene && targetScene.background === this.bgColor) {
      targetScene.background = null;
    }

    if (targetScene) {
      targetScene.remove(this.group);
    }
    this.group.clear();

    this.sky = null;
    this.skyUniforms = null;
    this.particlesMesh = null;
    this.particleGeo = null;
    this.particleMat = null;
    this.particleSpeeds = null;
    this.particlePhases = null;
    this.particleRadii = null;
    this.particleAngles = null;
    this.baseColors = null;
    this.isBuilt = false;
    this.sceneRef = null;
  }
}
