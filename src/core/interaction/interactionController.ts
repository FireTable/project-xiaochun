/**
 * InteractionController — 核心交互控制器插件
 *
 * 统一管 3 个 3D 引导轨:
 * - TurnGuide3D (腰间转身光环, 跟角色 targetYawOffset)
 * - PitchGuide3D (右侧俯仰弧, 跟 OrbitControls)
 * - CameraYGuide3D (左侧相机 Y 高度尺 + 拖拽柄, 跟 controls.target.y + cameraYOffset)
 *
 * 共享一个 isModifierActive 状态, 同步触发显隐, 不再有 React state 滞后问题
 * (之前 App.tsx 用 useState 走 cameraYGuide 会出现快按时漏掉的情况)。
 */

import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MotionPipeline } from '@/motion/pipeline/motionPipeline';
import { APP_CONFIG } from '@/config';
import { isTauri, startWindowDragging, hasInteractionModifier, isMacOS } from '@/lib/platform';
import type { Scene, Vector3, Camera, PerspectiveCamera } from 'three';
import * as THREE from 'three';
import { sceneManager } from '@/core/scene/sceneManager';
import { passthroughManager } from '@/core/scene/passthroughManager';
import { TurnGuide3D } from './turnGuide3D';
import { PitchGuide3D } from './pitchGuide3D';
import { CameraYGuide3D } from './cameraYGuide3D';

export interface InteractionState {
  isModifierActive: boolean;
  isDragging: boolean;
  dragDelta: { x: number; y: number };
  anchorScreenPos: { x: number; y: number } | null;
}

export interface InteractionContext {
  scene: Scene;
  controls: OrbitControls | null;
  camera: PerspectiveCamera;
  motionPipeline: MotionPipeline;
  onSaveBodyYaw: () => void;
  onSaveCameraPitch: () => void;
  /** ponytail: 拖拽 cameraYGuide 时调, 写入新 Y offset (-1 ~ +1) */
  onSetCameraYOffset: (offset: number) => void;
}

export class InteractionController {
  private canvas: HTMLCanvasElement | null = null;
  private context: InteractionContext | null = null;

  // 3D 空间导引
  private turnGuide3D = new TurnGuide3D();
  private pitchGuide3D = new PitchGuide3D();
  private cameraYGuide3D = new CameraYGuide3D();

  // 内部状态
  private isModifierActive = false;
  private isLeftDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private activePointerId: number | null = null;
  private lastDragDx = 0;
  private lastDragDy = 0;

  // cameraYGuide 拖拽状态
  private isYGuideDragging = false;
  private yGuideLastClientY = 0;
  private yGuideRaycaster = new THREE.Raycaster();
  private yGuideNdc = new THREE.Vector2();
  private yGuideHovered = false;
  // ponytail: 当前 cameraYOffset, 由 update() 每帧从 vrmEngine 同步过来, 用于
  // 拖拽时计算 next = current + deltaY 走 vrmEngine.onSetCameraYOffset 写入。
  private _currentCameraYOffset = 0;

  private stateListeners = new Set<(state: InteractionState) => void>();

  constructor() {
    this.setupGlobalKeyListeners();
  }

