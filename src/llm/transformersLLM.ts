/**
 * transformersLLM.ts — Transformers.js 后端 (取代 WebLLM)。
 *
 * 跑在主线程 (Transformers.js 默认主线程持有 WebGPU device),
 * 与 vrmEngine 的 WebGL/WebGPU VRM 渲染争抢 GPU 资源 — 已知 tradeoff。
 *
 * ponytail: API surface 完全镜像 webLLM.ts,chatDirector / ChatBar / vrmEngine
 * 只需把 import 路径换掉,业务逻辑零改动。
 */

import {
  pipeline,
  env,
  type TextGenerationPipeline,
  type ProgressCallback,
} from '@huggingface/transformers';
import { APP_CONFIG } from '@/config';
import { langFromSystemPrompt, XIAOCHUN_SYSTEM_PROMPT, wrapUserContent } from '@/llm/prompts';
import { applyRecall, recallForChat } from '@/memory';
import type { Lang } from '@/i18n';

// ponytail: 浏览器缓存模型权重,关闭本地模型检查(走 HF Hub)
env.allowLocalModels = false;
env.useBrowserCache = true;

export const DEFAULT_LLM_MODEL = APP_CONFIG.llm.model;
export const FALLBACK_LLM_MODEL = APP_CONFIG.llm.fallback;

const THINKING_PREF_KEY = 'xiaochun.thinking';
const MODEL_PREF_KEY = 'xiaochun.llm.model';

// ponytail: 手工策划的 onnx-community 模型清单。Transformers.js 没有
// 预置列表 (不像 MLC 的 prebuiltAppConfig),所以这里硬编码。
// 必须用 text-generation task 友好的 instruct 模型。
const SUPPORTED_MODELS: string[] = [
  'onnx-community/Qwen2.5-0.5B-Instruct',
  'onnx-community/Qwen2.5-1.5B-Instruct',
  'onnx-community/Qwen2.5-3B-Instruct',
  'onnx-community/Qwen2.5-7B-Instruct',
  'onnx-community/Qwen3-1.7B',
  'onnx-community/Qwen3-4B',
  'onnx-community/Qwen3-8B',
  'onnx-community/Phi-3.5-mini-instruct',
  'onnx-community/gemma-2-2b-it',
  'onnx-community/Llama-3.2-1B-Instruct',
  'onnx-community/Llama-3.2-3B-Instruct',
];

function isKnownModelId(id: string): boolean {
  return SUPPORTED_MODELS.includes(id);
}

