import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  SkipBack,
  SkipForward,
  Play,
  Pause,
  RotateCcw,
  Repeat,
  UserCheck,
  Loader2,
  Layers,
  Sparkles,
} from 'lucide-react';
import { vrmEngine } from '@/core/vrmEngine';
import {
  MOTION_CATALOG,
  MOTION_GROUPS,
  type MotionCatalogId,
  type MotionCatalogItem,
  type MotionGroupName,
  getMotionName,
  getMotionDescription,
} from '@/motion/catalog';
import { useDevDrawer } from '../context';
import { SectionCard } from '../components/SectionCard';
import { SectionHeader } from '../components/SectionHeader';

interface DisplayMotionEntry {
  item: MotionCatalogItem;
  weight?: number;
  percent?: number;
}

interface DisplayMotionGroup {
  id: string;
  title: string;
  description?: string;
  items: DisplayMotionEntry[];
}

const SPEED_OPTIONS = [1.0, 1.5, 2.0, 0.5];

const RUNTIME_SCENARIOS: Array<{
  id: MotionGroupName;
  titleKey: string;
  descKey: string;
  fallbackTitle: string;
  fallbackDesc: string;
}> = [
  {
    id: 'greeting',
    titleKey: 'panel.motionGroupTitles.greeting',
    descKey: 'panel.motionGroupDesc.greeting',
    fallbackTitle: '迎宾问候 (Greeting)',
    fallbackDesc: '冷启动开屏登场迎宾时触发',
  },
  {
    id: 'idleFlavor',
    titleKey: 'panel.motionGroupTitles.idleFlavor',
    descKey: 'panel.motionGroupDesc.idleFlavor',
    fallbackTitle: '待机微动 (Idle Flavor)',
    fallbackDesc: '自然待机 14~24s 随机穿插',
  },
  {
    id: 'listening',
    titleKey: 'panel.motionGroupTitles.listening',
    descKey: 'panel.motionGroupDesc.listening',
    fallbackTitle: '专注倾听 (Listening)',
    fallbackDesc: '用户打字或麦克风聆听时触发',
  },
  {
    id: 'thinking',
    titleKey: 'panel.motionGroupTitles.thinking',
    descKey: 'panel.motionGroupDesc.thinking',
    fallbackTitle: '深度思考 (Thinking)',
    fallbackDesc: 'AI 思考回复阶段循环播放',
  },
  {
    id: 'outfitShowcase',
    titleKey: 'panel.motionGroupTitles.outfitShowcase',
    descKey: 'panel.motionGroupDesc.outfitShowcase',
    fallbackTitle: '换装走秀 (Outfit Showcase)',
    fallbackDesc: '换装完成后进入新形象展示',
  },
  {
    id: 'praiseCute',
    titleKey: 'panel.motionGroupTitles.praiseCute',
    descKey: 'panel.motionGroupDesc.praiseCute',
    fallbackTitle: '夸赞心动 (Praise & Cute)',
    fallbackDesc: '对话夸赞或好感互动时触发',
  },
  {
    id: 'playfulSulking',
    titleKey: 'panel.motionGroupTitles.playfulSulking',
    descKey: 'panel.motionGroupDesc.playfulSulking',
    fallbackTitle: '傲娇撒娇 (Playful Sulking)',
    fallbackDesc: '调侃逗趣或傲娇情绪时触发',
  },
  {
    id: 'dancePerformance',
    titleKey: 'panel.motionGroupTitles.dancePerformance',
    descKey: 'panel.motionGroupDesc.dancePerformance',
    fallbackTitle: '才艺舞蹈 (Dance Performance)',
    fallbackDesc: '才艺表演与跳舞互动时触发',
  },
];

