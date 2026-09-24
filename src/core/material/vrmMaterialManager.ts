import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  APP_CONFIG,
  type MaterialSaturationConfig,
  type ModelPartCategory,
  type ModelPartDefinition,
  type ModelPartCategoryDefinition,
  type VrmMToonPartConfig,
} from '@/config';
import { MAT_SATURATION_KEY } from '@/lib/constants';

export type MaterialSaturationSettings = MaterialSaturationConfig;
export type MaterialSaturationPresetKey = keyof typeof APP_CONFIG.saturation.presets;

export type { ModelPartCategory, ModelPartDefinition, ModelPartCategoryDefinition };

/**
 * 权威单一数据源 (Single Source of Truth) — 统一由 config.ts wardrobe 节点驱动
 */

/**
 * MToon part preset registrar: write APP_CONFIG.mtoon.parts preset onto MToonMaterial.
 */
function applyMToonPartPreset(
  mat: any,
  part: VrmMToonPartConfig,
  opts?: {
    shadow2ndColor?: [number, number, number];
    shadow3rdColor?: [number, number, number];
    materialName?: string;
  },
): void {
  mat.softMix = part.softMix;
  mat.blurBoost = part.blurBoost;
  mat.shadow2ndStrength = part.shadow2ndStrength;
  if (typeof part.shadow2ndBorder === 'number') mat.shadow2ndBorder = part.shadow2ndBorder;
  if (typeof part.shadow2ndBlur === 'number') mat.shadow2ndBlur = part.shadow2ndBlur;
  mat.shadow3rdStrength = part.shadow3rdStrength;
  if (typeof part.shadow3rdBorder === 'number') mat.shadow3rdBorder = part.shadow3rdBorder;
  if (typeof part.shadow3rdBlur === 'number') mat.shadow3rdBlur = part.shadow3rdBlur;
  mat.rimBoost = part.rimBoost;
  mat.rimBorder = part.rimBorder;
  mat.rimBlur = part.rimBlur;
  mat.rimDirStrength = part.rimDirStrength;
  mat.hairSpecStrength = part.hairSpecStrength;
  if (typeof part.hairSpecPower === 'number') mat.hairSpecPower = part.hairSpecPower;
  if (typeof part.hairSpecShift === 'number') mat.hairSpecShift = part.hairSpecShift;

  let clothSpec = part.clothSpecStrength;
  const name = (opts?.materialName ?? '').toLowerCase();
  if (
    clothSpec > 0 &&
    typeof part.clothSpecDarkLuma === 'number' &&
    typeof part.clothSpecDarkBoost === 'number'
  ) {
    try {
      const c = mat.color ?? mat.litFactor;
      if (c && typeof c.r === 'number') {
        const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        if (
          luma < part.clothSpecDarkLuma ||
          name.includes('bow') ||
          name.includes('ribbon') ||
          name.includes('satin')
        ) {
          clothSpec = part.clothSpecDarkBoost;
        }
      }
    } catch {
      /* ignore */
    }
  }
  mat.clothSpecStrength = clothSpec;
  if (typeof part.clothSpecPower === 'number') mat.clothSpecPower = part.clothSpecPower;
  mat.matcap2ndStrength = part.matcap2ndStrength;

  if (typeof part.skinSpecStrength === 'number') mat.skinSpecStrength = part.skinSpecStrength;
  if (typeof part.skinSpecPower === 'number') mat.skinSpecPower = part.skinSpecPower;
  if (typeof part.skinSpecFresnel === 'number') mat.skinSpecFresnel = part.skinSpecFresnel;
  const skinCol = part.skinSpecColor;
  if (
    skinCol &&
    mat.skinSpecColor &&
    typeof mat.skinSpecColor.setRGB === 'function'
  ) {
    mat.skinSpecColor.setRGB(skinCol[0], skinCol[1], skinCol[2]);
  }

  if (typeof part.ambientLift === 'number') mat.ambientLift = part.ambientLift;
  if (typeof part.shadeMainStrength === 'number') mat.shadeMainStrength = part.shadeMainStrength;
  if (typeof part.shadowBorder === 'number') mat.shadowBorder = part.shadowBorder;
  if (typeof part.shadowBlur === 'number') mat.shadowBlur = part.shadowBlur;
  if (typeof part.rimMainStrength === 'number') mat.rimMainStrength = part.rimMainStrength;
  if (typeof part.rimShadowMask === 'number') mat.rimShadowMask = part.rimShadowMask;

  if (typeof part.specularStrength === 'number') mat.specularStrength = part.specularStrength;
  if (typeof part.specularPower === 'number') mat.specularPower = part.specularPower;
  if (typeof part.specularBorder === 'number') mat.specularBorder = part.specularBorder;
  if (typeof part.specularBlur === 'number') mat.specularBlur = part.specularBlur;
  if (typeof part.reflectStrength === 'number') mat.reflectStrength = part.reflectStrength;
  if (typeof part.reflectFresnel === 'number') mat.reflectFresnel = part.reflectFresnel;
  if (typeof part.reflectMetallic === 'number') mat.reflectMetallic = part.reflectMetallic;
  if (typeof part.reflectSmoothness === 'number') mat.reflectSmoothness = part.reflectSmoothness;
  if (typeof part.backlightStrength === 'number') mat.backlightStrength = part.backlightStrength;
  const blCol = part.backlightColor;
  if (blCol && mat.backlightColor && typeof mat.backlightColor.setRGB === 'function') {
    mat.backlightColor.setRGB(blCol[0], blCol[1], blCol[2]);
  }
  if (typeof part.rimFresnelPower === 'number') mat.rimFresnelPower = part.rimFresnelPower;
  if (typeof part.rimIndirStrength === 'number') mat.rimIndirStrength = part.rimIndirStrength;
  if (typeof part.matcap2ndContrast === 'number') mat.matcap2ndContrast = part.matcap2ndContrast;
  if (typeof part.matcap2ndScale === 'number') mat.matcap2ndScale = part.matcap2ndScale;
  if (typeof part.emissionBoost === 'number') mat.emissionBoost = part.emissionBoost;
  if (typeof part.distanceFade === 'number') mat.distanceFade = part.distanceFade;
  if (typeof part.faceSoft === 'number') mat.faceSoft = part.faceSoft;
  if (typeof part.normalSkinBoost === 'number') mat.normalSkinBoost = part.normalSkinBoost;
  if (typeof part.envStrength === 'number') mat.envStrength = part.envStrength;
  if (typeof part.outlineMix === 'number') mat.outlineMix = part.outlineMix;
  if (typeof part.receiveShadowRate === 'number') mat.receiveShadowRate = part.receiveShadowRate;
  if (typeof part.fabricSheenStrength === 'number') mat.fabricSheenStrength = part.fabricSheenStrength;
  if (typeof part.fabricSheenPower === 'number') mat.fabricSheenPower = part.fabricSheenPower;
  const sheenCol = part.fabricSheenColor;
  if (sheenCol && mat.fabricSheenColor && typeof mat.fabricSheenColor.setRGB === 'function') {
    mat.fabricSheenColor.setRGB(sheenCol[0], sheenCol[1], sheenCol[2]);
  }

  let gem = typeof part.gemFresnel === 'number' ? part.gemFresnel : 0;
  if (
    gem <= 0 &&
    (name.includes('jewel') ||
      name.includes('gem') ||
      name.includes('crystal') ||
      name.includes('metal') ||
      name.includes('gold') ||
      name.includes('silver') ||
      name.includes('ring') ||
      name.includes('earring'))
  ) {
    gem = 0.18;
  }
  if (gem > 0) mat.gemFresnel = gem;

  const c2 = opts?.shadow2ndColor;
  if (c2 && mat.shadow2ndColor && typeof mat.shadow2ndColor.setRGB === 'function') {
    mat.shadow2ndColor.setRGB(c2[0], c2[1], c2[2]);
  }
  const c3 = opts?.shadow3rdColor;
  if (c3 && mat.shadow3rdColor && typeof mat.shadow3rdColor.setRGB === 'function') {
    mat.shadow3rdColor.setRGB(c3[0], c3[1], c3[2]);
  }
}

