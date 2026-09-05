import React, { useEffect, useState } from 'react';
import { Server, Trash2, Check, Loader2, Globe, Power, KeyRound, ChevronLeft, Zap, X } from 'lucide-react';
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
} from '@/llm/providers';

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
  const [list, setList] = useState<ProviderProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [autoBusy, setAutoBusy] = useState(false);
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: true; models: string[]; ms: number } | { ok: false; error: string; ms: number }>(null);

  const refresh = async () => {
    const [all, active] = await Promise.all([listProviders(), getActiveProviderId()]);
    setList(all);
    setActiveId(active);
  };

  useEffect(() => {
    if (open) {
      void refresh();
      setForm(EMPTY_FORM);
      setProbeResults([]);
      setError(null);
      // ponytail: 一进 dialog 就并行探测所有本地服务,模板卡片实时显示
      // 可用状态,省掉手动按"一键探测"按钮。
      void runProbe();
    }
  }, [open]);

  // ponytail: dialog 拆成两步流,默认在入口页;选中模板或编辑已有服务才切到 edit 页。
  const inEdit = form !== null && (form.id !== undefined || form.baseURL !== '');

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
      name: tpl.label,
      baseURL: tpl.defaultBaseURL,
      apiKey: '',
      model: availableModels[0] ?? tpl.defaultModel,
      availableModels,
    });
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
    setError(null);
  };

  const handleBack = () => {
    setForm(EMPTY_FORM);
    setError(null);
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
      setError('请填写名称 / baseURL / model');
      return;
    }
    setError(null);
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
    setForm(EMPTY_FORM);
    await refresh();
  };

  const handleActivate = async (id: string) => {
    await setActiveProviderId(id);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteProvider(id);
    await refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(28rem,calc(100vw-1.5rem))] sm:max-w-lg max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] overflow-y-auto">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2 text-brand-300">
            <Server className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
            <DialogTitle className="text-sm sm:text-base font-semibold">
              连接自定义模型服务
            </DialogTitle>
          </div>
          <DialogDescription className="text-[11px] sm:text-xs text-white/60 leading-relaxed">
            连接 OpenAI 兼容服务(本地 Ollama / LM Studio / vLLM / 云厂商)。选中的服务会跳过 webLLM 走 HTTP 直连，API Key 与配置仅在本机加密存储。
          </DialogDescription>
        </DialogHeader>

        {/* ponytail: 入口页 ↔ 编辑页用横向 slider 切换,translate-x -50% 滑出/滑入 */}
        <div className="overflow-hidden">
          <div
            className={`flex w-[200%] transition-transform duration-300 ease-out ${
              inEdit ? '-translate-x-1/2' : 'translate-x-0'
            }`}
          >
            <div className="w-1/2 pr-1.5">
          {/* ─────── 入口页 ─────── */}
          <div className="space-y-3">
            {list.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-white/60 text-xs font-semibold">当前</div>
                {list.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 rounded-xl border p-2.5 ${
                      p.id === activeId
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-white/[0.04] border-white/10'
                    }`}
                  >
                    <Globe className="h-4 w-4 text-white/40 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-white text-sm font-medium truncate">{p.name}</span>
                        {p.id === activeId ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-medium border border-emerald-500/30">Active</span>
                        ) : null}
                      </div>
                      <div className="text-white/50 text-xs truncate font-mono">{p.model}</div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {p.id !== activeId ? (
                        <IconBtn aria="启用" onClick={() => void handleActivate(p.id)}><Power className="h-4 w-4" /></IconBtn>
                      ) : null}
                      <IconBtn aria="编辑" onClick={() => handleEdit(p)}><ChevronLeft className="h-4 w-4 -rotate-180" /></IconBtn>
                      <IconBtn aria="删除" danger onClick={() => void handleDelete(p.id)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-white/60 text-xs font-semibold flex items-center justify-between">
                <span>选择模板</span>
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
                      className={`relative rounded-xl border py-2 px-2.5 text-left transition-colors ${
                        reachable
                          ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.10] active:bg-white/[0.16]'
                          : 'border-white/[0.06] bg-white/[0.02] opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-white text-sm font-medium truncate">{tpl.label}</span>
                        {tpl.id !== 'custom' && (
                          <span className="shrink-0">
                            {probing ? (
                              <Loader2 className="h-3 w-3 animate-spin text-white/40" />
                            ) : probe?.ok ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : probe ? (
                              <span className="text-rose-400 text-xs">✗</span>
                            ) : null}
                          </span>
                        )}
                      </div>
                      <div className="text-white/50 text-xs truncate font-mono">{tpl.defaultBaseURL.replace(/^https?:\/\//, '')}</div>
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
                <ChevronLeft className="h-3.5 w-3.5" />
                返回
              </button>
              <span className="text-white/20">/</span>
              <span>{form.id ? '编辑服务' : '添加服务'}</span>
            </div>

            <div className="space-y-2.5">
              <Field
                label="BaseURL"
                value={form.baseURL}
                onChange={(v) => setForm((f) => ({ ...f, baseURL: v }))}
                placeholder="http://localhost:11434/v1"
                mono
              />
              <Field
                label="API Key(选填)"
                value={form.apiKey}
                onChange={(v) => setForm((f) => ({ ...f, apiKey: v }))}
                placeholder="本地服务留空"
                type="password"
                icon={<KeyRound className="h-3.5 w-3.5 text-white/30" />}
              />
              <Field
                label="Model"
                value={form.model}
                onChange={(v) => setForm((f) => ({ ...f, model: v }))}
                placeholder="模型名称"
                mono
              />
              {form.availableModels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 -mt-1">
                  {form.availableModels.slice(0, 12).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, model: m }))}
                      className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
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
              <Field
                label="名称(选填)"
                value={form.name}
                onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                placeholder="自定义显示名"
              />
            </div>

            {error && <div className="text-rose-400 text-xs">⚠ {error}</div>}

            {/* ponytail: 测试连接 + 状态行 — 用当前表单里的 baseURL/apiKey/model 探测,
                成功会顺手把可选 model 列表拉回来。 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={testing || !form.baseURL.trim()}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                测试连接
              </button>
              {testResult && !testing && (
                <div className={`flex items-center gap-1 text-xs ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {testResult.ok ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>已连接 · {testResult.models.length} 个模型 · {testResult.ms} ms</span>
                    </>
                  ) : (
                    <>
                      <X className="h-3.5 w-3.5" />
                      <span className="truncate" title={testResult.error}>连接失败 · {testResult.error}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => void handleSave()}
              disabled={!form.name.trim() || !form.baseURL.trim() || !form.model.trim()}
              className="w-full h-9 sm:h-9 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium"
            >
              <Check className="h-4 w-4 mr-1.5" />
              保存并启用
            </Button>
          </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full h-9 sm:h-9 bg-white/10 hover:bg-white/20 text-white border border-white/10 text-sm font-medium"
          >
            关闭
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
    className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
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
        className={`w-full bg-white/[0.04] border border-white/10 rounded-lg ${icon ? 'pl-7' : 'pl-2'} pr-2 py-1.5 text-xs sm:text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-400/60 focus:bg-white/[0.08] transition-colors ${mono ? 'font-mono' : ''}`}
      />
    </div>
  </label>
);