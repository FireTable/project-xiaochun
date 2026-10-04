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
 *
 * 全端统一：
 * - 无修饰键长按 → 进入调整模式（导轨显示）→ 再拖转身/俯仰，或点左侧 Y 尺；
 *   空闲 INTERACTION_GUIDE_AUTO_HIDE_MS 后自动消失。
 * - Cmd/Ctrl 仍可即时进入 3D（桌面快捷路径）。
 * - Tauri：长按前若提前滑动，取消武装并走裸左键拖窗（桌宠拖窗保留）。
 *
 * 分层 (阶段 2 重构, 行为不变):
 *   手势识别 (10px 阈值 / 480ms 长按 / 多点触控 / 修饰键 / 自动收起) → src/core/gesture/GestureMachine (纯 TS, 宿主无关);
 *   Tauri 原生拖窗 → src/core/gesture/adapters/tauriWindow.ts;
 *   本类只负责: DOM 事件 → PointerSample、消费语义事件、3D 导轨 / 角色转身 / 相机俯仰 / 光标 / 穿透同步。
 */

import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MotionPipeline } from '@/motion/pipeline/motionPipeline';
import { APP_CONFIG } from '@/config';
import {
  INTERACTION_GUIDE_AUTO_HIDE_MS,
  INTERACTION_TOUCH_ARM_MS,
  INTERACTION_TOUCH_ARM_SLOP_PX,
} from '@/lib/constants';
import { isTauri, hasInteractionModifier, isMacOS } from '@/lib/platform';
import type { Scene, Vector3, Camera, PerspectiveCamera } from 'three';
import * as THREE from 'three';
import { sceneManager } from '@/core/scene/sceneManager';
import { passthroughManager } from '@/core/scene/passthroughManager';
import { TurnGuide3D } from './turnGuide3D';
import { PitchGuide3D } from './pitchGuide3D';
import { CameraYGuide3D } from './cameraYGuide3D';
import { GestureMachine, type GestureEvent, type GestureResponse } from '@/core/gesture';
import { fillPointerSample, newPointerSample } from '@/core/gesture/adapters/domSample';
import { startNativeWindowDrag } from '@/core/gesture/adapters/tauriWindow';

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

  // 手势状态机 (纯逻辑, 状态全部在它里面; 这里只留 3D 表现相关的量)
  private machine = new GestureMachine(
    {
      armMs: INTERACTION_TOUCH_ARM_MS,
      slopPx: INTERACTION_TOUCH_ARM_SLOP_PX,
      hideMs: INTERACTION_GUIDE_AUTO_HIDE_MS,
      // Tauri: 超过 10px 交给原生拖窗 (startDragging); /embed 且宿主开了 draggable (setMoveSink): 'delta' (逻辑层出增量, 由宿主 SDK 移动 iframe);
      // 其余 (普通浏览器 / embed 宿主没开): 仅取消长按, 把滑动还给页面
      moveStrategy: () => (this.moveSink ? 'delta' : isTauri() ? 'native' : 'none'),
    },
    { isGuideHit: (x, y) => this.raycastYGuide(x, y) },
  );
  private lastDragDx = 0;
  private lastDragDy = 0;
  /** /embed 的移动手势出口 (null = 没开): 非 null 时 GestureMachine 用 'delta' 策略, move-start / move-delta / move-end 转交给它。 */
  private moveSink: ((ev: GestureEvent) => void) | null = null;
  /** 正在 delta 移动的指针 (已 setPointerCapture 到 canvas, 移出 iframe 也持续收到事件; 松手 / 取消时释放)。 */
  private moveCapturedPointer: number | null = null;
  /** 复用的指针样本, 避免高频 pointermove 里每次分配 (GestureMachine 不保留引用)。 */
  private sample = newPointerSample();

  // cameraYGuide 世界坐标换算
  private yGuideRaycaster = new THREE.Raycaster();
  private yGuideNdc = new THREE.Vector2();
  // ponytail: 当前 cameraYOffset, 由 update() 每帧从 vrmEngine 同步过来, 用于
  // 拖拽时计算 next = current + deltaY 走 vrmEngine.onSetCameraYOffset 写入。
  private _currentCameraYOffset = 0;

  private stateListeners = new Set<(state: InteractionState) => void>();

  constructor() {
    this.machine.on(this.onGestureEvent);
    this.setupGlobalKeyListeners();
  }

  /**
   * /embed: 开 / 关"拖动 iframe"手势。sink 收到 move-start / move-delta / move-end (delta 为屏幕坐标差, iframe 自己被移动时仍稳定)。
   * 传 null = 关: 回到 'none' (超过阈值只取消长按, 不拦截任何事件)。进行中的拖动不会被打断, 下一次按下才生效。
   */
  public setMoveSink(sink: ((ev: GestureEvent) => void) | null): void {
    this.moveSink = sink;
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
      isModifierActive: this.machine.modifierActive,
      isDragging: this.machine.dragging,
      dragDelta: { x: 0, y: 0 },
      anchorScreenPos: null,
    };
  }

  private notifyStateChange(deltaX = 0, deltaY = 0): void {
    this.syncGuidePassthrough();
    const state: InteractionState = {
      isModifierActive: this.machine.modifierActive,
      isDragging: this.machine.dragging,
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
    this.machine.clearArm({ hideGuides: true });
    if (this.cleanupCanvasListeners) {
      this.cleanupCanvasListeners();
      this.cleanupCanvasListeners = null;
    }
    if (this.context) {
      this.context.scene.remove(this.turnGuide3D.group);
      this.context.scene.remove(this.pitchGuide3D.group);
      this.context.scene.remove(this.cameraYGuide3D.group);
    }
    this.machine.endTurn();
    this.machine.endGuideDrag();
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
      this.machine.modifierActive,
      this.machine.dragging,
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
      this.machine.modifierActive,
      this.machine.dragging,
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
      this.machine.modifierActive,
      this.machine.guideDragging,
      yProgress,
      0,
      _camera,
    );
    this.cameraYGuide3D.setHovered(this.machine.guideHovered || this.machine.guideDragging);

    // 阻尼衰减
    this.lastDragDx = THREE.MathUtils.damp(this.lastDragDx, 0, 10, delta);
    this.lastDragDy = THREE.MathUtils.damp(this.lastDragDy, 0, 10, delta);
  }

  private cleanupCanvasListeners: (() => void) | null = null;
  private cleanupGlobalListeners: (() => void) | null = null;

  /**
   * 导轨可见 / 拖拽中：强制关闭原生穿透。
   * 否则 CameraY 等细线导轨 alpha 低于 bitmask 阈值，hover(raycast) 成功但按下被当成穿透。
   */
  private syncGuidePassthrough(): void {
    void passthroughManager.setInteracting(this.machine.capturing);
  }

  /** 消费 GestureMachine 的语义事件: 3D 表现 / 光标 / 穿透 / 指针捕获 / Tauri 原生拖窗。 */
  private onGestureEvent = (ev: GestureEvent): void => {
    switch (ev.type) {
      case 'move-start':
        // 必须同步调用: 本回调处于 GestureMachine.pointerMove 的同步栈里, 即 pointermove 事件处理中
        if (ev.strategy === 'native') startNativeWindowDrag();
        else if (ev.strategy === 'delta') {
          // 抓住指针: iframe 被宿主移动、指针跑出 iframe 之外时仍持续收到 pointermove / pointerup
          const canvas = this.canvas;
          if (canvas) {
            try { canvas.setPointerCapture?.(ev.pointerId); this.moveCapturedPointer = ev.pointerId; } catch { /* ignore */ }
            canvas.style.cursor = 'grabbing';
          }
          this.moveSink?.(ev);
        }
        break;
      case 'move-delta':
        this.moveSink?.(ev);
        break;
      case 'move-end': {
        const canvas = this.canvas;
        if (canvas && this.moveCapturedPointer !== null) {
          try { if (canvas.hasPointerCapture(this.moveCapturedPointer)) canvas.releasePointerCapture(this.moveCapturedPointer); } catch { /* ignore */ }
          canvas.style.cursor = '';
        }
        this.moveCapturedPointer = null;
        this.moveSink?.(ev);
        break;
      }
      case 'capture': {
        const canvas = this.canvas;
        if (!canvas) break;
        if (ev.capture) {
          try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
        } else {
          try {
            if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
          } catch { /* ignore */ }
        }
        break;
      }
      case 'turn-start':
        this.lastDragDx = 0;
        this.lastDragDy = 0;
        break;
      case 'turn':
        this.lastDragDx = ev.dx;
        this.lastDragDy = ev.dy;
        if (this.context) {
          const sensitivityX = APP_CONFIG.interaction.characterTurnSensitivityX;
          this.context.motionPipeline.targetYawOffset += ev.dx * sensitivityX;

          if (this.context.controls) {
            const sensitivityY = APP_CONFIG.camera.pitchSensitivityY;
            (this.context.controls as any)._rotateUp(ev.dy * sensitivityY);
          }
        }
        break;
      case 'turn-end': {
        this.lastDragDx = 0;
        this.lastDragDy = 0;
        const currentScene = sceneManager.getCurrentScene();
        if (currentScene?.isTransparent) {
          void passthroughManager.setInteracting(false);
        }
        if (this.context) {
          this.context.onSaveBodyYaw();
          this.context.onSaveCameraPitch();
        }
        break;
      }
      case 'guide-drag': {
        // cameraYGuide 拖拽中 — 持续改 cameraYOffset
        const deltaY = this.screenDeltaToWorld(ev.dy);
        if (this.context && Math.abs(deltaY) > 0) {
          const newOffset = THREE.MathUtils.clamp(this._currentCameraYOffset + deltaY, -1, 1);
          this.context.onSetCameraYOffset(newOffset);
        }
        break;
      }
      case 'state-changed':
        if (ev.cursor) this.updateCursor();
        if (ev.notify) this.notifyStateChange(ev.dx, ev.dy);
        else if (ev.passthrough) this.syncGuidePassthrough();
        break;
      default:
        break;
    }
  };

  private applyResponse(e: PointerEvent, r: GestureResponse): void {
    if (r.preventDefault) e.preventDefault();
    if (r.stopPropagation) e.stopPropagation();
  }

  private setupGlobalKeyListeners(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      this.machine.keyDown(hasInteractionModifier(e));
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const isMac = isMacOS();
      const stillActive = isMac ? e.metaKey : e.ctrlKey;
      this.machine.keyUp(stillActive);
    };

    const onWindowBlur = () => {
      this.machine.blur();
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
    if (this.machine.dragging || this.machine.guideDragging) {
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (this.machine.modifierActive) {
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

  private setupCanvasPointerListeners(canvas: HTMLCanvasElement): void {
    const toSample = (e: PointerEvent) => fillPointerSample(this.sample, e, hasInteractionModifier(e));

    const onPointerDown = (e: PointerEvent) => {
      this.applyResponse(e, this.machine.pointerDown(toSample(e)));
    };

    const onPointerMove = (e: PointerEvent) => {
      this.applyResponse(e, this.machine.pointerMove(toSample(e)));
    };

    const onPointerUp = (e: PointerEvent) => {
      this.machine.pointerUp(toSample(e));
    };

    const onPointerCancel = (e?: PointerEvent) => {
      this.machine.pointerCancel(e ? toSample(e) : undefined);
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
      this.machine.endTurn();
      this.machine.endGuideDrag();
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }

  public dispose(): void {
    this.machine.clearArm({ hideGuides: true });
    this.unbindCanvas();
    this.machine.dispose();
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