/** Reset extended uniforms to classic MToon defaults. */
function resetMToonClassic(mat: any): void {
  if (typeof mat.softMix !== 'number') return;
  mat.softMix = 0.0;
  mat.blurBoost = 0.0;
  mat.shadow2ndStrength = 0.0;
  mat.shadow3rdStrength = 0.0;
  mat.rimBoost = 1.0;
  mat.rimDirStrength = 0.0;
  mat.rimMainStrength = 0.0;
  mat.rimShadowMask = 0.0;
  mat.rimIndirStrength = 0.0;
  mat.hairSpecStrength = 0.0;
  mat.clothSpecStrength = 0.0;
  mat.matcap2ndStrength = 0.0;
  mat.skinSpecStrength = 0.0;
  mat.specularStrength = 0.0;
  mat.reflectStrength = 0.0;
  mat.backlightStrength = 0.0;
  mat.ambientLift = 0.0;
  mat.shadeMainStrength = 0.0;
  mat.envStrength = 0.0;
  mat.faceSoft = 0.0;
  mat.normalSkinBoost = 0.0;
  mat.emissionBoost = 0.0;
  mat.distanceFade = 0.0;
  mat.gemFresnel = 0.0;
  mat.outlineMix = 0.0;
}

export const MODEL_PART_CATEGORIES = APP_CONFIG.wardrobe.categories;
export const MODEL_PARTS_CONFIG = APP_CONFIG.wardrobe.parts;

