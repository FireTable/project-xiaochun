import React, { useEffect, useState } from 'react';
import { Server, Plus, Trash2, Check, Loader2, Search, Globe, Power, Sparkles, KeyRound } from 'lucide-react';
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
}

const EMPTY_FORM: FormState = { name: '', baseURL: '', apiKey: '', model: '' };

export const ProviderConfigDialog: React.FC<ProviderConfigDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const [list, setList] = useState<ProviderProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [probeResults, setProbeResults] = useState<ProbeResult[]>([]);
  const [autoPicked, setAutoPicked] = useState<{ baseURL: string; models: string[]; tpl: ProviderTemplate } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [all, active] = await Promise.all([listProviders(), getActiveProviderId()]);
    setList(all);
    setActiveId(active);
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const applyTemplate = (tpl: ProviderTemplate) => {
    setForm({
      name: tpl.label,
      baseURL: tpl.defaultBaseURL,
      apiKey: '',
      model: tpl.defaultModel,
    });
    setEditing(true);
  };

  const handleAutoProbe = async () => {
    setAutoBusy(true);
    setProbeResults([]);
    setAutoPicked(null);
    setError(null);
    try {
      const results = await probeAllKnownTemplates('');
      setProbeResults(results);
      const hit = results.find((r): r is Extract<ProbeResult, { ok: true }> => r.ok);
      if (hit) {
        setAutoPicked({ baseURL: hit.template.defaultBaseURL, models: hit.models, tpl: hit.template });
        applyTemplate(hit.template);
      }
    } finally {
      setAutoBusy(false);
    }
  };

  const handleTest = async () => {
    if (!form.baseURL.trim()) return;
    setProbeBusy(true);
    setError(null);
    try {
      const res = await probeProvider(form.baseURL.trim(), form.apiKey.trim());
      if (res.ok) {
        if (!form.model.trim() && res.models.length) {
          setForm((f) => ({ ...f, model: res.models[0] }));
        }
      } else {
        setError(res.error ?? 'failed');
      }
    } finally {
      setProbeBusy(false);
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
    });
    await setActiveProviderId(saved.id);
    setForm(EMPTY_FORM);
    setEditing(false);
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

  const handleEdit = (p: ProviderProfile) => {
    setForm({
      id: p.id,
      name: p.name,
      baseURL: p.baseURL,
      apiKey: '',
      model: p.model,
    });
    setEditing(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(32rem,calc(100vw-1.5rem))] sm:max-w-xl max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] overflow-y-auto">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2 text-brand-300">
            <Server className="h-4 w-4 sm:h-5 sm:w-5 shrink-0 text-brand-400" />
            <DialogTitle className="text-sm sm:text-base font-semibold">
              模型服务提供商
            </DialogTitle>
          </div>
          <DialogDescription className="text-[11px] sm:text-xs text-white/60 leading-relaxed">
            自定义 OpenAI 兼容服务(本地 Ollama / LM Studio / vLLM / 云厂商)。选中的服务会在下次对话生效,跳过 webLLM。
          </DialogDescription>
        </DialogHeader>

        {/* 现有 provider 列表 */}
        {list.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-white/40 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider">
              已配置({list.length})
            </div>
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
                    <span className="text-white text-xs truncate font-medium">{p.name}</span>
                    {p.id === activeId ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[9px] font-medium border border-emerald-500/30">
                        Active
                      </span>
                    ) : null}
                  </div>
                  <div className="text-white/40 text-[10px] truncate font-mono">{p.baseURL}</div>
                  <div className="text-white/40 text-[10px] truncate font-mono">model: {p.model}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {p.id !== activeId ? (
                    <button
                      type="button"
                      onClick={() => void handleActivate(p.id)}
                      aria-label="启用"
                      className="h-7 w-7 rounded-lg text-white/50 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center justify-center"
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleEdit(p)}
                    aria-label="编辑"
                    className="h-7 w-7 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(p.id)}
                    aria-label="删除"
                    className="h-7 w-7 rounded-lg text-white/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center justify-center"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 一键探测 */}
        <button
          type="button"
          onClick={() => void handleAutoProbe()}
          disabled={autoBusy}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.12] py-2.5 text-xs sm:text-sm font-medium text-white/80 hover:text-white transition-colors disabled:opacity-50"
        >
          {autoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-brand-400" />}
          {autoBusy ? '正在扫描本地服务...' : '一键探测本地服务'}
        </button>

        {probeResults.length > 0 && (
          <div className="space-y-1 text-[10px] sm:text-[11px] font-mono">
            {probeResults.map((r) => (
              <div key={r.template.id} className="flex items-center gap-2 text-white/50">
                <span className={r.ok ? 'text-emerald-400' : 'text-rose-400'}>{r.ok ? '✓' : '✗'}</span>
                <span className="min-w-0 flex-1 truncate">{r.template.label}</span>
                <span className="shrink-0">{r.template.defaultBaseURL}</span>
                <span className="shrink-0 tabular-nums">{r.ms}ms</span>
              </div>
            ))}
          </div>
        )}

        {/* 添加 / 编辑表单 */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-2.5">
          <div className="flex items-center gap-1.5 text-white/40 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider">
            <Plus className="h-3 w-3" />
            {editing ? '编辑服务' : '添加新服务'}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {KNOWN_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl)}
                className="rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.10] py-1.5 px-2 text-[10px] sm:text-[11px] text-white/70 hover:text-white transition-colors text-left"
              >
                <div className="font-medium truncate">{tpl.label}</div>
                <div className="text-white/40 truncate font-mono">{tpl.defaultBaseURL.replace('http://', '')}</div>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Field
              label="名称"
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="例如:Ollama 本地"
            />
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
              placeholder="本地 Ollama 不需要"
              type="password"
              icon={<KeyRound className="h-3 w-3 text-white/30" />}
            />
            <Field
              label="Model"
              value={form.model}
              onChange={(v) => setForm((f) => ({ ...f, model: v }))}
              placeholder={autoPicked?.models[0] ?? 'qwen2.5:7b'}
              mono
            />

            {autoPicked && autoPicked.models.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {autoPicked.models.slice(0, 12).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, model: m }))}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                      form.model === m
                        ? 'bg-brand-500/25 border-brand-400/60 text-brand-100'
                        : 'bg-white/[0.04] border-white/10 text-white/60 hover:bg-white/[0.08]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="text-rose-400 text-[11px]">⚠ {error}</div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleTest()}
              disabled={probeBusy || !form.baseURL.trim()}
              className="flex-1 h-8 text-xs bg-white/[0.04] hover:bg-white/[0.08] border-white/10"
            >
              {probeBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
              测试连接
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => void handleSave()}
              disabled={!form.name.trim() || !form.baseURL.trim() || !form.model.trim()}
              className="flex-1 bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium"
            >
              <Check className="h-3 w-3 mr-1" />
              保存并启用
            </Button>
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/10 text-xs sm:text-sm font-medium"
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

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
    <div className="text-white/40 text-[10px] sm:text-[11px] mb-1 font-medium">{label}</div>
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