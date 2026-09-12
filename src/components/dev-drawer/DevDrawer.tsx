import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { vrmEngine } from '@/core/vrmEngine';
import { APP_CONFIG, type BodyMorphConfig } from '@/config';
import type { MaterialSaturationSettings } from '@/core/vrmEngine';
import { X, Sliders, RotateCcw, Copy, Check } from '@/components/icons';
import { SectionRenderer } from './renderer';
import { SECTIONS } from './schema';
import { useCollapse } from './hooks/useCollapse';
import { DevDrawerContext } from './context';
import { HeightChip } from './components/HeightChip';
import {
  loadDevDrawerSettings,
  saveDevDrawerSettings,
  clearAllDevDrawerStorage,
} from './storage';

interface DevDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * DevDrawer 壳:吸顶 header(身高 chip + 复制/重置/关闭) + 可滚动 SectionRenderer 列表。
 * ponytail: 壳不持有任何 section 专属 state — 各段组件自己持有,setState 不会互相
 * 打断;移动端 slider 拖动只重渲对应段,drawer 其它部分完全静止。
 */
export const DevDrawer: React.FC<DevDrawerProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [collapsed, toggleCollapsed] = useCollapse();
  const [copied, setCopied] = useState(false);
  // ponytail: 全局重置信号 — 自增后所有 SectionRenderer 因 key 变化而 remount,
  // 每段 useState 重新从已重置的 engine 拿值,补回段级 state 同步
  const [resetSignal, setResetSignal] = useState(0);

  // 挂载时把 localStorage 里的完整配置同步到 engine(让用户上次保存的状态立即生效)
  useEffect(() => {
    const saved = loadDevDrawerSettings();
    if (!saved) return;
    if (saved.bodyMorph) vrmEngine.bodyMorph.setConfig(saved.bodyMorph);
    if (saved.saturation) vrmEngine.setMaterialSaturation(saved.saturation);
    if (saved.lights) {
      vrmEngine.setGlobalLight(saved.lights.globalMult);
      (['dir', 'hemi', 'fill'] as const).forEach((k) => {
        const ch = saved.lights?.[k];
        if (ch) vrmEngine.setLight(k, ch.enabled, ch.base);
      });
    }
    if (saved.camera?.fov) vrmEngine.setFov(saved.camera.fov);
    if (typeof saved.bodyTurnEnabled === 'boolean') vrmEngine.setEnableBodyTurn(saved.bodyTurnEnabled);
    if (saved.wardrobeVisibility) {
      Object.entries(saved.wardrobeVisibility).forEach(([partId, vis]) => {
        vrmEngine.setPartVisibility(partId, vis);
      });
    }
    if (saved.activeExpr && saved.activeExpr !== 'neutral') vrmEngine.setExpression(saved.activeExpr);
  }, []);

  // 控制 canvas 浮动身高尺可见性:drawer 开 + 非移动端
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mqMobile = window.matchMedia('(max-width: 768px)');
    const apply = () => {
      vrmEngine.setHeightRulerVisible(isOpen && !mqMobile.matches);
    };
    apply();
    mqMobile.addEventListener('change', apply);
    return () => {
      mqMobile.removeEventListener('change', apply);
      vrmEngine.setHeightRulerVisible(false);
    };
  }, [isOpen]);

  const handleCopyConfig = useCallback(async () => {
    const saved = loadDevDrawerSettings();
    const fullConfig = {
      bodyMorph: (saved?.bodyMorph ?? vrmEngine.getBodyMorphConfig()) as BodyMorphConfig,
      saturation: (saved?.saturation ?? { ...vrmEngine.materialSaturation }) as MaterialSaturationSettings,
      lights: saved?.lights ?? {
        globalMult: vrmEngine.lightChannels.globalMult ?? APP_CONFIG.lights.globalMult,
        dir:   { ...vrmEngine.lightChannels.dir },
        hemi:  { ...vrmEngine.lightChannels.hemi },
        fill:  { ...vrmEngine.lightChannels.fill },
      },
      camera: { fov: saved?.camera?.fov ?? APP_CONFIG.camera.defaultFov },
      bodyTurnEnabled: saved?.bodyTurnEnabled ?? vrmEngine.getEnableBodyTurn(),
      wardrobeVisibility: saved?.wardrobeVisibility ?? { ...vrmEngine.materialManager.partsVisibility },
      activeExpr: saved?.activeExpr ?? 'neutral',
      postfx: saved?.postfx ?? { ...vrmEngine.postFx.config },
    };
    const jsonStr = JSON.stringify(fullConfig, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jsonStr);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = jsonStr;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy full config JSON:', e);
    }
  }, []);

  const handleResetAllToConfig = useCallback(() => {
    clearAllDevDrawerStorage();

    vrmEngine.resetBodyMorph();
    saveDevDrawerSettings({ bodyMorph: { ...APP_CONFIG.bodyMorph.default } });

    const defaultSat = { ...APP_CONFIG.saturation.default };
    vrmEngine.setMaterialSaturation(defaultSat);
    saveDevDrawerSettings({ saturation: defaultSat });

    const defaultLights = APP_CONFIG.lights;
    vrmEngine.setGlobalLight(defaultLights.globalMult);
    const resetCh = {
      dir:  { ...defaultLights.dir },
      hemi: { ...defaultLights.hemi },
      fill: { ...defaultLights.fill },
    };
    (['dir', 'hemi', 'fill'] as const).forEach((k) => {
      vrmEngine.setLight(k, resetCh[k].enabled, resetCh[k].base);
    });
    saveDevDrawerSettings({ lights: { globalMult: defaultLights.globalMult, ...resetCh } });

    vrmEngine.setFov(APP_CONFIG.camera.defaultFov);
    saveDevDrawerSettings({ camera: { fov: APP_CONFIG.camera.defaultFov } });
    const defTurn = APP_CONFIG.camera.defaultEnableBodyTurn ?? true;
    vrmEngine.setEnableBodyTurn(defTurn);
    saveDevDrawerSettings({ bodyTurnEnabled: defTurn });

    vrmEngine.materialManager.resetToDefaultConfig();
    saveDevDrawerSettings({ wardrobeVisibility: { ...vrmEngine.materialManager.partsVisibility } });

    vrmEngine.setExpression('neutral');
    saveDevDrawerSettings({ activeExpr: 'neutral' });

    // ponytail: 自增 resetSignal,让所有 SectionRenderer remount,每段 useState
    // initializer 重新从已重置的 engine 读值,补回段级 state 同步
    setResetSignal((s) => s + 1);
  }, []);

  return (
    <DevDrawerContext.Provider value={{ t, collapsed, toggleCollapsed, resetSignal }}>
      <aside
        id="control-panel"
        className={`fixed top-0 right-0 bottom-0 z-40 w-84 max-w-[92vw] bg-slate-950/90 backdrop-blur-2xl border-l border-white/15 flex flex-col transition-transform duration-300 shadow-2xl ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 吸顶头部 */}
        <div className="sticky top-0 z-20 flex justify-between items-center gap-2 px-4 py-3 bg-slate-950/95 backdrop-blur-md border-b border-white/10 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Sliders className="w-3.5 h-3.5 text-brand-300 shrink-0" aria-hidden />
            <HeightChip title={t('panel.devDrawer.currentHeight')} />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleCopyConfig}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white transition-all cursor-pointer active:scale-95"
              title={t('panel.devDrawerTips.copyConfig')}
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="hidden sm:inline text-emerald-400">{t('panel.devDrawerExtra.copySuccess')}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-white/60" />
                  <span className="hidden sm:inline">{t('panel.devDrawerExtra.copyConfig')}</span>
                </>
              )}
            </button>
            <button
              onClick={handleResetAllToConfig}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-amber-300 transition-all cursor-pointer active:scale-95"
              title={t('panel.devDrawerTips.clearCache')}
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">{t('panel.devDrawerExtra.reset')}</span>
            </button>
            <button
              id="btn-close-panel"
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center text-white/70 hover:text-white cursor-pointer transition-all active:scale-90 ml-0.5"
              title={t('header.settingsPanelTitle')}
              aria-label={t('header.settingsPanelTitle')}
              onClick={onClose}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 可滚动内容区域 */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 flex flex-col gap-5 sm:gap-6">
          {SECTIONS.map((s) => (
            <SectionRenderer key={`${s.id}-${resetSignal}`} id={s.id} />
          ))}
        </div>
      </aside>
    </DevDrawerContext.Provider>
  );
};