import * as THREE from 'three';
import { APP_CONFIG } from '@/config';
import type { LineworkTheme } from '@/config';

/**
 * CharacterShadowSystem — 角色脚下阴影系统。
 *
 * 责任:
 * - 建 shadowPlane + ShadowMaterial (带 radial alpha mask onBeforeCompile)
 * - transparent 主题下走软影 (radial mask + 屏幕边界 fade)
 * - 其他主题走原版 plane 全显不裁不淡
 *
 * ponytail: 从 vrmEngine 拆出来, 不动现有外部 API —
 * vrmEngine.initScene 调 init(scene, theme), animate loop 写 feetWorld 然后调 update(camera, isTransparent),
 * setLineworkTheme 链路上保留 updateShadowForTheme 走 updateOpacity, dispose 调 dispose()。
 * 其它代码 (App.tsx 等) 完全感知不到这次拆。
 */
export class CharacterShadowSystem {
  public readonly group = new THREE.Group();
  /** ponytail: 外部 (vrmEngine) 每帧从 VRM 双脚骨头算出来写入, update() 用它定位 plane */
  public feetWorld = new THREE.Vector3();

  private shadowPlane: THREE.Mesh | null = null;
  /** 海滩场景专用: 脚下一块柔和的圆形接触影 (没有地面网格时, 光靠方向光落影脚下会"飘")。其它场景不可见。 */
  private contactBlob: THREE.Mesh | null = null;
  private contactTex: THREE.CanvasTexture | null = null;
  /** 海滩场景专用: 脚下一块边缘柔和淡出的沙色圆盘 (真实 3D 地面), 脚没入画面时才显示。参数见 APP_CONFIG.beachScene.ground。 */
  private sandGround: THREE.Mesh | null = null;
  private sandUniforms: Record<string, THREE.IUniform> | null = null;
  private readonly tempFeetNdc = new THREE.Vector3();
  private beach = false;
  private shadowMaskTex: THREE.CanvasTexture | null = null;
  private _shadowEdgeFadeUniform: { value: number } | null = null;
  private _shadowSoftUniform: { value: number } | null = null;
  private tempShadowNdc = new THREE.Vector3();

