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
import { HeadBubble } from '@/components/HeadBubble';
import { ChatBar } from '@/components/ChatBar';
import { APP_CONFIG } from '@/config';
import { XIAOCHUN_SYSTEM_PROMPT } from '@/llm/prompts';
import { resolveSystemPrompt, getCachedUserSettings, subscribeUserSettings } from '@/llm/userSettings';
import type { Lang } from '@/i18n';
import type { XcLang } from '@firetable/project-xiaochun/protocol';
import { XC_UI_PARTS, xcUiAutoHideActive } from '@firetable/project-xiaochun/protocol';
import { useCurrentScene } from '@/core/scene/sceneManager';
import { usePetUiVisibility } from '@/hooks/usePetUiVisibility';
import pkg from '../../package.json';
import { readEmbedParams } from './params';
import { readLangPref, readOutfitPref, resolveEmbedLang, resolveInitialOutfitWithPref, safeLocalStorage } from './registry';
import { EMBED_LANG_KEY, WEARING_OUTFIT_KEY } from '@/lib/constants';
import {
  getEmbedUiState,
  setEmbedUiState,
  startEmbedBridge,
  subscribeEmbedUi,
  uiStateFromParts,
  type EmbedBridge,
} from './bridge';

// 内置按钮只在 ?picker= 打开时才加载 (Radix 下拉等); 默认不开的宿主不为它多下一个字节
const EmbedCorners = lazy(() => import('./EmbedCorners').then((m) => ({ default: m.EmbedCorners })));
const EmbedPicker = lazy(() => import('./EmbedPicker').then((m) => ({ default: m.EmbedPicker })));

export const EmbedApp: React.FC = () => {
  const { i18n } = useTranslation();
  const params = useMemo(() => readEmbedParams(), []);
  const ui = useSyncExternalStore(subscribeEmbedUi, getEmbedUiState, getEmbedUiState);
  const [bridgeRef, setBridgeRef] = useState<EmbedBridge | null>(null);
  // ── 内置界面"点击出现" (与 Tauri 桌宠共用 usePetUiVisibility / ClickDetector): 只在 uiAutoHide 对当前场景生效时才监听 ──
  const scene = useCurrentScene();
  const autoHide = xcUiAutoHideActive(ui.autoHide, Boolean(scene.isTransparent));
  const hasChrome = ui.ui || ui.outfit || ui.scene || ui.lang || ui.github;
  const { isPetUIVisible } = usePetUiVisibility(autoHide && hasChrome);
  const [bubble, setBubble] = useState<BubbleState>({
    visible: false, statusKey: '', speechText: '', isError: false, x: 0, y: 0,
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

    // ── 协议桥 ──
    const bridge: EmbedBridge = startEmbedBridge({
      params,
      version: pkg.version,
      onLang: applyLang,
      getLang: () => (i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN') as XcLang,
      initialOutfit: initial?.id ?? null,
    });
    setBridgeRef(bridge);
    vrmEngine.onLoadingChange = (s) => bridge.reportProgress(s);
    vrmEngine.onSwapProgress = (s) => bridge.reportProgress(s);

    // ── 加载初始模型 (主站由 TopHeader 负责; embed 无 TopHeader, 这里补上) ──
    // 稍作延后, 让出主线程给 canvas 初始化。
    const url = initial ? initial.entry.source : APP_CONFIG.model.defaultSource;
    const name = initial ? initial.entry.name : APP_CONFIG.model.defaultName;
    const timer = setTimeout(() => {
      vrmEngine.swapOutfit(url, name)
        .then(() => bridge.reportLoaded(name, initial?.id ?? null))
        .catch((e) => console.error('[embed] initial model load failed:', e));
    }, 120);

    return () => {
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
      <SceneCanvas />
      {ui.bubble && <HeadBubble state={bubble} />}
      {ui.ui && <ChatBar isPetUIVisible={isPetUIVisible} autoHide={autoHide} onShowDevPanel={() => {}} />}
      {bridgeRef && (
        // 四角弧线: 只有宿主开了 resizable 才渲染 (组件内部按手势状态仓决定; 默认关闭时什么都不画)
        <Suspense fallback={null}><EmbedCorners /></Suspense>
      )}
      {bridgeRef && (ui.outfit || ui.scene || ui.lang || ui.github) && (
        <Suspense fallback={null}>
          <EmbedPicker flags={{ outfit: ui.outfit, scene: ui.scene, lang: ui.lang, github: ui.github }} bridge={bridgeRef} autoHide={autoHide} petUiVisible={isPetUIVisible} />
        </Suspense>
      )}
    </div>
  );
};
