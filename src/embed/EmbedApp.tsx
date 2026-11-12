/**
 * EmbedApp — /embed 精简入口: 只有 3D 画布 (+ 可选气泡 / ChatBar), 无 TopHeader / DevDrawer /
 * 更新弹窗 / 拖拽上传 / LoadingOverlay。模型加载进度走 postMessage (xc.load.progress), 由宿主画占位图。
 * 与 App.tsx 共用: SceneCanvas / HeadBubble / ChatBar / vrmEngine, 以及 "点击出现" 状态机 (usePetUiVisibility)。
 * 内置顶栏按钮 (EmbedPicker: 换装 / 换场景 / 语言 / GitHub) 与 ChatBar 的显示由 uiAutoHide 决定 (默认 'transparent' = 与 Tauri 桌宠一致)。
 */
import React, { lazy, startTransition, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { vrmEngine, type BubbleState } from '@/core/vrmEngine';
import { SceneCanvas } from '@/components/SceneCanvas';
import { ChatBubble } from '@/components/ChatBubble';
import { ChatBar } from '@/components/ChatBar';
import { APP_CONFIG } from '@/config';
import { XIAOCHUN_SYSTEM_PROMPT } from '@/llm/prompts';
import { resolveSystemPrompt, getCachedUserSettings, subscribeUserSettings } from '@/llm/userSettings';
import type { Lang } from '@/i18n';
import type { XcLang } from '@firetable/project-xiaochun/protocol';
import { XC_UI_PARTS, xcUiAutoHideActive } from '@firetable/project-xiaochun/protocol';
import { useCurrentScene, sceneManager } from '@/core/scene/sceneManager';
import { usePetUiVisibility } from '@/hooks/usePetUiVisibility';
import pkg from '../../package.json';
import { readEmbedParams } from './params';
import { readLangPref, readOutfitPref, resolveEmbedLang, resolveInitialOutfitWithPref, safeLocalStorage } from './registry';
import { EMBED_LANG_KEY, ONBOARDING_STORAGE_KEY, WEARING_OUTFIT_KEY } from '@/lib/constants';
import {
  getEmbedUiState,
  setEmbedUiState,
  startEmbedBridge,
  subscribeEmbedUi,
  uiStateFromParts,
  type EmbedBridge,
} from './bridge';
import { syncXiaoChunRuntimeState } from '@/core/protocol/runtimeState';
import { prologueStory } from '@/story/prologueStory';
import { storyDirectorEngine } from '@/story/storyEngine';
import { dataTransferHasImage, dispatchVisionDrop, isImageFile, isVisionDropActive } from '@/llm/visionDropBus';

// 内置按钮只在 ?picker= 打开时才加载 (Radix 下拉等); 默认不开的宿主不为它多下一个字节
const EmbedCorners = lazy(() => import('./EmbedCorners').then((m) => ({ default: m.EmbedCorners })));
const EmbedPicker = lazy(() => import('./EmbedPicker').then((m) => ({ default: m.EmbedPicker })));
const LoadingOverlay = lazy(() => import('@/components/LoadingOverlay').then((m) => ({ default: m.LoadingOverlay })));
import { StoryPlayer } from '@/components/story/StoryPlayer';
import { loadingStore } from '@/components/loading/loadingStore';

export const EmbedApp: React.FC = () => {
  const { i18n } = useTranslation();
  const params = useMemo(() => readEmbedParams(), []);
  const ui = useSyncExternalStore(subscribeEmbedUi, getEmbedUiState, getEmbedUiState);
  const [bridgeRef, setBridgeRef] = useState<EmbedBridge | null>(null);

  // ── 沉浸式新手剧情向导 (Act 0 序章) 与故事剧场状态 ──
  const [isOnboardingActive, setIsOnboardingActive] = useState<boolean>(() => params.onboarding);
  const [isStoryActive, setIsStoryActive] = useState<boolean>(() => Boolean(params.story));
  const isStoryOrOnboarding = isOnboardingActive || isStoryActive;

  // VRM 模型就绪状态：保证向导只在角色已渲染站立在舞台中时启动
  const [isVRMReady, setIsVRMReady] = useState(() => vrmEngine.isReady());
  const [loadingActive, setLoadingActive] = useState(false);

  useEffect(() => {
    return vrmEngine.onReadyChange((ready) => {
      setIsVRMReady(ready);
      if (ready && typeof window !== 'undefined') {
        (window as any).__VRM_ALREADY_READY__ = true;
        (window as any).vrmEngine = vrmEngine;
      }
    });
  }, []);

  // 支持外部事件或消息通道随时重温新手引导或进入故事剧场
  useEffect(() => {
    const handleOnboardingTrigger = () => {
      setIsOnboardingActive(true);
      void sceneManager.setScene('void', false);
      void storyDirectorEngine.playScript(prologueStory);
      bridgeRef?.reportOnboardingStart?.();
    };
    const handleStoryTrigger = (e?: Event) => {
      setIsStoryActive(true);
      const customScript = (e as CustomEvent)?.detail?.script || prologueStory;
      void storyDirectorEngine.playScript(customScript);
      bridgeRef?.reportStoryStart?.(customScript.id);
    };
    window.addEventListener('xc-trigger-onboarding', handleOnboardingTrigger);
    window.addEventListener('xc-trigger-story', handleStoryTrigger);
    return () => {
      window.removeEventListener('xc-trigger-onboarding', handleOnboardingTrigger);
      window.removeEventListener('xc-trigger-story', handleStoryTrigger);
    };
  }, [bridgeRef]);

  // 当宿主握手建立或初次进入故事时，立即向上层宿主上报 start 状态，保护 UI 沉浸感
  useEffect(() => {
    if (bridgeRef && isStoryOrOnboarding) {
      if (isOnboardingActive) bridgeRef.reportOnboardingStart?.();
      else if (isStoryActive) bridgeRef.reportStoryStart?.();
    }
  }, [bridgeRef, isStoryOrOnboarding, isOnboardingActive, isStoryActive]);

  // 跨进程/全局运行时状态同步
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__IS_ONBOARDING_ACTIVE__ = isStoryOrOnboarding;
    }
    void syncXiaoChunRuntimeState({
      onboardingActive: isStoryOrOnboarding,
      onboardingCompleted: !isStoryOrOnboarding,
      currentScene: sceneManager.getCurrentSceneId(),
    });
  }, [isStoryOrOnboarding]);
  // ── 内置界面"点击出现" (与 Tauri 桌宠共用 usePetUiVisibility / ClickDetector): 只在 uiAutoHide 对当前场景生效时才监听 ──
  const scene = useCurrentScene();
  const autoHide = xcUiAutoHideActive(ui.autoHide, Boolean(scene.isTransparent));
  const hasChrome = ui.ui || ui.outfit || ui.scene || ui.lang || ui.github;
  const { isPetUIVisible } = usePetUiVisibility(autoHide && hasChrome);
  const [bubble, setBubble] = useState<BubbleState>({
    visible: false, statusKey: '', speechText: '', isError: false, x: 0, y: 0, placement: 'top',
  });

  useEffect(() => {
    setEmbedUiState({ ...uiStateFromParts(params.uiParts), autoHide: params.uiAutoHide });
    if (params.uiLegacy) console.warn('[xiaochun] ?ui=1/true and ?bubble= are deprecated; use ?ui=chat,bubble,outfit,scene');
    if (params.uiUnknown.length) console.warn(`[xiaochun] ignoring unknown ?ui= part(s): ${params.uiUnknown.join(', ')} (known: ${XC_UI_PARTS.join(', ')})`);
    // 界面语言优先级: ?lang= / SDK lang > iframe 自己 localStorage 里用户选的 > 浏览器语言 > zh-CN
    const applyLang = (lang: XcLang) => { void i18n.changeLanguage(lang); document.documentElement.lang = lang; };
    applyLang(resolveEmbedLang(params.lang, readLangPref(safeLocalStorage(), EMBED_LANG_KEY), typeof navigator !== 'undefined' ? navigator.languages : []));
    vrmEngine.lockWheelZoom = !params.controls; // 默认放开 (controls=0 才锁)
    for (const w of params.cameraWarnings) console.warn(`[xiaochun] ${w}`);
    vrmEngine.setCameraConfig(params.camera); // 相机选项 (?cameraFov= 等): 模型加载前设置, 首次取景 / 推镜头直接按它来
    document.documentElement.classList.add('xc-embed');
    vrmEngine.interaction.guidesEnabled = true; // /embed 环境启用腰部转身光环与相机高度尺导轨
    const handleFirstUnlock = () => {
      vrmEngine.unlockAudio();
    };
    window.addEventListener('pointerdown', handleFirstUnlock, { capture: true, once: true });
    window.addEventListener('keydown', handleFirstUnlock, { capture: true, once: true });
    if (!params.onboarding && !params.story) {
      try { localStorage.setItem(ONBOARDING_STORAGE_KEY, '1'); } catch { /* ignore */ }
      (window as any).__IS_ONBOARDING_ACTIVE__ = false;
    } else {
      (window as any).__IS_ONBOARDING_ACTIVE__ = true;
    }

    // ── 引擎绑定 (与 App.tsx 同款: i18n / system prompt) ──
    vrmEngine.resumeRendering();
    vrmEngine.onBubbleChange = (s) => startTransition(() => setBubble(s));
    vrmEngine.bindI18n((key, vars) => i18n.t(key, vars));
    const provideSystemContext = async () => {
      const lang = (i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN') as Lang;
      return { prompt: resolveSystemPrompt(getCachedUserSettings(), lang), lang };
    };
    vrmEngine.bindSystemContext(provideSystemContext);
    vrmEngine.bindSystemPrompt(() => {
      const lang = (i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN') as Lang;
      return XIAOCHUN_SYSTEM_PROMPT[lang] ?? XIAOCHUN_SYSTEM_PROMPT['zh-CN'];
    });
    const unsubSettings = subscribeUserSettings(() => vrmEngine.bindSystemContext(provideSystemContext));

    // ── 初始服装: 优先级 URL / SDK 显式的 ?outfit= > iframe 自己 localStorage 里存的 > 默认 ──
    // ?outfit= 严格校验 (id 格式 + 只认自有键, 裸模 base 不开放), 非法回退默认并上报; 存的 id 不在白名单里就忽略并清掉。
    // 读存储全程 try/catch (第三方存储被分区 / 拦截时静默当作没有)。键沿用主站的 WEARING_OUTFIT_KEY。
    const addons = APP_CONFIG.model.addons as Record<string, { source: string; name: string; default?: boolean }>;
    const stored = params.outfit === null ? readOutfitPref(safeLocalStorage(), WEARING_OUTFIT_KEY, addons) : null;
    const initial = resolveInitialOutfitWithPref(addons, params.outfit, stored);

    if (params.enableLoadingOverlay) {
      loadingStore.init({ active: true, subtitleKey: 'parsingModel', progress: 0 });
      loadingStore.setBreakStartHandler(() => vrmEngine.resumeRendering());
      loadingStore.setBreakCompleteHandler(() => {
        bridge.reportSceneEntered();
      });
    }

    // ── 协议桥 ──
    const bridge: EmbedBridge = startEmbedBridge({
      params,
      version: pkg.version,
      onLang: applyLang,
      getLang: () => (i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN') as XcLang,
      initialOutfit: initial?.id ?? null,
    });
    setBridgeRef(bridge);
    vrmEngine.onLoadingChange = (s) => {
      bridge.reportProgress(s);
      setLoadingActive(s.active);
      if (params.enableLoadingOverlay) {
        loadingStore.set(s);
      }
    };
    vrmEngine.onSwapProgress = (s) => {
      bridge.reportProgress(s);
    };

    // ── 加载初始模型 (主站由 TopHeader 负责; embed 无 TopHeader, 这里补上) ──
    // 稍作延后, 让出主线程给 canvas 初始化。
    const url = initial ? initial.entry.source : APP_CONFIG.model.defaultSource;
    const name = initial ? initial.entry.name : APP_CONFIG.model.defaultName;
    const timer = setTimeout(() => {
      vrmEngine.swapOutfit(url, name)
        .then((applied) => {
          // applied === false: 被更新的换装请求顶掉, 这次什么都没换: 不上报已加载 / 不标记已穿 (由顶掉它的那次负责), 也不算错误
          if (applied !== false) bridge.reportLoaded(name, initial?.id ?? null);
        })
        .catch((e) => console.error('[embed] initial model load failed:', e));
    }, 120);

    const handleDragOver = (e: DragEvent) => {
      if (isVisionDropActive() && dataTransferHasImage(e.dataTransfer)) {
        e.preventDefault();
      }
    };
    const handleDrop = (e: DragEvent) => {
      if (!isVisionDropActive() || !dataTransferHasImage(e.dataTransfer)) return;
      e.preventDefault();
      const imageFiles = Array.from(e.dataTransfer?.files ?? []).filter(isImageFile);
      if (imageFiles.length > 0) {
        dispatchVisionDrop(imageFiles);
      }
    };
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('pointerdown', handleFirstUnlock, { capture: true });
      window.removeEventListener('keydown', handleFirstUnlock, { capture: true });
      vrmEngine.interaction.guidesEnabled = true;
      clearTimeout(timer);
      unsubSettings();
      vrmEngine.onLoadingChange = undefined;
      vrmEngine.onSwapProgress = undefined;
      vrmEngine.onBubbleChange = undefined;
      bridge.dispose();
      setBridgeRef(null);
    };
  }, [i18n, params]);

  return (
    <div id="app" className="relative w-full h-screen h-[100dvh] overflow-hidden">
      {params.enableLoadingOverlay && (
        <Suspense fallback={null}>
          <LoadingOverlay
            onBreakStart={() => {
              vrmEngine.resumeRendering();
            }}
            onBreakComplete={() => {
              bridgeRef?.reportSceneEntered();
            }}
          />
        </Suspense>
      )}
      <SceneCanvas />
      {ui.bubble && !isStoryOrOnboarding && <ChatBubble state={bubble} />}
      {ui.ui && !isStoryOrOnboarding && <ChatBar isPetUIVisible={isPetUIVisible} autoHide={autoHide} onShowDevPanel={() => {}} />}
      {bridgeRef && !isStoryOrOnboarding && (
        // 四角弧线: 只有宿主开了 resizable 才渲染 (组件内部按手势状态仓决定; 默认关闭时什么都不画)
        <Suspense fallback={null}><EmbedCorners /></Suspense>
      )}
      {bridgeRef && !isStoryOrOnboarding && (ui.outfit || ui.scene || ui.lang || ui.github) && (
        <Suspense fallback={null}>
          <EmbedPicker
            flags={{ outfit: ui.outfit, scene: ui.scene, lang: ui.lang, github: ui.github }}
            bridge={bridgeRef}
            autoHide={autoHide}
            petUiVisible={isPetUIVisible}
            scenesFilter={params.scenesFilter}
          />
        </Suspense>
      )}

      {/* 沉浸式小蠢故事导演引擎 · 试点剧场与新手引导 (Act 0 序章) */}
      {!loadingActive && isVRMReady && isStoryOrOnboarding && (
        <StoryPlayer
          script={prologueStory}
          onComplete={() => {
            setIsOnboardingActive(false);
            setIsStoryActive(false);
            void syncXiaoChunRuntimeState({ onboardingActive: false, onboardingCompleted: true });
            try {
              localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
              // 若用户在虚空场景提前跳过，自动回退到设定的场景或默认海滩场景
              if (sceneManager.getCurrentSceneId() === 'void') {
                void sceneManager.setScene(params.scene ?? APP_CONFIG.scenes.defaultSceneId, true);
              }
              // 清除 URL 中的 ?onboarding=1 或 ?story=1，防止刷新反复进入向导
              if (typeof window !== 'undefined' && (window.location.search.includes('onboarding=') || window.location.search.includes('story='))) {
                const url = new URL(window.location.href);
                url.searchParams.delete('onboarding');
                url.searchParams.delete('story');
                window.history.replaceState({}, '', url.toString());
              }
            } catch { /* ignore */ }
            bridgeRef?.reportStoryComplete?.(prologueStory.id);
            bridgeRef?.reportOnboardingComplete?.();
          }}
        />
      )}
    </div>
  );
};
