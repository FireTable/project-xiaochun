import React from 'react';
import { GUIDE_ARC_SHADOW_COLOR, GUIDE_SHADOW, guideRgba } from '@/core/interaction/guideStyle';

/**
 * CornerHandle — 窗口四角的圆弧把手 (SVG: 视觉弧线 + 16px 粗命中条)。
 * Tauri 桌宠窗口 (TauriWindowFrame) 与 /embed 的 iframe 缩放 (EmbedCorners) 共用同一套外观 / 路径 / 光标。
 */
// ─────────────────────────────────────────────────────────────
// 子组件 — 单个角的 SVG 弧线 + 命中条
// ─────────────────────────────────────────────────────────────
export type Corner = 'NW' | 'NE' | 'SW' | 'SE';

export const CORNERS: readonly Corner[] = ['NW', 'NE', 'SW', 'SE'] as const;

const CORNER_PATH_D: Record<Corner, string> = {
  NW: 'M 4 30 V 20 A 16 16 0 0 1 20 4 H 30',
  NE: 'M 28 30 V 20 A 16 16 0 0 0 12 4 H 2',
  SW: 'M 4 2 V 12 A 16 16 0 0 0 20 28 H 30',
  SE: 'M 28 2 V 12 A 16 16 0 0 1 12 28 H 2',
};

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

// 弧线统一加柔和深色阴影 (Tauri / embed 同一套, 不分场景): 白色主体 + 低透明度大模糊的深色光晕。
// 颜色 / 阴影参数全部来自 core/interaction/guideStyle.ts (与 3D 调整提示共用, 这里不硬编码)。
// 白色弧线在浅色 / 透明叠白底的背景上否则会"隐形"; 阴影不是硬黑边, 深色背景上几乎不可见 (不显脏)。
// 实现: 单独一条描边路径 (rgba(0,0,0,.3)) 经 SVG feGaussianBlur 模糊, 画在白色弧线下面;
// 不用 CSS drop-shadow, 因为它的阴影强度跟随弧线 alpha (非悬停时弧线仅 45%), 会过弱。
// svg 设为 overflow-visible 且弧线整体内收 4px (与 20px 圆角同心: 圆心 (20,20), 半径 16),
// 这样模糊半径不会被 svg 自身或外层 overflow-hidden 裁掉。
const SHADOW_FILTER_ID = 'xc-corner-shadow-blur';

export const CornerHandle: React.FC<{
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
    className={`absolute w-8 h-8 overflow-visible pointer-events-none select-none transition-all duration-500 ease-out ${POSITION_CLASS[corner]} ${
      isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
    } ${isHovered ? 'scale-105' : ''}`}
  >
    <defs>
      <filter id={SHADOW_FILTER_ID} x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation={GUIDE_SHADOW.arcBlur} />
      </filter>
      {/* 把白色弧线自己覆盖的区域从阴影里抠掉: 弧线半透明 (GUIDE_OPACITY) 时不会透出阴影的脏边 (抠孔略窄于弧线 3, 避免边缘留缝) */}
      <mask id={`xc-corner-shadow-hole-${corner}`} maskUnits="userSpaceOnUse" x="-16" y="-16" width="64" height="64">
        <rect x="-16" y="-16" width="64" height="64" fill="white" />
        <path d={CORNER_PATH_D[corner]} stroke="black" strokeWidth="2.6" strokeLinecap="round" />
      </mask>
    </defs>
    {/* 柔和深色阴影 (在白色弧线下面, 弧线覆盖处被抠掉) */}
    <g mask={`url(#xc-corner-shadow-hole-${corner})`}>
      <path
        d={CORNER_PATH_D[corner]}
        stroke={GUIDE_ARC_SHADOW_COLOR}
        strokeWidth={GUIDE_SHADOW.arcWidth}
        strokeLinecap="round"
        filter={`url(#${SHADOW_FILTER_ID})`}
        transform={`translate(0 ${GUIDE_SHADOW.arcDy})`}
        style={{ pointerEvents: 'none' }}
      />
    </g>
    {/* 视觉弧线 */}
    <path
      d={CORNER_PATH_D[corner]}
      stroke={isHovered ? guideRgba(0.95) : guideRgba(0.45)}
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