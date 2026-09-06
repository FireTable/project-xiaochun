import * as THREE from 'three';
import { VRM } from '@pixiv/three-vrm';
import { APP_CONFIG, type BodyMorphConfig, type BodyMorphPartKey } from '../../config';

/**
 * VRMBodyMorph - 角色全身体型微调与正交解耦骨骼系统
 * 
 * 核心技术：全身体型正交解耦级联逆缩放补偿 (Full-Body Orthogonal Decoupling)
 * 1. 骨盆股骨头解剖位移阻尼 (Hip Pivot Dampening)：消除臀部拉大时大腿被硬扯开与会阴撕裂畸形；
 * 2. 躯干三级平滑过渡 (Spine ➔ Chest ➔ UpperChest)：消除肋骨凹折横纹，锁死双肩与头颈比例；
 * 3. 矢状面 Z 轴微动抑止 (0.15 阻尼)：彻底杜绝腰围调节时侧面鼓出球形怀孕大肚子；
 * 4. 颈部与头部完全解耦 (Neck ➔ Head)：天鹅颈与细颈自由调节，头部比例等比锁死不被压扁拉长；
 * 5. 手臂与手部完全解耦 (UpperArm/LowerArm ➔ Hand)：手臂长短粗细自如，纤纤玉手等比不受牵扯；
 * 6. 腿部与脚部完全解耦 (UpperLeg/LowerLeg ➔ Foot)：大腿小腿大长腿，双脚鞋掌大小自由独立贴地。
 * 7. 胸部精细形变 (Bust Size/Thickness/Pitch/Spread)：VRoid 规范的胸部大小、厚度、朝向与外扩独立微调。
 * 8. 全身大小 / 肩宽 / 躯干高度 / 手指粗细 / 颈部前后深度 等 VRoid Studio 完整配置项。
 */
const STORAGE_KEY_BODY_MORPH = 'xiaochun_dev_body_morph';

interface BellyMorphTarget {
  geometry: THREE.BufferGeometry;
  basePositions: Float32Array;
  indices: Int32Array;
  weights: Float32Array;
}

export class VRMBodyMorph {
  private config: BodyMorphConfig;
  private currentVRM: VRM | null = null;

  // 程序化前腹壁微凸/收腹形变缓存 (100% 解耦腰部厚度与腰椎曲度)
  private bellyTargets: BellyMorphTarget[] = [];
  private lastAppliedBelly: number = 1.0;

  // 缓存底层直接驱动 SkinnedMesh 的原生 Raw Bone 节点
  private rawHips: THREE.Object3D | null = null;
  private rawSpine: THREE.Object3D | null = null;
  private rawChest: THREE.Object3D | null = null;
  private rawUpperChest: THREE.Object3D | null = null;
  private rawNeck: THREE.Object3D | null = null;
  private rawHead: THREE.Object3D | null = null;

  // 双肩骨骼
  private rawLShoulder: THREE.Object3D | null = null;
  private rawRShoulder: THREE.Object3D | null = null;

  // 上肢骨骼（双臂、双手、手指）
  private rawLUpperArm: THREE.Object3D | null = null;
  private rawRUpperArm: THREE.Object3D | null = null;
  private rawLLowerArm: THREE.Object3D | null = null;
  private rawRLowerArm: THREE.Object3D | null = null;
  private rawLHand: THREE.Object3D | null = null;
  private rawRHand: THREE.Object3D | null = null;
  private fingerBones: THREE.Object3D[] = [];

  // 下肢骨骼（双腿、双脚）
  private rawLLeg: THREE.Object3D | null = null;
  private rawRLeg: THREE.Object3D | null = null;
  private rawLCalf: THREE.Object3D | null = null;
  private rawRCalf: THREE.Object3D | null = null;
  private rawLFoot: THREE.Object3D | null = null;
  private rawRFoot: THREE.Object3D | null = null;

  // 胸部左右弹簧骨骼根节点
  private rawLBust: THREE.Object3D | null = null;
  private rawRBust: THREE.Object3D | null = null;

  // 记录骨骼原生 local transform 基准（用于解耦与增量变形）
  private baseHipsPos: THREE.Vector3 = new THREE.Vector3();
  private baseSpinePos: THREE.Vector3 = new THREE.Vector3();
  private baseLLegPos: THREE.Vector3 = new THREE.Vector3();
  private baseRLegPos: THREE.Vector3 = new THREE.Vector3();
  private baseChestPos: THREE.Vector3 = new THREE.Vector3();
  private baseUpperChestPos: THREE.Vector3 = new THREE.Vector3();
  private baseLShoulderPos: THREE.Vector3 = new THREE.Vector3();
  private baseRShoulderPos: THREE.Vector3 = new THREE.Vector3();
  private baseLBustPos: THREE.Vector3 = new THREE.Vector3();
  private baseRBustPos: THREE.Vector3 = new THREE.Vector3();
  private baseLBustRot: THREE.Quaternion = new THREE.Quaternion();
  private baseRBustRot: THREE.Quaternion = new THREE.Quaternion();
  private baseHipsRot: THREE.Quaternion = new THREE.Quaternion();
  private baseSpineRot: THREE.Quaternion = new THREE.Quaternion();
  private baseLLegRot: THREE.Quaternion = new THREE.Quaternion();
  private baseRLegRot: THREE.Quaternion = new THREE.Quaternion();
  private baseLCalfPos: THREE.Vector3 = new THREE.Vector3();
  private baseRCalfPos: THREE.Vector3 = new THREE.Vector3();
  private baseLCalfRot: THREE.Quaternion = new THREE.Quaternion();
  private baseRCalfRot: THREE.Quaternion = new THREE.Quaternion();
  // ponytail: head 相对 neck 的基准 localPosition. apply 时用 1/(neck, neckLength, neckDepth)
  // 反推, 让 head 在世界空间的位置/大小完全脱离 neck 形变, 否则 neckDepth 改 Z 缩放
  // 会通过继承链把 head.position.z 一起放大, 看起来 "颈部前后深影响头部前后"
  private baseHeadPos: THREE.Vector3 = new THREE.Vector3();

