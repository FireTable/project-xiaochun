import React, { useEffect, useMemo, useRef, useState } from 'react';
import { vrmEngine } from '@/core/vrmEngine';
import { APP_CONFIG, type BodyMorphConfig, type BodyMorphPartKey } from '@/config';
import { SliderWithAnchors, thumbInBoundsOffset } from '@/components/SliderWithAnchors';
import { Search, Copy, RotateCcw } from '@/components/icons';
import { WEARING_OUTFIT_KEY } from '@/lib/constants';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { saveDevDrawerSettings, loadDevDrawerSettings } from '../storage';

interface BoneMorphItem {
  key: BodyMorphPartKey;
  icon: string;
  category: 'overall' | 'head' | 'torso' | 'hips' | 'bust' | 'arms' | 'legs';
  labelKey: string;
  minLabelKey: string;
  maxLabelKey: string;
}

const ITEMS: BoneMorphItem[] = [
  // 整体
  { key: 'overallScale', icon: '🧍', category: 'overall', labelKey: 'panel.bodyMorphItems.overallScale.label', minLabelKey: 'panel.bodyMorphItems.overallScale.minLabel', maxLabelKey: 'panel.bodyMorphItems.overallScale.maxLabel' },
  // 头颈
  { key: 'head', icon: '👧', category: 'head', labelKey: 'panel.bodyMorphItems.head.label', minLabelKey: 'panel.bodyMorphItems.head.minLabel', maxLabelKey: 'panel.bodyMorphItems.head.maxLabel' },
  { key: 'neck', icon: '🦒', category: 'head', labelKey: 'panel.bodyMorphItems.neck.label', minLabelKey: 'panel.bodyMorphItems.neck.minLabel', maxLabelKey: 'panel.bodyMorphItems.neck.maxLabel' },
  { key: 'neckDepth', icon: '🦢', category: 'head', labelKey: 'panel.bodyMorphItems.neckDepth.label', minLabelKey: 'panel.bodyMorphItems.neckDepth.minLabel', maxLabelKey: 'panel.bodyMorphItems.neckDepth.maxLabel' },
  { key: 'neckLength', icon: '📏', category: 'head', labelKey: 'panel.bodyMorphItems.neckLength.label', minLabelKey: 'panel.bodyMorphItems.neckLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.neckLength.maxLabel' },
  // 躯干
  { key: 'shoulderWidth', icon: '🤸', category: 'torso', labelKey: 'panel.bodyMorphItems.shoulderWidth.label', minLabelKey: 'panel.bodyMorphItems.shoulderWidth.minLabel', maxLabelKey: 'panel.bodyMorphItems.shoulderWidth.maxLabel' },
  { key: 'torsoLength', icon: '📐', category: 'torso', labelKey: 'panel.bodyMorphItems.torsoLength.label', minLabelKey: 'panel.bodyMorphItems.torsoLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.torsoLength.maxLabel' },
  { key: 'torsoThickness', icon: '🎽', category: 'torso', labelKey: 'panel.bodyMorphItems.torsoThickness.label', minLabelKey: 'panel.bodyMorphItems.torsoThickness.minLabel', maxLabelKey: 'panel.bodyMorphItems.torsoThickness.maxLabel' },
  { key: 'waist', icon: '⏳', category: 'torso', labelKey: 'panel.bodyMorphItems.waist.label', minLabelKey: 'panel.bodyMorphItems.waist.minLabel', maxLabelKey: 'panel.bodyMorphItems.waist.maxLabel' },
  { key: 'belly', icon: '🥟', category: 'torso', labelKey: 'panel.bodyMorphItems.belly.label', minLabelKey: 'panel.bodyMorphItems.belly.minLabel', maxLabelKey: 'panel.bodyMorphItems.belly.maxLabel' },
  // 臀部
  { key: 'hips', icon: '🩱', category: 'hips', labelKey: 'panel.bodyMorphItems.hips.label', minLabelKey: 'panel.bodyMorphItems.hips.minLabel', maxLabelKey: 'panel.bodyMorphItems.hips.maxLabel' },
  { key: 'buttocks', icon: '🍑', category: 'hips', labelKey: 'panel.bodyMorphItems.buttocks.label', minLabelKey: 'panel.bodyMorphItems.buttocks.minLabel', maxLabelKey: 'panel.bodyMorphItems.buttocks.maxLabel' },
  { key: 'buttocksThickness', icon: '🍑', category: 'hips', labelKey: 'panel.bodyMorphItems.buttocksThickness.label', minLabelKey: 'panel.bodyMorphItems.buttocksThickness.minLabel', maxLabelKey: 'panel.bodyMorphItems.buttocksThickness.maxLabel' },
  { key: 'buttocksPitch', icon: '↕️', category: 'hips', labelKey: 'panel.bodyMorphItems.buttocksPitch.label', minLabelKey: 'panel.bodyMorphItems.buttocksPitch.minLabel', maxLabelKey: 'panel.bodyMorphItems.buttocksPitch.maxLabel' },
  { key: 'buttocksSpread', icon: '↔️', category: 'hips', labelKey: 'panel.bodyMorphItems.buttocksSpread.label', minLabelKey: 'panel.bodyMorphItems.buttocksSpread.minLabel', maxLabelKey: 'panel.bodyMorphItems.buttocksSpread.maxLabel' },
  // 胸部
  { key: 'bust', icon: '🍈', category: 'bust', labelKey: 'panel.bodyMorphItems.bust.label', minLabelKey: 'panel.bodyMorphItems.bust.minLabel', maxLabelKey: 'panel.bodyMorphItems.bust.maxLabel' },
  { key: 'bustThickness', icon: '🫧', category: 'bust', labelKey: 'panel.bodyMorphItems.bustThickness.label', minLabelKey: 'panel.bodyMorphItems.bustThickness.minLabel', maxLabelKey: 'panel.bodyMorphItems.bustThickness.maxLabel' },
  { key: 'bustPitch', icon: '↕️', category: 'bust', labelKey: 'panel.bodyMorphItems.bustPitch.label', minLabelKey: 'panel.bodyMorphItems.bustPitch.minLabel', maxLabelKey: 'panel.bodyMorphItems.bustPitch.maxLabel' },
  { key: 'bustSpread', icon: '↔️', category: 'bust', labelKey: 'panel.bodyMorphItems.bustSpread.label', minLabelKey: 'panel.bodyMorphItems.bustSpread.minLabel', maxLabelKey: 'panel.bodyMorphItems.bustSpread.maxLabel' },
  // 上肢
  { key: 'arms', icon: '💪', category: 'arms', labelKey: 'panel.bodyMorphItems.arms.label', minLabelKey: 'panel.bodyMorphItems.arms.minLabel', maxLabelKey: 'panel.bodyMorphItems.arms.maxLabel' },
  { key: 'armLength', icon: '📐', category: 'arms', labelKey: 'panel.bodyMorphItems.armLength.label', minLabelKey: 'panel.bodyMorphItems.armLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.armLength.maxLabel' },
  { key: 'hands', icon: '🖐️', category: 'arms', labelKey: 'panel.bodyMorphItems.hands.label', minLabelKey: 'panel.bodyMorphItems.hands.minLabel', maxLabelKey: 'panel.bodyMorphItems.hands.maxLabel' },
  { key: 'fingerWidth', icon: '🤞', category: 'arms', labelKey: 'panel.bodyMorphItems.fingerWidth.label', minLabelKey: 'panel.bodyMorphItems.fingerWidth.minLabel', maxLabelKey: 'panel.bodyMorphItems.fingerWidth.maxLabel' },
  // 下肢
  { key: 'thighs', icon: '🦵', category: 'legs', labelKey: 'panel.bodyMorphItems.thighs.label', minLabelKey: 'panel.bodyMorphItems.thighs.minLabel', maxLabelKey: 'panel.bodyMorphItems.thighs.maxLabel' },
  { key: 'thighLength', icon: '📐', category: 'legs', labelKey: 'panel.bodyMorphItems.thighLength.label', minLabelKey: 'panel.bodyMorphItems.thighLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.thighLength.maxLabel' },
  { key: 'calves', icon: '🧦', category: 'legs', labelKey: 'panel.bodyMorphItems.calves.label', minLabelKey: 'panel.bodyMorphItems.calves.minLabel', maxLabelKey: 'panel.bodyMorphItems.calves.maxLabel' },
  { key: 'calfLength', icon: '📏', category: 'legs', labelKey: 'panel.bodyMorphItems.calfLength.label', minLabelKey: 'panel.bodyMorphItems.calfLength.minLabel', maxLabelKey: 'panel.bodyMorphItems.calfLength.maxLabel' },
  { key: 'feet', icon: '👠', category: 'legs', labelKey: 'panel.bodyMorphItems.feet.label', minLabelKey: 'panel.bodyMorphItems.feet.minLabel', maxLabelKey: 'panel.bodyMorphItems.feet.maxLabel' },
];

