import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { vrmEngine } from '@/core/vrmEngine';
import { X, Sliders } from '@/components/icons';
import { APP_CONFIG } from '@/config';

interface DevDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DevDrawer: React.FC<DevDrawerProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [activeExpr, setActiveExpr] = useState('neutral');
  const [globalLight, setGlobalLight] = useState<number>(vrmEngine.lightChannels.globalMult ?? APP_CONFIG.lights.globalMult);
  const [fov, setFov] = useState<number>(APP_CONFIG.camera.defaultFov);

  const [channels, setChannels] = useState({
    dir: { ...vrmEngine.lightChannels.dir },
    hemi: { ...vrmEngine.lightChannels.hemi },
    front: { ...vrmEngine.lightChannels.front },
    fill: { ...vrmEngine.lightChannels.fill },
    leg: { ...vrmEngine.lightChannels.leg },
    arm: { ...vrmEngine.lightChannels.arm },
  });

  const expressions = APP_CONFIG.expressions;

  const handleExpressionClick = (expr: string) => {
    setActiveExpr(expr);
    vrmEngine.setExpression(expr);
  };

  const handleChannelToggle = (key: keyof typeof channels) => {
    const next = { ...channels, [key]: { ...channels[key], enabled: !channels[key].enabled } };
    setChannels(next);
    vrmEngine.setLight(key, next[key].enabled, next[key].base);
  };

  const handleChannelBaseChange = (key: keyof typeof channels, val: number) => {
    const next = { ...channels, [key]: { ...channels[key], base: val } };
    setChannels(next);
    vrmEngine.setLight(key, next[key].enabled, val);
  };

  const handleGlobalLight = (val: number) => {
    setGlobalLight(val);
    vrmEngine.setGlobalLight(val);
  };

  const handleFov = (val: number) => {
    setFov(val);
    vrmEngine.setFov(val);
  };

  return (
    <aside
      id="control-panel"
      className={`fixed top-0 right-0 bottom-0 z-40 w-80 max-w-[90vw] bg-slate-950/85 backdrop-blur-2xl border-l border-white/15 p-4 sm:p-5 flex flex-col gap-5 sm:gap-6 overflow-y-auto transition-transform duration-300 shadow-2xl ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* 头部 */}
      <div className="flex justify-between items-center pb-3 border-b border-white/10">
        <div className="flex items-center gap-2 text-sm font-bold text-white tracking-tight">
          <Sliders className="w-4 h-4 text-brand-300" />
          <span>{t('panel.title')}</span>
        </div>
        {/* ponytail: 关闭按钮提升到 w-11 h-11(44px)触屏规范,内圈视觉仍是 w-4 h-4。 */}
        <button
          id="btn-close-panel"
          className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center text-white/70 hover:text-white cursor-pointer transition-all duration-150 touch-manipulation"
          title={t('header.settingsPanelTitle')}
          aria-label={t('header.settingsPanelTitle')}
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 预设表情 */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-white/70 uppercase tracking-wider">
          {t('panel.expressionsLabel')}
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {expressions.map((e) => (
            <button
              key={e.key}
              onClick={() => handleExpressionClick(e.key)}
              className={`py-2 px-1 rounded-xl text-xs font-medium transition-all duration-200 cursor-pointer text-center select-none ${
                activeExpr === e.key
                  ? 'bg-brand-500/25 border border-brand-400/60 text-brand-100 shadow-sm shadow-brand-500/20'
                  : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white'
              }`}
            >
              {t(`panel.expressionList.${e.key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* 独立光照通道控制 */}
      <div className="flex flex-col gap-3.5">
        <h3 className="text-xs font-semibold text-white/70 uppercase tracking-wider">
          {t('panel.lightsLabel')}
        </h3>

        {/* 1. 主日光 */}
        <div className={`p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2 transition-opacity ${channels.dir.enabled ? 'opacity-100' : 'opacity-40'}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-white/90">{t('panel.lightChannels.dir')}</span>
            <input
              type="checkbox"
              checked={channels.dir.enabled}
              onChange={() => handleChannelToggle('dir')}
              className="accent-brand-400 cursor-pointer w-4 h-4"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.dir.base.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="2.5"
              step="0.05"
              value={channels.dir.base}
              onChange={(e) => handleChannelBaseChange('dir', parseFloat(e.target.value))}
            />
          </div>
        </div>

        {/* 2. 半球天光 */}
        <div className={`p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2 transition-opacity ${channels.hemi.enabled ? 'opacity-100' : 'opacity-40'}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-white/90">{t('panel.lightChannels.hemi')}</span>
            <input
              type="checkbox"
              checked={channels.hemi.enabled}
              onChange={() => handleChannelToggle('hemi')}
              className="accent-brand-400 cursor-pointer w-4 h-4"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.hemi.base.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="2.0"
              step="0.05"
              value={channels.hemi.base}
              onChange={(e) => handleChannelBaseChange('hemi', parseFloat(e.target.value))}
            />
          </div>
        </div>

        {/* 3. 面部射灯 */}
        <div className={`p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2 transition-opacity ${channels.front.enabled ? 'opacity-100' : 'opacity-40'}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-white/90">{t('panel.lightChannels.front')}</span>
            <input
              type="checkbox"
              checked={channels.front.enabled}
              onChange={() => handleChannelToggle('front')}
              className="accent-brand-400 cursor-pointer w-4 h-4"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.front.base.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="2.0"
              step="0.05"
              value={channels.front.base}
              onChange={(e) => handleChannelBaseChange('front', parseFloat(e.target.value))}
            />
          </div>
        </div>

        {/* 4. 背后轮廓微光 */}
        <div className={`p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2 transition-opacity ${channels.fill.enabled ? 'opacity-100' : 'opacity-40'}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-white/90">{t('panel.lightChannels.fill')}</span>
            <input
              type="checkbox"
              checked={channels.fill.enabled}
              onChange={() => handleChannelToggle('fill')}
              className="accent-brand-400 cursor-pointer w-4 h-4"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.fill.base.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="1.5"
              step="0.02"
              value={channels.fill.base}
              onChange={(e) => handleChannelBaseChange('fill', parseFloat(e.target.value))}
            />
          </div>
        </div>

        {/* 5. 腿部柔光 */}
        <div className={`p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2 transition-opacity ${channels.leg.enabled ? 'opacity-100' : 'opacity-40'}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-white/90">{t('panel.lightChannels.leg')}</span>
            <input
              type="checkbox"
              checked={channels.leg.enabled}
              onChange={() => handleChannelToggle('leg')}
              className="accent-brand-400 cursor-pointer w-4 h-4"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.leg.base.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="2.0"
              step="0.05"
              value={channels.leg.base}
              onChange={(e) => handleChannelBaseChange('leg', parseFloat(e.target.value))}
            />
          </div>
        </div>

        {/* 6. 双臂专属射灯 */}
        <div className={`p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2 transition-opacity ${channels.arm.enabled ? 'opacity-100' : 'opacity-40'}`}>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium text-white/90">{t('panel.lightChannels.arm')}</span>
            <input
              type="checkbox"
              checked={channels.arm.enabled}
              onChange={() => handleChannelToggle('arm')}
              className="accent-brand-400 cursor-pointer w-4 h-4"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.arm.base.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.0"
              max="2.0"
              step="0.05"
              value={channels.arm.base}
              onChange={(e) => handleChannelBaseChange('arm', parseFloat(e.target.value))}
            />
          </div>
        </div>

        {/* 全局倍率与 FOV */}
        <div className="pt-3 border-t border-dashed border-white/15 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-white/70">
              <span>{t('panel.globalLight')}</span>
              <span className="text-brand-300 font-mono">{globalLight.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="2.5"
              step="0.1"
              value={globalLight}
              onChange={(e) => handleGlobalLight(parseFloat(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-white/70">
              <span>{t('panel.fov')}</span>
              <span className="text-brand-300 font-mono">{fov}°</span>
            </div>
            <input
              type="range"
              min="15"
              max="60"
              step="1"
              value={fov}
              onChange={(e) => handleFov(parseInt(e.target.value))}
            />
          </div>
        </div>
      </div>
    </aside>
  );
};
