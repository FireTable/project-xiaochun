import React, { useEffect, useMemo, useState } from 'react';
import { vrmEngine, MODEL_PARTS_CONFIG, MODEL_PART_CATEGORIES } from '@/core/vrmEngine';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';
import { saveDevDrawerSettings, loadDevDrawerSettings } from '../storage';

/**
 * ponytail: 服装部件穿脱调试 — 按类别分组,每个 part 一个 checkbox。
 * 每行单独 toggle,setPartVis 只改自己,不影响 drawer 其它部分。
 *
 * 注意:整套换装 (.vrmaddon) 按钮已迁到 TopHeader (面向普通用户),
 * 这里只管单部件穿脱的 dev 调试。
 */
export const WardrobeSection: React.FC = () => {
  const { t } = useDevDrawer();

  const availableParts = useMemo(() => {
    const detected = vrmEngine.materialManager.detectedParts;
    const map = new Map<string, (typeof MODEL_PARTS_CONFIG)[number]>();
    MODEL_PARTS_CONFIG.forEach((p) => map.set(p.id, p));
    detected.forEach((p) => map.set(p.id, p));
    return Array.from(map.values());
  }, [vrmEngine.materialManager.detectedParts]);

  const [partVis, setPartVis] = useState<Record<string, boolean>>(
    () => loadDevDrawerSettings()?.wardrobeVisibility ?? { ...vrmEngine.materialManager.partsVisibility }
  );

  // 抽屉打开时从 engine 同步一份最新 visibility,防止其他来源改了之后 UI 不一致
  useEffect(() => {
    setPartVis({ ...vrmEngine.materialManager.partsVisibility });
  }, []);

  const persist = (next: Record<string, boolean>) => {
    saveDevDrawerSettings({ wardrobeVisibility: next });
  };

  const handlePartToggle = (partId: string, visible: boolean) => {
    vrmEngine.setPartVisibility(partId, visible);
    const next = { ...partVis, [partId]: visible };
    setPartVis(next);
    persist(next);
  };

  const handleResetToDefault = () => {
    vrmEngine.materialManager.resetToDefaultConfig();
    const next = { ...vrmEngine.materialManager.partsVisibility };
    setPartVis(next);
    persist(next);
  };

  const handleResetAllVisible = () => {
    vrmEngine.resetAllPartsVisibility();
    const next: Record<string, boolean> = {};
    availableParts.forEach((p) => { next[p.id] = true; });
    setPartVis(next);
    persist(next);
  };

  const handleUndressCategory = (categoryId: string) => {
    const parts = availableParts.filter((p) => p.category === categoryId);
    const next = { ...partVis };
    parts.forEach((p) => {
      vrmEngine.setPartVisibility(p.id, false);
      next[p.id] = false;
    });
    setPartVis(next);
    persist(next);
  };

  const handleDressCategory = (categoryId: string) => {
    const parts = availableParts.filter((p) => p.category === categoryId);
    const next = { ...partVis };
    parts.forEach((p) => {
      vrmEngine.setPartVisibility(p.id, true);
      next[p.id] = true;
    });
    setPartVis(next);
    persist(next);
  };

  const modified = Object.values(partVis).some(v => v !== true);

  return (
    <SectionCard id="wardrobe">
      <SectionHeader
        id="wardrobe"
        title={t('panel.devDrawer.partDebuggingTitle')}
        modified={modified}
        onReset={handleResetToDefault}
        showReset={modified}
        uppercase={false}
      />
      <div className="flex justify-end -mt-1 gap-1.5 flex-wrap">
        <button
          onClick={handleResetAllVisible}
          className="text-[10px] text-brand-300 hover:text-brand-200 border border-brand-500/30 hover:border-brand-400/50 bg-brand-500/10 px-2 py-0.5 rounded transition-all active:scale-95"
        >
          {t('panel.devDrawer.showAllParts')}
        </button>
        {/* ponytail: 换装按钮已迁到 TopHeader (面向普通用户,不是 dev 调试)。
            这里只管部件穿脱 (part visibility),与 swap 无关。 */}
      </div>
      <div className="flex flex-col gap-4">
        {MODEL_PART_CATEGORIES.map((cat) => {
          const parts = availableParts.filter((p) => p.category === cat.id);
          if (parts.length === 0) return null;
          // ponytail: 装配计数看 engine 实际材质数,不是用户可见性 — 未装配的部件不应该被算进 count
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
              <div className="grid grid-cols-2 gap-1.5">
                {parts.map((p) => {
                  // ponytail: 当前模型没装配此部件 → 渲染为虚线禁用行,无 checkbox,标 "未装配"
                  const hasMaterials = (vrmEngine.materialManager.partMaterials[p.id]?.length ?? 0) > 0;
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
                  const isVisible = partVis[p.id] ?? true;
                  const labelText = t(p.label);
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
                        <span className="text-xs whitespace-nowrap truncate min-w-0">{p.icon} {labelText}</span>
                      </div>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
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
    </SectionCard>
  );
};