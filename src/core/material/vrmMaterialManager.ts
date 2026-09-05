import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { APP_CONFIG, type MaterialSaturationConfig } from '@/config';

export type MaterialSaturationSettings = MaterialSaturationConfig;
export type MaterialSaturationPresetKey = keyof typeof APP_CONFIG.saturation.presets;

/**
 * VRMMaterialManager — MToon 材质分类、着色器定制与色彩管理器
 * 
 * 职责：
 * 1. 自动对 VRM 模型 Mesh 的材质进行语义化特征归类 (skin, hair, eyes, clothing)；
 * 2. 动态改写 MToon 片元着色器，注入 `uMatSaturation` Uniform 变量并重构灰度混合公式；
 * 3. 管理材质边缘光与阴影色温调优；
 * 4. 提供饱和度预设和独立通道控制，并持久化至 localStorage。
 */
export class VRMMaterialManager {
  public saturation: MaterialSaturationSettings = { ...APP_CONFIG.saturation.default };

  public categorizedMaterials: {
    skin: any[];
    hair: any[];
    clothing: any[];
    eyes: any[];
  } = {
    skin: [],
    hair: [],
    clothing: [],
    eyes: [],
  };

  constructor() {
    this.restoreFromStorage();
  }

  private restoreFromStorage(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('xiaochun.mat_saturation_settings');
        if (saved) {
          this.saturation = { ...APP_CONFIG.saturation.default, ...JSON.parse(saved) };
        }
      }
    } catch {}
  }

  /**
   * 遍历 VRM 实例的所有网格材质，执行语义化归类并注入独立饱和度 Uniform
   */
  optimize(vrm: VRM): void {
    this.categorizedMaterials = { skin: [], hair: [], clothing: [], eyes: [] };

    vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat: any) => {
          if (!mat || !mat.isMToonMaterial) return;

          const name = (mat.name || '').toLowerCase();
          const isFaceSkin =
            name.includes('face') ||
            name.includes('skin') ||
            name.includes('body') ||
            name.includes('mouth') ||
            name.includes('brow') ||
            name.includes('head');
          const isEye = name.includes('eye') || name.includes('iris');
          const isHair = name.includes('hair');
          const isSocks = name.includes('socks') || name.includes('stocking') || name.includes('tights');
          const isCloth =
            name.includes('cloth') ||
            name.includes('shirt') ||
            name.includes('top') ||
            name.includes('skirt') ||
            name.includes('coat') ||
            name.includes('bottom') ||
            name.includes('dress') ||
            name.includes('onepiece') ||
            name.includes('shoes');

          let category: 'skin' | 'hair' | 'eyes' | 'clothing' = 'clothing';
          if (isEye) {
            category = 'eyes';
          } else if (isFaceSkin) {
            category = 'skin';
          } else if (isHair) {
            category = 'hair';
          } else {
            category = 'clothing';
          }

          // 注入材质级独立饱和度 Shader 片段
          if (!mat.userData.__saturationInjected) {
            mat.userData.__saturationInjected = true;
            mat.uniforms['uMatSaturation'] = { value: 1.0 };
            const targetCode = 'gl_FragColor = vec4( col, diffuseColor.a );\n  postCorrection();';
            if (mat.fragmentShader.includes(targetCode)) {
              mat.fragmentShader = `
uniform float uMatSaturation;
` + mat.fragmentShader.replace(
                targetCode,
                `float gray = dot(col, vec3(0.299, 0.587, 0.114));
  col = max(vec3(0.0), mix(vec3(gray), col, uMatSaturation));
  gl_FragColor = vec4( col, diffuseColor.a );
  postCorrection();`
              );
              mat.needsUpdate = true;
            }
          }

          if (!this.categorizedMaterials[category].includes(mat)) {
            this.categorizedMaterials[category].push(mat);
          }

          // NPR 边缘光与冷暖阴影调配
          if (isFaceSkin) {
            mat.rimLightingMix = 0.0;
            mat.rimMultiply = new THREE.Color(0x000000);
            mat.rimFresnelPower = 100.0;
            mat.rimLift = 0.0;
            mat.shadeShift = 0.08;
            mat.shadeToony = 0.98;
            if (mat.shadeColor) mat.shadeColor.setHex(0xfff2ea);
          } else if (isSocks) {
            mat.rimLightingMix = 0.60;
            mat.rimMultiply = new THREE.Color(0xffffff);
            mat.rimFresnelPower = 3.0;
            mat.rimLift = 0.15;
            mat.shadeShift = -0.05;
            mat.shadeToony = 0.80;
          } else if (isCloth) {
            mat.rimLightingMix = 0.35;
            mat.rimMultiply = new THREE.Color(0xf0f4ff);
            mat.rimFresnelPower = 4.0;
            mat.rimLift = 0.10;
            mat.shadeShift = 0.0;
            mat.shadeToony = 0.85;
          }
          mat.needsUpdate = true;
        });
      }
    });

    this.applySaturations();
  }

  /**
   * 将当前设置好的饱和度参数同步应用到所有分类的材质 Uniform 中
   */
  applySaturations(): void {
    const { skin, hair, clothing, eyes } = this.saturation;
    this.categorizedMaterials.skin.forEach((m) => {
      if (m.uniforms?.uMatSaturation) m.uniforms.uMatSaturation.value = skin;
    });
    this.categorizedMaterials.hair.forEach((m) => {
      if (m.uniforms?.uMatSaturation) m.uniforms.uMatSaturation.value = hair;
    });
    this.categorizedMaterials.clothing.forEach((m) => {
      if (m.uniforms?.uMatSaturation) m.uniforms.uMatSaturation.value = clothing;
    });
    this.categorizedMaterials.eyes.forEach((m) => {
      if (m.uniforms?.uMatSaturation) m.uniforms.uMatSaturation.value = eyes;
    });
  }

  setSaturation(settings: Partial<MaterialSaturationSettings>): void {
    this.saturation = { ...this.saturation, ...settings };
    this.applySaturations();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('xiaochun.mat_saturation_settings', JSON.stringify(this.saturation));
      }
    } catch {}
  }

  applyPreset(presetKey: MaterialSaturationPresetKey): void {
    const preset = APP_CONFIG.saturation.presets[presetKey];
    this.setSaturation({ preset: presetKey, ...preset });
  }
}
