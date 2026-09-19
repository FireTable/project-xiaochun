import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
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
  APP_UPDATE_CHECK_EVENT,
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  githubReleaseUrl,
  type AppUpdateInfo,
} from '@/lib/appUpdater';
import { isTauri } from '@/lib/platform';
import { openExternal } from '@/lib/openExternal';

type DialogMode = 'hidden' | 'checking' | 'available' | 'upToDate' | 'error';

interface AppUpdateDialogProps {
  allowPrompt: boolean;
}

const GENERIC_NOTES = /see the release assets below/i;

function usefulUpdateNotes(body: string | null): string | null {
  if (!body) return null;
  const text = body.trim();
  if (!text || GENERIC_NOTES.test(text)) return null;
  return text;
}

export const AppUpdateDialog: React.FC<AppUpdateDialogProps> = ({ allowPrompt }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DialogMode>('hidden');
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const queuedRef = useRef<AppUpdateInfo | null>(null);
  const checkingRef = useRef(false);
  const installingRef = useRef(false);
  const showResultRef = useRef(false);
  const allowPromptRef = useRef(allowPrompt);
  allowPromptRef.current = allowPrompt;

  const runCheck = async (manual: boolean) => {
    if (installingRef.current) return;
    if (manual) {
      showResultRef.current = true;
      setError(null);
      setMode('checking');
    }
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const next = await checkForAppUpdate();
      if (next) {
        setInfo(next);
        setCurrentVersion(next.currentVersion);
        queuedRef.current = null;
        if (showResultRef.current || allowPromptRef.current) {
          setMode('available');
        } else {
          queuedRef.current = next;
        }
        return;
      }
      queuedRef.current = null;
      setInfo(null);
      if (showResultRef.current) setMode('upToDate');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[AppUpdateDialog] check failed:', err);
      if (showResultRef.current) {
        setError(message);
        setMode('error');
      }
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isTauri()) return;
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        if (!cancelled) setCurrentVersion(await getVersion());
      } catch {
        /* ignore */
      }
      if (!cancelled) await runCheck(false);
    })();
    const onManual = () => {
      void runCheck(true);
    };
    window.addEventListener(APP_UPDATE_CHECK_EVENT, onManual);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_UPDATE_CHECK_EVENT, onManual);
    };
  }, []);

  useEffect(() => {
    if (!allowPrompt || !queuedRef.current) return;
    setInfo(queuedRef.current);
    queuedRef.current = null;
    setMode('available');
  }, [allowPrompt]);

  const open = mode !== 'hidden';
  const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
  const notes = usefulUpdateNotes(info?.body ?? null);

  const handleInstall = async () => {
    installingRef.current = true;
    setInstalling(true);
    setError(null);
    try {
      await downloadAndInstallAppUpdate((nextDownloaded, nextTotal) => {
        setDownloaded(nextDownloaded);
        setTotal(nextTotal);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[AppUpdateDialog] install failed:', err);
      setError(message);
      setMode('error');
      installingRef.current = false;
      setInstalling(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !installing) {
          showResultRef.current = false;
          setMode('hidden');
        }
      }}
    >
      <DialogContent
        showCloseButton={!installing}
        className="max-w-[min(22rem,calc(100vw-1.75rem))] sm:max-w-sm"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2 text-brand-300">
            <Download className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 text-brand-400" />
            <DialogTitle className="text-sm sm:text-base font-semibold">
              {mode === 'checking'
                ? t('updater.checkingTitle')
                : mode === 'upToDate'
                  ? t('updater.upToDateTitle')
                  : mode === 'error'
                    ? t('updater.errorTitle')
                    : t('updater.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-[11px] sm:text-xs text-white/60 leading-relaxed">
            {mode === 'checking'
              ? t('updater.checkingDesc')
              : mode === 'available' && info
                ? t('updater.availableDesc', { current: info.currentVersion, next: info.version })
                : mode === 'upToDate'
                  ? t('updater.upToDate', { version: currentVersion })
                  : error
                    ? t('updater.error', { message: error })
                    : null}
          </DialogDescription>
        </DialogHeader>

        {mode === 'available' && info && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 flex flex-col gap-1">
                <span className="text-[10px] text-white/40 font-medium leading-none">
                  {t('updater.currentLabel')}
                </span>
                <span className="font-mono text-sm text-white/80 tabular-nums">{info.currentVersion}</span>
              </div>
              <div className="rounded-xl bg-brand-500/10 border border-brand-400/20 p-2.5 flex flex-col gap-1">
                <span className="text-[10px] text-brand-300/80 font-medium leading-none">
                  {t('updater.nextLabel')}
                </span>
                <span className="font-mono text-sm text-brand-200 tabular-nums">{info.version}</span>
              </div>
            </div>
            {notes ? (
              <p className="rounded-xl bg-white/[0.04] border border-white/10 px-2.5 py-2 text-[11px] leading-relaxed text-white/65">
                {notes}
              </p>
            ) : null}
            <a
              href={githubReleaseUrl(info.version)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-brand-300/90 hover:text-brand-200 transition-colors"
              onClick={(e) => {
                if (!isTauri()) return;
                e.preventDefault();
                void openExternal(githubReleaseUrl(info.version));
              }}
            >
              <ExternalLink className="h-3 w-3" />
              {t('updater.changelog')}
            </a>
            {installing && (
              <div className="space-y-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-brand-400 transition-[width] duration-200"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="text-[11px] text-white/50">{t('updater.downloading')}</p>
              </div>
            )}
          </div>
        )}

        {mode === 'checking' && (
          <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-[11px] text-white/55">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-300" />
            {t('updater.checkingHint')}
          </div>
        )}

        {mode !== 'checking' && (
        <DialogFooter className="mt-1 flex flex-row gap-2 sm:space-x-0">
          {mode === 'available' ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={installing}
                onClick={() => setMode('hidden')}
                className="flex-1 h-9"
              >
                {t('updater.later')}
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={installing}
                onClick={() => void handleInstall()}
                className="flex-1 h-9"
              >
                {installing ? (
                  <span className="flex items-center justify-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('updater.downloading')}
                  </span>
                ) : (
                  t('updater.install')
                )}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setMode('hidden')}
              className="flex-1 h-9"
            >
              {t('updater.ok')}
            </Button>
          )}
        </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
