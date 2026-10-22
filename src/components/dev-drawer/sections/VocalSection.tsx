import React, { useState, useEffect, useRef } from 'react';
import { vrmEngine } from '@/core/vrmEngine';
import { APP_CONFIG, type VocalAudioConfig, type VocalPresetKey, type SceneThemeId } from '@/config';
import { SliderWithAnchors, thumbInBoundsOffset } from '@/components/SliderWithAnchors';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { saveDevDrawerSettings, loadDevDrawerSettings } from '../storage';

type VocalFieldKey = 'chestResonance' | 'airGain' | 'midGain' | 'compressorThreshold' | 'reverbWet' | 'outputGain';

interface VocalField {
  key: VocalFieldKey;
  labelKey: string;
  minLabelKey: string;
  maxLabelKey: string;
  range: [number, number];
  step: number;
  centerVal: number;
  centerLabel: string;
  formatter: (v: number) => string;
}

const FIELDS: VocalField[] = [
  {
    key: 'chestResonance',
    labelKey: 'panel.vocalSliders.chestResonance',
    minLabelKey: 'panel.vocalSliderLabels.chestResonance.min',
    maxLabelKey: 'panel.vocalSliderLabels.chestResonance.max',
    range: [-8.0, 8.0],
    step: 0.5,
    centerVal: 0.0,
    centerLabel: '0dB',
    formatter: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  },
  {
    key: 'airGain',
    labelKey: 'panel.vocalSliders.airGain',
    minLabelKey: 'panel.vocalSliderLabels.airGain.min',
    maxLabelKey: 'panel.vocalSliderLabels.airGain.max',
    range: [-6.0, 8.0],
    step: 0.5,
    centerVal: 2.0,
    centerLabel: '+2dB',
    formatter: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  },
  {
    key: 'midGain',
    labelKey: 'panel.vocalSliders.midGain',
    minLabelKey: 'panel.vocalSliderLabels.midGain.min',
    maxLabelKey: 'panel.vocalSliderLabels.midGain.max',
    range: [-6.0, 6.0],
    step: 0.5,
    centerVal: 0.0,
    centerLabel: '0dB',
    formatter: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  },
  {
    key: 'compressorThreshold',
    labelKey: 'panel.vocalSliders.compressor',
    minLabelKey: 'panel.vocalSliderLabels.compressor.min',
    maxLabelKey: 'panel.vocalSliderLabels.compressor.max',
    range: [-36.0, 0.0],
    step: 1.0,
    centerVal: -18.0,
    centerLabel: '-18dB',
    formatter: (v) => (v >= 0 ? '0 dB (关闭)' : `${v.toFixed(0)} dB`),
  },
  {
    key: 'reverbWet',
    labelKey: 'panel.vocalSliders.reverb',
    minLabelKey: 'panel.vocalSliderLabels.reverb.min',
    maxLabelKey: 'panel.vocalSliderLabels.reverb.max',
    range: [0.0, 0.35],
    step: 0.01,
    centerVal: 0.08,
    centerLabel: '8%',
    formatter: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: 'outputGain',
    labelKey: 'panel.vocalSliders.outputGain',
    minLabelKey: 'panel.vocalSliderLabels.outputGain.min',
    maxLabelKey: 'panel.vocalSliderLabels.outputGain.max',
    range: [0.6, 1.5],
    step: 0.05,
    centerVal: 1.0,
    centerLabel: '1.0x',
    formatter: (v) => `${v.toFixed(2)}x`,
  },
];

const PRESETS: VocalPresetKey[] = ['sweet', 'oneesan', 'radio', 'whisper', 'bypass'];

