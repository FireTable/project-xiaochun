import React, { useState, useEffect, useRef } from 'react';
import { vrmEngine } from '@/core/vrmEngine';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { SliderWithAnchors } from '@/components/SliderWithAnchors';
import { formatHourToString, type EnvironmentTimeMode } from '@/core/scene/environmentTime';

const PRESETS: Array<{ key: EnvironmentTimeMode }> = [
  { key: 'auto' },
  { key: 'day' },
  { key: 'sunset' },
  { key: 'night' },
];

export const EnvironmentTimeSection: React.FC = () => {
  const { t } = useDevDrawer();
  const [supported, setSupported] = useState(() => vrmEngine.isEnvironmentTimeSupported());
  const [timeState, setTimeState] = useState(() => vrmEngine.getEnvironmentTime());
  const hourDisplayRef = useRef<HTMLSpanElement>(null);

  // 监听场景切换或时间变化事件，动态刷新支持状态
  useEffect(() => {
    const handleSync = () => {
      setSupported(vrmEngine.isEnvironmentTimeSupported());
      setTimeState(vrmEngine.getEnvironmentTime());
      if (hourDisplayRef.current) {
        hourDisplayRef.current.textContent = formatHourToString(vrmEngine.getEnvironmentTime().currentHour);
      }
    };

    window.addEventListener('scene-theme-changed', handleSync);
    window.addEventListener('environment-time-changed', handleSync);
    return () => {
      window.removeEventListener('scene-theme-changed', handleSync);
      window.removeEventListener('environment-time-changed', handleSync);
    };
  }, []);

  const handleSelectPreset = (mode: EnvironmentTimeMode) => {
    vrmEngine.setEnvironmentTime(mode);
    const updated = vrmEngine.getEnvironmentTime();
    setTimeState(updated);
    if (hourDisplayRef.current) {
      hourDisplayRef.current.textContent = formatHourToString(updated.currentHour);
    }
  };

  const handleSliderTick = (hour: number) => {
    vrmEngine.setEnvironmentTime(hour, { isDragging: true });
    if (hourDisplayRef.current) {
      hourDisplayRef.current.textContent = formatHourToString(hour);
    }
  };

  const handleSliderChange = (hour: number) => {
    vrmEngine.setEnvironmentTime(hour, { isDragging: false });
    setTimeState(vrmEngine.getEnvironmentTime());
  };

  const handleReset = () => {
    handleSelectPreset('auto');
  };

  const isModified = timeState.mode !== 'auto';

  return (
    <SectionCard id="environmentTime">
      <SectionHeader
        id="environmentTime"
        title={t('panel.environmentTimeLabel')}
        modified={isModified}
        onReset={handleReset}
        showReset={isModified && supported}
        uppercase={false}
      />

      {!supported ? (
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] text-white/40 leading-relaxed text-center">
          {t('panel.environmentTimeUnsupported')}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 时段预设快捷按钮 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-white/50">{t('panel.environmentTimePresetLabel')}</span>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelectPreset(key)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium cursor-pointer text-center transition-all ${
                    timeState.mode === key
                      ? 'bg-brand-500/25 border border-brand-400/60 text-brand-100 shadow-sm shadow-brand-500/20 font-semibold'
                      : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white'
                  }`}
                >
                  {t(`panel.environmentTimePresets.${key}`)}
                </button>
              ))}
            </div>
          </div>

          {/* 0 ~ 24h 连续时间滑块 */}
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2">
            <div className="flex justify-between items-center gap-2 text-[11px] text-white/80 min-w-0">
              <span className="font-medium text-white/90 truncate min-w-0 flex-1">
                {t('panel.environmentTimeHour')}
              </span>
              <span ref={hourDisplayRef} className="text-brand-300 font-mono font-medium whitespace-nowrap shrink-0">
                {formatHourToString(timeState.currentHour)}
              </span>
            </div>
            <SliderWithAnchors
              value={timeState.currentHour}
              min={0}
              max={24}
              step={0.1}
              anchors={[
                { value: 0, label: '0h' },
                { value: 6, label: '6h' },
                { value: 12, label: '12h' },
                { value: 18, label: '18h' },
                { value: 24, label: '24h' },
              ]}
              onTick={handleSliderTick}
              onChange={handleSliderChange}
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
};
