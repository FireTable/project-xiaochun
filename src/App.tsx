import React, { useState, useEffect, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoadingState, BubbleState } from '@/core/vrmEngine';
import { TopHeader } from '@/components/TopHeader';
import { HeadBubble } from '@/components/HeadBubble';
import { ChatBar } from '@/components/ChatBar';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { DevDrawer } from '@/components/DevDrawer';
import { XIAOCHUN_SYSTEM_PROMPT } from '@/llm/prompts';
import { resolveSystemPrompt, getCachedUserSettings, subscribeUserSettings } from '@/llm/userSettings';
import type { Lang } from '@/i18n';
import { APP_CONFIG } from '@/config';

const SceneCanvas = React.lazy(() =>
  import('@/components/SceneCanvas').then((m) => ({ default: m.SceneCanvas }))
);

export const App: React.FC = () => {
  const { t, i18n } = useTranslation();

  // dev 调试模式或 HMR 热更新时跳过 LoadingOverlay
  // 严格遵守 APP_CONFIG.dev.disableLoadingOverlayInDev 开关：若为 false 则说明需要调试遮罩，绝不盲目跳过
  const skipLoadingOverlay = Boolean(
    (import.meta.env.DEV && APP_CONFIG.dev.disableLoadingOverlayInDev) ||
    (APP_CONFIG.dev.disableLoadingOverlayInDev && typeof window !== 'undefined' && Boolean((window as any).__VRM_ALREADY_READY__))
  );

  const [loading, setLoading] = useState<LoadingState>(() => ({
    active: !skipLoadingOverlay,
    subtitleKey: skipLoadingOverlay ? '' : 'parsingModel',
    progress: skipLoadingOverlay ? 100 : 0,
  }));

  const [bubble, setBubble] = useState<BubbleState>({
    visible: false,
    statusKey: '',
    speechText: '',
    isError: false,
    x: 0,
    y: 0,
  });

  const isDev = import.meta.env.DEV || (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname));
  // ponytail: 抽屉开关状态记到 localStorage,刷新后保持原样,调试不用每次手动打开。
  const [isDrawerOpen, setIsDrawerOpen] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('xiaochun_dev_drawer_open') === '1';
  });
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('xiaochun_dev_drawer_open', isDrawerOpen ? '1' : '0');
  }, [isDrawerOpen]);
  const [isDragOver, setIsDragOver] = useState(false);
  // ponytail: 10 次连击暗号触发后,生产构建也要能看见右上角调试按钮 — 用户已经
  // 「发现」了隐藏 dev 通道,继续藏按钮不合理。一次性解锁,刷新页面后重置。
  const [hasDevEasterEgg, setHasDevEasterEgg] = useState(false);

  useEffect(() => {
    let engineModule: typeof import('@/core/vrmEngine') | null = null;
    // ponytail: 闭包局部变量,不能在 engineModule(ESM namespace, 冻结)上挂属性 ——
    // prod 构建会抛 "Cannot assign to property '_unsubUserSettings'"。
    let unsubUserSettings: (() => void) | null = null;

    import('@/core/vrmEngine').then((mod) => {
      engineModule = mod;
      // ponytail: 渲染循环不再被 LoadingOverlay suspend —— overlay 只是视觉遮罩,
      // 渲染从 startAnimation 一直跑,fitCamera + cinematicIntro 在 VRM 加载完后直接生效。
      // (推理降频等真正的节流仍走 chatDirector.onSuspendRendering。)
      mod.vrmEngine.resumeRendering();
      mod.vrmEngine.onLoadingChange = (state) => {
        if (skipLoadingOverlay && state.progress < 100) return;
        setLoading(state);
      };
      mod.vrmEngine.onReadyChange((ready) => {
        if (ready && typeof window !== 'undefined') (window as any).__VRM_ALREADY_READY__ = true;
      });
      // React 并发过渡：将气泡 UI 状态更新降级为非阻塞 transition，绝不阻塞主线程 3D 动画帧与交互
      mod.vrmEngine.onBubbleChange = (state) => {
        startTransition(() => {
          setBubble(state);
        });
      };
      // ponytail: 引擎内部 alert() / LLM 空输出兜底等走 t(),bindI18n 顺带同步给 chatDirector。
      mod.vrmEngine.bindI18n((key, vars) => i18n.t(key, vars));
      // ponytail: system prompt 按当前 i18n 语言挑;getter 里读 i18n.language 是反应式的,
      // 用户切换语言后下次 send 自动用新语言回答。
      // ponytail: 用 bindSystemContext — 同时返回 prompt + lang,避免 chatWorkflow 靠 prompt 反推 lang
      // (用户在 AdvancedSettings 改 prompt 后那个 trick 会失效)。override 由 userSettings 提供,
      // 没有 override 时按 lang 拿默认人设。
      const provideSystemContext = async () => {
        const lang = (i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN') as Lang;
        const prompt = resolveSystemPrompt(getCachedUserSettings(), lang);
        return { prompt, lang };
      };
      mod.vrmEngine.bindSystemContext(provideSystemContext);
      // ponytail: 旧 API 留个 fallback — 万一别的代码路径还调 getSystemPrompt,
      // 直接走 i18n 拿默认人设,不读 override(覆盖旧的 webllm 路径行为)。
      mod.vrmEngine.bindSystemPrompt(() => {
        const lang = (i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN') as Lang;
        return XIAOCHUN_SYSTEM_PROMPT[lang] ?? XIAOCHUN_SYSTEM_PROMPT['zh-CN'];
      });
      // ponytail: 用户在 AdvancedSettingsDialog 改了 override → cache 更新 → 重新 bind,
      // 保证下一次 generateSpeechReply 拿到新值。存到闭包变量,cleanup 时一起清。
      unsubUserSettings = subscribeUserSettings(() => {
        mod.vrmEngine.bindSystemContext(provideSystemContext);
      });
    });

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDragOver(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && file.name.toLowerCase().endsWith('.vrm')) {
        const url = URL.createObjectURL(file);
        engineModule?.vrmEngine.loadVRM(url, file.name);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      unsubUserSettings?.();
      engineModule?.vrmEngine.dispose();
    };
  }, [i18n]);

  return (
    <div id="app" className="relative w-full h-screen h-[100dvh] overflow-hidden bg-[#0b0f19]">
      {/* 3D Canvas (按需异步挂载，不阻塞首屏骨架) */}
      <React.Suspense fallback={<canvas id="vrm-canvas" className="absolute inset-0 w-full h-full block z-0" />}>
        <SceneCanvas />
      </React.Suspense>

      {/* 3D 角色头顶悬浮对话框 */}
      <HeadBubble state={bubble} />

      {/* 底部对话输入条 — 启动 splash 期间不渲染,避免跟 LoadingOverlay 重叠。
          之前 ChatBar tooltip 在 !isModelReady 时常驻,会跟启动动画叠在一起看着像两个页面。
          ponytail: 只用 `loading.active` 一个标志就够了,VRM ready 后 loading.active=false,
          ChatBar 这时候挂载,自带 tooltip 接管剩余的 LLM 下载/就绪提示。
          onShowDevPanel: 10 次连击暗号只解锁 hasDevEasterEgg — 让 TopHeader 上的 ⚙️
          按钮在生产构建里亮起来,面板本身要用户主动再点 ⚙️ 才打开。vconsole 仍由
          ChatBar 内部独立触发。 */}
      {!loading.active && <ChatBar onShowDevPanel={() => setHasDevEasterEgg(true)} />}

      {/* 模型加载进度遮罩 (dev 或 HMR 时彻底免除) */}
      {!skipLoadingOverlay && (
        <LoadingOverlay
          state={loading}
          onBreakStart={() => {
            import('@/core/vrmEngine').then((mod) => {
              // ponytail: cinematic 已经在 loadVRM 回调里触发过,这里只唤醒渲染循环
              // 让用户看到已经在飞的 tween —— 单一触发源,无双 tween。
              mod.vrmEngine.resumeRendering();
            });
          }}
        />
      )}

      {/* 顶部控制栏 */}
      <TopHeader
        isDev={isDev || hasDevEasterEgg}
        isDrawerOpen={isDrawerOpen}
        onToggleDrawer={() => setIsDrawerOpen((prev) => !prev)}
      />

      {/* ponytail: DevDrawer 不再受 isDev 守卫 — 10 次连击暗号触发后,生产构建也要能
          拉出调试面板(只走 10 次连击路径,TopHeader 上的 dev 按钮仍受 isDev 隐藏)。 */}
      <DevDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />

      {/* 实时身高 3D 浮动指示线与 HUD 标牌 (头顶发光微点 + 科技感延伸指示线) */}
      <svg
        id="height-ruler-svg"
        className="fixed inset-0 pointer-events-none z-40 w-full h-full"
        style={{ display: 'none' }}
      >
        <defs>
          <filter id="ruler-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#e06d64" floodOpacity="0.8" />
          </filter>
        </defs>
        <path
          id="height-ruler-line"
          stroke="#e06d64"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          filter="url(#ruler-glow)"
        />
        <circle
          id="height-ruler-dot"
          r="3"
          fill="#ffffff"
          stroke="#e06d64"
          strokeWidth="1.5"
          filter="url(#ruler-glow)"
        />
      </svg>

      <div
        id="height-ruler-badge"
        className="fixed top-0 left-0 z-50 pointer-events-none will-change-transform transition-opacity duration-150 select-none flex items-center gap-1 font-bold text-white text-[11px] sm:text-xs px-2 py-0.5 rounded-md bg-brand-500/90 backdrop-blur-sm border border-brand-300/40 shadow-lg shadow-brand-500/30 tracking-wide"
        style={{ display: 'none', opacity: 0 }}
      >
        <span className="text-[10px] opacity-80 font-normal">📏</span>
        <span id="height-ruler-text">--.-cm</span>
      </div>

      {/* 拖拽上传提示层 */}
      {isDragOver && (
        <div id="drop-zone" className="drop-zone">
          <div className="drop-card">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p>{t('app.dropZoneHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
};