export const VocalSection: React.FC = () => {
  const { t, recordChange, resetSignal } = useDevDrawer();
  const [isPlayingTest, setIsPlayingTest] = useState(false);

  // 稳定 ref 供 SliderWithAnchors 拖动期间绕过 React 写入 textContent
  const liveRefs = useRef<Record<string, React.RefObject<HTMLSpanElement | null>>>({});
  const getRef = (key: string) => {
    if (!liveRefs.current[key]) liveRefs.current[key] = React.createRef<HTMLSpanElement>();
    return liveRefs.current[key];
  };

  const merge = (a?: Partial<VocalAudioConfig>): VocalAudioConfig => ({
    ...APP_CONFIG.vocal.default,
    ...(a || {}),
  });

  const [currentScene, setCurrentScene] = useState<SceneThemeId>(() => vrmEngine.getSceneTheme());

  const [config, setConfig] = useState<VocalAudioConfig>(() => {
    const saved = loadDevDrawerSettings()?.vocal;
    const initial = merge(saved ?? vrmEngine.getVocalConfig());
    // 首次同步到引擎
    vrmEngine.setVocalConfig(initial);
    return initial;
  });

  // 场景变化事件监听
  useEffect(() => {
    const onSceneChange = (e: Event) => {
      const theme = (e as CustomEvent).detail as SceneThemeId;
      if (theme) setCurrentScene(theme);
    };
    window.addEventListener('scene-theme-changed', onSceneChange);
    return () => window.removeEventListener('scene-theme-changed', onSceneChange);
  }, []);

  // 订阅处理器声学参数广播 (用于场景自动切换时实时同步滑块位置)
  useEffect(() => {
    return vrmEngine.vocalProcessor.subscribe((latest) => {
      setConfig(latest);
      FIELDS.forEach((f) => {
        const el = liveRefs.current[f.key]?.current;
        if (el) el.textContent = f.formatter(latest[f.key]);
      });
    });
  }, []);

  // resetSignal 重置信号监听
  useEffect(() => {
    const fresh = merge(vrmEngine.getVocalConfig());
    setConfig(fresh);
  }, [resetSignal]);

  // 轮询说话状态，更新试听按钮状态
  useEffect(() => {
    const timer = setInterval(() => {
      if (!vrmEngine.isSpeaking && isPlayingTest) {
        setIsPlayingTest(false);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [isPlayingTest]);

  // 判断是否与默认配置有差异
  const def = APP_CONFIG.vocal.default;
  const isModified =
    config.enabled !== def.enabled ||
    config.sceneLinkage !== def.sceneLinkage ||
    config.distanceAttenuation !== def.distanceAttenuation ||
    config.preset !== def.preset ||
    Math.abs(config.chestResonance - def.chestResonance) > 1e-3 ||
    Math.abs(config.airGain - def.airGain) > 1e-3 ||
    Math.abs(config.midGain - def.midGain) > 1e-3 ||
    Math.abs(config.compressorThreshold - def.compressorThreshold) > 1e-3 ||
    Math.abs(config.reverbWet - def.reverbWet) > 1e-3 ||
    Math.abs(config.outputGain - def.outputGain) > 1e-3;

  const [cameraAcousticSummary, setCameraAcousticSummary] = useState(() => vrmEngine.vocalProcessor.getCameraAcousticSummary());

  useEffect(() => {
    if (!config.distanceAttenuation) return;
    const timer = setInterval(() => {
      setCameraAcousticSummary(vrmEngine.vocalProcessor.getCameraAcousticSummary());
    }, 200);
    return () => clearInterval(timer);
  }, [config.distanceAttenuation]);

  const handleToggleEnabled = (enabled: boolean) => {
    const next = { ...config, enabled };
    setConfig(next);
    vrmEngine.vocalProcessor.updateParam('enabled', enabled);
    saveDevDrawerSettings({ vocal: next });
  };

  const handleToggleSceneLinkage = (sceneLinkage: boolean) => {
    const next = { ...config, sceneLinkage };
    setConfig(next);
    vrmEngine.vocalProcessor.updateParam('sceneLinkage', sceneLinkage);
    saveDevDrawerSettings({ vocal: next });
  };

  const handleToggleDistanceAttenuation = (distanceAttenuation: boolean) => {
    const next = { ...config, distanceAttenuation };
    setConfig(next);
    vrmEngine.vocalProcessor.updateParam('distanceAttenuation', distanceAttenuation);
    saveDevDrawerSettings({ vocal: next });
  };

  const handlePreset = (presetKey: VocalPresetKey) => {
    vrmEngine.setVocalPreset(presetKey);
    const next = { ...vrmEngine.getVocalConfig(), preset: presetKey };
    setConfig(next);
    saveDevDrawerSettings({ vocal: next });

    // 更新各个 slider 的 liveRef 展示
    FIELDS.forEach((f) => {
      const el = liveRefs.current[f.key]?.current;
      if (el) el.textContent = f.formatter(next[f.key]);
    });
  };

  // 拖动中：毫秒级直连 Tone.js，不触发本组件重绘，边拖边变声
  const handleSliderTick = (key: VocalFieldKey, val: number) => {
    if (config.preset !== 'custom') {
      vrmEngine.vocalProcessor.updateParam('preset', 'custom');
    }
    vrmEngine.vocalProcessor.updateParam(key, val);
  };

  // 手指抬起：提交最终状态与撤销栈
  const handleParamChange = (key: VocalFieldKey, val: number) => {
    const prev = config[key];
    if (Math.abs(prev - val) < 1e-4) return;

    const next = { ...config, [key]: val, preset: 'custom' as const };
    vrmEngine.vocalProcessor.updateParam('preset', 'custom');
    setConfig(next);
    saveDevDrawerSettings({ vocal: next });

    const field = FIELDS.find((f) => f.key === key);
    const label = field ? t(field.labelKey) : key;
    const prevStr = field ? field.formatter(prev) : String(prev);
    const nextStr = field ? field.formatter(val) : String(val);

    recordChange({
      id: `vocal-${key}-${Date.now()}`,
      description: `${label}: ${nextStr} → ${prevStr}`,
      undo: () => {
        vrmEngine.vocalProcessor.updateParam(key, prev);
        setConfig((curr) => {
          const u = { ...curr, [key]: prev, preset: 'custom' as const };
          saveDevDrawerSettings({ vocal: u });
          return u;
        });
        if (liveRefs.current[key]?.current && field) {
          liveRefs.current[key].current.textContent = field.formatter(prev);
        }
      },
      redo: () => {
        vrmEngine.vocalProcessor.updateParam(key, val);
        setConfig((curr) => {
          const u = { ...curr, [key]: val, preset: 'custom' as const };
          saveDevDrawerSettings({ vocal: u });
          return u;
        });
        if (liveRefs.current[key]?.current && field) {
          liveRefs.current[key].current.textContent = field.formatter(val);
        }
      },
    });
  };

  const handleReset = () => {
    const defaults = { ...APP_CONFIG.vocal.default };
    vrmEngine.setVocalConfig(defaults);
    setConfig(defaults);
    saveDevDrawerSettings({ vocal: defaults });

    FIELDS.forEach((f) => {
      const el = liveRefs.current[f.key]?.current;
      if (el) el.textContent = f.formatter(defaults[f.key]);
    });
  };

  // 试音按钮触发 / 停止
  const handleToggleTestVoice = async () => {
    if (isPlayingTest || vrmEngine.isSpeaking) {
      vrmEngine.stopSpeaking();
      setIsPlayingTest(false);
      return;
    }

    try {
      setIsPlayingTest(true);
      const sample = t('panel.vocalTestSample');
      await vrmEngine.speakText(sample);
    } catch (e) {
      console.warn('[VocalSection] Test speech error:', e);
    } finally {
      setIsPlayingTest(false);
    }
  };

  return (
    <SectionCard id="vocal">
      <SectionHeader
        id="vocal"
        title={t('panel.vocalLabel')}
        modified={isModified}
        onReset={handleReset}
        showReset={isModified}
        uppercase={false}
      />

      {/* 总开关 */}
      <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.03] border border-white/10">
        <div className="flex flex-col">
          <span className="text-xs text-white/90 font-medium">{t('panel.vocalEnabledToggle')}</span>
          <span className="text-[10px] text-white/40">{t('panel.vocalEnabledHint')}</span>
        </div>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => handleToggleEnabled(e.target.checked)}
          className="accent-brand-400 cursor-pointer w-4 h-4"
        />
      </div>

      {/* 场景声学环境联动开关 */}
      <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-white/[0.03] border border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-white/90 font-medium">{t('panel.vocalSceneLinkage')}</span>
            <span className="text-[10px] text-white/40">{t('panel.vocalSceneLinkageHint')}</span>
          </div>
          <input
            type="checkbox"
            checked={config.sceneLinkage}
            onChange={(e) => handleToggleSceneLinkage(e.target.checked)}
            className="accent-brand-400 cursor-pointer w-4 h-4"
          />
        </div>
        {config.sceneLinkage && (
          <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px]">
            <span className="text-white/50">{t('panel.vocalCurrentAcousticZone')}</span>
            <span className="text-brand-300 font-medium font-mono">
              {t(`panel.vocalSceneAcoustics.${currentScene}`)}
            </span>
          </div>
        )}
      </div>

      {/* 镜头视距与俯仰角声学衰减联动开关 */}
      <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-white/[0.03] border border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-white/90 font-medium">{t('panel.vocalDistanceAttenuation')}</span>
            <span className="text-[10px] text-white/40">{t('panel.vocalDistanceAttenuationHint')}</span>
          </div>
          <input
            type="checkbox"
            checked={config.distanceAttenuation}
            onChange={(e) => handleToggleDistanceAttenuation(e.target.checked)}
            className="accent-brand-400 cursor-pointer w-4 h-4"
          />
        </div>
        {config.distanceAttenuation && (
          <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px]">
            <span className="text-white/50">{t('panel.vocalCameraAcousticState')}</span>
            <span className="text-brand-300 font-medium font-mono">
              {t(`panel.vocalCameraDistanceModes.${cameraAcousticSummary.distanceMode}`)} ({cameraAcousticSummary.distance.toFixed(1)}m)
            </span>
          </div>
        )}
      </div>

      {/* 试音试听卡片 */}
      <div className="flex items-center justify-between p-2.5 rounded-lg bg-brand-500/10 border border-brand-500/25">
        <div className="flex flex-col min-w-0 pr-2">
          <span className="text-xs font-semibold text-brand-200">
            {isPlayingTest ? t('panel.vocalTestingLive') : t('panel.vocalTestHeading')}
          </span>
          <span className="text-[10px] text-brand-300/80 truncate">
            {t('panel.vocalTestHint')}
          </span>
        </div>
        <button
          onClick={handleToggleTestVoice}
          className={`py-1.5 px-3 rounded-md text-xs font-semibold cursor-pointer shrink-0 transition-all ${
            isPlayingTest
              ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-sm shadow-rose-500/30 animate-pulse'
              : 'bg-brand-500 hover:bg-brand-400 text-white shadow-sm shadow-brand-500/25'
          }`}
        >
          {isPlayingTest ? t('panel.vocalStopTest') : t('panel.vocalPlayTest')}
        </button>
      </div>

      {/* 风格预设 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center text-[11px] text-white/50">
          <span>{t('panel.vocalPresetsLabel')}</span>
          {config.preset === 'custom' && (
            <span className="text-brand-300 text-[10px] font-mono">{t('panel.vocalPresets.custom')}</span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {PRESETS.map((key) => {
            const active = config.preset === key;
            return (
              <button
                key={key}
                onClick={() => handlePreset(key)}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium cursor-pointer text-center transition-all ${
                  active
                    ? 'bg-brand-500/25 border border-brand-400/60 text-brand-100 shadow-sm shadow-brand-500/20 font-semibold'
                    : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white'
                }`}
              >
                {t(`panel.vocalPresets.${key}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 滑块参数列表 */}
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-3.5">
        {FIELDS.map((f) => {
          const defVal = def[f.key];
          const centerPct = ((f.centerVal - f.range[0]) / (f.range[1] - f.range[0])) * 100;

          return (
            <div
              key={f.key}
              className="flex flex-col gap-1 min-w-0"
              title={`${t(f.labelKey)} | 当前 ${f.formatter(config[f.key])} | 默认 ${f.formatter(defVal)}`}
            >
              <div className="flex justify-between items-center gap-2 text-[11px] text-white/80 min-w-0">
                <span className="font-medium text-white/90 whitespace-nowrap truncate min-w-0 flex-1">
                  {t(f.labelKey)}
                </span>
                <span
                  ref={getRef(f.key)}
                  className="text-brand-300 font-mono font-medium whitespace-nowrap shrink-0"
                >
                  {f.formatter(config[f.key])}
                </span>
              </div>

              <SliderWithAnchors
                value={config[f.key]}
                min={f.range[0]}
                max={f.range[1]}
                step={f.step}
                onTick={(v) => handleSliderTick(f.key, v)}
                onChange={(v) => handleParamChange(f.key, v)}
                liveValueRef={getRef(f.key)}
                liveValueFormatter={(v) => f.formatter(v)}
                anchors={[
                  { value: f.centerVal, label: f.centerLabel, color: 'emerald' },
                  { value: defVal, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
                ]}
              />

              <div className="relative h-3 text-[9px] text-white/35 font-mono">
                <span className="absolute whitespace-nowrap left-0">{t(f.minLabelKey)}</span>
                <span
                  className="absolute whitespace-nowrap -translate-x-1/2"
                  style={{ left: `calc(${centerPct}% + ${thumbInBoundsOffset(centerPct)}px)` }}
                >
                  {f.centerLabel}
                </span>
                <span className="absolute whitespace-nowrap right-0">{t(f.maxLabelKey)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
};
