import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { useCurrentScene } from '@/core/scene/sceneManager';
import { formatHourToString, type EnvironmentTimeMode } from '@/core/scene/environmentTime';
import { SliderWithAnchors } from '@/components/SliderWithAnchors';

// ──────────────────────────────────────────────────────────────────
// 高精手绘二次元风格天气与天体矢量图标 (SVG Primitives)
// ──────────────────────────────────────────────────────────────────

/** 黄金暖日图标 (白天) */
const DaySunSvg: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="5" fill="url(#daySunGrad)" />
    <g stroke="url(#dayRayGrad)" strokeWidth="1.75" strokeLinecap="round">
      <line x1="12" y1="2" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="6.7" y2="6.7" />
      <line x1="17.3" y1="17.3" x2="19.07" y2="19.07" />
      <line x1="4.93" y1="19.07" x2="6.7" y2="17.3" />
      <line x1="17.3" y1="6.7" x2="19.07" y2="4.93" />
    </g>
    <defs>
      <linearGradient id="daySunGrad" x1="7" y1="7" x2="17" y2="17" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fef08a" />
        <stop offset="1" stopColor="#f59e0b" />
      </linearGradient>
      <linearGradient id="dayRayGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fde047" />
        <stop offset="1" stopColor="#ea580c" />
      </linearGradient>
    </defs>
  </svg>
);

/** 暮色晚霞沉日图标 (黄昏) */
const SunsetSvg: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M17 14A5 5 0 0 0 7 14"
      fill="url(#sunsetSunGrad)"
    />
    <line x1="3" y1="15" x2="21" y2="15" stroke="#f472b6" strokeWidth="1.75" strokeLinecap="round" />
    <line x1="5.5" y1="18.5" x2="18.5" y2="18.5" stroke="#fb7185" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.8" />
    <path d="M12 4V6.5M5.6 7.6L7.4 9.4M18.4 7.6L16.6 9.4" stroke="#fb923c" strokeWidth="1.5" strokeLinecap="round" />
    <defs>
      <linearGradient id="sunsetSunGrad" x1="7" y1="9" x2="17" y2="14" gradientUnits="userSpaceOnUse">
        <stop stopColor="#fdba74" />
        <stop offset="0.6" stopColor="#f43f5e" />
        <stop offset="1" stopColor="#be185d" />
      </linearGradient>
    </defs>
  </svg>
);

/** 静谧月牙与星宿图标 (夜晚) */
const NightMoonSvg: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M18.8 14.5A7.5 7.5 0 1 1 10.5 4.2a6 6 0 0 0 8.3 10.3Z"
      fill="url(#moonGrad)"
    />
    {/* 星芒闪烁 */}
    <path d="M18.5 4L19 5.5L20.5 6L19 6.5L18.5 8L18 6.5L16.5 6L18 5.5L18.5 4Z" fill="#a5f3fc" />
    <path d="M14 2L14.4 3L15.5 3.4L14.4 3.8L14 5L13.6 3.8L12.5 3.4L13.6 3L14 2Z" fill="#bae6fd" />
    <defs>
      <linearGradient id="moonGrad" x1="6" y1="6" x2="18" y2="18" gradientUnits="userSpaceOnUse">
        <stop stopColor="#e0f2fe" />
        <stop offset="0.7" stopColor="#93c5fd" />
        <stop offset="1" stopColor="#6366f1" />
      </linearGradient>
    </defs>
  </svg>
);

/** 天体天球流转时钟图标 (自动现实时间) */
const AutoOrbitSvg: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="8.5" stroke="url(#orbitRingGrad)" strokeWidth="1.5" strokeDasharray="3 2" />
    <circle cx="12" cy="12" r="3.2" fill="#38bdf8" />
    {/* 日球 */}
    <circle cx="17.8" cy="7.2" r="2.2" fill="#f59e0b" />
    {/* 月球 */}
    <circle cx="6.2" cy="16.8" r="1.8" fill="#a5b4fc" />
    <defs>
      <linearGradient id="orbitRingGrad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop stopColor="#38bdf8" />
        <stop offset="0.5" stopColor="#fb923c" />
        <stop offset="1" stopColor="#818cf8" />
      </linearGradient>
    </defs>
  </svg>
);

// ──────────────────────────────────────────────────────────────────
// 预设配置
// ──────────────────────────────────────────────────────────────────

