/**
 * webLLMProvider.ts — webLLM (WebGPU + Worker) 路径的 provider。
 *
 * ponytail: 把 webLLM 引擎 + chat 调用 + 模型列表打包成一个 provider,
 * 不感知「dispatch 到哪」,由 chatWorkflow 决定何时调用。
 * 自定义 HTTP provider 见 ./customProvider.ts。
 */

import { CreateWebWorkerMLCEngine, prebuiltAppConfig, type WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { APP_CONFIG } from '@/config';
import { readActiveKey, writeActiveKey } from './activeKey';
import { notifyLoadProgress, getLlmLoadProgress, onLlmLoadProgress, type LlmLoadProgress } from './progress';
export { getLlmLoadProgress, onLlmLoadProgress, type LlmLoadProgress };
import type { ChatProvider, RunChatOptions } from './chatTypes';

import { detectGpuDeviceProfile, getQuickDeviceTier, getCachedDeviceProfile, type GpuDeviceProfile } from './deviceDetection';
export { detectGpuDeviceProfile, getQuickDeviceTier, getCachedDeviceProfile, type GpuDeviceProfile };

import './polyfill';

export const DEFAULT_LLM_MODEL = APP_CONFIG.llm.model;
export const FALLBACK_LLM_MODEL = APP_CONFIG.llm.fallback;

const THINKING_PREF_KEY = 'xiaochun.thinking';
const MODEL_PREF_KEY = 'xiaochun.llm.model';

export function isThinkingEnabled(): boolean {
  if (typeof window === 'undefined') return APP_CONFIG.llm.thinking;
  const saved = window.localStorage.getItem(THINKING_PREF_KEY);
  if (saved === '1') return true;
  if (saved === '0') return false;
  return APP_CONFIG.llm.thinking;
}

export function setThinkingEnabled(on: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THINKING_PREF_KEY, on ? '1' : '0');
}

let engineInstance: WebWorkerMLCEngine | null = null;
let initPromise: Promise<WebWorkerMLCEngine> | null = null;
let engineWorker: Worker | null = null;
let activeModelId: string | null = null;
let loadGen = 0;
// ponytail: 暴露给 chatWorkflow 用 — 检测「推理过程中模型被切换」时丢弃过期结果。
export function getLoadGen(): number { return loadGen; }
const llmReadyListeners = new Set<() => void>();
const readyChangeListeners = new Set<(ready: boolean) => void>();

function isKnownModelId(id: string): boolean {
  return prebuiltAppConfig.model_list.some((m) => m.model_id === id);
}

const QUANT_SUF = /-(q[0-9]f[0-9]+(?:_[0-9]+)?)-MLC(?:-1k)?$/i;

const PROVIDER_RE: [RegExp, string][] = [
  [/^deepseek/i, 'DeepSeek'],
  [/^openhermes/i, 'OpenHermes'],
  [/^neuralhermes/i, 'NeuralHermes'],
  [/^wizardmath/i, 'WizardMath'],
  [/^redpajama/i, 'RedPajama'],
  [/^tinyllama/i, 'TinyLlama'],
  [/^ministral/i, 'Ministral'],
  [/^hermes/i, 'Hermes'],
  [/^smollm/i, 'SmolLM'],
  [/^llama/i, 'Llama'],
  [/^mistral/i, 'Mistral'],
  [/^qwen/i, 'Qwen'],
  [/^phi/i, 'Phi'],
  [/^gemma/i, 'Gemma'],
  [/^olmo/i, 'OLMo'],
  [/^stablelm/i, 'StableLM'],
];

export function modelBaseId(id: string): string {
  return id.replace(QUANT_SUF, '');
}

function providerOf(base: string): string {
  const hit = PROVIDER_RE.find(([re]) => re.test(base));
  return hit ? hit[1] : (base.split('-')[0] || base);
}

export type LlmModelOption = { id: string; label: string };
export type LlmModelGroup = { provider: string; models: LlmModelOption[] };

