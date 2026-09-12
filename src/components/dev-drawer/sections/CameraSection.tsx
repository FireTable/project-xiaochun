import React, { useState } from 'react';
import { vrmEngine } from '@/core/vrmEngine';
import { APP_CONFIG } from '@/config';
import { SliderWithAnchors, thumbInBoundsOffset } from '@/components/SliderWithAnchors';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { saveDevDrawerSettings, loadDevDrawerSettings } from '../storage';

/**
 * ponytail: FOV slider + 自动面朝镜头转身 toggle + reset。body-turn 从原独立段
 * 合并进来,两者的 modified 一起算,reset 一次性把两个都归位。
 */
export const CameraSection: React.FC = () => {
  const { t } = useDevDrawer();
  const initSaved = loadDevDrawerSettings();
  const [fov, setFov] = useState<number>(initSaved?.camera?.fov ?? APP_CONFIG.camera.defaultFov);
  const [minDist, setMinDist] = useState<number>(initSaved?.camera?.minDistance ?? APP_CONFIG.camera.defaultMinDistance);
  const [maxDist, setMaxDist] = useState<number>(initSaved?.camera?.maxDistance ?? APP_CONFIG.camera.defaultMaxDistance);
  const [bodyTurnEnabled, setBodyTurnEnabled] = useState<boolean>(
    initSaved?.bodyTurnEnabled ?? vrmEngine.getEnableBodyTurn()
  );
  // ponytail: FOV / 距离 display 跟手,SliderWithAnchors 拖动期间 imperative 写入 textContent
  const fovDisplayRef = React.useRef<HTMLSpanElement>(null);
  const minDistDisplayRef = React.useRef<HTMLSpanElement>(null);
  const maxDistDisplayRef = React.useRef<HTMLSpanElement>(null);

  // 挂载时把 localStorage 里的 distance range 推到 engine (跟 FOV/lighting 同样模式)
  React.useEffect(() => {
    vrmEngine.setCameraDistanceRange(minDist, maxDist);
    // 只在 mount 时跑一次,后续依赖 handleMinDistChange/handleMaxDistChange 主动推
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ponytail: per-frame 推 engine 跟手,state + localStorage 在 commit 才更新
  const handleFovTick = (val: number) => {
    vrmEngine.setFov(val);
  };
  const handleFovChange = (val: number) => {
    setFov(val);
    saveDevDrawerSettings({ camera: { fov: val } });
  };

  // ponytail: 距离上下限是钳位属性,改 min/max 立即生效;per-frame 也只是写一下,无重副作用
  const handleMinDistChange = (val: number) => {
    setMinDist(val);
    vrmEngine.setCameraDistanceRange(val, maxDist);
    saveDevDrawerSettings({ camera: { minDistance: val } });
  };
  const handleMaxDistChange = (val: number) => {
    setMaxDist(val);
    vrmEngine.setCameraDistanceRange(minDist, val);
    saveDevDrawerSettings({ camera: { maxDistance: val } });
  };

  const handleBodyTurnToggle = () => {
    const next = !bodyTurnEnabled;
    setBodyTurnEnabled(next);
    vrmEngine.setEnableBodyTurn(next);
    saveDevDrawerSettings({ bodyTurnEnabled: next });
  };

  const handleReset = () => {
    setFov(APP_CONFIG.camera.defaultFov);
    vrmEngine.setFov(APP_CONFIG.camera.defaultFov);
    saveDevDrawerSettings({ camera: { fov: APP_CONFIG.camera.defaultFov } });
    setMinDist(APP_CONFIG.camera.defaultMinDistance);
    setMaxDist(APP_CONFIG.camera.defaultMaxDistance);
    vrmEngine.setCameraDistanceRange(APP_CONFIG.camera.defaultMinDistance, APP_CONFIG.camera.defaultMaxDistance);
    saveDevDrawerSettings({
      camera: { minDistance: APP_CONFIG.camera.defaultMinDistance, maxDistance: APP_CONFIG.camera.defaultMaxDistance },
    });
    const defTurn = APP_CONFIG.camera.defaultEnableBodyTurn ?? true;
    setBodyTurnEnabled(defTurn);
    vrmEngine.setEnableBodyTurn(defTurn);
    saveDevDrawerSettings({ bodyTurnEnabled: defTurn });
  };

  // ponytail: 任一项被改过都标 modified;reset 按钮一并显示
  const fovModified = Math.abs(fov - APP_CONFIG.camera.defaultFov) >= 1e-4;
  const minDistModified = Math.abs(minDist - APP_CONFIG.camera.defaultMinDistance) >= 1e-4;
  const maxDistModified = Math.abs(maxDist - APP_CONFIG.camera.defaultMaxDistance) >= 1e-4;
  const bodyTurnModified = bodyTurnEnabled !== (APP_CONFIG.camera.defaultEnableBodyTurn ?? true);
  const modified = fovModified || minDistModified || maxDistModified || bodyTurnModified;

  const fovCenterPct = ((30 - 15) / (60 - 15)) * 100;
  const minDistCenterPct = ((5.0 - 0.5) / (10 - 0.5)) * 100;
  const maxDistCenterPct = ((15.0 - 3) / (30 - 3)) * 100;

  return (
    <SectionCard id="camera">
      <SectionHeader
        id="camera"
        title={t('panel.cameraLabel')}
        modified={modified}
        onReset={handleReset}
        showReset={modified}
        uppercase={false}
      />
      <div
        className="flex flex-col gap-1"
        title={`${t('panel.fov')} | 当前 ${fov}° | 范围 [15, 60] | 默认 ${APP_CONFIG.camera.defaultFov}° | 步长 1`}
      >
        <div className="flex justify-between items-center text-[11px] text-white/70">
          <span className="flex items-center gap-1">
            🎯 {t('panel.fov')}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-white/40 hover:text-white/90 transition-colors leading-none cursor-help outline-none"
                  aria-label="FOV 说明"
                >ⓘ</button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[260px] leading-relaxed text-[11px]">
                FOV = 垂直视场角(度)。越大看得越广、单体越小;越小越窄、单体越大。
                <ul className="mt-1.5 space-y-0.5 text-white/60 list-none pl-0">
                  <li>· 20° = 长焦特写</li>
                  <li>· 30° = 自然眼</li>
                  <li>· 45° = 中等广角</li>
                  <li>· 60° = 广角(边缘畸变)</li>
                </ul>
                <div className="mt-1 text-white/45 text-[10px]">当前默认 20° 偏电影长焦</div>
              </TooltipContent>
            </Tooltip>
          </span>
          <span ref={fovDisplayRef} className="text-brand-300 font-mono">{fov}°</span>
        </div>
        <SliderWithAnchors
          value={fov}
          min={15}
          max={60}
          step={1}
          onTick={handleFovTick}
          onChange={handleFovChange}
          liveValueRef={fovDisplayRef}
          liveValueFormatter={(v) => `${v}°`}
          anchors={[
            { value: 30, label: t('panel.sliderAnchors.fov30'), color: 'emerald' },
            { value: APP_CONFIG.camera.defaultFov, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
          ]}
        />
        <div className="relative h-3 text-[9px] text-white/35 font-mono">
          <span className="absolute whitespace-nowrap left-0">{t('panel.cameraSliderLabels.fov.min')}</span>
          <span
            className="absolute whitespace-nowrap -translate-x-1/2"
            style={{ left: `calc(${fovCenterPct}% + ${thumbInBoundsOffset(fovCenterPct)}px)` }}
          >
            30°
          </span>
          <span className="absolute whitespace-nowrap right-0">{t('panel.cameraSliderLabels.fov.max')}</span>
        </div>
      </div>
      {/* 镜头距离范围 — 鼠标滚轮 / pinch 缩放的钳位上下限,改完立即生效 */}
      <div
        className="flex flex-col gap-1"
        title={`${t('panel.devDrawerExtra.cameraMinDist') || '镜头最近距离'} | 当前 ${minDist.toFixed(1)} | 默认 ${APP_CONFIG.camera.defaultMinDistance} | 步长 0.1`}
      >
        <div className="flex justify-between text-[11px] text-white/70">
          <span>📷 {t('panel.devDrawerExtra.cameraMinDist') || '镜头最近距离'}</span>
          <span ref={minDistDisplayRef} className="text-brand-300 font-mono">{minDist.toFixed(1)}</span>
        </div>
        <SliderWithAnchors
          value={minDist}
          min={0.5}
          max={10}
          step={0.1}
          onChange={handleMinDistChange}
          liveValueRef={minDistDisplayRef}
          liveValueFormatter={(v) => v.toFixed(1)}
          anchors={[
            { value: APP_CONFIG.camera.defaultMinDistance, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
          ]}
        />
        <div className="relative h-3 text-[9px] text-white/35 font-mono">
          <span className="absolute whitespace-nowrap left-0">{t('panel.cameraSliderLabels.minDist.min')}</span>
          <span
            className="absolute whitespace-nowrap -translate-x-1/2"
            style={{ left: `calc(${minDistCenterPct}% + ${thumbInBoundsOffset(minDistCenterPct)}px)` }}
          >
            5.0m
          </span>
          <span className="absolute whitespace-nowrap right-0">{t('panel.cameraSliderLabels.minDist.max')}</span>
        </div>
      </div>
      <div
        className="flex flex-col gap-1"
        title={`${t('panel.devDrawerExtra.cameraMaxDist') || '镜头最远距离'} | 当前 ${maxDist.toFixed(1)} | 默认 ${APP_CONFIG.camera.defaultMaxDistance} | 步长 0.5`}
      >
        <div className="flex justify-between text-[11px] text-white/70">
          <span>🔭 {t('panel.devDrawerExtra.cameraMaxDist') || '镜头最远距离'}</span>
          <span ref={maxDistDisplayRef} className="text-brand-300 font-mono">{maxDist.toFixed(1)}</span>
        </div>
        <SliderWithAnchors
          value={maxDist}
          min={3}
          max={30}
          step={0.5}
          onChange={handleMaxDistChange}
          liveValueRef={maxDistDisplayRef}
          liveValueFormatter={(v) => v.toFixed(1)}
          anchors={[
            { value: APP_CONFIG.camera.defaultMaxDistance, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
          ]}
        />
        <div className="relative h-3 text-[9px] text-white/35 font-mono">
          <span className="absolute whitespace-nowrap left-0">{t('panel.cameraSliderLabels.maxDist.min')}</span>
          <span
            className="absolute whitespace-nowrap -translate-x-1/2"
            style={{ left: `calc(${maxDistCenterPct}% + ${thumbInBoundsOffset(maxDistCenterPct)}px)` }}
          >
            15.0m
          </span>
          <span className="absolute whitespace-nowrap right-0">{t('panel.cameraSliderLabels.maxDist.max')}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[11px] text-white/80">{t('panel.devDrawerExtra.autoBodyTurn')}</span>
          <span className="text-[10px] text-white/45 leading-relaxed">
            {t('panel.devDrawerTips.bodyTurnOn')}
          </span>
        </div>
        <button
          type="button"
          onClick={handleBodyTurnToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            bodyTurnEnabled ? 'bg-brand-500' : 'bg-white/20'
          }`}
          title={bodyTurnEnabled ? t('panel.devDrawerTips.bodyTurnOff') : t('panel.devDrawerTips.bodyTurnOn')}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
              bodyTurnEnabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </SectionCard>
  );
};