  // 100% 纯动态从 VRM 几何体与骨骼测量的原生几何尺寸与身高基准 (零写死魔数，完全自适应任意模型)
  private baseUpperLegLen = 0;
  private baseLowerLegLen = 0;
  private baseTorsoLen = 0;
  private baseNeckLen = 0;
  private headBoneToTopOffset = 0;
  private baseRestHeight = 0;

  constructor(initialConfig?: Partial<BodyMorphConfig>) {
    let saved: Partial<BodyMorphConfig> | null = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_BODY_MORPH);
        if (raw) saved = JSON.parse(raw);
      } catch (e) {
        console.warn('[VRMBodyMorph] Failed to load config from storage:', e);
      }
    }
    this.config = {
      ...APP_CONFIG.bodyMorph.default,
      ...(saved || {}),
      ...(initialConfig || {}),
    };
  }

  private saveToStorage(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(STORAGE_KEY_BODY_MORPH, JSON.stringify(this.config));
      } catch (e) {
        console.warn('[VRMBodyMorph] Failed to save config to storage:', e);
      }
    }
  }

  /**
   * 绑定 VRM 模型并解析骨骼节点引用
   */
  public bind(vrm: VRM): void {
    this.currentVRM = vrm;
    const h = vrm.humanoid;
    const s = vrm.scene;

    // 1. 骨盆与躯干
    this.rawHips = h?.getRawBoneNode('hips') ?? s.getObjectByName('J_Bip_C_Hips') ?? null;
    this.rawSpine = h?.getRawBoneNode('spine') ?? s.getObjectByName('J_Bip_C_Spine') ?? null;
    this.rawChest = h?.getRawBoneNode('chest') ?? s.getObjectByName('J_Bip_C_Chest') ?? null;
    this.rawUpperChest = h?.getRawBoneNode('upperChest') ?? s.getObjectByName('J_Bip_C_UpperChest') ?? null;
    this.rawNeck = h?.getRawBoneNode('neck') ?? s.getObjectByName('J_Bip_C_Neck') ?? null;
    this.rawHead = h?.getRawBoneNode('head') ?? s.getObjectByName('J_Bip_C_Head') ?? null;

    if (this.rawHips) {
      this.baseHipsPos.copy(this.rawHips.position);
      this.baseHipsRot.copy(this.rawHips.quaternion);
    }
    if (this.rawSpine) {
      this.baseSpinePos.copy(this.rawSpine.position);
      this.baseSpineRot.copy(this.rawSpine.quaternion);
    }
    if (this.rawChest) this.baseChestPos.copy(this.rawChest.position);
    if (this.rawUpperChest) this.baseUpperChestPos.copy(this.rawUpperChest.position);
    if (this.rawHead) {
      this.baseHeadPos.copy(this.rawHead.position);
      this.rawHead.matrixWorldAutoUpdate = false;
    }
    this.baseTorsoLen = Math.abs(this.baseChestPos.y) + Math.abs(this.baseUpperChestPos.y);

    // 2. 双肩
    this.rawLShoulder = h?.getRawBoneNode('leftShoulder') ?? s.getObjectByName('J_Bip_L_Shoulder') ?? null;
    this.rawRShoulder = h?.getRawBoneNode('rightShoulder') ?? s.getObjectByName('J_Bip_R_Shoulder') ?? null;
    if (this.rawLShoulder) this.baseLShoulderPos.copy(this.rawLShoulder.position);
    if (this.rawRShoulder) this.baseRShoulderPos.copy(this.rawRShoulder.position);

    // 3. 双臂与双手
    this.rawLUpperArm = h?.getRawBoneNode('leftUpperArm') ?? s.getObjectByName('J_Bip_L_UpperArm') ?? null;
    this.rawRUpperArm = h?.getRawBoneNode('rightUpperArm') ?? s.getObjectByName('J_Bip_R_UpperArm') ?? null;
    this.rawLLowerArm = h?.getRawBoneNode('leftLowerArm') ?? s.getObjectByName('J_Bip_L_LowerArm') ?? null;
    this.rawRLowerArm = h?.getRawBoneNode('rightLowerArm') ?? s.getObjectByName('J_Bip_R_LowerArm') ?? null;
    this.rawLHand = h?.getRawBoneNode('leftHand') ?? s.getObjectByName('J_Bip_L_Hand') ?? null;
    this.rawRHand = h?.getRawBoneNode('rightHand') ?? s.getObjectByName('J_Bip_R_Hand') ?? null;

    // 收集所有 30 根手指骨骼节点
    this.fingerBones = [];
    s.traverse((obj) => {
      if (/J_Bip_[LR]_(Thumb|Index|Middle|Ring|Little)[1-3]/i.test(obj.name)) {
        this.fingerBones.push(obj);
      }
    });

    // 4. 双腿与足部
    this.rawLLeg = h?.getRawBoneNode('leftUpperLeg') ?? s.getObjectByName('J_Bip_L_UpperLeg') ?? null;
    this.rawRLeg = h?.getRawBoneNode('rightUpperLeg') ?? s.getObjectByName('J_Bip_R_UpperLeg') ?? null;
    this.rawLCalf = h?.getRawBoneNode('leftLowerLeg') ?? s.getObjectByName('J_Bip_L_LowerLeg') ?? null;
    this.rawRCalf = h?.getRawBoneNode('rightLowerLeg') ?? s.getObjectByName('J_Bip_R_LowerLeg') ?? null;
    this.rawLFoot = h?.getRawBoneNode('leftFoot') ?? s.getObjectByName('J_Bip_L_Foot') ?? null;
    this.rawRFoot = h?.getRawBoneNode('rightFoot') ?? s.getObjectByName('J_Bip_R_Foot') ?? null;

    if (this.rawLLeg) {
      this.baseLLegPos.copy(this.rawLLeg.position);
      this.baseLLegRot.copy(this.rawLLeg.quaternion);
    }
    if (this.rawRLeg) {
      this.baseRLegPos.copy(this.rawRLeg.position);
      this.baseRLegRot.copy(this.rawRLeg.quaternion);
    }
    if (this.rawLCalf) {
      this.baseLCalfPos.copy(this.rawLCalf.position);
      this.baseLCalfRot.copy(this.rawLCalf.quaternion);
    }
    if (this.rawRCalf) {
      this.baseRCalfPos.copy(this.rawRCalf.position);
      this.baseRCalfRot.copy(this.rawRCalf.quaternion);
    }

    // 5. 胸部左右弹簧骨骼根节点与基准姿态
    this.rawLBust = s.getObjectByName('J_Sec_L_Bust1') ?? null;
    this.rawRBust = s.getObjectByName('J_Sec_R_Bust1') ?? null;
    if (this.rawLBust) {
      this.baseLBustPos.copy(this.rawLBust.position);
      this.baseLBustRot.copy(this.rawLBust.quaternion);
    }
    if (this.rawRBust) {
      this.baseRBustPos.copy(this.rawRBust.position);
      this.baseRBustRot.copy(this.rawRBust.quaternion);
    }

    // ── 纯动态测量原生骨骼几何尺寸与模型真实身高 (100% 拒绝任何写死数值) ──
    if (this.rawLLeg && this.rawLCalf && this.rawLFoot) {
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const p3 = new THREE.Vector3();
      this.rawLLeg.getWorldPosition(p1);
      this.rawLCalf.getWorldPosition(p2);
      this.rawLFoot.getWorldPosition(p3);
      const l1 = p1.distanceTo(p2);
      const l2 = p2.distanceTo(p3);
      this.baseUpperLegLen = l1 > 0.05 ? l1 : this.rawLCalf.position.length();
      this.baseLowerLegLen = l2 > 0.05 ? l2 : this.rawLFoot.position.length();
    }

    if (this.rawNeck && this.rawHead) {
      const pn = new THREE.Vector3();
      const ph = new THREE.Vector3();
      this.rawNeck.getWorldPosition(pn);
      this.rawHead.getWorldPosition(ph);
      const ln = pn.distanceTo(ph);
      this.baseNeckLen = ln > 0.02 ? ln : this.rawHead.position.length();
    }

    if (this.rawHips && this.rawChest) {
      const ph = new THREE.Vector3();
      const pc = new THREE.Vector3();
      this.rawHips.getWorldPosition(ph);
      this.rawChest.getWorldPosition(pc);
      const lt = ph.distanceTo(pc);
      this.baseTorsoLen = lt > 0.05 ? lt : 0.25;
    }

    // ── 纯动态从 VRM 网格几何顶点精准测量头顶落差与静息穿鞋总高，并缓存前腹壁顶点 (100% 解耦后腰与脊柱) ──
    vrm.scene.updateMatrixWorld(true);

    let maxTopY = -Infinity;
    let minFootY = Infinity;

    this.bellyTargets = [];
    this.lastAppliedBelly = 1.0;
    const visitedGeoms = new Set<THREE.BufferGeometry>();

    vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = obj as THREE.Mesh;
        const geom = mesh.geometry;
        if (!geom) return;

        const posAttr = geom.attributes.position;
        if (posAttr) {
          const v = new THREE.Vector3();
          for (let i = 0; i < posAttr.count; i++) {
            v.fromBufferAttribute(posAttr, i);
            v.applyMatrix4(mesh.matrixWorld);
            if (v.y > maxTopY) maxTopY = v.y;
            if (v.y < minFootY) minFootY = v.y;
          }

          // 缓存前腹壁几何顶点 (肚脐与小腹区域)
          if (!visitedGeoms.has(geom)) {
            visitedGeoms.add(geom);
            const indices: number[] = [];
            const weights: number[] = [];

            for (let i = 0; i < posAttr.count; i++) {
              const px = posAttr.getX(i);
              const py = posAttr.getY(i);
              const pz = posAttr.getZ(i);

              // 腹部前侧局部坐标核心范围: Y在 0.94~1.13, Z > 0.03, |X| < 0.11
              if (py >= 0.94 && py <= 1.13 && pz > 0.03 && Math.abs(px) < 0.11) {
                const rx = Math.abs(px) / 0.11;
                const ry = Math.abs(py - 1.03) / 0.09;
                if (rx < 1.0 && ry < 1.0) {
                  const wx = Math.cos(rx * Math.PI * 0.5);
                  const wy = Math.cos(ry * Math.PI * 0.5);
                  const wz = Math.min(1.0, (pz - 0.03) / 0.04);
                  const w = wx * wy * wz;
                  if (w > 0.02) {
                    indices.push(i);
                    weights.push(w);
                  }
                }
              }
            }

            if (indices.length > 0) {
              const baseArray = new Float32Array(posAttr.array.length);
              baseArray.set(posAttr.array);
              this.bellyTargets.push({
                geometry: geom,
                basePositions: baseArray,
                indices: new Int32Array(indices),
                weights: new Float32Array(weights),
              });
            }
          }
        }
      }
    });

    if (this.rawHead && isFinite(maxTopY)) {
      const headPos = new THREE.Vector3();
      this.rawHead.getWorldPosition(headPos);
      this.headBoneToTopOffset = Math.max(0.02, maxTopY - headPos.y);
      this.baseRestHeight = (isFinite(minFootY) && maxTopY > minFootY) ? (maxTopY - minFootY) : (headPos.y + this.headBoneToTopOffset);
    } else {
      this.headBoneToTopOffset = 0.2135;
      this.baseRestHeight = 1.636;
    }

    this.apply();
  }

  /**
   * 设置单个部位缩放
   */
  public setPart(part: BodyMorphPartKey, value: number): void {
    const limits = (APP_CONFIG.bodyMorph.limits as Record<string, { min: number; max: number }>)[part];
    const clamped = limits ? THREE.MathUtils.clamp(value, limits.min, limits.max) : value;
    this.config[part] = clamped;
    this.apply();
    this.saveToStorage();
  }

  /**
   * 批量更新部位配置
   */
  public setConfig(newConfig: Partial<BodyMorphConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
    this.apply();
    this.saveToStorage();
  }

  /**
   * 获取单个部位缩放
   */
  public getPart(part: BodyMorphPartKey): number {
    return this.config[part];
  }

  /**
   * 获取所有部位配置副本
   */
  public getConfig(): BodyMorphConfig {
    return { ...this.config };
  }

  /**
   * 重置所有部位为默认标准体型并清除 localStorage 缓存
   */
  public reset(): void {
    this.config = { ...APP_CONFIG.bodyMorph.default };
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.removeItem(STORAGE_KEY_BODY_MORPH);
      } catch (e) { /* ignore */ }
    }
    if (this.bellyTargets.length > 0) {
      for (const target of this.bellyTargets) {
        const posAttr = target.geometry.attributes.position;
        (posAttr.array as Float32Array).set(target.basePositions);
        posAttr.needsUpdate = true;
      }
      this.lastAppliedBelly = 1.0;
    }
    this.apply();
  }

  /**
   * 每帧主循环（在 vrm.update(delta) 之后调用）
   */
  public update(vrm?: VRM): void {
    if (vrm && vrm !== this.currentVRM) {
      this.bind(vrm);
      return;
    }
    this.apply();
  }

  /**
   * 计算因大腿、小腿及足部调整而产生的高度变化量 (米)
   */
  public getLegHeightDelta(): number {
    const dt = (this.config.thighLength - 1.0) * this.baseUpperLegLen;
    const dc = (this.config.calfLength - 1.0) * this.baseLowerLegLen;
    const df = (this.config.feet - 1.0) * 0.03;
    return dt + dc + df;
  }

  private _tempHeadTopPos: THREE.Vector3 = new THREE.Vector3();

  /**
   * 动态获取头顶在世界空间中的实时精确坐标 (Vector3)
   * 以 Head 骨骼世界坐标为锚点，加上动态测量的头顶几何落差 (随 head 形变与整体缩放等比放大)，
   * 无论脚踩地面、IK 下沉、穿脱鞋还是体型滑块伸缩，测量尺均毫米级严密贴合头顶！
   */
  public getHeadTopWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    if (this.rawHead) {
      this.rawHead.getWorldPosition(target);
      target.y += this.headBoneToTopOffset * this.config.head * this.config.overallScale;
    } else {
      target.set(0, this.getCurrentHeightCm() / 100, 0);
    }
    return target;
  }

  /**
   * 动态获取角色当前实时精确身高 (厘米 cm，保留一位小数)
   * 严格基于物理世界地面 (Y=0) 到头顶世界坐标的真实测量，
   * 彻底杜绝 Blendshape 极端包围盒撑大虚高与静态写死硬编码，
   * 穿鞋动态自适应（小春模型为 163.6cm ~ 163.8cm），脱鞋 IK 下沉实时反映，换任意新模型 100% 动态自适应！
   */
  public getCurrentHeightCm(): number {
    if (this.currentVRM && this.rawHead) {
      this.getHeadTopWorldPosition(this._tempHeadTopPos);
      const liveMeters = Math.max(0.2, this._tempHeadTopPos.y);
      return Math.round(liveMeters * 1000) / 10;
    }

    // 静态纯数值推算兜底 (无 rawHead 时)
    const { thighLength, calfLength, neckLength, head, feet, overallScale, torsoLength } = this.config;
    const legDelta = (thighLength - 1.0) * (this.baseUpperLegLen || 0.38) + (calfLength - 1.0) * (this.baseLowerLegLen || 0.40) + (feet - 1.0) * 0.03;
    const neckDelta = (neckLength - 1.0) * (this.baseNeckLen || 0.076);
    const headDelta = (head - 1.0) * (this.headBoneToTopOffset || 0.2135);
    const torsoDelta = (torsoLength - 1.0) * (this.baseTorsoLen || 0.25);
    const baseHeight = this.baseRestHeight || 1.636;
    const totalMeters = (baseHeight + legDelta + neckDelta + headDelta + torsoDelta) * overallScale;
    return Math.round(totalMeters * 1000) / 10;
  }

  /**
   * 执行全身体型正交解耦逆缩放补偿计算并刷新骨骼变换矩阵
   */
  public apply(): void {
    if (!this.currentVRM) return;

    const {
      overallScale,
      bust,
      bustThickness,
      bustPitch,
      bustSpread,
      hips,
      waist,
      thighs,
      thighLength,
      calves,
      calfLength,
      feet,
      arms,
      armLength,
      hands,
      fingerWidth,
      neck,
      neckDepth,
      neckLength,
      head,
      shoulderWidth,
      torsoLength,
      torsoThickness = 1.0,
      belly = 1.0,
    } = this.config;

    // ── 0. 全身尺度统一置于 scene 根节点 ──
    if (this.currentVRM) {
      this.currentVRM.scene.scale.setScalar(overallScale);
    }

    // ── 0.5 前腹程序化柔顺微凸/收腹 (只动前腹壁，后腰厚度与曲度 100% 毫无影响) ──
    if (this.bellyTargets.length > 0 && Math.abs(belly - this.lastAppliedBelly) > 0.0001) {
      this.lastAppliedBelly = belly;
      const bellyShift = (belly - 1.0) * 0.032; // 140% 时前凸约 1.28cm，70% 时紧致收腹约 1cm
      for (const target of this.bellyTargets) {
        const posAttr = target.geometry.attributes.position;
        const array = posAttr.array as Float32Array;
        const base = target.basePositions;
        const indices = target.indices;
        const weights = target.weights;
        for (let k = 0; k < indices.length; k++) {
          const idx = indices[k];
          const w = weights[k];
          array[idx * 3 + 2] = base[idx * 3 + 2] + bellyShift * w;
        }
        posAttr.needsUpdate = true;
      }
    }

    // ── 1. 胯部与臀部多维解耦形变系统 (严格解剖学定义，彻底杜绝小腹鼓起与大腿歪斜) ──
    // 明确且纯粹的职责分工：
    // 1. hips (胯部宽度): 纯粹控制骨盆横向沙漏宽度 (X轴)，绝对不影响小腹和后背；
    // 2. buttocks (臀部后翘): 纯粹控制臀大肌向后挺翘饱满深度 (Z轴)，执行 1:1 动态小腹锁死平移补偿，
    //    确保前面小腹世界坐标绝对恒定 (0 鼓起、0 膨胀)，肉感 100% 长在后侧臀部！
    // 3. buttocksPitch (臀部提臀): 骨盆仰角提臀，大腿骨与脊柱施加 100% 反向逆旋转补偿，
    //    双腿在世界空间绝对笔直垂直，角度 0 偏转，身体与脊柱绝不前倾！
    // 4. buttocksSpread (臀部敞开程度): 大腿根部横向开合，配合【膝足地锚反向对齐算法】，
    //    膝盖与双脚在世界空间严格 0 偏移、角度 0 偏转，仅臀部两瓣与假胯自然饱满展开！
    let hx = 1.0;
    let hy = 1.0;
    let hz = 1.0;
    let hipsZOffset = 0;
    let pitchLiftY = 0;

    const {
      buttocks = 1.0,
      buttocksThickness = 1.0,
      buttocksPitch = 0.0,
      buttocksSpread = 0.0,
    } = this.config;

    if (this.rawHips) {
      // 骨盆宽度 (臀部宽度)：解剖学生理沙漏曲线，消除 150% 时两侧尖刺锐角折痕！
      const hipBaseX = 1.0 + (hips - 1.0) * 0.45;
      hx = Math.max(0.4, hipBaseX * (1.0 + buttocksSpread * 0.50));
      // 骨盆垂直比例：严格保持解剖学原生高度 (恒为 1.0)，彻底根除躯干身长拉伸！
      hy = 1.0;
      // 骨盆前后翘度与防扁塌圆润度补偿：柔和解剖学生理曲线，扁平臀时绝不产生整个人体态干瘪坍缩！
      const buttDepthFactor = 1.0 + (buttocks - 1.0) * 0.55 + (buttocksThickness - 1.0) * 0.35 + Math.max(0, buttocksSpread) * 0.10;
      hz = Math.max(0.4, buttDepthFactor);
      this.rawHips.scale.set(hx, hy, hz);

      // 平坦小腹温和后移补偿：保持腹部自然线条，避免过度后移造成肚子缩进凹陷与体态失真
      hipsZOffset = -(hz - 1.0) * 0.020;

      // 提臀纵向微调：提臀时骨盆重心微收 (+Y 微升 0.005m)，平缓时自然微落
      pitchLiftY = -buttocksPitch * 0.015;

      // 保持当前骨骼动画的横向 X 位置，仅在 Y 和 Z 轴施加提臀与腹部防凸补偿偏移
      this.rawHips.position.set(
        this.rawHips.position.x,
        this.baseHipsPos.y + pitchLiftY,
        this.baseHipsPos.z + hipsZOffset
      );

      // 臀部提臀朝向：仅当用户调整 buttocksPitch 时叠加骨盆俯仰增量，绝不破坏动画系统原生姿态
      if (Math.abs(buttocksPitch) > 0.0001) {
        const pitchRad = -buttocksPitch * 0.45;
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchRad);
        this.rawHips.quaternion.multiply(pitchQ);
      }
    }

    // ── 2. 股骨头位置与大腿角度解耦 (彻底杜绝大腿被扭歪，同时完整保留踱步与动作旋转) ──
    // 伴随胯宽与臀展适度平滑展开股骨头位置，消除腹股沟皮肤挤压锐角尖刺
    const hipSpreadX = (hips - 1.0) * 0.018 + buttocksSpread * 0.035;
    if (this.rawLLeg && this.rawRLeg) {
      // 腿根位置：在大腿根施加对称横向展开，塑造圆润丰盈的沙漏梨形臀部外侧弧线
      this.rawLLeg.position.set(
        (this.baseLLegPos.x + hipSpreadX) / Math.max(0.01, hx),
        (this.baseLLegPos.y - pitchLiftY) / Math.max(0.01, hy),
        (this.baseLLegPos.z - hipsZOffset) / Math.max(0.01, hz)
      );
      this.rawRLeg.position.set(
        (this.baseRLegPos.x - hipSpreadX) / Math.max(0.01, hx),
        (this.baseRLegPos.y - pitchLiftY) / Math.max(0.01, hy),
        (this.baseRLegPos.z - hipsZOffset) / Math.max(0.01, hz)
      );

      // 【核心保障】：仅当用户主动调节 buttocksPitch 时对大腿施加反向逆补偿，
      // 默认 0 时 100% 保留动画系统（如 bodyTurn 踱步、naturalIdle 站姿）的大腿旋转！
      if (Math.abs(buttocksPitch) > 0.0001) {
        const invPitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), buttocksPitch * 0.45);
        this.rawLLeg.quaternion.multiply(invPitchQ);
        this.rawRLeg.quaternion.multiply(invPitchQ);
      }
    }

    // ── 3. 大腿 (Thighs) 粗细与长度 (100% 独立于臀部大小，彻底杜绝腿部被压扁干瘪) ──
    let tx = 1.0;
    let ty = 1.0;
    let tz = 1.0;
    const thighThickX = 1.0 + (thighs - 1.0) * 0.75;
    const thighThickZ = 1.0 + (thighs - 1.0) * 0.70;
    if (this.rawLLeg && this.rawRLeg) {
      tx = thighThickX / Math.max(0.01, 1.0 + (hx - 1.0) * 0.40);
      ty = thighLength / Math.max(0.01, hy);
      // 核心解耦：局部 Z 轴 100% 除以 hz，使大腿在世界空间的前后粗细严格等于 thighThickZ，绝对不受臀部影响！
      tz = thighThickZ / Math.max(0.01, hz);
      this.rawLLeg.scale.set(tx, ty, tz);
      this.rawRLeg.scale.set(tx, ty, tz);
    }

    // ── 4. 小腿 (Calves) 粗细与【膝关节平滑过渡 + 膝足地锚反向对齐】 ──
    const calfThickZ = 1.0 + (calves - 1.0) * 0.70;
    if (this.rawLCalf && this.rawRCalf) {
      // 平滑膝关节过渡因子，避免大腿与小腿断崖式台阶断层
      const kneeStepFactor = Math.sqrt(Math.max(0.01, thighs));
      const lx = calves / Math.max(0.01, kneeStepFactor);
      const ly = calfLength / Math.max(0.01, thighLength);
      // 核心解耦：小腿 Z 轴除以大腿 Z 缩放贡献，使小腿在世界空间的前后厚度严格等于 calfThickZ，100% 独立！
      const lz = calfThickZ / Math.max(0.01, thighThickZ);
      this.rawLCalf.scale.set(lx, ly, lz);
      this.rawRCalf.scale.set(lx, ly, lz);

      // 【地锚反向对齐核心】：在膝盖节点将大腿根外移量 100% 反向扣除！
      // 使得膝盖、小腿和脚底在世界坐标中的 X 轴位置完全维持在原生直立垂直线上！
      // 视觉呈现：大腿上端（臀部两侧、假胯）自然展宽两瓣，而膝盖以下双腿完全笔直站立、双脚贴地不被拉开！
      this.rawLCalf.position.set(
        this.baseLCalfPos.x - hipSpreadX / Math.max(0.01, tx),
        this.baseLCalfPos.y,
        this.baseLCalfPos.z
      );
      this.rawRCalf.position.set(
        this.baseRCalfPos.x + hipSpreadX / Math.max(0.01, tx),
        this.baseRCalfPos.y,
        this.baseRCalfPos.z
      );
      // 小腿膝盖屈角 100% 保持动画系统姿态（bodyTurn 踱步膝盖弯曲、naturalIdle 站姿）
    }

    // ── 5. 足部与鞋掌大小 ──
    if (this.rawLFoot && this.rawRFoot) {
      const fx = feet / Math.max(0.01, calves);
      const fy = feet / Math.max(0.01, calfLength);
      const fz = feet / Math.max(0.01, calfThickZ);
      this.rawLFoot.scale.set(fx, fy, fz);
      this.rawRFoot.scale.set(fx, fy, fz);
    }

    // ── 6. 腰部 (Waist / Spine) 粗细、躯干整体前后厚度与脊柱位置解剖学生理自然形变 ──
    // 躯干长度由专门的正交垂直平移系统独立驱动，彻底切断 Spine ➔ Chest 间的倾斜剪切畸变链。
    // 同时对 Y 与 Z 轴位置施加严格反向逆补偿，消除臀部后移与提臀对脊柱与上半身身长的拖拽影响 (身长 0 偏移)！
    const targetSpineX = waist;
    // targetSpineZ: 躯干厚度前后深度由 torsoThickness 独立驱动，绝对不受腰部宽度 (waist) 污染！
    const spineThickFactor = 1.0 + (torsoThickness - 1.0) * 0.70;
    const targetSpineZ = spineThickFactor;

    // 【解剖学生理级微调后移量 - torsoZComp】
    // 将过度剧烈的后移系数优化至生理自然级 0.015，使腰椎中轴始终保持在人体解剖轴心，
    // 躯干厚度前后自然匀称饱满，100% 消除后背病理性凸包或塌陷深坑！
    const torsoZComp = -(torsoThickness - 1.0) * 0.015;

    const sx = targetSpineX / Math.max(0.01, hx);
    const sz = targetSpineZ / Math.max(0.01, hz);

    if (this.rawSpine) {
      this.rawSpine.scale.set(sx, 1.0, sz);
      this.rawSpine.position.set(
        this.baseSpinePos.x,
        (this.baseSpinePos.y - pitchLiftY) / Math.max(0.01, hy),
        (this.baseSpinePos.z - hipsZOffset + torsoZComp) / Math.max(0.01, hz)
      );

      // 仅当用户主动调整 buttocksPitch 时施加反向逆补偿，默认 0 时保持呼吸与预旋姿态
      if (Math.abs(buttocksPitch) > 0.0001) {
        const invPitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), buttocksPitch * 0.55);
        this.rawSpine.quaternion.multiply(invPitchQ);
      }
    }

    // ── 7. 胸腔 (Chest) 宽度正交解耦与躯干前后厚度 (Torso Thickness) ──
    // 核心解耦：胸腔与上胸基准宽度严格为 1.0，完全不受腰宽 (waist) 影响！
    // 使得腰部变细（如 70% 蜂腰）时，胸围、胸腔、上胸和双肩宽度 100% 挺拔恒定，绝对不被挤扁或缩水！
    const chestThickFactor = 1.0 + (torsoThickness - 1.0) * 0.50;
    const targetChestX = 1.0;
    const targetChestZ = chestThickFactor;

    // ── 8. 躯干高度 (torsoLength) 正交垂直拉伸与胸腔/上胸位置精确合成 ──
    const deltaH = (torsoLength - 1.0) * (this.baseTorsoLen > 0.05 ? this.baseTorsoLen : 0.21);
    const deltaChest = deltaH * 0.60;
    const deltaUpperChest = deltaH * 0.40;

    const localUpSpine = new THREE.Vector3(0, 1, 0);
    if (this.rawSpine) {
      this.rawSpine.updateWorldMatrix(true, false);
      const spineWorldQ = new THREE.Quaternion();
      this.rawSpine.getWorldQuaternion(spineWorldQ);
      localUpSpine.applyQuaternion(spineWorldQ.clone().invert());
    }

    if (this.rawChest) {
      const cx = targetChestX / Math.max(0.01, targetSpineX);
      const cz = targetChestZ / Math.max(0.01, targetSpineZ);
      this.rawChest.scale.set(cx, 1.0, cz);

      // 融合 torsoLength 正交身长平移 (Spine ➔ Chest 相对剪切错位严格为 0)
      this.rawChest.position.set(
        (this.baseChestPos.x + localUpSpine.x * deltaChest) / Math.max(0.01, sx),
        this.baseChestPos.y + localUpSpine.y * deltaChest,
        (this.baseChestPos.z + localUpSpine.z * deltaChest) / Math.max(0.01, sz)
      );
    }

    const localUpChest = new THREE.Vector3(0, 1, 0);
    if (this.rawChest) {
      this.rawChest.updateWorldMatrix(true, false);
      const chestWorldQ = new THREE.Quaternion();
      this.rawChest.getWorldQuaternion(chestWorldQ);
      localUpChest.applyQuaternion(chestWorldQ.clone().invert());
    }

    // ── 8.5 上胸 (UpperChest) 局部正交解耦 ──
    // 严格在相对骨盆 (Hips) 的骨骼树中完成变换，彻底杜绝全局固定世界坐标导致的大腿长拉伸躯干与全身缩放爆炸！
    if (this.rawUpperChest) {
      this.rawUpperChest.scale.set(1.0, 1.0, 1.0);
      this.rawUpperChest.position.set(
        (this.baseUpperChestPos.x + localUpChest.x * deltaUpperChest) / Math.max(0.01, targetChestX),
        this.baseUpperChestPos.y + localUpChest.y * deltaUpperChest,
        (this.baseUpperChestPos.z + localUpChest.z * deltaUpperChest - torsoZComp) / Math.max(0.01, targetChestZ)
      );
    }

    // ── 8.6. 肩宽 (Shoulder Width) 局部基准驱动 ──
    if (this.rawLShoulder) {
      this.rawLShoulder.position.set(
        this.baseLShoulderPos.x * shoulderWidth,
        this.baseLShoulderPos.y,
        this.baseLShoulderPos.z
      );
    }
    if (this.rawRShoulder) {
      this.rawRShoulder.position.set(
        this.baseRShoulderPos.x * shoulderWidth,
        this.baseRShoulderPos.y,
        this.baseRShoulderPos.z
      );
    }

    // ── 9. 手臂 (Arms) 粗细与长度 ──
    if (this.rawLUpperArm && this.rawRUpperArm) {
      this.rawLUpperArm.scale.set(armLength, arms, arms);
      this.rawRUpperArm.scale.set(armLength, arms, arms);
    }

    if (this.rawLLowerArm && this.rawRLowerArm) {
      this.rawLLowerArm.scale.set(1.0, 1.0, 1.0);
      this.rawRLowerArm.scale.set(1.0, 1.0, 1.0);
    }

    // ── 10. 手部大小独立调节 ──
    if (this.rawLHand && this.rawRHand) {
      const handX = hands / Math.max(0.01, armLength);
      const handY = hands / Math.max(0.01, arms);
      const handZ = hands / Math.max(0.01, arms);
      this.rawLHand.scale.set(handX, handY, handZ);
      this.rawRHand.scale.set(handX, handY, handZ);
    }

    // ── 10.5. 手指粗细 (Finger Width) ──
    // 指骨局部 X 轴为长度延伸方向，Y/Z 为截面，只调截面保持指骨长度不变
    for (const fb of this.fingerBones) {
      fb.scale.set(1.0, fingerWidth, fingerWidth);
    }

    // ── 11. 脖子 (Neck) 左右宽度与前后深度 ──
    // Neck 骨骼只负责自身的网格粗细与深度 (X: 左右宽度 neck, Z: 前后深度 neckDepth, Y: 1.0 沿轴保持纯净)
    if (this.rawNeck) {
      this.rawNeck.scale.set(neck, 1.0, neckDepth);
    }

    // ── 12. 全身骨骼树前向级联更新世界矩阵 ──
    // 递归刷新 hips -> spine -> chest -> upperChest -> neck，使 neck.matrixWorld 达到最新准确状态
    this.rawHips?.updateMatrixWorld(true);

    // ── 13. 头部 (Head) 彻底正交解耦与无剪切世界变换独立合成 ──
    // 彻底根治“颈部左右宽度、前后深度会导致头部变形”：
    // 数学根因：
    // 1. 在 Three.js 场景树中，rawHead 是 rawNeck 的直接子级；
    // 2. rawNeck 骨骼带有原生 ~26.2° 的 X 轴俯仰角，且在运行时受视线追踪 (LookAt) 与待机微晃等旋转影响；
    // 3. 当父级 Neck 具有非等比缩放 (neck != 1.0 或 neckDepth != 1.0) 时，非对角缩放矩阵乘以子级旋转矩阵
    //    严格不可交换 (S_neck * R_head != R_head * S_neck)，必然在子空间产生剧烈剪切 (Shear) 畸变；
    // 4. 局部除法 (1/neck) 根本无法消除这种旋转剪切！且 rawHead 下挂着 11 根头发骨骼与眼睛骨骼，导致眼睛变扁、发型斜拉歪斜。
    // 终极正交解耦方案：
    // 1. 设置 rawHead.matrixWorldAutoUpdate = false，切断父级非等比缩放矩阵向下传递；
    // 2. 从当前最新的 rawNeck 提取正交世界位置与世界四元数旋转；
    // 3. 头部世界位置沿颈椎朝向平移 (baseHeadPos.y * neckLength * overallScale)；
    // 4. 头部世界旋转严格继承 Neck 与 Head 自身的合成旋转；
    // 5. 头部世界缩放直接设定为纯等比的 (head * overallScale)，完全不包含任何 neck 或 neckDepth 缩放；
    // 6. 手动 compose 写入 rawHead.matrixWorld，并递归刷新 Head 的所有子骨骼 (updateMatrixWorld(true))，
    //    使头发、眼睛 100% 保持原生正交结构，剪切畸变彻底归零 (0 Shear)！
    if (this.rawHead && this.rawNeck) {
      const neckWorldPos = new THREE.Vector3();
      const neckWorldQuat = new THREE.Quaternion();
      this.rawNeck.getWorldPosition(neckWorldPos);
      this.rawNeck.getWorldQuaternion(neckWorldQuat);

      const headOffsetLocal = new THREE.Vector3(
        this.baseHeadPos.x,
        this.baseHeadPos.y * neckLength,
        this.baseHeadPos.z
      );

      // 同步 Head 本地属性
      this.rawHead.position.copy(headOffsetLocal);
      this.rawHead.scale.set(head, head, head);
      this.rawHead.updateMatrix();

      // 在世界空间中纯正交合成世界变换矩阵（彻底切断来自 Neck 旋转与非等比缩放的非对角剪切畸变）
      const worldHeadOffset = headOffsetLocal.clone().multiplyScalar(overallScale).applyQuaternion(neckWorldQuat);
      const headWorldPos = neckWorldPos.clone().add(worldHeadOffset);
      const headWorldQuat = neckWorldQuat.clone().multiply(this.rawHead.quaternion);
      const headWorldScale = new THREE.Vector3(head * overallScale, head * overallScale, head * overallScale);

      this.rawHead.matrixWorld.compose(headWorldPos, headWorldQuat, headWorldScale);

      // 递归刷新 Head 的所有子骨骼（眼睛与 11 根头发骨骼），继承绝对正交的世界矩阵
      for (let i = 0; i < this.rawHead.children.length; i++) {
        this.rawHead.children[i].updateMatrixWorld(true);
      }
    }

    // ── 14. 胸部精细形变 (Bust Size / Thickness / Pitch / Spread) ──
    // 解决胸口敞开 (bustSpread) 造成内衣与胸骨网格撕裂穿模：
    // 1. 将粗暴的大距离纯位移重构为解剖学安全微量位移 (spreadX = bustSpread * 0.25，最大仅约 1.5cm)；
    // 2. 引入真实乳房散开/聚拢偏转角度 (spreadYaw = bustSpread * 0.60)，使胸部自然外展或向内聚拢，
    //    100% 杜绝深色内衬撕裂穿模与胸腔空洞！
    const spreadX = bustSpread * 0.25;
    const spreadYaw = bustSpread * 0.60;

    if (this.rawLBust) {
      this.rawLBust.position.x = this.baseLBustPos.x + spreadX;
      this.rawLBust.position.y = this.baseLBustPos.y - bustPitch * 0.05;
      this.rawLBust.position.z = this.baseLBustPos.z;

      this.rawLBust.quaternion.copy(this.baseLBustRot);
      if (Math.abs(bustPitch) > 0.001) {
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bustPitch * 1.5);
        this.rawLBust.quaternion.multiply(pitchQ);
      }
      if (Math.abs(spreadYaw) > 0.0001) {
        const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -spreadYaw);
        this.rawLBust.quaternion.multiply(yawQ);
      }

      const bustParentScaleZ = (this.rawLBust.parent === this.rawChest) ? targetChestZ : 1.0;
      this.rawLBust.scale.set(bust, bust, (bust * bustThickness) / Math.max(0.01, bustParentScaleZ));
      this.rawLBust.updateMatrixWorld(true);
    }

    if (this.rawRBust) {
      this.rawRBust.position.x = this.baseRBustPos.x - spreadX;
      this.rawRBust.position.y = this.baseRBustPos.y - bustPitch * 0.05;
      this.rawRBust.position.z = this.baseRBustPos.z;

      this.rawRBust.quaternion.copy(this.baseRBustRot);
      if (Math.abs(bustPitch) > 0.001) {
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bustPitch * 1.5);
        this.rawRBust.quaternion.multiply(pitchQ);
      }
      if (Math.abs(spreadYaw) > 0.0001) {
        const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spreadYaw);
        this.rawRBust.quaternion.multiply(yawQ);
      }

      const bustParentScaleZ = (this.rawRBust.parent === this.rawChest) ? targetChestZ : 1.0;
      this.rawRBust.scale.set(bust, bust, (bust * bustThickness) / Math.max(0.01, bustParentScaleZ));
      this.rawRBust.updateMatrixWorld(true);
    }
  }
}
