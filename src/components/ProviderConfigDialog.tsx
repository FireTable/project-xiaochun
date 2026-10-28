import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Server,
  Trash2,
  Check,
  Loader2,
  Globe,
  KeyRound,
  ChevronLeft,
  Zap,
  X,
  Save,
  AlertTriangle,
  Pencil,
  Sparkles,
  Mic,
  Volume2,
  Radio,
  ShieldCheck,
  Cpu,
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
  KNOWN_LLM_TEMPLATES,
  KNOWN_STT_TEMPLATES,
  KNOWN_TTS_TEMPLATES,
  listProviders,
  saveProvider,
  deleteProvider,
  getActiveProviderId,
  setActiveProviderId,
  probeProvider,
  probeAllKnownTemplates,
  getDecryptedApiKey,
  readActiveSttMode,
  writeActiveSttMode,
  readActiveTtsMode,
  writeActiveTtsMode,
  type ProviderProfile,
  type ProviderTemplate,
  type ProviderType,
  type ProbeResult,
  type ActiveSttMode,
  type ActiveTtsMode,
} from '@/llm/customProvider';

interface ProviderConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  id?: string;
  type: ProviderType;
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  voice?: string;
  availableModels: string[];
}

const EMPTY_FORM: FormState = {
  id: undefined,
  type: 'llm',
  name: '',
  baseURL: '',
  apiKey: '',
  model: '',
  voice: '',
  availableModels: [],
};

