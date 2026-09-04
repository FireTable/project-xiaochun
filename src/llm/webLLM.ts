/**
 * webLLM.ts — 纯前端浏览器端大语言模型管理模块
 * 
 * 核心特性:
 * 1. 100% 运行于浏览器本地 WebGPU (默认 Qwen3.5-2B q4f16_1,失败则降到 Qwen3.5-0.8B)；
 * 2. 彻底抛弃 Python 后端与 MiniMax CLI 依赖，实现纯静态公网一键运行；
 * 3. 首次加载后自动持久化缓存至浏览器 IndexedDB，后续秒开冷启动；
 * 4. 运行在 Dedicated Web Worker 内部，推理期间主线程 3D 渲染画面绝不掉帧。
 */

import { CreateWebWorkerMLCEngine, prebuiltAppConfig, type WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { APP_CONFIG } from '@/config';
import { langFromSystemPrompt, XIAOCHUN_SYSTEM_PROMPT, wrapUserContent } from '@/llm/prompts';
import { applyRecall, recallForChat } from '@/memory';
import type { Lang } from '@/i18n';

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
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(MODEL_PREF_KEY);
    if (saved && isKnownModelId(saved)) return saved;
  }
  return APP_CONFIG.llm.model;
}

export function isWebLLMReady(): boolean {
  return engineInstance !== null;
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

function unloadEngine(): void {
  loadGen += 1;
  engineInstance = null;
  initPromise = null;
  engineWorker?.terminate();
  engineWorker = null;
  notifyLoadProgress(0, '');
  notifyLLMUnready();
}

export interface LlmLoadProgress {
  progress: number;
  text: string;
}

let lastLoadProgress: LlmLoadProgress = { progress: 0, text: '' };
const loadProgressListeners = new Set<(p: LlmLoadProgress) => void>();

function notifyLoadProgress(progress: number, text: string): void {
  lastLoadProgress = { progress, text };
  loadProgressListeners.forEach((fn) => {
    try { fn(lastLoadProgress); } catch { }
  });
}

export function getLlmLoadProgress(): LlmLoadProgress {
  return lastLoadProgress;
}

export function onLlmLoadProgress(cb: (p: LlmLoadProgress) => void): () => void {
  loadProgressListeners.add(cb);
  if (lastLoadProgress.text || lastLoadProgress.progress > 0) cb(lastLoadProgress);
  return () => {
    loadProgressListeners.delete(cb);
  };
}

export function getActiveModelId(): string {
  if (!activeModelId) activeModelId = resolveInitialModelId();
  return activeModelId;
}

export function setActiveModelId(modelId: string): void {
  if (!isKnownModelId(modelId)) return;
  if (modelId === getActiveModelId() && engineInstance) return;
  activeModelId = modelId;
  try {
    window.localStorage.setItem(MODEL_PREF_KEY, modelId);
  } catch { }
  unloadEngine();
  preloadWebLLM();
}

/** ponytail: 已知里程碑 → i18n key;worker 原始进度 → onProgressText(默认沉默,免得刷屏)。 */
export type LlmMilestoneKey = 'loadingWebGpu' | 'thinking';

export async function getWebLLMEngine(opts?: {
  onMilestone?: (key: LlmMilestoneKey, vars?: Record<string, unknown>) => void;
  onProgressText?: (text: string) => void;
}): Promise<WebWorkerMLCEngine> {
  const onMilestone = opts?.onMilestone;
  const onProgressText = opts?.onProgressText;
  if (engineInstance) return engineInstance;
  if (initPromise) return initPromise;

  const gen = loadGen;
  initPromise = (async () => {
    onMilestone?.('loadingWebGpu');
    const worker = new Worker(new URL('./llmWorker.ts', import.meta.url), { type: 'module' });
    engineWorker = worker;
    const modelId = getActiveModelId();

    try {
      const engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (report) => {
          if (gen !== loadGen) return;
          notifyLoadProgress(report.progress, report.text);
          onProgressText?.(report.text);
        },
      });
      if (gen !== loadGen) {
        worker.terminate();
        throw new Error('model switched');
      }
      engineInstance = engine;
      notifyLLMReady();
      return engine;
    } catch (err: any) {
      if (gen !== loadGen) throw err;
      console.warn(`[WebLLM] 加载 ${modelId} 遇到异常，尝试备用模型 ${FALLBACK_LLM_MODEL}`, err);
      activeModelId = FALLBACK_LLM_MODEL;
      const engine = await CreateWebWorkerMLCEngine(worker, FALLBACK_LLM_MODEL, {
        initProgressCallback: (report) => {
          if (gen !== loadGen) return;
          notifyLoadProgress(report.progress, report.text);
          onProgressText?.(report.text);
        },
      });
      if (gen !== loadGen) {
        worker.terminate();
        throw new Error('model switched');
      }
      engineInstance = engine;
      notifyLLMReady();
      return engine;
    }
  })();

  return initPromise;
}

