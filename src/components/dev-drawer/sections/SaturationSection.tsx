import React, { useState } from 'react';
import { vrmEngine, type MaterialSaturationSettings, type MaterialSaturationPresetKey } from '@/core/vrmEngine';
import { APP_CONFIG } from '@/config';
import { SliderWithAnchors, thumbInBoundsOffset } from '@/components/SliderWithAnchors';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { saveDevDrawerSettings, loadDevDrawerSettings } from '../storage';

type SatKey = keyof Omit<MaterialSaturationSettings, 'preset'>;

interface SatField {
  key: SatKey;
  labelKey: string;
  minLabelKey: string;
  maxLabelKey: string;
  range: [number, number];
  step: number;
}

const FIELDS: SatField[] = [
  { key: 'clothing', labelKey: 'panel.clothingSat', minLabelKey: 'panel.satSliderLabels.clothing.min', maxLabelKey: 'panel.satSliderLabels.clothing.max', range: [0.80, 2.00], step: 0.02 },
  { key: 'hair',     labelKey: 'panel.hairSat',     minLabelKey: 'panel.satSliderLabels.hair.min',     maxLabelKey: 'panel.satSliderLabels.hair.max',     range: [0.80, 2.00], step: 0.02 },
  { key: 'eyes',     labelKey: 'panel.eyesSat',     minLabelKey: 'panel.satSliderLabels.eyes.min',     maxLabelKey: 'panel.satSliderLabels.eyes.max',     range: [0.80, 2.00], step: 0.02 },
  { key: 'skin',     labelKey: 'panel.skinSat',     minLabelKey: 'panel.satSliderLabels.skin.min',     maxLabelKey: 'panel.satSliderLabels.skin.max',     range: [0.80, 1.30], step: 0.01 },
];

const PRESETS: MaterialSaturationPresetKey[] = ['vibrant', 'sweet', 'cinematic', 'original'];

/**
 * ponytail: 4 个材质饱和度 slider + 4 个预设胶囊按钮 + modified 检测 + reset 回默认。
 * 自带 state,setMatSat 不会触发 drawer 其它部分重渲染,移动端 slider 拖动顺滑。
 */
export const SaturationSection: React.FC = () => {
  const { t } = useDevDrawer();
  // ponytail: 每个 slider 的 display span 一个稳定 ref,SliderWithAnchors 拖动期间
  // imperative 写入 textContent,绕过 React — display 跟手但本段不重渲。
  const liveRefs = React.useRef<Record<string, React.RefObject<HTMLSpanElement | null>>>({});
  const getRef = (key: string) => {
    if (!liveRefs.current[key]) liveRefs.current[key] = React.createRef<HTMLSpanElement>();
    return liveRefs.current[key];
  };
  // ponytail: stored merge with default — 兜底 localStorage 缺字段或脏数据，避免渲染崩溃
  const merge = (a: Partial<MaterialSaturationSettings>): MaterialSaturationSettings => ({
    ...APP_CONFIG.saturation.default,
    ...a,
  });
  const [matSat, setMatSat] = useState<MaterialSaturationSettings>(
    () => merge(loadDevDrawerSettings()?.saturation ?? vrmEngine.materialSaturation)
  );

  const handlePreset = (presetKey: MaterialSaturationPresetKey) => {
    vrmEngine.applyMaterialPreset(presetKey);
    const next = { ...vrmEngine.materialSaturation };
    setMatSat(next);
    saveDevDrawerSettings({ saturation: next });
  };

  // ponytail: per-frame engine 写入,让 canvas 实时跟手;React state + localStorage
  // 只在 onValueCommit(手指抬起)触发,避免 60Hz 重渲整段 4 个 slider。
  const handleSliderTick = (key: SatKey, val: number) => {
    vrmEngine.setMaterialSaturation({ [key]: val, preset: 'custom' });
  };
  const handleParamChange = (key: SatKey, val: number) => {
    const next = { ...matSat, [key]: val, preset: 'custom' as const };
    setMatSat(next);
    saveDevDrawerSettings({ saturation: next });
  };

  const handleReset = () => {
    const defaults = { ...APP_CONFIG.saturation.default };
    vrmEngine.setMaterialSaturation(defaults);
    setMatSat(defaults);
    saveDevDrawerSettings({ saturation: defaults });
  };

  const modified = FIELDS.some(f => Math.abs(matSat[f.key] - APP_CONFIG.saturation.default[f.key]) >= 1e-4);

  return (
    <SectionCard id="saturation">
      <SectionHeader
        id="saturation"
        title={t('panel.filterLabel')}
        modified={modified}
        onReset={handleReset}
        showReset={modified}
        uppercase={false}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-white/50">{t('panel.filterPresetsLabel')}</span>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((key) => (
            <button
              key={key}
              onClick={() => handlePreset(key)}
              className={`py-1.5 px-2 rounded-lg text-xs font-medium cursor-pointer text-center transition-all ${
                matSat.preset === key
                  ? 'bg-brand-500/25 border border-brand-400/60 text-brand-100 shadow-sm shadow-brand-500/20 font-semibold'
                  : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white'
              }`}
            >
              {t(`panel.filterPresets.${key}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-3">
        {FIELDS.map((f) => (
          <div
            key={f.key}
            className="flex flex-col gap-1 min-w-0"
            title={`${t(f.labelKey)} | 当前 ${matSat[f.key].toFixed(2)} | 范围 [${f.range[0]}, ${f.range[1]}] | 默认 ${APP_CONFIG.saturation.default[f.key]} | 步长 ${f.step}`}
          >
            <div className="flex justify-between items-center gap-2 text-[11px] text-white/80 min-w-0">
              <span className="font-medium text-white/90 whitespace-nowrap truncate min-w-0 flex-1">{t(f.labelKey)}</span>
              <span ref={getRef(f.key)} className="text-brand-300 font-mono font-medium whitespace-nowrap shrink-0">{Math.round(matSat[f.key] * 100)}%</span>
            </div>
            <SliderWithAnchors
              value={matSat[f.key]}
              min={f.range[0]}
              max={f.range[1]}
              step={f.step}
              onTick={(v) => handleSliderTick(f.key, v)}
              onChange={(v) => handleParamChange(f.key, v)}
              liveValueRef={getRef(f.key)}
              liveValueFormatter={(v) => `${Math.round(v * 100)}%`}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.saturation.default[f.key], label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
            />
            {(() => {
              const centerPct = ((1.0 - f.range[0]) / (f.range[1] - f.range[0])) * 100;
              return (
                <div className="relative h-3 text-[9px] text-white/35 font-mono">
                  <span className="absolute whitespace-nowrap left-0">{t(f.minLabelKey)}</span>
                  <span
                    className="absolute whitespace-nowrap -translate-x-1/2"
                    style={{ left: `calc(${centerPct}% + ${thumbInBoundsOffset(centerPct)}px)` }}
                  >
                    100%
                  </span>
                  <span className="absolute whitespace-nowrap right-0">{t(f.maxLabelKey)}</span>
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </SectionCard>
  );
};