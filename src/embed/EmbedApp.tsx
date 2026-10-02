/**
 * EmbedApp — /embed 精简入口: 只有 3D 画布 (+ 可选气泡 / ChatBar), 无 TopHeader / DevDrawer /
 * 更新弹窗 / 拖拽上传 / LoadingOverlay。模型加载进度走 postMessage (xc.load.progress), 由宿主画占位图。
 * 与 App.tsx 共用: SceneCanvas / HeadBubble / ChatBar / vrmEngine。
 */
import React, { startTransition, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { vrmEngine, type BubbleState } from '@/core/vrmEngine';
import { SceneCanvas } from '@/components/SceneCanvas';
import { HeadBubble } from '@/components/HeadBubble';
import { ChatBar } from '@/components/ChatBar';
import { APP_CONFIG } from '@/config';
import { XIAOCHUN_SYSTEM_PROMPT } from '@/llm/prompts';
import { resolveSystemPrompt, getCachedUserSettings, subscribeUserSettings } from '@/llm/userSettings';
import type { Lang } from '@/i18n';
import pkg from '../../package.json';
import { readEmbedParams } from './params';
import {
  getEmbedUiState,
  setEmbedUiState,
  startEmbedBridge,
  subscribeEmbedUi,
  type EmbedBridge,
} from './bridge';

export const EmbedApp: React.FC = () => {
  const { i18n } = useTranslation();
  const params = useMemo(() => readEmbedParams(), []);
  const ui = useSyncExternalStore(subscribeEmbedUi, getEmbedUiState, getEmbedUiState);
  const [bubble, setBubble] = useState<BubbleState>({
    visible: false, statusKey: '', speechText: '', isError: false, x: 0, y: 0,
  });

  useEffect(() => {
    setEmbedUiState({ ui: params.ui, bubble: params.bubble });
    if (params.lang) void i18n.changeLanguage(params.lang);
    vrmEngine.lockWheelZoom = !params.controls;
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

    // ── 协议桥 ──
    const bridge: EmbedBridge = startEmbedBridge({
      params,
      version: pkg.version,
      onLang: (lang) => void i18n.changeLanguage(lang),
    });
    vrmEngine.onLoadingChange = (s) => bridge.reportProgress(s);
    vrmEngine.onSwapProgress = (s) => bridge.reportProgress(s);

    // ── 加载初始模型 (主站由 TopHeader 负责; embed 无 TopHeader, 这里补上) ──
    // 稍作延后, 让出主线程给 canvas 初始化; 不读 localStorage 里的服装偏好 (iframe 存储可能分区)。
    const addons = APP_CONFIG.model.addons as Record<string, { source: string; name: string; default?: boolean }>;
    const picked =
      (params.outfit && addons[params.outfit]) ||
      Object.values(addons).find((a) => a.default) ||
      null;
    const url = picked ? picked.source : APP_CONFIG.model.defaultSource;
    const name = picked ? picked.name : APP_CONFIG.model.defaultName;
    const timer = setTimeout(() => {
      vrmEngine.swapOutfit(url, name)
        .then(() => bridge.reportLoaded(name))
        .catch((e) => console.error('[embed] initial model load failed:', e));
    }, 120);

    return () => {
      clearTimeout(timer);
      unsubSettings();
      vrmEngine.onLoadingChange = undefined;
      vrmEngine.onSwapProgress = undefined;
      vrmEngine.onBubbleChange = undefined;
      bridge.dispose();
    };
  }, [i18n, params]);

  return (
    <div id="app" className="relative w-full h-screen h-[100dvh] overflow-hidden">
      <SceneCanvas />
      {ui.bubble && <HeadBubble state={bubble} />}
      {ui.ui && <ChatBar isPetUIVisible onShowDevPanel={() => {}} />}
    </div>
  );
};
