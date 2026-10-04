import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktop } from '@/lib/platform';
import { useCurrentScene } from '@/core/scene/sceneManager';
import { passthroughManager } from '@/core/scene/passthroughManager';
import { CORNER_HIT_SIZE, ResizeGesture } from '@/core/gesture';
import { fillPointerSample, newPointerSample } from '@/core/gesture/adapters/domSample';
import { startNativeCornerResize } from '@/core/gesture/adapters/tauriWindow';
import { CornerHandle, CORNERS, type Corner } from './CornerHandle';

/**
 * TauriWindowFrame — 仅 Tauri 桌面端生效的窗口级辅助:
 *
 * 1. 4 个边角圆弧把手 + 命中区 (SVG path stroke, 16px 粗) — transparent 桌宠模式下
 *    左键点击拖拽原生拉伸窗口, 同时防鼠标穿透到底层桌面;
 * 2. 窗口保持永远 resizable, 不再 toggle setResizable;
 * 3. 接收 `corner-flash` (亮) / `pet-ui-hide` (灭) 事件 — 时长由 hook 统一管,
 *    这里只跟随可见性状态;
 * 4. 注入 is-tauri 类到 html, 触发全局圆角视口 CSS。
 *
 * ponytail: 之前用 40×40 React div 当命中区, 各种 stacking context / z-index
 * 跟 #root 撞车, corner drag 直接被吞。回到 SVG path stroke 做命中区, 这版是
 * git history 里被验证 work 的方案。
 */
export const TauriWindowFrame: React.FC = () => {
  const { t } = useTranslation();
  const active = isDesktop();
  const currentScene = useCurrentScene();

  const [hoveredCorner, setHoveredCorner] = useState<Corner | null>(null);
  const [isCornerLingering, setIsCornerLingering] = useState(false);
  // ponytail: 拖拽进行中, 鼠标可能已离开命中区 (浏览器吞 onMouseLeave / OS 抢光标),
  // 此时也强制保持角标可见, 拖完才让 hover/Lingering 决定是否继续显示。
  const [isDraggingCorner, setIsDraggingCorner] = useState(false);
  // 缩放手势 (逻辑层, native 策略: 只发 resize-start, 窗口由 Tauri 原生拖动); 事件由 Tauri 适配器落到 startResizeDragging
  const resizeGestureRef = useRef<ResizeGesture | null>(null);
  if (resizeGestureRef.current === null) resizeGestureRef.current = new ResizeGesture('native');
  const sampleRef = useRef(newPointerSample());

  // 合并 mount 期副作用: is-tauri class + corner-flash / pet-ui-hide 监听
  useEffect(() => {
    if (!active) return;

    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('is-tauri');
    }

    const handleCornerFlash = () => setIsCornerLingering(true);
    const handlePetUiHide = () => setIsCornerLingering(false);
    window.addEventListener('corner-flash', handleCornerFlash);
    window.addEventListener('pet-ui-hide', handlePetUiHide);

    return () => {
      window.removeEventListener('corner-flash', handleCornerFlash);
      window.removeEventListener('pet-ui-hide', handlePetUiHide);
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('is-tauri');
      }
    };
  }, [active]);

  // 缩放手势事件 → Tauri 适配器 (setInteracting(true) → startResizeDragging → 窗口 mouseup 时 setInteracting(false))
  useEffect(() => {
    return resizeGestureRef.current!.on((ev) => {
      if (ev.type === 'resize-start' && ev.strategy === 'native') {
        void startNativeCornerResize(ev.corner, () => setIsDraggingCorner(false));
      }
    });
  }, []);

  if (!active) return null;

  const hasCornerHandles = Boolean(currentScene.tauri.cornerHandles);
  // ponytail: showCorners 在拖拽中恒为 true (鼠标已离开 arc 也行, 不要中途淡出)。
  const showCorners = hasCornerHandles && (isCornerLingering || hoveredCorner !== null || isDraggingCorner);

  // 注册 4 个边角的拉伸热区 — transparent 模式下防穿透 + 唤起原生拉伸
  useEffect(() => {
    const corners: Corner[] = ['NW', 'NE', 'SW', 'SE'];
    if (!hasCornerHandles) {
      corners.forEach((c) => passthroughManager.registerUIRect(`corner-${c.toLowerCase()}`, null));
      return;
    }

    const cornerSize = CORNER_HIT_SIZE; // 与 /embed iframe 缩放共用 (core/gesture/corners.ts)
    const updateCornerRects = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      corners.forEach((c) => {
        const isLeft = c === 'NW' || c === 'SW';
        const isTop = c === 'NW' || c === 'NE';
        passthroughManager.registerUIRect(`corner-${c.toLowerCase()}`, {
          x: isLeft ? 0 : Math.max(0, w - cornerSize),
          y: isTop ? 0 : Math.max(0, h - cornerSize),
          width: cornerSize,
          height: cornerSize,
        });
      });
    };
    updateCornerRects();
    window.addEventListener('resize', updateCornerRects);
    return () => {
      window.removeEventListener('resize', updateCornerRects);
      corners.forEach((c) => passthroughManager.registerUIRect(`corner-${c.toLowerCase()}`, null));
    };
  }, [hasCornerHandles]);

  // 左键点击边角 → setInteracting(true) (防止 Tauri 穿透判定把 click 当悬空)
  // + startResizeDragging。窗口始终保持 resizable=true, 不再 toggle。
  // ponytail: 拖拽全程持有 isDraggingCorner 锁, 防止 onMouseLeave 提前关掉 showCorners
  const handleCornerMouseDown = (
    corner: Corner,
    e: React.MouseEvent,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDraggingCorner(true);
    // → ResizeGesture 发 resize-start → 下方监听器调用 Tauri 适配器 (setInteracting(true) + startResizeDragging + mouseup 收尾)
    resizeGestureRef.current!.begin(corner, fillPointerSample(sampleRef.current, e, false));
  };

  // 命中条弧线路径数据 (32×32 viewBox, 18 半径) — 视觉与命中共用
  return (
    <>
      <div
        className="fixed inset-0 pointer-events-none z-[9990] overflow-hidden select-none"
        aria-hidden="true"
      >
        {CORNERS.map((corner) => (
          <CornerHandle
            key={corner}
            corner={corner}
            isVisible={showCorners}
            isHovered={hoveredCorner === corner}
            pointerEnabled={hasCornerHandles}
            resizeTitle={t('header.resizeWindow')}
            onMouseEnter={() => setHoveredCorner(corner)}
            onMouseLeave={() => setHoveredCorner(null)}
            onMouseDown={(e) => handleCornerMouseDown(corner, e)}
          />
        ))}
      </div>
    </>
  );
};