const CATEGORIES: { id: BoneMorphItem['category']; labelKey: string; icon: string }[] = [
  { id: 'overall', labelKey: 'panel.boneMorphCategories.overall', icon: '🧍' },
  { id: 'head',    labelKey: 'panel.boneMorphCategories.head',    icon: '🧠' },
  { id: 'torso',   labelKey: 'panel.boneMorphCategories.torso',   icon: '🦴' },
  { id: 'hips',    labelKey: 'panel.boneMorphCategories.hips',    icon: '🍑' },
  { id: 'bust',    labelKey: 'panel.boneMorphCategories.bust',    icon: '🍈' },
  { id: 'arms',    labelKey: 'panel.boneMorphCategories.arms',    icon: '💪' },
  { id: 'legs',    labelKey: 'panel.boneMorphCategories.legs',    icon: '🦵' },
];

/**
 * 28 个骨骼体型 slider + 选项卡 (全局基准 vs 当前服装特化) + 搜索框 + 差量导出与重置。
 */
export const BoneMorphSection: React.FC = () => {
  const { t, recordChange, showToast } = useDevDrawer();

  // 当前选中的 Tab: 'global' (全局基准) | 'outfit' (当前服装特化)
  const [activeTab, setActiveTab] = useState<'global' | 'outfit'>('global');

  // 当前穿戴的服装 key (如 'xiaochun_dinner_dress' 或 null 为 base)
  const [currentOutfitKey, setCurrentOutfitKey] = useState<string | null>(() => {
    if (vrmEngine.currentOutfitKey !== undefined && vrmEngine.currentOutfitKey !== null) {
      return vrmEngine.currentOutfitKey;
    }
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(WEARING_OUTFIT_KEY);
      if (saved && saved in APP_CONFIG.model.addons) return saved;
      if (saved === '__upload__') return '__upload__';
    }
    const defaultEntry = Object.entries(APP_CONFIG.model.addons).find(([, a]) => a.default);
    return defaultEntry ? defaultEntry[0] : null;
  });

  // 全局基准配置 (对应 APP_CONFIG.bodyMorph.default 与 localStorage.bodyMorph)
  const [globalBodyMorph, setGlobalBodyMorph] = useState<BodyMorphConfig>(() => {
    return loadDevDrawerSettings()?.bodyMorph ?? { ...APP_CONFIG.bodyMorph.default };
  });

  // 各套服装特化配置字典 (outfitKey -> partial config)
  const [outfitOverrides, setOutfitOverrides] = useState<Record<string, Partial<BodyMorphConfig>>>(() => {
    return loadDevDrawerSettings()?.outfitBodyMorph ?? {};
  });

  // 监听换装事件，保持 currentOutfitKey 同步
  useEffect(() => {
    return vrmEngine.onOutfitChange((key) => {
      setCurrentOutfitKey(key);
    });
  }, []);

  // 挂载时锁定一份基线用于计算 modified dot
  const initialBaseline = useRef<BodyMorphConfig>(globalBodyMorph);

  // 每个 slider 的 display span 一个稳定 ref
  const liveRefs = useRef<Record<string, React.RefObject<HTMLSpanElement | null>>>({});
  const getRef = (key: string) => {
    if (!liveRefs.current[key]) liveRefs.current[key] = React.createRef<HTMLSpanElement>();
    return liveRefs.current[key];
  };

  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    return ITEMS.filter(item => t(item.labelKey).toLowerCase().includes(q));
  }, [query, t]);

  // 当前服装的有效身材配置 (全局基准 + config.addons[key]?.bodyMorph + 用户针对该服装的调试 override)
  const activeOutfitMorph = useMemo<BodyMorphConfig>(() => {
    const addonConfigMorph = currentOutfitKey ? APP_CONFIG.model.addons[currentOutfitKey]?.bodyMorph : null;
    const userOutfitOverride = currentOutfitKey ? outfitOverrides[currentOutfitKey] : null;
    return {
      ...globalBodyMorph,
      ...(addonConfigMorph || {}),
      ...(userOutfitOverride || {}),
    };
  }, [globalBodyMorph, currentOutfitKey, outfitOverrides]);

  // 当前 Tab 下活跃的身材配置
  const displayedMorph = activeTab === 'global' ? globalBodyMorph : activeOutfitMorph;

  // 计算当前服装相比全局基准发生特化覆盖的参数清单
  const outfitDiffKeys = useMemo(() => {
    return ITEMS.filter((it) => {
      const gVal = globalBodyMorph[it.key] ?? APP_CONFIG.bodyMorph.default[it.key] ?? 1.0;
      const oVal = activeOutfitMorph[it.key] ?? gVal;
      return Math.abs(oVal - gVal) >= 1e-4;
    });
  }, [globalBodyMorph, activeOutfitMorph]);

  const outfitDiffCount = outfitDiffKeys.length;

  // 服装展示名称
  const currentOutfitDisplayName = useMemo(() => {
    if (!currentOutfitKey) return t('panel.devDrawerExtra.baseModelLabel');
    if (currentOutfitKey === '__upload__') return t('panel.devDrawerExtra.uploadModelLabel');
    return APP_CONFIG.model.addons[currentOutfitKey]?.name ?? currentOutfitKey;
  }, [currentOutfitKey, t]);

  // Tab 切换时把对应态的值刷新给 engine
  const handleTabSwitch = (tab: 'global' | 'outfit') => {
    setActiveTab(tab);
    const target = tab === 'global' ? globalBodyMorph : activeOutfitMorph;
    vrmEngine.bodyMorph.setConfig(target);
    ITEMS.forEach((it) => {
      const span = liveRefs.current[it.key]?.current;
      if (span) {
        const val = target[it.key] ?? 1.0;
        const isOffset = it.key.includes('Pitch') || it.key.includes('Spread');
        span.textContent = isOffset ? (val >= 0 ? `+${val.toFixed(3)}` : val.toFixed(3)) : `${Math.round(val * 100)}%`;
      }
    });
  };

  // Slider 拖拽每帧回调 (极速写入 3D Engine，不重绘 React)
  const handleSliderTick = (part: BodyMorphPartKey, val: number) => {
    vrmEngine.setBodyPartScale(part, val);
  };

  // Slider 释放提交 (写入 React State 与 localStorage)
  const handleChange = (part: BodyMorphPartKey, val: number) => {
    const prev = displayedMorph[part] ?? 1.0;
    if (Math.abs(prev - val) < 1e-4) return;

    if (activeTab === 'global') {
      const nextGlobal = { ...globalBodyMorph, [part]: val };
      setGlobalBodyMorph(nextGlobal);
      saveDevDrawerSettings({ bodyMorph: nextGlobal });
    } else {
      if (currentOutfitKey) {
        const currentOutfitPartOverrides = outfitOverrides[currentOutfitKey] || {};
        const nextPartOverrides = { ...currentOutfitPartOverrides, [part]: val };
        const nextAllOverrides = { ...outfitOverrides, [currentOutfitKey]: nextPartOverrides };
        setOutfitOverrides(nextAllOverrides);
        saveDevDrawerSettings({ outfitBodyMorph: nextAllOverrides });
      }
    }

    const item = ITEMS.find((it) => it.key === part);
    const label = item ? t(item.labelKey) : part;
    const prevPct = Math.round(prev * 100);
    const nextPct = Math.round(val * 100);

    recordChange({
      id: `morph-${activeTab}-${part}-${Date.now()}`,
      description: `${label}: ${nextPct}% → ${prevPct}%`,
      undo: () => {
        vrmEngine.setBodyPartScale(part, prev);
        if (activeTab === 'global') {
          setGlobalBodyMorph((curr) => {
            const u = { ...curr, [part]: prev };
            saveDevDrawerSettings({ bodyMorph: u });
            return u;
          });
        } else if (currentOutfitKey) {
          setOutfitOverrides((curr) => {
            const partO = { ...(curr[currentOutfitKey] || {}), [part]: prev };
            const u = { ...curr, [currentOutfitKey]: partO };
            saveDevDrawerSettings({ outfitBodyMorph: u });
            return u;
          });
        }
        if (liveRefs.current[part]?.current) {
          liveRefs.current[part].current.textContent = `${prevPct}%`;
        }
      },
      redo: () => {
        vrmEngine.setBodyPartScale(part, val);
        if (activeTab === 'global') {
          setGlobalBodyMorph((curr) => {
            const u = { ...curr, [part]: val };
            saveDevDrawerSettings({ bodyMorph: u });
            return u;
          });
        } else if (currentOutfitKey) {
          setOutfitOverrides((curr) => {
            const partO = { ...(curr[currentOutfitKey] || {}), [part]: val };
            const u = { ...curr, [currentOutfitKey]: partO };
            saveDevDrawerSettings({ outfitBodyMorph: u });
            return u;
          });
        }
        if (liveRefs.current[part]?.current) {
          liveRefs.current[part].current.textContent = `${nextPct}%`;
        }
      },
    });
  };

  // 复制当前服装的差量属性 (Diff Only)
  const handleCopyOutfitDiff = () => {
    const diff: Record<string, number> = {};
    outfitDiffKeys.forEach((it) => {
      const val = activeOutfitMorph[it.key];
      diff[it.key] = Number(val.toFixed(3));
    });

    const diffJson = JSON.stringify({ bodyMorph: diff }, null, 2);
    navigator.clipboard.writeText(diffJson).then(() => {
      showToast(t('panel.devDrawerExtra.copyDiffSuccess'));
    }).catch(() => {
      showToast('复制失败');
    });
  };

  // 复制全局完整配置
  const handleCopyGlobal = () => {
    const json = JSON.stringify({ bodyMorph: globalBodyMorph }, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      showToast(t('panel.devDrawerExtra.copySuccess'));
    }).catch(() => {
      showToast('复制失败');
    });
  };

  // 清除当前服装的特化设置，恢复继承全局
  const handleResetOutfitToGlobal = () => {
    if (!currentOutfitKey) return;
    const prevOutfitOverrides = { ...outfitOverrides };
    const nextAll = { ...outfitOverrides };
    delete nextAll[currentOutfitKey];
    setOutfitOverrides(nextAll);
    saveDevDrawerSettings({ outfitBodyMorph: nextAll });

    const baseline = vrmEngine.getOutfitBaselineMorph(currentOutfitKey);
    vrmEngine.bodyMorph.setConfig(baseline);
    showToast(t('panel.devDrawerExtra.resetOutfitMorph'));

    recordChange({
      id: `morph-reset-outfit-${Date.now()}`,
      description: `${currentOutfitDisplayName} (${t('panel.devDrawerExtra.reset')})`,
      undo: () => {
        setOutfitOverrides(prevOutfitOverrides);
        saveDevDrawerSettings({ outfitBodyMorph: prevOutfitOverrides });
        vrmEngine.bodyMorph.setConfig(activeOutfitMorph);
      },
      redo: () => {
        setOutfitOverrides(nextAll);
        saveDevDrawerSettings({ outfitBodyMorph: nextAll });
        vrmEngine.bodyMorph.setConfig(baseline);
      },
    });
  };

  // 重置全局基准
  const handleResetGlobal = () => {
    const prevMorph = { ...globalBodyMorph };
    const defaultMorph = { ...APP_CONFIG.bodyMorph.default };
    setGlobalBodyMorph(defaultMorph);
    initialBaseline.current = defaultMorph;
    saveDevDrawerSettings({ bodyMorph: defaultMorph });
    vrmEngine.bodyMorph.setConfig(defaultMorph);
    showToast(`${t('panel.devDrawerExtra.bodyMorphTitle')} ${t('panel.devDrawerExtra.reset')}`);

    recordChange({
      id: `morph-reset-global-${Date.now()}`,
      description: `${t('panel.devDrawerExtra.bodyMorphTitle')} (${t('panel.devDrawerExtra.reset')})`,
      undo: () => {
        setGlobalBodyMorph(prevMorph);
        saveDevDrawerSettings({ bodyMorph: prevMorph });
        vrmEngine.bodyMorph.setConfig(prevMorph);
      },
      redo: () => {
        setGlobalBodyMorph(defaultMorph);
        saveDevDrawerSettings({ bodyMorph: defaultMorph });
        vrmEngine.bodyMorph.setConfig(defaultMorph);
      },
    });
  };

  const modified = activeTab === 'global'
    ? ITEMS.some(item => {
        const init = initialBaseline.current[item.key] ?? 1.0;
        return Math.abs((globalBodyMorph[item.key] ?? 1.0) - init) >= 1e-4;
      })
    : outfitDiffCount > 0;

  return (
    <SectionCard id="bodyMorph">
      <SectionHeader
        id="bodyMorph"
        title={t('panel.devDrawerExtra.bodyMorphTitle')}
        modified={modified}
        onReset={activeTab === 'global' ? handleResetGlobal : handleResetOutfitToGlobal}
        showReset={modified}
        uppercase={false}
      />

      {/* 选项卡切换: 全局基准 vs 当前服装 */}
      <div className="flex items-center p-0.5 rounded-lg bg-white/5 border border-white/10 text-xs">
        <button
          type="button"
          onClick={() => handleTabSwitch('global')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-all cursor-pointer active:scale-95 ${
            activeTab === 'global'
              ? 'bg-brand-500/25 text-brand-200 border border-brand-400/30 shadow-sm'
              : 'text-white/60 hover:text-white/90 hover:bg-white/5'
          }`}
        >
          <span>🌐</span>
          <span>{t('panel.devDrawerExtra.morphTabGlobal')}</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabSwitch('outfit')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-all truncate px-2 cursor-pointer active:scale-95 ${
            activeTab === 'outfit'
              ? 'bg-brand-500/25 text-brand-200 border border-brand-400/30 shadow-sm'
              : 'text-white/60 hover:text-white/90 hover:bg-white/5'
          }`}
        >
          <span>👗</span>
          <span className="truncate">{currentOutfitDisplayName}</span>
          {outfitDiffCount > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-brand-400/30 text-brand-200 font-mono font-bold">
              {outfitDiffCount}
            </span>
          )}
        </button>
      </div>

      {/* 快捷操作与状态栏 */}
      <div className="flex items-center justify-between gap-2 px-1 py-1 rounded-md bg-white/[0.02] border border-white/5 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0 text-white/65">
          {activeTab === 'outfit' ? (
            <>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${outfitDiffCount > 0 ? 'bg-brand-400 animate-pulse' : 'bg-white/20'}`} />
              <span className="truncate">
                {outfitDiffCount > 0
                  ? t('panel.devDrawerExtra.outfitDiffHint', { count: outfitDiffCount })
                  : t('panel.devDrawerExtra.outfitNoDiffHint')}
              </span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="truncate">{t('panel.devDrawerTips.copyConfig')}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {activeTab === 'outfit' ? (
            <>
              <button
                type="button"
                onClick={handleCopyOutfitDiff}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 border border-white/15 text-white/90 hover:text-white transition-all text-[11px] font-medium active:scale-95 cursor-pointer"
                title={t('panel.devDrawerExtra.copyDiffConfig')}
              >
                <Copy className="w-3 h-3 text-brand-300" />
                <span className="hidden sm:inline">{t('panel.devDrawerExtra.copyDiffConfig')}</span>
              </button>
              {outfitDiffCount > 0 && (
                <button
                  type="button"
                  onClick={handleResetOutfitToGlobal}
                  className="flex items-center gap-1 p-1 rounded-md bg-white/5 hover:bg-white/15 border border-white/10 text-white/60 hover:text-amber-300 transition-all text-[11px] active:scale-95 cursor-pointer"
                  title={t('panel.devDrawerExtra.resetOutfitMorph')}
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={handleCopyGlobal}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 border border-white/15 text-white/90 hover:text-white transition-all text-[11px] font-medium active:scale-95 cursor-pointer"
              title={t('panel.devDrawerExtra.copyGlobalConfig')}
            >
              <Copy className="w-3 h-3 text-emerald-300" />
              <span className="hidden sm:inline">{t('panel.devDrawerExtra.copyGlobalConfig')}</span>
            </button>
          )}
        </div>
      </div>

      {/* 搜索过滤框 */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('panel.devDrawer.searchBoneMorph')}
          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-brand-400/50 transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-[11px]"
            title={t('panel.devDrawer.clearSearch')}
          >
            ✕
          </button>
        )}
      </div>

      {/* 分组滑块列表 */}
      <div className="flex flex-col gap-3">
        {(() => {
          const itemsByCat = new Map<BoneMorphItem['category'], BoneMorphItem[]>();
          CATEGORIES.forEach(c => itemsByCat.set(c.id, []));
          filtered.forEach(item => itemsByCat.get(item.category)?.push(item));
          const hasAnyMatch = filtered.length > 0;
          if (!hasAnyMatch) {
            return (
              <div className="text-center text-[11px] text-white/40 py-3">
                {t('panel.devDrawer.noMatches')}
              </div>
            );
          }
          return CATEGORIES.map((cat) => {
            const items = itemsByCat.get(cat.id) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={cat.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/70 tracking-wide px-1">
                  <span>{cat.icon}</span>
                  <span>{t(cat.labelKey)}</span>
                  <span className="text-[10px] text-white/35 font-mono font-normal">({items.length})</span>
                </div>
                <div className="flex flex-col gap-2.5 p-3 rounded-lg bg-white/[0.02] border border-white/10">
                  {items.map((item) => {
                    const limit = APP_CONFIG.bodyMorph.limits[item.key];
                    const val = displayedMorph[item.key] ?? 1.0;
                    const globalDefault = globalBodyMorph[item.key] ?? APP_CONFIG.bodyMorph.default[item.key] ?? 1.0;
                    const isOffset = item.key.includes('Pitch') || item.key.includes('Spread');
                    const range = limit.max - limit.min;
                    const centerValue = isOffset ? 0 : 1;
                    const centerPct = range > 0 ? ((centerValue - limit.min) / range) * 100 : 0;

                    // 检查此项在当前服装下是否被特化覆盖
                    const isOverridden = activeTab === 'outfit' && Math.abs(val - globalDefault) >= 1e-4;

                    return (
                      <div
                        key={item.key}
                        className={`flex flex-col gap-1 min-w-0 p-1 rounded-md transition-colors ${
                          isOverridden ? 'bg-brand-500/10 border border-brand-400/20' : ''
                        }`}
                        title={`${t(item.labelKey)} | 当前 ${val.toFixed(3)} | 全局基准 ${globalDefault.toFixed(3)} | 范围 [${limit.min}, ${limit.max}]`}
                      >
                        <div className="flex justify-between items-center gap-2 text-[11px] text-white/80 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="font-medium text-white/90 whitespace-nowrap truncate">
                              {item.icon} {t(item.labelKey)}
                            </span>
                            {isOverridden && (
                              <span className="px-1 py-0.2 rounded text-[9px] bg-brand-400/25 text-brand-200 border border-brand-400/40 font-mono shrink-0">
                                特化
                              </span>
                            )}
                          </div>
                          <span
                            ref={getRef(item.key)}
                            className={`font-mono font-medium whitespace-nowrap shrink-0 ${
                              isOverridden ? 'text-brand-300 font-bold' : 'text-white/70'
                            }`}
                          >
                            {isOffset
                              ? (val >= 0 ? `+${val.toFixed(3)}` : val.toFixed(3))
                              : `${Math.round(val * 100)}%`}
                          </span>
                        </div>
                        <SliderWithAnchors
                          value={val}
                          min={limit.min}
                          max={limit.max}
                          step={limit.step}
                          onTick={(v) => handleSliderTick(item.key, v)}
                          onChange={(v) => handleChange(item.key, v)}
                          liveValueRef={getRef(item.key)}
                          liveValueFormatter={isOffset
                            ? (v) => (v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3))
                            : (v) => `${Math.round(v * 100)}%`}
                          anchors={[
                            { value: centerValue, label: t('panel.sliderAnchors.center'), color: 'emerald' },
                            { value: globalDefault, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
                          ]}
                        />
                        <div className="relative h-3 text-[9px] text-white/35 font-mono">
                          <span className="absolute whitespace-nowrap left-0">{t(item.minLabelKey)}</span>
                          <span
                            className="absolute whitespace-nowrap -translate-x-1/2"
                            style={{ left: `calc(${centerPct}% + ${thumbInBoundsOffset(centerPct)}px)` }}
                          >
                            {isOffset ? '0.00' : '100%'}
                          </span>
                          <span className="absolute whitespace-nowrap right-0">{t(item.maxLabelKey)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}
      </div>
    </SectionCard>
  );
};