export const ProviderConfigDialog: React.FC<ProviderConfigDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ProviderType>('llm');

  const [list, setList] = useState<ProviderProfile[]>([]);
  const [activeLlmId, setActiveLlmId] = useState<string | null>(null);
  const [activeSttMode, setActiveSttMode] = useState<ActiveSttMode>({ kind: 'builtin' });
  const [activeTtsMode, setActiveTtsMode] = useState<ActiveTtsMode>({ kind: 'builtin' });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [autoBusy, setAutoBusy] = useState(false);
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    null | { ok: true; models: string[]; ms: number } | { ok: false; error: string; ms: number }
  >(null);
  const [saving, setSaving] = useState(false);
  const [inEditMode, setInEditMode] = useState(false);

  const getCurrentTemplates = (): ProviderTemplate[] => {
    switch (activeTab) {
      case 'stt':
        return KNOWN_STT_TEMPLATES;
      case 'tts':
        return KNOWN_TTS_TEMPLATES;
      case 'llm':
      default:
        return KNOWN_LLM_TEMPLATES;
    }
  };

  const refresh = async () => {
    const [all, activeLlm] = await Promise.all([
      listProviders(activeTab),
      getActiveProviderId(),
    ]);
    setList(all);
    setActiveLlmId(activeLlm);
    setActiveSttMode(readActiveSttMode());
    setActiveTtsMode(readActiveTtsMode());
  };

  useEffect(() => {
    if (open) {
      void refresh();
      setForm({ ...EMPTY_FORM, type: activeTab });
      setInEditMode(false);
      setProbeResults([]);
      setError(null);
      setTestResult(null);
      setTesting(false);
      setSaving(false);
      setConfirmingDeleteId(null);
      void runProbe(activeTab);
    }
  }, [open, activeTab]);

  const inEdit = inEditMode;

  useEffect(() => {
    if (!inEditMode) return;
    if (!form.baseURL.trim()) return;
    void handleTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inEditMode, form.baseURL]);

  const runProbe = async (tab: ProviderType) => {
    setAutoBusy(true);
    setProbeResults([]);
    try {
      const templates =
        tab === 'stt'
          ? KNOWN_STT_TEMPLATES
          : tab === 'tts'
            ? KNOWN_TTS_TEMPLATES
            : KNOWN_LLM_TEMPLATES;
      const results = await probeAllKnownTemplates('', templates);
      setProbeResults(results);
    } finally {
      setAutoBusy(false);
    }
  };

  const probeById = (id: string) => probeResults.find((r) => r.template.id === id);

  const applyTemplate = (tpl: ProviderTemplate, availableModels: string[] = []) => {
    setForm({
      id: undefined,
      type: activeTab,
      name: tpl.labelKey.startsWith('providerConfig.') ? t(tpl.labelKey) : tpl.labelKey,
      baseURL: tpl.defaultBaseURL,
      apiKey: '',
      model: availableModels[0] ?? tpl.defaultModel,
      voice: tpl.defaultVoice ?? '',
      availableModels,
    });
    setInEditMode(true);
    setError(null);
  };

  const handleEdit = (p: ProviderProfile) => {
    setForm({
      id: p.id,
      type: p.type ?? activeTab,
      name: p.name,
      baseURL: p.baseURL,
      apiKey: '',
      model: p.model,
      voice: p.voice ?? '',
      availableModels: p.availableModels ?? [],
    });
    setInEditMode(true);
    setError(null);
  };

  const handleBack = () => {
    setForm({ ...EMPTY_FORM, type: activeTab });
    setInEditMode(false);
    setError(null);
    setTestResult(null);
    setTesting(false);
    setSaving(false);
  };

  const handleTest = async () => {
    if (!form.baseURL.trim()) return;
    setTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      let key = form.apiKey;
      if (!key && form.id) key = (await getDecryptedApiKey(form.id)) ?? '';
      const res = await probeProvider(form.baseURL, key);
      const ms = Math.round(performance.now() - start);
      if (res.ok) {
        setTestResult({ ok: true, models: res.models, ms });
        setForm((f) => ({
          ...f,
          availableModels: res.models,
          model: f.model.trim() ? f.model : res.models[0] ?? f.model,
        }));
      } else {
        setTestResult({ ok: false, error: res.error ?? 'failed', ms });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        error: String((err as Error)?.message ?? err),
        ms: Math.round(performance.now() - start),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.baseURL.trim() || !form.model.trim()) {
      setError(t('providerConfig.errorMissingFields'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await saveProvider({
        id: form.id,
        type: activeTab,
        name: form.name,
        protocol: 'openai-compatible',
        baseURL: form.baseURL,
        apiKey: form.apiKey,
        model: form.model,
        voice: form.voice,
        availableModels: form.availableModels,
      });

      if (activeTab === 'llm') {
        await setActiveProviderId(saved.id);
      } else if (activeTab === 'stt') {
        writeActiveSttMode({ kind: 'custom', providerId: saved.id });
      } else if (activeTab === 'tts') {
        writeActiveTtsMode({ kind: 'custom', providerId: saved.id });
      }

      await refresh();
      setForm({ ...EMPTY_FORM, type: activeTab });
      setInEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  const handleActivateLlm = async (id: string) => {
    await setActiveProviderId(id);
    await refresh();
  };

  const handleActivateStt = (mode: ActiveSttMode) => {
    writeActiveSttMode(mode);
    setActiveSttMode(mode);
  };

  const handleActivateTts = (mode: ActiveTtsMode) => {
    writeActiveTtsMode(mode);
    setActiveTtsMode(mode);
  };

  const handleDelete = async (id: string) => {
    await deleteProvider(id);
    setConfirmingDeleteId(null);
    await refresh();
  };

  const isProfileActive = (p: ProviderProfile): boolean => {
    if (activeTab === 'llm') return p.id === activeLlmId;
    if (activeTab === 'stt') return activeSttMode.kind === 'custom' && activeSttMode.providerId === p.id;
    if (activeTab === 'tts') return activeTtsMode.kind === 'custom' && activeTtsMode.providerId === p.id;
    return false;
  };

  const handleProfileClick = (p: ProviderProfile) => {
    if (activeTab === 'llm') {
      if (p.id !== activeLlmId) void handleActivateLlm(p.id);
    } else if (activeTab === 'stt') {
      handleActivateStt({ kind: 'custom', providerId: p.id });
    } else if (activeTab === 'tts') {
      handleActivateTts({ kind: 'custom', providerId: p.id });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(30rem,calc(100vw-1.5rem))] sm:max-w-lg max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] overflow-y-auto">
        <DialogHeader className="space-y-1.5">
          <div className="flex items-center gap-2 text-brand-300">
            <Server className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
            <DialogTitle className="text-sm sm:text-base font-semibold">
              {t('providerConfig.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-[11px] sm:text-xs text-white/60 leading-relaxed">
            {t('providerConfig.desc')}
          </DialogDescription>

          {/* ─────── 三模态分段控制器 (Segmented Tab Bar) ─────── */}
          <div className="pt-1">
            <div className="grid grid-cols-3 gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('llm');
                  setInEditMode(false);
                }}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'llm'
                    ? 'bg-brand-500/25 border border-brand-400/50 text-white shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-brand-300" />
                <span>LLM 大模型</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('stt');
                  setInEditMode(false);
                }}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'stt'
                    ? 'bg-brand-500/25 border border-brand-400/50 text-white shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Mic className="h-3.5 w-3.5 text-brand-300" />
                <span>STT 识别</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('tts');
                  setInEditMode(false);
                }}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all ${
                  activeTab === 'tts'
                    ? 'bg-brand-500/25 border border-brand-400/50 text-white shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Volume2 className="h-3.5 w-3.5 text-brand-300" />
                <span>TTS 语音</span>
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* ─────── 入口页 ↔ 编辑页横向滑动 ─────── */}
        <div className="overflow-hidden mt-2">
          <div
            className={`flex w-[200%] transition-transform duration-300 ease-out ${
              inEdit ? '-translate-x-1/2' : 'translate-x-0'
            }`}
          >
            <div className="w-1/2 pr-1.5">
              {/* ─────── 入口页 ─────── */}
              <div className="space-y-3">
                {/* ─────── STT 专属工作模式选择 ─────── */}
                {activeTab === 'stt' && (
                  <div className="space-y-1.5">
                    <div className="text-white/60 text-xs font-semibold flex items-center gap-1.5">
                      <Radio className="h-3.5 w-3.5 text-brand-300" />
                      <span>工作模式</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {/* 选项 1: 内置智能混合 */}
                      <div
                        onClick={() => handleActivateStt({ kind: 'builtin' })}
                        className={`relative rounded-xl border p-2.5 cursor-pointer transition-colors ${
                          activeSttMode.kind === 'builtin'
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                            <span className="text-white text-xs font-medium">官方内置智能 (推荐)</span>
                          </div>
                          {activeSttMode.kind === 'builtin' && (
                            <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={3} />
                          )}
                        </div>
                        <div className="text-white/50 text-[11px] mt-1 pl-6">
                          优先 Cloudflare Whisper Turbo（每日免费额度），断网或超额自动无缝本地兜底
                        </div>
                      </div>

                      {/* 选项 2: 纯端侧离线 */}
                      <div
                        onClick={() => handleActivateStt({ kind: 'local' })}
                        className={`relative rounded-xl border p-2.5 cursor-pointer transition-colors ${
                          activeSttMode.kind === 'local'
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Cpu className="h-4 w-4 text-brand-300 shrink-0" />
                            <span className="text-white text-xs font-medium">纯端侧离线 (Local Only)</span>
                          </div>
                          {activeSttMode.kind === 'local' && (
                            <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={3} />
                          )}
                        </div>
                        <div className="text-white/50 text-[11px] mt-1 pl-6">
                          声音不出本机，100% 离线隐私与本地 WebWorker 识别
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─────── TTS 专属工作模式选择 ─────── */}
                {activeTab === 'tts' && (
                  <div className="space-y-1.5">
                    <div className="text-white/60 text-xs font-semibold flex items-center gap-1.5">
                      <Radio className="h-3.5 w-3.5 text-brand-300" />
                      <span>工作模式</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      <div
                        onClick={() => handleActivateTts({ kind: 'builtin' })}
                        className={`relative rounded-xl border p-2.5 cursor-pointer transition-colors ${
                          activeTtsMode.kind === 'builtin'
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                            <span className="text-white text-xs font-medium">官方内置 Edge-TTS (推荐)</span>
                          </div>
                          {activeTtsMode.kind === 'builtin' && (
                            <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={3} />
                          )}
                        </div>
                        <div className="text-white/50 text-[11px] mt-1 pl-6">
                          微软小艺/晓晓自然声线，超低延迟 + R2 双层持久缓存
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─────── 已配置自定义服务列表 ─────── */}
                <div className="space-y-1.5">
                  <div className="text-white/60 text-xs font-semibold">
                    {activeTab === 'llm'
                      ? t('providerConfig.configured')
                      : `自定义 ${activeTab.toUpperCase()} 服务`}
                  </div>
                  {list.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-4 text-white/40 text-xs text-center">
                      {activeTab === 'llm'
                        ? t('providerConfig.empty')
                        : `暂无自定义 ${activeTab.toUpperCase()} 服务，点击下方模板一键添加`}
                    </div>
                  ) : (
                    list.map((p) => {
                      const active = isProfileActive(p);
                      return (
                        <React.Fragment key={p.id}>
                          <div
                            className={`relative flex items-center gap-2 overflow-hidden rounded-xl border p-2.5 transition-colors ${
                              active
                                ? 'bg-emerald-500/10 border-emerald-500/30'
                                : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] cursor-pointer'
                            }`}
                            onClick={() => handleProfileClick(p)}
                          >
                            <Globe className="h-4 w-4 text-white/40 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-white text-sm font-medium truncate">{p.name}</div>
                              <div className="text-white/50 text-xs truncate font-mono">
                                {p.model}
                                {p.voice ? ` · 音色: ${p.voice}` : ''}
                              </div>
                            </div>
                            {active && (
                              <div
                                className="absolute right-0 bottom-0 w-7 h-7 pointer-events-none"
                                aria-hidden
                              >
                                <div
                                  className="absolute inset-0 bg-emerald-500/25 border-l border-t border-emerald-300/40"
                                  style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
                                />
                                <Check
                                  className="absolute right-1 bottom-1 w-2.5 h-2.5 text-white"
                                  strokeWidth={3}
                                />
                              </div>
                            )}
                            <div
                              className="flex items-center gap-0.5 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <IconBtn aria={t('providerConfig.edit')} onClick={() => handleEdit(p)}>
                                <Pencil className="h-4 w-4" />
                              </IconBtn>
                              <button
                                type="button"
                                aria-label={t('providerConfig.delete')}
                                title={t('providerConfig.delete')}
                                onClick={() => setConfirmingDeleteId(p.id)}
                                className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                                  confirmingDeleteId === p.id
                                    ? 'text-rose-300 bg-rose-500/20 ring-1 ring-rose-500/40'
                                    : 'text-rose-400/70 hover:text-rose-300 hover:bg-rose-500/15'
                                }`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          {confirmingDeleteId === p.id && (
                            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-rose-200 text-xs min-w-0">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                                <span className="truncate">
                                  {t('providerConfig.confirmDelete', { name: p.name })}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setConfirmingDeleteId(null)}
                                  className="h-7 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                                >
                                  {t('providerConfig.cancel')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDelete(p.id)}
                                  className="h-7 px-2.5 rounded-lg bg-rose-500/80 hover:bg-rose-500 text-white text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400/40"
                                >
                                  {t('providerConfig.confirm')}
                                </button>
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </div>

                {/* ─────── 快速添加模板库 ─────── */}
                <div className="space-y-1.5">
                  <div className="text-white/60 text-xs font-semibold flex items-center justify-between">
                    <span>{t('providerConfig.templatesTitle')}</span>
                    {autoBusy && <Loader2 className="h-3 w-3 animate-spin text-white/40" />}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {getCurrentTemplates().map((tpl) => {
                      const probe = probeById(tpl.id);
                      const reachable = tpl.id.includes('custom') || probe?.ok === true;
                      const probing = autoBusy && !probe;
                      const label = tpl.labelKey.startsWith('providerConfig.')
                        ? t(tpl.labelKey)
                        : tpl.labelKey;

                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => applyTemplate(tpl)}
                          disabled={!reachable && !probing}
                          className={`relative rounded-xl border py-2 pl-2.5 pr-7 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                            reachable
                              ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.10] active:bg-white/[0.16]'
                              : 'border-white/[0.06] bg-white/[0.02] opacity-50 cursor-not-allowed'
                          }`}
                        >
                          <div className="text-white text-sm font-medium truncate">{label}</div>
                          <div className="text-white/50 text-xs truncate font-mono">
                            {tpl.defaultBaseURL.replace(/^https?:\/\//, '')}
                          </div>
                          {!tpl.id.includes('custom') && (
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 shrink-0">
                              {probing ? (
                                <Loader2 className="h-3 w-3 animate-spin text-white/40" />
                              ) : probe?.ok ? (
                                <Check className="h-3 w-3 text-emerald-400" />
                              ) : probe ? (
                                <span className="text-rose-400 text-xs">✗</span>
                              ) : null}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="w-1/2 pl-1.5">
              {/* ─────── 编辑页 ─────── */}
              <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3">
                <div className="flex items-center gap-1.5 text-white/60 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex items-center gap-0.5 text-white/60 hover:text-white transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 rounded-md"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {t('providerConfig.back')}
                  </button>
                  <span className="text-white/20">/</span>
                  <span>
                    {form.id
                      ? `编辑 ${activeTab.toUpperCase()} 服务`
                      : `添加 ${activeTab.toUpperCase()} 服务`}
                  </span>
                </div>

                <div className="space-y-2.5">
                  <Field
                    label={t('providerConfig.fieldBaseURL')}
                    value={form.baseURL}
                    onChange={(v) => setForm((f) => ({ ...f, baseURL: v }))}
                    placeholder="https://api.openai.com/v1"
                    mono
                  />
                  <Field
                    label={t('providerConfig.apiKeyLabel')}
                    value={form.apiKey}
                    onChange={(v) => setForm((f) => ({ ...f, apiKey: v }))}
                    placeholder={t('providerConfig.apiKeyPlaceholder')}
                    type="password"
                    icon={<KeyRound className="h-3.5 w-3.5 text-white/30" />}
                  />

                  {/* 测试连接按钮 */}
                  <div className="flex items-center gap-2 -mt-1">
                    <button
                      type="button"
                      onClick={() => void handleTest()}
                      disabled={testing || !form.baseURL.trim()}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white text-xs font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {testing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Zap className="h-3.5 w-3.5" />
                      )}
                      {t('providerConfig.test')}
                    </button>
                    {testResult && !testing && testResult.ok && (
                      <div className="flex items-center gap-1 text-xs text-emerald-400 min-w-0">
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {t('providerConfig.connected', {
                            count: testResult.models.length,
                            ms: testResult.ms,
                          })}
                        </span>
                      </div>
                    )}
                    {testResult && !testing && !testResult.ok && (
                      <div className="flex items-center gap-1 text-xs text-rose-400 min-w-0">
                        <X className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate" title={(testResult as any).error}>
                          {t('providerConfig.connectFailed', { error: (testResult as any).error })}
                        </span>
                      </div>
                    )}
                  </div>

                  <Field
                    label={t('providerConfig.fieldModel')}
                    value={form.model}
                    onChange={(v) => setForm((f) => ({ ...f, model: v }))}
                    placeholder={
                      activeTab === 'stt'
                        ? 'whisper-large-v3-turbo / asr-1.0'
                        : activeTab === 'tts'
                          ? 'tts-1 / CosyVoice'
                          : t('providerConfig.modelPlaceholder')
                    }
                    mono
                  />

                  {form.availableModels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 -mt-1">
                      {form.availableModels.slice(0, 12).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, model: m }))}
                          className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                            form.model === m
                              ? 'bg-brand-500/25 border-brand-400/60 text-brand-100'
                              : 'bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.08]'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 仅 TTS 模态展示音色字段 */}
                  {activeTab === 'tts' && (
                    <Field
                      label="音色 Voice (如 alloy / alex / female-tianmei)"
                      value={form.voice ?? ''}
                      onChange={(v) => setForm((f) => ({ ...f, voice: v }))}
                      placeholder="alloy"
                    />
                  )}

                  <Field
                    label={t('providerConfig.nameLabel')}
                    value={form.name}
                    onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                    placeholder={t('providerConfig.namePlaceholder')}
                  />
                </div>

                {error && <div className="text-rose-400 text-xs">⚠ {error}</div>}

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving || !form.name.trim() || !form.baseURL.trim() || !form.model.trim()}
                  className="w-full h-9 sm:h-9 bg-brand-500/15 hover:bg-brand-500/25 text-brand-100 border-brand-400/30"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t('providerConfig.save')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full h-9 sm:h-9"
          >
            {t('providerConfig.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const IconBtn: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
  aria: string;
  danger?: boolean;
}> = ({ children, onClick, aria, danger }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={aria}
    className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
      danger
        ? 'text-white/50 hover:text-rose-400 hover:bg-rose-500/10'
        : 'text-white/50 hover:text-white hover:bg-white/10'
    }`}
  >
    {children}
  </button>
);

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  icon?: React.ReactNode;
}> = ({ label, value, onChange, placeholder, type = 'text', mono, icon }) => (
  <label className="block">
    <div className="text-white/60 text-xs mb-1 font-medium">{label}</div>
    <div className="relative">
      {icon && <span className="absolute left-2 top-1/2 -translate-y-1/2">{icon}</span>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-white/[0.04] border border-white/10 rounded-lg ${
          icon ? 'pl-7' : 'pl-2'
        } pr-2 py-1.5 text-xs sm:text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-400/60 focus:bg-white/[0.08] transition-colors ${
          mono ? 'font-mono' : ''
        }`}
      />
    </div>
  </label>
);
