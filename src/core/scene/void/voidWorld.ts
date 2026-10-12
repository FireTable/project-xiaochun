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

  // 三维深空浮游星尘系统
  private particlesMesh: THREE.Points | null = null;
  private particleGeo: THREE.BufferGeometry | null = null;
  private particleMat: THREE.PointsMaterial | null = null;
  private particleCount = 180;
  private initialPositions: Float32Array | null = null;
  private particlePhases: Float32Array | null = null;
  private particleSpeeds: Float32Array | null = null;

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

  /** 绘制径向漫射光晕背景 (支持微弱呼吸感) */
  private renderAuraBackground(breathFactor: number = 0): void {
    if (!this.bgCanvas || !this.bgCtx) return;
    const ctx = this.bgCtx;
    const size = this.bgCanvas.width;
    const cx = size * 0.5;
    const cy = size * 0.52; // 略微居于视心偏下，贴合角色胸腔后方漫射

    // 1. 底层极暗微蓝深渊
    ctx.fillStyle = '#030407';
    ctx.fillRect(0, 0, size, size);

    // 2. 主体柔和中心径向高斯辉光 (冷夜藏青 -> 深空幽蓝 -> 边缘纯黑)
    const baseRadius = size * (0.62 + breathFactor * 0.03);
    const radGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);
    radGrad.addColorStop(0, 'rgba(16, 24, 42, 0.95)'); // 中心幽邃冷蓝
    radGrad.addColorStop(0.35, 'rgba(10, 15, 28, 0.75)');
    radGrad.addColorStop(0.70, 'rgba(5, 7, 14, 0.40)');
    radGrad.addColorStop(1, 'rgba(3, 4, 7, 0.0)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, size, size);

    // 3. 伴随小春专属主题色的极微暗暮暖粉光晕 (给予纯冷暗场以生命温度)
    const warmRadius = size * 0.45;
    const warmGrad = ctx.createRadialGradient(cx, cy * 0.96, 0, cx, cy * 0.96, warmRadius);
    warmGrad.addColorStop(0, 'rgba(234, 131, 119, 0.075)'); // 极轻微的 7.5% 珊瑚暖色漫射
    warmGrad.addColorStop(0.5, 'rgba(200, 100, 110, 0.025)');
    warmGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = warmGrad;
    ctx.fillRect(0, 0, size, size);

    // 4. 极弱微噪点 (Micro-dither)，彻底杜绝色阶断层 (Color Banding)
    const imgData = ctx.getImageData(0, 0, size, size);
    const data = imgData.data;
    const len = data.length;
    // 稀疏高频微量噪声 (+/- 1~2 色阶)
    for (let i = 0; i < len; i += 16) {
      const noise = (Math.random() - 0.5) * 3;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /** 生成晶莹微发光星尘粒子贴图 (中心纯白凝聚，边缘柔和泛光，偶带微十字光芒) */
  private createStardustParticleTexture(): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = size / 2;
    const cy = size / 2;

    // 柔光微晕
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.18, 'rgba(240, 245, 255, 0.85)');
    grad.addColorStop(0.45, 'rgba(210, 225, 255, 0.35)');
    grad.addColorStop(0.80, 'rgba(160, 190, 255, 0.08)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, cx, 0, Math.PI * 2);
    ctx.fill();

    // 核心微弱十字光晕细线 (增加科幻空间星象质感)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy);
    ctx.lineTo(cx + 16, cy);
    ctx.moveTo(cx, cy - 16);
    ctx.lineTo(cx, cy + 16);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    this.disposables.push(texture);
    return texture;
  }

  /** 构建 3D 深空浮游星尘微粒 */
  private buildStardustSystem(): void {
    const count = this.particleCount;
    const positions = new Float32Array(count * 3);
    const initialPos = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    // 在以角色为中心、半径 6m ~ 28m 的三维球壳深空空间随机散布
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const radius = 6.0 + Math.random() * 22.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta) + 0.8; // 中心稍偏高
      const z = radius * Math.cos(phi) - 2.0;

      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      initialPos[idx] = x;
      initialPos[idx + 1] = y;
      initialPos[idx + 2] = z;

      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.4 + Math.random() * 0.8;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particleGeo = geo;
    this.initialPositions = initialPos;
    this.particlePhases = phases;
    this.particleSpeeds = speeds;
    this.disposables.push(geo);

    const pTex = this.createStardustParticleTexture();
    const mat = new THREE.PointsMaterial({
      size: 0.38,
      map: pTex ?? undefined,
      transparent: true,
      opacity: 0.65,
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

  /** 每帧动画：驱动星尘微粒浮游漂移与微弱呼吸 */
  public update(_delta: number, time: number): void {
    if (!this.isBuilt || !this.active) return;

    // 1. 星尘微粒缓速三维浮动与脉冲呼吸
    if (
      this.particleGeo &&
      this.initialPositions &&
      this.particlePhases &&
      this.particleSpeeds &&
      this.particleMat
    ) {
      const posAttr = this.particleGeo.attributes.position as THREE.BufferAttribute;
      const pos = posAttr.array as Float32Array;
      const init = this.initialPositions;
      const count = this.particleCount;

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const phase = this.particlePhases[i];
        const speed = this.particleSpeeds[i];

        // 极轻微的漂浮位移 (纵深空间慢速呼吸)
        pos[idx] = init[idx] + Math.sin(time * speed * 0.6 + phase) * 0.18;
        pos[idx + 1] = init[idx + 1] + Math.cos(time * speed * 0.5 + phase) * 0.22;
        pos[idx + 2] = init[idx + 2] + Math.sin(time * speed * 0.4 + phase * 1.3) * 0.15;
      }
      posAttr.needsUpdate = true;

      // 整体微弱闪烁呼吸
      const globalBreath = 0.55 + Math.sin(time * 0.8) * 0.15;
      this.particleMat.opacity = globalBreath;
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
    this.initialPositions = null;
    this.particlePhases = null;
    this.particleSpeeds = null;
    this.isBuilt = false;
    this.sceneRef = null;
  }
}
