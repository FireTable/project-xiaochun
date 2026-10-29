import React, { useState, useEffect, useCallback, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoadingState, BubbleState } from '@/core/vrmEngine';
import { TopHeader } from '@/components/TopHeader';
import { SceneTimeCard } from '@/components/SceneTimeCard';
import { AppUpdateDialog } from '@/components/AppUpdateDialog';
import { ChatBubble } from '@/components/ChatBubble';
import { ChatBar } from '@/components/ChatBar';
import { loadingStore } from '@/components/loading/loadingStore';

// The dev drawer (hundreds of radix sliders) is mounted even while closed; memoised so App re-renders during chat /
// loading (status, bubbles) no longer re-render it (60–80 ms per commit in dev).
const DevDrawerHost = React.memo(DevDrawer);
import { DevDrawer } from '@/components/dev-drawer';
import { SceneCanvas } from '@/components/SceneCanvas';
import { ONBOARDING_STORAGE_KEY } from '@/components/onboarding/OnboardingTour';
import { StoryPlayer } from '@/components/story/StoryPlayer';
import { storyDirectorEngine } from '@/story/storyEngine';
import { storyGenerator } from '@/story/storyGenerator';
import { prologueStory } from '@/story/prologueStory';

import { XIAOCHUN_SYSTEM_PROMPT } from '@/llm/prompts';
import { resolveSystemPrompt, getCachedUserSettings, subscribeUserSettings } from '@/llm/userSettings';
import { DEV_DRAWER_OPEN_KEY } from '@/lib/constants';
import type { Lang } from '@/i18n';
import { APP_CONFIG } from '@/config';
import { sceneManager, useCurrentScene } from '@/core/scene/sceneManager';
import { usePetUiVisibility } from '@/hooks/usePetUiVisibility';
import { initProtocolListener } from '@/core/protocol';
import { isDev } from '@/lib/utils';