/** ponytail: 跳过 embedding / -1k;同一模型优先 q4f16_1。 */
export function listModelGroups(): LlmModelGroup[] {
  const byName = new Map<string, { id: string; quant: string; shortCtx: boolean }[]>();
  for (const rec of prebuiltAppConfig.model_list) {
    const id = rec.model_id;
    if (/embed/i.test(id)) continue;
    const m = id.match(/^(.*)-(q[0-9]f[0-9]+(?:_[0-9]+)?)-MLC(-1k)?$/i);
    if (!m) continue;
    const name = m[1];
    const arr = byName.get(name) ?? [];
    arr.push({ id, quant: m[2], shortCtx: Boolean(m[3]) });
    byName.set(name, arr);
  }

  const groups = new Map<string, LlmModelOption[]>();
  for (const [name, cands] of byName) {
    const pick =
      cands.find((c) => !c.shortCtx && c.quant === 'q4f16_1') ??
      cands.find((c) => !c.shortCtx) ??
      cands[0];
    const provider = providerOf(name);
    const arr = groups.get(provider) ?? [];
    arr.push({ id: pick.id, label: name });
    groups.set(provider, arr);
  }

  const keys = [...groups.keys()].sort((a, b) =>
    a === 'Qwen' ? -1 : b === 'Qwen' ? 1 : a.localeCompare(b),
  );
  return keys.map((provider) => ({ provider, models: groups.get(provider)! }));
}

export function resolveInitialModelId(): string {
  const quickTier = getQuickDeviceTier();
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(MODEL_PREF_KEY);
    if (saved && isKnownModelId(saved)) {
      // 显存与设备保护：若评估为 low（显存受限/手机等），且存的模型不是 fallback，自动纠偏为 fallback 模型
      if (quickTier === 'low' && saved !== FALLBACK_LLM_MODEL) {
        try {
          window.localStorage.setItem(MODEL_PREF_KEY, FALLBACK_LLM_MODEL);
        } catch { }
        return FALLBACK_LLM_MODEL;
      }
      return saved;
    }
  }
  return quickTier === 'low' ? FALLBACK_LLM_MODEL : APP_CONFIG.llm.model;
}

export function isWebLLMReady(): boolean {
  return engineInstance !== null;
}

const modelChangeListeners = new Set<(modelId: string) => void>();

export function onActiveModelChange(cb: (modelId: string) => void): () => void {
  modelChangeListeners.add(cb);
  return () => {
    modelChangeListeners.delete(cb);
  };
}

function notifyModelChange(modelId: string): void {
  modelChangeListeners.forEach((fn) => {
    try { fn(modelId); } catch { }
  });
}

export function onWebLLMReady(cb: () => void): () => void {
  if (engineInstance) {
    cb();
    return () => { };
  }
  llmReadyListeners.add(cb);
  return () => {
    llmReadyListeners.delete(cb);
  };
}

export function onWebLLMReadyChange(cb: (ready: boolean) => void): () => void {
  readyChangeListeners.add(cb);
  return () => {
    readyChangeListeners.delete(cb);
  };
}

function notifyLLMReady(): void {
  llmReadyListeners.forEach((fn) => {
    try { fn(); } catch { }
  });
  llmReadyListeners.clear();
  readyChangeListeners.forEach((fn) => {
    try { fn(true); } catch { }
  });
}

function notifyLLMUnready(): void {
  readyChangeListeners.forEach((fn) => {
    try { fn(false); } catch { }
  });
}

export function unloadEngine(): void {
  loadGen += 1;
  engineInstance = null;
  initPromise = null;
  engineWorker?.terminate();
  engineWorker = null;
  notifyLoadProgress(0, '');
  notifyLLMUnready();
}

export function unloadWebLLM(): void {
  unloadEngine();
  console.log('[WebLLM] 已销毁 Worker 并彻底释放 WebGPU 显存与运行内存');
}

export function getActiveModelId(): string {
  // ponytail: 优先读统一 active key — 自定义 provider 激活时走 custom 分支,
  // 这里只 fallback 到 webllm 的初始 model。
  const active = readActiveKey();
  if (active?.kind === 'webllm' && isKnownModelId(active.modelId)) {
    activeModelId = active.modelId;
    return activeModelId;
  }
  if (!activeModelId) activeModelId = resolveInitialModelId();
  return activeModelId;
}

