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
    scene.add(this.group);
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

    // 2. 软影开关 (按主题)
    const isTransparentShadow =
      APP_CONFIG.shadow.softShadow.enabled && isTransparent;
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
    if (this.shadowMaskTex) this.shadowMaskTex.dispose();
  }
}
