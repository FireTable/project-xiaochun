import React, { useState } from 'react';
import { vrmEngine } from '@/core/vrmEngine';
import { APP_CONFIG } from '@/config';
import { SliderWithAnchors, thumbInBoundsOffset } from '@/components/SliderWithAnchors';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { saveDevDrawerSettings, loadDevDrawerSettings } from '../storage';

// ponytail: 精简到 3 通道 — dir / hemi / fill。devDrawer 调整实时生效。
type ChannelKey = 'dir' | 'hemi' | 'fill';

interface ChannelState { enabled: boolean; base: number; }

const CHANNEL_KEYS: ChannelKey[] = ['dir', 'hemi', 'fill'];

const RANGE_BY_KEY: Record<ChannelKey, {
  min: number;
  max: number;
  step: number;
  labelKey: string;
  minLabelKey: string;
  centerVal: number;
  centerLabel: string;
  maxLabelKey: string;
  tooltipKey: string;
}> = {
  dir: {
    min: 0.0,
    max: 2.5,
    step: 0.05,
    labelKey: 'panel.lightChannels.dir',
    minLabelKey: 'panel.lightSliderLabels.dir.min',
    centerVal: 1.0,
    centerLabel: '1.00',
    maxLabelKey: 'panel.lightSliderLabels.dir.max',
    tooltipKey: 'panel.lightTooltips.dir',
  },
  hemi: {
    min: 0.0,
    max: 2.0,
    step: 0.05,
    labelKey: 'panel.lightChannels.hemi',
    minLabelKey: 'panel.lightSliderLabels.hemi.min',
    centerVal: 1.0,
    centerLabel: '1.00',
    maxLabelKey: 'panel.lightSliderLabels.hemi.max',
    tooltipKey: 'panel.lightTooltips.hemi',
  },
  fill: {
    min: 0.0,
    max: 1.5,
    step: 0.02,
    labelKey: 'panel.lightChannels.fill',
    minLabelKey: 'panel.lightSliderLabels.fill.min',
    centerVal: 0.70,
    centerLabel: '0.70',
    maxLabelKey: 'panel.lightSliderLabels.fill.max',
    tooltipKey: 'panel.lightTooltips.fill',
  },
};

/**
 * ponytail: 3 个独立灯光通道(每通道 toggle + slider) + 全局倍率 slider + reset。
 * 自带 state,setChannels 不影响 drawer 其它部分。移动端拖动 3 个 slider 都不会被打断。
 */