export const MotionSection: React.FC = () => {
  const { t } = useDevDrawer();
  const catalogList = useMemo(() => Object.values(MOTION_CATALOG) as MotionCatalogItem[], []);

  const [viewTab, setViewTab] = useState<'category' | 'runtimeGroup'>('category');
  const [activeMotionId, setActiveMotionId] = useState<string | null>(null);
  const [loadingMotionId, setLoadingMotionId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1.0);
  const [loopMode, setLoopMode] = useState<'default' | 'loop' | 'once'>('default');
  const [maskMode, setMaskMode] = useState<'default' | 'all' | 'upperBody'>('default');

  const activeMotionRef = useRef<string | null>(null);
  activeMotionRef.current = activeMotionId;

  const getT = useCallback(
    (key: string, fallback: string) => {
      const val = t(key);
      return val && val !== key ? val : fallback;
    },
    [t],
  );

  // 1. 按动作类型平铺分组 (Category View)
  const categoryGroups: DisplayMotionGroup[] = useMemo(() => {
    const postureItems = catalogList.filter((m) => m.category === 'posture');
    const cuteItems = catalogList.filter((m) => m.category === 'cute' || m.category === 'expression');
    const speechItems = catalogList.filter((m) => m.category === 'speech');
    const danceItems = catalogList.filter((m) => m.category === 'dance');
    const otherItems = catalogList.filter(
      (m) => !['posture', 'cute', 'expression', 'speech', 'dance'].includes(m.category ?? ''),
    );

    const toEntries = (items: MotionCatalogItem[]): DisplayMotionEntry[] =>
      items.map((item) => ({ item }));

    return [
      { id: 'posture', title: getT('panel.motionCategories.posture', '待机与站姿'), items: toEntries(postureItems) },
      { id: 'cute', title: getT('panel.motionCategories.cute', '神态与可爱'), items: toEntries(cuteItems) },
      { id: 'speech', title: getT('panel.motionCategories.speech', '交谈与手势'), items: toEntries(speechItems) },
      { id: 'dance', title: getT('panel.motionCategories.dance', '曼妙舞蹈'), items: toEntries(danceItems) },
      { id: 'other', title: getT('panel.motionCategories.other', '日常与互动'), items: toEntries(otherItems) },
    ].filter((g) => g.items.length > 0);
  }, [catalogList, getT]);

  // 2. 按互动场景与运行时动作组分组 (Runtime Motion Group View)
  const runtimeGroups: DisplayMotionGroup[] = useMemo(() => {
    const groups: DisplayMotionGroup[] = [];
    const assignedMotionIds = new Set<string>();

    for (const sc of RUNTIME_SCENARIOS) {
      const rawItems = MOTION_GROUPS[sc.id];
      if (!rawItems || (rawItems as readonly unknown[]).length === 0) continue;

      const totalWeight = rawItems.reduce((acc, curr) => acc + curr.weight, 0);

      const items: DisplayMotionEntry[] = [];
      for (const entry of rawItems) {
        assignedMotionIds.add(entry.id);
        const catItem = MOTION_CATALOG[entry.id as MotionCatalogId];
        if (catItem) {
          const percent = totalWeight > 0 ? Math.round((entry.weight / totalWeight) * 100) : undefined;
          items.push({
            item: catItem,
            weight: entry.weight,
            percent,
          });
        }
      }

      if (items.length > 0) {
        groups.push({
          id: sc.id,
          title: getT(sc.titleKey, sc.fallbackTitle),
          description: getT(sc.descKey, sc.fallbackDesc),
          items,
        });
      }
    }

    // 收集所有未在任何互动场景随机抽选的独立 / 专属动作
    const standaloneItems: DisplayMotionEntry[] = catalogList
      .filter((m) => !assignedMotionIds.has(m.id))
      .map((item) => ({ item }));

    if (standaloneItems.length > 0) {
      groups.push({
        id: 'standalone',
        title: getT('panel.motionGroupTitles.standalone', '独立动作 (Standalone)'),
        description: getT('panel.motionGroupDesc.standalone', '由业务场景或特殊逻辑调用的专属动作'),
        items: standaloneItems,
      });
    }

    return groups;
  }, [catalogList, getT]);

  const displayedGroups = viewTab === 'category' ? categoryGroups : runtimeGroups;

  // 播放指定动作（如果点击正在播放的动作，则停止并回待机）
  const playMotionItem = async (item: MotionCatalogItem) => {
    if (activeMotionId === item.id) {
      stopMotion();
      return;
    }

    const isLoop = loopMode === 'default' ? (item.loop ?? false) : loopMode === 'loop';
    const mask = maskMode === 'default' ? (item.mask ?? 'all') : maskMode;
    const forceFullBody = maskMode === 'all' || Boolean((item as any).forceFullBody);

    setLoadingMotionId(item.id);
    setActiveMotionId(item.id);
    setIsPaused(false);

    try {
      await vrmEngine.playMotion(item.id as MotionCatalogId, {
        loop: isLoop,
        timeScale: speed,
        mask,
        forceFullBody,
        fadeDuration: 0.75,
        onEnd: () => {
          if (activeMotionRef.current === item.id) {
            setActiveMotionId(null);
            setIsPaused(false);
          }
        },
      });
    } catch (err) {
      console.warn('[MotionSection] 播放动作失败:', err);
      if (activeMotionRef.current === item.id) {
        setActiveMotionId(null);
      }
    } finally {
      setLoadingMotionId(null);
    }
  };

  // 停止动作并平滑回待机
  const stopMotion = () => {
    vrmEngine.stopMotion(0.75);
    setActiveMotionId(null);
    setIsPaused(false);
  };

  // 切换暂停 / 继续
  const togglePauseResume = () => {
    if (!activeMotionId) {
      if (catalogList.length > 0) {
        playMotionItem(catalogList[0]);
      }
      return;
    }
    if (isPaused) {
      vrmEngine.resumeMotion();
      setIsPaused(false);
    } else {
      vrmEngine.pauseMotion();
      setIsPaused(true);
    }
  };

  // 重播当前动作
  const replayCurrent = () => {
    if (activeMotionId) {
      const curItem = MOTION_CATALOG[activeMotionId as MotionCatalogId];
      if (curItem) {
        playMotionItem(curItem);
        return;
      }
    }
    if (catalogList.length > 0) {
      playMotionItem(catalogList[0]);
    }
  };

  // 上一个动作
  const playPrevious = () => {
    const currentIndex = catalogList.findIndex((m) => m.id === activeMotionId);
    const prevIndex = currentIndex <= 0 ? catalogList.length - 1 : currentIndex - 1;
    playMotionItem(catalogList[prevIndex]);
  };

  // 下一个动作
  const playNext = () => {
    const currentIndex = catalogList.findIndex((m) => m.id === activeMotionId);
    const nextIndex = currentIndex < 0 || currentIndex >= catalogList.length - 1 ? 0 : currentIndex + 1;
    playMotionItem(catalogList[nextIndex]);
  };

  // 循环切换倍速: 1.0x -> 1.5x -> 2.0x -> 0.5x
  const cycleSpeed = () => {
    const nextIdx = (SPEED_OPTIONS.indexOf(speed) + 1) % SPEED_OPTIONS.length;
    const nextSpeed = SPEED_OPTIONS[nextIdx];
    setSpeed(nextSpeed);
    vrmEngine.setMotionTimeScale(nextSpeed);
  };

  useEffect(() => {
    return () => {
      // 保持当前动作生命周期由引擎托管
    };
  }, []);

  const activeItem = activeMotionId ? MOTION_CATALOG[activeMotionId as MotionCatalogId] : null;

  return (
    <SectionCard id="motion">
      <SectionHeader
        id="motion"
        title={t('panel.motionLabel') || '💃 动作调试'}
        modified={!!activeMotionId}
        onReset={stopMotion}
        showReset={!!activeMotionId}
      />

      <div className="flex flex-col gap-3.5">
        {/* ── 便捷控制栏 (纯图标按钮，无文字标签，无镜头复位) ── */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-1.5 flex items-center justify-between gap-1.5 shadow-inner backdrop-blur-sm">
          {/* 上一个 */}
          <button
            type="button"
            onClick={playPrevious}
            title="上一个动作 (Previous)"
            className="flex-1 py-2 px-1 rounded-xl bg-white/5 hover:bg-white/15 active:scale-95 border border-white/10 text-white/80 hover:text-white transition flex items-center justify-center cursor-pointer"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* 暂停 / 继续 */}
          <button
            type="button"
            onClick={togglePauseResume}
            title={activeMotionId ? (isPaused ? '继续播放 (Resume)' : '暂停播放 (Pause)') : '播放 (Play)'}
            className={`flex-1 py-2 px-1 rounded-xl active:scale-95 border transition flex items-center justify-center cursor-pointer ${
              activeMotionId && !isPaused
                ? 'bg-brand-500/30 border-brand-400/60 text-brand-100 shadow-sm shadow-brand-500/20'
                : 'bg-white/5 hover:bg-white/15 border-white/10 text-white/80 hover:text-white'
            }`}
          >
            {activeMotionId && !isPaused ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
          </button>

          {/* 重播 */}
          <button
            type="button"
            onClick={replayCurrent}
            title="重新播放 (Replay)"
            className="flex-1 py-2 px-1 rounded-xl bg-white/5 hover:bg-white/15 active:scale-95 border border-white/10 text-white/80 hover:text-white transition flex items-center justify-center cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* 下一个 */}
          <button
            type="button"
            onClick={playNext}
            title="下一个动作 (Next)"
            className="flex-1 py-2 px-1 rounded-xl bg-white/5 hover:bg-white/15 active:scale-95 border border-white/10 text-white/80 hover:text-white transition flex items-center justify-center cursor-pointer"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* 倍速切换 (1.0x / 1.5x / 2.0x / 0.5x) */}
          <button
            type="button"
            onClick={cycleSpeed}
            title={`播放倍速: ${speed}x (点击切换)`}
            className="flex-1 py-2 px-1 rounded-xl bg-white/5 hover:bg-white/15 active:scale-95 border border-white/10 text-xs font-semibold font-mono text-white/80 hover:text-white transition flex items-center justify-center cursor-pointer select-none"
          >
            {speed}x
          </button>
        </div>

        {/* ── 状态展示与高级覆盖选项 ── */}
        <div className="flex items-center justify-between text-[11px] text-white/60 px-0.5">
          <div className="truncate max-w-[170px] flex items-center gap-1.5">
            {activeItem ? (
              <>
                <span className="text-white/90 font-medium truncate">
                  {getMotionName(activeItem, t)}
                </span>
                {isPaused && <span className="text-amber-300 text-[10px] shrink-0">(已暂停)</span>}
              </>
            ) : (
              <span>自然待机 (Idle)</span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* 循环模式切换 */}
            <button
              type="button"
              onClick={() => {
                const next = loopMode === 'default' ? 'loop' : loopMode === 'loop' ? 'once' : 'default';
                setLoopMode(next);
              }}
              title={`循环模式: ${loopMode === 'default' ? '跟随动作默认' : loopMode === 'loop' ? '强制循环' : '单次播放'}`}
              className={`p-1 rounded-md text-[10px] font-medium border flex items-center gap-1 cursor-pointer transition ${
                loopMode !== 'default'
                  ? 'bg-brand-500/20 border-brand-400/50 text-brand-200'
                  : 'bg-white/5 border-white/10 text-white/50 hover:text-white/80'
              }`}
            >
              <Repeat className="w-3 h-3" />
              <span>{loopMode === 'default' ? '默认' : loopMode === 'loop' ? '循环' : '单次'}</span>
            </button>

            {/* 身体部位遮罩 */}
            <button
              type="button"
              onClick={() => {
                const next = maskMode === 'default' ? 'upperBody' : maskMode === 'upperBody' ? 'all' : 'default';
                setMaskMode(next);
              }}
              title={`动作部位: ${maskMode === 'default' ? '跟随动作默认' : maskMode === 'upperBody' ? '仅上半身' : '全身动作'}`}
              className={`p-1 rounded-md text-[10px] font-medium border flex items-center gap-1 cursor-pointer transition ${
                maskMode !== 'default'
                  ? 'bg-brand-500/20 border-brand-400/50 text-brand-200'
                  : 'bg-white/5 border-white/10 text-white/50 hover:text-white/80'
              }`}
            >
              <UserCheck className="w-3 h-3" />
              <span>{maskMode === 'default' ? '默认' : maskMode === 'upperBody' ? '半身' : '全身'}</span>
            </button>
          </div>
        </div>

        {/* ── 动作分组视图 Tab 切换 (按动作分类 vs 按互动场景) ── */}
        <div className="flex items-center p-0.5 rounded-lg bg-white/5 border border-white/10 text-xs">
          <button
            type="button"
            onClick={() => setViewTab('category')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-all cursor-pointer active:scale-95 ${
              viewTab === 'category'
                ? 'bg-brand-500/25 text-brand-200 border border-brand-400/30 shadow-sm'
                : 'text-white/60 hover:text-white/90 hover:bg-white/5'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{getT('panel.motionTabs.category', '按动作分类')}</span>
          </button>

          <button
            type="button"
            onClick={() => setViewTab('runtimeGroup')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md font-medium transition-all cursor-pointer active:scale-95 ${
              viewTab === 'runtimeGroup'
                ? 'bg-brand-500/25 text-brand-200 border border-brand-400/30 shadow-sm'
                : 'text-white/60 hover:text-white/90 hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{getT('panel.motionTabs.runtimeGroup', '按互动分组')}</span>
          </button>
        </div>

        {/* ── 平铺分组列表 (支持按动作类型 / 互动场景切换) ── */}
        <div className="flex flex-col gap-4 max-h-[420px] overflow-y-auto overflow-x-hidden pr-0.5 select-none custom-scrollbar">
          {displayedGroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-1.5 pt-1">
              {/* 分组标题与动作数量 */}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-white/70">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-white/80">{group.title}</span>
                    <span className="text-[10px] text-white/35 font-mono">({group.items.length})</span>
                  </div>
                </div>
                {group.description && (
                  <span className="text-[10px] text-white/40 leading-tight">
                    {group.description}
                  </span>
                )}
              </div>

              {/* 动作 3 列卡片网格 */}
              <div className="grid grid-cols-3 gap-2">
                {group.items.map(({ item, percent }) => {
                  const isPlayingThis = activeMotionId === item.id;
                  const isLoadingThis = loadingMotionId === item.id;
                  const name = getMotionName(item, t);
                  const desc = getMotionDescription(item, t);
                  const tooltip = percent !== undefined
                    ? `${name} (触发权重: ${percent}%)${desc ? `: ${desc}` : ''}`
                    : desc ? `${name}: ${desc}` : name;

                  return (
                    <button
                      key={`${group.id}-${item.id}`}
                      type="button"
                      onClick={() => playMotionItem(item)}
                      title={tooltip}
                      className={`group relative py-2 px-1.5 rounded-xl text-xs font-medium cursor-pointer text-center select-none transition-all flex flex-col items-center justify-center min-h-[44px] ${
                        isPlayingThis
                          ? item.isNew
                            ? 'bg-emerald-500/30 border border-emerald-400 text-emerald-50 shadow-sm shadow-emerald-500/30'
                            : 'bg-brand-500/25 border border-brand-400/60 text-brand-100 shadow-sm shadow-brand-500/20'
                          : item.isNew
                            ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 text-emerald-200 hover:text-white shadow-sm shadow-emerald-500/10'
                            : 'bg-white/5 hover:bg-white/10 border border-white/10 text-white/75 hover:text-white'
                      }`}
                    >
                      <span className="truncate max-w-full leading-tight text-[11px]">{name}</span>

                      {/* 互动场景模式下展示触发权重比例 */}
                      {percent !== undefined && (
                        <span
                          className={`text-[9px] font-mono leading-none mt-1 px-1 py-0.5 rounded border ${
                            isPlayingThis
                              ? 'bg-brand-400/20 text-brand-100 border-brand-300/40'
                              : 'bg-white/5 text-white/45 border-white/10 group-hover:text-white/70'
                          }`}
                        >
                          {percent}%
                        </span>
                      )}

                      {/* 新增动作标签 (方便用户快速辨识核对) */}
                      {item.isNew && (
                        <span className="absolute -top-1.5 right-0 px-1 py-[1px] text-[8px] font-bold tracking-tight bg-emerald-500 text-white rounded-full leading-none shadow ring-1 ring-emerald-300/40 pointer-events-none">
                          NEW
                        </span>
                      )}

                      {/* 加载中状态 */}
                      {isLoadingThis && (
                        <Loader2 className="w-3 h-3 animate-spin text-brand-300 absolute right-1.5 top-1.5" />
                      )}

                      {/* 循环动作半透明微弱角标 (大幅增加透明度，避免干扰文字阅读) */}
                      {item.loop && (
                        <Repeat className="w-2.5 h-2.5 text-white/[0.12] group-hover:text-white/35 absolute right-1 bottom-1 pointer-events-none transition-colors" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
};
