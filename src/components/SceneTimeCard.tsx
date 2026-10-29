import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock, MoonStar, Sunrise, Sun, Sunset, type LucideIcon } from 'lucide-react';
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

/** 根据分钟数获取动态天体氛围色、i18n 多语言配置与高饱和液态玻璃核心渐变 (每6小时一个对称时段) */
const getTimeAtmosphere = (totalMinutes: number) => {
  const hour = (((totalMinutes % 1440) + 1440) % 1440) / 60;

  // 03:00 ~ 09:00: 破晓晨曦 (以 06:00 为中心，粉紫朝霞、旭日初升)
  if (hour >= 3.0 && hour < 9.0) {
    return {
      labelKey: 'sceneTimeCard.atmospheres.dawn',
      defaultLabel: '破晓晨曦',
      badgeKey: 'sceneTimeCard.atmospheres.dawnBadge',
      defaultBadge: '破晓',
      accent: '#f472b6',
      glowGradient:
        'radial-gradient(circle at 50% 0%, rgba(244, 63, 94, 0.52) 0%, rgba(251, 146, 60, 0.28) 45%, transparent 80%)',
      icon: Sunrise,
    };
  }

  // 09:00 ~ 15:00: 烈日正午 (以 12:00 为中心，艳阳高照、晴空澄澈)
  if (hour >= 9.0 && hour < 15.0) {
    return {
      labelKey: 'sceneTimeCard.atmospheres.noon',
      defaultLabel: '烈日正午',
      badgeKey: 'sceneTimeCard.atmospheres.noonBadge',
      defaultBadge: '正午',
      accent: '#38bdf8',
      glowGradient:
        'radial-gradient(circle at 50% 0%, rgba(14, 165, 233, 0.46) 0%, rgba(250, 204, 21, 0.24) 45%, transparent 80%)',
      icon: Sun,
    };
  }

  // 15:00 ~ 21:00: 落日黄昏 (以 18:00 为中心，夕阳晚霞、落日熔金)
  if (hour >= 15.0 && hour < 21.0) {
    return {
      labelKey: 'sceneTimeCard.atmospheres.dusk',
      defaultLabel: '落日黄昏',
      badgeKey: 'sceneTimeCard.atmospheres.duskBadge',
      defaultBadge: '黄昏',
      accent: '#fb923c',
      glowGradient:
        'radial-gradient(circle at 50% 0%, rgba(249, 115, 22, 0.55) 0%, rgba(217, 70, 239, 0.28) 45%, transparent 80%)',
      icon: Sunset,
    };
  }

  // 21:00 ~ 03:00 (跨午夜): 幽邃凌晨 (以 00:00 为中心，星河清冷、深夜静谧)
  return {
    labelKey: 'sceneTimeCard.atmospheres.weeHours',
    defaultLabel: '幽邃凌晨',
    badgeKey: 'sceneTimeCard.atmospheres.weeHoursBadge',
    defaultBadge: '凌晨',
    accent: '#818cf8',
    glowGradient:
      'radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.48) 0%, rgba(168, 85, 247, 0.26) 45%, transparent 80%)',
    icon: MoonStar,
  };
};

interface PresetConfig {
  id: EnvironmentTimeMode;
  labelKey: string;
  defaultLabel: string;
  sub: string;
  icon: LucideIcon;
}

/** 5 宫格预设：自动排在第一，凌晨排在第二 (00:00)，每 6 小时一个点 */
const PRESETS: PresetConfig[] = [
  { id: 'auto', labelKey: 'sceneTimeCard.presets.auto', defaultLabel: '自动', sub: 'SYNC', icon: Clock },
  { id: 'weeHours', labelKey: 'sceneTimeCard.presets.weeHours', defaultLabel: '凌晨', sub: '00:00', icon: MoonStar },
  { id: 'dawn', labelKey: 'sceneTimeCard.presets.dawn', defaultLabel: '破晓', sub: '06:00', icon: Sunrise },
  { id: 'noon', labelKey: 'sceneTimeCard.presets.noon', defaultLabel: '正午', sub: '12:00', icon: Sun },
  { id: 'dusk', labelKey: 'sceneTimeCard.presets.dusk', defaultLabel: '黄昏', sub: '18:00', icon: Sunset },
];