export function setActiveModelId(modelId: string): void {
  if (!isKnownModelId(modelId)) return;
  // ponytail: 必须先写 key,即使 model 跟当前一样 — 之前因为提前 return 没写,
  // 导致 custom 激活时点 webLLM 默认模型,key 还是 custom,UI 也跟着错。
  const wasAlreadyWebLLM = readActiveKey()?.kind === 'webllm';
  writeActiveKey({ kind: 'webllm', modelId });
  activeModelId = modelId;
  notifyModelChange(modelId);
  try {
    window.localStorage.setItem(MODEL_PREF_KEY, modelId);
  } catch { }
  // ponytail: 已经在跑同一个 model 且 key 本来就是 webllm → 完全 no-op,跳过 reload。
  if (wasAlreadyWebLLM && engineInstance) return;
  unloadEngine();
  preloadWebLLM();
}

/** ponytail: 已知里程碑 → i18n key;worker 原始进度 → onProgressText(默认沉默,免得刷屏)。 */
import type { LlmMilestoneKey, MilestoneFn } from './chatTypes';
export type { LlmMilestoneKey };

export async function getWebLLMEngine(opts?: {
  onMilestone?: MilestoneFn;
  onProgressText?: (text: string) => void;
}): Promise<WebWorkerMLCEngine> {
  const onMilestone = opts?.onMilestone;
  const onProgressText = opts?.onProgressText;
  if (engineInstance) return engineInstance;
  if (initPromise) return initPromise;

  const gen = loadGen;
  initPromise = (async () => {
    onMilestone?.('loadingWebGpu');

    // 智能硬件与 WebGPU 能力算法裁决
    const profile = await detectGpuDeviceProfile();
    console.log(`[WebLLM 评测] tier=${profile.tier}, maxBuffer=${profile.maxBufferSizeMB}MB, mem=${profile.deviceMemoryGB ?? '?'}GB, reason=${profile.reason}`);

    let modelId = getActiveModelId();
    // 若设备显存/算力不足以运行正常模型，且当前非 fallback 模型，直接重定向为 fallback 模型，彻底避免耗时下载大模型
    if (profile.tier === 'low' && modelId !== FALLBACK_LLM_MODEL) {
      console.warn(`[WebLLM] 设备评估不足以承载全量模型 (${profile.reason})，直接加载 fallback 模型 (${FALLBACK_LLM_MODEL})，避免浪费时间与流量`);
      activeModelId = FALLBACK_LLM_MODEL;
      modelId = FALLBACK_LLM_MODEL;
      notifyModelChange(FALLBACK_LLM_MODEL);
      try {
        window.localStorage.setItem(MODEL_PREF_KEY, FALLBACK_LLM_MODEL);
      } catch { }
    }

    const worker = new Worker(new URL('./llmWorker.ts', import.meta.url), { type: 'module' });
    engineWorker = worker;

    // 根据设备硬件画像与算力评测推断出的上下文窗口尺寸 (移动端 1024, 桌面端 2048/4096)，
    // 既不破坏 cs1k 分块契约，又最大化节省 KV Cache 显存占用并防止驱动超时
    const chatOpts = {
      context_window_size: profile.contextWindowSize,
    };

    try {
      const engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (report) => {
          if (gen !== loadGen) return;
          notifyLoadProgress(report.progress, report.text);
          onProgressText?.(report.text);
        },
      }, chatOpts);
      if (gen !== loadGen) {
        worker.terminate();
        throw new Error('model switched');
      }
      engineInstance = engine;
      notifyLLMReady();
      return engine;
    } catch (err: any) {
      if (gen !== loadGen) throw err;
      if (modelId !== FALLBACK_LLM_MODEL) {
        console.warn(`[WebLLM] 加载 ${modelId} 遇到异常，销毁旧 Worker 并启动全新 Worker 加载备用模型 ${FALLBACK_LLM_MODEL}`, err);
        try { worker.terminate(); } catch {}
        const freshWorker = new Worker(new URL('./llmWorker.ts', import.meta.url), { type: 'module' });
        engineWorker = freshWorker;
        activeModelId = FALLBACK_LLM_MODEL;
        const engine = await CreateWebWorkerMLCEngine(freshWorker, FALLBACK_LLM_MODEL, {
          initProgressCallback: (report) => {
            if (gen !== loadGen) return;
            notifyLoadProgress(report.progress, report.text);
            onProgressText?.(report.text);
          },
        }, chatOpts);
        if (gen !== loadGen) {
          freshWorker.terminate();
          throw new Error('model switched');
        }
        engineInstance = engine;
        notifyLLMReady();
        return engine;
      }
      throw err;
    }
  })();

  return initPromise;
}

