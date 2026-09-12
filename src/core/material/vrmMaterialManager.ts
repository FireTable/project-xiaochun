import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import {
  APP_CONFIG,
  type MaterialSaturationConfig,
  type ModelPartCategory,
  type ModelPartDefinition,
  type ModelPartCategoryDefinition,
} from '@/config';
import { MAT_SATURATION_KEY } from '@/lib/constants';

export type MaterialSaturationSettings = MaterialSaturationConfig;
export type MaterialSaturationPresetKey = keyof typeof APP_CONFIG.saturation.presets;

export type { ModelPartCategory, ModelPartDefinition, ModelPartCategoryDefinition };

/**
 * 权威单一数据源 (Single Source of Truth) — 统一由 config.ts wardrobe 节点驱动
 */
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
    (name.includes('onepiece') && (name.includes('010') || name.includes('acc') || name.includes('chain')))
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
    } catch {}
  }

  /**
   * 遍历 VRM 实例的所有网格材质，执行语义化归类并注入独立饱和度 Uniform
   */
  optimize(vrm: VRM): void {
    this.categorizedMaterials = { skin: [], hair: [], clothing: [], eyes: [] };
    this.partMaterials = {};
    this.partMeshes = {};
    const seenPartIds = new Set<string>();
    const newDetectedParts: ModelPartDefinition[] = [];

    vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat: any) => {
          if (!mat || !mat.isMToonMaterial) return;

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

            const isBody = name.includes('body');
            if (isBody) {
              mat.shadeShift = 0.0;
              mat.shadeToony = 0.92;
              if (mat.shadeColor) mat.shadeColor.setHex(0xf4cfbf);
            } else {
              mat.shadeShift = 0.03;
              mat.shadeToony = 0.96;
              if (mat.shadeColor) mat.shadeColor.setHex(0xfde4db);
            }
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
    } catch {}
  }

  applyPreset(presetKey: MaterialSaturationPresetKey): void {
    const preset = APP_CONFIG.saturation.presets[presetKey];
    this.setSaturation({ preset: presetKey, ...preset });
  }
}