  public onStateChange(cb: (state: InteractionState) => void): () => void {
    cb(this.getState());
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  public getState(): InteractionState {
    return {
      isModifierActive: this.isModifierActive,
      isDragging: this.isLeftDragging,
      dragDelta: { x: 0, y: 0 },
      anchorScreenPos: null,
    };
  }

  private notifyStateChange(deltaX = 0, deltaY = 0): void {
    const state: InteractionState = {
      isModifierActive: this.isModifierActive,
      isDragging: this.isLeftDragging,
      dragDelta: { x: deltaX, y: deltaY },
      anchorScreenPos: null,
    };
    this.stateListeners.forEach((cb) => {
      try { cb(state); } catch { }
    });
  }

  public bindCanvas(canvas: HTMLCanvasElement, context: InteractionContext): void {
    this.unbindCanvas();
    this.canvas = canvas;
    this.context = context;

    this.context.scene.add(this.turnGuide3D.group);
    this.context.scene.add(this.pitchGuide3D.group);
    this.context.scene.add(this.cameraYGuide3D.group);

    this.setupCanvasPointerListeners(canvas);
    this.updateCursor();
  }

  public unbindCanvas(): void {
    if (this.cleanupCanvasListeners) {
      this.cleanupCanvasListeners();
      this.cleanupCanvasListeners = null;
    }
    if (this.context) {
      this.context.scene.remove(this.turnGuide3D.group);
      this.context.scene.remove(this.pitchGuide3D.group);
      this.context.scene.remove(this.cameraYGuide3D.group);
    }
    this.endDrag();
    this.endYGuideDrag();
    this.canvas = null;
    this.context = null;
  }

  /**
   * 随渲染主循环逐帧更新
   * @param cameraYOffset 当前累积的相机 Y 偏移 (-1 ~ +1), 用于 cameraYGuide3D yProgress 计算
   */
  public update(
    delta: number,
    vrmBasePos: Vector3,
    cameraYOffset: number,
    _camera?: Camera,
  ): void {
    // 1. 腰间转身光环
    const turnAngle = this.context?.motionPipeline.targetYawOffset ?? 0;
    this.turnGuide3D.update(
      delta,
      vrmBasePos,
      this.isModifierActive,
      this.isLeftDragging,
      turnAngle,
      this.lastDragDx,
    );

    // 2. 右侧俯仰弧
    let pitchProgress = 0;
    if (this.context?.controls) {
      const polar = this.context.controls.getPolarAngle();
      const deltaFromCenter = -(polar - Math.PI * 0.5);
      pitchProgress = THREE.MathUtils.clamp(deltaFromCenter / (Math.PI * 0.28), -1, 1);
    }
    this.pitchGuide3D.update(
      delta,
      vrmBasePos,
      this.isModifierActive,
      this.isLeftDragging,
      pitchProgress,
      this.lastDragDy,
    );

    // 3. 相机 Y 高度尺 (光子位置 = 攻 basePos 的世界 Y, 加 _cameraYOffsetAccum)
    this._currentCameraYOffset = cameraYOffset;
    const yWorld = (this.context?.controls?.target.y ?? 0) + cameraYOffset;
    const yProgress = this.cameraYGuide3D.worldYToProgress(yWorld - vrmBasePos.y);
    this.cameraYGuide3D.update(
      delta,
      vrmBasePos,
      this.isModifierActive,
      this.isYGuideDragging,
      yProgress,
      0,
      _camera,
    );
    this.cameraYGuide3D.setHovered(this.yGuideHovered || this.isYGuideDragging);

    // 阻尼衰减
    this.lastDragDx = THREE.MathUtils.damp(this.lastDragDx, 0, 10, delta);
    this.lastDragDy = THREE.MathUtils.damp(this.lastDragDy, 0, 10, delta);
  }

  private cleanupCanvasListeners: (() => void) | null = null;
  private cleanupGlobalListeners: (() => void) | null = null;

  private setupGlobalKeyListeners(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = hasInteractionModifier(e);
      if (active && !this.isModifierActive) {
        this.isModifierActive = true;
        this.updateCursor();
        this.notifyStateChange();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const isMac = isMacOS();
      const stillActive = isMac ? e.metaKey : e.ctrlKey;
      if (!stillActive && this.isModifierActive) {
        this.isModifierActive = false;
        if (this.isLeftDragging) {
          this.endDrag();
        }
        if (this.isYGuideDragging) {
          this.endYGuideDrag();
        }
        this.updateCursor();
        this.notifyStateChange();
      }
    };

    const onWindowBlur = () => {
      if (this.isModifierActive || this.isLeftDragging || this.isYGuideDragging) {
        this.isModifierActive = false;
        this.endDrag();
        this.endYGuideDrag();
        this.updateCursor();
        this.notifyStateChange();
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onWindowBlur);

    this.cleanupGlobalListeners = () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onWindowBlur);
    };
  }