/** ponytail: 与 webLLM 同名 API,签名一致 — 去掉 onnx-community/ 前缀展示。 */
export function modelBaseId(id: string): string {
  return id.replace(/^onnx-community\//, '');
}

const PROVIDER_RE: [RegExp, string][] = [
  [/^llama/i, 'Llama'],
  [/^mistral/i, 'Mistral'],
  [/^qwen/i, 'Qwen'],
  [/^phi/i, 'Phi'],
  [/^gemma/i, 'Gemma'],
  [/^olmo/i, 'OLMo'],
  [/^stablelm/i, 'StableLM'],
];

function providerOf(base: string): string {
  const hit = PROVIDER_RE.find(([re]) => re.test(base));
  return hit ? hit[1] : (base.split('-')[0] || base);
}

export type LlmModelOption = { id: string; label: string };
export type LlmModelGroup = { provider: string; models: LlmModelOption[] };

export function listModelGroups(): LlmModelGroup[] {
  const groups = new Map<string, LlmModelOption[]>();
  for (const id of SUPPORTED_MODELS) {
    const base = modelBaseId(id);
    const provider = providerOf(base);
    const label = base;
    const arr = groups.get(provider) ?? [];
    arr.push({ id, label });
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

let pipelineInstance: TextGenerationPipeline | null = null;
let initPromise: Promise<TextGenerationPipeline> | null = null;
let activeModelId: string | null = null;
let loadGen = 0;
const llmReadyListeners = new Set<() => void>();
const readyChangeListeners = new Set<(ready: boolean) => void>();

function notifyLLMReady(): void {
  llmReadyListeners.forEach((fn) => { try { fn(); } catch {} });
  llmReadyListeners.clear();
  readyChangeListeners.forEach((fn) => { try { fn(true); } catch {} });
}

function notifyLLMUnready(): void {
  readyChangeListeners.forEach((fn) => { try { fn(false); } catch {} });
}

export function unloadEngine(): void {
  loadGen += 1;
  pipelineInstance = null;
  initPromise = null;
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
  loadProgressListeners.forEach((fn) => { try { fn(lastLoadProgress); } catch {} });
}

export function getLlmLoadProgress(): LlmLoadProgress {
  return lastLoadProgress;
}

export function onLlmLoadProgress(cb: (p: LlmLoadProgress) => void): () => void {
  loadProgressListeners.add(cb);
  if (lastLoadProgress.text || lastLoadProgress.progress > 0) cb(lastLoadProgress);
  return () => { loadProgressListeners.delete(cb); };
}

export function isWebLLMReady(): boolean {
  return pipelineInstance !== null;
}

export function onWebLLMReady(cb: () => void): () => void {
  if (pipelineInstance) {
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

export function getActiveModelId(): string {
  if (!activeModelId) activeModelId = resolveInitialModelId();
  return activeModelId;
}

export function setActiveModelId(modelId: string): void {
  if (!isKnownModelId(modelId)) return;
  if (modelId === getActiveModelId() && pipelineInstance) return;
  activeModelId = modelId;
  try {
    window.localStorage.setItem(MODEL_PREF_KEY, modelId);
  } catch { }
  unloadEngine();
  preloadWebLLM();
}

export type LlmMilestoneKey = 'loadingWebGpu' | 'thinking';

function detectWebGPU(): boolean {
  try {
    return Boolean((navigator as any).gpu);
  } catch {
    return false;
  }
}

export async function getWebLLMEngine(opts?: {
  onMilestone?: (key: LlmMilestoneKey, vars?: Record<string, unknown>) => void;
  onProgressText?: (text: string) => void;
}): Promise<TextGenerationPipeline> {
  const onMilestone = opts?.onMilestone;
  const onProgressText = opts?.onProgressText;
  if (pipelineInstance) return pipelineInstance;
  if (initPromise) return initPromise;

  const gen = loadGen;
  initPromise = (async () => {
    onMilestone?.('loadingWebGpu');
    const modelId = getActiveModelId();
    const useWebGPU = detectWebGPU();

    const progressCallback: ProgressCallback = (data: any) => {
      if (gen !== loadGen) return;
      const status = String(data?.status ?? '');
      if (status === 'progress' && typeof data?.progress === 'number') {
        notifyLoadProgress(data.progress / 100, String(data?.file ?? ''));
      } else if (status === 'download') {
        notifyLoadProgress(0, String(data?.file ?? ''));
      } else if (status === 'ready') {
        notifyLoadProgress(1, '');
      } else if (status === 'done' && data?.file) {
        onProgressText?.(String(data.file));
      }
    };

    let pipe: TextGenerationPipeline;
    try {
      pipe = await pipeline('text-generation', modelId, {
        device: useWebGPU ? 'webgpu' : 'wasm',
        dtype: 'q4',
        progress_callback: progressCallback,
      });
    } catch (err: any) {
      console.warn(`[TransformersLLM] ${modelId} 加载失败,降级到 ${FALLBACK_LLM_MODEL}`, err);
      activeModelId = FALLBACK_LLM_MODEL;
      pipe = await pipeline('text-generation', FALLBACK_LLM_MODEL, {
        device: 'wasm',
        dtype: 'q4',
        progress_callback: progressCallback,
      });
    }

    if (gen !== loadGen) throw new Error('model switched');
    pipelineInstance = pipe;
    notifyLLMReady();
    return pipe;
  })();

  return initPromise;
}

export function preloadWebLLM(opts?: {
  onProgressText?: (text: string) => void;
}): void {
  if (typeof window === 'undefined') return;
  void getWebLLMEngine({ onProgressText: opts?.onProgressText }).catch((err) => {
    console.warn('[TransformersLLM] Background preload notice:', err);
  });
}

/** ponytail: 与 webLLM 版完全一致的清洗逻辑,行为不依赖后端。 */
export function extractCleanSpeech(text: string): string {
  let raw = text || '';

  if (raw.includes('</think>')) {
    raw = raw.split('</think>').pop() || '';
  }

  raw = raw.replace(/<think>[\s\S]*$/gi, '');
  raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');

  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.speech === 'string') return parsed.speech.trim();
  } catch { }

  raw = raw.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  raw = raw.replace(/\*[^*]*\*/g, '');
  raw = raw.replace(/^(?:小蠢|晓伊)[^：:，,\n]*[：:]\s*/, '');

  raw = raw.replace(/^["'“”]+|["'“”]+$/g, '').trim();

  return raw;
}

async function completeOnce(
  pipe: TextGenerationPipeline,
  userText: string,
  systemPrompt: string,
  historyPrefix: string = '',
): Promise<string> {
  const lang: Lang = langFromSystemPrompt(systemPrompt);
  // 历史同样压成单条 user 消息,根治 2B 复读。
  const userContent = (historyPrefix + wrapUserContent(userText, lang)).trim();
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  // ponytail: Transformers.js v4 tokenizers 自带 apply_chat_template,
  // 由模型的 tokenizer_config.json 驱动。Qwen 用 ChatML。
  const tok = pipe.tokenizer as any;
  const prompt = tok.apply_chat_template
    ? tok.apply_chat_template(messages, { tokenize: false, add_generation_prompt: true })
    : buildChatMLFallback(messages);

  const output = await pipe(prompt, {
    max_new_tokens: 256,
    temperature: 0.8,
    do_sample: true,
    top_k: 50,
    return_full_text: false,
  });

  // ponytail: pipe() 返回 union,string prompt 走 StringOutput 分支有 generated_text;
  // 但 TS 收窄不到 ChatOutput 分支(没该字段)。统一 any 一下。
  const first = output[0] as any;
  return typeof first?.generated_text === 'string' ? first.generated_text : '';
}

function buildChatMLFallback(messages: { role: string; content: string }[]): string {
  let out = '';
  for (const m of messages) {
    out += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  }
  out += '<|im_start|>assistant\n';
  return out;
}

export async function generateSpeechReply(
  userText: string,
  onMilestone?: (key: LlmMilestoneKey, vars?: Record<string, unknown>) => void,
  systemPrompt: string = XIAOCHUN_SYSTEM_PROMPT['zh-CN'],
): Promise<string> {
  const pipe = await getWebLLMEngine({ onMilestone });
  onMilestone?.('thinking');
  const gen = loadGen;
  const lang = langFromSystemPrompt(systemPrompt);
  const mem = await recallForChat(userText);
  const packed = applyRecall(systemPrompt, mem, lang);

  const raw = await completeOnce(pipe, userText, packed.system, packed.historyPrefix);
  if (gen !== loadGen) throw new Error('model switched');
  const cleanSpeech = extractCleanSpeech(raw);

  console.log('[TransformersLLM Raw Output]:', raw);
  console.log('[TransformersLLM Clean Speech]:', cleanSpeech);

  return cleanSpeech;
}