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
 * Pass 顺序: RenderPass → UnrealBloomPass → BC → HS → Vignette → OutputPass
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { getRenderPixelRatio } from '@/lib/utils';

export interface PostFxConfig {
  enabled: boolean;
  bloom: { strength: number; radius: number; threshold: number };
  vignette: { darkness: number; offset: number };
  toneMapping: { mode: THREE.ToneMapping; exposure: number };
  bc: { brightness: number; contrast: number };
  hs: { hue: number; saturation: number };
}

export const DEFAULT_POSTFX_CONFIG: PostFxConfig = {
  enabled: true,
  bloom: { strength: 0.015, radius: 0.32, threshold: 0.72 },
  vignette: { darkness: 0.0, offset: 0.5 },
  toneMapping: { mode: THREE.LinearToneMapping, exposure: 1.05 },
  bc: { brightness: 0.0, contrast: 0.02 },
  hs: { hue: 0.0, saturation: 0.0 },
};

// ponytail: 共享顶点着色器
const STD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ColorGrading: 合并 BC (亮度对比) + HS (色相饱和) + Vignette (暗角) 到单次 Pass
// 避免 3 次独立的 RenderTarget 切换与全屏纹理读写，并在无色相/饱和度变化时跳过昂贵的 HSV 分支
const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    brightness: { value: 0.01 },
    contrast: { value: 0.03 },
    hue: { value: 0.0 },
    saturation: { value: 0.02 },
    darkness: { value: 0.0 },
    offset: { value: 0.5 },
  },
  vertexShader: STD_VERTEX,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float brightness;
    uniform float contrast;
    uniform float hue;
    uniform float saturation;
    uniform float darkness;
    uniform float offset;
    varying vec2 vUv;

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

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);

      // 1. BC (Brightness & Contrast)
      if (contrast != 0.0 || brightness != 0.0) {
        col.rgb = (col.rgb - 0.5) * (1.0 + contrast) + 0.5 + brightness;
      }

      // 2. HS (Hue & Saturation) - 无色彩偏移时直接跳过分支
      if (hue != 0.0 || saturation != 0.0) {
        vec3 hsv = rgb2hsv(col.rgb);
        hsv.x = fract(hsv.x + hue);
        hsv.y = clamp(hsv.y * (1.0 + saturation), 0.0, 1.0);
        col.rgb = hsv2rgb(hsv);
      }

      // 3. Vignette (暗角)
      if (darkness > 0.0) {
        vec2 uv = (vUv - 0.5) * 2.0;
        float vig = clamp(1.0 - dot(uv, uv) * offset, 0.0, 1.0);
        col.rgb *= mix(1.0 - darkness, 1.0, vig);
      }

      gl_FragColor = col;
    }
  `,
};

export class PostFxPipeline {
  public composer: EffectComposer | null = null;
  public bloom: UnrealBloomPass | null = null;
  public colorGrading: ShaderPass | null = null;

  // 向后兼容旧字段
  public get vignette(): ShaderPass | null { return this.colorGrading; }
  public get bc(): ShaderPass | null { return this.colorGrading; }
  public get hs(): ShaderPass | null { return this.colorGrading; }
  public config: PostFxConfig = { ...DEFAULT_POSTFX_CONFIG };
  public onEnabledChange: ((enabled: boolean) => void) | null = null;

  private _renderer: THREE.WebGLRenderer | null = null;
  private _ready = false;
  private _lastAppliedEnabled: boolean | null = null;

  init(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (this._ready) return;
    this._renderer = renderer;

    const pixelRatio = getRenderPixelRatio();
    const size = renderer.getSize(new THREE.Vector2());
    // ponytail: 使用 WebGL 2 原生 4x MSAA 渲染目标。
    // 在几何光栅化阶段由显卡硬件计算子采样覆盖率，实现真硬件抗锯齿，
    // 完全不模糊像素，彻底恢复二次元 MToon 1 像素黑色描边线条的纯黑与锐利！
    const renderTarget = new THREE.WebGLRenderTarget(
      size.width * pixelRatio,
      size.height * pixelRatio,
      {
        type: THREE.HalfFloatType,
        samples: 4,
      }
    );
    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.addPass(new RenderPass(scene, camera));

    // UnrealBloomPass: 通用 bloom,作用于整个画面
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.round(window.innerWidth * 0.5), Math.round(window.innerHeight * 0.5)),
      this.config.bloom.strength,
      this.config.bloom.radius,
      this.config.bloom.threshold,
    );
    // 劫持 Bloom 的 setSize：由于泛光属于低频漫射光晕，固定在 0.5x 渲染不仅光晕更加柔和，
    // 而且能节省 75% 的显存与 11 次 Shader Pass 的填充率带宽，并避免 composer.setSize 时二次分配
    const origBloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w: number, h: number) => {
      origBloomSetSize(Math.round(w * 0.5), Math.round(h * 0.5));
    };

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

    this.composer.addPass(this.bloom);

    // 颜色分级与暗角: 合并为单个 Pass，避免多次全屏离屏 Blit
    this.colorGrading = new ShaderPass(ColorGradingShader);
    this.composer.addPass(this.colorGrading);

    // OutputPass: 收尾,自动应用 toneMapping + sRGB
    this.composer.addPass(new OutputPass());

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
    if (this.colorGrading?.uniforms) {
      const u = this.colorGrading.uniforms as any;
      u.brightness.value = this.config.bc.brightness;
      u.contrast.value = this.config.bc.contrast;
      u.hue.value = this.config.hs.hue;
      u.saturation.value = this.config.hs.saturation;
      u.darkness.value = this.config.vignette.darkness;
      u.offset.value = this.config.vignette.offset;

      // 性能短路：若所有调色与暗角全为零，直接跳过 Pass，减少 1 次全屏离屏 Blit
      const isBcActive = this.config.bc.brightness !== 0 || this.config.bc.contrast !== 0;
      const isHsActive = this.config.hs.hue !== 0 || this.config.hs.saturation !== 0;
      const isVignetteActive = this.config.vignette.darkness > 0;
      this.colorGrading.enabled = isBcActive || isHsActive || isVignetteActive;
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

  isReady(): boolean { return this._ready; }

  dispose(): void {
    this.composer?.dispose?.();
    this.composer = null;
    this.bloom = null;
    this.colorGrading = null;
    this._ready = false;
  }
}

export const postFxPipeline = new PostFxPipeline();