/**
 * 智能分类器：根据 VRM / VRoid 材质特征，自动精准映射到 VRoid 官方槽位
 */
export function classifyMaterialToPart(matName: string): ModelPartDefinition {
  const name = matName.toLowerCase();

  // 10. 饰品部件（眼镜、耳环、发饰、帽子、角、尾巴等）
  if (
    name.includes('glass') ||
    name.includes('eyewear') ||
    name.includes('goggle') ||
    name.includes('hat') ||
    name.includes('cap') ||
    name.includes('headwear') ||
    name.includes('crown') ||
    name.includes('beret') ||
    name.includes('hairpin') ||
    name.includes('earring') ||
    name.includes('piercing') ||
    name.includes('tail') ||
    name.includes('horn') ||
    name.includes('wing') ||
    name.includes('accessory') ||
    name.includes('badge') ||
    name.includes('belt') ||
    name.includes('prop')
  ) {
    return { id: 'accessory', category: 'accessory', label: 'panel.partItems.accessory', icon: '👓' };
  }

  // 4. 颈部装饰（项链、领带、领结、项圈、领花、丝带，以及 VRoid 套用 onepiece 模板制作的项链/锁骨链）
  if (
    name.includes('neck') ||
    name.includes('necklace') ||
    name.includes('choker') ||
    name.includes('collar') ||
    name.includes('tie') ||
    name.includes('scarf') ||
    name.includes('ribbon') ||
    name.includes('pendant') ||
    (name.includes('onepiece') && (name.includes('acc') || name.includes('chain') || name.includes('necklace') || name.includes('choker')))
  ) {
    return { id: 'neckwear', category: 'clothing', label: 'panel.partItems.neckwear', icon: '👔' };
  }

  // 5. 腕部装饰（手套、手环、手腕护套）
  if (
    name.includes('armwear') ||
    name.includes('wrist') ||
    name.includes('glove') ||
    name.includes('mitt') ||
    name.includes('bracelet') ||
    name.includes('arm_0')
  ) {
    return { id: 'armwear', category: 'clothing', label: 'panel.partItems.armwear', icon: '🧤' };
  }

  // 9. 鞋子（鞋靴、皮鞋、运动鞋、高跟靴）
  if (
    name.includes('shoes') ||
    name.includes('shoe') ||
    name.includes('boot') ||
    name.includes('sneaker') ||
    name.includes('heel') ||
    name.includes('footwear')
  ) {
    return { id: 'shoes', category: 'clothing', label: 'panel.partItems.shoes', icon: '👟' };
  }

  // 8. 腿部装饰（袜子、连裤袜、丝袜、过膝袜）
  if (
    name.includes('legwear') ||
    name.includes('sock') ||
    name.includes('stocking') ||
    name.includes('tight') ||
    name.includes('hose')
  ) {
    return { id: 'legwear', category: 'clothing', label: 'panel.partItems.legwear', icon: '🧦' };
  }

  // 6. 上半身内衣（文胸、胸衣、吊带背心）
  if (
    name.includes('bra') ||
    name.includes('camisole') ||
    name.includes('bustier') ||
    (name.includes('underwear') && (name.includes('top') || name.includes('upper') || name.includes('bra') || name.includes('chest') || name.includes('01'))) ||
    (name.includes('inner') && (name.includes('top') || name.includes('upper') || name.includes('bra') || name.includes('chest') || name.includes('01')))
  ) {
    return { id: 'inner_top', category: 'clothing', label: 'panel.partItems.inner_top', icon: '🩱' };
  }

  // 7. 下半身内衣（底裤、内裤、平角裤）
  if (
    name.includes('panties') ||
    name.includes('panty') ||
    name.includes('pantsu') ||
    name.includes('brief') ||
    name.includes('boxer') ||
    name.includes('underpants') ||
    (name.includes('underwear') && (name.includes('bottom') || name.includes('lower') || name.includes('pants') || name.includes('skirt') || name.includes('02'))) ||
    (name.includes('inner') && (name.includes('bottom') || name.includes('lower') || name.includes('pants') || name.includes('skirt') || name.includes('02')))
  ) {
    return { id: 'inner_bottom', category: 'clothing', label: 'panel.partItems.inner_bottom', icon: '🩲' };
  }

  // 3. 连衣裙（Onepiece、连身裙、连衣裙套组）
  if (
    name.includes('dress') ||
    name.includes('onepiece')
  ) {
    return { id: 'dress', category: 'clothing', label: 'panel.partItems.dress', icon: '👗' };
  }

  // 2. 下身（短裙、长裤、百褶裙、短裤）
  if (
    name.includes('bottom') ||
    name.includes('skirt') ||
    name.includes('pants') ||
    name.includes('trouser') ||
    name.includes('short')
  ) {
    return { id: 'bottoms', category: 'clothing', label: 'panel.partItems.bottoms', icon: '👖' };
  }

  // 1. 上身（衬衫、T恤、上衣、外套、夹克、卫衣）
  if (
    name.includes('tops') ||
    name.includes('top') ||
    name.includes('shirt') ||
    name.includes('coat') ||
    name.includes('jacket') ||
    name.includes('cardigan') ||
    name.includes('hoodie')
  ) {
    return { id: 'tops', category: 'clothing', label: 'panel.partItems.tops', icon: '👚' };
  }

  // 发型槽位
  if (name.includes('hairback')) {
    return { id: 'hair_back', category: 'hair', label: 'panel.partItems.hair_back', icon: '💆‍♀️' };
  }
  if (name.includes('hair_01') || (name.includes('hair') && !name.includes('03') && !name.includes('bang'))) {
    return { id: 'hair_main', category: 'hair', label: 'panel.partItems.hair_main', icon: '💇‍♀️' };
  }
  if (name.includes('hair_03') || name.includes('bang')) {
    return { id: 'hair_front', category: 'hair', label: 'panel.partItems.hair_front', icon: '🎀' };
  }

  // 面部槽位
  if (name.includes('brow')) {
    return { id: 'face_brows', category: 'face', label: 'panel.partItems.face_brows', icon: '🤨' };
  }
  if (name.includes('eyeline') || name.includes('eyelash')) {
    return { id: 'face_eyelines', category: 'face', label: 'panel.partItems.face_eyelines', icon: '👁️' };
  }
  if (name.includes('eyehighlight')) {
    return { id: 'face_highlights', category: 'face', label: 'panel.partItems.face_highlights', icon: '✨' };
  }
  if (name.includes('eyeiris') || name.includes('eyewhite')) {
    return { id: 'face_irises', category: 'face', label: 'panel.partItems.face_irises', icon: '🟣' };
  }
  if (name.includes('mouth')) {
    return { id: 'face_mouth', category: 'face', label: 'panel.partItems.face_mouth', icon: '👄' };
  }
  if (name.includes('face') && name.includes('skin')) {
    return { id: 'face_skin', category: 'face', label: 'panel.partItems.face_skin', icon: '👧' };
  }

  // 体型/素体
  if (name.includes('body') || (name.includes('skin') && !name.includes('face'))) {
    return { id: 'body_skin', category: 'body', label: 'panel.partItems.body_skin', icon: '🧍‍♀️' };
  }

  // 兜底映射
  if (name.includes('inner') || name.includes('underwear')) {
    return { id: 'inner_top', category: 'clothing', label: 'panel.partItems.inner_top', icon: '🩱' };
  }
  if (name.includes('cloth')) {
    return { id: 'tops', category: 'clothing', label: 'panel.partItems.tops', icon: '👚' };
  }

  return { id: 'accessory', category: 'accessory', label: 'panel.partItems.accessory', icon: '👓' };
}

