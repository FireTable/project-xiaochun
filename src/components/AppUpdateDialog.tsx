import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
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
  type AppUpdateInfo,
} from '@/lib/appUpdater';
import { isTauri } from '@/lib/platform';

type DialogMode = 'hidden' | 'available' | 'upToDate' | 'error';

interface AppUpdateDialogProps {
  allowPrompt: boolean;
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
  const allowPromptRef = useRef(allowPrompt);
  allowPromptRef.current = allowPrompt;

  const runCheck = async (manual: boolean) => {
    if (checkingRef.current || installingRef.current) return;
    checkingRef.current = true;
    try {
      const next = await checkForAppUpdate();
      if (next) {
        setInfo(next);
        setCurrentVersion(next.currentVersion);
        if (allowPromptRef.current || manual) {
          queuedRef.current = null;
          setMode('available');
        } else {
          queuedRef.current = next;
        }
        return;
      }
      queuedRef.current = null;
      setInfo(null);
      if (manual) setMode('upToDate');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[AppUpdateDialog] check failed:', err);
      if (manual) {
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
        /* ignore — up-to-date copy can omit the version */
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
        if (!next && !installing) setMode('hidden');
      }}
    >
      <DialogContent showCloseButton={!installing}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-brand-300" />
            {mode === 'upToDate'
              ? t('updater.upToDateTitle')
              : mode === 'error'
                ? t('updater.errorTitle')
                : t('updater.title')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'available' && info
              ? t('updater.next', { version: info.version })
              : mode === 'upToDate'
                ? t('updater.upToDate', { version: currentVersion })
                : error
                  ? t('updater.error', { message: error })
                  : null}
          </DialogDescription>
        </DialogHeader>

        {mode === 'available' && info && (
          <div className="space-y-3 text-sm text-white/80">
            <p className="text-xs text-white/50">
              {t('updater.current', { version: info.currentVersion })}
            </p>
            {info.body ? (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-white/70">
                {info.body}
              </pre>
            ) : null}
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

        <DialogFooter className="mt-2 gap-2">
          {mode === 'available' ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={installing}
                onClick={() => setMode('hidden')}
                className="w-full sm:flex-1 h-9 sm:h-8"
              >
                {t('updater.later')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={installing}
                onClick={() => void handleInstall()}
                className="w-full sm:flex-1 h-9 sm:h-8 bg-brand-500/15 hover:bg-brand-500/25 text-brand-100 border-brand-400/30"
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
              className="w-full sm:flex-1 h-9 sm:h-8"
            >
              {t('updater.ok')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