interface PresetItem {
  key: EnvironmentTimeMode;
  icon: React.FC<{ className?: string }>;
  accentColor: string;
}

const PRESET_LIST: PresetItem[] = [
  {
    key: 'auto',
    icon: AutoOrbitSvg,
    accentColor: 'from-sky-500/20 to-indigo-500/20 border-sky-400/40 text-sky-200',
  },
  {
    key: 'day',
    icon: DaySunSvg,
    accentColor: 'from-amber-500/20 to-yellow-500/20 border-amber-400/50 text-amber-200',
  },
  {
    key: 'sunset',
    icon: SunsetSvg,
    accentColor: 'from-rose-500/20 to-orange-500/20 border-rose-400/50 text-rose-200',
  },
  {
    key: 'night',
    icon: NightMoonSvg,
    accentColor: 'from-indigo-500/20 to-violet-500/20 border-indigo-400/50 text-indigo-200',
  },
];

interface SceneTimeCardProps {
  /** 桌面桌宠模式时，是否跟随整体宠物 UI 的淡出淡入 */
  isPetUIVisible?: boolean;
}

export const SceneTimeCard: React.FC<SceneTimeCardProps> = () => {
  const { t } = useTranslation();
  const currentScene = useCurrentScene();
  const isSupported = currentScene.id === 'beach3d' || vrmEngine.isEnvironmentTimeSupported();
  const [timeState, setTimeState] = useState(() => vrmEngine.getEnvironmentTime());
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const hourDisplayRef = useRef<HTMLSpanElement>(null);

  // 监听场景与时间变动
  useEffect(() => {
    const handleSync = () => {
      const updated = vrmEngine.getEnvironmentTime();
      setTimeState(updated);
      if (hourDisplayRef.current) {
        hourDisplayRef.current.textContent = formatHourToString(updated.currentHour);
      }
    };

    window.addEventListener('scene-changed', handleSync);
    window.addEventListener('scene-theme-changed', handleSync);
    window.addEventListener('environment-time-changed', handleSync);

    // 自动模式下，每 10 秒刷新一次显示，保持现实钟点跟随
    const interval = setInterval(() => {
      if (vrmEngine.isEnvironmentTimeSupported()) {
        const curr = vrmEngine.getEnvironmentTime();
        if (curr.mode === 'auto') {
          setTimeState(curr);
          if (hourDisplayRef.current) {
            hourDisplayRef.current.textContent = formatHourToString(curr.currentHour);
          }
        }
      }
    }, 10000);

    return () => {
      window.removeEventListener('scene-changed', handleSync);
      window.removeEventListener('scene-theme-changed', handleSync);
      window.removeEventListener('environment-time-changed', handleSync);
      clearInterval(interval);
    };
  }, []);

  // 点击卡片外部时自动收起
  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, [expanded]);

  // 不支持时间流转的场景（如 void / light / transparent）完全静默，不占界面空间
  if (!isSupported) return null;

  const handleSelectPreset = (mode: EnvironmentTimeMode) => {
    vrmEngine.setEnvironmentTime(mode);
    const updated = vrmEngine.getEnvironmentTime();
    setTimeState(updated);
    if (hourDisplayRef.current) {
      hourDisplayRef.current.textContent = formatHourToString(updated.currentHour);
    }
  };

  const handleSliderTick = (hour: number) => {
    vrmEngine.setEnvironmentTime(hour, { isDragging: true });
    if (hourDisplayRef.current) {
      hourDisplayRef.current.textContent = formatHourToString(hour);
    }
  };

  const handleSliderChange = (hour: number) => {
    vrmEngine.setEnvironmentTime(hour, { isDragging: false });
    setTimeState(vrmEngine.getEnvironmentTime());
  };

  // 根据当前小时或模式获取代表图标
  const CurrentIcon = (() => {
    if (timeState.mode === 'auto') return AutoOrbitSvg;
    const h = timeState.currentHour;
    if (h >= 6.5 && h < 16.5) return DaySunSvg;
    if (h >= 16.5 && h < 19.5) return SunsetSvg;
    return NightMoonSvg;
  })();

  const currentPeriodName = (() => {
    if (timeState.mode === 'auto') return '实时';
    const h = timeState.currentHour;
    if (h >= 6.5 && h < 16.5) return '白昼';
    if (h >= 16.5 && h < 19.5) return '黄昏';
    return '深夜';
  })();

  return (
    <div
      ref={cardRef}
      className="fixed top-[74px] right-6 z-20 flex flex-col items-end select-none font-sans"
    >
      {/* ── 状态气泡 / 胶囊胶囊（折叠状态） ── */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={`group relative flex items-center gap-2.5 px-3 py-1.5 rounded-full transition-all duration-300 cursor-pointer shadow-xl backdrop-blur-xl border ${
          expanded
            ? 'bg-black/75 border-white/30 ring-1 ring-white/20 shadow-brand-500/10'
            : 'bg-black/45 hover:bg-black/65 border-white/15 hover:border-white/30 text-white/90 hover:text-white'
        }`}
        title="设置场景时间"
      >
        {/* 左侧动态天体/时段微标 */}
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-white/10 group-hover:scale-105 transition-transform duration-200">
          <CurrentIcon className="w-3.5 h-3.5" />
        </div>

        {/* 动态时间文本 */}
        <span className="font-mono text-xs font-semibold tracking-wide text-white drop-shadow-sm">
          {formatHourToString(timeState.currentHour)}
        </span>

        {/* 状态徽章 */}
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium tracking-tight ${
            timeState.mode === 'auto'
              ? 'bg-sky-500/25 text-sky-200 border border-sky-400/30'
              : timeState.mode === 'sunset'
                ? 'bg-rose-500/25 text-rose-200 border border-rose-400/30'
                : timeState.mode === 'night'
                  ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-400/30'
                  : 'bg-amber-500/25 text-amber-200 border border-amber-400/30'
          }`}
        >
          {currentPeriodName}
        </span>

        {/* 展开/收起折角图标 */}
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-white/60 group-hover:text-white transition-colors" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-white/60 group-hover:text-white transition-colors" />
        )}
      </button>

      {/* ── 展开控制面板（卡片形态） ── */}
      {expanded && (
        <div className="mt-2 w-[296px] p-3.5 rounded-2xl bg-black/60 backdrop-blur-2xl border border-white/20 shadow-2xl shadow-black/70 flex flex-col gap-3 text-white animate-in fade-in zoom-in-95 duration-200">
          {/* 卡片头部 */}
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white/90">
                {t('sceneTimeCard.title')}
              </span>
              <span
                ref={hourDisplayRef}
                className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-white/10 text-brand-300"
              >
                {formatHourToString(timeState.currentHour)}
              </span>
            </div>

            {/* 快捷重置回现实时间 */}
            {timeState.mode !== 'auto' && (
              <button
                type="button"
                onClick={() => handleSelectPreset('auto')}
                className="flex items-center gap-1 text-[11px] text-white/60 hover:text-brand-300 transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5"
                title={t('sceneTimeCard.followSystem')}
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t('sceneTimeCard.realTime')}</span>
              </button>
            )}
          </div>

          {/* 4 宫格快捷时段选择卡片 */}
          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_LIST.map(({ key, icon: Icon, accentColor }) => {
              const isSelected = timeState.mode === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelectPreset(key)}
                  className={`group relative flex items-center gap-2 p-2 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? `bg-gradient-to-br ${accentColor} shadow-md font-semibold`
                      : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10 text-white/70 hover:text-white'
                  }`}
                >
                  <div className={`p-1 rounded-lg ${isSelected ? 'bg-white/20' : 'bg-white/5 group-hover:bg-white/10'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-semibold leading-tight text-white/90">
                      {t(`sceneTimeCard.presets.${key}`)}
                    </span>
                    <span className="text-[10px] text-white/40 leading-tight">
                      {t(`sceneTimeCard.presets.${key}Hint`)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 0 ~ 24h 连续时间滑块 */}
          <div className="pt-1.5 flex flex-col gap-2">
            <div className="flex justify-between items-center text-[11px] text-white/70">
              <span className="text-white/60 font-medium">{t('sceneTimeCard.fineTune')}</span>
              <span className="font-mono text-brand-200 text-xs font-semibold">
                {formatHourToString(timeState.currentHour)}
              </span>
            </div>

            <SliderWithAnchors
              value={timeState.currentHour}
              min={0}
              max={24}
              step={0.1}
              anchors={[
                { value: 0, label: '0h' },
                { value: 6, label: '6h' },
                { value: 12, label: '12h' },
                { value: 18, label: '18h' },
                { value: 24, label: '24h' },
              ]}
              onTick={handleSliderTick}
              onChange={handleSliderChange}
            />
          </div>
        </div>
      )}
    </div>
  );
};
