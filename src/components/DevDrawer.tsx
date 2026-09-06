import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  vrmEngine,
  type MaterialSaturationSettings,
  type MaterialSaturationPresetKey,
  MODEL_PARTS_CONFIG,
  MODEL_PART_CATEGORIES,
} from '@/core/vrmEngine';
import { X, Sliders, RotateCcw, Palette, Copy, Check } from '@/components/icons';
import { SliderWithAnchors, thumbInBoundsOffset } from '@/components/SliderWithAnchors';
import { APP_CONFIG, type BodyMorphConfig, type BodyMorphPartKey } from '@/config';

const BODY_MORPH_ITEMS: Array<{
  key: BodyMorphPartKey;
  icon: string;
  labelKey: string;
  minLabelKey: string;
  maxLabelKey: string;
}> = [
  // 全身
  { key: 'overallScale', icon: '🧍', labelKey: 'panel.bodyMorphItems.overallScale.label', minLabelKey: 'panel.bodyMorphItems.overallScale.minLabel', maxLabelKey: 'panel.bodyMorphItems.overallScale.maxLabel' },

  // 头部与颈部
  { key: 'head', icon: '👧', labelKey: 'panel.bodyMorphItems.head.label', minLabelKey: 'panel.bodyMorphItems.head.minLabel', maxLabelKey: 'panel.bodyMorphItems.head.maxLabel' },
  { key: 'neck', icon: '🦒', labelKey: 'panel.bodyMorphItems.neck.label', minLabelKey: 'panel.bodyMorphItems.neck.minLabel', maxLabelKey: 'panel.bodyMorphItems.neck.maxLabel' },
  { key: 'neckDepth', icon: '🦢', labelKey: 'panel.bodyMorphItems.neckDepth.label', minLabelKey: 'panel.bodyMorphItems.neckDepth.minLabel', maxLabelKey: 'panel.bodyMorphItems.neckDepth.maxLabel' },
  { key: 'neckLength', icon: '📏', labelKey: 'panel.bodyMorphItems.neckLength.label', minLabelKey: 'panel.bodyMorphItems.neckLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.neckLength.maxLabel' },

  // 躯干、肩宽与腰臀
  { key: 'shoulderWidth', icon: '🤸', labelKey: 'panel.bodyMorphItems.shoulderWidth.label', minLabelKey: 'panel.bodyMorphItems.shoulderWidth.minLabel', maxLabelKey: 'panel.bodyMorphItems.shoulderWidth.maxLabel' },
  { key: 'torsoLength', icon: '📐', labelKey: 'panel.bodyMorphItems.torsoLength.label', minLabelKey: 'panel.bodyMorphItems.torsoLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.torsoLength.maxLabel' },
  { key: 'torsoThickness', icon: '🎽', labelKey: 'panel.bodyMorphItems.torsoThickness.label', minLabelKey: 'panel.bodyMorphItems.torsoThickness.minLabel', maxLabelKey: 'panel.bodyMorphItems.torsoThickness.maxLabel' },
  { key: 'waist', icon: '⏳', labelKey: 'panel.bodyMorphItems.waist.label', minLabelKey: 'panel.bodyMorphItems.waist.minLabel', maxLabelKey: 'panel.bodyMorphItems.waist.maxLabel' },
  { key: 'belly', icon: '🥟', labelKey: 'panel.bodyMorphItems.belly.label', minLabelKey: 'panel.bodyMorphItems.belly.minLabel', maxLabelKey: 'panel.bodyMorphItems.belly.maxLabel' },
  { key: 'hips', icon: '🩱', labelKey: 'panel.bodyMorphItems.hips.label', minLabelKey: 'panel.bodyMorphItems.hips.minLabel', maxLabelKey: 'panel.bodyMorphItems.hips.maxLabel' },
  { key: 'buttocks', icon: '🍑', labelKey: 'panel.bodyMorphItems.buttocks.label', minLabelKey: 'panel.bodyMorphItems.buttocks.minLabel', maxLabelKey: 'panel.bodyMorphItems.buttocks.maxLabel' },
  { key: 'buttocksPitch', icon: '↕️', labelKey: 'panel.bodyMorphItems.buttocksPitch.label', minLabelKey: 'panel.bodyMorphItems.buttocksPitch.minLabel', maxLabelKey: 'panel.bodyMorphItems.buttocksPitch.maxLabel' },
  { key: 'buttocksSpread', icon: '↔️', labelKey: 'panel.bodyMorphItems.buttocksSpread.label', minLabelKey: 'panel.bodyMorphItems.buttocksSpread.minLabel', maxLabelKey: 'panel.bodyMorphItems.buttocksSpread.maxLabel' },

  // 胸部精细形变 (VRoid 规范)
  { key: 'bust', icon: '🍈', labelKey: 'panel.bodyMorphItems.bust.label', minLabelKey: 'panel.bodyMorphItems.bust.minLabel', maxLabelKey: 'panel.bodyMorphItems.bust.maxLabel' },
  { key: 'bustThickness', icon: '🫧', labelKey: 'panel.bodyMorphItems.bustThickness.label', minLabelKey: 'panel.bodyMorphItems.bustThickness.minLabel', maxLabelKey: 'panel.bodyMorphItems.bustThickness.maxLabel' },
  { key: 'bustPitch', icon: '↕️', labelKey: 'panel.bodyMorphItems.bustPitch.label', minLabelKey: 'panel.bodyMorphItems.bustPitch.minLabel', maxLabelKey: 'panel.bodyMorphItems.bustPitch.maxLabel' },
  { key: 'bustSpread', icon: '↔️', labelKey: 'panel.bodyMorphItems.bustSpread.label', minLabelKey: 'panel.bodyMorphItems.bustSpread.minLabel', maxLabelKey: 'panel.bodyMorphItems.bustSpread.maxLabel' },

  // 上肢与手部
  { key: 'arms', icon: '💪', labelKey: 'panel.bodyMorphItems.arms.label', minLabelKey: 'panel.bodyMorphItems.arms.minLabel', maxLabelKey: 'panel.bodyMorphItems.arms.maxLabel' },
  { key: 'armLength', icon: '📐', labelKey: 'panel.bodyMorphItems.armLength.label', minLabelKey: 'panel.bodyMorphItems.armLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.armLength.maxLabel' },
  { key: 'hands', icon: '🖐️', labelKey: 'panel.bodyMorphItems.hands.label', minLabelKey: 'panel.bodyMorphItems.hands.minLabel', maxLabelKey: 'panel.bodyMorphItems.hands.maxLabel' },
  { key: 'fingerWidth', icon: '🤞', labelKey: 'panel.bodyMorphItems.fingerWidth.label', minLabelKey: 'panel.bodyMorphItems.fingerWidth.minLabel', maxLabelKey: 'panel.bodyMorphItems.fingerWidth.maxLabel' },

  // 下肢与足部
  { key: 'thighs', icon: '🦵', labelKey: 'panel.bodyMorphItems.thighs.label', minLabelKey: 'panel.bodyMorphItems.thighs.minLabel', maxLabelKey: 'panel.bodyMorphItems.thighs.maxLabel' },
  { key: 'thighLength', icon: '📐', labelKey: 'panel.bodyMorphItems.thighLength.label', minLabelKey: 'panel.bodyMorphItems.thighLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.thighLength.maxLabel' },
  { key: 'calves', icon: '🧦', labelKey: 'panel.bodyMorphItems.calves.label', minLabelKey: 'panel.bodyMorphItems.calves.minLabel', maxLabelKey: 'panel.bodyMorphItems.calves.maxLabel' },
  { key: 'calfLength', icon: '📏', labelKey: 'panel.bodyMorphItems.calfLength.label', minLabelKey: 'panel.bodyMorphItems.calfLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.calfLength.maxLabel' },
  { key: 'feet', icon: '👠', labelKey: 'panel.bodyMorphItems.feet.label', minLabelKey: 'panel.bodyMorphItems.feet.minLabel', maxLabelKey: 'panel.bodyMorphItems.feet.maxLabel' },
];

