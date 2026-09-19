import * as THREE from 'three';
import { APP_CONFIG } from '@/config';
import { INTERACTION_GUIDE_PHOTON } from '@/lib/constants';

/**
 * PitchGuide3D — 极简全息垂直弧形俯仰角导引轨（长弧线 + 镜头对齐修正版）
 * 
 * 优化点：
 * 1. 统一从 APP_CONFIG.interaction.guideColor 读取全息发光色（默认纯白 #ffffff）；
 * 2. 弧线显著加长：张角扩大至 ~122° (0.68 PI)，从大腿外侧向上优雅环抱至胸肩上方；
 * 3. 镜头方向校准：严格对齐 OrbitControls 极角物理映射，消除反向问题；
 * 4. 保持与 TurnGuide3D 一致的点阵发光与通透流光质感。
 */
export class PitchGuide3D {
    public readonly group = new THREE.Group();

    // 底层：长弧点阵导轨
    private trackMesh: THREE.Mesh | null = null;
    private trackMat: THREE.MeshBasicMaterial | null = null;

    // 顶层：沿弧线滑动的能量光子
    private flowMesh: THREE.Mesh | null = null;
    private flowMat: THREE.MeshBasicMaterial | null = null;
    private flowTexture: THREE.CanvasTexture | null = null;

    private currentOpacity = 0;
    private targetOpacity = 0;

    private pulseTime = 0;
    private currentFlowOffset = 0;

    constructor() {
        this.initGuide();
    }

    private initGuide(): void {
        // 空间弧度尺寸：半径 0.42m；轨带厚度走共用常量
        const radius = 0.42;
        const bandHeight = INTERACTION_GUIDE_PHOTON.thickness;

        const baseColor = new THREE.Color(APP_CONFIG.interaction?.guideColor ?? '#ffffff');
        const hexStr = `#${baseColor.getHexString()}`;
        const r = Math.round(baseColor.r * 255);
        const g = Math.round(baseColor.g * 255);
        const b = Math.round(baseColor.b * 255);
        const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

        // 显著加长纵向弧形张角（约 122 度）
        const arcAngle = Math.PI * 0.68;

        // ─────────────────────────────────────────────────────────────
        // 1. 底层：长弧全息微点轨 (1024 x 128)
        // ─────────────────────────────────────────────────────────────
        const trackCanvas = document.createElement('canvas');
        trackCanvas.width = 1024;
        trackCanvas.height = 128;
        const tCtx = trackCanvas.getContext('2d');

        if (tCtx) {
            const w = 1024;
            const h = 128;
            const midY = h / 2;

            tCtx.clearRect(0, 0, w, h);

            // 点阵沿长弧排列，两端平滑渐隐
            const dotSpacing = 24;
            const dotRadius = 2.4;
            tCtx.shadowColor = hexStr;
            tCtx.shadowBlur = 4;

            for (let x = 20; x < w - 20; x += dotSpacing) {
                const distFromCenter = Math.abs(x - w * 0.5) / (w * 0.5);
                // 两端余弦衰减消融
                const alpha = Math.max(0, Math.cos(distFromCenter * (Math.PI / 2))) * 0.45;

                tCtx.fillStyle = rgba(alpha);
                tCtx.beginPath();
                tCtx.arc(x, midY, dotRadius, 0, Math.PI * 2);
                tCtx.fill();
            }
        }

        const trackTexture = new THREE.CanvasTexture(trackCanvas);
        trackTexture.wrapS = THREE.ClampToEdgeWrapping;
        trackTexture.wrapT = THREE.ClampToEdgeWrapping;

        const trackGeo = new THREE.CylinderGeometry(
            radius,
            radius,
            bandHeight,
            48,
            1,
            true,
            -arcAngle / 2,
            arcAngle
        );

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
        // 2. 顶层：长弧能量流光光核
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

            // 宽幅彗尾
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

            // 中心大光核（与 Turn 对齐）
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
        this.flowTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.flowTexture.wrapT = THREE.ClampToEdgeWrapping;

        const flowGeo = new THREE.CylinderGeometry(
            radius + 0.001,
            radius + 0.001,
            bandHeight,
            48,
            1,
            true,
            -arcAngle / 2,
            arcAngle
        );

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

        // 旋转让圆弧立起并置于右侧
        this.group.rotation.set(0, 0, Math.PI / 2);
        this.group.visible = false;
    }

    /**
     * 逐帧更新
     * @param delta 帧间隔
     * @param basePos 角色脚底世界坐标
     * @param isModifierActive 是否激活
     * @param isDragging 是否拖拽中
     * @param pitchProgress 相机俯仰进度（-1 到 1，0 为平视，正值仰视，负值俯视）
     * @param dragDeltaY 鼠标纵向移动差值
     */
    public update(
        delta: number,
        basePos: THREE.Vector3,
        isModifierActive: boolean,
        isDragging: boolean,
        pitchProgress = 0,
        _dragDeltaY = 0
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
            const flowActiveAlpha = isDragging ? 1.0 : 0.55;
            this.flowMat.opacity = this.currentOpacity * flowActiveAlpha;
        }

        // ─────────────────────────────────────────────────────────────
        // 关键对齐：光子在弧线上的位置严格对齐 pitchProgress
        // 向上滑动光子往上走，向下滑动光子往下走
        // ─────────────────────────────────────────────────────────────
        const targetOffset = THREE.MathUtils.clamp(-pitchProgress * 0.38, -0.42, 0.42);

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

        // 锚定在角色右侧外侧空间 (X 偏右约 0.30m, Y 约 0.98m)
        this.group.position.set(
            basePos.x + 0.30,
            basePos.y + 0.98,
            basePos.z
        );

        // 姿态：向左微倾，面向镜头右前侧
        this.group.rotation.set(0, +0.06, Math.PI / 2);
    }

    public dispose(): void {
        if (this.trackMesh) this.trackMesh.geometry.dispose();
        if (this.trackMat) this.trackMat.dispose();

        if (this.flowMesh) this.flowMesh.geometry.dispose();
        if (this.flowMat) this.flowMat.dispose();
        if (this.flowTexture) this.flowTexture.dispose();
    }
}