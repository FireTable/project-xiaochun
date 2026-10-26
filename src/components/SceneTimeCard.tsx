import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock, Sun, Sunset, Moon, type LucideIcon } from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import { useCurrentScene } from '@/core/scene/sceneManager';
import type { EnvironmentTimeMode } from '@/core/scene/environmentTime';

// ──────────────────────────────────────────────────────────────────
// 辅助计算、氛围定义与时间流逝/倒流缓动 (Ease-In-Out Cubic)
// ──────────────────────────────────────────────────────────────────

/**
 * 经典时间流转缓动曲线 (Ease-In-Out Cubic: 从慢起步 ➔ 加速奔流 ➔ 缓驻落定)
 * - 0% ~ 30%: 极慢起跑 (从慢)，彻底消除首帧"跳一段"的突兀感
 * - 30% ~ 70%: 飞速流转 (到快)，产生身临其境的时间流逝/倒流感
 * - 70% ~ 100%: 柔和减速，优雅平稳落停
 */
const timeLapseEase = (t: number): number => {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
};

/** 格式化总分钟数为 HH:MM */
const formatMinutesToString = (totalMinutes: number): string => {
  const m = Math.max(0, Math.min(1439, Math.round(totalMinutes)));
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = Math.floor(m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
};

/** 根据分钟数获取动态天体氛围色、i18n 多语言配置与对应矢量图标 */
const getTimeAtmosphere = (totalMinutes: number) => {
  const hour = totalMinutes / 60;
  if (hour >= 5.0 && hour < 8.0) {
    return {
      labelKey: 'sceneTimeCard.atmospheres.dawn',
      defaultLabel: '破晓晨曦',
      badgeKey: 'sceneTimeCard.atmospheres.dawnBadge',
      defaultBadge: '晨曦',
      accent: '#f472b6',
      glow: 'from-indigo-500/20 via-pink-500/15 to-amber-400/10',
      icon: Sunset,
    };
  }
  if (hour >= 8.0 && hour < 16.5) {
    return {
      labelKey: 'sceneTimeCard.atmospheres.day',
      defaultLabel: '明媚白昼',
      badgeKey: 'sceneTimeCard.atmospheres.dayBadge',
      defaultBadge: '白昼',
      accent: '#38bdf8',
      glow: 'from-sky-400/25 via-blue-500/10 to-amber-300/10',
      icon: Sun,
    };
  }
  if (hour >= 16.5 && hour < 19.5) {
    return {
      labelKey: 'sceneTimeCard.atmospheres.sunset',
      defaultLabel: '落日黄昏',
      badgeKey: 'sceneTimeCard.atmospheres.sunsetBadge',
      defaultBadge: '黄昏',
      accent: '#fb923c',
      glow: 'from-orange-500/25 via-rose-500/15 to-purple-900/20',
      icon: Sunset,
    };
  }
  return {
    labelKey: 'sceneTimeCard.atmospheres.night',
    defaultLabel: '静谧星夜',
    badgeKey: 'sceneTimeCard.atmospheres.nightBadge',
    defaultBadge: '星夜',
    accent: '#818cf8',
    glow: 'from-indigo-600/25 via-slate-900/40 to-blue-950/30',
    icon: Moon,
  };
};

interface PresetConfig {
  id: EnvironmentTimeMode;
  labelKey: string;
  defaultLabel: string;
  sub: string;
  icon: LucideIcon;
}

const PRESETS: PresetConfig[] = [
  { id: 'auto', labelKey: 'sceneTimeCard.presets.auto', defaultLabel: '自动', sub: 'SYNC', icon: Clock },
  { id: 'day', labelKey: 'sceneTimeCard.presets.day', defaultLabel: '白天', sub: '12:00', icon: Sun },
  { id: 'sunset', labelKey: 'sceneTimeCard.presets.sunset', defaultLabel: '黄昏', sub: '17:45', icon: Sunset },
  { id: 'night', labelKey: 'sceneTimeCard.presets.night', defaultLabel: '夜晚', sub: '22:00', icon: Moon },
];

/** 根据预设模式获取目标分钟数 */
const getPresetTargetMinutes = (presetId: EnvironmentTimeMode): number => {
  if (presetId === 'day') return 12 * 60;
  if (presetId === 'sunset') return 17 * 60 + 45;
  if (presetId === 'night') return 22 * 60;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

/** 按照时间差跨度动态计算流逝/倒流时长 (秒) */
const calcFlowDuration = (startMins: number, targetMins: number): number => {
  const diffHours = Math.abs(targetMins - startMins) / 60;
  if (diffHours < 0.05) return 0;
  // 基础起步 1.2s，每相隔 1 小时增加 0.22s：
  // 1 小时微调 ~1.4s，5.75 小时 (白天到黄昏) ~2.46s，10 小时 (白天到夜晚) ~3.4s，最长 3.8s
  return Math.min(3.8, Math.max(1.2, 1.2 + diffHours * 0.22));
};

export interface SceneTimeCardProps {
  /** 桌面桌宠模式时，是否跟随整体宠物 UI 的淡出淡入 */
  isPetUIVisible?: boolean;
}

export const SceneTimeCard: React.FC<SceneTimeCardProps> = () => {
  const { t } = useTranslation();
  const currentScene = useCurrentScene();
  const [engineSupported, setEngineSupported] = useState(() => vrmEngine.isEnvironmentTimeSupported());
  const isSupported = currentScene.id === 'beach3d' || engineSupported;
  const isTransparent = Boolean(currentScene.id === 'transparent' || currentScene.isTransparent);

  const [expanded, setExpanded] = useState(false);
  const [timeState, setTimeState] = useState(() => vrmEngine.getEnvironmentTime());
  const [minutes, setMinutes] = useState(() => Math.round(timeState.currentHour * 60));
  const [isDragging, setIsDragging] = useState(false);

  // 阻尼与平滑时间流逝/倒流动画引用
  const displayedMinutesRef = useRef(minutes);
  const targetMinutesRef = useRef(minutes);
  const isDraggingRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const transitionRef = useRef<{
    startTime: number;
    duration: number;
    startMinutes: number;
    targetMinutes: number;
    targetMode?: EnvironmentTimeMode;
  } | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // SVG 半圆星盘几何参数
  const cx = 130;
  const cy = 115;
  const r = 92;

  // 将当前 0~1440 分钟映射到圆弧角度 (00:00 在左 PI, 12:00 在顶 PI/2, 24:00 在右 0)
  const progress = Math.max(0, Math.min(1, minutes / 1440));
  const angleRad = Math.PI * (1 - progress);
  const thumbX = cx + r * Math.cos(angleRad);
  const thumbY = cy - r * Math.sin(angleRad);

  const atmosphere = getTimeAtmosphere(minutes);
  const localizedAtmosphereLabel = t(atmosphere.labelKey, atmosphere.defaultLabel);

  // 判定当前高亮的预设标签：严格根据阻尼时间 (minutes) 实时动态联动
  const hourFloat = (((minutes % 1440) + 1440) % 1440) / 60;
  const isTransitioning = Boolean(transitionRef.current);
  const activePresetId: EnvironmentTimeMode =
    timeState.mode === 'auto' && !isTransitioning && !isDragging
      ? 'auto'
      : hourFloat >= 6.5 && hourFloat < 16.5
        ? 'day'
        : hourFloat >= 16.5 && hourFloat < 19.5
          ? 'sunset'
          : 'night';

  const CurrentPillIcon = activePresetId === 'auto' ? Clock : atmosphere.icon;

  // 核心动画帧循环：平滑时间流逝/倒流 (Ease-In-Out Cubic: 从慢起步 ➔ 加速奔流 ➔ 缓驻落定)
  const tickAnimation = useCallback((now: number) => {
    if (transitionRef.current) {
      const { startTime, duration, startMinutes, targetMinutes, targetMode } = transitionRef.current;
      const elapsed = now - startTime;
      const tNorm = Math.min(1, Math.max(0, elapsed / duration));
      const eased = timeLapseEase(tNorm);

      const currentMins = startMinutes + (targetMinutes - startMinutes) * eased;
      displayedMinutesRef.current = currentMins;
      setMinutes(Math.round(currentMins));
      vrmEngine.setEnvironmentTime(currentMins / 60, { isDragging: true });

      if (tNorm < 1) {
        rafIdRef.current = requestAnimationFrame(tickAnimation);
      } else {
        // 到达目标，优雅落定
        transitionRef.current = null;
        rafIdRef.current = null;
        lastTimeRef.current = null;
        displayedMinutesRef.current = targetMinutes;
        setMinutes(Math.round(targetMinutes));
        const finalTime = targetMode ?? targetMinutes / 60;
        vrmEngine.setEnvironmentTime(finalTime, { isDragging: false });
        setTimeState(vrmEngine.getEnvironmentTime());
      }
      return;
    }

    rafIdRef.current = null;
    lastTimeRef.current = null;
  }, []);

  // 启动平滑过渡流逝动画 (按时间跨度精准放慢)
  const startTransition = useCallback((targetMins: number, mode?: EnvironmentTimeMode) => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    const startMins = displayedMinutesRef.current;
    const diff = Math.abs(targetMins - startMins);
    if (diff < 0.5) {
      displayedMinutesRef.current = targetMins;
      setMinutes(Math.round(targetMins));
      vrmEngine.setEnvironmentTime(mode ?? targetMins / 60, { isDragging: false });
      return;
    }

    const durationSeconds = calcFlowDuration(startMins, targetMins);

    transitionRef.current = {
      startTime: performance.now(),
      duration: durationSeconds * 1000,
      startMinutes: startMins,
      targetMinutes: targetMins,
      targetMode: mode,
    };
    lastTimeRef.current = performance.now();
    rafIdRef.current = requestAnimationFrame(tickAnimation);
  }, [tickAnimation]);

  // 同步外部/引擎时间状态与场景支持情况
  const syncFromEngine = useCallback(() => {
    setEngineSupported(vrmEngine.isEnvironmentTimeSupported());
    // 如果本地正在进行拖拽或平滑过渡，不接受外部强制覆盖打断
    if (isDraggingRef.current || transitionRef.current) return;
    const updated = vrmEngine.getEnvironmentTime();
    setTimeState(updated);
    const updatedMins = Math.round(updated.currentHour * 60);
    displayedMinutesRef.current = updatedMins;
    targetMinutesRef.current = updatedMins;
    setMinutes(updatedMins);
  }, []);

  useEffect(() => {
    window.addEventListener('scene-changed', syncFromEngine);
    window.addEventListener('scene-theme-changed', syncFromEngine);
    window.addEventListener('environment-time-changed', syncFromEngine);
    syncFromEngine();

    // 自动模式下，每 10 秒平滑跟随现实钟点
    const interval = setInterval(() => {
      if (vrmEngine.isEnvironmentTimeSupported() && !isDraggingRef.current && !transitionRef.current) {
        const curr = vrmEngine.getEnvironmentTime();
        if (curr.mode === 'auto') {
          const now = new Date();
          const targetM = now.getHours() * 60 + now.getMinutes();
          if (Math.abs(targetM - displayedMinutesRef.current) >= 1) {
            startTransition(targetM, 'auto');
          }
        }
      }
    }, 10000);

    return () => {
      window.removeEventListener('scene-changed', syncFromEngine);
      window.removeEventListener('scene-theme-changed', syncFromEngine);
      window.removeEventListener('environment-time-changed', syncFromEngine);
      clearInterval(interval);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [syncFromEngine, startTransition]);

  // 点击外部自动收起卡片
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

  // 指针坐标计算半圆弧度上的精准分钟数 (使用 atan2 极坐标角，消除边缘余弦畸变与速度突变)
  const calcMinutesFromPointer = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return displayedMinutesRef.current;
    const rect = svgRef.current.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;

    const dx = pointerX - cx;
    const dy = cy - pointerY; // SVG Y轴向下，dy 为向上高度

    let angle = Math.atan2(dy, dx);
    if (angle < 0) {
      angle = dx < 0 ? Math.PI : 0;
    }

    const progress = 1 - angle / Math.PI;
    return Math.min(1439, Math.max(0, Math.round(progress * 1439)));
  }, [cx, cy]);

  // 指针按下开始交互
  const handlePointerDown = (e: React.PointerEvent) => {
    const clickedMinutes = calcMinutesFromPointer(e.clientX, e.clientY);
    const diffFromThumb = Math.abs(clickedMinutes - displayedMinutesRef.current);

    // 如果点击在当前光球附近 (<= 45 分钟)，判定为直接抓取拖拽：无缝贴合光标，0 突跳！
    if (diffFromThumb <= 45) {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      transitionRef.current = null;
      isDraggingRef.current = true;
      setIsDragging(true);
      targetMinutesRef.current = clickedMinutes;
      displayedMinutesRef.current = clickedMinutes;
      setMinutes(clickedMinutes);
      vrmEngine.setEnvironmentTime(clickedMinutes / 60, { isDragging: true });
    } else {
      // 若点击远离手柄的轨道，判定为点击寻时：以"从慢到快"缓动曲线平滑飞渡过去，彻底消除首帧暴跳！
      startTransition(clickedMinutes);
    }
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: PointerEvent) => {
      const currentPointerMins = calcMinutesFromPointer(e.clientX, e.clientY);
      targetMinutesRef.current = currentPointerMins;
      displayedMinutesRef.current = currentPointerMins;
      setMinutes(currentPointerMins);
      vrmEngine.setEnvironmentTime(currentPointerMins / 60, { isDragging: true });
    };
    const handleUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      const finalMins = displayedMinutesRef.current;
      vrmEngine.setEnvironmentTime(finalMins / 60, { isDragging: false });
      setTimeState(vrmEngine.getEnvironmentTime());
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [isDragging, calcMinutesFromPointer]);

  // 快捷预设点击：启动流逝/倒流阻尼动画 (由阻尼时间推进联动高亮，不提前突跳)
  const handlePresetClick = (preset: PresetConfig) => {
    const targetMins = getPresetTargetMinutes(preset.id);
    startTransition(targetMins, preset.id);
  };

  // 桌宠透明模式 或 不支持时间流转的场景（如 void / light / transparent / dark）完全不展示
  if (isTransparent || !isSupported) return null;

  return (
    <div
      ref={cardRef}
      className="fixed top-[72px] right-4 z-20 flex flex-col items-end select-none font-sans"
    >
      {/* ── 顶部紧凑星盘微胶囊 ── */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className={`group relative inline-flex items-center justify-center h-8 gap-2 px-3 rounded-full transition-all duration-300 cursor-pointer shadow-[0_4px_20px_rgba(0,0,0,0.35)] backdrop-blur-xl border ${expanded
          ? 'bg-slate-900/90 border-white/30 ring-1 ring-white/20'
          : 'bg-slate-950/65 hover:bg-slate-900/80 border-white/15 hover:border-white/30 text-white/90 hover:text-white'
          }`}
        title={t('sceneTimeCard.title', '场景时间')}
      >
        {/* 天体时段矢量图标 (静态精致，随模式与时段自适应，光学居中) */}
        <CurrentPillIcon
          className="w-3.5 h-3.5 shrink-0 block transition-colors duration-300"
          style={{ color: atmosphere.accent }}
          strokeWidth={2}
        />

        {/* 核心时间文字 (光学基线微调 -translate-y-[0.5px]，与两侧 14px 图标严格同心居中) */}
        <span className="font-mono text-xs font-semibold tracking-wider text-white/95 drop-shadow-sm tabular-nums -translate-y-[0.5px] leading-none select-none">
          {formatMinutesToString(minutes)}
        </span>

        {/* 折叠箭头 (光学基线微调 -translate-y-[0.25px]) */}
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 block text-white/50 group-hover:text-white transition-transform duration-300 -translate-y-[0.25px] ${expanded ? 'rotate-180 text-white' : ''
            }`}
          strokeWidth={2}
        />
      </button>

      {/* ── 展开的天体轨迹星盘 HUD 卡片 ── */}
      {expanded && (
        <div
          className="mt-2.5 w-[280px] rounded-2xl p-4 relative overflow-hidden
                     bg-slate-900/80 backdrop-blur-2xl border border-white/12
                     shadow-[0_20px_50px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.12)]
                     text-white animate-in fade-in zoom-in-95 duration-200"
        >
          {/* 动态随时间变化的环境背光光晕层 */}
          <div
            className={`absolute -top-12 -left-12 -right-12 h-44 bg-gradient-to-b ${atmosphere.glow} blur-2xl pointer-events-none transition-all duration-700`}
          />

          {/* 顶部微标签栏（统一文案：场景时间 + 当前氛围描述） */}
          <div className="relative z-10 flex items-center justify-between text-[11px] text-white/50 px-1 pb-1">
            <span className="tracking-wide font-medium text-[11px] text-white/70">
              {t('sceneTimeCard.title', '场景时间')}
            </span>
            <span
              className="font-medium text-xs transition-colors duration-300"
              style={{ color: atmosphere.accent }}
            >
              {activePresetId === 'auto'
                ? `${t('sceneTimeCard.realTime', '实时')} · ${localizedAtmosphereLabel}`
                : localizedAtmosphereLabel}
            </span>
          </div>

          {/* 核心交互：SVG 半圆天体轨迹星盘 */}
          <div className="relative z-10 flex flex-col items-center my-1">
            <svg
              ref={svgRef}
              width="260"
              height="135"
              className="cursor-pointer overflow-visible select-none touch-none"
              onPointerDown={handlePointerDown}
            >
              <defs>
                {/* 昼夜光谱渐变轨道 */}
                <linearGradient id="skyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#312e81" />
                  <stop offset="22%" stopColor="#f472b6" />
                  <stop offset="50%" stopColor="#38bdf8" />
                  <stop offset="78%" stopColor="#fb923c" />
                  <stop offset="100%" stopColor="#312e81" />
                </linearGradient>
                {/* 天体光球发光滤镜 */}
                <filter id="celestialGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* 外圈细刻度虚线 */}
              <path
                d={`M ${cx - r - 10} ${cy} A ${r + 10} ${r + 10} 0 0 1 ${cx + r + 10} ${cy}`}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
                strokeDasharray="2 6"
              />

              {/* 轨道底槽 */}
              <path
                d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                fill="none"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="4"
                strokeLinecap="round"
              />

              {/* 昼夜光谱高亮轨迹 */}
              <path
                d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                fill="none"
                stroke="url(#skyGradient)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={Math.PI * r}
                strokeDashoffset={Math.PI * r * (1 - progress)}
              />

              {/* 地面地平线参考基线 */}
              <line
                x1="20"
                y1={cy}
                x2="240"
                y2={cy}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
              />
              <text x="24" y={cy + 14} className="fill-white/30 text-[9px] font-mono">00:00</text>
              <text x="118" y={cy + 14} className="fill-white/30 text-[9px] font-mono">12:00</text>
              <text x="212" y={cy + 14} className="fill-white/30 text-[9px] font-mono">24:00</text>

              {/* 天体拖拽手柄（太阳 / 月亮发光星体：拖拽时无过渡延迟，绝对 1:1 跟随） */}
              <g
                transform={`translate(${thumbX}, ${thumbY})`}
                className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
              >
                <circle
                  r="13"
                  fill={atmosphere.accent}
                  fillOpacity="0.3"
                  filter="url(#celestialGlow)"
                />
                <circle
                  r="7"
                  fill="#ffffff"
                  stroke={atmosphere.accent}
                  strokeWidth="3"
                />
              </g>
            </svg>

            {/* 星盘中央超大数字主视觉 */}
            <div className="absolute bottom-5 flex flex-col items-center pointer-events-none">
              <div className="font-mono text-3xl font-bold tracking-tight text-white drop-shadow-sm">
                {formatMinutesToString(minutes)}
              </div>
              <span className="text-[10px] text-white/40 tracking-wider mt-0.5 font-medium">
                {t('sceneTimeCard.fineTune', '时间调节')}
              </span>
            </div>
          </div>

          {/* 底部紧凑型 4 宫格分段控制器 Dock (选中项字体、底色与天体色实时联动) */}
          <div className="relative z-10 grid grid-cols-4 gap-1 mt-2.5 bg-black/40 p-1 rounded-xl border border-white/5">
            {PRESETS.map((item) => {
              const isSelected = activePresetId === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handlePresetClick(item)}
                  style={
                    isSelected
                      ? {
                        backgroundColor: `${atmosphere.accent}20`,
                        borderColor: `${atmosphere.accent}50`,
                        boxShadow: `0 0 16px ${atmosphere.accent}25`,
                      }
                      : undefined
                  }
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg transition-all duration-200 cursor-pointer ${isSelected
                    ? 'border'
                    : 'text-white/45 hover:text-white/80 hover:bg-white/5 border border-transparent'
                    }`}
                >
                  <Icon
                    className="w-4 h-4 mb-1.5 transition-colors"
                    style={{ color: isSelected ? atmosphere.accent : undefined }}
                    strokeWidth={isSelected ? 2.2 : 1.8}
                  />
                  <span
                    className="text-[11px] font-medium leading-tight transition-colors"
                    style={{ color: isSelected ? atmosphere.accent : undefined }}
                  >
                    {t(item.labelKey, item.defaultLabel)}
                  </span>
                  <span
                    className="text-[9px] font-mono mt-0.5 transition-colors"
                    style={{
                      color: isSelected ? atmosphere.accent : undefined,
                      opacity: isSelected ? 0.8 : 0.45,
                    }}
                  >
                    {item.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
