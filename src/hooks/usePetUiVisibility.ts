/**
 * usePetUiVisibility — 桌宠模式 UI 唤起/收起的统一入口
 *
 * 1. isPetUIVisible 单一可信源 — TopHeader / ChatBar 都从这里取;
 * 2. show() / toggle() 唤起时 dispatch `corner-flash`;
 * 3. 点击人物主体 → toggle, 点击空白 → hide (单击判定见 core/ui/clickDetector.ts: 位移 ≤ 6px, 拖动 / 多指 / 取消不算);
 * 4. 10s 无操作自动收起 — 悬停顶栏/输入条、或任意 Dialog 打开时暂停计时。
 *
 * Tauri (App.tsx) 与 /embed (EmbedApp.tsx) 共用这一份: 调用方只决定 enabled (Tauri = 当前是透明场景; embed = uiAutoHide 在当前场景生效)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClickDetector, type ClickSample } from '@/core/ui/clickDetector';

const PET_UI_DURATION_MS = 10_000;
export { PET_UI_DURATION_MS };

/** 点在这些元素上 (UI 自己处理点击) 既不算点角色也不算点空白; data-xc-ui = /embed 内置按钮。 */
const PET_UI_IGNORE_SELECTOR = 'header, form, [role="menu"], [role="dialog"], button, input, textarea, #chat-menu, .drop-card, [data-xc-ui]';
const PET_UI_HOLD_EVENT = 'pet-ui-hold';
const PET_UI_RELEASE_EVENT = 'pet-ui-release';

function flashCorners(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('corner-flash'));
}

function emitPetUiHide(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('pet-ui-hide'));
}

export function holdPetUi(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_UI_HOLD_EVENT, { detail: id }));
}

export function releasePetUi(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PET_UI_RELEASE_EVENT, { detail: id }));
}

function isDialogOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('[role="dialog"][data-state="open"]'));
}

export function usePetUiVisibility(enabled: boolean) {
  const [isPetUIVisible, setIsPetUIVisible] = useState(false);
  const [held, setHeld] = useState(false);
  const holdsRef = useRef(new Set<string>());

  const syncHeld = useCallback(() => {
    setHeld(holdsRef.current.size > 0 || isDialogOpen());
  }, []);

  useEffect(() => {
    if (!enabled) setIsPetUIVisible(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const onHold = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) holdsRef.current.add(id);
      syncHeld();
    };
    const onRelease = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) holdsRef.current.delete(id);
      syncHeld();
    };

    window.addEventListener(PET_UI_HOLD_EVENT, onHold);
    window.addEventListener(PET_UI_RELEASE_EVENT, onRelease);

    const mo = new MutationObserver(syncHeld);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
    syncHeld();

    return () => {
      window.removeEventListener(PET_UI_HOLD_EVENT, onHold);
      window.removeEventListener(PET_UI_RELEASE_EVENT, onRelease);
      mo.disconnect();
    };
  }, [enabled, syncHeld]);

  useEffect(() => {
    if (!isPetUIVisible || held) return;
    const t = setTimeout(() => {
      setIsPetUIVisible(false);
      emitPetUiHide();
    }, PET_UI_DURATION_MS);
    return () => clearTimeout(t);
  }, [isPetUIVisible, held]);

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

  useEffect(() => {
    if (!enabled) return;

    // 单击判定 (位移阈值 / 拖动 / 多指 / 取消) 在 core/ui/clickDetector.ts, Tauri 与 /embed 共用
    const detector = new ClickDetector();
    const sample = (e: PointerEvent): ClickSample => ({
      x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY, button: e.button, isPrimary: e.isPrimary,
    });

    const handlePointerDown = (e: PointerEvent) => detector.down(sample(e));
    const handlePointerMove = (e: PointerEvent) => detector.move(sample(e));
    const handlePointerCancel = () => detector.cancel();

    const handlePointerUp = async (e: PointerEvent) => {
      if (!detector.up(sample(e))) return;

      const target = e.target as HTMLElement | null;
      if (target?.closest(PET_UI_IGNORE_SELECTOR)) return;

      const { vrmEngine } = await import('@/core/vrmEngine');
      const hit = vrmEngine.isHitModel(e.clientX, e.clientY);
      if (hit) toggle();
      else hide();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [enabled, toggle, hide]);

  return {
    isPetUIVisible,
    show,
    hide,
    toggle,
    durationMs: PET_UI_DURATION_MS,
  };
}
