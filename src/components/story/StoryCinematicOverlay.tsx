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
      {/* 1. 电影遮幅：半透明渐变羽化过渡 (营造影院氛围，带透明过渡，绝无生硬切边) */}
      <div
        className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-black/85 via-black/40 to-transparent pointer-events-none transition-all duration-700 ease-out ${isLetterboxActive ? 'h-16 sm:h-24 opacity-100' : 'h-0 opacity-0'
          }`}
      />
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none transition-all duration-700 ease-out ${isLetterboxActive ? 'h-24 sm:h-36 opacity-100' : 'h-0 opacity-0'
          }`}
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
                ? 'font-mono text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.35)]'
                : 'font-sans font-light drop-shadow-[0_0_12px_rgba(255,255,255,0.3)]'
              }`}
          >
            {intertitleText}
          </p>
          <div className="w-12 h-[1px] bg-white/20 mx-auto animate-pulse" />
          <p className="text-xs text-neutral-400 tracking-widest font-sans flex items-center justify-center animate-pulse">
            <span>轻触屏幕唤醒</span>
          </p>
        </div>
      </div>
    </div>
  );
};
