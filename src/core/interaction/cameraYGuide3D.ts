import * as THREE from 'three';
import { APP_CONFIG } from '@/config';

/**
 * CameraYGuide3D — 极简全息垂直高度尺 + 相机 Y 位置导引轨
 *
 * 核心特性：
 * 1. 角色水平跟随定位：guide 贴在 basePos 旁 (横向偏移走 APP_CONFIG.interaction.cameraYGuide.xOffset),
 *    角色转身 / 走位时跟着一起动, 不再视口锁死;
 * 2. 视觉语言 1:1 对齐: 高密全息点阵 (步长 14px)、凝聚聚焦光子与纯白全息微缩相机图标;
 * 3. 支持 Hover 1.25x 弹性缩放阻尼反馈。
 */
export class CameraYGuide3D {
    public readonly group = new THREE.Group();

    // 底层：高密全息微点轨
    private trackMesh: THREE.Mesh | null = null;
    private trackMat: THREE.MeshBasicMaterial | null = null;
    private trackTexture: THREE.CanvasTexture | null = null;

    // 顶层：纤细聚焦光子
    private photonMesh: THREE.Mesh | null = null;
    private photonMat: THREE.MeshBasicMaterial | null = null;
    private photonTexture: THREE.CanvasTexture | null = null;

    // 辅助层：微缩相机 Sprite
    private cameraSprite: THREE.Sprite | null = null;

    private currentOpacity = 0;
    private targetOpacity = 0;
    private currentPhotonOffset = 0;
    private pulseTime = 0;

    // 悬停缩放状态
    private isHovered = false;
    private hoverScale = 1.0;

    // 物理高度范围 (-0.8m ~ +2.8m, 覆盖 3.6m)
    private readonly heightRange = 3.6;
    private readonly heightMin = -0.8;

    // 基础尺寸
    private readonly basePhotonWidth = 0.05;
    private readonly basePhotonHeight = 0.18;
    private readonly baseCameraScale = 0.10;

    constructor() {
        this.initGuide();
    }

