import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { MotionTraits } from '../pipeline/types';
import { APP_CONFIG } from '@/config';

/**
 * GazeController — 仿生人机交互视线伴随、眨眼与思考神态微动系统
 * 
 * 职责：
 * 1. 自然生理眨眼 (Auto Blink)：随机 2~5s 周期，结合 0.15s 柔和闭合与睁眼；
 * 2. 镜头视线跟随 (Gaze Tracking)：眼球与头颈平滑追踪相机，严格限制生理偏航角 (±0.80 rad) 与仰俯角 (-0.42 ~ +0.38 rad)，避免翻白眼与断颈；
 * 3. 仿生跳视 (Micro-Saccade) 与偶发侧目漂移 (Glance Away)，赋予角色灵动生命力；
 * 4. 思考神态协调：思考嘴型 ('ou') 随思考权重平滑过渡，思考时头部伴随轻柔正弦晃动；
 * 5. 说话状态表情互斥：朗读时清空思考嘴型，让位给实时语音 LipSync；
 * 6. 输出头颈 LookAt 旋转增量，供 MotionTransition 逆四元数解耦使用。
 */
export class GazeController {
  // 视线目标
  public readonly gazeTarget = new THREE.Object3D();
  private gazeShiftTimer = 0;
  private gazeShiftInterval = 3.5;
  private gazeOffsetTarget = new THREE.Vector3(0, 0, 0);
  private gazeCurrentOffset = new THREE.Vector3(0, 0, 0);
  public isGlancingAway = false;

  // 眨眼参数
  private blinkTimer = 0;
  private blinkInterval = 3.0;
  private blinkDuration = 0.15;
  private isBlinking = false;
  private blinkProgress = 0;

  // 思考权重
  public thinkingWeight = 0.0;

  // LookAt 增量偏移追踪 (供 motionTransition 消除乘法增量)
  public lastNeckLookAtQ = new THREE.Quaternion();
  public lastHeadLookAtQ = new THREE.Quaternion();
  public appliedNeckOffsetQ = new THREE.Quaternion();
  public appliedHeadOffsetQ = new THREE.Quaternion();
  public hasLastLookAt = false;
  public lastClampedYaw = 0;
  public lastClampedPitch = 0;
  public lastTargetYaw = 0;
  public lastTargetPitch = 0;

  // 内部平滑与思考微晃复用对象 (Zero-GC)
  private _targetTotalLookAtQ = new THREE.Quaternion();
  private lastTotalLookAtQ = new THREE.Quaternion();
  private _identityQ = new THREE.Quaternion();
  private _scratchHeadGoalQ = new THREE.Quaternion();
  private _thinkSwayQ = new THREE.Quaternion();
  private _eulerLookAt = new THREE.Euler(0, 0, 0, 'YXZ');
  private _gazeOrigin = new THREE.Vector3();
  private _tempV = new THREE.Vector3();
  private lookAtInitialized = false;
  private lastSceneYaw = 0;
  private _yAxis = new THREE.Vector3(0, 1, 0);
  private _deltaSceneQ = new THREE.Quaternion();
  private _scratchVrm0Q = new THREE.Quaternion();

  // VRM 眼球注视灵敏度动态增强状态
  private lastLookAtVRM: VRM | null = null;
  private isRangeMapEnhanced = false;

  // 控制开关
  public enabled = true;
  public isAutoBlink = true;
  public isLookAtEyes = true;
  public isLookAtHead = true;
  public isLockHead = false;

  init(scene: THREE.Scene): void {
    scene.add(this.gazeTarget);
  }

  /** Snapshot glance offsets for outfit swap (lookAt target is camera-driven each frame). */
  captureSwapState(): {
    gazeOffsetTarget: [number, number, number];
    gazeCurrentOffset: [number, number, number];
    isGlancingAway: boolean;
    gazeShiftTimer: number;
    gazeShiftInterval: number;
  } {
    return {
      gazeOffsetTarget: [this.gazeOffsetTarget.x, this.gazeOffsetTarget.y, this.gazeOffsetTarget.z],
      gazeCurrentOffset: [this.gazeCurrentOffset.x, this.gazeCurrentOffset.y, this.gazeCurrentOffset.z],
      isGlancingAway: this.isGlancingAway,
      gazeShiftTimer: this.gazeShiftTimer,
      gazeShiftInterval: this.gazeShiftInterval,
    };
  }

