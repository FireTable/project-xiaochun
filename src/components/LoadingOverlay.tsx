import React, { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { canvasSizeFor, placeCanvas, snapToPixel } from './loading/pixelSnap';
import { useTranslation } from 'react-i18next';
import type { LoadingState } from '@/core/vrmEngine';
import { onLlmLoadProgress, getLlmLoadProgress } from '@/llm/progress';
import { APP_CONFIG } from '@/config';
import { readActiveModel, subscribeActiveModel, type ActiveModel } from '@/llm/activeModel';
import type { KeyvisualWarp } from './loading/keyvisualWarp';
import { loadingStore } from './loading/loadingStore';
import { isTauri, startWindowDragging } from '@/lib/platform';

// Module-level, so a remounted overlay (pending component -> App, StrictMode, HMR) reuses the loaded chunk at once.
let warpModule: Promise<typeof import('./loading/keyvisualWarp')> | null = null;
let warpModuleReady = false;
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// ponytail: SSR fallback state —— 当 LoadingOverlay 被注册成 router defaultPendingComponent
// 时,没有 state prop 也能渲染"启动期"的样子:VRM 解析中、progress 0。

interface LoadingOverlayProps {
  state?: LoadingState;
  onBreakStart?: () => void;
  onBreakComplete?: () => void;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ state, onBreakStart, onBreakComplete }) => {
  // Progress comes from the coalesced loadingStore (whole %, ≤ 10 Hz); a `state` prop still overrides it.
  const storeState = useSyncExternalStore(loadingStore.subscribe, loadingStore.get, loadingStore.getServer);
  const effectiveState = state ?? storeState;
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  // ponytail: 鼠标视差走 CSS 变量方案 — JS 只 setProperty('--mx'/'--my'),
  // 3 个元素的 transform 在 CSS 表达式里 calc(var(--mx) * Npx) 派生。
  // 比 ref 直写 style.transform 更省:
  //   1) 1 次 setProperty 替代 3 次 style.transform 写入
  //   2) 浏览器走 CSS custom property 优化路径,只在依赖该 prop 的元素上重算
  //   3) React 不知道 JS 写过 prop,组件 0 re-render
  // rAF + 缓存 rect 保留 — 解决 100+ Hz 鼠标事件 + layout query 成本。
  const pendingMouseRef = useRef<{ x: number; y: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const cachedRectRef = useRef<DOMRect | null>(null);
  const [isBreaking, setIsBreaking] = useState(false);
  const [hasExited, setHasExited] = useState(false);

  // ponytail: 订阅 LLM 下载进度,跟 VRM 进度一起显示在 NEURAL_DISPATCH 卡片里。
  // App.tsx 在 splash 期间不渲染 ChatBar,所以 LLM 进度只能在这里展示。
  // 早版无脑 setState — webLLM progress callback 高频触发(下载期多次/秒),
  // 整个 LoadingOverlay 跟着 re-render,跟 conic 动画 + backdrop-blur 抢 GPU。
  // 改成 100ms 节流 + 整数取整,数字跳得人眼看不出差别,但 re-render 频率砍到 10Hz。
  // SSR 与首帧 hydration 统一从 0 开始，挂载后再读取当前 LLM 进度，避免 hydration 文本不一致。
  const [llmPct, setLlmPct] = useState(0);
  useEffect(() => {
    const p = getLlmLoadProgress();
    setLlmPct(Math.round(Math.min(1, Math.max(0, p.progress)) * 100));
  }, []);
  const lastLlmFlushRef = useRef(0);
  const pendingLlmPctRef = useRef<number | null>(null);
  useEffect(() => {
    const flush = () => {
      lastLlmFlushRef.current = Date.now();
      if (pendingLlmPctRef.current !== null) {
        setLlmPct(pendingLlmPctRef.current);
        pendingLlmPctRef.current = null;
      }
    };
    const unsub = onLlmLoadProgress((p) => {
      const next = Math.round(Math.min(1, Math.max(0, p.progress)) * 100);
      pendingLlmPctRef.current = next;
      const elapsed = Date.now() - lastLlmFlushRef.current;
      if (elapsed >= 100) flush();
      else setTimeout(flush, 100 - elapsed);
    });
    return unsub;
  }, []);

  // 记录挂载时间，保证即使缓存秒开也有至少 1.2s 的视觉冲击力展示，防止一闪而过的糟糕体验
  const mountTimeRef = useRef<number>(Date.now());

  // 鼠标全景 3D 视差倾斜 (Parallax Tilt) — ref 直写 transform,不走 React state。
  // 缓存容器 rect — mousemove 期间不重算,只 resize/scroll 时刷新。
  const refreshRect = () => {
    cachedRectRef.current = containerRef.current?.getBoundingClientRect() ?? null;
  };
  useEffect(() => {
    refreshRect();
    window.addEventListener('resize', refreshRect);
    window.addEventListener('scroll', refreshRect, { passive: true });
    return () => {
      window.removeEventListener('resize', refreshRect);
      window.removeEventListener('scroll', refreshRect);
    };
  }, []);

  // 鼠标全景 3D 视差倾斜 (Parallax Tilt) — rAF 节流,每帧最多更新一次。
  // 高刷新率鼠标 / 触摸板可能 200+ Hz,mousemove 也对应触发,但合成层
  // 只按 vsync 渲染,中间事件全部丢,只保留最新的 x/y。
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!cachedRectRef.current) refreshRect();
    const rect = cachedRectRef.current!;
    pendingMouseRef.current = {
      x: (e.clientX - rect.left) / rect.width - 0.5,
      y: (e.clientY - rect.top) / rect.height - 0.5,
    };
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const p = pendingMouseRef.current;
      if (!p || !containerRef.current) return;
      // ponytail: 一次 setProperty 替代早版 3 次 style.transform 写入。
      // CSS 表达式在依赖该 prop 的元素上自动重算,合成层继续跑 transform。
      containerRef.current.style.setProperty('--mx', p.x.toString());
      containerRef.current.style.setProperty('--my', p.y.toString());
    });
  };

  // 触发 2D 破次元 -> 3D 舞台的入场爆发动效
  const triggerBreak = () => {
    if (isBreaking || hasExited) return;
    setIsBreaking(true);
    // 退场动画先在合成线程起跑，再通知外部开始重活（推镜/首帧渲染），
    // 避免两者挤在同一帧导致退场前的长帧卡顿。双 rAF ≈ 退场动画已提交到合成层。
    requestAnimationFrame(() => requestAnimationFrame(() => (onBreakStart ? onBreakStart() : loadingStore.breakStart())));
    setTimeout(() => {
      setHasExited(true);
      onBreakComplete?.();
    }, 1100);
  };


  // 当 VRM 引擎汇报加载完成 (progress === 100 且 active === false) 时，平滑进入破次元倒计时
  useEffect(() => {
    if (!effectiveState.active && effectiveState.progress >= 100 && !isBreaking && !hasExited) {
      const elapsed = Date.now() - mountTimeRef.current;
      const minDisplayDelay = Math.max(0, 1500 - elapsed);
      const timer = setTimeout(() => {
        triggerBreak();
      }, minDisplayDelay);
      return () => clearTimeout(timer);
    }
  }, [effectiveState.active, effectiveState.progress, isBreaking, hasExited]);

  // 当有新模型上传/重新开始加载时（例如从 TopHeader 上传新 VRM），重置状态重新展示
  useEffect(() => {
    if (effectiveState.active) {
      setHasExited(false);
      setIsBreaking(false);
      mountTimeRef.current = Date.now();
    }
  }, [effectiveState.active]);

  // 保持单调递增：UI 层面永远只增不减，彻底杜绝任何事件乱序导致进度条回退
  const maxProgressRef = useRef(0);
  useEffect(() => {
    if (effectiveState.active && effectiveState.progress === 0) {
      maxProgressRef.current = 0;
    }
  }, [effectiveState.active, effectiveState.progress]);

  const rawProgress = Math.min(100, Math.max(0, effectiveState.progress || 0));
  if (rawProgress > maxProgressRef.current) {
    maxProgressRef.current = rawProgress;
  }
  const progress = maxProgressRef.current;

  // 原神/星铁风格：分阶段着色器与管线动态文字
  const getStageText = () => {
    if (progress < 25) {
      return t('loading.madStage1Init');
    }
    if (progress < 60) {
      return t('loading.madShaderCompiling');
    }
    if (progress < 85) {
      return t('loading.madMeshDecoding');
    }
    if (progress < 100) {
      return t('loading.madMotionSync');
    }
    return t('loading.madPipelineReady');
  };

  // ponytail: VRM 加载完成后 vrmEngine 把 subtitleKey 置空(切到「ready」态),这时会
  // 显示空白 — 让 subtitle 兜底走 stageText(100% 时是「✦ 破次元管线准备就绪!」),
  // 保证从 2D 进入 3D 的过渡期内文案不丢。
  const subtitle = effectiveState.subtitleKey
    ? t(`loading.${effectiveState.subtitleKey}`, effectiveState.subtitleVars as Record<string, unknown> | undefined)
    : (progress >= 100 ? getStageText() : '');

  // 对话引擎状态：只有确实在下载/加载本地模型 (0<pct<100) 时显示百分比；
  // 自定义（远程）provider 显示已连接；其余用中性文案。activeModel 挂载后才读取（hydration 安全）。
  const [activeModel, setActiveModel] = useState<ActiveModel | null>(null);
  useEffect(() => {
    setActiveModel(readActiveModel());
    return subscribeActiveModel(setActiveModel);
  }, []);
  const llmLine = (() => {
    if (llmPct > 0 && llmPct < 100) return { text: t('loading.llmLoadingLocal', { percent: llmPct }), ready: false };
    if (activeModel?.kind === 'custom') return { text: t('loading.llmCustom'), ready: true };
    if (llmPct >= 100) return { text: t(activeModel?.kind === 'webllm' ? 'loading.llmReadyLocal' : 'loading.llmReady'), ready: true };
    return { text: t('loading.llmPreparing'), ready: false };
  })();

  // 状态行只显示一句话：引擎副标题优先，否则显示阶段文案（步骤由下方 chips 表达）。
  const stageText = subtitle || getStageText();

  // 轮播小贴士：纯展示，每 5s 切换，淡入用 opacity 动画，不影响布局。
  const tips = [t('loading.tip1'), t('loading.tip2'), t('loading.tip3', { count: Object.keys(APP_CONFIG.model.addons).length }), t('loading.tip4')];
  const [tipIndex, setTipIndex] = useState(0);
  useEffect(() => {
    if (hasExited) return;
    const id = window.setInterval(() => setTipIndex((i) => (i + 1) % 4), 5000);
    return () => window.clearInterval(id);
  }, [hasExited]);

  const pipelineMilestones = [
    { num: '01', name: t('loading.milestoneEngine'), threshold: 10 },
    { num: '02', name: t('loading.milestoneShader'), threshold: 35 },
    { num: '03', name: t('loading.milestoneMesh'), threshold: 65 },
    { num: '04', name: t('loading.milestoneMotion'), threshold: 95 },
  ];

  // 偶像出道海报风：静态背景 + 少量 transform/opacity 动画（合成层），无动画 blur/filter/backdrop。
  // 四芒星只放在画面边缘/顶部，避开标题、进度与提示区域（属于背景层）。
  const sparkles = [
    { l: '4%', t: '6%', s: 8, d: '0s' },
    { l: '48%', t: '3%', s: 6, d: '1.4s' },
    { l: '72%', t: '7%', s: 9, d: '2.2s' },
    { l: '94%', t: '14%', s: 7, d: '0.7s' },
    { l: '96%', t: '52%', s: 6, d: '3.1s' },
    { l: '2%', t: '30%', s: 5, d: '1.9s' },
    { l: '93%', t: '88%', s: 7, d: '2.8s' },
  ];

  return (
    <div
      id="loading-overlay"
      ref={containerRef}
      data-tauri-drag-region
      onMouseMove={handleMouseMove}
      onMouseDown={(e) => {
        // 允许在 Tauri 桌面端启动遮罩期间按住左键拖拽窗口位置
        if (e.button === 0 && isTauri()) {
          void startWindowDragging(e);
        }
      }}
      // ponytail: position/inset/z/background inline 写死,CSS 没编译完也保证遮盖 —— 否则
      // 早期 paint 帧会看到背后的 three.js clear color。
      // zIndex: 55 → 在 TopHeader (z-50) 之上;仍在 DevDrawer mobile (z-60) 之下。
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        backgroundColor: '#0b0710',
        ['--mx' as string]: 0,
        ['--my' as string]: 0,
        // 退场：只动 transform/opacity（内联 transform，避免 Tailwind v4 的 `scale` 属性不在 transition 列表里而瞬跳）；
        // 常驻 will-change 让根层提前合成，退场起跑时无需重新栅格化。
        opacity: isBreaking ? 0 : 1,
        transform: isBreaking ? 'scale(1.08)' : 'scale(1)',
        transition: 'opacity 900ms cubic-bezier(0.22, 0.61, 0.36, 1), transform 1100ms cubic-bezier(0.22, 0.61, 0.36, 1)',
        willChange: 'transform, opacity',
      } as React.CSSProperties}
      className={`xc-loading overflow-hidden select-none ${isBreaking ? 'pointer-events-none xc-paused' : ''} ${hasExited ? 'invisible' : ''}`}
    >
      {/* 夜空背景：静态渐变（不动画）+ 星点平铺 + 少量大块雾气只做 transform/opacity */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 26%, rgba(124,74,160,0.34) 0%, transparent 70%),' +
            'radial-gradient(45% 40% at 78% 70%, rgba(240,170,150,0.14) 0%, transparent 70%),' +
            'radial-gradient(50% 35% at 15% 95%, rgba(217,181,108,0.13) 0%, transparent 70%),' +
            'linear-gradient(180deg, #120a1a 0%, #0b0710 60%, #08050b 100%)',
        }}
      />
      <div aria-hidden className="xc-stars absolute inset-0 pointer-events-none" />
      <div aria-hidden className="xc-stars xc-stars--twinkle absolute inset-0 pointer-events-none" />
      <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
        <span className="xc-nebula xc-nebula--lav" />
        <span className="xc-nebula xc-nebula--rose" />
        <span className="xc-mist" />
      </div>
      {/* 斜向流光：一条渐变带 translate 扫过 */}
      <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="xc-sweep absolute -inset-y-1/4 -left-1/2 w-1/2" />
      </div>
      {/* 四芒星闪烁 */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        {sparkles.map((s, i) => (
          <svg
            key={i}
            className="xc-twinkle absolute text-[#f3dca0]/80"
            style={{ left: s.l, top: s.t, width: s.s * 2, height: s.s * 2, animationDelay: s.d }}
            viewBox="0 0 20 20"
          >
            <path d="M10 0 C10.8 7 13 9.2 20 10 C13 10.8 10.8 13 10 20 C9.2 13 7 10.8 0 10 C7 9.2 9.2 7 10 0Z" fill="currentColor" />
          </svg>
        ))}
      </div>

      {/* 主舞台：竖屏上图下文；md 以上左文右图 */}
      <div
        className="relative z-10 mx-auto flex h-full w-full max-w-6xl flex-col md:flex-row-reverse md:items-center"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        {/* 主视觉 */}
        <div className="relative h-[min(60%,calc(100%-330px))] md:h-full w-full md:w-[46%] lg:w-[50%] shrink-0 overflow-hidden md:overflow-visible pointer-events-none">
          {/* 背光圆环 */}
          <div
            aria-hidden
            className="absolute left-1/2 top-[4%] md:top-[14%] -translate-x-1/2 aspect-square h-[78%] md:h-[62%] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(255,236,214,0.28) 0%, rgba(246,206,186,0.16) 24%, rgba(150,100,170,0.10) 46%, transparent 70%)',
            }}
          />
          <div
            aria-hidden
            className="absolute left-1/2 top-[8%] md:top-[16%] -translate-x-1/2 aspect-square h-[70%] md:h-[56%] rounded-full border border-[#d9b56c]/25"
          />
          <div className="absolute inset-0 transition-transform duration-700 ease-out [transform:translate3d(calc(var(--mx,0)*-14px),calc(var(--my,0)*-8px),0)]">
            <HeroKeyvisual paused={isBreaking} exited={hasExited} />
          </div>
          {/* 竖排小字装饰（桌面） */}
          <div className="hidden md:block absolute right-2 top-1/2 -translate-y-1/2 [writing-mode:vertical-rl] text-[10px] tracking-[0.5em] text-[#d9b56c]/50 font-xc-sc">
            DEBUT · NO. 001
          </div>
        </div>

        {/* 文字 + 进度 */}
        <div className="xc-copy-panel relative z-20 -mt-[12%] md:mt-0 flex flex-1 min-w-0 flex-col items-center md:items-start justify-start md:justify-center px-6 md:pl-10 lg:pl-20 pb-5 md:pb-0 text-center md:text-left min-h-0">
          <span className="flex items-center gap-3 font-xc-sc text-[10px] md:text-[12px] tracking-[0.6em] text-[#dcc28a]/90">
            <span aria-hidden className="h-px w-6 md:w-8 bg-gradient-to-r from-transparent to-[#dcc28a]/80" />
            <span className="-mr-[0.6em]">PROJECT</span>
            <span aria-hidden className="h-px w-6 md:hidden bg-gradient-to-l from-transparent to-[#dcc28a]/80" />
          </span>
          <h1 className="xc-title font-xc-italic leading-[1.05] text-[54px] sm:text-[62px] md:text-[clamp(46px,6.4vw,104px)] max-w-full whitespace-nowrap -ml-[0.04em] mt-1.5 md:mt-2 pr-[0.12em]">
            XiaoChun
          </h1>
          <div className="mt-2.5 md:mt-4 flex items-center gap-2" aria-hidden>
            <span className="h-px w-12 md:w-16 bg-gradient-to-r from-transparent md:from-[#d9b56c]/20 to-[#d9b56c]" />
            <svg className="w-2.5 h-2.5 text-[#e8c97f]" viewBox="0 0 20 20">
              <path d="M10 0 C10.8 7 13 9.2 20 10 C13 10.8 10.8 13 10 20 C9.2 13 7 10.8 0 10 C7 9.2 9.2 7 10 0Z" fill="currentColor" />
            </svg>
            <span className="h-px w-12 md:hidden bg-gradient-to-l from-transparent to-[#d9b56c]" />
          </div>
          <p className="mt-2.5 md:mt-4 font-xc-cjk text-[14px] md:text-[18px] tracking-[0.18em] text-[#efe4ee]/80">
            {t('loading.tagline')}
          </p>

          {/* 进度 */}
          <div className="mt-5 md:mt-10 w-full max-w-[340px] md:max-w-[440px]">
            <div className="flex items-end justify-between gap-3">
              <span className="min-w-0 truncate text-[11px] tracking-wide text-[#e9d9f2]/70 text-left">
                {stageText}
              </span>
              <span className="font-xc-italic text-[26px] md:text-[30px] leading-none text-[#ecd08a] tabular-nums shrink-0">
                {progress}<span className="text-[0.6em] ml-0.5">%</span>
              </span>
            </div>
            <div className="relative mt-2 h-[3px] w-full rounded-full bg-white/10">
              {/* ponytail: fill 用 scaleX(合成层),不触发 layout。 */}
              <div
                className="absolute inset-0 rounded-full origin-left transition-transform duration-300 ease-out bg-[linear-gradient(90deg,#b892e8_0%,#f2b8a2_55%,#f3dca0_100%)]"
                style={{ transform: `scaleX(${Math.max(0.01, progress / 100)})` }}
              />
              {/* 光标星：独立 translateX,避免跟随 scaleX 变形 */}
              <div
                className="absolute inset-0 transition-transform duration-300 ease-out pointer-events-none"
                style={{ transform: `translateX(${Math.max(1, progress)}%)` }}
              >
                <svg className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#fff4d6]" viewBox="0 0 20 20">
                  <path d="M10 0 C10.8 7 13 9.2 20 10 C13 10.8 10.8 13 10 20 C9.2 13 7 10.8 0 10 C7 9.2 9.2 7 10 0Z" fill="currentColor" />
                </svg>
              </div>
            </div>

            {/* 四阶段里程碑 */}
            <div className="mt-3.5 grid grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(5.25rem,1fr))] gap-1.5">
              {pipelineMilestones.map((node, i) => {
                const isPassed = progress >= node.threshold;
                return (
                  <div
                    key={i}
                    className={`flex min-w-0 items-center justify-center md:justify-start gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors duration-300 ${isPassed
                      ? 'border-[#d9b56c]/60 bg-[#d9b56c]/10 text-[#f3dca0]'
                      : 'border-white/10 bg-white/[0.03] text-white/40'
                      }`}
                  >
                    <span className={`h-1 w-1 shrink-0 rotate-45 ${isPassed ? 'bg-[#f3dca0]' : 'bg-white/30'}`} />
                    <span className="font-xc-italic text-[10px] opacity-70">{node.num}</span>
                    <span className="truncate tracking-[0.2em]">{node.name}</span>
                  </div>
                );
              })}
            </div>

            {/* LLM 进度 + 提示 */}
            <div className="mt-3 flex items-center justify-center md:justify-start gap-2 text-[10px] text-white/45">
              <span className={`h-1 w-1 rotate-45 ${llmLine.ready ? 'bg-[#f3dca0]' : 'bg-white/30'}`} />
              <span className="text-[#e7cfa0]/80 tabular-nums">{llmLine.text}</span>
            </div>
            <p className="mt-1.5 h-[2.8em] text-[10.5px] leading-[1.4em] text-white/45 tracking-wide overflow-hidden">
              <span key={tipIndex} className="xc-tip inline-block">✦ {tips[tipIndex]}</span>
            </p>
          </div>
        </div>
      </div>

      {/* 底部署名 */}
      <div className="hidden md:flex absolute bottom-4 inset-x-0 justify-center font-xc-sc text-[10px] tracking-[0.4em] text-white/25 pointer-events-none z-20" suppressHydrationWarning>
        {/* i18n-ok: brand signature */}
        PROJECT XIAOCHUN · {new Date().getFullYear()}
      </div>
    </div>
  );
};

