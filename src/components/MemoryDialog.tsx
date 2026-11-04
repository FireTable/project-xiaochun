/**
 * MemoryDialog — 记忆设置（小蠢的认知记忆画像、时光回忆与世界书设定）。
 *
 * 与「对话设置」完全平级独立，采用三模态 Segmented Tab Bar 视觉：
 * - Tab 1: 记忆画像 (profile) — 核心身份画像、关系阶段与抽取的喜好/特征标签管理
 * - Tab 2: 时光回忆 (episodes) — 长期陪伴情景日记流与重要度卡片
 * - Tab 3: 世界书 (lorebook) — SillyTavern 酒馆世界书条目检索与一键 JSON 导入
 *
 * 图标视觉统一采用系统 primary (brand-300 / brand-400) 品牌主色。
 * 按钮与底栏样式严格遵循应用统一 Dialog 规范 (variant="secondary", h-9 sm:h-8)。
 * 响应式布局优化，全面适配移动端安全边距与触控体验，支持两步防误触重置记忆。
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Check,
  AlertTriangle,
  User,
  Calendar,
  BookOpen,
  Trash2,
  Upload,
  RotateCcw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getClientMemory } from '@/memory';
import type { EpisodeRecord, LorebookEntry, UserFact, UserProfile } from '@firetable/client-memory';

interface MemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type MemoryTab = 'profile' | 'episodes' | 'lorebook';

export const MemoryDialog: React.FC<MemoryDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<MemoryTab>('profile');

  // 记忆手帐数据状态 (画像、回忆、世界书)
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeRecord[]>([]);
  const [lorebooks, setLorebooks] = useState<LorebookEntry[]>([]);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [showImportArea, setShowImportArea] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // 重置记忆二次确认机制 (4秒超时自动复原)
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  // 加载记忆系统数据
  const loadMemoryData = async () => {
    setLoadingMemory(true);
    try {
      const memory = getClientMemory();
      const [p, eps, lores] = await Promise.all([
        memory.profileManager.get(),
        memory.episodeManager.getAll(),
        memory.lorebookManager.getAll(),
      ]);
      setProfile(p);
      setEpisodes(eps);
      setLorebooks(lores);
    } catch (e) {
      console.warn('[MemoryDialog] loadMemoryData error', e);
    } finally {
      setLoadingMemory(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadMemoryData();
    } else {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      setConfirmReset(false);
      setShowImportArea(false);
      setImportError(null);
    }
  }, [open]);

  const handleDeleteFact = async (factId: string) => {
    try {
      const memory = getClientMemory();
      await memory.profileManager.deleteFact(factId);
      await loadMemoryData();
    } catch (e) {
      console.warn('[MemoryDialog] Failed to delete fact', e);
    }
  };

  const handleDeleteEpisode = async (epId: string) => {
    try {
      const memory = getClientMemory();
      await memory.episodeManager.delete(epId);
      await loadMemoryData();
    } catch (e) {
      console.warn('[MemoryDialog] Failed to delete episode', e);
    }
  };

  const handleDeleteLore = async (uid: string) => {
    try {
      const memory = getClientMemory();
      await memory.lorebookManager.deleteEntry(uid);
      await loadMemoryData();
    } catch (e) {
      console.warn('[MemoryDialog] Failed to delete lore', e);
    }
  };

  const handleImportLorebook = async () => {
    const raw = importJsonText.trim();
    if (!raw) {
      setImportError(t('chat.memoryDialog.importEmptyOrInvalid'));
      return;
    }
    if (raw.length > 5_000_000) {
      setImportError(t('chat.memoryDialog.importEmptyOrInvalid'));
      return;
    }
    setImportError(null);
    try {
      const memory = getClientMemory();
      const entries = await memory.lorebookManager.importSillyTavernJson(raw, 'imported');
      if (!entries || entries.length === 0) {
        setImportError(t('chat.memoryDialog.importEmptyOrInvalid'));
        return;
      }
      setImportJsonText('');
      setShowImportArea(false);
      setImportSuccess(String(entries.length));
      setTimeout(() => setImportSuccess(null), 3000);
      await loadMemoryData();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleResetMemory = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        setConfirmReset(false);
      }, 4000);
      return;
    }

    // 第二次点击执行清空
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setConfirmReset(false);

    try {
      const memory = getClientMemory();
      await memory.clearAll({ includeLorebook: false });
      setResetSuccess(true);
      setTimeout(() => setResetSuccess(false), 3000);
      await loadMemoryData();
    } catch (e) {
      console.warn('[MemoryDialog] Failed to reset memory', e);
    }
  };

  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(32rem,calc(100vw-1.5rem))] sm:max-w-xl max-h-[88dvh] flex flex-col p-4 sm:p-6 overflow-hidden">
        <DialogHeader className="space-y-1.5 shrink-0">
          <div className="flex items-center gap-2 text-brand-300">
            <BookOpen className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 text-brand-400" />
            <DialogTitle className="text-sm sm:text-base font-semibold text-white">
              {t('chat.memoryDialog.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-[11px] sm:text-xs text-white/60 leading-relaxed">
            {t('chat.memoryDialog.desc')}
          </DialogDescription>

          {/* ─────── 三分段控制器 (Segmented Tab Bar) ─────── */}
          <div className="pt-1">
            <div className="grid grid-cols-3 gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className={`flex items-center justify-center gap-1.5 py-2 sm:py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'profile'
                    ? 'bg-brand-500/25 border border-brand-400/50 text-white shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <User className="h-3.5 w-3.5 text-brand-300 shrink-0" />
                <span>{t('chat.memoryDialog.tabProfile')}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('episodes')}
                className={`flex items-center justify-center gap-1.5 py-2 sm:py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'episodes'
                    ? 'bg-brand-500/25 border border-brand-400/50 text-white shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Calendar className="h-3.5 w-3.5 text-brand-300 shrink-0" />
                <span>{t('chat.memoryDialog.tabEpisodes')}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('lorebook')}
                className={`flex items-center justify-center gap-1.5 py-2 sm:py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'lorebook'
                    ? 'bg-brand-500/25 border border-brand-400/50 text-white shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5 text-brand-300 shrink-0" />
                <span>{t('chat.memoryDialog.tabLorebook')}</span>
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* ─────── 状态反馈横幅 ─────── */}
        {resetSuccess && (
          <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-1.5 shrink-0 animate-in fade-in duration-200">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>{t('chat.memoryDialog.resetSuccess')}</span>
          </div>
        )}

        {/* ─────── 主内容滚动区域 ─────── */}
        <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-3.5 py-1.5 mt-1 overscroll-contain">
          {activeTab === 'profile' ? (
            <div className="space-y-3.5">
              {/* 基本身份 */}
              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
                <div className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-brand-300" />
                  <span>{t('chat.memoryDialog.basicIdentity')}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-white/40 block text-[10px]">{t('chat.memoryDialog.nickname')}</span>
                    <span className="text-white/90 font-medium">
                      {profile?.nickname || profile?.name || t('chat.memoryDialog.noNickname')}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-white/40 block text-[10px]">{t('chat.memoryDialog.occupation')}</span>
                    <span className="text-white/90 font-medium">
                      {profile?.traits?.occupation || t('chat.memoryDialog.unknown')}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-white/40 block text-[10px]">{t('chat.memoryDialog.location')}</span>
                    <span className="text-white/90 font-medium">
                      {profile?.traits?.location || t('chat.memoryDialog.unknown')}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white/[0.02] border border-white/5">
                    <span className="text-white/40 block text-[10px]">{t('chat.memoryDialog.relation')}</span>
                    <span className="text-white/90 font-medium text-brand-300">
                      {profile?.relationshipStage === 'close_friend'
                        ? t('chat.memoryDialog.relClose')
                        : profile?.relationshipStage === 'soulmate'
                          ? t('chat.memoryDialog.relBest')
                          : profile?.relationshipStage === 'friend'
                            ? t('chat.memoryDialog.relFriend')
                            : t('chat.memoryDialog.relAcquaintance')}
                    </span>
                  </div>
                </div>
              </div>

              {/* 喜好与特征 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-white/80">
                    {t('chat.memoryDialog.factsTitle')} ({profile?.facts?.length ?? 0})
                  </span>
                  <span className="text-[10px] text-white/40">
                    {t('chat.memoryDialog.deleteHint')}
                  </span>
                </div>

                {loadingMemory ? (
                  <div className="text-center text-xs text-white/40 py-6">
                    {t('chat.memoryDialog.loading')}
                  </div>
                ) : !profile?.facts || profile.facts.length === 0 ? (
                  <div className="text-center text-xs text-white/40 py-8 border border-dashed border-white/10 rounded-xl px-4 leading-relaxed">
                    {t('chat.memoryDialog.noFacts')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5">
                    {profile.facts.map((fact: UserFact) => (
                      <div
                        key={fact.id}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-brand-500/10 text-brand-300 border border-brand-500/20 shrink-0 font-medium">
                            {fact.category === 'preference'
                              ? fact.key === 'like'
                                ? t('chat.memoryDialog.catLike')
                                : t('chat.memoryDialog.catDislike')
                              : fact.category === 'identity'
                                ? t('chat.memoryDialog.catIdentity')
                                : fact.category === 'occupation'
                                  ? t('chat.memoryDialog.catOccupation')
                                  : fact.category === 'health'
                                    ? t('chat.memoryDialog.catHealth')
                                    : fact.category}
                          </span>
                          <span className="text-white/90 truncate">{fact.value}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteFact(fact.id)}
                          className="h-7 w-7 rounded-lg flex items-center justify-center text-white/40 hover:text-rose-400 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors shrink-0"
                          title={t('chat.memoryDialog.deleteFact')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'episodes' ? (
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-white/50">
                {t('chat.memoryDialog.episodesTitle')}
              </div>

              {loadingMemory ? (
                <div className="text-center text-xs text-white/40 py-6">
                  {t('chat.memoryDialog.loading')}
                </div>
              ) : episodes.length === 0 ? (
                <div className="text-center text-xs text-white/40 py-10 border border-dashed border-white/10 rounded-xl px-4 leading-relaxed">
                  {t('chat.memoryDialog.noEpisodes')}
                </div>
              ) : (
                <div className="space-y-2">
                  {episodes.map((ep) => (
                    <div
                      key={ep.id}
                      className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-1.5 text-xs relative group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white/90 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 text-brand-300" />
                          <span>{ep.title}</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-white/40 font-mono">
                            {new Date(ep.ts).toLocaleDateString()}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteEpisode(ep.id)}
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-white/40 hover:text-rose-400 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors shrink-0"
                            title={t('chat.memoryDialog.deleteEpisode')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-white/70 leading-relaxed text-[11px]">{ep.summary}</p>
                      {ep.entities && ep.entities.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {ep.entities.map((tag, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded text-[9px] bg-brand-500/10 text-brand-300 border border-brand-500/20"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* 世界书顶部与导入面板 */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-white/50">
                  {t('chat.memoryDialog.lorebookTitle')}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setShowImportArea((prev) => !prev);
                    setImportError(null);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-300 hover:text-brand-200 transition-colors focus:outline-none"
                >
                  <Upload className="h-3 w-3 shrink-0" />
                  <span>{t('chat.memoryDialog.importBtn')}</span>
                </button>
              </div>

              {/* 导入成功提示 */}
              {importSuccess && (
                <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0" />
                  <span>{importSuccess}</span>
                </div>
              )}

              {/* 导入展开输入区 */}
              {showImportArea && (
                <div className="p-3 rounded-xl bg-white/[0.04] border border-brand-500/30 space-y-2">
                  <textarea
                    value={importJsonText}
                    onChange={(e) => setImportJsonText(e.target.value)}
                    placeholder={t('chat.memoryDialog.importPlaceholder')}
                    rows={4}
                    className="w-full resize-none rounded-lg bg-black/40 border border-white/10 p-2 text-[11px] text-white/90 font-mono outline-none focus:border-brand-400/50"
                  />
                  {importError && (
                    <div className="text-[11px] text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span>{importError}</span>
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setShowImportArea(false);
                        setImportError(null);
                      }}
                      className="h-8 text-xs"
                    >
                      {t('chat.memoryDialog.cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleImportLorebook}
                      className="h-8 text-xs bg-brand-500/20 hover:bg-brand-500/30 text-brand-100 border-brand-400/40"
                    >
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      <span>{t('chat.memoryDialog.confirmImport')}</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* 世界书条目列表 */}
              {loadingMemory ? (
                <div className="text-center text-xs text-white/40 py-6">
                  {t('chat.memoryDialog.loading')}
                </div>
              ) : lorebooks.length === 0 ? (
                <div className="text-center text-xs text-white/40 py-10 border border-dashed border-white/10 rounded-xl px-4 leading-relaxed">
                  {t('chat.memoryDialog.noLorebooks')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {lorebooks.map((lore) => (
                    <div
                      key={lore.uid}
                      className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-brand-300 font-medium">
                            [{lore.keys.join(', ')}]
                          </span>
                          {lore.constant && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-brand-500/20 text-brand-300 font-medium border border-brand-400/30">
                              {t('chat.memoryDialog.constantBadge')}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteLore(lore.uid)}
                          className="h-7 w-7 rounded-lg flex items-center justify-center text-white/40 hover:text-rose-400 hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors shrink-0"
                          title={t('chat.memoryDialog.deleteLore')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-white/70 text-[11px] line-clamp-2 leading-relaxed">
                        {lore.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─────── 底部操作栏 ─────── */}
        <DialogFooter className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-3 border-t border-white/10 shrink-0 mt-1">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleResetMemory}
              className={`w-full sm:w-auto h-9 sm:h-8 text-xs transition-all ${
                confirmReset
                  ? 'bg-rose-500/25 border-rose-500/50 text-rose-200 animate-pulse'
                  : 'text-rose-300/80 hover:text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/20'
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              <span>
                {confirmReset
                  ? t('chat.memoryDialog.confirmReset')
                  : t('chat.memoryDialog.resetMemory')}
              </span>
            </Button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleClose}
              className="w-full sm:w-auto sm:min-w-[5.5rem] h-9 sm:h-8 text-xs"
            >
              {t('chat.memoryDialog.close')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