  restoreSwapState(state: {
    gazeOffsetTarget: [number, number, number];
    gazeCurrentOffset: [number, number, number];
    isGlancingAway: boolean;
    gazeShiftTimer: number;
    gazeShiftInterval: number;
  }): void {
    this.gazeOffsetTarget.set(...state.gazeOffsetTarget);
    this.gazeCurrentOffset.set(...state.gazeCurrentOffset);
    this.isGlancingAway = state.isGlancingAway;
    this.gazeShiftTimer = state.gazeShiftTimer;
    this.gazeShiftInterval = state.gazeShiftInterval;
  }

  getLookAtOffsets(): { neck?: THREE.Quaternion; head?: THREE.Quaternion } | undefined {
    return this.hasLastLookAt
      ? { neck: this.appliedNeckOffsetQ, head: this.appliedHeadOffsetQ }
      : undefined;
  }

  /**
   * 精确约束 VRM 眼球注视偏角范围（各向均统一配置为 12°）：
   * 对应模型配置需求：内侧、外侧、上方、下方均设为 12.0°。
   */
  private ensureEnhancedRangeMap(vrm: VRM): void {
    if (this.lastLookAtVRM !== vrm) {
      this.lastLookAtVRM = vrm;
      this.isRangeMapEnhanced = false;
    }
    if (this.isRangeMapEnhanced || !vrm.lookAt) return;
    const applier = (vrm.lookAt as any).applier;
    if (applier && applier.rangeMapHorizontalOuter) {
      applier.rangeMapHorizontalOuter.inputMaxValue = 45;
      applier.rangeMapHorizontalOuter.outputScale = 12;
      applier.rangeMapHorizontalInner.inputMaxValue = 45;
      applier.rangeMapHorizontalInner.outputScale = 12;
      applier.rangeMapVerticalDown.inputMaxValue = 32;
      applier.rangeMapVerticalDown.outputScale = 6;
      applier.rangeMapVerticalUp.inputMaxValue = 32;
      applier.rangeMapVerticalUp.outputScale = 6;
      this.isRangeMapEnhanced = true;
    }
  }

