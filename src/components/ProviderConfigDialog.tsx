import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Server, Trash2, Check, Loader2, Globe, KeyRound, ChevronLeft, Zap, X, Save, AlertTriangle, Pencil } from 'lucide-react';
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
  KNOWN_TEMPLATES,
  listProviders,
  saveProvider,
  deleteProvider,
  getActiveProviderId,
  setActiveProviderId,
  probeProvider,
  probeAllKnownTemplates,
  getDecryptedApiKey,
  type ProviderProfile,
  type ProviderTemplate,
  type ProbeResult,
} from '@/llm/customProvider';

interface ProviderConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  id?: string;
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  availableModels: string[];
}

const EMPTY_FORM: FormState = { id: undefined, name: '', baseURL: '', apiKey: '', model: '', availableModels: [] };

export const ProviderConfigDialog: React.FC<ProviderConfigDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation();
  const [list, setList] = useState<ProviderProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [autoBusy, setAutoBusy] = useState(false);
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  // ponytail: 二次确认(行内,无弹窗)。点一次进入确认态,3s 内再点一次才真删。
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: true; models: string[]; ms: number } | { ok: false; error: string; ms: number }>(null);
  const [saving, setSaving] = useState(false);
  // ponytail: edit 页标志位独立 — 之前从 form.baseURL !== '' 反推,用户把 baseURL
  // backspace 清空就误判成「回入口页」,slider 跟着走。现在显式 set,清空字段不影响。
  const [inEditMode, setInEditMode] = useState(false);

  const refresh = async () => {
    const [all, active] = await Promise.all([listProviders(), getActiveProviderId()]);
    setList(all);
    setActiveId(active);
  };

  useEffect(() => {
    if (open) {
      void refresh();
      setForm(EMPTY_FORM);
      setInEditMode(false);
      setProbeResults([]);
      setError(null);
      setTestResult(null);
      setTesting(false);
      setSaving(false);
      setConfirmingDeleteId(null);
      // ponytail: 一进 dialog 就并行探测所有本地服务,模板卡片实时显示
      // 可用状态,省掉手动按"一键探测"按钮。
      void runProbe();
    }
  }, [open]);

  // ponytail: dialog 拆成两步流,默认在入口页;选中模板或编辑已有服务才切到 edit 页。
  // 用显式 inEditMode 标志位,而不是从 form 字段反推 — baseURL 清空不会误判回入口。
  const inEdit = inEditMode;

  // ponytail: 进编辑页 / 改 baseURL 都自动跑一次测试,把 /v1/models 拉回来填 chips,
  // 省掉手动点「测试连接」。
  useEffect(() => {
    if (!inEditMode) return;
    if (!form.baseURL.trim()) return;
    void handleTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inEditMode, form.baseURL]);

  const runProbe = async () => {
    setAutoBusy(true);
    setProbeResults([]);
    try {
      const results = await probeAllKnownTemplates('');
      setProbeResults(results);
    } finally {
      setAutoBusy(false);
    }
  };

  const probeById = (id: string) => probeResults.find((r) => r.template.id === id);

  const applyTemplate = (tpl: ProviderTemplate, availableModels: string[] = []) => {
    setForm({
      id: undefined,
      name: t(tpl.labelKey),
      baseURL: tpl.defaultBaseURL,
      apiKey: '',
      model: availableModels[0] ?? tpl.defaultModel,
      availableModels,
    });
    setInEditMode(true);
    setError(null);
  };

  const handleEdit = (p: ProviderProfile) => {
    setForm({
      id: p.id,
      name: p.name,
      baseURL: p.baseURL,
      apiKey: '',
      model: p.model,
      availableModels: p.availableModels ?? [],
    });
    setInEditMode(true);
    setError(null);
  };

  const handleBack = () => {
    setForm(EMPTY_FORM);
    setInEditMode(false);
    setError(null);
    // ponytail: 顺手清掉测试结果 / saving 状态,避免回到入口页残留旧状态。
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
      // ponytail: 编辑已有服务时,用户没改 key 就从加密存储里拿 — 不强制重输 key。
      let key = form.apiKey;
      if (!key && form.id) key = (await getDecryptedApiKey(form.id)) ?? '';
      const res = await probeProvider(form.baseURL, key);
      const ms = Math.round(performance.now() - start);
      if (res.ok) {
        setTestResult({ ok: true, models: res.models, ms });
        // ponytail: 测试成功顺便刷新可选 model 列表;若当前 model 字段为空则填第一个。
        setForm((f) => ({
          ...f,
          availableModels: res.models,
          model: f.model.trim() ? f.model : (res.models[0] ?? f.model),
        }));
      } else {
        setTestResult({ ok: false, error: res.error ?? 'failed', ms });
      }
    } catch (err) {
      setTestResult({ ok: false, error: String((err as Error)?.message ?? err), ms: Math.round(performance.now() - start) });
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
        name: form.name,
        protocol: 'openai-compatible',
        baseURL: form.baseURL,
        apiKey: form.apiKey,
        model: form.model,
        availableModels: form.availableModels,
      });
      await setActiveProviderId(saved.id);
      // ponytail: 先刷列表,再清 form — 滑回入口页时新服务已就位,不会闪一下空白。
      await refresh();
      setForm(EMPTY_FORM);
      setInEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id: string) => {
    await setActiveProviderId(id);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteProvider(id);
    setConfirmingDeleteId(null);
    await refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(28rem,calc(100vw-1.5rem))] sm:max-w-lg max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] overflow-y-auto">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2 text-brand-300">
            <Server className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
            <DialogTitle className="text-sm sm:text-base font-semibold">
              {t('providerConfig.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-[11px] sm:text-xs text-white/60 leading-relaxed">
            {t('providerConfig.desc')}
          </DialogDescription>
        </DialogHeader>

        {/* ponytail: 入口页 ↔ 编辑页用横向 slider 切换,translate-x -50% 滑出/滑入 */}
        <div className="overflow-hidden">
          <div
            className={`flex w-[200%] transition-transform duration-300 ease-out ${inEdit ? '-translate-x-1/2' : 'translate-x-0'
              }`}
          >
            <div className="w-1/2 pr-1.5">
              {/* ─────── 入口页 ─────── */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="text-white/60 text-xs font-semibold">{t('providerConfig.configured')}</div>
                  {list.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-5 text-white/40 text-xs text-center">
                      {t('providerConfig.empty')}
                    </div>
                  ) : (
                    list.map((p) => (
                      <React.Fragment key={p.id}>
                        <div
                          className={`relative flex items-center gap-2 overflow-hidden rounded-xl border p-2.5 transition-colors ${p.id === activeId
                            ? 'bg-emerald-500/10 border-emerald-500/30'
                            : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] cursor-pointer'
                            }`}
                          onClick={() => {
                            // ponytail: 点卡片 = 切换激活;已激活的就不再切。
                            if (p.id !== activeId) void handleActivate(p.id);
                          }}
                        >
                          <Globe className="h-4 w-4 text-white/40 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-white text-sm font-medium truncate">{p.name}</div>
                            <div className="text-white/50 text-xs truncate font-mono">{p.model}</div>
                          </div>
                          {/* ponytail: 激活态的角标 — 斜三角 + 白勾,overflow-hidden 自动
                            跟着 rounded-xl 走,三角的直角被卡片圆角切掉,贴合。 */}
                          {p.id === activeId && (
                            <div className="absolute right-0 bottom-0 w-7 h-7 pointer-events-none" aria-hidden>
                              <div
                                className="absolute inset-0 bg-emerald-500/25 border-l border-t border-emerald-300/40"
                                style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
                              />
                              <Check className="absolute right-1 bottom-1 w-2.5 h-2.5 text-white" strokeWidth={3} />
                            </div>
                          )}
                          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <IconBtn aria={t('providerConfig.edit')} onClick={() => handleEdit(p)}><Pencil className="h-4 w-4" /></IconBtn>
                            <button
                              type="button"
                              aria-label={t('providerConfig.delete')}
                              title={t('providerConfig.delete')}
                              onClick={() => setConfirmingDeleteId(p.id)}
                              className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${confirmingDeleteId === p.id
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
                              <span className="truncate">{t('providerConfig.confirmDelete', { name: p.name })}</span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                                className="h-7 px-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-xs font-medium transition-colors"
                              >{t('providerConfig.cancel')}</button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(p.id)}
                                className="h-7 px-2.5 rounded-lg bg-rose-500/80 hover:bg-rose-500 text-white text-xs font-medium transition-colors"
                              >{t('providerConfig.confirm')}</button>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="text-white/60 text-xs font-semibold flex items-center justify-between">
                    <span>{t('providerConfig.templatesTitle')}</span>
                    {autoBusy && <Loader2 className="h-3 w-3 animate-spin text-white/40" />}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {KNOWN_TEMPLATES.map((tpl) => {
                      const probe = probeById(tpl.id);
                      // ponytail: 探测完成且 ok=false 视为本地未跑,卡片 disabled;
                      // 探测中或 ok=true 都开放点击。custom / 自定义 endpoint 不依赖探测,
                      // 总是可点。
                      const reachable = tpl.id === 'custom' || probe?.ok === true;
                      const probing = autoBusy && !probe;
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => applyTemplate(tpl)}
                          disabled={!reachable && !probing}
                          className={`relative rounded-xl border py-2 pl-2.5 pr-7 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${reachable
                            ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.10] active:bg-white/[0.16]'
                            : 'border-white/[0.06] bg-white/[0.02] opacity-50 cursor-not-allowed'
                            }`}
                        >
                          <div className="text-white text-sm font-medium truncate">{t(tpl.labelKey)}</div>
                          <div className="text-white/50 text-xs truncate font-mono">{tpl.defaultBaseURL.replace(/^https?:\/\//, '')}</div>
                          {tpl.id !== 'custom' && (
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
                    className="flex items-center gap-0.5 text-white/60 hover:text-white transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />{t('providerConfig.back')}</button>
                  <span className="text-white/20">/</span>
                  <span>{form.id ? t('providerConfig.editService') : t('providerConfig.addService')}</span>
                </div>

                <div className="space-y-2.5">
                  <Field
                    label={t('providerConfig.fieldBaseURL')}
                    value={form.baseURL}
                    onChange={(v) => setForm((f) => ({ ...f, baseURL: v }))}
                    placeholder="http://localhost:11434/v1"
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
                  {/* ponytail: 测试连接紧贴 API Key — 用户填完 baseURL + key 立刻就能验证,
                  成功会回填 model chips,免得手动粘 model 名。 */}
                  <div className="flex items-center gap-2 -mt-1">
                    <button
                      type="button"
                      onClick={() => void handleTest()}
                      disabled={testing || !form.baseURL.trim()}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      {t('providerConfig.test')}
                    </button>
                    {testResult && !testing && testResult.ok && (
                      <div className="flex items-center gap-1 text-xs text-emerald-400 min-w-0">
                        <Check className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{t('providerConfig.connected', { count: testResult.models.length, ms: testResult.ms })}</span>
                      </div>
                    )}
                    {testResult && !testing && !testResult.ok && (
                      <div className="flex items-center gap-1 text-xs text-rose-400 min-w-0">
                        <X className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate" title={(testResult as any).error}>{t('providerConfig.connectFailed', { error: (testResult as any).error })}</span>
                      </div>
                    )}
                  </div>
                  <Field
                    label={t('providerConfig.fieldModel')}
                    value={form.model}
                    onChange={(v) => setForm((f) => ({ ...f, model: v }))}
                    placeholder={t('providerConfig.modelPlaceholder')}
                    mono
                  />
                  {form.availableModels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 -mt-1">
                      {form.availableModels.slice(0, 12).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, model: m }))}
                          className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${form.model === m
                            ? 'bg-brand-500/25 border-brand-400/60 text-brand-100'
                            : 'bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.08]'
                            }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
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
          >{t('providerConfig.close')}</Button>
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
    className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${danger
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
        className={`w-full bg-white/[0.04] border border-white/10 rounded-lg ${icon ? 'pl-7' : 'pl-2'} pr-2 py-1.5 text-xs sm:text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-400/60 focus:bg-white/[0.08] transition-colors ${mono ? 'font-mono' : ''}`}
      />
    </div>
  </label>
);