/** 根据预设模式获取目标分钟数 */
const getPresetTargetMinutes = (presetId: EnvironmentTimeMode): number => {
  if (presetId === 'weeHours') return 0;
  if (presetId === 'dawn') return 6 * 60;
  if (presetId === 'noon' || presetId === 'day') return 12 * 60;
  if (presetId === 'dusk' || presetId === 'sunset') return 18 * 60;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

/** 按照时间差跨度动态计算流逝/倒流时长 (秒) */
const calcFlowDuration = (startMins: number, targetMins: number): number => {
  const diffHours = Math.abs(targetMins - startMins) / 60;
  if (diffHours < 0.05) return 0;
  // 基础起步 1.2s，每相隔 1 小时增加 0.22s：
  // 1 小时微调 ~1.4s，6 小时 ~2.5s，12 小时 ~3.8s
  return Math.min(3.8, Math.max(1.2, 1.2 + diffHours * 0.22));
};

export interface SceneTimeCardProps {
  /** 桌面桌宠模式时，是否跟随整体宠物 UI 的淡出淡入 */
  isPetUIVisible?: boolean;
}

export const SceneTimeCard: React.FC<SceneTimeCardProps> = ({ isPetUIVisible = true }) => {
  const { t } = useTranslation();
  const currentScene = useCurrentScene();
  const [engineSupported, setEngineSupported] = useState(() => vrmEngine.isEnvironmentTimeSupported());
  const isSupported = Boolean(currentScene.supportsTime || currentScene.components?.time || engineSupported);
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

  // 判定当前高亮的预设标签：严格根据每 6 小时对称窗口 (±3h) 实时动态联动
  const hourFloat = (((minutes % 1440) + 1440) % 1440) / 60;
  const isTransitioning = Boolean(transitionRef.current);
  const activePresetId: EnvironmentTimeMode =
    timeState.mode === 'auto' && !isTransitioning && !isDragging
      ? 'auto'
      : hourFloat >= 3.0 && hourFloat < 9.0
        ? 'dawn'
        : hourFloat >= 9.0 && hourFloat < 15.0
          ? 'noon'
          : hourFloat >= 15.0 && hourFloat < 21.0
            ? 'dusk'
            : 'weeHours';

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

  // 不支持时间流转的场景（由 scene.supportsTime / scene.components.time 接口约定）或透明桌宠模式不展示
  if (isTransparent || !isSupported) return null;

  // 常规 3D 场景始终常驻显示 (与 TopHeader 对齐：!isTransparent 始终展示)；
  // 仅在未来可能支持时间流转的透明桌宠场景下跟随 isPetUIVisible
  const isVisible = !isTransparent || isPetUIVisible;

  return (
    <div
      ref={cardRef}
      className={`fixed top-[72px] right-4 z-20 flex flex-col items-end select-none font-sans transition-opacity duration-300 ${
        isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* ── 顶部紧凑星盘微胶囊 (烟熏透光液态玻璃 + 晶莹高光，兼顾通透与高对比度) ── */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="group relative inline-flex items-center justify-center h-8 pl-3 pr-2.5 rounded-full cursor-pointer transition-all duration-300 select-none overflow-hidden"
        style={{
          background: expanded
            ? 'linear-gradient(135deg, rgba(30, 41, 59, 0.38) 0%, rgba(15, 23, 42, 0.46) 100%)'
            : 'linear-gradient(135deg, rgba(15, 23, 42, 0.26) 0%, rgba(2, 6, 23, 0.35) 100%)',
          backdropFilter: 'blur(24px) saturate(180%) contrast(105%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%) contrast(105%)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          borderTop: '1px solid rgba(255, 255, 255, 0.50)',
          boxShadow: expanded
            ? `inset 0 1.2px 1px 0 rgba(255, 255, 255, 0.55), inset 0 0 10px 0 ${atmosphere.accent}25, 0 8px 24px -4px rgba(0, 0, 0, 0.30)`
            : `inset 0 1px 1px 0 rgba(255, 255, 255, 0.40), inset 0 0 8px 0 ${atmosphere.accent}18, 0 4px 16px -2px rgba(0, 0, 0, 0.25)`,
        }}
        title={t('sceneTimeCard.title', '场景时间')}
      >
        {/* 胶囊内部清透液态微光 */}
        <div
          className="absolute inset-0 opacity-40 pointer-events-none transition-opacity duration-500 group-hover:opacity-60"
          style={{
            background: atmosphere.glowGradient,
          }}
        />

        {/* 顶部微透镜高光条 */}
        <div
          className="absolute top-0 left-2 right-2 h-[1px] pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.7), transparent)',
          }}
        />

        {/* 内容水平与垂直同心居中容器 (补偿顶部 2px 物理高光沉坠感与 Lucide 箭头右侧内置边距) */}
        <div className="relative z-10 flex items-center justify-center -translate-y-[1px]">
          {/* 天体时段矢量图标 */}
          <CurrentPillIcon
            className="w-3.5 h-3.5 shrink-0 block text-white transition-colors duration-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
            strokeWidth={2}
          />

          {/* 核心时间文字 (去除 tracking-wider 消除末尾字符产生的右偏间隙，两侧等宽间距 mx-2) */}
          <span className="font-mono text-xs font-semibold tracking-normal text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] tabular-nums leading-none select-none mx-2">
            {formatMinutesToString(minutes)}
          </span>

          {/* 折叠箭头 (使用 -ml-0.5 补偿 Lucide SVG 内部 25% 的内置留白，消除视觉右偏) */}
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 block text-white/75 group-hover:text-white transition-transform duration-300 -ml-0.5 ${
              expanded ? 'rotate-180 text-white' : ''
            }`}
            strokeWidth={2}
          />
        </div>
      </button>

      {/* ── 展开的天体轨迹星盘 HUD 卡片 (黄金半透明液态玻璃：通透折射背景 + 清晰高对比文字) ── */}
      {expanded && (
        <div
          className="mt-2.5 w-[288px] rounded-2xl p-4 relative overflow-hidden
                     text-white animate-in fade-in zoom-in-95 duration-200 select-none"
          style={{
            background:
              'linear-gradient(135deg, rgba(15, 23, 42, 0.26) 0%, rgba(2, 6, 23, 0.36) 100%)',
            backdropFilter: 'blur(28px) saturate(190%) contrast(105%)',
            WebkitBackdropFilter: 'blur(28px) saturate(190%) contrast(105%)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            borderTop: '1px solid rgba(255, 255, 255, 0.48)',
            boxShadow: `
              inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.45),
              inset 0 -1px 1px 0 rgba(255, 255, 255, 0.08),
              inset 0 0 28px 0 ${atmosphere.accent}20,
              0 20px 50px -10px rgba(0, 0, 0, 0.45),
              0 0 24px -6px ${atmosphere.accent}18
            `,
          }}
        >
          {/* 顶部液态玻璃透镜反射条 (Specular Rim Gleam) */}
          <div
            className="absolute -top-1 left-3 right-3 h-14 pointer-events-none rounded-t-2xl"
            style={{
              background:
                'linear-gradient(180deg, rgba(255, 255, 255, 0.20) 0%, rgba(255, 255, 255, 0.02) 45%, transparent 100%)',
              maskImage: 'radial-gradient(ellipse at 50% 0%, black 50%, transparent 85%)',
              WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%, black 50%, transparent 85%)',
            }}
          />

          {/* 内部高饱和液体流动光晕层 (柔和透亮，保留高清晰内容与通透背景) */}
          <div
            className="absolute -top-14 -left-12 -right-12 h-52 blur-3xl pointer-events-none transition-all duration-700"
            style={{
              background: atmosphere.glowGradient,
              opacity: 0.40,
            }}
          />

          {/* 顶部微标签栏（统一文案：场景时间 + 当前氛围描述） */}
          <div className="relative z-10 flex items-center justify-between text-[11px] text-white/50 px-1 pb-1">
            <span className="tracking-wide font-medium text-[11px] text-white/80 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
              {t('sceneTimeCard.title', '场景时间')}
            </span>
            <span
              className="font-medium text-xs transition-colors duration-300 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]"
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
                {/* 昼夜光谱渐变轨道 (四象限对称光谱: 00:00 凌晨 -> 06:00 破晓 -> 12:00 正午 -> 18:00 黄昏 -> 24:00 凌晨) */}
                <linearGradient id="skyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#4f46e5" />   {/* 00:00 凌晨幽靛 */}
                  <stop offset="25%" stopColor="#f43f5e" />  {/* 06:00 破晓玫瑰霞 */}
                  <stop offset="50%" stopColor="#0ea5e9" />  {/* 12:00 正午晴空蓝 */}
                  <stop offset="75%" stopColor="#f97316" />  {/* 18:00 黄昏炽烈橙 */}
                  <stop offset="100%" stopColor="#4f46e5" /> {/* 24:00 凌晨幽靛 */}
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
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
                strokeDasharray="2 6"
              />

              {/* 轨道底槽 */}
              <path
                d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                fill="none"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="4.5"
                strokeLinecap="round"
              />

              {/* 昼夜光谱高亮轨迹 */}
              <path
                d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                fill="none"
                stroke="url(#skyGradient)"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeDasharray={Math.PI * r}
                strokeDashoffset={Math.PI * r * (1 - progress)}
              />

              {/* 地面地平线参考基线与每6小时对称刻度 (增强对比度与阴影，清晰可辨) */}
              <line
                x1="20"
                y1={cy}
                x2="240"
                y2={cy}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
              />
              <text x="24" y={cy + 14} className="fill-white/60 text-[9px] font-mono drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">00:00</text>
              <text x="118" y={cy + 14} className="fill-white/60 text-[9px] font-mono drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">12:00</text>
              <text x="212" y={cy + 14} className="fill-white/60 text-[9px] font-mono drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">24:00</text>

              {/* 天体拖拽手柄（太阳 / 月亮发光星体：高饱和高光） */}
              <g
                transform={`translate(${thumbX}, ${thumbY})`}
                className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
              >
                <circle
                  r="14"
                  fill={atmosphere.accent}
                  fillOpacity="0.45"
                  filter="url(#celestialGlow)"
                />
                <circle
                  r="7.5"
                  fill="#ffffff"
                  stroke={atmosphere.accent}
                  strokeWidth="3.2"
                />
              </g>
            </svg>

            {/* 星盘中央超大数字主视觉 (加大字重与阴影，确保在任何背景下极度清晰) */}
            <div className="absolute bottom-5 flex flex-col items-center pointer-events-none">
              <div className="font-mono text-3xl font-bold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
                {formatMinutesToString(minutes)}
              </div>
              <span className="text-[10px] text-white/60 tracking-wider mt-0.5 font-medium drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
                {t('sceneTimeCard.fineTune', '时间调节')}
              </span>
            </div>
          </div>

          {/* 底部紧凑型 5 宫格分段控制器 Dock (微熏深磨砂槽，保证文字与图标对比度) */}
          <div
            className="relative z-10 grid grid-cols-5 gap-1 mt-2.5 p-1 rounded-xl"
            style={{
              background: 'rgba(0, 0, 0, 0.16)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.10)',
              borderTop: '1px solid rgba(255, 255, 255, 0.20)',
              boxShadow: 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.10)',
            }}
          >
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
                          backgroundColor: `${atmosphere.accent}18`,
                          borderColor: atmosphere.accent,
                          boxShadow: `0 0 12px ${atmosphere.accent}30`,
                        }
                      : undefined
                  }
                  className={`flex flex-col items-center justify-center py-2 px-0.5 rounded-lg transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? 'border'
                      : 'text-white/65 hover:text-white hover:bg-white/10 border border-transparent'
                  }`}
                >
                  <Icon
                    className="w-3.5 h-3.5 mb-1 transition-colors drop-shadow-sm"
                    style={{ color: isSelected ? atmosphere.accent : undefined }}
                    strokeWidth={isSelected ? 2.2 : 1.8}
                  />
                  <span
                    className="text-[10.5px] font-medium leading-tight transition-colors tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
                    style={{ color: isSelected ? atmosphere.accent : undefined }}
                  >
                    {t(item.labelKey, item.defaultLabel)}
                  </span>
                  <span
                    className="text-[8.5px] font-mono mt-0.5 transition-colors tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
                    style={{
                      color: isSelected ? atmosphere.accent : undefined,
                      opacity: isSelected ? 0.95 : 0.60,
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
