/**
 * AdvancedSettingsDialog — 用户自定义系统提示词与对话记忆轮数。
 *
 * ponytail: 跟 ProviderConfigDialog 同套视觉(dark glass card,圆角,bg-white/[0.04])。
 * 字段:
 * - 系统提示词:textarea,留空 = 用默认人设
 * - 记忆轮数:`-` `+` 数字步进,1-10,有 override 时显示 override,否则显示设备推荐
 *
 * 写入 userSettings IDB;App.tsx 订阅变化 → 重新 bindSystemContext,下次 send 自动生效。
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

export const AdvancedSettingsDialog: React.FC<AdvancedSettingsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t, i18n } = useTranslation();
  // ponytail: 表单态从 IDB 同步读一次,打开 dialog 期间缓存,save 时再 persist。
  const [settings, setSettings] = useState<UserSettings>({});
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftTurns, setDraftTurns] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ponytail: 用于 onOpenAutoFocus 把焦点重定向到 system prompt textarea,
  // 不让 Radix 默认去聚焦「恢复默认」按钮。
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ponytail: 当前语言从 i18n 读 — 默认人设按语言挑,fallback zh-CN。
  const lang: Lang = ((i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LANG) as Lang);
  const defaultPrompt = XIAOCHUN_SYSTEM_PROMPT[lang] ?? XIAOCHUN_SYSTEM_PROMPT['zh-CN'];
  const deviceRecommended = getDeviceMemoryTurns();

  // 表单是否被用户改过 — 用来显示「使用默认」按钮
  const promptOverridden = (settings.systemPromptOverride?.trim() ?? '') !== '';
  const turnsOverridden = typeof settings.memoryTurnsOverride === 'number' && settings.memoryTurnsOverride > 0;

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const s = await getUserSettings();
      setSettings(s);
      // 表单初值:override 有就用,否则预填默认人设(让用户看到「当前是什么」,方便微调)
      setDraftPrompt(s.systemPromptOverride ?? defaultPrompt);
      setDraftTurns(s.memoryTurnsOverride ?? deviceRecommended);
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

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // ponytail: 文本跟默认人设字面值相等 → 视作"未设置",清掉 override,下次读默认。
      const trimmed = draftPrompt.trim();
      const promptChanged = trimmed && trimmed !== defaultPrompt;
      const turnsChanged = draftTurns !== deviceRecommended;
      await setSystemPromptOverride(promptChanged ? trimmed : null);
      await setMemoryTurnsOverride(turnsChanged ? draftTurns : null);
      // 同步本地 settings,让 "已使用 override" 提示立刻更新
      const next: UserSettings = {};
      if (promptChanged) next.systemPromptOverride = trimmed;
      if (turnsChanged) next.memoryTurnsOverride = draftTurns;
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
        // ponytail: Radix 默认会把焦点放到第一个 focusable 元素(右上角的「恢复默认」),
        // 那个按钮视觉上不显眼但被聚焦会出现 outline,看着像 bug。改到 system prompt textarea,
        // 用户一进来就能立刻打字。
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

        <div className="space-y-3 text-xs min-w-0">
          {/* 系统提示词 */}
          <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 sm:p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-[11px] font-medium flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-white/40" />
                {t('chat.advancedDialog.systemPromptLabel')}
              </span>
              <button
                type="button"
                onClick={handleResetPrompt}
                disabled={!promptOverridden}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-white/60 hover:text-white border border-white/10 hover:border-white/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                {t('chat.advancedDialog.reset')}
              </button>
            </div>
            <textarea
              ref={promptTextareaRef}
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              spellCheck={false}
              rows={6}
              className="w-full rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 font-mono text-[11px] sm:text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-[#ea8377]/60 focus:ring-2 focus:ring-[#ea8377]/20 resize-y min-h-[7rem] max-h-72 transition-all"
              placeholder={defaultPrompt}
            />
            <p className="text-[10px] sm:text-[11px] text-white/50 leading-relaxed">
              {t('chat.advancedDialog.systemPromptHint')}
            </p>
          </div>

          {/* 记忆轮数 */}
          <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 sm:p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-[11px] font-medium flex items-center gap-1.5">
                <History className="h-3.5 w-3.5 text-white/40" />
                {t('chat.advancedDialog.memoryTurnsLabel')}
              </span>
              <button
                type="button"
                onClick={handleResetTurns}
                disabled={!turnsOverridden}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-white/60 hover:text-white border border-white/10 hover:border-white/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                {t('chat.advancedDialog.reset')}
              </button>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Slider
                value={[draftTurns]}
                min={TURNS_MIN}
                max={TURNS_MAX}
                step={1}
                onValueChange={(v) => setDraftTurns(v[0])}
                aria-label={t('chat.advancedDialog.memoryTurnsLabel')}
                className="flex-1"
              />
              <div className="flex items-center justify-center h-8 min-w-[3rem] px-2 rounded-lg bg-black/40 border border-white/10 font-mono font-bold text-brand-300 text-sm tabular-nums">
                {draftTurns}
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-white/50">
              <span>
                {t('chat.advancedDialog.deviceDefault', {
                  count: deviceRecommended,
                })}
              </span>
              <span className="font-mono text-white/40">
                {TURNS_MIN}–{TURNS_MAX}
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-white/50 leading-relaxed">
              {t('chat.advancedDialog.memoryTurnsHint')}
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleClose}
            className="w-full sm:flex-1 h-9 sm:h-8"
          >
            {t('chat.advancedDialog.close')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className={`w-full sm:flex-1 h-9 sm:h-8 transition-all ${
              saved
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-brand-500/15 hover:bg-brand-500/25 text-brand-100 border-brand-400/30'
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