  /**
   * 每帧渲染主循环中统一更新
   */
  /**
   * 每帧渲染主循环中统一更新
   */
  update(
    vrm: VRM,
    delta: number,
    time: number,
    camera: THREE.Camera,
    traits: MotionTraits,
    isSpeaking: boolean,
    manualExpression: string | null,
  ): void {
    if (!this.enabled) {
      this.hasLastLookAt = false;
      if (vrm.lookAt) vrm.lookAt.autoUpdate = false;
      return;
    }

    if (this.lastLookAtVRM !== vrm) {
      this.lastLookAtVRM = vrm;
      this.isRangeMapEnhanced = false;
      this.lastSceneYaw = vrm.scene.rotation.y;
      this.lookAtInitialized = false;
    }

    // ── 1. 思考表情权重平滑淡入淡出 ──
    if (traits.thinkSway) {
      this.thinkingWeight = Math.min(1.0, this.thinkingWeight + delta * 2.5);
    } else {
      this.thinkingWeight = Math.max(0.0, this.thinkingWeight - delta * 3.0);
    }
    const tw = this.thinkingWeight * this.thinkingWeight * (3 - 2 * this.thinkingWeight);

    // ── 2. 表情管理 ──
    if (vrm.expressionManager) {
      if (manualExpression && manualExpression !== 'neutral') {
        // 开发者手动指定表情时保持不变
      } else if (isSpeaking) {
        // 朗读说话中：清空思考嘴型 ('ou') 与静态微笑，完全让位给实时语音 LipSync ('aa')
        vrm.expressionManager.setValue('ou', 0);
        vrm.expressionManager.setValue('relaxed', 0);
        vrm.expressionManager.setValue('happy', 0);
      } else {
        // 待机态：思考嘴型随 tw 渐变，保持平淡素雅自然神态
        vrm.expressionManager.setValue('ou', 0.65 * tw);
        vrm.expressionManager.setValue('relaxed', 0.15 * tw);
        vrm.expressionManager.setValue('happy', 0);
      }
    }

    // ── 3. 自然生理生命微晃 (Natural Head Vital Sway) 与思考微动 ──
    // 模拟健康人类无意识的极微弱呼吸浮沉与头颈游移 (幅值约 ±0.4°，平滑连续，零机械僵硬感)
    const naturalSwayPitch = Math.sin(time * 1.15) * 0.007; // 约 0.4° 呼吸微俯仰
    const naturalSwayYaw = Math.sin(time * 0.65) * 0.008;   // 约 0.45° 极轻微水平呼吸游移
    const naturalSwayRoll = 0;                              // 严格保持 0 侧倾，杜绝待机自发性歪头与倾斜感

    // 思考晃动增量 (当处于思考状态时优雅叠加)
    const thinkSwayPitch = tw > 0.01 ? Math.sin(time * 1.6) * 0.025 * tw : 0;
    const thinkSwayYaw = tw > 0.01 ? Math.cos(time * 1.1) * 0.035 * tw : 0;
    const thinkSwayRoll = tw > 0.01 ? Math.sin(time * 1.4) * 0.008 * tw : 0; // 极温和侧倾微动

    this._eulerLookAt.set(
      naturalSwayPitch + thinkSwayPitch,
      naturalSwayYaw + thinkSwayYaw,
      naturalSwayRoll + thinkSwayRoll,
    );
    this._thinkSwayQ.setFromEuler(this._eulerLookAt);

    // ── 4. 自然生理眨眼 ──
    if (this.isAutoBlink && vrm.expressionManager) {
      this.blinkTimer += delta;
      if (!this.isBlinking && this.blinkTimer >= this.blinkInterval) {
        this.isBlinking = true;
        this.blinkTimer = 0;
        this.blinkProgress = 0;
        this.blinkInterval = 2.0 + Math.random() * 3.0;
      }
      if (this.isBlinking) {
        this.blinkProgress += delta / this.blinkDuration;
        if (this.blinkProgress <= 0.5) {
          vrm.expressionManager.setValue('blink', this.blinkProgress / 0.5);
        } else if (this.blinkProgress <= 1.0) {
          vrm.expressionManager.setValue('blink', (1.0 - this.blinkProgress) / 0.5);
        } else {
          this.isBlinking = false;
          vrm.expressionManager.setValue('blink', 0);
        }
      }
    }

    // ── 5. 自然视线微颤 (Micro-Saccade) 与注视目标定位 ──
    const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
    const neckNode = vrm.humanoid?.getNormalizedBoneNode('neck');

    // 采用稳定注视基准原点 (Zero-GC, 杜绝闭环震荡)：
    // X与Z坐标严格采用角色世界坐标 (vrm.scene.position)，消除转身踱步时 hips 重心横向摆动 (hipSway)
    // 带来的基准原点微漂移与视线闭环振荡；Y 轴跟踪颈部实际世界高度。
    if (neckNode) {
      neckNode.getWorldPosition(this._tempV);
      this._gazeOrigin.set(vrm.scene.position.x, this._tempV.y + 0.08, vrm.scene.position.z);
    } else {
      this._gazeOrigin.set(vrm.scene.position.x, vrm.scene.position.y + 1.35, vrm.scene.position.z);
    }

    this.gazeShiftTimer += delta;
    if (this.gazeShiftTimer >= this.gazeShiftInterval) {
      this.gazeShiftTimer = 0;
      // 说话时以与观众直接眼神交流为主 (注视率 92%)，避免讲话时眼神持续飘走；待机时自然游移
      const baseGlanceChance = isSpeaking ? 0.08 : (traits.glanceChance ?? 0.20);
      this.isGlancingAway = !this.isGlancingAway && Math.random() < baseGlanceChance;
      if (this.isGlancingAway) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.gazeOffsetTarget.set(side * (0.04 + Math.random() * 0.04), -0.03 - Math.random() * 0.03, 0);
        this.gazeShiftInterval = 0.6 + Math.random() * 0.4;
      } else {
        this.gazeOffsetTarget.set(0, 0, 0);
        this.gazeShiftInterval = 3.5 + Math.random() * 3.0;
      }
    }
    this.gazeCurrentOffset.lerp(this.gazeOffsetTarget, Math.min(1.0, delta * 4.0));

    const dx = camera.position.x - this._gazeOrigin.x;
    const dy = camera.position.y - this._gazeOrigin.y;
    const dz = camera.position.z - this._gazeOrigin.z;
    const distXZ = Math.max(0.08, Math.sqrt(dx * dx + dz * dz));

