/**
 * PostFxPipeline — 二次元后期效果
 *
 * ponytail: 一个类管所有 effect,init() 一次,render(dt) 每帧调。effect 实例全部
 * public,Drawer 滑杆直接改字段。applyConfig() 把 config 同步到 effect 实例 +
 * renderer.toneMapping。
 *
 * 实现选择 (踩坑记录): 一开始用 pmndrs/postprocessing 的 EffectComposer,跟 three
 * 的 outputColorSpace / toneMapping 兼容有问题,色彩要么过曝要么全黑。改用 three
 * 自带的 EffectComposer (颜色链路稳)。
 * Pass 顺序: RenderPass → UnrealBloomPass → OutputPass (融合 ColorGrading + ToneMapping + sRGB + IGN Dithering)
 *
 * 主 RT 全分辨率呈现；Bloom 经 bloomInputScale 后再 /2（默认实际 ≈ 主 RT 1/4）。
 * 主 RT MSAA：移动 `composerMSAASamplesMobile` / 桌面 `composerMSAASamplesDesktop`。
 * 透明桌宠同样走 composer（抗锯齿在主 RT）；bloom 不加 alpha。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { getRenderPixelRatio } from '@/lib/utils';
import { isMobile } from '@/lib/platform';
import { APP_CONFIG } from '@/config';

export interface PostFxConfig {
  enabled: boolean;
  bloom: { strength: number; radius: number; threshold: number };
  vignette: { darkness: number; offset: number };
  toneMapping: { mode: THREE.ToneMapping; exposure: number };
  bc: { brightness: number; contrast: number };
  hs: { hue: number; saturation: number };
}

export const getDefaultPostFxConfig = (): PostFxConfig => ({
  enabled: APP_CONFIG.postfx.enabled,
  bloom: { ...APP_CONFIG.postfx.bloom },
  vignette: { ...APP_CONFIG.postfx.vignette },
  toneMapping: { ...APP_CONFIG.postfx.toneMapping },
  bc: { ...APP_CONFIG.postfx.bc },
  hs: { ...APP_CONFIG.postfx.hs },
});

export const DEFAULT_POSTFX_CONFIG: PostFxConfig = Object.freeze(getDefaultPostFxConfig());

export class PostFxPipeline {
  public composer: EffectComposer | null = null;
  public bloom: UnrealBloomPass | null = null;
  public outputPass: OutputPass | null = null;

  // 向后兼容旧字段 (ColorGrading 已直接融合进 outputPass 单次全屏计算)
  public get colorGrading(): any { return this.outputPass; }
  public get vignette(): any { return this.outputPass; }
  public get bc(): any { return this.outputPass; }
  public get hs(): any { return this.outputPass; }
  public config: PostFxConfig = { ...DEFAULT_POSTFX_CONFIG };
  public onEnabledChange: ((enabled: boolean) => void) | null = null;

  private _renderer: THREE.WebGLRenderer | null = null;
  private _ready = false;
  private _lastAppliedEnabled: boolean | null = null;

  init(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (this._ready && this._renderer === renderer) return;
    if (this._ready) {
      this.dispose();
    }
    this._renderer = renderer;

    const pixelRatio = getRenderPixelRatio();
    const size = renderer.getSize(new THREE.Vector2());
    const mobile = isMobile();
    // 桌面端保持 4x MSAA，确保镜头拉远时修长双腿与边缘轮廓丝滑无锯齿；移动端设为 2x
    const msaa = mobile
      ? (APP_CONFIG.postfx.composerMSAASamplesMobile ?? 2)
      : (APP_CONFIG.postfx.composerMSAASamplesDesktop ?? 4);
    // ponytail: 主 RT 仍按全分辨率（× DPR）呈现。
    // 主 RT MSAA：桌面默认 4x，保 MToon 描边与远景修长四肢锐利平滑。
    // 方案 5 优化：离屏帧缓冲裁剪冗余 Stencil (Disable Redundant Stencil)
    // 后处理链路纯颜色计算无需模版测试，显式关闭 stencilBuffer 避免 GPU 分配 8-bit 模版深度附件，节约显存与带宽
    const renderTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.round(size.width * pixelRatio)),
      Math.max(1, Math.round(size.height * pixelRatio)),
      {
        type: THREE.HalfFloatType,
        samples: msaa,
        depthBuffer: true,
        stencilBuffer: false,
      }
    );
    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.setPixelRatio(pixelRatio);

    // 内存优化：释放 EffectComposer 幽灵冗余渲染缓冲 (Ghost RenderTarget Release)
    // Three.js 默认克隆出双缓冲用于 Ping-Pong，但当前管线调色已并入 OutputPass，
    // 全链路为 RenderPass ➔ Bloom (原地叠加) ➔ OutputPass (直出屏幕 Canvas)，
    // renderTarget1 (writeBuffer) 终生不参与任何读写。立即释放并统一指向 renderTarget2，立省 250MB~400MB 显存！
    if (this.composer.renderTarget1 && this.composer.renderTarget2) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget1 = this.composer.renderTarget2;
      this.composer.writeBuffer = this.composer.renderTarget2;
    }

    this.composer.addPass(new RenderPass(scene, camera));

    // UnrealBloomPass: 低频光晕。setSize(w,h) 内部还会把第一级 mip 设为 w/2×h/2。
    // bloomInputScale=1 → 实际 Bloom = 主 RT 的 1/2。
    // bloomInputScale=0.5 → 实际 = 主 RT 的 1/4（移动端 / 桌面默认，更柔、更省）。
    const bloomInputScale = mobile
      ? (APP_CONFIG.postfx.bloomInputScaleMobile ?? 0.5)
      : (APP_CONFIG.postfx.bloomInputScaleDesktop ?? 0.5);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(
        Math.max(1, Math.round(window.innerWidth * pixelRatio * bloomInputScale)),
        Math.max(1, Math.round(window.innerHeight * pixelRatio * bloomInputScale)),
      ),
      this.config.bloom.strength,
      this.config.bloom.radius,
      this.config.bloom.threshold,
    );
    const origBloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w: number, h: number) => {
      origBloomSetSize(
        Math.max(1, Math.round(w * bloomInputScale)),
        Math.max(1, Math.round(h * bloomInputScale)),
      );
    };

    // 内存与性能优化：剥离 UnrealBloomPass 11 个内部中间 Mip 缓冲区的冗余 Depth/Stencil 附件
    // 高通提取与双向高斯模糊均为全屏四边形纯颜色 Blit，毫无深度测试需求；
    // 显式关闭 depthBuffer，避免 GPU 为 11 个离屏 FBO 分配 24-bit 深度附件并执行无意义的 depth clear，立省显存与带宽
    const stripBloomDepth = (rt: THREE.WebGLRenderTarget) => {
      if (!rt) return;
      rt.depthBuffer = false;
      rt.stencilBuffer = false;
    };
    stripBloomDepth(this.bloom.renderTargetBright);
    this.bloom.renderTargetsHorizontal.forEach(stripBloomDepth);
    this.bloom.renderTargetsVertical.forEach(stripBloomDepth);

    // 智能背景剔除 Shader 注入：
    // 白底/浅色二次元空间中，白背景亮度高达 0.95~0.98。若整张画布无脑高通提取，背景会被当成发光源漫射浓厚白雾。
    // 这里注入背景判定，将平涂极低饱和高明度背景剔除在高光提取之外，确保辉光只对 3D 角色（发丝高光、浅色衣物边、眼睛反光）生效！
    if (this.bloom.materialHighPassFilter) {
      const origFrag = this.bloom.materialHighPassFilter.fragmentShader;
      const targetStr = 'vec4 texel = texture2D( tDiffuse, vUv );';
      if (origFrag.includes(targetStr)) {
        this.bloom.materialHighPassFilter.fragmentShader = origFrag.replace(
          targetStr,
          `${targetStr}
      // 透明桌宠：空像素不进高通，避免辉光把桌面点穿做成实心光晕
      if (texel.a < 0.04) {
        gl_FragColor = vec4( defaultColor.rgb, defaultOpacity );
        return;
      }
      // 精准排除浅白平涂渐变背景 (#FAFAF5 ~ #F5F3ED)，免除全屏漫射白雾，确保角色白衣服/浅色发丝不受误伤
      bool isSceneBg = (texel.r > 0.950 && texel.r < 0.988 && abs(texel.r - texel.g) < 0.015 && abs(texel.r - texel.b - 0.025) < 0.020);
      if (isSceneBg) {
        gl_FragColor = vec4( defaultColor.rgb, defaultOpacity );
        return;
      }`
        );
        this.bloom.materialHighPassFilter.needsUpdate = true;
      }
    }

    // Additive bloom 默认会把 src alpha 叠进目标，透明桌宠会在角色外圈留下可点穿的实心光晕。
    // RGB 照常加，alpha 保持场景原值。
    // 在混合叠加阶段注入 Jimenez IGN 高频子像素抖色，抹平 5 级降采样模糊在暗部扩散时的同心圆色阶硬光环（Mach Banding）
    if (this.bloom.blendMaterial) {
      this.bloom.blendMaterial.fragmentShader = /* glsl */ `
        uniform float opacity;
        uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D( tDiffuse, vUv );
          vec3 bloomRgb = opacity * texel.rgb;
          float bloomIntensity = max(bloomRgb.r, max(bloomRgb.g, bloomRgb.b));
          // 仅在微弱辉光向暗处扩散衰减时注入微抖色（纯黑/无光晕区域权重为 0）
          if (bloomIntensity > 0.0005) {
            float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            float weight = smoothstep(0.0005, 0.02, bloomIntensity) * smoothstep(0.5, 0.1, bloomIntensity);
            bloomRgb += (ign - 0.5) / 255.0 * weight;
          }
          gl_FragColor = vec4( max(bloomRgb, vec3(0.0)), 0.0 );
        }
      `;
      this.bloom.blendMaterial.needsUpdate = true;
    }

    this.composer.addPass(this.bloom);

    // 方案 1 优化：合并 ColorGrading 到 OutputPass，彻底消除 1 次 4K 全屏 Blit FBO 切换与离屏拷贝
    // 调色 (BC + HS + 暗角) + 色调映射 (ToneMapping) + 颜色空间转换 (sRGB) + 高频抖色 (IGN Dithering)
    // 全部在单次全屏着色器中以 32 位浮点精度一次性计算输出，画质杜绝中间层量化损失，GPU Fillrate 与带宽大幅降低
    this.outputPass = new OutputPass();
    if (this.outputPass.material) {
      this.outputPass.uniforms['brightness'] = { value: this.config.bc.brightness };
      this.outputPass.uniforms['contrast'] = { value: this.config.bc.contrast };
      this.outputPass.uniforms['hue'] = { value: this.config.hs.hue };
      this.outputPass.uniforms['saturation'] = { value: this.config.hs.saturation };
      this.outputPass.uniforms['darkness'] = { value: this.config.vignette.darkness };
      this.outputPass.uniforms['offset'] = { value: this.config.vignette.offset };

      let frag = this.outputPass.material.fragmentShader;

      const helperFunctions = /* glsl */ `
        uniform float brightness;
        uniform float contrast;
        uniform float hue;
        uniform float saturation;
        uniform float darkness;
        uniform float offset;

        vec3 rgb2hsv(vec3 c) {
          vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
          vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
          vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
          float d = q.x - min(q.w, q.y);
          float e = 1.0e-10;
          return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }
        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }
      `;

      frag = frag.replace('#include <colorspace_pars_fragment>', '#include <colorspace_pars_fragment>\n' + helperFunctions);

      const targetTexture2D = 'gl_FragColor = texture2D( tDiffuse, vUv );';
      const colorGradingCode = /* glsl */ `
        gl_FragColor = texture2D( tDiffuse, vUv );

        // 1. BC (Brightness & Contrast)
        if (contrast != 0.0 || brightness != 0.0) {
          gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) * (1.0 + contrast) + 0.5 + brightness;
        }

        // 2. HS (Hue & Saturation) - 无色彩偏移时直接跳过分支
        if (hue != 0.0 || saturation != 0.0) {
          vec3 hsv = rgb2hsv(gl_FragColor.rgb);
          hsv.x = fract(hsv.x + hue);
          hsv.y = clamp(hsv.y * (1.0 + saturation), 0.0, 1.0);
          gl_FragColor.rgb = hsv2rgb(hsv);
        }

        // 3. Vignette (暗角)
        if (darkness > 0.0) {
          vec2 uv = (vUv - 0.5) * 2.0;
          float vig = clamp(1.0 - dot(uv, uv) * offset, 0.0, 1.0);
          gl_FragColor.rgb *= mix(1.0 - darkness, 1.0, vig);
        }
      `;

      frag = frag.replace(targetTexture2D, colorGradingCode);

      const lastBraceIdx = frag.lastIndexOf('}');
      if (lastBraceIdx !== -1) {
        frag = `${frag.slice(0, lastBraceIdx)}
      // Jimenez Interleaved Gradient Noise (IGN) 8-bit 高频抖色（Dithering）：
      // 将 15 与 16 之间的硬阶跃边缘彻底抹平成平滑自然的人眼连续过渡
      float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      gl_FragColor.rgb += (ign - 0.5) / 255.0;
      if (gl_FragColor.a < 1.0e-4) gl_FragColor = vec4(0.0);
    }`;
      }

      this.outputPass.material.fragmentShader = frag;
      this.outputPass.material.needsUpdate = true;
    }
    this.composer.addPass(this.outputPass);

    this._ready = true;
  }

  /** 每帧调。dt 是秒。 */
  render(dt: number): void {
    if (!this._ready || !this.composer) return;
    this.composer.render(dt);
  }

  resize(width: number, height: number, pixelRatio?: number): void {
    if (!this.composer || !this._renderer) return;
    const ratio = pixelRatio ?? getRenderPixelRatio();
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
  }

  /**
   * 把 config 同步到所有 effect + renderer.toneMapping。
   * ponytail: 必须每次 config 改了都调,Drawer 的每个滑杆抬手都触发。
   */
  applyConfig(): void {
    if (!this._ready) return;
    if (this.bloom) {
      this.bloom.strength = this.config.bloom.strength;
      this.bloom.radius = this.config.bloom.radius;
      this.bloom.threshold = this.config.bloom.threshold;
      // 性能短路：若 Bloom strength 为 0，禁用 Pass 省算力
      this.bloom.enabled = this.config.bloom.strength > 0.001;
    }
    if (this.outputPass?.uniforms) {
      const u = this.outputPass.uniforms as any;
      if (u.brightness) u.brightness.value = this.config.bc.brightness;
      if (u.contrast) u.contrast.value = this.config.bc.contrast;
      if (u.hue) u.hue.value = this.config.hs.hue;
      if (u.saturation) u.saturation.value = this.config.hs.saturation;
      if (u.darkness) u.darkness.value = this.config.vignette.darkness;
      if (u.offset) u.offset.value = this.config.vignette.offset;
    }
    // ponytail: toneMapping 走 renderer,OutputPass 在最后读这两个字段。
    // enabled=false 时强制还原 Linear/1.08,避免 config.toneMapping 在用户调滑杆
    // 时被 applyConfig 泄漏到 renderer — 总开关的隔离必须由 applyConfig 守,不能
    // 只靠 setEnabled 那一刻改一次,后续 applyConfig 会把它写回去。
    if (this._renderer) {
      if (this.config.enabled) {
        this._renderer.toneMapping = this.config.toneMapping.mode as unknown as THREE.ToneMapping;
        this._renderer.toneMappingExposure = Number.isFinite(this.config.toneMapping.exposure)
          ? this.config.toneMapping.exposure
          : 1.0;
      } else {
        this._renderer.toneMapping = THREE.LinearToneMapping;
        this._renderer.toneMappingExposure = 1.08;
      }
    }

    if (this._lastAppliedEnabled !== null && this._lastAppliedEnabled !== this.config.enabled) {
      this.onEnabledChange?.(this.config.enabled);
    }
    this._lastAppliedEnabled = this.config.enabled;
  }

  setEnabled(on: boolean): void {
    this.config.enabled = on;
    this.applyConfig();
  }

  /** 重置所有后期效果至默认配置 (对齐 APP_CONFIG.postfx) */
  resetToDefault(): void {
    this.config = getDefaultPostFxConfig();
    this.applyConfig();
  }

  isReady(): boolean { return this._ready; }

  dispose(): void {
    this.composer?.dispose?.();
    this.composer = null;
    this.bloom = null;
    this.outputPass = null;
    this._ready = false;
  }
}

export const postFxPipeline = new PostFxPipeline();