  private updateCursor(): void {
    if (!this.canvas) return;
    if (this.isLeftDragging || this.isYGuideDragging) {
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (this.isModifierActive) {
      this.canvas.style.cursor = 'grab';
      return;
    }
    this.canvas.style.cursor = '';
  }

  /**
   * ponytail: 用当前 pointer 位置 raycast cameraYGuide3D 的 pickable 子节点
   * (光子 + camera icon + dot 列)。命中即视为拖拽准备或 hover。
   */
  private raycastYGuide(clientX: number, clientY: number): boolean {
    if (!this.canvas || !this.context) return false;
    const rect = this.canvas.getBoundingClientRect();
    this.yGuideNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.yGuideRaycaster.setFromCamera(this.yGuideNdc, this.context.camera);
    const hits = this.yGuideRaycaster.intersectObjects(this.cameraYGuide3D.getPickables(), false);
    return hits.length > 0;
  }

  /** ponytail: 屏幕 dy 像素转世界 Y 米, 用 cameraYGuide 中心到相机距离 + fov 换算 */
  private screenDeltaToWorld(dy: number): number {
    if (!this.context || !this.cameraYGuide3D.group.visible) return 0;
    const photonWorld = new THREE.Vector3();
    this.cameraYGuide3D.group.getWorldPosition(photonWorld);
    const distance = this.context.camera.position.distanceTo(photonWorld);
    const viewportH = this.canvas?.clientHeight || window.innerHeight || 1;
    const worldPerPixel =
      (2 * distance * Math.tan((this.context.camera.fov * Math.PI) / 360)) / viewportH;
    return -dy * worldPerPixel;
  }

  private startYGuideDrag(e: PointerEvent): void {
    this.isYGuideDragging = true;
    this.yGuideLastClientY = e.clientY;
    try {
      this.canvas?.setPointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
    this.updateCursor();
  }

  private endYGuideDrag(): void {
    if (!this.isYGuideDragging) return;
    this.isYGuideDragging = false;
    this.yGuideHovered = false;
    this.updateCursor();
  }

  private setupCanvasPointerListeners(canvas: HTMLCanvasElement): void {
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;

      const hasMod = hasInteractionModifier(e);

      // ponytail: cameraYGuide 拖拽优先 — 点中光子板 / icon / dot 列就吃事件,
      // 不走 turnGuide / pitchGuide 的横向转身路径 (modifier + click 已被 cameraYGuide 占)。
      if (hasMod && this.raycastYGuide(e.clientX, e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        this.isModifierActive = true;
        this.startYGuideDrag(e);
        return;
      }

      if (!hasMod) {
        if (isTauri()) {
          const currentScene = sceneManager.getCurrentScene();
          if (currentScene?.isTransparent) {
            void passthroughManager.setInteracting(true);
            const onEndDrag = () => {
              window.removeEventListener('pointerup', onEndDrag);
              window.removeEventListener('mouseup', onEndDrag);
              void passthroughManager.setInteracting(false);
            };
            window.addEventListener('pointerup', onEndDrag);
            window.addEventListener('mouseup', onEndDrag);
          }
          void startWindowDragging(e);
        }
        return;
      }

      e.preventDefault();
      this.isModifierActive = true;
      this.isLeftDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.lastDragDx = 0;
      this.lastDragDy = 0;
      this.activePointerId = e.pointerId;

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch { }

      this.updateCursor();
      this.notifyStateChange();
    };

    const onPointerMove = (e: PointerEvent) => {
      // cameraYGuide 拖拽中 — 持续改 cameraYOffset
      if (this.isYGuideDragging) {
        e.preventDefault();
        const dy = e.clientY - this.yGuideLastClientY;
        this.yGuideLastClientY = e.clientY;
        const deltaY = this.screenDeltaToWorld(dy);
        if (this.context && Math.abs(deltaY) > 0) {
          const newOffset = THREE.MathUtils.clamp(this._currentCameraYOffset + deltaY, -1, 1);
          this.context.onSetCameraYOffset(newOffset);
        }
        return;
      }

      // hover 检测 — 始终 raycast cameraYGuide pickable
      if (this.isModifierActive && !this.isLeftDragging) {
        this.yGuideHovered = this.raycastYGuide(e.clientX, e.clientY);
        this.updateCursor();
      }

      if (!this.isLeftDragging) {
        const hasMod = hasInteractionModifier(e);
        if (hasMod !== this.isModifierActive) {
          this.isModifierActive = hasMod;
          this.updateCursor();
          this.notifyStateChange();
        }
        return;
      }

      const hasMod = hasInteractionModifier(e);
      if (!hasMod) {
        this.isModifierActive = false;
        this.endDrag();
        this.updateCursor();
        this.notifyStateChange();
        return;
      }

      e.preventDefault();
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      this.lastDragDx = dx;
      this.lastDragDy = dy;

      if (this.context) {
        const sensitivityX = APP_CONFIG.interaction.characterTurnSensitivityX;
        this.context.motionPipeline.targetYawOffset += dx * sensitivityX;

        if (this.context.controls) {
          const sensitivityY = APP_CONFIG.camera.pitchSensitivityY;
          (this.context.controls as any)._rotateUp(dy * sensitivityY);
        }
      }

      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.notifyStateChange(dx, dy);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (this.isYGuideDragging) {
        this.endYGuideDrag();
        this.notifyStateChange();
        return;
      }
      this.endDrag();
      this.updateCursor();
      this.notifyStateChange();
    };

    const onPointerCancel = () => {
      this.endDrag();
      this.endYGuideDrag();
      this.updateCursor();
      this.notifyStateChange();
    };

    const onContextMenu = (e: MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('contextmenu', onContextMenu);

    this.cleanupCanvasListeners = () => {
      this.endDrag();
      this.endYGuideDrag();
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }

  private endDrag(): void {
    if (!this.isLeftDragging) return;
    this.isLeftDragging = false;
    this.lastDragDx = 0;
    this.lastDragDy = 0;

    if (this.activePointerId !== null && this.canvas) {
      try {
        if (this.canvas.hasPointerCapture(this.activePointerId)) {
          this.canvas.releasePointerCapture(this.activePointerId);
        }
      } catch { }
      this.activePointerId = null;
    }

    const currentScene = sceneManager.getCurrentScene();
    if (currentScene?.isTransparent) {
      void passthroughManager.setInteracting(false);
    }

    if (this.context) {
      this.context.onSaveBodyYaw();
      this.context.onSaveCameraPitch();
    }
  }

  public dispose(): void {
    this.unbindCanvas();
    this.turnGuide3D.dispose();
    this.pitchGuide3D.dispose();
    this.cameraYGuide3D.dispose();

    if (this.cleanupGlobalListeners) {
      this.cleanupGlobalListeners();
      this.cleanupGlobalListeners = null;
    }
    this.stateListeners.clear();
  }
}