    const isVrm0 = vrm.meta?.metaVersion === '0';
    const baseYaw = isVrm0 ? Math.PI : 0;
    const currentFacingYaw = vrm.scene.rotation.y - baseYaw;
    const targetYaw = Math.atan2(dx, dz) - currentFacingYaw;
    const normYaw = Math.atan2(Math.sin(targetYaw), Math.cos(targetYaw));

    // 生理视线扇区衰减 (Natural Vision FOV Attenuation)：
    const absNormYaw = Math.abs(normYaw);
    const fovComfort = APP_CONFIG.gaze.fovComfortHalfAngle; // ~1.57 rad (90°)
    const fovBlind = APP_CONFIG.gaze.fovBlindHalfAngle;     // ~2.35 rad (135°)
    let fovWeight = 1.0;
    if (absNormYaw > fovComfort) {
      if (absNormYaw >= fovBlind) {
        fovWeight = 0.0;
      } else {
        const rawW = 1.0 - (absNormYaw - fovComfort) / (fovBlind - fovComfort);
        fovWeight = rawW * rawW * (3.0 - 2.0 * rawW); // smoothstep
      }
    }

    const microSaccadeX = Math.sin(time * 6.7) * 0.012;
    const microSaccadeY = Math.cos(time * 5.3) * 0.008;

    const naturalLookDistance = 3.0;
    const forwardTargetX = this._gazeOrigin.x + Math.sin(currentFacingYaw) * naturalLookDistance;
    const forwardTargetY = this._gazeOrigin.y;
    const forwardTargetZ = this._gazeOrigin.z + Math.cos(currentFacingYaw) * naturalLookDistance;

    const camTargetX = camera.position.x + this.gazeCurrentOffset.x + microSaccadeX;
    const camTargetY = camera.position.y + this.gazeCurrentOffset.y + microSaccadeY;
    const camTargetZ = camera.position.z + this.gazeCurrentOffset.z;

    this.gazeTarget.position.set(
      forwardTargetX + (camTargetX - forwardTargetX) * fovWeight,
      forwardTargetY + (camTargetY - forwardTargetY) * fovWeight,
      forwardTargetZ + (camTargetZ - forwardTargetZ) * fovWeight,
    );

