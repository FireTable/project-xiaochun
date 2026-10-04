/**
 * EmbedApp — /embed 精简入口: 只有 3D 画布 (+ 可选气泡 / ChatBar), 无 TopHeader / DevDrawer /
 * 更新弹窗 / 拖拽上传 / LoadingOverlay。模型加载进度走 postMessage (xc.load.progress), 由宿主画占位图。
 * 与 App.tsx 共用: SceneCanvas / HeadBubble / ChatBar / vrmEngine。
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
import { XC_UI_PARTS } from '@firetable/project-xiaochun/protocol';
import pkg from '../../package.json';
import { readEmbedParams } from './params';
import { readOutfitPref, resolveInitialOutfitWithPref, safeLocalStorage } from './registry';
import { WEARING_OUTFIT_KEY } from '@/lib/constants';
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
  const [bubble, setBubble] = useState<BubbleState>({
    visible: false, statusKey: '', speechText: '', isError: false, x: 0, y: 0,
  });

  useEffect(() => {
    setEmbedUiState(uiStateFromParts(params.uiParts));
    if (params.uiLegacy) console.warn('[xiaochun] ?ui=1/true and ?bubble= are deprecated; use ?ui=chat,bubble,outfit,scene');
    if (params.uiUnknown.length) console.warn(`[xiaochun] ignoring unknown ?ui= part(s): ${params.uiUnknown.join(', ')} (known: ${XC_UI_PARTS.join(', ')})`);
    if (params.lang) void i18n.changeLanguage(params.lang);
    vrmEngine.lockWheelZoom = !params.controls; // 默认放开 (controls=0 才锁)
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
      onLang: (lang) => void i18n.changeLanguage(lang),
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
      {ui.ui && <ChatBar isPetUIVisible onShowDevPanel={() => {}} />}
      {bridgeRef && (
        // 四角弧线: 只有宿主开了 resizable 才渲染 (组件内部按手势状态仓决定; 默认关闭时什么都不画)
        <Suspense fallback={null}><EmbedCorners /></Suspense>
      )}
      {bridgeRef && (ui.outfit || ui.scene) && (
        <Suspense fallback={null}>
          <EmbedPicker flags={{ outfit: ui.outfit, scene: ui.scene }} bridge={bridgeRef} />
        </Suspense>
      )}
    </div>
  );
};