/**
 * 启动时或空闲期后台静默预热 WebLLM 模型 (跑在独立 Dedicated Worker，不卡顿 3D 渲染)
 */
export function preloadWebLLM(opts?: {
  onProgressText?: (text: string) => void;
}): void {
  if (typeof window === 'undefined') return;
  void getWebLLMEngine({ onProgressText: opts?.onProgressText }).catch((err) => {
    console.warn('[WebLLM] Background preload notice:', err);
  });
}

/**
 * 清洗大模型输出，严格剥离 <think> 思考链，只拿其后的正文内容。
 * ponytail: 不在这里兜底中文问候,留给 chatDirector 走 i18n。
 */
export function extractCleanSpeech(text: string): string {
  let raw = text || '';

  // 1. 若包含 </think> 闭合标签，直接截取其后的真实正文！
  if (raw.includes('</think>')) {
    raw = raw.split('</think>').pop() || '';
  }

  // 2. 若存在未闭合的 <think>，强力剥离 <think> 及其后的全部内容
  raw = raw.replace(/<think>[\s\S]*$/gi, '');
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // 3. 过滤 markdown 标记、json 代码块
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.speech === 'string') return parsed.speech.trim();
  } catch { }

  // 4. 清理括号内的动作描述或心理描述（如“（微笑着说）”或“(点头)”）
  raw = raw.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  raw = raw.replace(/\*[^*]*\*/g, ''); // 过滤 *动作神态*
  raw = raw.replace(/^(?:小蠢|晓伊)[^：:，,\n]*[：:]\s*/, ''); // 过滤“小蠢微笑道：”等小说前缀

  // 5. 去除首尾多余引号和空白字符
  raw = raw.replace(/^["'“”]+|["'“”]+$/g, '').trim();

  return raw;
}

async function completeOnce(
  engine: WebWorkerMLCEngine,
  userText: string,
  systemPrompt: string,
  thinking: boolean,
  historyPrefix: string = '',
): Promise<string> {
  const qwen3 = getActiveModelId().startsWith('Qwen3');
  const lang: Lang = langFromSystemPrompt(systemPrompt);
  // ponytail: 历史压成单条 user 消息,而不是多轮 ChatML 交替 — 根治 2B 模型复读。
  // 不做 assistant prefill — MLC 的 OpenAI-compat API 强制最后一条必须是 user/tool,
  // 拼 assistant prefill 会报 MessageOrderError。
  const userContent = (historyPrefix + wrapUserContent(userText, lang)).trim();
  const messages: { role: 'system' | 'user'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
  console.table(messages.map((m, i) => ({ i, role: m.role, chars: m.content.length, preview: m.content.slice(0, 60) })));
  const reply = await engine.chat.completions.create({
    messages,
    temperature: 0.8,
    ...(qwen3 ? { extra_body: { enable_thinking: thinking && qwen3 } } : {}),
  });
  return reply.choices[0]?.message?.content || '';
}

/**
 * 对话生成接口 — 纯前端本地推理对话
 * @param systemPrompt 可选覆盖,缺省用 XIAOCHUN_SYSTEM_PROMPT['zh-CN']。
 *   ponytail: 由 chatDirector 在调用时根据当前 i18n 语言注入,实现"用户用什么语言问,就用什么语言答"。
 */
export async function generateSpeechReply(
  userText: string,
  onMilestone?: (key: LlmMilestoneKey, vars?: Record<string, unknown>) => void,
  systemPrompt: string = XIAOCHUN_SYSTEM_PROMPT['zh-CN'],
): Promise<string> {
  const engine = await getWebLLMEngine({ onMilestone });
  onMilestone?.('thinking');
  const gen = loadGen;
  const wantThink = isThinkingEnabled() && getActiveModelId().startsWith('Qwen3');
  const lang = langFromSystemPrompt(systemPrompt);
  const mem = await recallForChat(userText);
  const packed = applyRecall(systemPrompt, mem, lang);

  let raw = await completeOnce(engine, userText, packed.system, wantThink, packed.historyPrefix);
  if (gen !== loadGen) throw new Error('model switched');
  let cleanSpeech = extractCleanSpeech(raw);

  if (!cleanSpeech.trim() && wantThink) {
    raw = await completeOnce(engine, userText, packed.system, false, packed.historyPrefix);
    if (gen !== loadGen) throw new Error('model switched');
    cleanSpeech = extractCleanSpeech(raw);
  }

  console.log('[WebLLM Raw Output]:', raw);
  console.log('[WebLLM Clean Speech]:', cleanSpeech);

  return cleanSpeech;
}