export const App: React.FC = () => {
  const { t, i18n } = useTranslation();
  const currentScene = useCurrentScene();

  // dev 调试模式或 HMR 热更新时跳过 LoadingOverlay
  // 严格遵守 APP_CONFIG.dev.disableLoadingOverlayInDev 开关：若为 false 则说明需要调试遮罩，绝不盲目跳过
  const skipLoadingOverlay = Boolean(
    (isDev() && APP_CONFIG.dev.disableLoadingOverlayInDev) ||
    (APP_CONFIG.dev.disableLoadingOverlayInDev && typeof window !== 'undefined' && Boolean((window as any).__VRM_ALREADY_READY__))
  );

  // Only `active` lives in App state: per-report progress goes to loadingStore (coalesced, overlay-only subscriber),
  // so progress updates no longer re-render the whole App and stall the hero warp.
  const [loadingActive, setLoadingActive] = useState<boolean>(() => {
    const init: LoadingState = {
      active: !skipLoadingOverlay,
      subtitleKey: skipLoadingOverlay ? '' : 'parsingModel',
      progress: skipLoadingOverlay ? 100 : 0,
    };
    loadingStore.init(init);
    return init.active;
  });

  const [bubble, setBubble] = useState<BubbleState>({
    visible: false,
    statusKey: '',
    speechText: '',
    isError: false,
    x: 0,
    y: 0,
    placement: 'top',
  });

  // ponytail: 抽屉开关状态记到 localStorage,刷新后保持原样,调试不用每次手动打开。
  const [isDrawerOpen, setIsDrawerOpen] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(DEV_DRAWER_OPEN_KEY) === '1';
  });
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DEV_DRAWER_OPEN_KEY, isDrawerOpen ? '1' : '0');
  }, [isDrawerOpen]);

  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);
  const [isDragOver, setIsDragOver] = useState(false);
  // ponytail: 10 次连击暗号触发后,生产构建也要能看见右上角调试按钮 — 用户已经
  // 「发现」了隐藏 dev 通道,继续藏按钮不合理。一次性解锁,刷新页面后重置。
  const [hasDevEasterEgg, setHasDevEasterEgg] = useState(false);

  // 沉浸式新人引导向导状态：首次进入或 URL 带 ?onboarding=1 时触发
  const [isOnboardingActive, setIsOnboardingActive] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('onboarding') === '1') {
      return true;
    }
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) !== '1';
  });

  // VRM 模型就绪状态：保证向导只在角色已渲染站立在舞台中时启动
  const [isVRMReady, setIsVRMReady] = useState(() => {
    if (typeof window !== 'undefined' && Boolean((window as any).__VRM_ALREADY_READY__)) {
      return true;
    }
    return false;
  });

  // 故事导演引擎剧场模式状态
  const [isStoryActive, setIsStoryActive] = useState(false);
  const isStoryOrOnboarding = isOnboardingActive || isStoryActive;

  // 支持外部事件或菜单随时重温新手引导或进入故事剧场
  useEffect(() => {
    const handleTrigger = () => {
      setIsOnboardingActive(true);
      void sceneManager.setScene('void', false);
      void storyDirectorEngine.playScript(prologueStory);
    };
    const handleStoryTrigger = () => {
      setIsStoryActive(true);
      void storyDirectorEngine.playScript(prologueStory);
    };
    window.addEventListener('xc-trigger-onboarding', handleTrigger);
    window.addEventListener('xc-trigger-story', handleStoryTrigger);
    return () => {
      window.removeEventListener('xc-trigger-onboarding', handleTrigger);
      window.removeEventListener('xc-trigger-story', handleStoryTrigger);
    };
  }, []);
  const showDevUi = isDev() || hasDevEasterEgg;

  useEffect(() => {
    const isDevOpen = isDrawerOpen && showDevUi && !isStoryOrOnboarding;
    if (typeof window !== 'undefined' && (window as any).vrmEngine) {
      (window as any).vrmEngine.setDevDrawerOpen(isDevOpen);
    }
  }, [isDrawerOpen, showDevUi, isStoryOrOnboarding]);

  // 外部协议调用 (Deep Link / Single-Instance / 调试桥接) 监听初始化
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    initProtocolListener().then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let engineModule: typeof import('@/core/vrmEngine') | null = null;
    // ponytail: 闭包局部变量,不能在 engineModule(ESM namespace, 冻结)上挂属性 ——
    // prod 构建会抛 "Cannot assign to property '_unsubUserSettings'"。
    let unsubUserSettings: (() => void) | null = null;
    let unsubReady: (() => void) | null = null;

    import('@/core/vrmEngine').then((mod) => {
      engineModule = mod;
      if (typeof window !== 'undefined') {
        (window as any).vrmEngine = mod.vrmEngine;
        (window as any).sceneManager = sceneManager;
        (window as any).storyDirectorEngine = storyDirectorEngine;
        (window as any).storyGenerator = storyGenerator;
        (window as any).triggerStory = () => setIsStoryActive(true);
      }
      // ponytail: 渲染循环不再被 LoadingOverlay suspend —— overlay 只是视觉遮罩,
      // 渲染从 startAnimation 一直跑,fitCamera + cinematicIntro 在 VRM 加载完后直接生效。
      // 后台页 visibilitychange 由 vrmEngine 自行 suspend/resume。
      mod.vrmEngine.resumeRendering();
      // ponytail: cinematic 已经在 loadVRM 回调里触发过,overlay 开始退场时只唤醒渲染循环。
      loadingStore.setBreakStartHandler(() => mod.vrmEngine.resumeRendering());
      mod.vrmEngine.onLoadingChange = (state) => {
        if (skipLoadingOverlay && state.progress < 100) return;
        loadingStore.set(state);
        setLoadingActive(state.active);
      };
      unsubReady = mod.vrmEngine.onReadyChange((ready) => {
        setIsVRMReady(ready);
        if (ready && typeof window !== 'undefined') {
          (window as any).__VRM_ALREADY_READY__ = true;
          (window as any).vrmEngine = mod.vrmEngine;
          (window as any).sceneManager = sceneManager;
        }
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
        // ponytail: 走 swapOutfit — 拖入文件也保留当前镜头/动作/视线。
        engineModule?.vrmEngine.swapOutfit(url, file.name).catch((e) => {
          console.error('[App] drop swap failed:', e);
        });
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
      unsubReady?.();
    };
  }, [i18n]);

  // ── 桌宠透明模式：点击人物主体触发 UI 唤起与收起 ──
  const isTransparent = Boolean(currentScene.isTransparent);
  const { isPetUIVisible } = usePetUiVisibility(isTransparent);

  // ponytail: 3D 引导轨 (TurnGuide + PitchGuide + CameraYGuide) 全部由 InteractionController
  // 直接管 keydown/keyup + 修饰键检测, 不再走 App.tsx 这层 useState (React state batch 滞后
  // 会让快按 / 快松修饰键时漏掉 cameraYGuide)。

  return (
    <div id="app" className="relative w-full h-screen h-[100dvh] overflow-hidden">
      {/* 3D Canvas (按需异步挂载，不阻塞首屏骨架) */}
      <SceneCanvas />

      {/* ponytail: 3D 场景里的虚线高度尺 + 相机高度指示 (按修饰键显示, 由 vrmEngine.cameraYGuide 控制可见性) */}



      {/* 3D 角色头顶悬浮对话框：PC 维持头顶跟随气泡；移动端隐藏头顶气泡转由 ChatBar 顶部电影条承接。
          两者都属于 chat 范围: 受「显示对话字幕」设置 (showChatDialogue) 控制, 且语音结束后消失；
          故事 / 新手引导走 StoryPlayer 自己的电影条, 不受该设置影响。 */}
      {currentScene.components.headBubble !== false && !isStoryOrOnboarding && (
        <div className="hidden sm:block">
          <ChatBubble state={bubble} variant="bubble" />
        </div>
      )}

      {/* 底部对话输入条 — 启动 splash 期间及故事/向导期间不渲染；Mobile Chat 模式下在顶部槽位渲染电影条 */}
      {!loadingActive && !isStoryOrOnboarding && currentScene.components.chatBar !== false && (
        <ChatBar
          isPetUIVisible={isPetUIVisible}
          isDevDrawerOpen={isDrawerOpen && showDevUi && !isStoryOrOnboarding}
          onShowDevPanel={() => setHasDevEasterEgg(true)}
          topSlot={
            <div className="block sm:hidden w-full pb-1.5 pointer-events-auto">
              <ChatBubble
                state={bubble}
                variant="cinematic"
                dialogueScope="chat"
                isStatic
                placement="bottom"
                maxWidthClass="max-w-full"
              />
            </div>
          }
        />
      )}

      {/* 沉浸式小蠢故事导演引擎 · 试点剧场与序章 */}
      {!loadingActive && isVRMReady && isStoryOrOnboarding && (
        <StoryPlayer
          onComplete={() => {
            setIsOnboardingActive(false);
            setIsStoryActive(false);
            try {
              localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
              // 若用户在虚空场景提前跳过，自动回退到默认海滩场景
              if (sceneManager.getCurrentSceneId() === 'void') {
                void sceneManager.setScene(APP_CONFIG.scenes.defaultSceneId, true);
              }
              // 清除 URL 中的 ?onboarding=1，防止刷新反复进入向导
              if (typeof window !== 'undefined' && window.location.search.includes('onboarding=')) {
                const url = new URL(window.location.href);
                url.searchParams.delete('onboarding');
                window.history.replaceState({}, '', url.toString());
              }
            } catch { }
          }}
        />
      )}

      {/* 模型加载进度遮罩由 routes/index.tsx 单实例渲染，App 通过 loadingStore 驱动 */}

      <AppUpdateDialog allowPrompt={!loadingActive} />

      {/* 顶部控制栏 — 始终挂载以维持模型冷启与换装，故事/向导期间视觉隐藏 */}
      {(currentScene.components.topHeader !== false || isStoryOrOnboarding) && (
        <div className={isStoryOrOnboarding ? 'hidden' : undefined}>
          <TopHeader
            isDev={showDevUi}
            isDrawerOpen={isDrawerOpen && showDevUi}
            isPetUIVisible={isPetUIVisible}
            onToggleDrawer={() => setIsDrawerOpen((prev) => !prev)}
          />
        </div>
      )}

      {/* 场景时间卡片 (独立浮窗，位于 TopHeader 下方；依据当前场景是否支持时间系统决定是否挂载，故事/向导期间隐藏避让) */}
      {!isStoryOrOnboarding && Boolean(currentScene.supportsTime || currentScene.components.time) && (
        <SceneTimeCard isPetUIVisible={isPetUIVisible} />
      )}

      {/* 生产包默认不露抽屉；10 次连击后 hasDevEasterEgg 打开同一套面板。故事与向导期间不遮挡 */}
      <DevDrawerHost
        isOpen={isDrawerOpen && showDevUi && !isStoryOrOnboarding}
        onClose={closeDrawer}
      />

      {/* 实时身高 3D 浮动指示线与 HUD 标牌 (头顶发光微点 + 科技感延伸指示线) */}
      {currentScene.components.heightRuler !== false && (
        <>
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
        </>
      )}

      {/* 拖拽上传提示层 */}
      {isDragOver && currentScene.components.dropZone !== false && (
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
