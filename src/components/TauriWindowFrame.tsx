import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktop, startWindowResize } from '@/lib/platform';
import { useCurrentScene } from '@/core/scene/sceneManager';
import { passthroughManager } from '@/core/scene/passthroughManager';

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

    const cornerSize = 40;
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
  const handleCornerMouseDown = async (
    corner: Corner,
    e: React.MouseEvent,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDraggingCorner(true);
    try {
      await passthroughManager.setInteracting(true);
      await startWindowResize(CORNER_TO_DIRECTION[corner]);
      const onMouseUp = () => {
        window.removeEventListener('mouseup', onMouseUp);
        void passthroughManager.setInteracting(false);
        setIsDraggingCorner(false);
      };
      window.addEventListener('mouseup', onMouseUp);
    } catch (err) {
      console.warn(`[TauriWindowFrame] startWindowResize(${corner}) failed:`, err);
      setIsDraggingCorner(false);
    }
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

// ─────────────────────────────────────────────────────────────
// 子组件 — 单个角的 SVG 弧线 + 命中条
// ─────────────────────────────────────────────────────────────
type Corner = 'NW' | 'NE' | 'SW' | 'SE';

const CORNERS: readonly Corner[] = ['NW', 'NE', 'SW', 'SE'] as const;

const CORNER_PATH_D: Record<Corner, string> = {
  NW: 'M 2 30 V 20 A 18 18 0 0 1 20 2 H 30',
  NE: 'M 30 30 V 20 A 18 18 0 0 0 12 2 H 2',
  SW: 'M 2 2 V 12 A 18 18 0 0 0 20 30 H 30',
  SE: 'M 30 2 V 12 A 18 18 0 0 1 12 30 H 2',
};

const CORNER_TO_DIRECTION = {
  NW: 'NorthWest',
  NE: 'NorthEast',
  SW: 'SouthWest',
  SE: 'SouthEast',
} as const satisfies Record<Corner, 'NorthWest' | 'NorthEast' | 'SouthWest' | 'SouthEast'>;

// ponytail: hit zone 紧贴屏幕四角 — inset 后用户贴屏边点击会落空 (hit zone
// 8px 半径 stroke 推到屏幕里, 屏幕角 (0,0) 附近没覆盖), 所以 position 仍为 0。
// 「太贴边」问题用更宽 hit zone stroke 解决 (path 自身 16px 不动), 不是 inset。
const POSITION_CLASS: Record<Corner, string> = {
  NW: 'top-0 left-0',
  NE: 'top-0 right-0',
  SW: 'bottom-0 left-0',
  SE: 'bottom-0 right-0',
};

const CURSOR_CLASS: Record<Corner, string> = {
  NW: 'cursor-nwse-resize',
  NE: 'cursor-nesw-resize',
  SW: 'cursor-nesw-resize',
  SE: 'cursor-nwse-resize',
};

const CornerHandle: React.FC<{
  corner: Corner;
  isVisible: boolean;
  isHovered: boolean;
  pointerEnabled: boolean;
  resizeTitle: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}> = ({ corner, isVisible, isHovered, pointerEnabled, resizeTitle, onMouseEnter, onMouseLeave, onMouseDown }) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    className={`absolute w-8 h-8 pointer-events-none select-none transition-all duration-500 ease-out ${POSITION_CLASS[corner]} ${
      isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
    } ${isHovered ? 'scale-105' : ''}`}
  >
    {/* 视觉弧线 */}
    <path
      d={CORNER_PATH_D[corner]}
      stroke={isHovered ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.45)'}
      strokeWidth="3"
      strokeLinecap="round"
      style={{ pointerEvents: 'none' }}
    />
    {/* 命中条 — stroke 16px 粗, 实际接收点击 */}
    <path
      d={CORNER_PATH_D[corner]}
      stroke="rgba(0, 0, 0, 0.001)"
      strokeWidth="16"
      strokeLinecap="round"
      style={{ pointerEvents: pointerEnabled ? 'stroke' : 'none' }}
      className={pointerEnabled ? CURSOR_CLASS[corner] : ''}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
    >
      <title>{resizeTitle}</title>
    </path>
  </svg>
);