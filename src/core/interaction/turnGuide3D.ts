import * as THREE from 'three';
import { APP_CONFIG } from '@/config';
import { INTERACTION_GUIDE_PHOTON } from '@/lib/constants';

/**
 * TurnGuide3D — 极简全息光子导引环（强化显眼点阵版）
 * 
 * 优化重点：
 * 1. 统一从 APP_CONFIG.interaction.guideColor 读取全息发光色（默认纯白 #ffffff）；
 * 2. 放大虚线点：点阵半径提升至 2.4px（直径近 5px），间距加至 24px，颗颗分明；
 * 3. 增加点阵发光：附带轻微发光阴影与更高透明度，立体空间圆环轮廓更鲜明；
 * 4. 保持 360° 能量光子顺滑穿梭与拖拽速度联动。
 */
export class TurnGuide3D {
  public readonly group = new THREE.Group();

  // 底层：360° 强化点阵导轨
  private trackMesh: THREE.Mesh | null = null;
  private trackMat: THREE.MeshBasicMaterial | null = null;

  // 顶层：360° 自由穿梭的能量流光
  private flowMesh: THREE.Mesh | null = null;
  private flowMat: THREE.MeshBasicMaterial | null = null;
  private flowTexture: THREE.CanvasTexture | null = null;

  private currentOpacity = 0;
  private targetOpacity = 0;

  private pulseTime = 0;
  private currentFlowOffset = 0;
  private isInitialized = false;

  constructor() {
    this.initGuide();
  }