    private initGuide(): void {
        const trackWidth = 0.032;
        const trackHeight = this.heightRange;

        const baseColor = new THREE.Color(APP_CONFIG.interaction?.guideColor ?? '#ffffff');
        const hexStr = `#${baseColor.getHexString()}`;
        const r = Math.round(baseColor.r * 255);
        const g = Math.round(baseColor.g * 255);
        const b = Math.round(baseColor.b * 255);
        const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

        // ─────────────────────────────────────────────────────────────
        // 1. 底层：纵向高密微点轨 (步长 14px，圆点均匀高密排列)
        // ─────────────────────────────────────────────────────────────
        const trackCanvas = document.createElement('canvas');
        trackCanvas.width = 64;
        trackCanvas.height = 2048;
        const tCtx = trackCanvas.getContext('2d');

        if (tCtx) {
            const w = 64;
            const h = 2048;
            const midX = w / 2;

            tCtx.clearRect(0, 0, w, h);

            const dotSpacing = 14;
            const dotRadius = 1.5;
            tCtx.shadowColor = hexStr;
            tCtx.shadowBlur = 3;

            for (let y = 20; y < h - 20; y += dotSpacing) {
                const distFromCenter = Math.abs(y - h * 0.5) / (h * 0.5);
                const alpha = Math.max(0, Math.cos(distFromCenter * (Math.PI / 2))) * 0.42;

                tCtx.fillStyle = rgba(alpha);
                tCtx.beginPath();
                tCtx.arc(midX, y, dotRadius, 0, Math.PI * 2);
                tCtx.fill();
            }
        }

        this.trackTexture = new THREE.CanvasTexture(trackCanvas);
        this.trackTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.trackTexture.wrapT = THREE.ClampToEdgeWrapping;

        const trackGeo = new THREE.PlaneGeometry(trackWidth, trackHeight);
        this.trackMat = new THREE.MeshBasicMaterial({
            map: this.trackTexture,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        this.trackMesh = new THREE.Mesh(trackGeo, this.trackMat);
        this.trackMesh.renderOrder = 20;
        this.trackMesh.frustumCulled = false; // 严防贴脸时被近裁剪面剔除
        this.group.add(this.trackMesh);

        // ─────────────────────────────────────────────────────────────
        // 2. 顶层：纤细聚焦流光光子
        // ─────────────────────────────────────────────────────────────
        const photonCanvas = document.createElement('canvas');
        photonCanvas.width = 128;
        photonCanvas.height = 256;
        const pCtx = photonCanvas.getContext('2d');

        if (pCtx) {
            const w = 128;
            const h = 256;
            const midX = w / 2;
            const midY = h / 2;

            pCtx.clearRect(0, 0, w, h);

            const beamGrad = pCtx.createLinearGradient(0, midY - 60, 0, midY + 60);
            beamGrad.addColorStop(0.00, rgba(0.0));
            beamGrad.addColorStop(0.30, rgba(0.35));
            beamGrad.addColorStop(0.50, rgba(1.0));
            beamGrad.addColorStop(0.70, rgba(0.35));
            beamGrad.addColorStop(1.00, rgba(0.0));

            pCtx.strokeStyle = beamGrad;
            pCtx.lineWidth = 4;
            pCtx.shadowColor = hexStr;
            pCtx.shadowBlur = 10;
            pCtx.beginPath();
            pCtx.moveTo(midX, midY - 60);
            pCtx.lineTo(midX, midY + 60);
            pCtx.stroke();

            const coreGrad = pCtx.createRadialGradient(midX, midY, 0, midX, midY, 12);
            coreGrad.addColorStop(0.0, rgba(1.0));
            coreGrad.addColorStop(0.4, rgba(0.85));
            coreGrad.addColorStop(1.0, rgba(0.0));
            pCtx.fillStyle = coreGrad;
            pCtx.beginPath();
            pCtx.arc(midX, midY, 12, 0, Math.PI * 2);
            pCtx.fill();

            pCtx.fillStyle = hexStr;
            pCtx.beginPath();
            pCtx.arc(midX, midY, 2.2, 0, Math.PI * 2);
            pCtx.fill();
        }

        this.photonTexture = new THREE.CanvasTexture(photonCanvas);
        this.photonTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.photonTexture.wrapT = THREE.ClampToEdgeWrapping;

        const photonGeo = new THREE.PlaneGeometry(this.basePhotonWidth, this.basePhotonHeight);
        this.photonMat = new THREE.MeshBasicMaterial({
            map: this.photonTexture,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        });
        this.photonMesh = new THREE.Mesh(photonGeo, this.photonMat);
        this.photonMesh.renderOrder = 21;
        this.photonMesh.frustumCulled = false;
        this.group.add(this.photonMesh);

        // ─────────────────────────────────────────────────────────────
        // 3. 辅助层：微缩相机 Sprite
        // ─────────────────────────────────────────────────────────────
        this.cameraSprite = this.makeMinimalCameraSprite();
        this.group.add(this.cameraSprite);

        this.group.visible = false;
    }

    public setHovered(hovered: boolean): void {
        this.isHovered = hovered;
    }

    public update(
        delta: number,
        basePos: THREE.Vector3,
        isModifierActive: boolean,
        isDragging: boolean,
        yProgress = 0,
        _dragDeltaY = 0,
        camera?: THREE.Camera,
    ): void {
        this.pulseTime += delta * 2.5;
        const breathe = Math.sin(this.pulseTime) * 0.08;

        this.targetOpacity = isModifierActive || isDragging
            ? (isDragging ? 1.0 : 0.85 + breathe)
            : 0;

        const lerpSpeed = this.targetOpacity > 0 ? 14 : 18;
        this.currentOpacity = THREE.MathUtils.damp(
            this.currentOpacity,
            this.targetOpacity,
            lerpSpeed,
            delta,
        );

        if (this.currentOpacity < 0.005) {
            this.group.visible = false;
            if (this.trackMat) this.trackMat.opacity = 0;
            if (this.photonMat) this.photonMat.opacity = 0;
            if (this.cameraSprite) this.cameraSprite.material.opacity = 0;
            return;
        }

        this.group.visible = true;

        // 悬停缩放弹性平滑过渡
        const targetScale = (this.isHovered || isDragging) ? 1.25 : 1.0;
        this.hoverScale = THREE.MathUtils.damp(this.hoverScale, targetScale, 16, delta);

        if (this.trackMat) {
            this.trackMat.opacity = this.currentOpacity * 0.85;
        }
        if (this.photonMat) {
            const activeAlpha = isDragging || this.isHovered ? 1.0 : 0.55;
            this.photonMat.opacity = this.currentOpacity * activeAlpha;
        }
        if (this.cameraSprite) {
            const iconAlpha = this.isHovered || isDragging ? 1.0 : 0.85;
            this.cameraSprite.material.opacity = this.currentOpacity * iconAlpha;
        }

        // Y 轴高度位置映射
        const t = THREE.MathUtils.clamp((yProgress + 1) / 2, 0, 1);
        const worldTargetY = this.heightMin + t * this.heightRange;
        const targetLocalY = worldTargetY - (this.heightMin + this.heightRange * 0.5);

        const followSpeed = isDragging ? 26 : 14;
        this.currentPhotonOffset = THREE.MathUtils.damp(
            this.currentPhotonOffset,
            targetLocalY,
            followSpeed,
            delta,
        );

        // 标尺几何中心高度（固定以角色的脚底为世界基准）
        const trackCenterY = basePos.y + this.heightMin + this.heightRange * 0.5;

        // ponytail: 简单的角色跟随定位 — guide 贴在角色 basePos 旁边,
        // 横向偏移走 APP_CONFIG.interaction.cameraYGuide.xOffset, 不再视口锁定。
        this.group.position.set(
            basePos.x + APP_CONFIG.interaction.cameraYGuide.xOffset,
            trackCenterY,
            basePos.z,
        );
        this.group.rotation.set(0, 0, 0);
        void camera; // ponytail: 视口锁逻辑不再需要, 参数保留兼容

        // 1. 光子跟随与缩放
        if (this.photonMesh) {
            this.photonMesh.position.set(0, this.currentPhotonOffset, 0.002);
            this.photonMesh.scale.set(this.hoverScale, this.hoverScale, 1);
        }

        // 2. 相机微标跟随与缩放 (Gap 随 hover 弹性外展)
        if (this.cameraSprite) {
            // ponytail: sprite 现在 0.10 宽 + glow 半径 ~0.05, gapX=-0.07 让 icon 跟 photon 留一点缝 (从 photon 中心向左偏半个 icon)
            const gapX = -0.07 * Math.min(1.15, this.hoverScale);
            this.cameraSprite.position.set(gapX, this.currentPhotonOffset, 0.005);
            const curCamScale = this.baseCameraScale * this.hoverScale;
            this.cameraSprite.scale.set(curCamScale, curCamScale, 1);
        }
    }

    private makeMinimalCameraSprite(): THREE.Sprite {
        const baseColor = new THREE.Color(APP_CONFIG.interaction?.guideColor ?? '#ffffff');
        const hexStr = `#${baseColor.getHexString()}`;

        // ponytail: 256×256 高分辨率画布 + 强光晕让笔触外溢, 配合 AdditiveBlending 出"自发光"质感
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, 256, 256);

        // 笔触参数 — 加粗 + 强光晕外溢
        ctx.strokeStyle = hexStr;
        ctx.fillStyle = hexStr;
        ctx.lineWidth = 5;
        ctx.shadowColor = hexStr;
        ctx.shadowBlur = 18;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 取景器凸起 (顶小盒)
        ctx.beginPath();
        ctx.roundRect(96, 60, 64, 20, [4, 4, 0, 0]);
        ctx.stroke();

        // 相机机身 (大圆角矩形)
        ctx.beginPath();
        ctx.roundRect(52, 80, 152, 108, 14);
        ctx.stroke();

        // 镜头 (外圈圆)
        ctx.beginPath();
        ctx.arc(128, 134, 32, 0, Math.PI * 2);
        ctx.stroke();

        // 镜头中心实心点
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(128, 134, 9, 0, Math.PI * 2);
        ctx.fill();

        // 拖动箭头 ↕ 提示 (底部小字)
        ctx.shadowBlur = 14;
        ctx.font = 'bold 32px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('↕', 128, 224);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;

        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            opacity: 0,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            color: baseColor.getHex(),
        });

        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(this.baseCameraScale, this.baseCameraScale, 1);
        sprite.renderOrder = 22;
        return sprite;
    }

    public getPickables(): THREE.Object3D[] {
        const arr: THREE.Object3D[] = [];
        if (this.photonMesh) arr.push(this.photonMesh);
        if (this.cameraSprite) arr.push(this.cameraSprite);
        if (this.trackMesh) arr.push(this.trackMesh);
        return arr;
    }

    public worldYToProgress(worldY: number): number {
        const t = (worldY - this.heightMin) / this.heightRange;
        return Math.min(1, Math.max(-1, t * 2 - 1));
    }

    public dispose(): void {
        if (this.trackMesh) this.trackMesh.geometry.dispose();
        if (this.trackMat) this.trackMat.dispose();
        if (this.trackTexture) this.trackTexture.dispose();

        if (this.photonMesh) this.photonMesh.geometry.dispose();
        if (this.photonMat) this.photonMat.dispose();
        if (this.photonTexture) this.photonTexture.dispose();

        if (this.cameraSprite) {
            this.cameraSprite.material.map?.dispose();
            this.cameraSprite.material.dispose();
        }
    }
}