const DEV_DRAWER_STORAGE_KEY = 'xiaochun_dev_drawer_all_settings';

export interface DevDrawerFullSettings {
  bodyMorph: BodyMorphConfig;
  saturation: MaterialSaturationSettings;
  lights: {
    globalMult: number;
    dir: { enabled: boolean; base: number };
    hemi: { enabled: boolean; base: number };
    front: { enabled: boolean; base: number };
    fill: { enabled: boolean; base: number };
    leg: { enabled: boolean; base: number };
    arm: { enabled: boolean; base: number };
  };
  camera: {
    fov: number;
  };
  bodyTurnEnabled: boolean;
  wardrobeVisibility: Record<string, boolean>;
  activeExpr: string;
}

function loadDevDrawerSettings(): Partial<DevDrawerFullSettings> | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(DEV_DRAWER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[DevDrawer] Failed to load settings from storage:', e);
    return null;
  }
}

function saveDevDrawerSettings(settings: Partial<DevDrawerFullSettings>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = loadDevDrawerSettings() || {};
    const merged = { ...existing, ...settings };
    localStorage.setItem(DEV_DRAWER_STORAGE_KEY, JSON.stringify(merged));
  } catch (e) {
    console.warn('[DevDrawer] Failed to save settings to storage:', e);
  }
}

