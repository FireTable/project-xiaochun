/**
 * SyncDialog — 跨设备同步设置。
 *
 * ponytail: 一个 dialog 里两个 tab(分享 / 导入):
 * 1. 分享:勾选要同步的项目 → 生成 AES-GCM 加密包 → 复制完整文本(含密钥)→ 粘到另一台设备
 * 2. 导入:粘文本 → 解密 → 预览 → 确认导入
 *
 * 纯前端,无服务端,无摄像头依赖。payload 大(自定义 provider + API keys),QR 装不下,
 * 改走纯文本 transfer。
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Share2,
  Download,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Eye,
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
import {
  buildSyncPayload,
  encryptSyncPayload,
  decryptSyncPayload,
  serializeForTransfer,
  parseTransferText,
  previewImport,
  type SyncSelection,
  type SyncPayload,
  type ImportPreview,
  DEFAULT_SYNC_SELECTION,
} from '@/llm/syncPayload';
import {
  listProvidersDecrypted,
  saveProvider,
  setActiveProviderId,
  type ProviderProfile,
} from '@/llm/customProvider';
import { writeActiveKey, parseActiveKey, readActiveKey } from '@/llm/activeKey';
import { setThinkingEnabled } from '@/llm/webLLMProvider';
import { saveUserSettings, type UserSettings } from '@/llm/userSettings';

interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Tab = 'send' | 'receive';

export const SyncDialog: React.FC<SyncDialogProps> = ({ open, onOpenChange }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('send');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(28rem,calc(100vw-1.75rem))] sm:max-w-lg max-h-[90vh] overflow-x-hidden overflow-y-auto gap-3"
        onOpenAutoFocus={(e) => {
          // ponytail: 进 dialog 不要主动聚焦任何按钮,让用户看完顶部 tab 自己点。
          e.preventDefault();
        }}
      >
        <DialogHeader className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-brand-300">
            <Share2 className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 text-brand-400" />
            <DialogTitle className="text-sm sm:text-base font-semibold">
              {t('chat.sync.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-[11px] sm:text-xs text-white/60 leading-relaxed">
            {t('chat.sync.desc')}
          </DialogDescription>
        </DialogHeader>

        {/* Tab 切换 */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/10">
          <button
            type="button"
            onClick={() => setTab('send')}
            className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${tab === 'send'
                ? 'bg-brand-500/20 text-brand-100 border border-brand-400/40'
                : 'text-white/60 hover:text-white border border-transparent'
              }`}
          >
            <Share2 className="h-3.5 w-3.5" />
            {t('chat.sync.tabSend')}
          </button>
          <button
            type="button"
            onClick={() => setTab('receive')}
            className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${tab === 'receive'
                ? 'bg-brand-500/20 text-brand-100 border border-brand-400/40'
                : 'text-white/60 hover:text-white border border-transparent'
              }`}
          >
            <Download className="h-3.5 w-3.5" />
            {t('chat.sync.tabReceive')}
          </button>
        </div>

        {tab === 'send' ? <SendPanel /> : <ReceivePanel onClose={() => onOpenChange(false)} />}

        <DialogFooter >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full sm:flex-1 h-9 sm:h-8"
          >
            {t('chat.sync.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ════════════════════════════════════════════════════════════════
// Send panel
// ════════════════════════════════════════════════════════════════

const SendPanel: React.FC = () => {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<SyncSelection>(DEFAULT_SYNC_SELECTION);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings | undefined>(undefined);
  const [thinkingEnabled, setThinkingEnabledLocal] = useState<boolean | undefined>(undefined);
  const [activeKeyRaw, setActiveKeyRaw] = useState<string | null>(null);

  const [fullText, setFullText] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ponytail: dialog 打开时一次性收集本地数据 — apiKey 这时从 IDB 取出明文,
  // 打包进 sync payload 前就在内存里,不会泄漏到 React 组件层。
  useEffect(() => {
    void (async () => {
      const list = await listProvidersDecrypted();
      setProviders(list);
      const parsed = readActiveKey();
      setActiveKeyRaw(parsed ? (parsed.kind === 'custom' ? `custom:${parsed.providerId}` : `webllm:${parsed.modelId}`) : null);
      const thinkingRaw = window.localStorage.getItem('xiaochun.thinking');
      setThinkingEnabledLocal(thinkingRaw === '1' ? true : thinkingRaw === '0' ? false : undefined);
      const { getUserSettings } = await import('@/llm/userSettings');
      const s = await getUserSettings();
      setUserSettings(s);
    })();
  }, []);

  const selectedCount = [selection.models, selection.thinking, selection.chatSettings].filter(Boolean).length;

  const generate = useCallback(async () => {
    if (selectedCount === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const payload = buildSyncPayload({
        selection,
        providers: selection.models ? providers : undefined,
        thinkingEnabled: selection.thinking ? thinkingEnabled : undefined,
        userSettings: selection.chatSettings ? userSettings : undefined,
      });
      if (selection.models) payload.data.activeKey = activeKeyRaw;
      const enc = await encryptSyncPayload(payload);
      setFullText(serializeForTransfer(enc));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [selection, providers, userSettings, thinkingEnabled, activeKeyRaw, selectedCount]);

  // selection 改变时重新生成(密钥也跟着换)。
  useEffect(() => {
    if (selectedCount === 0) {
      setFullText('');
      return;
    }
    void generate();
  }, [generate, selectedCount]);

  const copyText = async () => {
    if (!fullText) return;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="space-y-3 text-xs min-w-0">
      {/* 勾选项 */}
      <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 sm:p-3 space-y-1.5">
        <span className="text-white/40 text-[11px] font-medium block">
          {t('chat.sync.selectWhat')}
        </span>
        <CheckRow
          label={t('chat.sync.optModels')}
          checked={selection.models}
          onChange={(v) => setSelection((s) => ({ ...s, models: v }))}
        />
        <CheckRow
          label={t('chat.sync.optThinking')}
          checked={selection.thinking}
          onChange={(v) => setSelection((s) => ({ ...s, thinking: v }))}
        />
        <CheckRow
          label={t('chat.sync.optChatSettings')}
          checked={selection.chatSettings}
          onChange={(v) => setSelection((s) => ({ ...s, chatSettings: v }))}
        />
      </div>

      {/* 加密文本 */}
      {fullText ? (
        <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 sm:p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-white/40 text-[11px] font-medium">
              {t('chat.sync.textTitle')}
            </span>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating}
              aria-label={t('chat.sync.regenerate')}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-white/60 hover:text-white border border-white/10 hover:border-white/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${generating ? 'animate-spin' : ''}`} />
              {t('chat.sync.regenerate')}
            </button>
          </div>
          <textarea
            value={fullText}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            spellCheck={false}
            rows={4}
            className="w-full rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 font-mono text-[10px] sm:text-[11px] text-white/90 focus:outline-none focus:border-[#ea8377]/60 focus:ring-2 focus:ring-[#ea8377]/20 resize-none min-h-[4.5rem] max-h-32 transition-all break-all select-all"
          />
          <button
            type="button"
            onClick={copyText}
            className={`w-full h-9 rounded-lg border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 flex items-center justify-center gap-1.5 ${copied
                ? 'bg-emerald-500/20 hover:bg-emerald-500/25 border-emerald-400/50 text-emerald-100'
                : 'bg-brand-500/15 hover:bg-brand-500/25 border-brand-400/40 text-brand-100'
              }`}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                {t('chat.sync.copied')}
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                {t('chat.sync.copyText')}
              </>
            )}
          </button>
          <p className="text-[10px] sm:text-[11px] text-white/50 leading-relaxed">
            {t('chat.sync.textHint')}
          </p>
        </div>
      ) : selectedCount === 0 ? (
        <p className="text-[11px] text-white/50 text-center py-3">
          {t('chat.sync.emptySelection')}
        </p>
      ) : (
        <div className="flex items-center justify-center py-6 text-white/50 text-xs">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          {t('chat.sync.generating')}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

const CheckRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="flex items-center gap-2 w-full text-left px-1.5 py-1 rounded-md hover:bg-white/[0.04] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
  >
    <span
      className={`h-4 w-4 rounded border flex items-center justify-center transition-colors ${checked ? 'bg-brand-500/30 border-brand-400/60' : 'bg-black/30 border-white/15'
        }`}
    >
      {checked && <Check className="h-3 w-3 text-brand-100" strokeWidth={3} />}
    </span>
    <span className="text-white/90 text-xs">{label}</span>
  </button>
);

// ════════════════════════════════════════════════════════════════
// Receive panel
// ════════════════════════════════════════════════════════════════

const ReceivePanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const [pasteText, setPasteText] = useState('');
  const [decrypting, setDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ payload: SyncPayload; preview: ImportPreview } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const doDecrypt = useCallback(async () => {
    setError(null);
    setPreview(null);
    setDecrypting(true);
    try {
      const encrypted = parseTransferText(pasteText);
      const payload = await decryptSyncPayload(encrypted);
      const imp = previewImport(payload);
      setPreview({ payload, preview: imp });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDecrypting(false);
    }
  }, [pasteText]);

  const doApply = useCallback(async () => {
    if (!preview) return;
    setApplying(true);
    setError(null);
    try {
      const { payload } = preview;
      const data = payload.data;
      if (data.providers) {
        for (const p of data.providers) {
          await saveProvider({
            id: p.id,
            name: p.name,
            protocol: p.protocol,
            baseURL: p.baseURL,
            apiKey: p.apiKey,
            model: p.model,
            recentModels: p.recentModels,
            lastProbeOk: p.lastProbeOk,
            lastProbeAt: p.lastProbeAt,
            availableModels: p.availableModels,
          });
        }
      }
      if (data.providers) {
        await setActiveProviderId(null);
      }
      if (data.activeKey !== undefined) {
        if (data.activeKey === null) {
          writeActiveKey(null);
        } else {
          const parsed = parseActiveKey(data.activeKey);
          if (parsed) writeActiveKey(parsed);
        }
      }
      if (data.thinkingEnabled !== undefined) {
        setThinkingEnabled(data.thinkingEnabled);
      }
      if (data.userSettings) {
        await saveUserSettings(data.userSettings);
      }
      setApplied(true);
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }, [preview, onClose]);

  return (
    <div className="space-y-3 text-xs min-w-0">
      {/* 粘文本 */}
      <div className="rounded-xl bg-white/[0.04] border border-white/10 p-2.5 sm:p-3 space-y-3">
        <span className="text-white/40 text-[11px] font-medium block">
          {t('chat.sync.pasteTitle')}
        </span>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          spellCheck={false}
          rows={4}
          placeholder={t('chat.sync.pasteTextPlaceholder')}
          className="w-full rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 font-mono text-[10px] sm:text-[11px] text-white/90 placeholder:text-white/30 focus:outline-none focus:border-[#ea8377]/60 focus:ring-2 focus:ring-[#ea8377]/20 resize-none min-h-[4.5rem] max-h-32 transition-all break-all"
        />
        <button
          type="button"
          onClick={() => void doDecrypt()}
          disabled={!pasteText.trim() || decrypting}
          className="w-full h-9 rounded-lg bg-brand-500/20 hover:bg-brand-500/30 border border-brand-400/40 text-brand-100 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          {decrypting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          {t('chat.sync.decryptBtn')}
        </button>
      </div>

      {preview && (
        <div className="rounded-xl bg-white/[0.04] border border-brand-400/30 p-2.5 sm:p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-brand-300 text-[11px] font-medium flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              {t('chat.sync.previewTitle')}
            </span>
            <span className="text-[10px] text-white/40 font-mono">
              {new Date(preview.payload.ts).toLocaleString()}
            </span>
          </div>
          <PreviewRows preview={preview.preview} t={t} />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {preview && (
        <DialogFooter className="gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            className="w-full sm:flex-1 h-9 sm:h-8"
          >
            {t('chat.sync.cancel')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void doApply()}
            disabled={applying || applied}
            className={`w-full sm:flex-1 h-9 sm:h-8 transition-all ${applied
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-brand-500/15 hover:bg-brand-500/25 text-brand-100 border-brand-400/30'
              }`}
          >
            {applied ? (
              <span className="flex items-center justify-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                {t('chat.sync.applied')}
              </span>
            ) : applying ? (
              <span>{t('chat.sync.applying')}</span>
            ) : (
              <span className="flex items-center justify-center gap-1.5">
                <Check className="h-3.5 w-3.5" />
                {t('chat.sync.applyBtn')}
              </span>
            )}
          </Button>
        </DialogFooter>
      )}
    </div>
  );
};

const PreviewRows: React.FC<{ preview: ImportPreview; t: ReturnType<typeof useTranslation>['t'] }> = ({ preview, t }) => {
  const rows: Array<{ label: string; value: string; tone?: 'brand' | 'plain' }> = [];
  if (preview.activeKey !== undefined) {
    if (preview.activeKey === null) {
      rows.push({ label: t('chat.sync.rowActive'), value: t('chat.sync.valueNone'), tone: 'plain' });
    } else {
      const { kind, value } = preview.activeKey;
      rows.push({
        label: t('chat.sync.rowActive'),
        value: `${kind}:${value}`,
        tone: 'brand',
      });
    }
  }
  if (preview.providersCount > 0) {
    rows.push({
      label: t('chat.sync.rowProviders'),
      value: t('chat.sync.valueProviders', {
        count: preview.providersCount,
        names: preview.providerNames.join(', '),
      }),
      tone: 'brand',
    });
  } else if (preview.providersCount === 0 && preview.activeKey === undefined) {
    // skip
  } else {
    rows.push({
      label: t('chat.sync.rowProviders'),
      value: t('chat.sync.valueProvidersEmpty'),
      tone: 'plain',
    });
  }
  if (preview.thinkingEnabled !== undefined) {
    rows.push({
      label: t('chat.sync.rowThinking'),
      value: preview.thinkingEnabled ? t('chat.sync.valueOn') : t('chat.sync.valueOff'),
      tone: 'plain',
    });
  }
  if (preview.hasCustomPrompt || preview.memoryTurnsOverride !== undefined) {
    const parts: string[] = [];
    if (preview.hasCustomPrompt) parts.push(t('chat.sync.valuePromptCustom'));
    else parts.push(t('chat.sync.valuePromptDefault'));
    if (preview.memoryTurnsOverride !== undefined) {
      parts.push(t('chat.sync.valueTurns', { count: preview.memoryTurnsOverride }));
    }
    rows.push({
      label: t('chat.sync.rowChatSettings'),
      value: parts.join(' · '),
      tone: 'brand',
    });
  }
  return (
    <ul className="space-y-1">
      {rows.map((r, i) => (
        <li key={i} className="flex items-baseline gap-2 text-[11px]">
          <span className="text-white/40 shrink-0">{r.label}</span>
          <span
            className={`font-mono truncate ${r.tone === 'brand' ? 'text-brand-200' : 'text-white/70'
              }`}
            title={r.value}
          >
            {r.value}
          </span>
        </li>
      ))}
    </ul>
  );
};