/**
 * 启动时或空闲期后台静默预热 WebLLM 模型 (跑在独立 Dedicated Worker，不卡顿 3D 渲染)。
 * 当前激活的是 custom provider 时直接 no-op — 加载了也用不上,白占 1-2GB 显存。
 */
export function preloadWebLLM(opts?: {
  onProgressText?: (text: string) => void;
}): void {
  if (typeof window === 'undefined') return;
  if (readActiveKey()?.kind === 'custom') return;
  void getWebLLMEngine({ onProgressText: opts?.onProgressText }).catch((err) => {
    console.warn('[WebLLM] Background preload notice:', err);
  });
}

/**
 * ponytail: provider 的统一入口 — 拿 messages + opts → 返 raw 字符串。
 * 内部负责:加载/复用 engine、失败时降级到 fallback 模型、KV cache 释放、
 * 模型切换时抛 ModelSwitchedError 让 chatWorkflow 丢弃过期结果。
 */
export async function runChat(opts: RunChatOptions): Promise<string> {
  let engine = await getWebLLMEngine({ onMilestone: opts.onMilestone });
  const gen = getLoadGen();
  try {
    return await callEngine(engine, opts);
  } catch (err) {
    if (gen !== getLoadGen()) throw new ModelSwitchedError();
    const errStr = String((err as Error)?.message || err);
    console.warn(`[WebLLM] 推理异常 (${errStr})，重置 worker 尝试恢复:`, err);
    unloadEngine();
    if (getActiveModelId() !== FALLBACK_LLM_MODEL) {
      console.warn(`[WebLLM] 自动降级至 fallback 模型 (${FALLBACK_LLM_MODEL})`);
      setActiveModelId(FALLBACK_LLM_MODEL);
    }
    engine = await getWebLLMEngine({ onMilestone: opts.onMilestone });
    if (gen !== getLoadGen()) throw new ModelSwitchedError();
    return callEngine(engine, { ...opts, thinking: false, maxTokens: 80 });
  }
}

export class ModelSwitchedError extends Error {
  constructor() {
    super('webllm model switched during inference');
    this.name = 'ModelSwitchedError';
  }
}

async function callEngine(
  engine: WebWorkerMLCEngine,
  opts: RunChatOptions,
): Promise<string> {
  // ponytail: 请求体已在 chatWorkflow.runChat 入口统一打印,这里不再 log 避免重复。
  try {
    const reply = await engine.chat.completions.create({
      model: getActiveModelId(),
      messages: opts.messages,
      temperature: 0.8,
      // ponytail: maxTokens 不传就不限 — 让 MLC / 模型端用各自的默认。
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      // ponytail: thinking 对所有模型一视同仁 —— WebLLM 的 OpenAI 兼容层原样透传
      // extra_body,不支持的模型静默忽略。
      ...(opts.thinking ? { extra_body: { enable_thinking: true } } : {}),
    });
    return reply.choices[0]?.message?.content || '';
  } finally {
    // 每次推理完成后立即释放 KV Cache，避免移动端显存膨胀触发 Device Lost
    try {
      await engine.resetChat();
    } catch {}
  }
}

/**
 * ponytail: provider 描述符 — 没显式激活任何 custom 时 webllm 是默认。
 * factory 看到 active key 不是 `custom:*` 就挑我们。
 */
export const webllmChatProvider: ChatProvider = {
  isActive: async () => {
    const active = readActiveKey();
    return active?.kind !== 'custom';
  },
  runChat,
};