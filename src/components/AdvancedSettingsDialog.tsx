/**
 * AdvancedSettingsDialog — 用户自定义系统提示词与对话记忆轮数。
 *
 * 专注管理对话维度配置：
 * - 系统提示词：textarea，留空 = 用默认人设
 * - 记忆轮数：slider 1-50，有 override 时显示 override，否则显示设备推荐
 * - 对话字幕：switch，控制聊天模式头顶气泡与字幕栏
 *
 * 样式遵循深色玻璃拟态 (dark glass card, border-white/15, bg-slate-950/95)，
 * 所有图标统一使用系统 primary (brand-300 / brand-400) 主题色。
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RotateCcw,
  Sparkles,
  Check,
  FileText,
  History,
  AlertTriangle,
  Save,
  MessageCircle,
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
import { Slider } from '@/components/ui/slider';
import { APP_CONFIG } from '@/config';
import {
  getUserSettings,
  setSystemPromptOverride,
  setMemoryTurnsOverride,
  setShowChatDialogueOverride,
  resolveShowChatDialogue,
  type UserSettings,
} from '@/llm/userSettings';
import { XIAOCHUN_SYSTEM_PROMPT } from '@/llm/prompts';
import { getDeviceMemoryTurns } from '@/llm/deviceDetection';
import { DEFAULT_LANG, type Lang } from '@/i18n';

interface AdvancedSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TURNS_MIN = APP_CONFIG.memory.userTurnsMin;
const TURNS_MAX = APP_CONFIG.memory.userTurnsMax;
const DEFAULT_SHOW_CHAT_DIALOGUE = APP_CONFIG.chat.showChatDialogue;

export const AdvancedSettingsDialog: React.FC<AdvancedSettingsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState<UserSettings>({});
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftTurns, setDraftTurns] = useState<number>(0);
  const [draftShowDialogue, setDraftShowDialogue] = useState(DEFAULT_SHOW_CHAT_DIALOGUE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  const lang: Lang = ((i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LANG) as Lang);
  const defaultPrompt = XIAOCHUN_SYSTEM_PROMPT[lang] ?? XIAOCHUN_SYSTEM_PROMPT['zh-CN'];
  const deviceRecommended = getDeviceMemoryTurns();

  const promptOverridden = (settings.systemPromptOverride?.trim() ?? '') !== '';
  const turnsOverridden = typeof settings.memoryTurnsOverride === 'number' && settings.memoryTurnsOverride > 0;
  const dialogueOverridden = typeof settings.showChatDialogue === 'boolean';

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const s = await getUserSettings();
      setSettings(s);
      setDraftPrompt(s.systemPromptOverride ?? defaultPrompt);
      setDraftTurns(s.memoryTurnsOverride ?? deviceRecommended);
      setDraftShowDialogue(resolveShowChatDialogue(s));
      setError(null);
      setSaved(false);
    })();
  }, [open, defaultPrompt, deviceRecommended]);

  const handleResetPrompt = () => {
    setDraftPrompt(defaultPrompt);
  };

  const handleResetTurns = () => {
    setDraftTurns(deviceRecommended);
  };

  const handleResetDialogue = () => {
    setDraftShowDialogue(DEFAULT_SHOW_CHAT_DIALOGUE);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const trimmed = draftPrompt.trim();
      const promptChanged = trimmed && trimmed !== defaultPrompt;
      const turnsChanged = draftTurns !== deviceRecommended;
      const dialogueChanged = draftShowDialogue !== DEFAULT_SHOW_CHAT_DIALOGUE;
      await setSystemPromptOverride(promptChanged ? trimmed : null);
      await setMemoryTurnsOverride(turnsChanged ? draftTurns : null);
      await setShowChatDialogueOverride(dialogueChanged ? draftShowDialogue : null);

      const next: UserSettings = {};
      if (promptChanged) next.systemPromptOverride = trimmed;
      if (turnsChanged) next.memoryTurnsOverride = draftTurns;
      if (dialogueChanged) next.showChatDialogue = draftShowDialogue;
      setSettings(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(28rem,calc(100vw-1.75rem))] sm:max-w-lg max-h-[90vh] overflow-x-hidden overflow-y-auto"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          promptTextareaRef.current?.focus();
        }}
      >
        <DialogHeader className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-brand-300">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 text-brand-400" />
            <DialogTitle className="text-sm sm:text-base font-semibold">
              {t('chat.advancedDialog.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-[11px] sm:text-xs text-white/60 leading-relaxed">
            {t('chat.advancedDialog.desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 min-w-0">
          {/* 系统提示词 */}
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between text-xs">
              <label
                htmlFor="advanced-system-prompt"
                className="font-medium text-white/90 flex items-center gap-1.5"
              >
                <FileText className="h-3.5 w-3.5 text-brand-300" />
                <span>{t('chat.advancedDialog.systemPromptLabel')}</span>
                {promptOverridden && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-400/30">
                    {t('chat.advancedDialog.saved')}
                  </span>
                )}
              </label>
              {draftPrompt !== defaultPrompt && (
                <button
                  type="button"
                  onClick={handleResetPrompt}
                  className="inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-brand-300 transition-colors"
                  title={t('chat.advancedDialog.reset')}
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{t('chat.advancedDialog.reset')}</span>
                </button>
              )}
            </div>
            <textarea
              id="advanced-system-prompt"
              ref={promptTextareaRef}
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              rows={6}
              className="w-full resize-none rounded-xl bg-white/[0.03] border border-white/10 focus:border-brand-400/60 focus:bg-white/[0.05] p-3 text-xs text-white/90 font-mono leading-relaxed placeholder:text-white/30 outline-none transition-colors"
            />
            <p className="text-[10px] sm:text-[11px] text-white/50 leading-relaxed">
              {t('chat.advancedDialog.systemPromptHint')}
            </p>
          </div>

          {/* 对话记忆轮数 */}
          <div className="space-y-2 rounded-xl bg-white/[0.02] border border-white/5 p-3 min-w-0">
            <div className="flex items-center justify-between text-xs">
              <label className="font-medium text-white/90 flex items-center gap-1.5">
                <History className="h-3.5 w-3.5 text-brand-300" />
                <span>{t('chat.advancedDialog.memoryTurnsLabel')}</span>
                {turnsOverridden && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-400/30">
                    {t('chat.advancedDialog.saved')}
                  </span>
                )}
              </label>
              {draftTurns !== deviceRecommended && (
                <button
                  type="button"
                  onClick={handleResetTurns}
                  className="inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-brand-300 transition-colors"
                  title={t('chat.advancedDialog.reset')}
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{t('chat.advancedDialog.reset')}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Slider
                value={[draftTurns]}
                onValueChange={(vals) => setDraftTurns(vals[0] ?? deviceRecommended)}
                min={TURNS_MIN}
                max={TURNS_MAX}
                step={1}
                className="flex-1"
                aria-label={t('chat.advancedDialog.memoryTurnsLabel')}
              />
              <span className="text-xs font-mono font-semibold text-brand-300 w-8 text-right tabular-nums">
                {draftTurns}
              </span>
            </div>

            <div className="flex items-center justify-between text-[10px] text-white/40 pt-0.5">
              <span>
                {t('chat.advancedDialog.deviceDefault', {
                  count: deviceRecommended,
                })}
              </span>
              <span>
                {TURNS_MIN}–{TURNS_MAX}
              </span>
            </div>

            <p className="text-[10px] sm:text-[11px] text-white/50 leading-relaxed">
              {t('chat.advancedDialog.memoryTurnsHint')}
            </p>
          </div>

          {/* 显示对话字幕 */}
          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3 space-y-1.5 min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-3.5 w-3.5 text-brand-300" />
                <span className="text-xs font-medium text-white/90">
                  {t('chat.advancedDialog.showChatDialogueLabel')}
                </span>
                {dialogueOverridden && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-400/30">
                    {t('chat.advancedDialog.saved')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {draftShowDialogue !== DEFAULT_SHOW_CHAT_DIALOGUE && (
                  <button
                    type="button"
                    onClick={handleResetDialogue}
                    className="inline-flex items-center gap-1 text-[11px] text-white/50 hover:text-brand-300 transition-colors"
                    title={t('chat.advancedDialog.reset')}
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>{t('chat.advancedDialog.reset')}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={draftShowDialogue}
                  aria-label={t('chat.advancedDialog.showChatDialogueLabel')}
                  onClick={() => setDraftShowDialogue((prev) => !prev)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-brand-400/50 ${
                    draftShowDialogue ? 'bg-brand-500' : 'bg-white/20'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      draftShowDialogue ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
            <p className="text-[10px] sm:text-[11px] text-white/50 leading-relaxed">
              {t('chat.advancedDialog.showChatDialogueHint')}
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        <DialogFooter className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-white/10 mt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleClose}
            className="w-full sm:w-auto sm:min-w-[5rem] h-9 sm:h-8 text-xs"
          >
            {t('chat.advancedDialog.close')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className={`w-full sm:w-auto h-9 sm:h-8 text-xs font-medium min-w-[5.5rem] transition-all duration-200 ${
              saved
                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20'
                : 'bg-brand-500/20 hover:bg-brand-500/30 text-brand-100 border-brand-400/40'
            }`}
          >
            {saved ? (
              <span className="flex items-center justify-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span>{t('chat.advancedDialog.saved')}</span>
              </span>
            ) : saving ? (
              <span>{t('chat.advancedDialog.saving')}</span>
            ) : (
              <span className="flex items-center justify-center gap-1.5">
                <Save className="h-3.5 w-3.5" />
                <span>{t('chat.advancedDialog.save')}</span>
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