interface DevDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DevDrawer: React.FC<DevDrawerProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const initialSaved = React.useMemo(() => loadDevDrawerSettings(), []);

  const [activeExpr, setActiveExpr] = useState<string>(() => initialSaved?.activeExpr ?? 'neutral');
  const [globalLight, setGlobalLight] = useState<number>(
    () => initialSaved?.lights?.globalMult ?? vrmEngine.lightChannels.globalMult ?? APP_CONFIG.lights.globalMult
  );
  const [fov, setFov] = useState<number>(() => initialSaved?.camera?.fov ?? APP_CONFIG.camera.defaultFov);
  const [bodyMorph, setBodyMorph] = useState<BodyMorphConfig>(() => initialSaved?.bodyMorph ?? vrmEngine.getBodyMorphConfig());
  const [bodyTurnEnabled, setBodyTurnEnabled] = useState<boolean>(() => initialSaved?.bodyTurnEnabled ?? vrmEngine.getEnableBodyTurn());

  const handleToggleBodyTurn = () => {
    const next = !bodyTurnEnabled;
    setBodyTurnEnabled(next);
    vrmEngine.setEnableBodyTurn(next);
    saveDevDrawerSettings({ bodyTurnEnabled: next });
  };

  React.useEffect(() => {
    vrmEngine.setHeightRulerVisible(isOpen);
    return () => {
      vrmEngine.setHeightRulerVisible(false);
    };
  }, [isOpen]);

  const [channels, setChannels] = useState(() => {
    const l = initialSaved?.lights;
    return {
      dir: l?.dir ? { ...l.dir } : { ...vrmEngine.lightChannels.dir },
      hemi: l?.hemi ? { ...l.hemi } : { ...vrmEngine.lightChannels.hemi },
      front: l?.front ? { ...l.front } : { ...vrmEngine.lightChannels.front },
      fill: l?.fill ? { ...l.fill } : { ...vrmEngine.lightChannels.fill },
      leg: l?.leg ? { ...l.leg } : { ...vrmEngine.lightChannels.leg },
      arm: l?.arm ? { ...l.arm } : { ...vrmEngine.lightChannels.arm },
    };
  });

  const expressions = APP_CONFIG.expressions;

  const handleExpressionClick = (expr: string) => {
    setActiveExpr(expr);
    vrmEngine.setExpression(expr);
    saveDevDrawerSettings({ activeExpr: expr });
  };

  const handleChannelToggle = (key: keyof typeof channels) => {
    const next = { ...channels, [key]: { ...channels[key], enabled: !channels[key].enabled } };
    setChannels(next);
    vrmEngine.setLight(key, next[key].enabled, next[key].base);
    saveDevDrawerSettings({
      lights: {
        globalMult: globalLight,
        ...next,
      },
    });
  };

  const handleChannelBaseChange = (key: keyof typeof channels, val: number) => {
    const next = { ...channels, [key]: { ...channels[key], base: val } };
    setChannels(next);
    vrmEngine.setLight(key, next[key].enabled, val);
    saveDevDrawerSettings({
      lights: {
        globalMult: globalLight,
        ...next,
      },
    });
  };

  const handleGlobalLight = (val: number) => {
    setGlobalLight(val);
    vrmEngine.setGlobalLight(val);
    saveDevDrawerSettings({
      lights: {
        globalMult: val,
        ...channels,
      },
    });
  };

  const handleFov = (val: number) => {
    setFov(val);
    vrmEngine.setFov(val);
    saveDevDrawerSettings({ camera: { fov: val } });
  };

  const handleResetLights = () => {
    // ponytail: 一次性重置 6 个独立通道 + 全局光 + FOV 回 config.ts 默认
    const next = {
      dir: { ...APP_CONFIG.lights.dir },
      hemi: { ...APP_CONFIG.lights.hemi },
      front: { ...APP_CONFIG.lights.front },
      fill: { ...APP_CONFIG.lights.fill },
      leg: { ...APP_CONFIG.lights.leg },
      arm: { ...APP_CONFIG.lights.arm },
    };
    setChannels(next);
    setGlobalLight(APP_CONFIG.lights.globalMult);
    setFov(APP_CONFIG.camera.defaultFov);
    (Object.keys(next) as Array<keyof typeof next>).forEach((k) => {
      vrmEngine.setLight(k, next[k].enabled, next[k].base);
    });
    vrmEngine.setGlobalLight(APP_CONFIG.lights.globalMult);
    vrmEngine.setFov(APP_CONFIG.camera.defaultFov);
    saveDevDrawerSettings({
      lights: { globalMult: APP_CONFIG.lights.globalMult, ...next },
      camera: { fov: APP_CONFIG.camera.defaultFov },
    });
  };

  const [copied, setCopied] = useState(false);

  const handleBodyMorphChange = (part: BodyMorphPartKey, val: number) => {
    const next = { ...bodyMorph, [part]: val };
    setBodyMorph(next);
    vrmEngine.setBodyPartScale(part, val);
    saveDevDrawerSettings({ bodyMorph: next });
  };

  const handleResetBodyMorph = () => {
    vrmEngine.resetBodyMorph();
    const next = vrmEngine.getBodyMorphConfig();
    setBodyMorph(next);
    saveDevDrawerSettings({ bodyMorph: next });
  };

  const [matSat, setMatSat] = useState<MaterialSaturationSettings>(
    () => initialSaved?.saturation ?? { ...vrmEngine.materialSaturation }
  );

  const handleMatPreset = (presetKey: MaterialSaturationPresetKey) => {
    vrmEngine.applyMaterialPreset(presetKey);
    const next = { ...vrmEngine.materialSaturation };
    setMatSat(next);
    saveDevDrawerSettings({ saturation: next });
  };

  const handleMatSatParamChange = (key: keyof Omit<MaterialSaturationSettings, 'preset'>, val: number) => {
    const next = { ...matSat, [key]: val, preset: 'custom' as const };
    setMatSat(next);
    vrmEngine.setMaterialSaturation({ [key]: val, preset: 'custom' });
    saveDevDrawerSettings({ saturation: next });
  };

  const handleResetMatSat = () => {
    const defaults = { ...APP_CONFIG.saturation.default };
    vrmEngine.setMaterialSaturation(defaults);
    setMatSat(defaults);
    saveDevDrawerSettings({ saturation: defaults });
  };

  // 融合标准部位槽位与模型实际识别到的部位
  const availableParts = React.useMemo(() => {
    const detected = vrmEngine.materialManager.detectedParts;
    const map = new Map<string, (typeof MODEL_PARTS_CONFIG)[number]>();
    MODEL_PARTS_CONFIG.forEach((p) => map.set(p.id, p));
    detected.forEach((p) => map.set(p.id, p));
    return Array.from(map.values());
  }, [isOpen, vrmEngine.materialManager.detectedParts]);

  const [partVis, setPartVis] = useState<Record<string, boolean>>(
    () => initialSaved?.wardrobeVisibility ?? { ...vrmEngine.materialManager.partsVisibility }
  );

  React.useEffect(() => {
    if (isOpen) {
      setPartVis({ ...vrmEngine.materialManager.partsVisibility });
    }
  }, [isOpen]);

  const handlePartToggle = (partId: string, visible: boolean) => {
    vrmEngine.setPartVisibility(partId, visible);
    const next = { ...partVis, [partId]: visible };
    setPartVis(next);
    saveDevDrawerSettings({ wardrobeVisibility: next });
  };

  const handleResetToDefaultWardrobe = () => {
    vrmEngine.materialManager.resetToDefaultConfig();
    const next = { ...vrmEngine.materialManager.partsVisibility };
    setPartVis(next);
    saveDevDrawerSettings({ wardrobeVisibility: next });
  };

  const handleResetAllParts = () => {
    vrmEngine.resetAllPartsVisibility();
    const next: Record<string, boolean> = {};
    availableParts.forEach((p) => {
      next[p.id] = true;
    });
    setPartVis(next);
    saveDevDrawerSettings({ wardrobeVisibility: next });
  };

  const handleUndressCategory = (categoryId: string) => {
    const parts = availableParts.filter((p) => p.category === categoryId);
    parts.forEach((p) => {
      vrmEngine.setPartVisibility(p.id, false);
    });
    const next = { ...partVis };
    parts.forEach((p) => {
      next[p.id] = false;
    });
    setPartVis(next);
    saveDevDrawerSettings({ wardrobeVisibility: next });
  };

  const handleDressCategory = (categoryId: string) => {
    const parts = availableParts.filter((p) => p.category === categoryId);
    parts.forEach((p) => {
      vrmEngine.setPartVisibility(p.id, true);
    });
    const next = { ...partVis };
    parts.forEach((p) => {
      next[p.id] = true;
    });
    setPartVis(next);
    saveDevDrawerSettings({ wardrobeVisibility: next });
  };

  // 挂载时，把 localStorage 里的完整设置同步应用到 vrmEngine
  React.useEffect(() => {
    if (!initialSaved) return;
    if (initialSaved.bodyMorph) {
      vrmEngine.bodyMorph.setConfig(initialSaved.bodyMorph);
    }
    if (initialSaved.saturation) {
      vrmEngine.setMaterialSaturation(initialSaved.saturation);
    }
    if (initialSaved.lights) {
      vrmEngine.setGlobalLight(initialSaved.lights.globalMult);
      (['dir', 'hemi', 'front', 'fill', 'leg', 'arm'] as const).forEach((k) => {
        const ch = initialSaved.lights?.[k];
        if (ch) vrmEngine.setLight(k, ch.enabled, ch.base);
      });
    }
    if (initialSaved.camera?.fov) {
      vrmEngine.setFov(initialSaved.camera.fov);
    }
    if (typeof initialSaved.bodyTurnEnabled === 'boolean') {
      vrmEngine.setEnableBodyTurn(initialSaved.bodyTurnEnabled);
    }
    if (initialSaved.wardrobeVisibility) {
      Object.entries(initialSaved.wardrobeVisibility).forEach(([partId, vis]) => {
        vrmEngine.setPartVisibility(partId, vis);
      });
    }
    if (initialSaved.activeExpr && initialSaved.activeExpr !== 'neutral') {
      vrmEngine.setExpression(initialSaved.activeExpr);
    }
  }, [initialSaved]);

  /**
   * 复制 DevDrawer 所有的完整配置 JSON
   */
  const handleCopyConfig = async () => {
    const fullConfig: DevDrawerFullSettings = {
      bodyMorph,
      saturation: matSat,
      lights: {
        globalMult: globalLight,
        dir: channels.dir,
        hemi: channels.hemi,
        front: channels.front,
        fill: channels.fill,
        leg: channels.leg,
        arm: channels.arm,
      },
      camera: {
        fov,
      },
      bodyTurnEnabled,
      wardrobeVisibility: partVis,
      activeExpr,
    };
    const jsonStr = JSON.stringify(fullConfig, null, 2);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
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
  };

  /**
   * 重置全部配置到 config.ts 原生默认值并清除 localStorage
   */
  const handleResetAllToConfig = () => {
    // 1. 清空所有持久化缓存
    localStorage.removeItem(DEV_DRAWER_STORAGE_KEY);
    localStorage.removeItem('xiaochun_dev_body_morph');

    // 2. 骨骼体型重置
    vrmEngine.resetBodyMorph();
    setBodyMorph({ ...APP_CONFIG.bodyMorph.default });

    // 3. 材质饱和度重置
    const defaultSat = { ...APP_CONFIG.saturation.default };
    vrmEngine.setMaterialSaturation(defaultSat);
    setMatSat(defaultSat);

    // 4. 灯光系统重置
    const defaultLights = APP_CONFIG.lights;
    vrmEngine.setGlobalLight(defaultLights.globalMult);
    setGlobalLight(defaultLights.globalMult);
    const resetCh = {
      dir: { ...defaultLights.dir },
      hemi: { ...defaultLights.hemi },
      front: { ...defaultLights.front },
      fill: { ...defaultLights.fill },
      leg: { ...defaultLights.leg },
      arm: { ...defaultLights.arm },
    };
    setChannels(resetCh);
    (['dir', 'hemi', 'front', 'fill', 'leg', 'arm'] as const).forEach((k) => {
      vrmEngine.setLight(k, resetCh[k].enabled, resetCh[k].base);
    });

    // 5. 相机与动作重置
    vrmEngine.setFov(APP_CONFIG.camera.defaultFov);
    setFov(APP_CONFIG.camera.defaultFov);
    vrmEngine.setEnableBodyTurn(true);
    setBodyTurnEnabled(true);

    // 6. 服装部件重置为默认穿戴
    vrmEngine.materialManager.resetToDefaultConfig();
    setPartVis({ ...vrmEngine.materialManager.partsVisibility });

    // 7. 表情重置
    setActiveExpr('neutral');
    vrmEngine.setExpression('neutral');
  };

  return (
    <aside
      id="control-panel"
      className={`fixed top-0 right-0 bottom-0 z-40 w-84 max-w-[92vw] bg-slate-950/90 backdrop-blur-2xl border-l border-white/15 flex flex-col transition-transform duration-300 shadow-2xl ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* 吸顶头部 (Sticky Title Header) */}
      <div className="sticky top-0 z-20 flex justify-between items-center px-4 py-3 bg-slate-950/95 backdrop-blur-md border-b border-white/10 shrink-0">
        <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-white tracking-tight min-w-0">
          <Sliders className="w-3.5 h-3.5 text-brand-300 shrink-0" />
          <span className="truncate">{t('panel.title')}</span>
        </div>

        {/* 顶部快捷操作按钮组 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleCopyConfig}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white transition-all cursor-pointer active:scale-95"
            title={t('panel.devDrawerTips.copyConfig')}
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">{t('panel.devDrawerExtra.copySuccess')}</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-white/60" />
                <span>{t('panel.devDrawerExtra.copyConfig')}</span>
              </>
            )}
          </button>

          <button
            onClick={handleResetAllToConfig}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-amber-300 transition-all cursor-pointer active:scale-95"
            title={t('panel.devDrawerTips.clearCache')}
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t('panel.devDrawerExtra.reset')}</span>
          </button>

          {/* 小巧精致的关闭按钮 */}
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
              className={`py-2 px-1 rounded-xl text-xs font-medium cursor-pointer text-center select-none ${
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

      {/* 画面滤镜与调色 */}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10 min-w-0">
          <h3 className="text-xs font-semibold text-white/70 uppercase tracking-wider flex items-center gap-1.5 min-w-0 flex-1 truncate">
            <Palette className="w-3.5 h-3.5 text-brand-400 shrink-0" />
            <span className="truncate min-w-0">{t('panel.filterLabel')}</span>
          </h3>
          <button
            onClick={handleResetMatSat}
            title={t('panel.resetFilter')}
            className="flex items-center gap-1 text-[11px] text-white/40 hover:text-brand-300 transition-colors cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t('panel.resetFilter')}</span>
          </button>
        </div>

        {/* 预设风格胶囊 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-white/50">{t('panel.filterPresetsLabel')}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(['vibrant', 'sweet', 'cinematic', 'original'] as const).map((key) => (
              <button
                key={key}
                onClick={() => handleMatPreset(key)}
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

        {/* 材质分级微调滑块 */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-3">
          {/* 1. 服装与饰品 */}
          <div className="flex flex-col gap-1 min-w-0" title={`${t('panel.clothingSat')} | 当前 ${matSat.clothing.toFixed(2)} | 范围 [0.80, 2.00] | 默认 ${APP_CONFIG.saturation.default.clothing} | 步长 0.02`}>
            <div className="flex justify-between items-center gap-2 text-[11px] text-white/80 min-w-0">
              <span className="font-medium text-white/90 whitespace-nowrap truncate min-w-0 flex-1">{t('panel.clothingSat')}</span>
              <span className="text-brand-300 font-mono font-medium whitespace-nowrap shrink-0">{Math.round(matSat.clothing * 100)}%</span>
            </div>
            <SliderWithAnchors
              value={matSat.clothing}
              min={0.80} max={2.00} step={0.02}
              onChange={(v) => handleMatSatParamChange('clothing', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.saturation.default.clothing, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
            />
          </div>

          {/* 2. 头发发色 */}
          <div className="flex flex-col gap-1" title={`${t('panel.hairSat')} | 当前 ${matSat.hair.toFixed(2)} | 范围 [0.80, 2.00] | 默认 ${APP_CONFIG.saturation.default.hair} | 步长 0.02`}>
            <div className="flex justify-between items-center text-[11px] text-white/80">
              <span className="font-medium text-white/90 whitespace-nowrap">{t('panel.hairSat')}</span>
              <span className="text-brand-300 font-mono font-medium whitespace-nowrap shrink-0">{Math.round(matSat.hair * 100)}%</span>
            </div>
            <SliderWithAnchors
              value={matSat.hair}
              min={0.80} max={2.00} step={0.02}
              onChange={(v) => handleMatSatParamChange('hair', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.saturation.default.hair, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
            />
          </div>

          {/* 3. 瞳孔眼睛 */}
          <div className="flex flex-col gap-1" title={`${t('panel.eyesSat')} | 当前 ${matSat.eyes.toFixed(2)} | 范围 [0.80, 2.00] | 默认 ${APP_CONFIG.saturation.default.eyes} | 步长 0.02`}>
            <div className="flex justify-between items-center text-[11px] text-white/80">
              <span className="font-medium text-white/90 whitespace-nowrap">{t('panel.eyesSat')}</span>
              <span className="text-brand-300 font-mono font-medium whitespace-nowrap shrink-0">{Math.round(matSat.eyes * 100)}%</span>
            </div>
            <SliderWithAnchors
              value={matSat.eyes}
              min={0.80} max={2.00} step={0.02}
              onChange={(v) => handleMatSatParamChange('eyes', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.saturation.default.eyes, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
            />
          </div>

          {/* 4. 肤色饱和度 */}
          <div className="flex flex-col gap-1" title={`${t('panel.skinSat')} | 当前 ${matSat.skin.toFixed(2)} | 范围 [0.80, 1.30] | 默认 ${APP_CONFIG.saturation.default.skin} | 步长 0.01`}>
            <div className="flex justify-between items-center text-[11px] text-white/80">
              <span className="font-medium text-white/90 whitespace-nowrap">{t('panel.skinSat')}</span>
              <span className="text-brand-300 font-mono font-medium whitespace-nowrap shrink-0">{Math.round(matSat.skin * 100)}%</span>
            </div>
            <SliderWithAnchors
              value={matSat.skin}
              min={0.80} max={1.30} step={0.01}
              onChange={(v) => handleMatSatParamChange('skin', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.saturation.default.skin, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* 观察视角与角色朝向控制 (View & Rotation Lock) */}
      <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
        <div className="flex flex-col gap-0.5 max-w-[65%]">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white/90">
            <span>🔄</span>
            <span>{t('panel.devDrawerExtra.autoBodyTurn')}</span>
          </div>
          <span className="text-[10px] text-white/45 leading-relaxed">
            关闭后锁定朝向，可 360° 自由旋转视角观察背部与侧身细节
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleBodyTurn}
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
      </div>

      {/* 骨骼体型形变微调 (Bone Morphing) */}
      <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
        <div className="flex justify-between items-center gap-2 pb-2 border-b border-white/10 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-sm shrink-0">✨</span>
            <h3 className="text-xs font-semibold text-white/90 truncate min-w-0">{t('panel.devDrawerExtra.bodyMorphTitle')}</h3>
          </div>
          <button
            onClick={handleResetBodyMorph}
            className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white transition-colors cursor-pointer shrink-0"
            title={t('panel.devDrawerTips.resetBodyMorph')}
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t('panel.devDrawerExtra.reset')}</span>
          </button>
        </div>

        {/* 各部位独立调节滑块列表 */}
        <div className="flex flex-col gap-3">
          {BODY_MORPH_ITEMS.map((item) => {
            const limit = APP_CONFIG.bodyMorph.limits[item.key];
            const val = bodyMorph[item.key] ?? 1.0;
            const configDefault = APP_CONFIG.bodyMorph.default[item.key] ?? 1.0;
            const itemTitle = `${t(item.labelKey)} | 当前 ${val.toFixed(3)} | 范围 [${limit.min}, ${limit.max}] | 默认 ${configDefault} | 步长 ${limit.step}`;
            return (
              <div key={item.key} className="flex flex-col gap-1 min-w-0" title={itemTitle}>
                <div className="flex justify-between items-center gap-2 text-[11px] text-white/80 min-w-0">
                  <span className="font-medium text-white/90 whitespace-nowrap truncate min-w-0 flex-1">
                    {item.icon} {t(item.labelKey)}
                  </span>
                  <span className="text-brand-300 font-mono font-medium whitespace-nowrap shrink-0">
                    {item.key.includes('Pitch') || item.key.includes('Spread')
                      ? (val >= 0 ? `+${val.toFixed(3)}` : val.toFixed(3))
                      : `${Math.round(val * 100)}%`}
                  </span>
                </div>
                <SliderWithAnchors
                  value={val}
                  min={limit.min}
                  max={limit.max}
                  step={limit.step}
                  onChange={(v) => handleBodyMorphChange(item.key, v)}
                  anchors={[
                    {
                      value: item.key.includes('Pitch') || item.key.includes('Spread') ? 0.0 : 1.0,
                      label: t('panel.sliderAnchors.center'),
                      color: 'emerald',
                    },
                    { value: configDefault, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
                  ]}
                />
                {/* ponytail: 三个刻度文案按 slider 实际比例定位。
                    首尾用 left:0 / right:0 贴容器边,跟滑块 track 起止点对齐;
                    中间用 translateX(-50%) 居中在 centerPct 位置(对应 100% 或 0.00)。
                    不用 justify-between — 那个按容器平均分,跟滑块实际 min/center/max 位置错位
                    (例如 70-120 范围时 center=100 在 60% 而不是 50%)。 */}
                <div className="relative h-3 text-[9px] text-white/35 font-mono">
                  <span
                    className="absolute whitespace-nowrap left-0"
                  >
                    {t(item.minLabelKey)}
                  </span>
                  {(() => {
                    const centerValue = item.key.includes('Pitch') || item.key.includes('Spread') ? 0 : 1;
                    const centerPct = ((centerValue - limit.min) / (limit.max - limit.min)) * 100;
                    return (
                      <span
                        className="absolute whitespace-nowrap -translate-x-1/2"
                        style={{ left: `calc(${centerPct}% + ${thumbInBoundsOffset(centerPct)}px)` }}
                      >
                        {item.key.includes('Pitch') || item.key.includes('Spread') ? '0.00' : '100%'}
                      </span>
                    );
                  })()}
                  <span
                    className="absolute whitespace-nowrap right-0"
                  >
                    {t(item.maxLabelKey)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 模型全部件分类穿脱/遮罩测试 */}
      <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
        <div className="flex justify-between items-center gap-2 pb-2 border-b border-white/10 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-sm shrink-0">🧩</span>
            <h3 className="text-xs font-semibold text-white/90 truncate min-w-0">{t('panel.devDrawer.partDebuggingTitle')}</h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleResetToDefaultWardrobe}
              className="text-[10px] text-white/70 hover:text-white border border-white/20 hover:border-white/40 bg-white/5 px-2 py-0.5 rounded transition-all active:scale-95"
              title={t('panel.devDrawerTips.restoreWardrobe')}
            >
              配置预设
            </button>
            <button
              onClick={handleResetAllParts}
              className="text-[10px] text-brand-300 hover:text-brand-200 border border-brand-500/30 hover:border-brand-400/50 bg-brand-500/10 px-2 py-0.5 rounded transition-all active:scale-95"
            >
              {t('panel.devDrawer.showAllParts')}
            </button>
          </div>
        </div>

        {MODEL_PART_CATEGORIES.map((cat) => {
          const parts = availableParts.filter((p) => p.category === cat.id);
          if (parts.length === 0) return null;
          const equippedCount = parts.filter(
            (p) => (vrmEngine.materialManager.partMaterials[p.id]?.length ?? 0) > 0
          ).length;

          return (
            <div key={cat.id} className="flex flex-col gap-1.5 pt-1.5">
              <div className="flex items-center justify-between text-[11px] font-medium text-white/70">
                <div className="flex items-center gap-1">
                  <span>{cat.icon}</span>
                  <span className="font-semibold text-white/80">{t(cat.label)}</span>
                  <span className="text-[10px] text-white/35 font-mono">
                    ({equippedCount > 0 ? t('panel.devDrawer.equipped', { count: equippedCount }) : t('panel.devDrawer.notEquipped')})
                  </span>
                </div>
                {equippedCount > 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleUndressCategory(cat.id)}
                      className="text-[9px] text-amber-300/80 hover:text-amber-200 border border-amber-500/30 hover:border-amber-400/50 bg-amber-500/10 px-1.5 py-0.5 rounded transition-all active:scale-95"
                      title={t('panel.devDrawer.undressCategory', { category: t(cat.label) })}
                    >
                      {t('panel.devDrawer.undressAll')}
                    </button>
                    <button
                      onClick={() => handleDressCategory(cat.id)}
                      className="text-[9px] text-emerald-300/80 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-400/50 bg-emerald-500/10 px-1.5 py-0.5 rounded transition-all active:scale-95"
                      title={t('panel.devDrawer.dressCategory', { category: t(cat.label) })}
                    >
                      {t('panel.devDrawer.dressAll')}
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {parts.map((p) => {
                  const hasMaterials = (vrmEngine.materialManager.partMaterials[p.id]?.length ?? 0) > 0;
                  const isVisible = partVis[p.id] ?? true;

                  if (!hasMaterials) {
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg border border-dashed border-white/5 bg-white/[0.01] text-white/25 select-none"
                        title={t('panel.devDrawer.partNotLoaded', { part: t(p.label) })}
                      >
                        <span className="truncate text-[11px]">
                          {p.icon} {t(p.label)}
                        </span>
                        <span className="text-[9px] text-white/20 shrink-0 font-mono">{t('panel.devDrawer.notEquipped')}</span>
                      </div>
                    );
                  }

                  return (
                    <label
                      key={p.id}
                      className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg border transition-all cursor-pointer select-none ${
                        isVisible
                          ? 'bg-white/10 border-white/20 text-white/90 shadow-sm hover:border-brand-400/40'
                          : 'bg-white/[0.02] border-white/10 text-white/35 line-through decoration-white/30 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={(e) => handlePartToggle(p.id, e.target.checked)}
                          className="accent-brand-400 cursor-pointer w-3.5 h-3.5 shrink-0"
                        />
                        <span className="truncate text-[11px]" title={t(p.label)}>
                          {p.icon} {t(p.label)}
                        </span>
                      </div>
                      <span
                        className={`text-[9px] px-1 py-0.2 rounded font-mono shrink-0 ${
                          isVisible
                            ? 'text-brand-300 bg-brand-500/10'
                            : 'text-amber-300/60 bg-amber-500/5'
                        }`}
                      >
                        {isVisible ? t('panel.devDrawer.wearing') : t('panel.devDrawer.undressed')}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 独立光照通道控制 */}
      <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
        <div className="flex justify-between items-center gap-2 pb-2 border-b border-white/10 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <h3 className="text-xs font-semibold text-white/90 truncate min-w-0">{t('panel.lightsLabel')}</h3>
          </div>
          <button
            onClick={handleResetLights}
            title={t('panel.devDrawerTips.clearCache')}
            className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t('panel.devDrawerExtra.reset')}</span>
          </button>
        </div>

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
          <div className="flex flex-col gap-1" title={`${t('panel.lightChannels.dir')} | 当前 ${channels.dir.base.toFixed(2)} | 范围 [0.00, 2.50] | 默认 ${APP_CONFIG.lights.dir.base} | 步长 0.05`}>
            <div className="flex justify-between items-center gap-2 text-[11px] text-white/50 min-w-0">
              <span className="truncate min-w-0">{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono shrink-0">{channels.dir.base.toFixed(2)}</span>
            </div>
            <SliderWithAnchors
              value={channels.dir.base}
              min={0.0} max={2.5} step={0.05}
              onChange={(v) => handleChannelBaseChange('dir', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.lights.dir.base, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
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
          <div className="flex flex-col gap-1" title={`${t('panel.lightChannels.hemi')} | 当前 ${channels.hemi.base.toFixed(2)} | 范围 [0.00, 2.00] | 默认 ${APP_CONFIG.lights.hemi.base} | 步长 0.05`}>
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.hemi.base.toFixed(2)}</span>
            </div>
            <SliderWithAnchors
              value={channels.hemi.base}
              min={0.0} max={2.0} step={0.05}
              onChange={(v) => handleChannelBaseChange('hemi', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.lights.hemi.base, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
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
          <div className="flex flex-col gap-1" title={`${t('panel.lightChannels.front')} | 当前 ${channels.front.base.toFixed(2)} | 范围 [0.00, 2.00] | 默认 ${APP_CONFIG.lights.front.base} | 步长 0.05`}>
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.front.base.toFixed(2)}</span>
            </div>
            <SliderWithAnchors
              value={channels.front.base}
              min={0.0} max={2.0} step={0.05}
              onChange={(v) => handleChannelBaseChange('front', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.lights.front.base, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
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
          <div className="flex flex-col gap-1" title={`${t('panel.lightChannels.fill')} | 当前 ${channels.fill.base.toFixed(2)} | 范围 [0.00, 1.50] | 默认 ${APP_CONFIG.lights.fill.base} | 步长 0.02`}>
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.fill.base.toFixed(2)}</span>
            </div>
            <SliderWithAnchors
              value={channels.fill.base}
              min={0.0} max={1.5} step={0.02}
              onChange={(v) => handleChannelBaseChange('fill', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.lights.fill.base, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
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
          <div className="flex flex-col gap-1" title={`${t('panel.lightChannels.leg')} | 当前 ${channels.leg.base.toFixed(2)} | 范围 [0.00, 2.00] | 默认 ${APP_CONFIG.lights.leg.base} | 步长 0.05`}>
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.leg.base.toFixed(2)}</span>
            </div>
            <SliderWithAnchors
              value={channels.leg.base}
              min={0.0} max={2.0} step={0.05}
              onChange={(v) => handleChannelBaseChange('leg', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.lights.leg.base, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
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
          <div className="flex flex-col gap-1" title={`${t('panel.lightChannels.arm')} | 当前 ${channels.arm.base.toFixed(2)} | 范围 [0.00, 2.00] | 默认 ${APP_CONFIG.lights.arm.base} | 步长 0.05`}>
            <div className="flex justify-between text-[11px] text-white/50">
              <span>{t('panel.brightness')}</span>
              <span className="text-brand-300 font-mono">{channels.arm.base.toFixed(2)}</span>
            </div>
            <SliderWithAnchors
              value={channels.arm.base}
              min={0.0} max={2.0} step={0.05}
              onChange={(v) => handleChannelBaseChange('arm', v)}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.lights.arm.base, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
            />
          </div>
        </div>

        {/* 全局倍率与 FOV */}
        <div className="pt-3 border-t border-dashed border-white/15 flex flex-col gap-3">
          <div className="flex flex-col gap-1" title={`${t('panel.globalLight')} | 当前 ${globalLight.toFixed(2)} | 范围 [0.20, 2.50] | 默认 ${APP_CONFIG.lights.globalMult} | 步长 0.10`}>
            <div className="flex justify-between text-[11px] text-white/70">
              <span>{t('panel.globalLight')}</span>
              <span className="text-brand-300 font-mono">{globalLight.toFixed(1)}</span>
            </div>
            <SliderWithAnchors
              value={globalLight}
              min={0.2} max={2.5} step={0.1}
              onChange={handleGlobalLight}
              anchors={[
                { value: 1.0, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                { value: APP_CONFIG.lights.globalMult, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1" title={`${t('panel.fov')} | 当前 ${fov}° | 范围 [15, 60] | 默认 ${APP_CONFIG.camera.defaultFov}° | 步长 1`}>
            <div className="flex justify-between text-[11px] text-white/70">
              <span>{t('panel.fov')}</span>
              <span className="text-brand-300 font-mono">{fov}°</span>
            </div>
            <SliderWithAnchors
              value={fov}
              min={15} max={60} step={1}
              onChange={(v) => handleFov(Math.round(v))}
              anchors={[
                { value: 30, label: t('panel.sliderAnchors.fov30'), color: 'emerald' },
                { value: APP_CONFIG.camera.defaultFov, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
              ]}
            />
          </div>
        </div>
      </div>
      </div>
    </aside>
  );
};