export const LightingSection: React.FC = () => {
  const { t } = useDevDrawer();

  // ponytail: 每个 slider 的 display span 一个稳定 ref,SliderWithAnchors 拖动期间
  // imperative 写入 textContent,绕过 React — display 跟手但本段不重渲。
  const liveRefs = React.useRef<Record<string, React.RefObject<HTMLSpanElement | null>>>({});
  const getRef = (key: string) => {
    if (!liveRefs.current[key]) liveRefs.current[key] = React.createRef<HTMLSpanElement>();
    return liveRefs.current[key];
  };

  const [channels, setChannels] = useState<Record<ChannelKey, ChannelState>>(() => {
    const l = loadDevDrawerSettings()?.lights;
    return {
      dir:  l?.dir  ? { ...l.dir  } : { ...vrmEngine.lightChannels.dir  },
      hemi: l?.hemi ? { ...l.hemi } : { ...vrmEngine.lightChannels.hemi },
      fill: l?.fill ? { ...l.fill } : { ...vrmEngine.lightChannels.fill },
    };
  });

  const [globalMult, setGlobalMult] = useState<number>(
    () => loadDevDrawerSettings()?.lights?.globalMult ?? vrmEngine.lightChannels.globalMult ?? APP_CONFIG.lights.globalMult
  );

  const persist = (next: Record<ChannelKey, ChannelState>, mult: number) => {
    saveDevDrawerSettings({ lights: { globalMult: mult, ...next } });
  };

  const handleChannelToggle = (key: ChannelKey) => {
    const next = { ...channels, [key]: { ...channels[key], enabled: !channels[key].enabled } };
    setChannels(next);
    vrmEngine.setLight(key, next[key].enabled, next[key].base);
    persist(next, globalMult);
  };

  // ponytail: per-frame 推 engine 让场景灯光实时跟手;React state + localStorage
  // 只在 onValueCommit(手指抬起)触发,避免 60Hz 重渲 3 通道 + 1 全局 slider。
  const handleChannelBaseTick = (key: ChannelKey, val: number) => {
    vrmEngine.setLight(key, channels[key].enabled, val);
  };
  const handleChannelBaseChange = (key: ChannelKey, val: number) => {
    const next = { ...channels, [key]: { ...channels[key], base: val } };
    setChannels(next);
    persist(next, globalMult);
  };

  const handleGlobalMultTick = (val: number) => {
    vrmEngine.setGlobalLight(val);
  };
  const handleGlobalMultChange = (val: number) => {
    setGlobalMult(val);
    saveDevDrawerSettings({ lights: { globalMult: val, ...channels } });
  };

  const handleReset = () => {
    const next = {
      dir:  { ...APP_CONFIG.lights.dir  },
      hemi: { ...APP_CONFIG.lights.hemi },
      fill: { ...APP_CONFIG.lights.fill },
    } as Record<ChannelKey, ChannelState>;
    setChannels(next);
    setGlobalMult(APP_CONFIG.lights.globalMult);
    CHANNEL_KEYS.forEach((k) => vrmEngine.setLight(k, next[k].enabled, next[k].base));
    vrmEngine.setGlobalLight(APP_CONFIG.lights.globalMult);
    saveDevDrawerSettings({ lights: { globalMult: APP_CONFIG.lights.globalMult, ...next } });
  };

  const modified = (
    Math.abs(globalMult - APP_CONFIG.lights.globalMult) >= 1e-4 ||
    CHANNEL_KEYS.some((k) => {
      const c = channels[k];
      const d = APP_CONFIG.lights[k];
      return c.enabled !== d.enabled || Math.abs(c.base - d.base) >= 1e-4;
    })
  );

  return (
    <SectionCard id="lighting">
      <SectionHeader
        id="lighting"
        title={t('panel.lightsLabel')}
        modified={modified}
        onReset={handleReset}
        showReset={modified}
        uppercase={false}
      />
      {CHANNEL_KEYS.map((key) => {
        const ch = channels[key];
        const cfg = RANGE_BY_KEY[key];
        const def = APP_CONFIG.lights[key];
        return (
          <div
            key={key}
            className={`p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2 transition-opacity ${
              ch.enabled ? 'opacity-100' : 'opacity-40'
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-white/90 flex items-center gap-1">
                {t(cfg.labelKey)}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-white/40 hover:text-white/90 transition-colors leading-none cursor-help outline-none"
                      aria-label="说明"
                    >ⓘ</button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[240px] leading-relaxed text-[11px]">
                    {t(cfg.tooltipKey)}
                  </TooltipContent>
                </Tooltip>
              </span>
              <input
                type="checkbox"
                checked={ch.enabled}
                onChange={() => handleChannelToggle(key)}
                className="accent-brand-400 cursor-pointer w-4 h-4"
              />
            </div>
            <div
              className="flex flex-col gap-1"
              title={`${t(cfg.labelKey)} | 当前 ${ch.base.toFixed(2)} | 范围 [${cfg.min}, ${cfg.max}] | 默认 ${def.base} | 步长 ${cfg.step}`}
            >
              <div className="flex justify-between items-center gap-2 text-[11px] text-white/50 min-w-0">
                <span className="truncate min-w-0">{t('panel.brightness')}</span>
                <span ref={getRef(key)} className="text-brand-300 font-mono shrink-0">{ch.base.toFixed(2)}</span>
              </div>
              <SliderWithAnchors
                value={ch.base}
                min={cfg.min}
                max={cfg.max}
                step={cfg.step}
                onTick={(v) => handleChannelBaseTick(key, v)}
                onChange={(v) => handleChannelBaseChange(key, v)}
                liveValueRef={getRef(key)}
                liveValueFormatter={(v) => v.toFixed(2)}
                anchors={[
                  { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                  { value: def.base, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
                ]}
              />
              {(() => {
                const centerPct = ((cfg.centerVal - cfg.min) / (cfg.max - cfg.min)) * 100;
                return (
                  <div className="relative h-3 text-[9px] text-white/35 font-mono">
                    <span className="absolute whitespace-nowrap left-0">{t(cfg.minLabelKey)}</span>
                    <span
                      className="absolute whitespace-nowrap -translate-x-1/2"
                      style={{ left: `calc(${centerPct}% + ${thumbInBoundsOffset(centerPct)}px)` }}
                    >
                      {cfg.centerLabel}
                    </span>
                    <span className="absolute whitespace-nowrap right-0">{t(cfg.maxLabelKey)}</span>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}
      {(() => {
        const globalMin = 0.2;
        const globalMax = 2.5;
        const centerPct = ((1.0 - globalMin) / (globalMax - globalMin)) * 100;
        return (
          <div
            className="flex flex-col gap-1 pt-3 border-t border-dashed border-white/15"
            title={`${t('panel.globalLight')} | 当前 ${globalMult.toFixed(2)} | 范围 [0.20, 2.50] | 默认 ${APP_CONFIG.lights.globalMult} | 步长 0.10`}
          >
            <div className="flex justify-between text-[11px] text-white/70">
              <span className="flex items-center gap-1">
                {t('panel.globalLight')}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-white/40 hover:text-white/90 transition-colors leading-none cursor-help outline-none"
                      aria-label="说明"
                    >ⓘ</button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[240px] leading-relaxed text-[11px]">
                    {t('panel.lightTooltips.globalMult')}
                  </TooltipContent>
                </Tooltip>
              </span>
              <span ref={getRef('globalMult')} className="text-brand-300 font-mono">{globalMult.toFixed(1)}</span>
            </div>
            <SliderWithAnchors
              value={globalMult}
              min={globalMin}
              max={globalMax}
              step={0.1}
              onTick={handleGlobalMultTick}
              onChange={handleGlobalMultChange}
              liveValueRef={getRef('globalMult')}
              liveValueFormatter={(v) => v.toFixed(1)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.lights.globalMult, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
            />
            <div className="relative h-3 text-[9px] text-white/35 font-mono">
              <span className="absolute whitespace-nowrap left-0">{t('panel.lightSliderLabels.globalMult.min')}</span>
              <span
                className="absolute whitespace-nowrap -translate-x-1/2"
                style={{ left: `calc(${centerPct}% + ${thumbInBoundsOffset(centerPct)}px)` }}
              >
                1.0
              </span>
              <span className="absolute whitespace-nowrap right-0">{t('panel.lightSliderLabels.globalMult.max')}</span>
            </div>
          </div>
        );
      })()}
    </SectionCard>
  );
};