  private initGuide(): void {
    const radius = 0.36;
    const bandHeight = INTERACTION_GUIDE_PHOTON.thickness;

    const baseColor = new THREE.Color(APP_CONFIG.interaction?.guideColor ?? '#ffffff');
    const hexStr = `#${baseColor.getHexString()}`;
    const r = Math.round(baseColor.r * 255);
    const g = Math.round(baseColor.g * 255);
    const b = Math.round(baseColor.b * 255);
    const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

    // ─────────────────────────────────────────────────────────────
    // 1. 底层：显著放大的 360° 全周空间点阵轨
    // ─────────────────────────────────────────────────────────────
    const trackCanvas = document.createElement('canvas');
    trackCanvas.width = 2048;
    trackCanvas.height = 128;
    const tCtx = trackCanvas.getContext('2d');

    if (tCtx) {
      const w = 2048;
      const h = 128;
      const midY = h / 2;

      tCtx.clearRect(0, 0, w, h);

      // 增大点距至 24px，避免圆点变大后粘连
      const dotSpacing = 24;
      const dotRadius = 2.4; // 点半径从 1.4 翻倍到 2.4（直径 ~4.8px）

      tCtx.fillStyle = rgba(0.40); // 基础亮度
      tCtx.shadowColor = hexStr;
      tCtx.shadowBlur = 4; // 带有轻微发光抗锯齿

      for (let x = 0; x < w; x += dotSpacing) {
        tCtx.beginPath();
        tCtx.arc(x, midY, dotRadius, 0, Math.PI * 2);
        tCtx.fill();
      }
    }

    const trackTexture = new THREE.CanvasTexture(trackCanvas);
    trackTexture.wrapS = THREE.RepeatWrapping;
    trackTexture.wrapT = THREE.ClampToEdgeWrapping;

    const trackGeo = new THREE.CylinderGeometry(radius, radius, bandHeight, 64, 1, true);
    trackGeo.rotateY(Math.PI);

    this.trackMat = new THREE.MeshBasicMaterial({
      map: trackTexture,
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.trackMesh = new THREE.Mesh(trackGeo, this.trackMat);
    this.trackMesh.renderOrder = 20;
    this.group.add(this.trackMesh);

    // ─────────────────────────────────────────────────────────────
    // 2. 顶层：360° 穿梭流光
    // ─────────────────────────────────────────────────────────────
    const flowCanvas = document.createElement('canvas');
    flowCanvas.width = 1024;
    flowCanvas.height = 128;
    const fCtx = flowCanvas.getContext('2d');

    if (fCtx) {
      const w = 1024;
      const h = 128;
      const midY = h / 2;
      const centerX = 0.5 * w;

      fCtx.clearRect(0, 0, w, h);

      // 外围能量彗尾
      const half = INTERACTION_GUIDE_PHOTON.flowUFrac * 0.5;
      const beamStart = (0.5 - half) * w;
      const beamEnd = (0.5 + half) * w;
      const beamGrad = fCtx.createLinearGradient(beamStart, 0, beamEnd, 0);
      beamGrad.addColorStop(0.00, rgba(0.0));
      beamGrad.addColorStop(0.25, rgba(0.25));
      beamGrad.addColorStop(0.44, rgba(0.85));
      beamGrad.addColorStop(0.50, rgba(1.0));
      beamGrad.addColorStop(0.56, rgba(0.85));
      beamGrad.addColorStop(0.75, rgba(0.25));
      beamGrad.addColorStop(1.00, rgba(0.0));

      fCtx.strokeStyle = beamGrad;
      fCtx.lineWidth = 5.5;
      fCtx.shadowColor = hexStr;
      fCtx.shadowBlur = 16;
      fCtx.beginPath();
      fCtx.moveTo(beamStart, midY);
      fCtx.lineTo(beamEnd, midY);
      fCtx.stroke();

      // 中心大光核
      const coreGrad = fCtx.createRadialGradient(centerX, midY, 0, centerX, midY, 28);
      coreGrad.addColorStop(0.0, rgba(1.0));
      coreGrad.addColorStop(0.25, rgba(0.85));
      coreGrad.addColorStop(0.60, rgba(0.25));
      coreGrad.addColorStop(1.0, rgba(0.0));

      fCtx.fillStyle = coreGrad;
      fCtx.beginPath();
      fCtx.arc(centerX, midY, 28, 0, Math.PI * 2);
      fCtx.fill();

      // 针尖高亮点
      fCtx.fillStyle = hexStr;
      fCtx.shadowColor = hexStr;
      fCtx.shadowBlur = 10;
      fCtx.beginPath();
      fCtx.arc(centerX, midY, 3.5, 0, Math.PI * 2);
      fCtx.fill();
    }

    this.flowTexture = new THREE.CanvasTexture(flowCanvas);
    this.flowTexture.wrapS = THREE.RepeatWrapping;
    this.flowTexture.wrapT = THREE.ClampToEdgeWrapping;

    const flowGeo = new THREE.CylinderGeometry(
      radius + 0.0005,
      radius + 0.0005,
      bandHeight,
      64,
      1,
      true
    );
    flowGeo.rotateY(Math.PI);

    this.flowMat = new THREE.MeshBasicMaterial({
      map: this.flowTexture,
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.flowMesh = new THREE.Mesh(flowGeo, this.flowMat);
    this.flowMesh.renderOrder = 21;
    this.group.add(this.flowMesh);

    this.group.rotation.set(0.18, 0, -0.12);
    this.group.visible = false;
  }

  public update(
    delta: number,
    basePos: THREE.Vector3,
    isModifierActive: boolean,
    isDragging: boolean,
    turnAngle = 0,
    dragDeltaX = 0
  ): void {
    this.pulseTime += delta * 2.5;
    const breathe = Math.sin(this.pulseTime) * 0.08;

    this.targetOpacity = isModifierActive || isDragging
      ? (isDragging ? 1.0 : 0.85 + breathe)
      : 0;

    const lerpSpeed = this.targetOpacity > 0 ? 14 : 18;
    this.currentOpacity = THREE.MathUtils.damp(this.currentOpacity, this.targetOpacity, lerpSpeed, delta);

    if (this.currentOpacity < 0.005) {
      this.group.visible = false;
      if (this.trackMat) this.trackMat.opacity = 0;
      if (this.flowMat) this.flowMat.opacity = 0;
      return;
    }

    this.group.visible = true;

    if (this.trackMat) {
      this.trackMat.opacity = this.currentOpacity * 0.85;
    }
    if (this.flowMat) {
      const flowActiveAlpha = isDragging ? 1.0 : 0.45;
      this.flowMat.opacity = this.currentOpacity * flowActiveAlpha;
    }

    // ─────────────────────────────────────────────────────────────
    // 关键对齐：光子在 360° 导轨上的位置严格对齐 bodyTurn 目标转向角 turnAngle
    // 转动角 2π 对应贴图圆周的一整圈（1.0），方向与转身操作一致
    // ─────────────────────────────────────────────────────────────
    const targetOffset = -(turnAngle / (Math.PI * 2));

    if (!this.isInitialized) {
      this.currentFlowOffset = targetOffset;
      this.isInitialized = true;
    }

    // 保持角度连续性（处理 2π 模跳变，确保光点始终沿最近圆周路径滑动）
    while (targetOffset - this.currentFlowOffset > 0.5) {
      this.currentFlowOffset += 1.0;
    }
    while (targetOffset - this.currentFlowOffset < -0.5) {
      this.currentFlowOffset -= 1.0;
    }

    const followSpeed = isDragging ? 26 : 14;
    this.currentFlowOffset = THREE.MathUtils.damp(
      this.currentFlowOffset,
      targetOffset,
      followSpeed,
      delta
    );

    if (this.flowTexture) {
      this.flowTexture.offset.x = this.currentFlowOffset;
    }

    this.group.position.set(
      basePos.x,
      basePos.y + 0.98,
      basePos.z
    );

    const defaultTiltZ = -0.12;
    if (isDragging && Math.abs(dragDeltaX) > 0.05) {
      const dynamicTiltZ = defaultTiltZ - Math.sign(dragDeltaX) * 0.04;
      this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, dynamicTiltZ, 12, delta);
    } else {
      this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, defaultTiltZ, 8, delta);
    }
  }

  public dispose(): void {
    if (this.trackMesh) this.trackMesh.geometry.dispose();
    if (this.trackMat) this.trackMat.dispose();

    if (this.flowMesh) this.flowMesh.geometry.dispose();
    if (this.flowMat) this.flowMat.dispose();
    if (this.flowTexture) this.flowTexture.dispose();
  }
}