    // ── 6. 头颈部伴随注视与神态合成 ──
    if (this.isLookAtHead && headNode && neckNode) {
      const clampedYaw = Math.max(-0.85, Math.min(0.85, normYaw)) * fovWeight;

      // 俯仰跟随 (Pitch)
      const targetPitch = this.isLockHead ? 0 : -Math.atan2(dy, distXZ);
      const clampedPitch = (this.isLockHead ? 0 : Math.max(-0.42, Math.min(0.36, targetPitch))) * fovWeight;
      this.lastClampedYaw = clampedYaw;
      this.lastClampedPitch = clampedPitch;
      this.lastTargetYaw = normYaw;
      this.lastTargetPitch = targetPitch;

      this._eulerLookAt.set(clampedPitch, clampedYaw, 0, 'YXZ');
      this._targetTotalLookAtQ.setFromEuler(this._eulerLookAt);

      if (!this.lookAtInitialized) {
        this.lastTotalLookAtQ.copy(this._targetTotalLookAtQ);
        this.lastSceneYaw = vrm.scene.rotation.y;
        this.lookAtInitialized = true;
      } else {
        // 身体旋转前馈补偿 (Vestibulo-Ocular & Cervico-Ocular Reflex Feedforward)：
        // 当模型自身 (vrm.scene) 随 BodyTurn 旋转时，其局部坐标系随之转动。
        // 若不对上一帧的 local lookAt 施加反向偏航更新，头部在世界坐标系中就会被身体的旋转强行带偏（诱发超调）。
        // 关键防护：仅在视线未被死死顶在解剖学极限边界（0.83 rad）时施加 VOR，杜绝极限处的对抗振荡与回弹
        const deltaSceneYaw = vrm.scene.rotation.y - this.lastSceneYaw;
        this.lastSceneYaw = vrm.scene.rotation.y;
        if (Math.abs(deltaSceneYaw) > 0.00001 && Math.abs(this.lastClampedYaw) < 0.83) {
          this._deltaSceneQ.setFromAxisAngle(this._yAxis, -deltaSceneYaw);
          this.lastTotalLookAtQ.premultiply(this._deltaSceneQ);
          // 确保物理颈椎最大偏航限幅约束，杜绝反旋出界
          this._eulerLookAt.setFromQuaternion(this.lastTotalLookAtQ, 'YXZ');
          this._eulerLookAt.y = Math.max(-0.85, Math.min(0.85, this._eulerLookAt.y));
          this._eulerLookAt.z = 0;
          this.lastTotalLookAtQ.setFromEuler(this._eulerLookAt);
        }

        const dt = Math.max(0.0001, Math.min(delta, 0.1));
        // 动态自适应追踪刚度：结合人体转头生理角速度上限
        const isTurningOrLargeYaw = Math.abs(deltaSceneYaw) > 0.0001 || Math.abs(normYaw) > 0.15;
        const trackSpeed = isTurningOrLargeYaw ? APP_CONFIG.gaze.trackSpeed : (APP_CONFIG.gaze.trackSpeed * 0.75);
        const smoothAlpha = 1.0 - Math.exp(-trackSpeed * dt);

        // 人体生理极限角速度约束 (Anatomical Angular Velocity Clamping)：
        // 严格限制头颈单帧最大角位移不超过 maxHeadTurnSpeed * dt，彻底消除大角度转头速度过快甩飞头发
        const dot = Math.min(1.0, Math.max(-1.0, Math.abs(this.lastTotalLookAtQ.dot(this._targetTotalLookAtQ))));
        const angleDist = 2.0 * Math.acos(dot);
        let finalAlpha = smoothAlpha;
        if (angleDist > 0.0001) {
          const maxAngleStep = APP_CONFIG.gaze.maxHeadTurnSpeed * dt;
          finalAlpha = Math.min(smoothAlpha, maxAngleStep / angleDist);
        }
        this.lastTotalLookAtQ.slerp(this._targetTotalLookAtQ, finalAlpha);
      }

      // 颈部分担 28% 旋转，头颈合计传导 96%
      this.lastNeckLookAtQ.slerpQuaternions(this._identityQ, this.lastTotalLookAtQ, 0.28);
      this._scratchHeadGoalQ.slerpQuaternions(this._identityQ, this.lastTotalLookAtQ, 0.96);
      // 融合自然生理微晃与思考微晃 (始终平滑连续，杜绝停步重置)
      this._scratchHeadGoalQ.multiply(this._thinkSwayQ);
      // 头骨局部旋转为相较于颈骨同轴前向旋转的增量：inv(neckQ) * headGoalQ
      this.lastHeadLookAtQ.copy(this.lastNeckLookAtQ).invert().multiply(this._scratchHeadGoalQ);

      if (isVrm0) {
        this._scratchVrm0Q.set(
          -this.lastNeckLookAtQ.x,
          this.lastNeckLookAtQ.y,
          -this.lastNeckLookAtQ.z,
          this.lastNeckLookAtQ.w,
        );
        neckNode.quaternion.multiply(this._scratchVrm0Q);
        this._scratchVrm0Q.set(
          -this.lastHeadLookAtQ.x,
          this.lastHeadLookAtQ.y,
          -this.lastHeadLookAtQ.z,
          this.lastHeadLookAtQ.w,
        );
        headNode.quaternion.multiply(this._scratchVrm0Q);
      } else {
        neckNode.quaternion.multiply(this.lastNeckLookAtQ);
        headNode.quaternion.multiply(this.lastHeadLookAtQ);
      }

      // 及时更新头骨世界矩阵，确保眼球 VRMLookAt 计算基于当前帧头部的实际世界朝向
      headNode.updateWorldMatrix(true, false);

      // 记录实际作用到骨骼上的 lookAt 姿态
      this.appliedNeckOffsetQ.copy(this.lastNeckLookAtQ);
      this.appliedHeadOffsetQ.copy(this.lastHeadLookAtQ);
      this.hasLastLookAt = true;
    } else {
      this.hasLastLookAt = false;
    }

    // ── 7. 眼球 VRMLookAt 跟踪与敏捷注视补偿 ──
    // 本帧由 Gaze 调用 lookAt.update；关掉 autoUpdate，避免随后 vrm.update 再算一遍。
    if (this.isLookAtEyes && vrm.lookAt) {
      this.ensureEnhancedRangeMap(vrm);
      vrm.lookAt.target = this.gazeTarget;
      vrm.lookAt.autoUpdate = true;
      vrm.lookAt.update(delta);
      vrm.lookAt.autoUpdate = false;
    } else if (vrm.lookAt) {
      vrm.lookAt.autoUpdate = false;
    }
  }
}