/**
 * Hero key visual (wrapper + img + warp canvas + warp lifecycle). Memoised with primitive props, so loading-progress
 * re-renders of the overlay never touch it and the warp effect never restarts.
 */
const HeroKeyvisual = React.memo(function HeroKeyvisual({ paused, exited }: { paused: boolean; exited: boolean }) {
  const { t } = useTranslation();
  // Key-visual warp (WebGL1, lazy chunk). The <img> is the first paint and the fallback. Once the browser has
  // decoded its chosen srcset candidate, the warp reuses that same element as the texture (no second download) and
  // swaps a canvas in over it (see docs/LOADING_OVERLAY.md §7.1). The warp pauses (freezes its last frame) during the exit zoom and is disposed on exit.
  const heroImgRef = useRef<HTMLImageElement>(null);
  const heroBoxRef = useRef<HTMLDivElement>(null);
  const heroCanvasRef = useRef<HTMLCanvasElement>(null);
  const warpRef = useRef<KeyvisualWarp | null>(null);
  const isBreakingRef = useRef(false);
  isBreakingRef.current = paused;
  // Layout effect: on a warm remount (pending component -> App, StrictMode, HMR) the cached warp inserts its canvas in
  // the same task as the commit, before paint. The img's visibility is only ever written
  // imperatively by the warp module (React renders no style prop on it, so it never overwrites it).
  useIsoLayoutEffect(() => {
    if (exited) return;
    const img = heroImgRef.current, box = heroBoxRef.current, cv = heroCanvasRef.current;
    if (!img || !box || !cv) return;
    // Before first paint: snap the wrapper to whole device pixels (img and canvas move together, no later raster
    // shift) and size the canvas backing store, so nothing about the layout changes at the swap.
    const prime = () => {
      snapToPixel(box);
      const [w, h, pad] = canvasSizeFor(box);
      placeCanvas(cv, w, pad);
      // After transferControlToOffscreen (worker warp) the worker owns the size; setting it here would throw.
      if (!cv.dataset.xcOffscreen && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; }
    };
    prime();
    if (!img.complete) img.addEventListener('load', prime, { once: true });
    // No pre-hide on a warm remount: hiding the img before the canvas has presented a frame would leave a blank
    // frame. The warp hides the img itself, two frames after its canvas is on screen.
    let cancelled = false;
    let timer = 0;
    const start = () => {
      if (cancelled) return;
      warpModule ??= import('./loading/keyvisualWarp').then((m) => { warpModuleReady = true; return m; });
      void warpModule
        .then((m) => m.startKeyvisualWarp(img, cv, '/materials/warp-mask.webp'))
        .then((w) => {
          if (cancelled) { w.dispose(); return; }
          warpRef.current = w;
          w.setPaused(isBreakingRef.current);
        })
        .catch(() => { /* keep the static image */ });
    };
    // On a remount the chunk is already loaded: start at once.
    // Start right after the next paint (double rAF) instead of a fixed 120 ms timer: the img has already loaded,
    // so the only reason to wait is to keep GL setup out of the overlay's first frame.
    const schedule = () => {
      if (warpModuleReady) start();
      else timer = requestAnimationFrame(() => { timer = requestAnimationFrame(start); });
    };
    if (img.complete && img.naturalWidth) schedule();
    else img.addEventListener('load', schedule, { once: true });
    return () => {
      cancelled = true;
      cancelAnimationFrame(timer);
      img.removeEventListener('load', schedule);
      img.removeEventListener('load', prime);
      warpRef.current?.dispose();
      warpRef.current = null;
    };
  }, [exited]);
  useEffect(() => {
    warpRef.current?.setPaused(paused);
  }, [paused]);

  return (
  <div className="xc-breathe absolute inset-x-0 top-[calc(env(safe-area-inset-top)+40px)] md:top-auto md:bottom-0 h-[138%] md:h-[96%] flex justify-center">
    <div ref={heroBoxRef} className="relative h-full">
    <img
      ref={heroImgRef}
      src="/materials/xiaochun_keyvisual-1000.webp"
      srcSet="/materials/xiaochun_keyvisual-1000.webp 619w, /materials/xiaochun_keyvisual.webp 991w"
      sizes="(min-width: 768px) 45vw, 92vw"
      alt={t('chat.characterName')}
      draggable={false}
      decoding="async"
      fetchPriority="high"
      onDragStart={(e) => e.preventDefault()}
      className="xc-hero-img h-full w-auto max-w-none object-contain object-top select-none"
    />
    {/* Warp canvas: rendered from first paint over the img (same box), invisible until the warp has presented
        frames; keyvisualWarp then flips canvas opacity 1 / img opacity 0 in one task. No mask/filter here. */}
    <canvas
      ref={heroCanvasRef}
      aria-hidden
      className="absolute inset-y-0 left-0 w-full h-full max-w-none opacity-0 pointer-events-none"
    />
    </div>
  </div>
  );
});
