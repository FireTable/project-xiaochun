import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GradingPreset, TransitionKind } from '@/story/schema';
import { TRANSITION_SPECS } from '@/story/transitions';

interface StoryCinematicOverlayProps {
  isLetterboxActive?: boolean;
  isIntertitleActive: boolean;
  intertitleText: string;
  intertitleStyle?: 'noto_serif' | 'modern_sans' | 'typewriter';
  /** 字卡是否需要点击才继续 (需要时才显示“轻触屏幕唤醒”提示) */
  intertitleRequiresClick?: boolean;
  isEyeBlinkActive?: boolean;
  /** 转场类型与遮罩状态：covered=true 盖住画面，false 揭开 */
  transitionKind?: TransitionKind;
  isTransitionCovered?: boolean;
  /** 后期调色预设 */
  grading?: GradingPreset;
  onSkipIntertitle?: () => void;
}

/**
 * 调色预设 → CSS。用 backdrop-filter 直接作用在其后的 3D 画布上，不改用户的 PostFX 设置；
 * 附一层半透明色罩 / 暗角补足 backdrop-filter 调不出的色偏。
 */
export const GRADING_STYLES: Record<Exclude<GradingPreset, 'default'>, React.CSSProperties> = {
  // 回忆：暖褐、略褪色，带暗角
  sepia_memory: {
    backdropFilter: 'sepia(0.6) saturate(0.85) contrast(1.05) brightness(0.98)',
    WebkitBackdropFilter: 'sepia(0.6) saturate(0.85) contrast(1.05) brightness(0.98)',
    background:
      'radial-gradient(ellipse at center, rgba(120,80,40,0.06) 40%, rgba(40,20,5,0.42) 100%)',
  },
  // 雨夜黑色电影：低饱和、偏冷、对比高
  rainy_noir: {
    backdropFilter: 'saturate(0.35) contrast(1.18) brightness(0.86) hue-rotate(-8deg)',
    WebkitBackdropFilter: 'saturate(0.35) contrast(1.18) brightness(0.86) hue-rotate(-8deg)',
    background:
      'linear-gradient(to bottom, rgba(30,50,90,0.22), rgba(10,15,35,0.30)), radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)',
  },
  // 梦境泛光：提亮、柔和、粉暖光晕
  dream_bloom: {
    backdropFilter: 'saturate(1.15) brightness(1.07) contrast(0.95)',
    WebkitBackdropFilter: 'saturate(1.15) brightness(1.07) contrast(0.95)',
    background:
      'radial-gradient(ellipse at 50% 35%, rgba(255,214,228,0.20), rgba(255,236,214,0.08) 55%, transparent 80%)',
    mixBlendMode: 'screen',
  },
};

const GRADING_FADE_MS = 700;

/** 切换预设时先淡出旧的、换上新的再淡入，避免 backdrop-filter 字符串突变造成画面跳变 */
const GradingLayer: React.FC<{ grading: GradingPreset }> = ({ grading }) => {
  const [shown, setShown] = useState<GradingPreset>(grading);
  const [visible, setVisible] = useState(grading !== 'default');

  useEffect(() => {
    if (grading === shown) {
      setVisible(grading !== 'default');
      return;
    }
    setVisible(false);
    const swap = setTimeout(() => {
      setShown(grading);
      if (grading !== 'default') {
        // 下一帧再淡入，让 opacity 过渡生效
        requestAnimationFrame(() => setVisible(true));
      }
    }, shown === 'default' ? 0 : GRADING_FADE_MS);
    return () => clearTimeout(swap);
  }, [grading, shown]);

  if (shown === 'default') return null;
  return (
    <div
      data-grading={shown}
      className="absolute inset-0 pointer-events-none"
      style={{
        ...GRADING_STYLES[shown],
        opacity: visible ? 1 : 0,
        transition: `opacity ${GRADING_FADE_MS}ms ease-in-out`,
      }}
    />
  );
};

export const StoryCinematicOverlay: React.FC<StoryCinematicOverlayProps> = ({
  isLetterboxActive: _isLetterboxActive = false,
  isIntertitleActive,
  intertitleText,
  intertitleStyle = 'noto_serif',
  intertitleRequiresClick = true,
  isEyeBlinkActive = false,
  transitionKind = 'none',
  isTransitionCovered = false,
  grading = 'default',
  onSkipIntertitle,
}) => {
  const { t } = useTranslation();
  // 兼容只传 isEyeBlinkActive 的旧调用方
  const kind: TransitionKind = transitionKind !== 'none' ? transitionKind : isEyeBlinkActive ? 'eye_blink' : 'none';
  const covered = transitionKind !== 'none' ? isTransitionCovered : isEyeBlinkActive;
  const spec = kind !== 'none' ? TRANSITION_SPECS[kind] : null;
  // 盖上时快 (coverMs)，揭开时慢 (revealMs)
  const transitionMs = spec ? (covered ? spec.coverMs : spec.revealMs) : 0;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 overflow-hidden select-none">
      {/* 0. 后期调色 (sepia_memory / rainy_noir / dream_bloom) */}
      <GradingLayer grading={grading} />

      {/* 1. 转场遮罩：eye_blink 黑场睁眼 / fade_to_black 淡入淡出黑场 / white_flash 强光闪白后褪去 */}
      <div
        data-transition={kind}
        data-covered={covered ? 'true' : 'false'}
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundColor: kind === 'white_flash' ? '#ffffff' : '#000000',
          opacity: kind === 'none' ? 0 : covered ? 1 : 0,
          transform: kind === 'eye_blink' ? `scaleY(${covered ? 1 : 0})` : undefined,
          transformOrigin: 'center',
          transition: `opacity ${transitionMs}ms ${kind === 'white_flash' && !covered ? 'ease-out' : 'ease-in-out'}, transform ${transitionMs}ms ease-in-out`,
        }}
      />

      {/* 3. 全屏黑幕白字 (Intertitle Typography, 支持点击快速跳过) */}
      <div
        onClick={onSkipIntertitle}
        className={`absolute inset-0 flex items-center justify-center p-6 sm:p-12 bg-black/80 transition-opacity duration-700 ease-out cursor-pointer ${isIntertitleActive ? 'opacity-100 pointer-events-auto z-50' : 'opacity-0 pointer-events-none'
          }`}
      >
        <div className="max-w-2xl text-center space-y-4">
          <p
            className={`text-lg sm:text-2xl text-white/95 leading-relaxed tracking-widest ${intertitleStyle === 'noto_serif'
              ? 'font-serif drop-shadow-[0_0_16px_rgba(255,255,255,0.45)]'
              : intertitleStyle === 'typewriter'
                ? 'font-mono text-[#f3d09a] drop-shadow-[0_0_14px_rgba(243,208,154,0.45)]'
                : 'font-sans font-light drop-shadow-[0_0_12px_rgba(255,255,255,0.3)]'
              }`}
          >
            {intertitleText}
          </p>
          <div className="w-12 h-[1px] bg-white/20 mx-auto" />
          {intertitleRequiresClick && (
            <p className="text-xs text-white/50 tracking-widest flex items-center justify-center animate-pulse">
              <span>{t('story.tapToWake', '轻触屏幕唤醒')}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
