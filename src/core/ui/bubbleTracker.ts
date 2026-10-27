import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export type BubblePlacement = 'top' | 'top-right' | 'top-left';

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
  placement: BubblePlacement;
}

/**
 * 根据定位策略计算气泡 CSS 变换矩阵
 * 
 * - 'top': 正上方居中，底部与 headY 保持 16px 呼吸间距，受顶部 16px 视口拦截
 * - 'top-right': 右上角避让，X 位于头部右侧 (根据视口宽度自适应 50~90px)，Y 贴合头部上方或额头高度，杜绝压制发冠
 * - 'top-left': 左上角避让，X 位于头部左侧，对称处理
 */
export function getBubbleTransform(
  placement: BubblePlacement,
  headX: number,
  headY: number,
  sideOffset = 80,
): string {
  if (placement === 'top-right') {
    return `translate3d(clamp(16px, calc(${headX}px + ${sideOffset}px), calc(100vw - 100% - 16px)), max(24px, calc(${headY}px + 10px)), 0)`;
  }
  if (placement === 'top-left') {
    return `translate3d(clamp(16px, calc(${headX}px - ${sideOffset}px - 100%), calc(100vw - 100% - 16px)), max(24px, calc(${headY}px + 10px)), 0)`;
  }
  return `translate3d(clamp(16px, calc(${headX}px - 50%), calc(100vw - 100% - 16px)), max(16px, calc(${headY}px - 100% - 16px)), 0)`;
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
    placement: 'top',
  };

  private lastBubbleX = 0;
  private lastBubbleY = 0;
  private tempHeadPos = new THREE.Vector3();

  private bubbleWidth = 280;
  private bubbleHeight = 85;

  public onBubbleChange?: (state: BubbleState) => void;

  /**
   * 外部或 ResizeObserver 动态同步气泡实测尺寸（用于精准防遮挡判定，避免主循环内 layout thrashing）
   */
  public setMeasuredSize(w: number, h: number): void {
    if (w > 0 && h > 0) {
      if (Math.abs(this.bubbleWidth - w) > 2 || Math.abs(this.bubbleHeight - h) > 2) {
        this.bubbleWidth = w;
        this.bubbleHeight = h;
      }
    }
  }

  /**
   * 判定气泡避让定位：
   * 当气泡居中正上方放置时，若角色头部靠近屏幕顶端导致垂直可用空间不足以容纳气泡高度，
   * 气泡被视口顶端拦截向下挤压就会直接遮挡角色发冠与面部。
   * 此时自动切换为侧边避让（优先右上角，并在右边缘空间不足时镜像至左上角），
   * 采用 35px 迟滞 (hysteresis) 彻底杜绝角色呼吸与微动时的边缘反复横跳。
   */
  private evaluatePlacement(w: number): boolean {
    const headX = this.state.x;
    const headY = this.state.y;
    const minTopPadding = 20;
    const gapY = 16;
    const bubbleH = this.bubbleHeight || 85;
    const bubbleW = this.bubbleWidth || 280;

    // 正上方安全所需高度：气泡高 + 视口上安全距 + 头顶与气泡间距
    const minSpaceNeeded = bubbleH + minTopPadding + gapY;

    let nextPlacement: BubblePlacement = this.state.placement || 'top';
    const sideOffset = Math.min(90, Math.max(50, Math.round(w * 0.10)));

    if (this.state.placement === 'top') {
      if (headY < minSpaceNeeded) {
        // 垂直空间被窗口顶端切入，可能压迫头顶：切换至右上角避让
        const rightSpace = w - (headX + sideOffset);
        if (rightSpace >= bubbleW * 0.7 || rightSpace >= 160) {
          nextPlacement = 'top-right';
        } else {
          nextPlacement = 'top-left';
        }
      }
    } else {
      // 当前已经在侧边 (top-right 或 top-left)
      // 迟滞 35px 保证下移回弹时稳定性
      if (headY > minSpaceNeeded + 35) {
        nextPlacement = 'top';
      } else {
        const rightSpace = w - (headX + sideOffset);
        if (rightSpace >= bubbleW * 0.7 || rightSpace >= 160) {
          nextPlacement = 'top-right';
        } else {
          nextPlacement = 'top-left';
        }
      }
    }

    if (nextPlacement !== this.state.placement) {
      this.state.placement = nextPlacement;
      return true;
    }
    return false;
  }

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
    headTopWorld?: THREE.Vector3,
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

      // 根据文本长度快速预估初始高度，首帧即享精准避让
      if (speechText) {
        const lineCount = Math.min(5, Math.max(1, Math.ceil(speechText.length / 30)));
        this.bubbleHeight = Math.max(this.bubbleHeight, 46 + lineCount * 22);
      }

      if (vrm) {
        this.computeScreenPosition(vrm, camera, headTopWorld);
        const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
        this.evaluatePlacement(w);
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
  update(vrm: VRM | null, camera: THREE.Camera, headTopWorld?: THREE.Vector3): void {
    if (!this.state.visible || !vrm) return;

    this.computeScreenPosition(vrm, camera, headTopWorld);

    const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const placementChanged = this.evaluatePlacement(w);

    const dx = this.state.x - this.lastBubbleX;
    const dy = this.state.y - this.lastBubbleY;

    // 死区过滤：角色微弱呼吸 (位移 < 1.5px, dx*dx+dy*dy < 2.25) 且 placement 未改变时完全不更新 transform；
    // 出现明显位移或 placement 策略切换时更新 DOM
    if (placementChanged || dx * dx + dy * dy >= 2.25) {
      this.lastBubbleX = this.state.x;
      this.lastBubbleY = this.state.y;
      if (typeof document !== 'undefined') {
        const bubbleEl = document.getElementById('head-bubble');
        if (bubbleEl) {
          const sideOffset = Math.min(90, Math.max(50, Math.round(w * 0.10)));
          bubbleEl.style.transform = getBubbleTransform(
            this.state.placement,
            this.state.x,
            this.state.y,
            sideOffset,
          );
          bubbleEl.dataset.placement = this.state.placement;
        }
      }
      if (placementChanged) {
        this.onBubbleChange?.({ ...this.state });
      }
    }
  }

  private computeScreenPosition(
    vrm: VRM,
    camera: THREE.Camera,
    headTopWorld?: THREE.Vector3,
  ): void {
    if (headTopWorld) {
      this.tempHeadPos.copy(headTopWorld);
    } else {
      const head = vrm.humanoid?.getNormalizedBoneNode('head');
      if (head) {
        head.getWorldPosition(this.tempHeadPos);
        this.tempHeadPos.y += 0.24;
      } else {
        this.tempHeadPos.set(0, 1.7, 0);
      }
    }

    this.tempHeadPos.project(camera);
    const w = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const h = typeof window !== 'undefined' ? window.innerHeight : 1080;

    this.state.x = Math.round((this.tempHeadPos.x * 0.5 + 0.5) * w);
    this.state.y = Math.round((-(this.tempHeadPos.y * 0.5) + 0.5) * h);
  }
}
