import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Radio, Music, Cpu } from 'lucide-react';
import type { LoadingState } from '@/core/vrmEngine';
import { onLlmLoadProgress, getLlmLoadProgress } from '@/llm/progress';

// ponytail: SSR fallback state —— 当 LoadingOverlay 被注册成 router defaultPendingComponent
// 时,没有 state prop 也能渲染"启动期"的样子:VRM 解析中、progress 0。
const DEFAULT_LOADING_STATE: LoadingState = {
  active: true,
  subtitleKey: 'parsingModel',
  progress: 0,
};

interface LoadingOverlayProps {
  state?: LoadingState;
  onBreakStart?: () => void;
  onBreakComplete?: () => void;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ state, onBreakStart, onBreakComplete }) => {
  const effectiveState = state ?? DEFAULT_LOADING_STATE;
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
  const [llmPct, setLlmPct] = useState(() => {
    const p = getLlmLoadProgress();
    return Math.round(Math.min(1, Math.max(0, p.progress)) * 100);
  });
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
    onBreakStart?.();
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

  if (hasExited) {
    return null;
  }

  const progress = Math.min(100, Math.max(0, effectiveState.progress || 0));

  // 原神/星铁风格：分阶段着色器与管线动态文字
  const getStageText = () => {
    if (progress < 25) {
      return `01/04 · ${t('loading.madStage1Init')}`;
    }
    if (progress < 60) {
      return `02/04 · ${t('loading.madShaderCompiling')}`;
    }
    if (progress < 85) {
      return `03/04 · ${t('loading.madMeshDecoding')}`;
    }
    if (progress < 100) {
      return `04/04 · ${t('loading.madMotionSync')}`;
    }
    return `✦ ${t('loading.madPipelineReady')}`;
  };

  const subtitle = effectiveState.subtitleKey
    ? t(`loading.${effectiveState.subtitleKey}`, effectiveState.subtitleVars as Record<string, unknown> | undefined)
    : '';

  const stageText = subtitle ? `${subtitle} // ${getStageText()}` : getStageText();

  const pipelineMilestones = [
    { name: `01 ${t('loading.milestoneEngine')}`, threshold: 10 },
    { name: `02 ${t('loading.milestoneShader')}`, threshold: 35 },
    { name: `03 ${t('loading.milestoneMesh')}`, threshold: 65 },
    { name: `04 ${t('loading.milestoneMotion')}`, threshold: 95 },
  ];

  return (
    <div
      id="loading-overlay"
      ref={containerRef}
      onMouseMove={handleMouseMove}
      // ponytail: position/inset/z/background inline 写死,CSS 没编译完也保证遮盖 —— 否则
      // 早期 paint 帧会看到背后的 three.js clear color。
      // --mx/--my 是视差源 — 子元素 transform 都通过 calc(var(--mx) * Npx) 派生,
      // JS 只 setProperty 这两个,3 个元素的 transform 浏览器自己重算,React 0 介入。
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        backgroundColor: '#0a0812',
        perspective: '1200px',
        // ponytail: 初始 0,JS 第一次 mousemove 时覆写。
        ['--mx' as string]: 0,
        ['--my' as string]: 0,
      } as React.CSSProperties}
      className={`overflow-hidden flex items-center justify-center pt-9 sm:pt-0 select-none transition-all duration-1000 ease-out ${isBreaking ? 'opacity-0 scale-125 filter blur-md pointer-events-none' : 'opacity-100 scale-100'
        }`}
    >
      {/* 1. 背景流光氛围：移动端使用 blur-3xl 降低 GPU 显存带宽压力，桌面端使用极光 blur */}
      <div
        className="absolute w-[22rem] sm:w-[38rem] h-[22rem] sm:h-[38rem] rounded-full bg-[#ea8377]/15 blur-3xl md:blur-[150px] pointer-events-none transition-transform duration-700 ease-out [transform:translate3d(calc(var(--mx,0)*-60px),calc(var(--my,0)*-60px),0)]"
      />
      <div
        className="absolute w-[20rem] sm:w-[36rem] h-[20rem] sm:h-[36rem] rounded-full bg-[#e06d64]/12 blur-3xl md:blur-[140px] pointer-events-none transition-transform duration-700 ease-out [transform:translate3d(calc(var(--mx,0)*60px),calc(var(--my,0)*60px),0)]"
      />

      {/* 2. 背景浮动点阵底纹 */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(234, 131, 119, 0.35) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />

      {/* 3. 动态斜向标语胶带 (Warning Cyber Tape，桌面端专属，避免遮挡移动端贴纸) */}
      <div className="hidden sm:block absolute -top-6 -right-16 rotate-12 z-10 pointer-events-none opacity-40 hover:opacity-100 transition-opacity">
        <div className="px-16 py-1.5 bg-[#ea8377] text-black font-black text-[10px] tracking-[0.3em] font-mono uppercase shadow-lg">
          // 100% IN-BROWSER AI ANIME COMPANION // WEBGPU ENGINE // ZERO BACKEND //
        </div>
      </div>

      {/* ─── 4. 多图层视差舞台容器 (Parallax Canvas) ─── */}
      <div
        className="relative z-20 w-full max-w-5xl h-full sm:h-[85vh] flex items-center justify-center transition-transform duration-300 ease-out [transform:rotateY(calc(var(--mx,0)*12deg))_rotateX(calc(var(--my,0)*-12deg))]"
      >
        {/* ─── 切图卡片 A (左上角，桌面端专属)：Retro Cyber-OS 终端切片 ─── */}
        <div
          className={`hidden md:block absolute top-4 left-4 sm:left-8 z-20 w-64 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/15 p-3.5 shadow-2xl transition-all duration-700 hover:scale-105 hover:border-[#ea8377]/50 will-change-transform ${isBreaking ? '-translate-x-96 -translate-y-96 opacity-0' : 'animate-[float-pulse-gentle_6.5s_ease-in-out_infinite]'
            }`}
          style={{ animationDelay: '0s' }}
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ea8377]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#f5aa9c]" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] font-mono text-white/50 ml-1.5">{t('loading.madSysTitle')}</span>
            </div>
            <Radio className="w-3 h-3 text-[#ea8377] animate-pulse" />
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-white/80">
            <span className="flex items-center gap-1.5 truncate pr-2">
              <Music className="w-3 h-3 text-[#f5aa9c] shrink-0" />
              <span className="truncate">{subtitle || t('loading.madBgmStatus')}</span>
            </span>
            <span className="text-[#f5aa9c] font-bold shrink-0 tabular-nums">{progress}%</span>
          </div>
          {/* ponytail: LLM 模型下载进度,跟 VRM 进度并排展示 */}
          <div className="flex items-center justify-between text-[11px] font-mono text-white/80 mt-1.5">
            <span className="flex items-center gap-1.5 truncate pr-2">
              <Cpu className="w-3 h-3 text-[#7c5cff] shrink-0" />
              <span className="truncate">LLM <span className="tabular-nums">{llmPct < 100 ? `${llmPct}%` : '✓'}</span></span>
            </span>
            <span className="text-white/40 text-[10px]">{t('loading.localInference')}</span>
          </div>
          {/* 音频跳动频谱柱 — 高度用 transform: scaleY 不用 height %,
            12 柱 × 10Hz 进度更新 = 120 layout/sec,改后 0 layout 全在合成层。 */}
          <div className="flex items-end gap-1 h-5 mt-2">
            {[40, 80, 55, 95, 30, 70, 85, 45, 90, 60, 75, 50].map((h, i) => (
              <div
                key={i}
                className="flex-1 bg-gradient-to-t from-[#ea8377] to-[#f5aa9c] rounded-t origin-bottom"
                style={{
                  height: '100%',
                  transform: `scaleY(${Math.max(0.15, (h * (progress || 30)) / 100 / 100)})`,
                  animation: `pulse 1.2s ease-in-out infinite`,
                  animationDelay: `${i * 0.1}s`
                }}
              />
            ))}
          </div>
        </div>

        {/* ─── 浮动小配饰 4 (左上角)：赛博机能爱心护目镜 (放大尺寸，细节清晰) ─── */}
        <div
          className={`absolute left-2 sm:left-[308px] top-4 sm:top-6 -rotate-6 sm:rotate-0 z-25 transition-all duration-700 hover:scale-125 hover:rotate-6 cursor-pointer group will-change-transform select-none ${isBreaking ? '-translate-y-96 opacity-0 scale-50' : 'animate-[float-drift-mobile_3.2s_ease-in-out_infinite] md:animate-[float-drift_7.2s_ease-in-out_infinite]'
            }`}
          style={{ animationDelay: '0.4s' }}
        >
          <div className="w-[82px] h-[52px] sm:w-28 sm:h-28 drop-shadow-[0_12px_24px_rgba(234,131,119,0.45)] select-none">
            <img
              src="/materials/xiaochun_glasses.png"
              alt="机能护目镜"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              className="w-full h-full object-contain filter drop-shadow-[0_4px_10px_rgba(0,0,0,0.4)] pointer-events-none select-none"
            />
          </div>
        </div>

        {/* ─── 切图卡片 B (右上角)：小蠢 Q 版挥手贴纸 (贴纸群主角 Hero Sticker，特大醒目) ─── */}
        <div
          className={`absolute top-5 sm:top-0 right-2 sm:right-6 -rotate-6 sm:rotate-0 z-30 transition-all duration-700 hover:scale-110 cursor-pointer will-change-transform select-none ${isBreaking ? 'translate-x-96 -translate-y-96 opacity-0' : 'animate-[float-bob-mobile_2.8s_ease-in-out_infinite] md:animate-[float-bob_5.8s_ease-in-out_infinite]'
            }`}
        >
          <div className="relative select-none">
            {/* 对话气泡 (移动端与桌面端均展示：精致圆润气泡，蠢蠢欲动，安全距离不被顶栏裁切) */}
            <div className="flex absolute -top-2 sm:-top-6 -left-12 sm:-left-10 px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-full sm:rounded-2xl bg-white text-black font-bold text-[10px] sm:text-xs shadow-2xl border border-black/10 items-center gap-1 whitespace-nowrap animate-bounce pointer-events-none z-30">
              <span>{t('loading.madBubbleSticker')}</span>
              <Heart className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#ea8377] fill-[#ea8377] shrink-0" />
            </div>
            {/* Q 版独立模切贴纸 */}
            <div className="w-24 h-24 sm:w-40 sm:h-40 md:w-48 md:h-48 drop-shadow-[0_16px_32px_rgba(0,0,0,0.55)] select-none">
              <img
                src="/materials/xiaochun_chibi.png"
                alt="小蠢贴纸"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                className="w-full h-full object-contain filter drop-shadow-[0_6px_16px_rgba(234,131,119,0.35)] pointer-events-none select-none"
              />
            </div>
          </div>
        </div>

        {/* ─── 核心主体卡片 (居中)：小蠢全息二次元卡牌 (头部向上破框 + 炫彩流光边框) ─── */}
        <div
          className={`relative z-20 flex flex-col items-center transition-all duration-1000 group select-none ${isBreaking ? 'scale-150 filter brightness-150 blur-sm' : ''
            }`}
        >
          {/* 卡牌主容器：保持 overflow-visible 允许头部突破破框 */}
          <div className="relative w-[260px] sm:w-72 lg:w-80 h-[340px] sm:h-[380px] lg:h-[400px]">

            {/* 1. 卡牌边框外壳与流光层：自身 overflow-hidden 裁切旋转流光与背景底板 */}
            <div className="absolute inset-0 p-1.5 rounded-[32px] overflow-hidden shadow-[0_20px_60px_rgba(234,131,119,0.3)] group-hover:shadow-[0_30px_100px_rgba(234,131,119,0.65)] transition-all duration-500 z-10">

              {/* 常态静态渐变边框底层 */}
              <div className="absolute inset-0 rounded-[32px] bg-gradient-to-b from-white/30 via-[#ea8377]/40 to-[#e06d64]/40 backdrop-blur-2xl transition-opacity duration-500 group-hover:opacity-0" />

              {/* ponytail: 360° 旋转流光边框常驻 — 不再 hover 才触发,跟 three.js 渲染并行
                不会增加额外 transform 负担(动画在 GPU compositor 层,只跑 opacity/transform)。
                早期版本用 transparent 段做"呼吸感",但旋转后缺口会扫过可见区,出现
                断流;改用连续色相 + 均匀节奏,任何角度都有光。 */}
              <div
                className="absolute -inset-[100%] pointer-events-none opacity-100 animate-stream-rotate will-change-transform"
                style={{
                  background: `conic-gradient(from 0deg, #ea8377 0deg, #ffffff 30deg, #f5aa9c 60deg, #e06d64 90deg, #ea8377 120deg, #ffffff 150deg, #f5aa9c 180deg, #e06d64 210deg, #ea8377 240deg, #ffffff 270deg, #f5aa9c 300deg, #e06d64 330deg, #ea8377 360deg)`
                }}
              />

              {/* 边缘流光外溢光晕倍增层 */}
              <div
                className="absolute -inset-2 pointer-events-none opacity-0 group-hover:opacity-80 transition-opacity duration-500 blur-xl"
                style={{
                  background: `radial-gradient(circle, rgba(234, 131, 119, 0.6) 0%, transparent 70%)`
                }}
              />

              {/* 卡牌内胆底板 */}
              <div className="relative w-full h-full rounded-[26px] bg-[#16101c] overflow-hidden border border-white/10 flex flex-col justify-between p-4">
                {/* 底纹与微光 */}
                <div className="absolute inset-0 bg-gradient-to-b from-[#ea8377]/10 via-transparent to-[#16101c]" />
                <div
                  className="absolute inset-0 opacity-15"
                  style={{
                    backgroundImage: `radial-gradient(circle, rgba(234, 131, 119, 0.4) 1px, transparent 1px)`,
                    backgroundSize: '16px 16px',
                  }}
                />

                {/* 卡牌顶栏小装饰 */}
                <div className="flex items-center justify-between z-10 pointer-events-none">
                  <span className="px-2.5 py-0.5 rounded-full bg-black/70 backdrop-blur-md border border-white/20 text-[10px] font-mono text-[#ea8377] font-bold shadow">
                    {t('loading.madBadge')}
                  </span>
                  <span className="text-[10px] font-mono text-white/50 tracking-widest bg-black/40 backdrop-blur-md px-2 py-0.5 rounded-full">
                    NO. 001 // XIAOCHUN
                  </span>
                </div>
              </div>
            </div>

            {/* 2. 核心立绘角色层：上方突破上方框线 (-top-20)，左/右/下严格按照内胆圆角(rounded-b-[26px])裁剪 */}
            <div
              className="absolute inset-x-1.5 bottom-1.5 pointer-events-none z-20 flex items-end justify-center rounded-b-[26px] overflow-hidden select-none"
              style={{
                top: '-80px',
                borderTopLeftRadius: 0,
                borderTopRightRadius: 0,
              }}
            >
              <div className="relative w-full h-[calc(100%-6px)] origin-bottom scale-105 drop-shadow-[0_15px_30px_rgba(0,0,0,0.6)] select-none">
                <img
                  src="/materials/xiaochun_character.png"
                  alt="小蠢原画"
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  className="w-full h-full object-contain object-bottom filter drop-shadow-[0_0_20px_rgba(234,131,119,0.4)] pointer-events-none select-none"
                />
              </div>
            </div>

            {/* 3. 卡牌底部半透渐变与铭牌 (浮于角色胸前) */}
            <div className="absolute inset-x-4 bottom-4 z-30 flex flex-col text-left pointer-events-none bg-black/60 backdrop-blur-md p-3 rounded-2xl border border-white/10 select-none shadow-xl">
              <span className="text-[10px] font-mono tracking-widest text-[#ea8377] font-semibold">
                {t('loading.madCardRole')}
              </span>
              <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {t('loading.madCardName')}
              </h3>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-[9px] font-mono text-[#f5aa9c]">
                  {t('loading.madTagHair')}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white/10 text-[9px] font-mono text-[#f5aa9c]">
                  {t('loading.madTagWebGpu')}
                </span>
              </div>
            </div>

          </div>

          {/* ─── 原神/星铁风格超感光轨加载控制台 (Genshin-style Loading Pipeline Console) ─── */}
          <div className="mt-5 sm:mt-6 w-[260px] sm:w-[320px] lg:w-[360px] flex flex-col items-center gap-2 sm:gap-2.5 z-30">

            {/* 顶栏：实时阶段文本 + 发光百分比 (固定端到端宽度，杜绝内容变化导致的尺寸缩放) */}
            <div className="w-full flex items-center justify-between text-xs font-mono px-0.5">
              <div className="flex items-center gap-2 text-white/85 min-w-0 flex-1">
                <span className="inline-block w-2 h-2 rounded-full bg-[#ea8377] animate-ping shrink-0" />
                <span className="text-[11px] font-medium text-[#f5aa9c] tracking-wide truncate">
                  {stageText}
                </span>
              </div>
              <span className="text-sm font-black font-mono text-[#ea8377] tracking-wider shrink-0 ml-2 drop-shadow-[0_0_8px_rgba(234,131,119,0.8)]">
                {progress}%
              </span>
            </div>

            {/* 原神光轨进度条 (固定长度，不随文字或状态缩短) */}
            <div className="relative w-full h-2.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 p-[2px] shadow-inner overflow-visible">
              {/* ponytail: 进度条 fill 用 transform: scaleX 而不是 width —
                scaleX 是 GPU 合成层唯一属性,不会触发 layout/paint,跟 conic
                流光同跑在合成层互不干扰。transform-origin: left 让缩放从左到右。 */}
              <div
                className="relative h-full rounded-full bg-gradient-to-r from-[#ea8377] via-[#f5aa9c] to-white origin-left transition-transform duration-300 ease-out shadow-[0_0_14px_rgba(234,131,119,0.9)] will-change-transform"
                style={{ transform: `scaleX(${Math.max(0.01, progress / 100)})` }}
              >
                {/* 原神菱形星芒光标 (Diamond Light Runner) —— 紧锁在进度条最顶端前沿 (right-0 translate-x-1/2) */}
                <div
                  className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 rotate-45 bg-white border border-[#ea8377] shadow-[0_0_14px_#ffffff] pointer-events-none z-10"
                />
              </div>
            </div>

            {/* 元素/管线四阶段微章里程碑 (Pipeline Milestones) */}
            <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-0.5 text-[9px] font-mono">
              {pipelineMilestones.map((node, i) => {
                const isPassed = progress >= node.threshold;
                return (
                  <div
                    key={i}
                    className={`flex min-w-0 items-center justify-center gap-1 py-1.5 px-2 rounded-md border transition-all duration-300 ${isPassed
                      ? 'bg-[#ea8377]/15 border-[#ea8377]/50 text-[#f5aa9c] font-bold shadow-[0_0_10px_rgba(234,131,119,0.2)]'
                      : 'bg-white/5 border-white/10 text-white/40 font-normal'
                      }`}
                  >
                    <span className={`w-1 h-1 shrink-0 rounded-full ${isPassed ? 'bg-[#ea8377]' : 'bg-white/30'}`} />
                    <span className="truncate">{node.name}</span>
                  </div>
                );
              })}
            </div>

            {/* 原神 Tips 提示微文字 */}
            <p className="text-[10px] text-white/40 font-sans tracking-wide text-center mt-1 truncate max-w-xs sm:max-w-md">
              {t('loading.madGenshinProgressHint')}
            </p>
          </div>
        </div>

        {/* ─── 浮动小配饰 1 (左侧中上方偏高)：猫耳赛博麦克风 (放大尺寸，细节与文字醒目) ─── */}
        <div
          className={`absolute left-1 sm:left-10 top-[34%] sm:top-1/2 -translate-y-1/2 sm:-translate-y-20 rotate-12 sm:rotate-0 z-25 sm:z-30 transition-all duration-700 hover:scale-125 hover:rotate-8 cursor-pointer group will-change-transform select-none ${isBreaking ? '-translate-x-96 opacity-0 rotate-45' : 'animate-[float-sway-mobile_2.4s_ease-in-out_infinite] md:animate-[float-sway_4.6s_ease-in-out_infinite]'
            }`}
          style={{ animationDelay: '0.2s' }}
        >
          <div className="relative select-none">
            <div className="w-[72px] h-[72px] sm:w-36 sm:h-36 drop-shadow-[0_12px_24px_rgba(234,131,119,0.45)] select-none">
              <img
                src="/materials/xiaochun_mic.png"
                alt="麦克风小配饰"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                className="w-full h-full object-contain filter drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)] pointer-events-none select-none"
              />
            </div>
            <span className="absolute -bottom-1 -right-1 px-2 py-0.5 rounded-md bg-black/80 border border-white/20 text-[9px] sm:text-[10px] font-mono font-bold text-[#f5aa9c] shadow pointer-events-none select-none">
              MIC ON
            </span>
          </div>
        </div>

        {/* ─── 浮动小配饰 2 (右侧中下方偏低)：猫爪星空珍珠奶茶 (放大尺寸，饱满层次) ─── */}
        <div
          className={`absolute right-1 sm:right-10 top-[54%] sm:top-1/2 -translate-y-1/2 sm:-translate-y-24 -rotate-12 sm:rotate-0 z-25 sm:z-30 transition-all duration-700 hover:scale-125 hover:-rotate-8 cursor-pointer group will-change-transform select-none ${isBreaking ? 'translate-x-96 opacity-0 -rotate-45' : 'animate-[float-orbit-mobile_2.9s_ease-in-out_infinite] md:animate-[float-orbit_6.8s_ease-in-out_infinite]'
            }`}
          style={{ animationDelay: '1.2s' }}
        >
          <div className="relative select-none">
            <div className="w-[82px] h-[82px] sm:w-36 sm:h-36 drop-shadow-[0_12px_24px_rgba(234,131,119,0.45)] select-none">
              <img
                src="/materials/xiaochun_drink.png"
                alt="奶茶小配饰"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                className="w-full h-full object-contain filter drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)] pointer-events-none select-none"
              />
            </div>
            <span className="absolute -bottom-1 -left-1 px-2 py-0.5 rounded-md bg-black/80 border border-white/20 text-[9px] sm:text-[10px] font-mono font-bold text-[#f5aa9c] shadow pointer-events-none select-none">
              ENERGY+
            </span>
          </div>
        </div>

        {/* ─── 切图卡片 C (左下角，桌面端专属)：台词气泡卡片 ─── */}
        <div
          className={`hidden md:block absolute bottom-6 left-2 sm:left-10 z-20 w-64 sm:w-72 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/15 p-4 shadow-2xl transition-all duration-700 hover:scale-105 will-change-transform select-none ${isBreaking ? '-translate-x-96 translate-y-96 opacity-0' : 'animate-[float-bob_7.5s_ease-in-out_infinite]'
            }`}
          style={{ animationDelay: '3.1s' }}
        >
          <div className="flex items-center gap-2 mb-2 select-none">
            <span className="w-2 h-2 rounded-full bg-[#ea8377]" />
            <span className="text-xs font-bold text-[#ea8377]">{t('loading.madVoiceBeaconTitle')}</span>
          </div>
          <p className="text-xs text-white/90 tracking-wide leading-relaxed font-sans select-none">
            {t('loading.madVoiceBeaconQuote')}
          </p>
        </div>

        {/* ─── 浮动小配饰 3 (右下侧角落)：像素赛博爱心勋章 (放大至60px，饱满醒目，侧倾有型) ─── */}
        <div
          className={`absolute right-3.5 sm:right-84 bottom-7 sm:bottom-2 -rotate-6 sm:rotate-0 z-25 transition-all duration-700 hover:scale-125 hover:rotate-12 cursor-pointer group will-change-transform select-none ${isBreaking ? 'translate-y-96 opacity-0 scale-50' : 'animate-[float-drift-mobile_2.6s_ease-in-out_infinite] md:animate-[float-drift_5.2s_ease-in-out_infinite]'
            }`}
          style={{ animationDelay: '0.8s' }}
        >
          <div className="w-[60px] h-[60px] sm:w-24 sm:h-24 drop-shadow-[0_12px_24px_rgba(234,131,119,0.4)] select-none">
            <img
              src="/materials/xiaochun_badge.png"
              alt="爱心勋章"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              className="w-full h-full object-contain filter drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)] pointer-events-none select-none"
            />
          </div>
        </div>

        {/* ─── 切图卡片 D (右下角，桌面端专属)：系统监控终端 ─── */}
        <div
          className={`hidden md:block absolute bottom-6 right-2 sm:right-10 z-20 w-64 sm:w-72 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/15 p-4 shadow-2xl transition-all duration-700 hover:scale-105 will-change-transform ${isBreaking ? 'translate-x-96 translate-y-96 opacity-0' : 'animate-[float-sway_6.2s_ease-in-out_infinite]'
            }`}
          style={{ animationDelay: '2.7s' }}
        >
          <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-white/10 text-[10px] font-mono text-white/50">
            <span>NEURAL_DISPATCH</span>
            <span className="text-[#ea8377]">ONLINE</span>
          </div>
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ea8377] animate-ping" />
            <span className="text-[11px] font-mono text-white/90 truncate">
              {subtitle}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-[10px] font-mono text-white/60">
            <div className="p-1.5 rounded bg-white/5 border border-white/5">FPS: 60 MAX</div>
            <div className="p-1.5 rounded bg-white/5 border border-white/5">VRAM: LOCAL</div>
          </div>
        </div>
      </div>

      {/* 底部版权 */}
      <div className="hidden sm:flex absolute bottom-4 inset-x-0 justify-center text-[10px] font-mono text-white/30 pointer-events-none z-20">
        PROJECT XIAOCHUN // ANIME MAD DYNAMIC PRELOADER // 2026.9
      </div>
    </div>
  );
};
