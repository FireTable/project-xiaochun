import React, { useMemo, useRef, useState } from 'react';
import { vrmEngine } from '@/core/vrmEngine';
import { APP_CONFIG, type BodyMorphConfig, type BodyMorphPartKey } from '@/config';
import { SliderWithAnchors, thumbInBoundsOffset } from '@/components/SliderWithAnchors';
import { Search } from '@/components/icons';
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
 * ponytail: 28 个骨骼体型 slider + 搜索框 + reset。每个 slider 自带 key,React
 * 协调按 key 复用节点,drag 期间只重渲本段 — 移动端拖动 28 个 slider 完全不打架。
 */
export const BoneMorphSection: React.FC = () => {
  const { t } = useDevDrawer();

  const [bodyMorph, setBodyMorph] = useState<BodyMorphConfig>(
    () => loadDevDrawerSettings()?.bodyMorph ?? vrmEngine.getBodyMorphConfig()
  );
  // ponytail: 挂载时锁一份基线,modified 跟基线比而不是跟 config 默认比 ——
  // 模型/历史 localStorage 里自带的非默认 morph (如 xiaochun_v1 的 shoulderWidth=1.1)
  // 不算"修改",只有用户主动拖动才标 dot,统一"modified = 用户改过"语义。
  const initialBaseline = useRef<BodyMorphConfig>(bodyMorph);
  // ponytail: 每个 slider 的 display span 一个稳定 ref,SliderWithAnchors 拖动期间
  // imperative 写入 textContent,绕过 React — display 跟手但本段(28 个 slider)不重渲。
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

  // ponytail: per-frame engine 写入(让 canvas 实时跟手),React state + localStorage
  // 只在 onValueCommit 时更新,避免 60Hz 重渲整段 28 个 slider。
  const handleSliderTick = (part: BodyMorphPartKey, val: number) => {
    vrmEngine.setBodyPartScale(part, val);
  };
  const handleChange = (part: BodyMorphPartKey, val: number) => {
    const next = { ...bodyMorph, [part]: val };
    setBodyMorph(next);
    saveDevDrawerSettings({ bodyMorph: next });
  };

  const handleReset = () => {
    vrmEngine.resetBodyMorph();
    const next = vrmEngine.getBodyMorphConfig();
    setBodyMorph(next);
    initialBaseline.current = next;
    saveDevDrawerSettings({ bodyMorph: next });
  };

  const modified = ITEMS.some(item => {
    const init = initialBaseline.current[item.key] ?? 1.0;
    return Math.abs((bodyMorph[item.key] ?? 1.0) - init) >= 1e-4;
  });

  return (
    <SectionCard id="bodyMorph">
      <SectionHeader
        id="bodyMorph"
        title={t('panel.devDrawerExtra.bodyMorphTitle')}
        modified={modified}
        onReset={handleReset}
        showReset={modified}
        uppercase={false}
      />
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
      <div className="flex flex-col gap-3">
        {(() => {
          // ponytail: 按 category 分组渲染,空 category 不显示(搜索命中为空时整段折叠);
          // 每个 category 头部用小号 label + 图标标区域,group 间 gap-3 撑开。
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
                    const val = bodyMorph[item.key] ?? 1.0;
                    const configDefault = APP_CONFIG.bodyMorph.default[item.key] ?? 1.0;
                    const isOffset = item.key.includes('Pitch') || item.key.includes('Spread');
                    const range = limit.max - limit.min;
                    const centerValue = isOffset ? 0 : 1;
                    const centerPct = range > 0 ? ((centerValue - limit.min) / range) * 100 : 0;
                    return (
                      <div key={item.key} className="flex flex-col gap-1 min-w-0" title={`${t(item.labelKey)} | 当前 ${val.toFixed(3)} | 范围 [${limit.min}, ${limit.max}] | 默认 ${configDefault} | 步长 ${limit.step}`}>
                        <div className="flex justify-between items-center gap-2 text-[11px] text-white/80 min-w-0">
                          <span className="font-medium text-white/90 whitespace-nowrap truncate min-w-0 flex-1">
                            {item.icon} {t(item.labelKey)}
                          </span>
                          <span ref={getRef(item.key)} className="text-brand-300 font-mono font-medium whitespace-nowrap shrink-0">
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
                            { value: configDefault, label: t('panel.sliderAnchors.configDefault'), color: 'brand' },
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