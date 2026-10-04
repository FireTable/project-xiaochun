/**
 * tauriWindow — Tauri 桌面端手势适配器: 把语义事件落到 Tauri API / Rust 命令。
 *
 * 强绑定 Tauri 的部分都在这里 (startDragging / startResizeDragging / set_is_interacting):
 *   - 原生窗口拖动 / 缩放不需要逐帧 delta, 只要"开始"信号, 窗口位置由系统更新;
 *   - 因此 GestureMachine / ResizeGesture 在 Tauri 下用 strategy 'native', 只发 move-start / resize-start。
 *
 * 时序要求 (与抽取前完全一致):
 *   - startNativeWindowDrag 必须在 pointermove 事件的同步调用栈里被调用
 *     (macOS 要求鼠标仍按下时才能 startDragging): GestureMachine.pointerMove 同步 emit move-start,
 *     监听器同步调用本函数, 中间没有 await / 微任务。
 *   - 透明场景下先 setInteracting(true) (关闭 Rust 轮询穿透), 再 startDragging, 松手 (pointerup / mouseup) 才 setInteracting(false)。
 */
import { startWindowDragging, startWindowResize } from '@/lib/platform';
import { sceneManager } from '@/core/scene/sceneManager';
import { passthroughManager } from '@/core/scene/passthroughManager';
import type { ResizeCorner } from '../types';

/** 原 interactionController.onPointerMove 里 "10px 阈值 → 裸左键拖窗" 的 Tauri 分支。 */
export function startNativeWindowDrag(): void {
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
  void startWindowDragging();
}

const CORNER_TO_DIRECTION = {
  NW: 'NorthWest',
  NE: 'NorthEast',
  SW: 'SouthWest',
  SE: 'SouthEast',
} as const satisfies Record<ResizeCorner, 'NorthWest' | 'NorthEast' | 'SouthWest' | 'SouthEast'>;

/**
 * 原 TauriWindowFrame.handleCornerMouseDown 里的 Tauri 调用:
 * setInteracting(true) → startResizeDragging → 窗口 mouseup 时 setInteracting(false)。
 * onEnd: 缩放结束 (mouseup) 或启动失败时回调, 给 React 清 isDraggingCorner。
 */
export async function startNativeCornerResize(corner: ResizeCorner, onEnd: () => void): Promise<void> {
  try {
    await passthroughManager.setInteracting(true);
    await startWindowResize(CORNER_TO_DIRECTION[corner]);
    const onMouseUp = () => {
      window.removeEventListener('mouseup', onMouseUp);
      void passthroughManager.setInteracting(false);
      onEnd();
    };
    window.addEventListener('mouseup', onMouseUp);
  } catch (err) {
    console.warn(`[TauriWindowFrame] startWindowResize(${corner}) failed:`, err);
    onEnd();
  }
}
