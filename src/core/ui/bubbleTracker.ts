import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export interface BubbleState {
  visible: boolean;
  statusKey: string;
  statusVars?: Record<string, unknown>;
  speechText: string;
  isError?: boolean;
  segmentIndex?: number;
  totalSegments?: number;
  x: number;
  y: number;
}

/**
 * BubbleTracker — 3D 角色头部到 2D 屏幕坐标投影与 DOM 气泡追踪器
 * 
 * 核心特性：
 * 1. 3D 头部空间坐标精确投影到屏幕像素 (x, y)；
 * 2. 1.5px 移动死区 (Dead-zone) 过滤：角色微弱呼吸与微动时不触发 DOM 变换，镜头旋转或大幅移动时丝滑贴合；
 * 3. 高性能直接 DOM 操作：避免 60~120 FPS 下频繁触发 React 树全量重渲染。
 */
export class BubbleTracker {
  public state: BubbleState = {
    visible: false,
    statusKey: '',
    speechText: '',
    isError: false,
    x: 0,
    y: 0,
  };

  private lastBubbleX = 0;
  private lastBubbleY = 0;
  private tempHeadPos = new THREE.Vector3();

  public onBubbleChange?: (state: BubbleState) => void;

  /**
   * 设定当前气泡内容并更新初始位置
   */
  setStatus(
    key: string,
    vrm: VRM | null,
    camera: THREE.Camera,
    vars?: Record<string, unknown>,
    isError = false,
    speechText?: string,
    segmentIndex?: number,
    totalSegments?: number,
  ): void {
    if (!key || key === 'silent') {
      this.state.visible = false;
      this.state.segmentIndex = undefined;
      this.state.totalSegments = undefined;
    } else {
      this.state.visible = true;
      this.state.statusKey = key;
      this.state.statusVars = vars;
      this.state.speechText = speechText || '';
      this.state.isError = isError;
      this.state.segmentIndex = segmentIndex;
      this.state.totalSegments = totalSegments;

      if (vrm) {
        this.computeScreenPosition(vrm, camera);
      }
    }
    this.onBubbleChange?.({ ...this.state });
  }

  hide(): void {
    this.state.visible = false;
    this.onBubbleChange?.({ ...this.state });
  }

  /**
   * 每帧渲染主循环中调用：若气泡可见，执行高频死区过滤与 DOM 直接位移更新
   */
  update(vrm: VRM | null, camera: THREE.Camera): void {
    if (!this.state.visible || !vrm) return;

    this.computeScreenPosition(vrm, camera);

    const dx = this.state.x - this.lastBubbleX;
    const dy = this.state.y - this.lastBubbleY;

    // 死区过滤：角色微弱呼吸 (位移 < 1.5px, dx*dx+dy*dy < 2.25) 时完全不更新 transform；位移明显或镜头旋转时更新 DOM
    if (dx * dx + dy * dy >= 2.25) {
      this.lastBubbleX = this.state.x;
      this.lastBubbleY = this.state.y;
      if (typeof document !== 'undefined') {
        const bubbleEl = document.getElementById('head-bubble');
        if (bubbleEl) {
          bubbleEl.style.transform = `translate3d(calc(${this.state.x}px - 50%), calc(${this.state.y}px - 100% - 16px), 0)`;
        }
      }
    }
  }

  private computeScreenPosition(vrm: VRM, camera: THREE.Camera): void {
    const head = vrm.humanoid?.getNormalizedBoneNode('head');
    if (head) {
      head.getWorldPosition(this.tempHeadPos);
      this.tempHeadPos.y += 0.24;
    } else {
      this.tempHeadPos.set(0, 1.7, 0);
    }

    this.tempHeadPos.project(camera);
    const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const h = typeof window !== 'undefined' ? window.innerHeight : 1080;

    this.state.x = Math.round((this.tempHeadPos.x * 0.5 + 0.5) * w);
    this.state.y = Math.round((-(this.tempHeadPos.y * 0.5) + 0.5) * h);
  }
}
