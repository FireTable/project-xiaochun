import React from 'react';

interface StoryCinematicOverlayProps {
  isLetterboxActive: boolean;
  isIntertitleActive: boolean;
  intertitleText: string;
  intertitleStyle?: 'noto_serif' | 'modern_sans' | 'typewriter';
  isEyeBlinkActive?: boolean;
  onSkipIntertitle?: () => void;
}

export const StoryCinematicOverlay: React.FC<StoryCinematicOverlayProps> = ({
  isLetterboxActive,
  isIntertitleActive,
  intertitleText,
  intertitleStyle = 'noto_serif',
  isEyeBlinkActive = false,
  onSkipIntertitle,
}) => {
  return (
    <div className="pointer-events-none fixed inset-0 z-20 overflow-hidden select-none">
      {/* 1. 电影遮幅：采用多阶平滑 Ease-Out 曲线过渡，边缘沉浸遮光，到达阈值平滑归零 */}
      <div
        className={`absolute top-0 left-0 right-0 pointer-events-none transition-all duration-700 ease-out ${isLetterboxActive ? 'h-20 sm:h-28 opacity-100' : 'h-0 opacity-0'
          }`}
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.82) 20%, rgba(0,0,0,0.52) 50%, rgba(0,0,0,0.20) 75%, rgba(0,0,0,0.04) 90%, rgba(0,0,0,0) 100%)',
        }}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 pointer-events-none transition-all duration-700 ease-out ${isLetterboxActive ? 'h-20 sm:h-28 opacity-100' : 'h-0 opacity-0'
          }`}
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.82) 20%, rgba(0,0,0,0.52) 50%, rgba(0,0,0,0.20) 75%, rgba(0,0,0,0.04) 90%, rgba(0,0,0,0) 100%)',
        }}
      />

      {/* 2. 第一人称眨眼睁开蒙版 (POV Eye Blink) */}
      <div
        className={`absolute inset-0 bg-black transition-all duration-700 ease-in-out ${isEyeBlinkActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0 pointer-events-none'
          }`}
        style={{ transformOrigin: 'center' }}
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
          <p className="text-xs text-white/50 tracking-widest flex items-center justify-center animate-pulse">
            <span>轻触屏幕唤醒</span>
          </p>
        </div>
      </div>
    </div>
  );
};