/**
 * VRMMaterialManager — MToon 材质分类、着色器定制与色彩管理器
 */
export class VRMMaterialManager {
  public saturation: MaterialSaturationSettings = { ...APP_CONFIG.saturation.default };

  public partMaterials: Record<string, any[]> = {};
  // ponytail: 跟 partMaterials 平行的 mesh 索引 — setPartVisibility 只切材质可见性
  // 不够,getCurrentHeightCm() 走 live path 时遍历场景只看 mesh.visible。穿/脱鞋子后
  // 身高不变就是缺这一份索引:这里把每个 part 对应的 mesh 缓存下来,visibility 切换
  // 时同步改 mesh.visible,bvh / bounding box / 渲染表现才一致。
  public partMeshes: Record<string, THREE.Mesh[]> = {};
  public partsVisibility: Record<string, boolean> = {};
  public currentVRM: VRM | null = null;
  public detectedParts: ModelPartDefinition[] = [];

  public get clothingVisibility(): Record<string, boolean> {
    return this.partsVisibility;
  }

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
        const saved = localStorage.getItem(MAT_SATURATION_KEY);
        if (saved) {
          this.saturation = { ...APP_CONFIG.saturation.default, ...JSON.parse(saved) };
        }
      }
    } catch { }
  }

  /**
   * 遍历 VRM 实例的所有网格材质，执行语义化归类并注入独立饱和度 Uniform
   */
  optimize(vrm: VRM): void {
    this.currentVRM = vrm;
    this.categorizedMaterials = { skin: [], hair: [], clothing: [], eyes: [] };
    this.partMaterials = {};
    this.partMeshes = {};
    const seenPartIds = new Set<string>();
    const newDetectedParts: ModelPartDefinition[] = [];
    const xc = APP_CONFIG.mtoon.parts;
    let softAppliedCount = 0;
    let sampleSoftMix: number | null = null;

    vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;

        // 1. 如果全局配置关闭了描边，彻底剥离网格中的描边材质并清理 geometry.groups
        if (!APP_CONFIG.outline.enabled && Array.isArray(mesh.material)) {
          const nonOutline = mesh.material.filter((m: any) => !m?.isOutline && !m?.name?.includes('(Outline)'));
          mesh.material.forEach((m: any) => {
            if (m?.isOutline || m?.name?.includes('(Outline)')) {
              m.visible = false;
              m.opacity = 0.0;
            }
          });
          if (nonOutline.length === 1) {
            mesh.material = nonOutline[0];
            mesh.geometry.clearGroups();
          } else if (nonOutline.length > 0 && nonOutline.length < mesh.material.length) {
            mesh.material = nonOutline;
            mesh.geometry.clearGroups();
          }
        }

        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat: any) => {
          if (!mat || !mat.isMToonMaterial) return;

          // 2. 根据全局配置 APP_CONFIG.outline 统一应用描边参数（消除硬编码魔法值）
          if (!APP_CONFIG.outline.enabled) {
            if (mat.isOutline || mat.name?.includes('(Outline)')) {
              mat.visible = false;
              mat.opacity = 0.0;
              return;
            }
            mat.outlineWidthMode = 'none';
            mat.outlineWidthFactor = 0.0;
          } else {
            // 确保描边材质本身绝不启用 polygonOffset，防止轮廓线被掠射角斜率撕扯变形
            if (mat.isOutline || mat.name?.includes('(Outline)')) {
              mat.polygonOffset = false;
              mat.polygonOffsetFactor = 0.0;
              mat.polygonOffsetUnits = 0.0;
            }
            mat.outlineWidthMode = APP_CONFIG.outline.widthMode;
            mat.outlineWidthFactor = APP_CONFIG.outline.widthFactor;
            if (APP_CONFIG.outline.color && mat.outlineColorFactor) {
              mat.outlineColorFactor.set(APP_CONFIG.outline.color);
            }
            if (APP_CONFIG.outline.lightingMix !== undefined && mat.outlineLightingMixFactor !== undefined) {
              mat.outlineLightingMixFactor = APP_CONFIG.outline.lightingMix;
            }
          }

          const rawName = mat.name || '';
          const name = rawName.toLowerCase();

          // 动态注册识别模型部件
          const partDef = classifyMaterialToPart(rawName);
          if (!this.partMaterials[partDef.id]) {
            this.partMaterials[partDef.id] = [];
          }
          if (!this.partMaterials[partDef.id].includes(mat)) {
            this.partMaterials[partDef.id].push(mat);
          }
          // ponytail: 同步索引 mesh — 一个 mesh 可能挂多个材质,这里去重,只有
          // 第一次遇到该 part 的材质时把 mesh 记下来就够了(后续同 mesh 上其他
          // 材质只更新 partMaterials)。
          if (!this.partMeshes[partDef.id]) {
            this.partMeshes[partDef.id] = [];
          }
          if (!this.partMeshes[partDef.id].includes(mesh)) {
            this.partMeshes[partDef.id].push(mesh);
          }

          if (!seenPartIds.has(partDef.id)) {
            seenPartIds.add(partDef.id);
            newDetectedParts.push(partDef);
            if (this.partsVisibility[partDef.id] === undefined) {
              const defVis = APP_CONFIG.wardrobe.defaultVisibility[partDef.id] ?? partDef.defaultVisible ?? true;
              this.partsVisibility[partDef.id] = defVis;
            }
          }

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
          // 服装材质识别：只要不是脸部皮肤、素体、眼睛、头发与袜子，均属于服装范畴，必须严格赋予 polygonOffset 深度防穿模
          const isCloth = !isFaceSkin && !isEye && !isHair && !isSocks;

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
            const isBody = name.includes('body');
            mesh.receiveShadow = isBody; // 纯面部不接收投射阴影防黑斑；身体/锁骨/胸口必须接收投射阴影！
            const skinNpr = isBody ? APP_CONFIG.mtoon.skin.body : APP_CONFIG.mtoon.skin.face;
            const skinOffset = APP_CONFIG.mtoon.skin.polygonOffset;

            mat.rimLightingMix = skinNpr.rimLightingMix;
            if (mat.rimMultiply) {
              mat.rimMultiply.set(skinNpr.rimColor);
            } else {
              mat.rimMultiply = new THREE.Color(skinNpr.rimColor);
            }
            mat.rimFresnelPower = skinNpr.rimFresnelPower;
            mat.rimLift = skinNpr.rimLift;

            mat.shadeShift = skinNpr.shadeShift;
            mat.shadeToony = skinNpr.shadeToony;
            if (skinNpr.shadeColor && mat.shadeColor) {
              mat.shadeColor.set(skinNpr.shadeColor);
            }
            if (mat.color) {
              mat.color.set(skinNpr.litColor || '#ffffff');
            }

            // 🚫 素体皮肤作为绝对基准面，保持物理深度真实 (polygonOffset = false)
            mat.polygonOffset = skinOffset.enabled;
            mat.polygonOffsetFactor = skinOffset.factor;
            mat.polygonOffsetUnits = skinOffset.units;
          } else if (isSocks) {
            // 贴身丝袜/袜子无论全局配置如何，自身都绝不开启描边（防止圆柱体 UV 接缝处出现断裂黑线）
            if (mat.isOutline || mat.name?.includes('(Outline)')) {
              mat.visible = false;
              mat.opacity = 0.0;
              return;
            }
            mat.outlineWidthMode = 'none';
            mat.outlineWidthFactor = 0.0;

            const socksNpr = APP_CONFIG.mtoon.socks.npr;
            const socksOffset = APP_CONFIG.mtoon.socks.polygonOffset;

            mat.rimLightingMix = socksNpr.rimLightingMix;
            if (mat.rimMultiply) {
              mat.rimMultiply.set(socksNpr.rimColor);
            } else {
              mat.rimMultiply = new THREE.Color(socksNpr.rimColor);
            }
            mat.rimFresnelPower = socksNpr.rimFresnelPower;
            mat.rimLift = socksNpr.rimLift;
            mat.shadeShift = socksNpr.shadeShift;
            mat.shadeToony = socksNpr.shadeToony;
            if (socksNpr.shadeColor && mat.shadeColor) {
              mat.shadeColor.set(socksNpr.shadeColor);
            }

            // 深度分层防穿模: 袜子在腿部皮肤之上 (向相机拉近)
            mat.polygonOffset = socksOffset.enabled;
            mat.polygonOffsetFactor = socksOffset.factor;
            mat.polygonOffsetUnits = socksOffset.units;
          } else if (isCloth) {
            const clothNpr = APP_CONFIG.mtoon.cloth.npr;
            mat.rimLightingMix = clothNpr.rimLightingMix;
            if (mat.rimMultiply) {
              mat.rimMultiply.set(clothNpr.rimColor);
            } else {
              mat.rimMultiply = new THREE.Color(clothNpr.rimColor);
            }
            mat.rimFresnelPower = clothNpr.rimFresnelPower;
            mat.rimLift = clothNpr.rimLift;
            mat.shadeShift = clothNpr.shadeShift;
            mat.shadeToony = clothNpr.shadeToony;
            if (clothNpr.shadeColor && mat.shadeColor) {
              mat.shadeColor.set(clothNpr.shadeColor);
            }

            const isInner =
              partDef.id === 'inner_top' ||
              partDef.id === 'inner_bottom' ||
              name.includes('underwear') ||
              name.includes('inner') ||
              name.includes('bra') ||
              name.includes('panties') ||
              name.includes('panty') ||
              name.includes('002_') ||
              name.includes('003_');

            // 深度分层防穿模: 全部向前拉 (负 offset)，内衬向前拉 1 级，外衣向前拉 2 级，永远覆盖素体
            const clothOffset = isInner
              ? APP_CONFIG.mtoon.cloth.innerPolygonOffset
              : APP_CONFIG.mtoon.cloth.outerPolygonOffset;

            mat.polygonOffset = clothOffset.enabled;
            mat.polygonOffsetFactor = clothOffset.factor;
            mat.polygonOffsetUnits = clothOffset.units;
          }

          // feat-mtoon: fork defaults are classic-off; always reset then optionally apply preset.
          // (enabled:false used to leave shader defaults softMix=0.95 / bands / matcap2nd ON.)
          if (typeof mat.softMix === 'number') {
            resetMToonClassic(mat);
            if (!xc?.enabled) {
              mat.needsUpdate = true;
              // fall through — stock NPR above already applied
            } else {
            softAppliedCount += 1;
            const isFaceOnly =
              name.includes('face') ||
              name.includes('mouth') ||
              name.includes('brow') ||
              (name.includes('head') && !name.includes('body'));
            const isBodySkin = isFaceSkin && (name.includes('body') || name.includes('skin')) && !isFaceOnly;

            if (isHair) {
              // 保持头发原版经典 MToon 质感与深邃发尾渐变（resetMToonClassic 已恢复所有扩展参数为关闭状态）
            } else if (isEye) {
              applyMToonPartPreset(mat, xc.eyes, {
                shadow2ndColor: xc.shadow2ndColor,
                shadow3rdColor: xc.shadow3rdColor,
                materialName: name,
              });
            } else if (isFaceOnly) {
              applyMToonPartPreset(mat, xc.face, {
                shadow2ndColor: xc.faceShadow2ndColor ?? xc.shadow2ndColor,
                shadow3rdColor: xc.shadow3rdColor,
                materialName: name,
              });
            } else if (isFaceSkin || isBodySkin) {
              applyMToonPartPreset(mat, xc.body, {
                shadow2ndColor: xc.shadow2ndColor,
                shadow3rdColor: xc.shadow3rdColor,
                materialName: name,
              });
            } else if (isSocks) {
              applyMToonPartPreset(mat, xc.socks, {
                shadow2ndColor: xc.shadow2ndColor,
                shadow3rdColor: xc.shadow3rdColor,
                materialName: name,
              });
            } else if (isCloth) {
              applyMToonPartPreset(mat, xc.cloth, {
                shadow2ndColor: xc.shadow2ndColor,
                shadow3rdColor: xc.shadow3rdColor,
                materialName: name,
              });
            } else {
              mat.hairSpecStrength = 0.0;
              mat.clothSpecStrength = 0.0;
              mat.skinSpecStrength = 0.0;
            }
            sampleSoftMix ??= mat.softMix;
            } // end xc.enabled
          }

          mat.needsUpdate = true;
        });
      }
    });

    if (import.meta.env.DEV) {
      console.info('[mtoon] extended parts', {
        enabled: !!xc?.enabled,
        count: softAppliedCount,
        sampleSoftMix,
      });
      if (xc?.enabled && softAppliedCount === 0) {
        console.warn('[mtoon] extended material not loaded (softMix missing)');
      }
    }

    this.detectedParts = newDetectedParts;
    this.applySaturations();
    this.applyPartsVisibility();
  }

  /**
   * 应用当前全量部件可见性状态
   */
  applyPartsVisibility(): void {
    Object.entries(this.partsVisibility).forEach(([partId, visible]) => {
      const mats = this.partMaterials[partId] || [];
      mats.forEach((mat: any) => {
        mat.visible = visible;
      });
      // 同步切 mesh 可见性 — 否则 bounding box 仍把 mesh 几何算进去,身高不会变。
      const meshes = this.partMeshes[partId] || [];
      meshes.forEach((mesh) => {
        mesh.visible = visible;
      });
    });
  }

  setPartVisibility(partId: string, visible: boolean): void {
    this.partsVisibility[partId] = visible;
    const mats = this.partMaterials[partId] || [];
    mats.forEach((mat: any) => {
      mat.visible = visible;
    });
    // ponytail: 同步切 mesh.visible — 渲染走材质,身高 / 包围盒 / 八叉树裁剪走 mesh。
    // 鞋子 toggle 时材质已经隐藏,但若不切 mesh.visible,getCurrentHeightCm() 走 live
    // 路径遍历 scene 会把鞋的 mesh 几何算进 bounding box,身高读数不变。
    const meshes = this.partMeshes[partId] || [];
    meshes.forEach((mesh) => {
      mesh.visible = visible;
    });
  }

  /**
   * ponytail: 运行时替换某个部件的主贴图(_MainTex / .map)。
   * 不重建 GameObject、不动 Animator → VRMA / blendshape / physics 全部保留。
   * 用于"加载 diff 文件"按钮:把 VRoid Studio 另一份导出的 body atlas 喂给当前 VRM 实例。
   */
  async replacePartTexture(partId: string, url: string): Promise<THREE.Texture> {
    const loader = new THREE.TextureLoader();
    const tex = await loader.loadAsync(url);
    // VRoid Studio 导出的 PNG 用 top-left 原点 → flipY = false 才能正确朝向
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    const mats = this.partMaterials[partId] || [];
    if (mats.length === 0) {
      console.warn(`[replacePartTexture] part ${partId} 没有材质,贴图未应用`);
      return tex;
    }
    for (const mat of mats) {
      // 释放旧贴图,避免 GPU 内存泄漏
      if (mat.map && mat.map !== tex) mat.map.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
    }
    return tex;
  }

  resetAllPartsVisibility(): void {
    this.detectedParts.forEach((p) => {
      this.setPartVisibility(p.id, true);
    });
    MODEL_PARTS_CONFIG.forEach((p) => {
      this.setPartVisibility(p.id, true);
    });
  }

  /**
   * 按 config.ts 权威配置重置全部件的初始穿脱/显隐状态
   */
  resetToDefaultConfig(): void {
    this.detectedParts.forEach((p) => {
      const defVis = APP_CONFIG.wardrobe.defaultVisibility[p.id] ?? p.defaultVisible ?? true;
      this.setPartVisibility(p.id, defVis);
    });
    MODEL_PARTS_CONFIG.forEach((p) => {
      const defVis = APP_CONFIG.wardrobe.defaultVisibility[p.id] ?? p.defaultVisible ?? true;
      this.setPartVisibility(p.id, defVis);
    });
  }

  /**
   * 一键脱下全部服装（仅保留身体、面部与发型）
   */
  undressAllClothing(): void {
    const clothingParts = MODEL_PARTS_CONFIG.filter((p) => p.category === 'clothing');
    clothingParts.forEach((p) => {
      this.setPartVisibility(p.id, false);
    });
  }

  /**
   * 一键穿上全部服装
   */
  dressAllClothing(): void {
    const clothingParts = MODEL_PARTS_CONFIG.filter((p) => p.category === 'clothing');
    clothingParts.forEach((p) => {
      this.setPartVisibility(p.id, true);
    });
  }

  /**
   * 按分类一键批量设置可见性（脱下/穿上该分类全部部件）
   */
  setCategoryVisibility(category: ModelPartCategory, visible: boolean): void {
    const parts = MODEL_PARTS_CONFIG.filter((p) => p.category === category);
    parts.forEach((p) => {
      this.setPartVisibility(p.id, visible);
    });
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
        localStorage.setItem(MAT_SATURATION_KEY, JSON.stringify(this.saturation));
      }
    } catch { }
  }

  /** 面部阴影隔离：true 时面部跳过 shadowmap 接收，保持白皙不毁容 */
  public setFaceShadowIsolation(enable: boolean): void {
    if (this.currentVRM) {
      this.currentVRM.scene.traverse((obj: THREE.Object3D) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          const meshName = (mesh.name || '').toLowerCase();
          const isFace =
            meshName.includes('face') ||
            meshName.includes('head') ||
            meshName.includes('eye') ||
            meshName.includes('mouth') ||
            meshName.includes('brow');
          if (isFace) {
            mesh.receiveShadow = !enable;
          }
        }
      });
    }
    this.categorizedMaterials.skin?.forEach((mat: any) => {
      const name = (mat.name || '').toLowerCase();
      const isFaceMat = name.includes('face') || name.includes('head') || name.includes('mouth') || name.includes('brow');
      if (isFaceMat) {
        mat.receiveShadowRate = enable ? 0.0 : 1.0;
      }
    });
  }

  /** 衣服掠射角织物微光强度 (0.0 ~ 1.0) */
  public setFabricSheenStrength(strength: number): void {
    this.categorizedMaterials.clothing?.forEach((mat: any) => {
      mat.fabricSheenStrength = strength;
    });
  }

  applyPreset(presetKey: MaterialSaturationPresetKey): void {
    const preset = APP_CONFIG.saturation.presets[presetKey];
    this.setSaturation({ ...preset, preset: presetKey });
  }
}
