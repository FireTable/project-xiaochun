import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, Smartphone, Monitor, ShieldCheck, AlertTriangle, Layers, Sparkles, Check, MemoryStick, Brain, History } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  detectGpuDeviceProfile,
  getCachedDeviceProfile,
  type GpuDeviceProfile,
} from '@/llm/webLLM';
import { vrmEngine } from '@/core/vrmEngine';

interface DeviceStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeModelId: string;
}

export const DeviceStatusDialog: React.FC<DeviceStatusDialogProps> = ({
  open,
  onOpenChange,
  activeModelId,
}) => {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<GpuDeviceProfile | null>(() => getCachedDeviceProfile());
  const [loading, setLoading] = useState(false);
  const [released, setReleased] = useState(false);

  const handleReleaseResources = () => {
    vrmEngine.releaseHeavyResources();
    setReleased(true);
    setTimeout(() => {
      setReleased(false);
    }, 2800);
  };

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void detectGpuDeviceProfile()
      .then((p) => {
        setProfile(p);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  const isHigh = profile?.tier === 'high';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(28rem,calc(100vw-1.75rem))] sm:max-w-lg">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2 text-brand-300">
            <Cpu className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 text-brand-400" />
            <DialogTitle className="text-sm sm:text-base font-semibold">
              {t('chat.deviceDialog.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-[11px] sm:text-xs text-white/60 leading-relaxed">
            {t('chat.deviceDialog.desc')}
          </DialogDescription>
        </DialogHeader>

        {loading && !profile ? (
          <div className="flex items-center justify-center py-8 text-white/50 text-xs sm:text-sm">
            <Cpu className="h-4 w-4 animate-spin mr-2" />
            <span>{t('chat.deviceDialog.evaluating')}</span>
          </div>
        ) : profile ? (
          <div className="space-y-2.5 text-xs">
            {/* 第一行：算力评定等级 & 推荐最大参数量 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 sm:p-3 flex flex-col justify-between">
                <span className="text-white/40 text-[11px] font-medium leading-none">{t('chat.deviceDialog.tier')}</span>
                <div className="h-7 sm:h-8 flex items-center gap-1.5 mt-2">
                  {isHigh ? (
                    <>
                      <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span className="text-emerald-300 text-xs sm:text-sm font-semibold leading-none">{t('chat.deviceDialog.tierHigh')}</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                      <span className="text-amber-300 text-xs sm:text-sm font-semibold leading-none">{t('chat.deviceDialog.tierLow')}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 sm:p-3 flex flex-col justify-between">
                <span className="text-white/40 text-[11px] font-medium leading-none">{t('chat.deviceDialog.recommendedMax')}</span>
                <div className="h-7 sm:h-8 flex items-center mt-2 font-mono text-sm sm:text-base font-bold text-brand-300 tracking-tight leading-none">
                  {profile.recommendedMaxB}
                </div>
              </div>
            </div>

            {/* 第二行：当前运行模型（全宽防换行孤字）与诊断说明 */}
            <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 sm:p-3 space-y-2">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-white/40 text-[11px] font-medium">{t('chat.deviceDialog.currentModel')}</span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-medium border border-emerald-500/20 font-sans">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active
                  </span>
                </div>
                <div className="rounded-lg bg-black/40 border border-white/5 px-2.5 py-1.5 font-mono text-[11px] sm:text-xs text-brand-200 break-all leading-normal select-all">
                  {activeModelId}
                </div>
              </div>

              <div className="pt-2 border-t border-white/5 space-y-0.5">
                <span className="text-white/40 text-[11px] font-medium block">
                  {t('chat.deviceDialog.reason')}
                </span>
                <p className="text-white/80 text-[11px] sm:text-xs leading-relaxed">
                  {/* ponytail: 用 i18n key + vars 渲染,英文/日文界面看到本地化文案;profile.reason 留中文 fallback。 */}
                  {t(profile.reasonKey, {
                    ...(profile.reasonVars as Record<string, unknown> | undefined),
                    defaultValue: profile.reason,
                  })}
                </p>
              </div>
            </div>

            {/* 第三行：底层硬件检测指标 */}
            <div className="rounded-xl bg-black/40 border border-white/10 p-2.5 sm:p-3 space-y-0.5">
              <div className="text-white/40 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider mb-1">
                {t('chat.deviceDialog.specsTitle')}
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/60 flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  {t('chat.deviceDialog.webgpuStatus')}
                </span>
                <span className={`inline-flex items-center gap-1 font-medium ${profile.supported ? 'text-emerald-400' : 'text-rose-400'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${profile.supported ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  {profile.supported ? t('chat.deviceDialog.supported') : t('chat.deviceDialog.unsupported')}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/60 flex items-center gap-1.5">
                  {profile.isMobile ? (
                    <Smartphone className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  ) : (
                    <Monitor className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  )}
                  {t('chat.deviceDialog.deviceType')}
                </span>
                <span className="text-white/80 font-medium">
                  {profile.isMobile ? t('chat.deviceDialog.mobile') : t('chat.deviceDialog.desktop')}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/60 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  {t('chat.deviceDialog.maxBuffer')}
                </span>
                <span className="font-mono text-white/90 font-medium">{profile.maxBufferSizeMB} MB</span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/60 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  {t('chat.deviceDialog.maxStorageBuffer')}
                </span>
                <span className="font-mono text-white/90 font-medium">{profile.maxStorageBufferMB} MB</span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/60 flex items-center gap-1.5">
                  <MemoryStick className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  {t('chat.deviceDialog.deviceMemory')}
                </span>
                <span className="font-mono text-white/90 font-medium">
                  {profile.deviceMemoryGB ? `${profile.deviceMemoryGB} GB` : '—'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/60 flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  {t('chat.deviceDialog.hardwareConcurrency')}
                </span>
                <span className="font-mono text-white/90 font-medium">{profile.hardwareConcurrency}</span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                <span className="text-white/60 flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  {t('chat.deviceDialog.contextWindow')}
                </span>
                <span className="font-mono text-white/90 font-medium">{profile.contextWindowSize} tokens</span>
              </div>

              <div className="flex items-center justify-between py-1.5">
                <span className="text-white/60 flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-white/40 shrink-0" />
                  {t('chat.deviceDialog.memoryTurns')}
                </span>
                <span className="font-mono text-brand-300 font-semibold">{profile.maxMemoryTurns} {t('chat.deviceDialog.turnsUnit')}</span>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="mt-2 flex flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReleaseResources}
            disabled={released}
            className={`w-full sm:flex-1 h-9 sm:h-8 text-xs sm:text-sm font-medium transition-all border ${released
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
              }`}
          >
            {released ? (
              <span className="flex items-center justify-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span>{t('chat.deviceDialog.releasedSuccess')}</span>
              </span>
            ) : (
              <span className="flex items-center justify-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-brand-400" />
                <span>{t('chat.deviceDialog.releaseResources')}</span>
              </span>
            )}
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full sm:flex-1 h-9 sm:h-8 bg-white/10 hover:bg-white/20 text-white border border-white/10 text-xs sm:text-sm font-medium"
          >
            {t('chat.deviceDialog.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
