import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

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
  private isGlancingAway = false;

  // 眨眼参数
  private blinkTimer = 0;
  private blinkInterval = 3.0;
  private blinkDuration = 0.15;
  private isBlinking = false;
  private blinkProgress = 0;

  // 思考权重
  private thinkingWeight = 0.0;

  // LookAt 增量偏移追踪 (供 motionTransition 消除乘法增量)
  public lastNeckLookAtQ = new THREE.Quaternion();
  public lastHeadLookAtQ = new THREE.Quaternion();
  public hasLastLookAt = false;

  // 控制开关
  public isAutoBlink = true;
  public isLookAtEyes = true;
  public isLookAtHead = true;
  public isLockHead = false;

  init(scene: THREE.Scene): void {
    scene.add(this.gazeTarget);
  }

  getLookAtOffsets(): { neck?: THREE.Quaternion; head?: THREE.Quaternion } | undefined {
    return this.hasLastLookAt
      ? { neck: this.lastNeckLookAtQ, head: this.lastHeadLookAtQ }
      : undefined;
  }

  /**
   * 每帧渲染主循环中统一更新
   */
  update(
    vrm: VRM,
    delta: number,
    time: number,
    camera: THREE.Camera,
    isThinking: boolean,
    isSpeaking: boolean,
    emageLive: boolean,
    manualExpression: string | null,
  ): void {
    // ── 1. 思考表情权重平滑淡入淡出 ──
    if (isThinking) {
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
        // 待机或思考态：思考嘴型随 tw 平滑渐变；待机默认闭嘴微带温婉浅笑
        vrm.expressionManager.setValue('ou', 0.65 * tw);
        vrm.expressionManager.setValue('relaxed', 0.15 * tw);
        vrm.expressionManager.setValue('happy', 0);
      }
    }

    // ── 3. 思考头部自然正弦微晃 ──
    const headBone = vrm.humanoid?.getNormalizedBoneNode('head');
    if (headBone && tw > 0.01) {
      const thinkHeadSwayX = Math.sin(time * 1.6) * 0.025 * tw;
      const thinkHeadSwayY = Math.cos(time * 1.1) * 0.035 * tw;
      const thinkHeadSwayZ = Math.sin(time * 1.4) * 0.02 * tw;
      const swayQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(thinkHeadSwayX, thinkHeadSwayY, thinkHeadSwayZ)
      );
      headBone.quaternion.multiply(swayQ);
    }

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

    const headPos = new THREE.Vector3();
    if (headNode) headNode.getWorldPosition(headPos);
    else headPos.copy(vrm.scene.position).add(new THREE.Vector3(0, 1.35, 0));

    this.gazeShiftTimer += delta;
    if (this.gazeShiftTimer >= this.gazeShiftInterval) {
      this.gazeShiftTimer = 0;
      const glanceChance = emageLive ? 0.40 : 0.25;
      this.isGlancingAway = !this.isGlancingAway && Math.random() < glanceChance;
      if (this.isGlancingAway) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.gazeOffsetTarget.set(side * (0.12 + Math.random() * 0.12), -0.08 - Math.random() * 0.08, 0);
        this.gazeShiftInterval = 0.8 + Math.random() * 0.6;
      } else {
        this.gazeOffsetTarget.set(0, 0, 0);
        this.gazeShiftInterval = 3.0 + Math.random() * 2.5;
      }
    }
    this.gazeCurrentOffset.lerp(this.gazeOffsetTarget, Math.min(1.0, delta * 4.0));

    const microSaccadeX = Math.sin(time * 6.7) * 0.012;
    const microSaccadeY = Math.cos(time * 5.3) * 0.008;
    const eyeLevelY = headPos.y - 0.03;
    const clampedGazeY = Math.min(camera.position.y, eyeLevelY + 0.35);

    this.gazeTarget.position.set(
      camera.position.x + this.gazeCurrentOffset.x + microSaccadeX,
      clampedGazeY + this.gazeCurrentOffset.y + microSaccadeY,
      camera.position.z + this.gazeCurrentOffset.z
    );

    // ── 6. 头颈部伴随注视 ──
    if (this.isLookAtHead && headNode && neckNode) {
      const dx = camera.position.x - headPos.x;
      const dy = camera.position.y - headPos.y;
      const dz = camera.position.z - headPos.z;
      const distXZ = Math.sqrt(dx * dx + dz * dz);

      const targetYaw = Math.atan2(dx, dz) - vrm.scene.rotation.y;
      const normYaw = Math.atan2(Math.sin(targetYaw), Math.cos(targetYaw));
      const clampedYaw = Math.max(-0.80, Math.min(0.80, normYaw));

      const targetPitch = this.isLockHead ? 0 : -Math.atan2(dy, distXZ);
      const clampedPitch = this.isLockHead ? 0 : Math.max(-0.42, Math.min(0.38, targetPitch));

      this.lastNeckLookAtQ.setFromEuler(new THREE.Euler(clampedPitch * 0.30, clampedYaw * 0.30, 0, 'YXZ'));
      this.lastHeadLookAtQ.setFromEuler(new THREE.Euler(clampedPitch * 0.70, clampedYaw * 0.70, 0, 'YXZ'));

      neckNode.quaternion.multiply(this.lastNeckLookAtQ);
      headNode.quaternion.multiply(this.lastHeadLookAtQ);
      this.hasLastLookAt = true;
    } else {
      this.hasLastLookAt = false;
    }

    // ── 7. 眼球 VRMLookAt 跟踪 ──
    if (this.isLookAtEyes && vrm.lookAt) {
      vrm.lookAt.target = this.gazeTarget;
      vrm.lookAt.autoUpdate = true;
      vrm.lookAt.update(delta);
    }
  }
}
