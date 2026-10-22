import { isTauri } from '@/lib/platform';
import { sceneManager } from './sceneManager';

export interface InteractiveRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isEffectivelyHidden(el: Element): boolean {
  let node: HTMLElement | null = el as HTMLElement;
  // Stop before body: Radix modal menus set `pointer-events: none` on body
  // and `auto` on the portaled content. Treating body as hidden dropped
  // every dropdown rect, so clicks passed through to the desktop.
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    if (style.pointerEvents === 'none') return true;
    if (parseFloat(style.opacity) < 0.05) return true;
    node = node.parentElement;
  }
  return false;
}

function visibleRect(el: Element | null): InteractiveRect | null {
  if (!el || isEffectivelyHidden(el)) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/**
 * PassthroughManager
 *
 * Canvas empty pixels → ignore_cursor_events (click through to desktop).
 * Pointer on HTML (header / chat / menu / dialog) → never passthrough.
 *
 * Overlay menus cannot use elementFromPoint while passthrough is already on
 * (webview gets no mouse events). Opening a menu/dialog sets `dom_blocks`
 * so the whole window captures until it closes.
 */
class PassthroughManager {
  private enabled = false;
  private isInteracting = false;
  private uiRects = new Map<string, InteractiveRect>();
  private lastDomBlocks: boolean | null = null;
  private pointerAttached = false;

  // 离屏微型 Canvas 用于提取 WebGL 的 Alpha 通道
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private readonly maskWidth = 140;
  private readonly maskHeight = 205;
  private lastSyncTime = 0;
  private lastUIRectsSyncTime = 0;
  private lastSyncedUIRectsKey = '';
  private lastBitmask: Uint8Array | null = null;
  private bitmaskBuffer = new Uint8Array(Math.ceil((140 * 205) / 8));

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
        this.attachPointerTracking();
        this.syncDomBlocks();
        this.syncAllUIRects(true);
      } else {
        this.detachPointerTracking();
        this.lastDomBlocks = null;
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
    if (this.maskCtx) {
      this.maskCtx.imageSmoothingEnabled = false;
    }
  }

  /**
   * 方案 3 核心：从主渲染 WebGL Canvas 中提取真实像素 Alpha 透明度，并自动巡检 DOM UI 守护区
   */
  public updateCanvasAlphaMask(webglCanvas: HTMLCanvasElement): void {
    if (!this.enabled || !isTauri() || !webglCanvas) return;

    const now = performance.now();
    // 节流至 ~40ms (约 25 FPS 足够桌面光标穿透响应，同时削减 60% 的 GPU 阻塞式 Readback 停顿)
    if (now - this.lastSyncTime < 40) return;
    this.lastSyncTime = now;

    // DOM UI 区域巡检按 200ms 节流，坚决避免每帧调用 getComputedStyle 与 getBoundingClientRect 触发强制重排
    if (now - this.lastUIRectsSyncTime >= 200) {
      this.lastUIRectsSyncTime = now;
      this.syncDomBlocks();
      this.syncAllUIRects();
    }

    this.initMaskCanvas();
    if (!this.maskCtx || !this.maskCanvas) return;

    try {
      this.maskCtx.clearRect(0, 0, this.maskWidth, this.maskHeight);
      this.maskCtx.drawImage(webglCanvas, 0, 0, this.maskWidth, this.maskHeight);

      const imgData = this.maskCtx.getImageData(0, 0, this.maskWidth, this.maskHeight);
      const data = imgData.data;

      const bitmask = this.bitmaskBuffer;
      let byteIdx = 0;
      let currentByte = 0;
      let bitCount = 0;

      for (let i = 3; i < data.length; i += 4) {
        // 阈值设为 40 (约 16% 不透明度)：彻底避免微弱边缘漫射杂散像素污染，确保小春身体 (255) 100% 精准响应
        if (data[i]! > 40) {
          currentByte |= (1 << bitCount);
        }
        bitCount++;
        if (bitCount === 8) {
          bitmask[byteIdx++] = currentByte;
          currentByte = 0;
          bitCount = 0;
        }
      }
      if (bitCount > 0 && byteIdx < bitmask.length) {
        bitmask[byteIdx++] = currentByte;
      }
      while (byteIdx < bitmask.length) {
        bitmask[byteIdx++] = 0;
      }

      // 快速脏检查：基于 32 位整型字长并行快速对比，仅当蒙版内容发生变化时才向 Rust 发送 IPC
      let isChanged = !this.lastBitmask || this.lastBitmask.length !== bitmask.length;
      if (!isChanged && this.lastBitmask) {
        const u32Len = Math.floor(bitmask.length / 4);
        const curU32 = new Uint32Array(bitmask.buffer, bitmask.byteOffset, u32Len);
        const lastU32 = new Uint32Array(this.lastBitmask.buffer, this.lastBitmask.byteOffset, u32Len);
        for (let i = 0; i < u32Len; i++) {
          if (curU32[i] !== lastU32[i]) {
            isChanged = true;
            break;
          }
        }
        if (!isChanged) {
          for (let i = u32Len * 4; i < bitmask.length; i++) {
            if (bitmask[i] !== this.lastBitmask[i]) {
              isChanged = true;
              break;
            }
          }
        }
      }

      if (isChanged) {
        if (!this.lastBitmask || this.lastBitmask.length !== bitmask.length) {
          this.lastBitmask = new Uint8Array(bitmask);
        } else {
          this.lastBitmask.set(bitmask);
        }
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

  private collectAllUIRects(): InteractiveRect[] {
    const rects: InteractiveRect[] = [];

    for (const r of this.uiRects.values()) {
      rects.push(r);
    }

    if (typeof document === 'undefined') return rects;

    const pushIfVisible = (el: Element | null) => {
      const r = visibleRect(el);
      if (r) rects.push(r);
    };

    pushIfVisible(document.getElementById('control-panel'));
    pushIfVisible(document.getElementById('xiaochun-chatbar'));

    const header = document.querySelector('header');
    if (header && !isEffectivelyHidden(header)) {
      header.querySelectorAll('button, a, [role="button"]').forEach((btn) => {
        pushIfVisible(btn);
      });
    }

    return rects;
  }

  private hasBlockingOverlay(): boolean {
    if (typeof document === 'undefined') return false;
    return Boolean(
      document.querySelector(
        '[data-state="open"][role="menu"], [data-state="open"][role="listbox"], [data-state="open"][role="dialog"], [data-radix-menu-content][data-state="open"], .dialog-overlay[data-state="open"]',
      ),
    );
  }

  private isOverDomUi(clientX: number, clientY: number): boolean {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return false;
    return !el.closest('canvas');
  }

  private syncDomBlocks(clientX?: number, clientY?: number): void {
    if (!isTauri() || !this.enabled) return;
    let blocks = this.hasBlockingOverlay();
    if (!blocks && clientX != null && clientY != null) {
      blocks = this.isOverDomUi(clientX, clientY);
    }
    if (blocks === this.lastDomBlocks) return;
    this.lastDomBlocks = blocks;
    void import('@tauri-apps/api/core').then(({ invoke }) => {
      void invoke('set_dom_blocks_passthrough', { blocks });
    });
  }

  private onPointerProbe = (e: PointerEvent): void => {
    this.syncDomBlocks(e.clientX, e.clientY);
  };

  private attachPointerTracking(): void {
    if (this.pointerAttached || typeof window === 'undefined') return;
    this.pointerAttached = true;
    window.addEventListener('pointermove', this.onPointerProbe, { passive: true });
    window.addEventListener('pointerdown', this.onPointerProbe, { passive: true });
  }

  private detachPointerTracking(): void {
    if (!this.pointerAttached || typeof window === 'undefined') return;
    this.pointerAttached = false;
    window.removeEventListener('pointermove', this.onPointerProbe);
    window.removeEventListener('pointerdown', this.onPointerProbe);
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
