import React, { useState, useEffect } from 'react';
import { postFxPipeline, DEFAULT_POSTFX_CONFIG, type PostFxConfig } from '@/core/postfx/postFxPipeline';
import { APP_CONFIG } from '@/config';
import { SliderWithAnchors, thumbInBoundsOffset } from '@/components/SliderWithAnchors';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { saveDevDrawerSettings, loadDevDrawerSettings } from '../storage';

/**
 * PostFxSection — 后期效果 (bloom / vignette / 高光选择) 调试面板
 *
 * ponytail: 跟 LightingSection 同款 pattern — 本地 state 拖动期写 pipeline,
 * 抬起时持久化。Drawer 是 pipeline 的唯一 UI 入口,Drawer 改 → pipeline.config
 * 改 → applyConfig 同步到 effect。Drawer 没改 → 不动 pipeline。
 */
type BloomKey = 'strength' | 'radius' | 'threshold';
type VignetteKey = 'darkness' | 'offset';

const BLOOM_CONFIG: Record<BloomKey, {
  min: number; max: number; step: number; centerVal: number; centerLabel: string;
  minKey: string; maxKey: string;
}> = {
  strength:  { min: 0, max: 0.60, step: 0.005, centerVal: 0.30, centerLabel: '0.30', minKey: 'panel.postfxSliderLabels.bloomStrength.min', maxKey: 'panel.postfxSliderLabels.bloomStrength.max' },
  radius:    { min: 0, max: 0.80, step: 0.01,  centerVal: 0.40, centerLabel: '0.40', minKey: 'panel.postfxSliderLabels.bloomRadius.min', maxKey: 'panel.postfxSliderLabels.bloomRadius.max' },
  threshold: { min: 0.50, max: 0.95, step: 0.005, centerVal: 0.72, centerLabel: '0.72', minKey: 'panel.postfxSliderLabels.bloomThreshold.min', maxKey: 'panel.postfxSliderLabels.bloomThreshold.max' },
};

const VIGNETTE_CONFIG: Record<VignetteKey, {
  min: number; max: number; step: number; centerVal: number; centerLabel: string;
  minKey: string; maxKey: string;
}> = {
  darkness: { min: 0, max: 1.0, step: 0.01, centerVal: 0.50, centerLabel: '0.50', minKey: 'panel.postfxSliderLabels.vignetteDarkness.min', maxKey: 'panel.postfxSliderLabels.vignetteDarkness.max' },
  offset:   { min: 0, max: 1.5, step: 0.01, centerVal: 0.75, centerLabel: '0.75', minKey: 'panel.postfxSliderLabels.vignetteOffset.min', maxKey: 'panel.postfxSliderLabels.vignetteOffset.max' },
};

const BC_CONFIG: Record<'brightness' | 'contrast', {
  min: number; max: number; step: number; centerVal: number; centerLabel: string;
  minKey: string; maxKey: string;
}> = {
  brightness: { min: -0.3, max: 0.3, step: 0.01, centerVal: 0.0, centerLabel: '0.00', minKey: 'panel.postfxSliderLabels.bcBrightness.min', maxKey: 'panel.postfxSliderLabels.bcBrightness.max' },
  contrast:   { min: -0.3, max: 0.3, step: 0.01, centerVal: 0.0, centerLabel: '0.00', minKey: 'panel.postfxSliderLabels.bcContrast.min', maxKey: 'panel.postfxSliderLabels.bcContrast.max' },
};

const HS_CONFIG: Record<'hue' | 'saturation', {
  min: number; max: number; step: number; centerVal: number; centerLabel: string;
  minKey: string; maxKey: string;
}> = {
  hue:        { min: -0.5, max: 0.5, step: 0.01, centerVal: 0.0, centerLabel: '0.00', minKey: 'panel.postfxSliderLabels.hsHue.min', maxKey: 'panel.postfxSliderLabels.hsHue.max' },
  saturation: { min: 0.0,  max: 0.5, step: 0.01, centerVal: 0.25, centerLabel: '0.25', minKey: 'panel.postfxSliderLabels.hsSaturation.min', maxKey: 'panel.postfxSliderLabels.hsSaturation.max' },
};

import * as THREE from 'three';

