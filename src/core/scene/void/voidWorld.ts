import * as THREE from 'three';

/**
 * VoidWorld — 纯粹虚空场景世界 (新手向导第一相遇空间)
 *
 * 核心美学设计：
 * 1. 纯背景纵深，杜绝任何地台束缚，角色静谧悬浮于深空。
 * 2. 电影级以角色为中心的 360° 径向漫射光晕 (Deep Midnight & Subtle Coral Aura)。
 * 3. 真实三维空间星尘微粒系统 (3D Stardust with Parallax)，用户旋转视角时呈现立体的三维视差流动。
 */
export class VoidWorld {
  public readonly id = 'void';
  public readonly group = new THREE.Group();

  private isBuilt = false;
  private active = false;
  private sceneRef: THREE.Scene | null = null;

  // 背景天顶贴图与画布
  private bgTexture: THREE.CanvasTexture | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private bgCtx: CanvasRenderingContext2D | null = null;

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
   * 构造 1024x1024 电影级双重径向暗场漫射贴图
   * 中心偏下微晕 (冷幽蓝 #0c1220 融合小春珊瑚粉 #160f16)，边缘极暗天鹅绒黑 (#030406)，带防断层噪点微扰
   */
  private createCinematicAuraTexture(): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    this.bgCanvas = canvas;
    this.bgCtx = ctx;

    this.renderAuraBackground(0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    this.disposables.push(texture);
    return texture;
  }

  /** 绘制径向漫射光晕背景 (微立柱影棚柔光) */
  private renderAuraBackground(breathFactor: number = 0): void {
    if (!this.bgCanvas || !this.bgCtx) return;
    const ctx = this.bgCtx;
    const size = this.bgCanvas.width;
    const cx = size * 0.5;
    const cy = size * 0.48; // 略微居于视心，形成角色身后的纵深光幕

    // 1. 底层极暗微蓝深渊
    ctx.fillStyle = '#020306';
    ctx.fillRect(0, 0, size, size);

    // 2. 主体柔和中心径向高斯辉光 (冷夜藏青 -> 深空幽蓝 -> 边缘纯黑)
    const baseRadius = size * (0.60 + breathFactor * 0.03);
    const radGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);
    radGrad.addColorStop(0, 'rgba(18, 26, 46, 0.95)'); // 中心幽邃冷蓝
    radGrad.addColorStop(0.32, 'rgba(12, 17, 32, 0.78)');
    radGrad.addColorStop(0.68, 'rgba(6, 9, 18, 0.40)');
    radGrad.addColorStop(1, 'rgba(2, 3, 6, 0.0)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, size, size);

    // 3. 伴随小春专属主题色的极微暗暮暖粉光晕 (给予纯冷暗场以生命温度)
    const warmRadius = size * 0.42;
    const warmGrad = ctx.createRadialGradient(cx, cy * 0.98, 0, cx, cy * 0.98, warmRadius);
    warmGrad.addColorStop(0, 'rgba(234, 131, 119, 0.085)'); // 极轻微的 8.5% 珊瑚暖色漫射
    warmGrad.addColorStop(0.48, 'rgba(200, 100, 110, 0.025)');
    warmGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = warmGrad;
    ctx.fillRect(0, 0, size, size);

    // 4. 极弱微噪点 (Micro-dither)，彻底杜绝色阶断层 (Color Banding)
    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    const len = data.length;
    for (let i = 0; i < len; i += 16) {
      const noise = (Math.random() - 0.5) * 3;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);
  }

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
    grad.addColorStop(0.22, 'rgba(220, 235, 255, 0.55)');
    grad.addColorStop(0.48, 'rgba(180, 205, 255, 0.18)');
    grad.addColorStop(0.78, 'rgba(150, 180, 255, 0.04)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, cx * 0.85, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
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

  /** 构建虚空世界 */
  public build(scene: THREE.Scene): void {
    if (this.isBuilt) return;
    this.sceneRef = scene;

    this.bgTexture = this.createCinematicAuraTexture();
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
      targetScene.background = this.bgTexture;
    }
  }

  /** 获取星尘粒子网格（用于测试或外部调试） */
  public get mesh(): THREE.Points | null {
    return this.particlesMesh;
  }

  /** 每帧动画：驱动星尘微粒轻灵上升流动与自然呼吸 */
  public update(delta: number, time: number): void {
    if (!this.isBuilt || !this.active) return;

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

    if (targetScene && targetScene.background === this.bgTexture) {
      targetScene.background = null;
    }

    if (this.bgTexture) {
      this.bgTexture.dispose();
      this.bgTexture = null;
    }
    this.bgCanvas = null;
    this.bgCtx = null;

    if (targetScene) {
      targetScene.remove(this.group);
    }
    this.group.clear();

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
