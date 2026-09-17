/**
 * usePetUiVisibility — 桌宠模式 UI 唤起/收起的统一入口
 *
 * 集中三件事:
 * 1. isPetUIVisible 单一可信源 — TopHeader / ChatBar 都从这里取;
 * 2. show() 与 toggle() 唤起时自动 dispatch `corner-flash` — 与 TauriWindowFrame
 *    4 角短暂可见共用同一触发, 共享同一时长 (PET_UI_DURATION_MS);
 * 3. 鼠标点击人物主体 → toggle, 点击空白 → hide;
 * 4. 10s 无操作自动收起 — 同步 dispatch `pet-ui-hide` 让 TauriWindowFrame 也清角标,
 *    保证 pet UI 和 corner fade 同步进行, 不会出现"topHeader 没了但 corner 还亮"的脱节。
 *
 * ponytail: corner flash 与 pet UI 共享同一个倒计时源, 任何修改时长 / 加自定义行为
 * (例如鼠标活动重置 timer) 都只改 hook 一处。
 */
import { useCallback, useEffect, useState } from 'react';

const PET_UI_DURATION_MS = 10_000;
export { PET_UI_DURATION_MS };

const CLICK_DEBOUNCE_PX = 6;

function flashCorners(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('corner-flash'));
}

function emitPetUiHide(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('pet-ui-hide'));
}

export function usePetUiVisibility(enabled: boolean) {
  const [isPetUIVisible, setIsPetUIVisible] = useState(false);

  // 透明模式关闭时强制收起
  useEffect(() => {
    if (!enabled) setIsPetUIVisible(false);
  }, [enabled]);

  // 自动收起 — PET_UI_DURATION_MS 无操作后 hide, 同步 dispatch pet-ui-hide 让 corner 跟着淡
  useEffect(() => {
    if (!isPetUIVisible) return;
    const t = setTimeout(() => {
      setIsPetUIVisible(false);
      emitPetUiHide();
    }, PET_UI_DURATION_MS);
    return () => clearTimeout(t);
  }, [isPetUIVisible]);

  const show = useCallback(() => {
    setIsPetUIVisible((prev) => {
      if (prev) return prev;
      flashCorners();
      return true;
    });
  }, []);

  const hide = useCallback(() => {
    setIsPetUIVisible(false);
    emitPetUiHide();
  }, []);

  const toggle = useCallback(() => {
    setIsPetUIVisible((prev) => {
      const next = !prev;
      if (next) flashCorners();
      else emitPetUiHide();
      return next;
    });
  }, []);

  // 桌宠模式: 点击人物主体 → toggle, 点击空白 → hide
  useEffect(() => {
    if (!enabled) return;

    let downPos: { x: number; y: number } | null = null;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) downPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = async (e: PointerEvent) => {
      if (!downPos || e.button !== 0) return;
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;

      // 6px 防抖 — 拖动窗口位移不触发 toggle
      if (dist > CLICK_DEBOUNCE_PX) return;

      // 命中 UI 控件 / 菜单 / 表单 / 自定义热区 → 不接管
      const target = e.target as HTMLElement | null;
      if (target?.closest('header, form, [role="menu"], [role="dialog"], button, input, textarea, #chat-menu, .drop-card')) {
        return;
      }

      const { vrmEngine } = await import('@/core/vrmEngine');
      const hit = vrmEngine.isHitModel(e.clientX, e.clientY);
      if (hit) toggle();
      else hide();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [enabled, toggle, hide]);

  return {
    isPetUIVisible,
    show,
    hide,
    toggle,
    /** 自动收起时长 (ms) — 与 corner 共享同一常量 */
    durationMs: PET_UI_DURATION_MS,
  };
}