// 仅保留最自然、效果明确且与 Three.js 底层常量 100% 对齐的 3 种模式：
const TONE_MAP_OPTIONS = [
  { key: 'LINEAR', value: THREE.LinearToneMapping },          // 1: 原色直出 (动漫 NPR 纯净透亮，推荐默认)
  { key: 'NEUTRAL', value: THREE.NeutralToneMapping },        // 7: Khronos PBR 中性曲线
  { key: 'ACES_FILMIC', value: THREE.ACESFilmicToneMapping }, // 4: 真正的好莱坞电影胶片曲线
] as const;

export const PostFxSection: React.FC = () => {
  const { t } = useDevDrawer();

  // ponytail: stored merge with default — 兜底旧版 localStorage 缺字段或存在过时无效枚举值
  const merge = (a: Partial<PostFxConfig>): PostFxConfig => {
    const storedMode = a.toneMapping?.mode;
    const isValidMode = TONE_MAP_OPTIONS.some(opt => opt.value === storedMode);
    return {
      ...DEFAULT_POSTFX_CONFIG,
      ...a,
      bloom: { ...DEFAULT_POSTFX_CONFIG.bloom, ...(a.bloom || {}) },
      vignette: { ...DEFAULT_POSTFX_CONFIG.vignette, ...(a.vignette || {}) },
      toneMapping: {
        ...DEFAULT_POSTFX_CONFIG.toneMapping,
        ...(a.toneMapping || {}),
        mode: isValidMode ? (storedMode as THREE.ToneMapping) : DEFAULT_POSTFX_CONFIG.toneMapping.mode,
      },
      bc: { ...DEFAULT_POSTFX_CONFIG.bc, ...(a.bc || {}) },
      hs: { ...DEFAULT_POSTFX_CONFIG.hs, ...(a.hs || {}) },
    };
  };

  const [config, setConfig] = useState<PostFxConfig>(() => {
    const stored = loadDevDrawerSettings()?.postfx;
    return stored ? merge(stored as Partial<PostFxConfig>) : merge(postFxPipeline.config);
  });

  // 拖动时即时写回 pipeline,抬起时持久化
  const persist = (next: PostFxConfig) => {
    postFxPipeline.config = next;
    postFxPipeline.applyConfig();
    saveDevDrawerSettings({ postfx: next });
  };

  const setBloom = (key: BloomKey, val: number) => {
    const next: PostFxConfig = {
      ...config,
      bloom: { ...config.bloom, [key]: val },
    };
    setConfig(next);
    persist(next);
  };
  const setVignette = (key: VignetteKey, val: number) => {
    const next = { ...config, vignette: { ...config.vignette, [key]: val } };
    setConfig(next);
    persist(next);
  };
  const setBc = (k: 'brightness' | 'contrast', val: number) => {
    const next = { ...config, bc: { ...config.bc, [k]: val } };
    setConfig(next);
    persist(next);
  };
  const setHs = (k: 'hue' | 'saturation', val: number) => {
    const next = { ...config, hs: { ...config.hs, [k]: val } };
    setConfig(next);
    persist(next);
  };
  const setEnabled = (on: boolean) => {
    postFxPipeline.setEnabled(on);
    const next = { ...config, enabled: on };
    setConfig(next);
    // ponytail: 之前 setEnabled 不走 persist,刷新后 enabled 丢失 → 顺手修。
    saveDevDrawerSettings({ postfx: next });
  };
  const setToneMap = (mode: THREE.ToneMapping) => {
    const next: PostFxConfig = { ...config, toneMapping: { ...config.toneMapping, mode } };
    setConfig(next);
    postFxPipeline.config.toneMapping.mode = mode;
    postFxPipeline.applyConfig();
    persist(next);
  };

  // ponytail: per-frame engine 实时写入,拖动滑块时画布即时响应
  const tickBloom = (key: BloomKey, val: number) => {
    postFxPipeline.config.bloom[key] = val;
    postFxPipeline.applyConfig();
  };
  const tickVignette = (key: VignetteKey, val: number) => {
    postFxPipeline.config.vignette[key] = val;
    postFxPipeline.applyConfig();
  };
  const tickBc = (k: 'brightness' | 'contrast', val: number) => {
    postFxPipeline.config.bc[k] = val;
    postFxPipeline.applyConfig();
  };
  const tickHs = (k: 'hue' | 'saturation', val: number) => {
    postFxPipeline.config.hs[k] = val;
    postFxPipeline.applyConfig();
  };

  const handleReset = () => {
    postFxPipeline.resetToDefault();
    const def = { ...postFxPipeline.config };
    setConfig(def);
    saveDevDrawerSettings({ postfx: def });
  };

  // 启动时把 config 同步到 pipeline (vrmEngine 已经在 init 时 set 过,这里只是保险)
  useEffect(() => {
    postFxPipeline.config = config;
    postFxPipeline.applyConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ponytail: 通用 slider 子组件 — k 当 key, 支持 onTick 实时跟手与底部语义说明刻度
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const Slider = <K extends string>(opts: {
    k: K; val: number; min: number; max: number; step: number;
    defaultVal?: number;
    centerVal?: number;
    minLabel?: string;
    centerLabel?: string;
    maxLabel?: string;
    onTick?: (v: number) => void;
    onChange: (v: number) => void; suffix?: string; liveRef: React.RefObject<HTMLSpanElement | null>;
  }) => {
    const range = opts.max - opts.min;
    const centerVal = opts.centerVal ?? (opts.min + opts.max) / 2;
    const centerPct = range > 0 ? ((centerVal - opts.min) / range) * 100 : 50;
    const defVal = opts.defaultVal ?? centerVal;

    return (
      <div className="flex flex-col gap-1 min-w-0" title={`${opts.k} | 当前 ${opts.val.toFixed(3)}${opts.suffix ?? ''} | 范围 [${opts.min}, ${opts.max}]`}>
        <div className="flex justify-between items-center gap-2 text-[11px] text-white/50 min-w-0">
          <span className="truncate min-w-0">{opts.k}</span>
          <span ref={opts.liveRef} className="text-brand-300 font-mono shrink-0">
            {opts.val.toFixed(3)}{opts.suffix ?? ''}
          </span>
        </div>
        <SliderWithAnchors
          value={opts.val}
          min={opts.min}
          max={opts.max}
          step={opts.step}
          onTick={(v) => opts.onTick?.(v)}
          onChange={(v) => opts.onChange(v)}
          liveValueRef={opts.liveRef}
          liveValueFormatter={(v) => `${v.toFixed(3)}${opts.suffix ?? ''}`}
          anchors={[
            { value: defVal, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
          ]}
        />
        {(opts.minLabel || opts.centerLabel || opts.maxLabel) && (
          <div className="relative h-3 text-[9px] text-white/35 font-mono">
            {opts.minLabel && <span className="absolute whitespace-nowrap left-0">{opts.minLabel}</span>}
            {opts.centerLabel && (
              <span
                className="absolute whitespace-nowrap -translate-x-1/2"
                style={{ left: `calc(${centerPct}% + ${thumbInBoundsOffset(centerPct)}px)` }}
              >
                {opts.centerLabel}
              </span>
            )}
            {opts.maxLabel && <span className="absolute whitespace-nowrap right-0">{opts.maxLabel}</span>}
          </div>
        )}
      </div>
    );
  };

  // ref pool for live values
  const liveRefs = React.useRef<Record<string, React.RefObject<HTMLSpanElement | null>>>({});
  const getRef = (k: string) => {
    if (!liveRefs.current[k]) liveRefs.current[k] = React.createRef<HTMLSpanElement>();
    return liveRefs.current[k];
  };

  const def = APP_CONFIG.postfx;
  const modified = JSON.stringify(config) !== JSON.stringify(def);

  return (
    <SectionCard id="postfx">
      <SectionHeader
        id="postfx"
        title={t('panel.postfx.label')}
        modified={modified}
        onReset={handleReset}
        showReset={modified}
        uppercase={false}
      />
      {/* Enabled toggle */}
      <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.03] border border-white/10">
        <span className="text-xs text-white/90">{t('panel.postfx.enabledToggle')}</span>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="accent-brand-400 cursor-pointer w-4 h-4"
        />
      </div>

      {/* Tone mapping — grid 胶囊按钮,跟 SaturationSection 风格预设视觉一致 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-white/50">{t('panel.postfx.toneMappingGroup')}</span>
        <div className="grid grid-cols-1 gap-1.5">
          {TONE_MAP_OPTIONS.map((opt) => {
            const active = config.toneMapping.mode === opt.value;
            return (
              <button
                key={opt.key}
                onClick={() => setToneMap(opt.value)}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium cursor-pointer text-center transition-all ${
                  active
                    ? 'bg-brand-500/25 border border-brand-400/60 text-brand-100 shadow-sm shadow-brand-500/20 font-semibold'
                    : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white'
                }`}
              >
                {t(`panel.postfx.toneMap.${opt.key}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bloom group */}
      <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <span className="text-xs font-medium text-white/90">{t('panel.postfx.bloomGroup')}</span>
        {(['strength', 'radius', 'threshold'] as BloomKey[]).map((k) => {
          const cfg = BLOOM_CONFIG[k];
          return (
            <Slider
              key={k}
              k={t(`panel.postfx.bloom${k[0].toUpperCase()}${k.slice(1)}`)}
              val={config.bloom[k]}
              min={cfg.min}
              max={cfg.max}
              step={cfg.step}
              defaultVal={def.bloom[k]}
              centerVal={cfg.centerVal}
              minLabel={t(cfg.minKey)}
              centerLabel={cfg.centerLabel}
              maxLabel={t(cfg.maxKey)}
              onTick={(v) => tickBloom(k, v)}
              onChange={(v) => setBloom(k, v)}
              liveRef={getRef(`bloom.${k}`)}
            />
          );
        })}
      </div>

      {/* Vignette group */}
      <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <span className="text-xs font-medium text-white/90">{t('panel.postfx.vignetteGroup')}</span>
        {(['darkness', 'offset'] as VignetteKey[]).map((k) => {
          const cfg = VIGNETTE_CONFIG[k];
          return (
            <Slider
              key={k}
              k={t(`panel.postfx.vignette${k[0].toUpperCase()}${k.slice(1)}`)}
              val={config.vignette[k]}
              min={cfg.min}
              max={cfg.max}
              step={cfg.step}
              defaultVal={def.vignette[k]}
              centerVal={cfg.centerVal}
              minLabel={t(cfg.minKey)}
              centerLabel={cfg.centerLabel}
              maxLabel={t(cfg.maxKey)}
              onTick={(v) => tickVignette(k, v)}
              onChange={(v) => setVignette(k, v)}
              liveRef={getRef(`vignette.${k}`)}
            />
          );
        })}
      </div>

      {/* BC group */}
      <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <span className="text-xs font-medium text-white/90">{t('panel.postfx.bcGroup')}</span>
        {(['brightness', 'contrast'] as ('brightness' | 'contrast')[]).map((k) => {
          const cfg = BC_CONFIG[k];
          return (
            <Slider
              key={k}
              k={t(`panel.postfx.bc${k[0].toUpperCase()}${k.slice(1)}`)}
              val={config.bc[k]}
              min={cfg.min}
              max={cfg.max}
              step={cfg.step}
              defaultVal={def.bc[k]}
              centerVal={cfg.centerVal}
              minLabel={t(cfg.minKey)}
              centerLabel={cfg.centerLabel}
              maxLabel={t(cfg.maxKey)}
              onTick={(v) => tickBc(k, v)}
              onChange={(v) => setBc(k, v)}
              liveRef={getRef(`bc.${k}`)}
            />
          );
        })}
      </div>

      {/* HS group */}
      <div className="flex flex-col gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <span className="text-xs font-medium text-white/90">{t('panel.postfx.hsGroup')}</span>
        {(['hue', 'saturation'] as ('hue' | 'saturation')[]).map((k) => {
          const cfg = HS_CONFIG[k];
          return (
            <Slider
              key={k}
              k={t(`panel.postfx.hs${k[0].toUpperCase()}${k.slice(1)}`)}
              val={config.hs[k]}
              min={cfg.min}
              max={cfg.max}
              step={cfg.step}
              defaultVal={def.hs[k]}
              centerVal={cfg.centerVal}
              minLabel={t(cfg.minKey)}
              centerLabel={cfg.centerLabel}
              maxLabel={t(cfg.maxKey)}
              onTick={(v) => tickHs(k, v)}
              onChange={(v) => setHs(k, v)}
              liveRef={getRef(`hs.${k}`)}
            />
          );
        })}
      </div>
    </SectionCard>
  );
};