  /**
   * ponytail: 在 vrmEngine.initScene 调一次, 建 mesh + mask texture + 加到 scene。
   * theme 传进来决定初始 opacity。
   */
  public init(scene: THREE.Scene, theme: LineworkTheme): void {
    const shadowCfg = APP_CONFIG.shadow;
    const shadowPlaneGeo = new THREE.PlaneGeometry(shadowCfg.planeSize, shadowCfg.planeSize);
    const shadowPlaneMat = new THREE.ShadowMaterial({
      // ponytail: 之前没显式设 color, 用 ShadowMaterial 默认 0x000000 (纯黑)。
      // 在任何底色上叠出来, 视觉是 "底色 × (1 - opacity × shadowMask)" — 黑色版直接
      // 跟原配色一致, 不另加暖 / 冷调。opacity 从 config 读。
      opacity: theme === 'dark' ? shadowCfg.opacityDark : shadowCfg.opacityLight,
      depthWrite: false, // 禁用深度写入，杜绝地面线框网格发生深度剔除与 Z-fighting 颜色变浅/闪烁
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    // ponytail: radial alpha mask — 让 shadowPlane 自身从中心到边缘平滑 fade 到透明,
    // directional light 投到 plane 上的影子只在 mask 内可见, 边界平滑渐隐 (PCFSoftShadowMap
    // 本身的 penumbra + 这个 radial mask, 模拟 ani 那种远端淡出的影子)。
    // stops 从 APP_CONFIG.shadow.softShadow.radialStops 读, 改 config 不用碰这里。
    const shadowMaskCanvas = document.createElement('canvas');
    shadowMaskCanvas.width = 256;
    shadowMaskCanvas.height = 256;
    const mCtx = shadowMaskCanvas.getContext('2d')!;
    const mGrad = mCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
    const alphaToHex = (a: number) =>
      a <= 0 ? '#000000' : a >= 1 ? '#ffffff' : `#${Math.round(a * 255).toString(16).padStart(2, '0').repeat(3)}`;
    for (const stop of shadowCfg.softShadow.radialStops) {
      mGrad.addColorStop(stop.pos, alphaToHex(stop.alpha));
    }
    mCtx.fillStyle = mGrad;
    mCtx.fillRect(0, 0, 256, 256);

    this.shadowMaskTex = new THREE.CanvasTexture(shadowMaskCanvas);
    this.shadowMaskTex.colorSpace = THREE.NoColorSpace;
    this.shadowMaskTex.minFilter = THREE.LinearFilter;

    shadowPlaneMat.onBeforeCompile = (shader) => {
      shader.uniforms.uShadowMask = { value: this.shadowMaskTex };
      // ponytail: 屏幕边界 fade uniform — 每帧从 CPU 算角色脚底 NDC 距离写入,
      // shader 里乘到 mask 上让影子接近 canvas 边时提前渐隐, 不被硬切。
      shader.uniforms.uShadowEdgeFade = { value: 1.0 };
      // ponytail: 软影开关 — transparent 主题下 =1.0 (走 radial mask + edge fade),
      // light / dark 主题下 =0.0 (原版直接渲染, plane 全显不裁不淡)。
      shader.uniforms.uShadowSoft = { value: 0.0 };
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        'varying vec2 vShadowMaskUv;\nvoid main() {\nvShadowMaskUv = uv;',
      );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'uniform vec3 color;',
          'uniform vec3 color;\nuniform sampler2D uShadowMask;\nuniform float uShadowEdgeFade;\nuniform float uShadowSoft;\nvarying vec2 vShadowMaskUv;',
        )
        .replace(
          '\tgl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
          '\tfloat shadowSoftMask = texture2D(uShadowMask, vShadowMaskUv).r * uShadowEdgeFade;\n\tgl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) * mix( 1.0, shadowSoftMask, uShadowSoft ) );',
        );
      this._shadowEdgeFadeUniform = shader.uniforms.uShadowEdgeFade;
      this._shadowSoftUniform = shader.uniforms.uShadowSoft;
    };
    shadowPlaneMat.customProgramCacheKey = () => 'shadowMaskV12';

    this.shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = shadowCfg.planeY;
    this.shadowPlane.renderOrder = 1; // 阴影平面在底层优先渲染
    this.shadowPlane.receiveShadow = true;

    this.group.add(this.shadowPlane);

    // 接触影: 径向渐变 (中心实 → 边缘全透明), 平铺在地面上, 每帧跟脚底
    const cc = document.createElement('canvas');
    cc.width = cc.height = 128;
    const cctx = cc.getContext('2d')!;
    const cg = cctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    cg.addColorStop(0.0, 'rgba(255,255,255,1)');
    cg.addColorStop(0.35, 'rgba(255,255,255,0.72)');
    cg.addColorStop(0.7, 'rgba(255,255,255,0.22)');
    cg.addColorStop(1.0, 'rgba(255,255,255,0)');
    cctx.fillStyle = cg;
    cctx.fillRect(0, 0, 128, 128);
    this.contactTex = new THREE.CanvasTexture(cc);
    const blobMat = new THREE.MeshBasicMaterial({
      map: this.contactTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      toneMapped: false,
    });
    this.contactBlob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), blobMat);
    this.contactBlob.rotation.x = -Math.PI / 2;
    this.contactBlob.renderOrder = 0;
    this.contactBlob.visible = false;
    this.group.add(this.contactBlob);

    // 沙地: 径向羽化的沙色圆盘, 贴地 (略低于落影平面), 画在落影 / 接触影之下、角色之后; 不写深度, 只在 beach 显示
    this.sandUniforms = {
      uColor: { value: new THREE.Color(0xf2e1c5) },
      uOpacity: { value: 1 },
      uVis: { value: 0 },
      uFeather: { value: 0.45 },
      uRipple: { value: 0.05 },
      uRadius: { value: 1.8 },
      uComp: { value: 1 },
    };
    const sandMat = new THREE.ShaderMaterial({
      uniforms: this.sandUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor; uniform float uOpacity; uniform float uVis; uniform float uFeather; uniform float uRipple;
        uniform float uRadius; uniform float uComp;
        varying vec2 vUv;
        void main() {
          vec2 q = (vUv - 0.5) * 2.0;           // −1..1, 圆盘边缘 r=1
          float r = length(q);
          float edge = 1.0 - smoothstep(uFeather, 1.0, r);
          edge *= edge;                          // 平方: 边缘更柔, 与背景沙地无硬边
          vec2 w = q * uRadius;                  // 世界米坐标 (相对脚底)
          // 赛璐璐风的浅沙纹: 两组缓慢斜向条带叠加, 只做很轻的明暗
          float rip = 0.5 + 0.25 * sin(w.x * 5.5 + w.y * 2.2 + sin(w.y * 3.1) * 1.3) + 0.25 * sin(w.y * 7.5 - w.x * 1.7 + sin(w.x * 2.3) * 1.1);
          vec3 col = uColor * (1.0 - uRipple + uRipple * 2.0 * rip);
          float a = edge * uOpacity * uVis;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col * uComp, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      // 与背景粒子相同: 颜色正常混合, 但不改目标 alpha (走后期时背景像素的 0.99 标记要保留, 否则 Bloom 会把亮沙地泛光洗白)
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.sandGround = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sandMat);
    this.sandGround.rotation.x = -Math.PI / 2;
    this.sandGround.renderOrder = -20;
    this.sandGround.frustumCulled = false;
    // 曝光补偿: 线性色调映射会乘 exposure, 除回去让沙色与背景沙地一致 (同 beachBackdrop 的 uComp)
    this.sandGround.onBeforeRender = (renderer) => {
      const exp = renderer.toneMapping === THREE.LinearToneMapping ? renderer.toneMappingExposure : 1;
      if (this.sandUniforms) this.sandUniforms.uComp.value = 1 / Math.max(0.2, exp || 1);
    };
    this.sandGround.visible = false;
    this.group.add(this.sandGround);

    scene.add(this.group);
    this.applyTheme(theme);
  }

  /**
   * 场景级配色: beach 下地面落影改奶茶褐偏粉 + 更淡, 并打开脚下接触影 (颜色匹配奶油沙地); 其它场景恢复原版 (黑色落影, 无接触影)。
   * 参数见 APP_CONFIG.beachScene.blend。
   */
  public applyTheme(theme: LineworkTheme): void {
    this.beach = theme === 'beach';
    const b = APP_CONFIG.beachScene.blend;
    if (this.shadowPlane && this.shadowPlane.material instanceof THREE.ShadowMaterial) {
      const m = this.shadowPlane.material;
      if (this.beach) {
        m.color.setHex(b.shadowColor);
        m.opacity = b.shadowOpacity;
      } else {
        m.color.setHex(0x000000);
        m.opacity = theme === 'dark' ? APP_CONFIG.shadow.opacityDark : APP_CONFIG.shadow.opacityLight;
      }
      m.needsUpdate = true;
    }
    if (this.sandGround && this.sandUniforms) {
      const g = APP_CONFIG.beachScene.ground;
      this.sandGround.visible = this.beach && g.enabled;
      (this.sandUniforms.uColor.value as THREE.Color).setHex(g.color);
      this.sandUniforms.uOpacity.value = g.opacity;
      this.sandUniforms.uFeather.value = g.featherStart;
      this.sandUniforms.uRipple.value = g.rippleStrength;
      this.sandUniforms.uRadius.value = g.radiusM;
      this.sandGround.scale.set(g.radiusM * 2, g.radiusM * 2, 1);
    }
    if (this.contactBlob) {
      this.contactBlob.visible = this.beach;
      const mat = this.contactBlob.material as THREE.MeshBasicMaterial;
      mat.color.setHex(b.contactColor);
      mat.opacity = b.contactOpacity;
      this.contactBlob.scale.set(b.contactSizeM, b.contactSizeM, 1);
    }
  }

  /** ponytail: 切主题时调 (vrmEngine.setLineworkTheme → updateShadowForTheme → 这), 改 opacity */
  public updateOpacity(isDark: boolean): void {
    if (this.shadowPlane && this.shadowPlane.material instanceof THREE.ShadowMaterial) {
      const sc = APP_CONFIG.shadow;
      this.shadowPlane.material.opacity = isDark ? sc.opacityDark : sc.opacityLight;
      this.shadowPlane.material.needsUpdate = true;
    }
  }

  /**
   * ponytail: 每帧 animate loop 调, 同步脚底位置 + NDC edge fade + 软影开关。
   * feetWorld 由外部 (vrmEngine) 在调 update 前写入。
   */
  public update(camera: THREE.Camera, isTransparent: boolean): void {
    if (!this.shadowPlane) return;

    // 1. 平面 XZ 跟脚底, Y 贴地
    this.shadowPlane.position.x = this.feetWorld.x;
    this.shadowPlane.position.z = this.feetWorld.z;
    this.shadowPlane.position.y = APP_CONFIG.shadow.planeY;
    if (this.sandGround?.visible && this.sandUniforms) {
      this.sandGround.position.set(this.feetWorld.x, APP_CONFIG.shadow.planeY - 0.0004, this.feetWorld.z);
      // 脚底进入画面才显示: 半身取景 (脚在画面外) 保持原样; 全身 / 俯视 (脚在画面里) 淡入
      const g = APP_CONFIG.beachScene.ground;
      this.tempFeetNdc.copy(this.feetWorld).project(camera);
      const t = (this.tempFeetNdc.y - g.fadeOutNdcY) / Math.max(1e-3, g.fadeInNdcY - g.fadeOutNdcY);
      this.sandUniforms.uVis.value = Math.min(1, Math.max(0, t));
    }
    if (this.contactBlob?.visible) {
      this.contactBlob.position.set(this.feetWorld.x, APP_CONFIG.shadow.planeY + 0.0004, this.feetWorld.z);
    }

    // 2. 软影开关 (按主题)
    // beach 与透明场景一样走软影 (径向淡出, 无硬边): 沙地背景是一张图, 没有"地面边界"可以让落影硬切
    const isTransparentShadow =
      APP_CONFIG.shadow.softShadow.enabled && (isTransparent || this.beach);
    if (this._shadowSoftUniform) {
      this._shadowSoftUniform.value = isTransparentShadow ? 1.0 : 0.0;
    }

    // 3. 屏幕边界 fade (仅 transparent 主题下算)
    if (this._shadowEdgeFadeUniform && camera) {
      if (isTransparentShadow) {
        this.tempShadowNdc.copy(this.shadowPlane.position).project(camera);
        const edgeDist = Math.max(
          Math.abs(this.tempShadowNdc.x),
          Math.abs(this.tempShadowNdc.y),
        );
        const clamped = Math.min(1, edgeDist);
        const sc = APP_CONFIG.shadow.softShadow;
        const fadeMul = 1 - THREE.MathUtils.smoothstep(clamped, sc.edgeFadeStart, sc.edgeFadeEnd);
        this._shadowEdgeFadeUniform.value = fadeMul;
      } else {
        this._shadowEdgeFadeUniform.value = 1.0;
      }
    }
  }

  /** ponytail: HMR / 重挂载 WebGL 上下文后, 给材质 needsUpdate=true 强制重新编译 */
  public markNeedsUpdate(): void {
    if (this.shadowPlane && this.shadowPlane.material) {
      const mat = this.shadowPlane.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => { m.needsUpdate = true; });
      } else {
        mat.needsUpdate = true;
      }
    }
  }

  public dispose(): void {
    if (this.shadowPlane) {
      this.shadowPlane.geometry.dispose();
      const mat = this.shadowPlane.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat instanceof THREE.Material) mat.dispose();
      this.group.remove(this.shadowPlane);
    }
    if (this.contactBlob) {
      this.contactBlob.geometry.dispose();
      (this.contactBlob.material as THREE.Material).dispose();
      this.group.remove(this.contactBlob);
    }
    if (this.sandGround) {
      this.sandGround.geometry.dispose();
      (this.sandGround.material as THREE.Material).dispose();
      this.group.remove(this.sandGround);
    }
    this.contactTex?.dispose();
    if (this.shadowMaskTex) this.shadowMaskTex.dispose();
  }
}
