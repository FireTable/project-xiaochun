/**
 * usePetUiVisibility — 桌宠模式 UI 唤起/收起的统一入口
 *
 * 1. isPetUIVisible 单一可信源 — TopHeader / ChatBar 都从这里取;
 * 2. show() / toggle() 唤起时 dispatch `corner-flash`;
 * 3. 点击人物主体 → toggle, 点击空白 → hide;
 * 4. 10s 无操作自动收起 — 悬停顶栏/输入条、或任意 Dialog 打开时暂停计时。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const PET_UI_DURATION_MS = 10_000;
export { PET_UI_DURATION_MS };

const CLICK_DEBOUNCE_PX = 6;
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

    let downPos: { x: number; y: number } | null = null;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0) downPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = async (e: PointerEvent) => {
      if (!downPos || e.button !== 0) return;
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;

      if (dist > CLICK_DEBOUNCE_PX) return;

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
    durationMs: PET_UI_DURATION_MS,
  };
}
