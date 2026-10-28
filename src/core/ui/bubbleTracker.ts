import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

export type BubblePlacement = 'top' | 'top-right' | 'top-left' | 'bottom';

/**
 * 气泡对白最大设计高度（对应 HeadBubble.tsx 中对话正文 max-h-[calc(5*1.45em)] 满载 5 行时的整卡高度）
 * 包括：顶部内边距 + 状态栏高 + 5 行正文字高与行高 + 底部内边距 + 间距 ≈ 156px。
 * 核心设计规则：空间判定严禁使用当前瞬间的简短高度（如思考状态仅 42px），
 * 必须以最大设计容量（5 行文本满载）为基准评估空间，确保从思考到多行语音输出全生命周期定位恒定，杜绝反复横跳。
 */
export const BUBBLE_MAX_CAPACITY_HEIGHT = 156;

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
 * - 'top-right': 桌面端右上角避让，X 位于头部右侧 (自适应 50~90px)，Y 贴合头部上方或额头高度，杜绝压制发冠
 * - 'top-left': 桌面端左上角避让，X 位于头部左侧，对称处理
 * - 'bottom': 移动端空间受限模式，水平居中悬浮于底部输入条上方 (calc(100dvh - 100% - 84px))，彻底解放面部与发型
 */
export function getBubbleTransform(
  placement: BubblePlacement,
  headX: number,
  headY: number,
  sideOffset = 80,
): string {
  if (placement === 'bottom') {
    return `translate3d(clamp(12px, calc(${headX}px - 50%), calc(100vw - 100% - 12px)), calc(100dvh - 100% - 84px), 0)`;
  }
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
  private listeners: Set<(state: BubbleState) => void> = new Set();

  /**
   * 订阅气泡状态变更 (支持多组件并行监听与自动注销)
   */
  public subscribe(listener: (state: BubbleState) => void): () => void {
    this.listeners.add(listener);
    // 首次订阅立即分发当前快照
    try {
      listener({ ...this.state });
    } catch (e) {
      console.error('[BubbleTracker] initial subscriber callback error:', e);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = { ...this.state };
    this.onBubbleChange?.(snapshot);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (e) {
        console.error('[BubbleTracker] subscriber callback error:', e);
      }
    }
  }

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
   * 1. 移动端 (窄屏 w < 640)：
   *    两侧空间极其狭窄 (仅 ~90px)，根本无法容纳 240px 气泡；强制侧偏必然会导致气泡被屏幕边缘反弹死死压在角色脸上。
   *    因此移动端严禁侧偏！
   *    - 若正上方垂直净空充裕，居中悬浮于头顶 ('top')；
   *    - 若角色头部贴近顶栏 (空间受限)，气泡平滑转移至底部对白区 ('bottom')，悬浮于输入条上方，面部表情与动作 100% 露显。
   * 2. 桌面端 (宽屏 w >= 640)：
   *    右侧空间充裕，按正上方净空在 'top' 与视觉小说侧边避让 ('top-right' / 'top-left') 之间无缝切换。
   * 
   * 关键设计规则（容量恒定度量）：
   * 空间判定严禁使用当前瞬间的简短高度（如思考状态仅 42px），必须以气泡设计最大容量（5 行满载文本，BUBBLE_MAX_CAPACITY_HEIGHT = 156px）
   * 为基准进行空间测试。这样无论是待机思考、单行简答还是 5 行满载流式播报，定位决策均完全恒定，杜绝在顶上与侧边之间反复横跳抖动。
   */
  private evaluatePlacement(w: number): boolean {
    const headX = this.state.x;
    const headY = this.state.y;
    const isMobile = w < 640;
    const minTopPadding = isMobile ? 56 : 20; // 移动端顶部常驻功能按键群 (约 50px)
    const gapY = 16;
    // 关键设计保证：正上方空间容量必须以最大容量（5 行满载文本）进行评估
    const capacityHeight = Math.max(BUBBLE_MAX_CAPACITY_HEIGHT, this.bubbleHeight || 0);
    const bubbleW = this.bubbleWidth || 280;

    // 正上方安全所需高度：气泡最大容量高 + 视口上安全距 + 头顶与气泡间距
    const minSpaceNeeded = capacityHeight + minTopPadding + gapY;

    let nextPlacement: BubblePlacement = this.state.placement || 'top';

    if (isMobile) {
      // 移动端：双状态自适应 (正上方 'top' <-> 底部悬浮对白卡 'bottom')
      if (this.state.placement === 'bottom') {
        if (headY > minSpaceNeeded + 35) {
          nextPlacement = 'top';
        } else {
          nextPlacement = 'bottom';
        }
      } else {
        if (headY < minSpaceNeeded) {
          nextPlacement = 'bottom';
        } else {
          nextPlacement = 'top';
        }
      }
    } else {
      // 桌面端：三状态自适应 (正上方 'top' <-> 右上角避让 'top-right' / 左上角 'top-left')
      const sideOffset = Math.min(90, Math.max(50, Math.round(w * 0.10)));
      if (this.state.placement === 'top') {
        if (headY < minSpaceNeeded) {
          const rightSpace = w - (headX + sideOffset);
          if (rightSpace >= bubbleW * 0.7 || rightSpace >= 160) {
            nextPlacement = 'top-right';
          } else {
            nextPlacement = 'top-left';
          }
        }
      } else {
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
    this.notify();
  }

  hide(): void {
    this.state.visible = false;
    this.notify();
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
        this.notify();
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
