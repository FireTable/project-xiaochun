import { isTauri } from '@/lib/platform';
import { sceneManager } from './sceneManager';

export interface InteractiveRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * PassthroughManager — 方案 3：基于 Canvas 像素透明度位图 (Alpha Bitmask) + 全局 UI 自动守卫的原生穿透管理
 * 
 * 1. 角色 3D 画布部分：
 *    每秒以 ~30 FPS 从主 WebGL Canvas 提取 140×205 分辨率的 Alpha 掩码（仅 3.5 KB），
 *    压缩成 1-bit 位图同步给 Rust，支持双腿缝隙、裙摆镂空与身体两侧空白的像素级无缝穿透；
 * 
 * 2. 界面 DOM UI 部分（DevDrawer 抽屉、ChatBar 对话栏、TopHeader 顶栏、Radix 弹窗与下拉菜单等）：
 *    每帧自动扫描活动交互 DOM 区域并同步至 Rust 守护列表，绝对防止非 Canvas 的界面元素被误穿透！
 */
class PassthroughManager {
  private enabled = false;
  private isInteracting = false;
  private uiRects = new Map<string, InteractiveRect>();

  // 离屏微型 Canvas 用于提取 WebGL 的 Alpha 通道
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private readonly maskWidth = 140;
  private readonly maskHeight = 205;
  private lastSyncTime = 0;
  private lastSyncedUIRectsKey = '';
  private lastBitmask: Uint8Array | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      sceneManager.subscribe((scene) => {
        void this.setEnabled(Boolean(scene.isTransparent));
      });
      const initialScene = sceneManager.getCurrentScene();
      if (initialScene?.isTransparent) {
        void this.setEnabled(true);
      }
    }
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (!isTauri()) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_passthrough_enabled', { enabled });
      if (enabled) {
        this.syncAllUIRects(true);
      }
    } catch (err) {
      console.warn('[PassthroughManager] setEnabled failed:', err);
    }
  }

  public isPassthroughEnabled(): boolean {
    return this.enabled;
  }

  public async setInteracting(interacting: boolean): Promise<void> {
    if (this.isInteracting === interacting) return;
    this.isInteracting = interacting;
    if (!isTauri() || !this.enabled) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_is_interacting', { interacting });
    } catch (err) {
      console.warn('[PassthroughManager] setInteracting failed:', err);
    }
  }

  public registerUIRect(id: string, rect: InteractiveRect | null): void {
    if (!rect) {
      if (this.uiRects.delete(id)) {
        this.syncAllUIRects(true);
      }
    } else {
      this.uiRects.set(id, rect);
      this.syncAllUIRects(true);
    }
  }

  private initMaskCanvas(): void {
    if (this.maskCanvas) return;
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.maskWidth;
    this.maskCanvas.height = this.maskHeight;
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * 方案 3 核心：从主渲染 WebGL Canvas 中提取真实像素 Alpha 透明度，并自动巡检 DOM UI 守护区
   */
  public updateCanvasAlphaMask(webglCanvas: HTMLCanvasElement): void {
    if (!this.enabled || !isTauri() || !webglCanvas) return;

    const now = performance.now();
    // 节流至 ~16ms (约 60 FPS 高刷跟随，配合脏检查实现极速响应与零冗余开销)
    if (now - this.lastSyncTime < 16) return;
    this.lastSyncTime = now;

    // 1. 同步非 Canvas 的 DOM UI 区域 (DevDrawer, ChatBar, 下拉菜单等)
    this.syncAllUIRects();

    // 2. 提取并压缩 WebGL 真实画面像素 Alpha 通道
    this.initMaskCanvas();
    if (!this.maskCtx || !this.maskCanvas) return;

    try {
      this.maskCtx.clearRect(0, 0, this.maskWidth, this.maskHeight);
      // 1. 绘制 3D 角色 WebGL 画布 (当前帧渲染后的绝对真实画面)
      this.maskCtx.drawImage(webglCanvas, 0, 0, this.maskWidth, this.maskHeight);

      // 2. 将整个 Webview 中的 DOM UI 元素 (DevDrawer 抽屉、ChatBar、TopHeader、弹窗) 也作为实体画到位图上
      // 从而形成一张真正代表【整个 Webview 实体 vs 透明空白】的一体化像素掩码！
      const uiRects = this.collectAllUIRects();
      if (window.innerWidth > 0 && window.innerHeight > 0) {
        const scaleX = this.maskWidth / window.innerWidth;
        const scaleY = this.maskHeight / window.innerHeight;
        this.maskCtx.fillStyle = '#ffffff';
        for (const r of uiRects) {
          this.maskCtx.fillRect(
            r.x * scaleX,
            r.y * scaleY,
            r.width * scaleX,
            r.height * scaleY
          );
        }
      }

      const imgData = this.maskCtx.getImageData(0, 0, this.maskWidth, this.maskHeight);
      const data = imgData.data;

      const numPixels = this.maskWidth * this.maskHeight;
      const numBytes = Math.ceil(numPixels / 8);
      const bitmask = new Uint8Array(numBytes);

      let pixelIdx = 0;
      for (let i = 3; i < data.length; i += 4) {
        // 阈值设为 40 (约 16% 不透明度)：彻底避免微弱边缘漫射杂散像素污染，确保小春身体 (255) 100% 精准响应
        if (data[i] > 40) {
          const byteIdx = pixelIdx >> 3;
          const bitIdx = pixelIdx & 7;
          bitmask[byteIdx] |= (1 << bitIdx);
        }
        pixelIdx++;
      }

      // 快速脏检查：仅当蒙版内容发生变化时才向 Rust 发送 IPC，动作形变瞬间 16ms 实时更新，静止时 0 IPC 占用
      let isChanged = !this.lastBitmask || this.lastBitmask.length !== bitmask.length;
      if (!isChanged && this.lastBitmask) {
        for (let i = 0; i < bitmask.length; i++) {
          if (bitmask[i] !== this.lastBitmask[i]) {
            isChanged = true;
            break;
          }
        }
      }

      if (isChanged) {
        this.lastBitmask = bitmask;
        void import('@tauri-apps/api/core').then(({ invoke }) => {
          void invoke('update_alpha_bitmask', {
            width: this.maskWidth,
            height: this.maskHeight,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            mask: Array.from(bitmask),
          });
        });
      }
    } catch {
      // 忽略偶发绘制异常
    }
  }

  /**
   * 自动收集页面中所有非 Canvas 的可交互 DOM 界面元素：
   * - DevDrawer 控制面板抽屉 (#control-panel)
   * - 底部 ChatBar 对话栏
   * - 顶部 TopHeader 操作栏
   * - 各种 Radix 弹窗、下拉菜单、Tooltip 等
   */
  private collectAllUIRects(): InteractiveRect[] {
    const rects: InteractiveRect[] = [];

    // 手动注册的 UI 矩形 (如右键菜单、边角把手)
    for (const r of this.uiRects.values()) {
      rects.push(r);
    }

    if (typeof document === 'undefined') return rects;

    // 1. DevDrawer 侧边抽屉 (仅当可见/滑入屏幕时)
    const drawer = document.getElementById('control-panel');
    if (drawer) {
      const r = drawer.getBoundingClientRect();
      if (r.width > 10 && r.right > 0 && r.left < window.innerWidth) {
        rects.push({
          x: Math.max(0, r.left),
          y: Math.max(0, r.top),
          width: r.width,
          height: r.height,
        });
      }
    }

    // 2. 底部对话胶囊与输入栏 (ChatBar) — 精准注册实际控件，释放两侧大片透明穿透区
    const chatInput = document.getElementById('chatText');
    if (chatInput) {
      const form = chatInput.closest('form');
      if (form) {
        const r = form.getBoundingClientRect();
        rects.push({
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        });
      }
      const menuBtn = document.getElementById('chat-menu');
      if (menuBtn) {
        const r = menuBtn.getBoundingClientRect();
        rects.push({
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        });
      }
      const sendBtn = form?.parentElement?.querySelector('button:last-child');
      if (sendBtn && sendBtn !== menuBtn) {
        const r = sendBtn.getBoundingClientRect();
        rects.push({
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        });
      }
    }

    // 3. 顶部操作栏 (TopHeader) — 精准收集可见的真实按钮组，绝不收集全宽 header 透明拖拽条
    const header = document.querySelector('header');
    if (header) {
      const buttons = header.querySelectorAll('button, a, [role="button"]');
      buttons.forEach((btn) => {
        const r = btn.getBoundingClientRect();
        if (r.width > 5 && r.height > 5) {
          rects.push({
            x: r.left,
            y: r.top,
            width: r.width,
            height: r.height,
          });
        }
      });
    }

    // 4. 所有动态弹出层、下拉菜单与对话框 (剔除覆盖全屏的 data-radix-portal 容器)
    const poppers = document.querySelectorAll(
      '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [data-radix-menu-content]'
    );
    poppers.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (
        r.width > 5 &&
        r.height > 5 &&
        r.width < window.innerWidth * 0.85 &&
        r.height < window.innerHeight * 0.85
      ) {
        rects.push({
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        });
      }
    });

    return rects;
  }

  private syncAllUIRects(force: boolean = false): void {
    if (!isTauri() || !this.enabled) return;

    const rects = this.collectAllUIRects();
    const key = rects
      .map((r) => `${r.x.toFixed(0)},${r.y.toFixed(0)},${r.width.toFixed(0)},${r.height.toFixed(0)}`)
      .join(';');

    // 仅在 UI 区域变化或强制同步时向 Rust 发起 IPC，杜绝多余开销
    if (force || key !== this.lastSyncedUIRectsKey) {
      this.lastSyncedUIRectsKey = key;
      void import('@tauri-apps/api/core').then(({ invoke }) => {
        void invoke('update_interactive_rects', { rects });
      });
    }
  }
}

export const passthroughManager = new PassthroughManager();
