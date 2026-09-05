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
import { notifyLoadProgress, getLlmLoadProgress, onLlmLoadProgress, type LlmLoadProgress } from './progress';
export { getLlmLoadProgress, onLlmLoadProgress, type LlmLoadProgress };

import { detectGpuDeviceProfile, getQuickDeviceTier, getCachedDeviceProfile, type GpuDeviceProfile } from './deviceDetection';
export { detectGpuDeviceProfile, getQuickDeviceTier, getCachedDeviceProfile, type GpuDeviceProfile };

import { getActiveProviderId, getActiveProvider, completeOnce as customCompleteOnce } from './providers';
import type { ChatMessage as ProviderChatMessage } from './providers';

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

function unloadEngine(): void {
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
  if (!activeModelId) activeModelId = resolveInitialModelId();
  return activeModelId;
}

export function setActiveModelId(modelId: string): void {
  if (!isKnownModelId(modelId)) return;
  if (modelId === getActiveModelId() && engineInstance) return;
  activeModelId = modelId;
  notifyModelChange(modelId);
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

function getFriendlyFallbackSpeech(lang: Lang): string {
  switch (lang) {
    case 'ja':
      return '{"speech":"ちょっとスマホのメモリがいっぱいでぼーっとしちゃった…もう一度言ってくれる？"}';
    case 'en':
      return '{"speech":"Whew, graphics memory was tight and I spaced out for a second... could you say that again?"}';
    case 'zh-CN':
    default:
      return '{"speech":"唔……刚才显存稍微有点吃紧，小蠢晃了下神～你刚才说什么来着？"}';
  }
}

async function completeOnce(
  engine: WebWorkerMLCEngine,
  userText: string,
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  thinking: boolean,
  maxTokensOverride?: number,
): Promise<string> {
  const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const qwen3 = getActiveModelId().startsWith('Qwen3');
  const lang: Lang = langFromSystemPrompt(systemPrompt);
  // ponytail: 标准 ChatML 多轮 — [system, ...history, current user]。
  // 对话历史从 system 拆出到独立 messages,system 不再被 history 撑长,
  // 模型指令空间完整,2B 模型复读的历史 user role 反而让上下文更紧凑。
  const userContent = wrapUserContent(userText, lang);
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userContent },
  ];
  // ponytail: 打印完整 messages —— console.table 浏览器内部对长字符串只截 ~60 字,
  // 看不全 system 里拼进去的对话历史/记忆。换成 console.log 完整展开。
  console.log(`[WebLLM → messages] ${messages.length} 条`);
  for (const m of messages) {
    console.log(`\n── ${m.role} (${m.content.length} chars) ──\n${m.content}`);
  }
  // 移动端生成 token 限制为 120 (约3-4句话)，有效防止长时间占用 GPU 触发移动端驱动 TDR 看门狗重置
  const maxTokens = maxTokensOverride ?? (isMobile ? 120 : 220);
  try {
    const reply = await engine.chat.completions.create({
      model: getActiveModelId(),
      messages,
      temperature: 0.8,
      max_tokens: maxTokens,
      ...(qwen3 ? { extra_body: { enable_thinking: thinking && qwen3 } } : {}),
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
 * ponytail: 自定义 provider (OpenAI-compatible HTTP) 的对话实现 — 走 fetch + SSE 流式,
 * 不创建 webLLM worker,不下载模型权重。返回完整字符串(chatDirector 流式调度在 chat 层)。
 */
async function generateCustomSpeechReply(
  userText: string,
  onMilestone?: (key: LlmMilestoneKey, vars?: Record<string, unknown>) => void,
  systemPrompt: string = XIAOCHUN_SYSTEM_PROMPT['zh-CN'],
): Promise<string> {
  const lang = langFromSystemPrompt(systemPrompt);
  const mem = await recallForChat(userText);
  const recalled = applyRecall(systemPrompt, mem, lang);
  const profile = await getActiveProvider();
  if (!profile) {
    throw new Error('active custom provider not found');
  }
  onMilestone?.('thinking');
  const messages: ProviderChatMessage[] = [
    { role: 'system', content: recalled.system },
    ...recalled.history,
    { role: 'user', content: wrapUserContent(userText, lang) },
  ];
  return customCompleteOnce(profile, {
    model: profile.model,
    messages,
    temperature: 0.8,
    maxTokens: 120,
  });
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
  // ponytail: 有 active custom provider 就走 HTTP 路径,跳过 webLLM worker + Worker init。
  // 这样 ChatBar/chatDirector 不知道后端是什么,接口保持不变。
  const customId = await getActiveProviderId();
  if (customId) {
    return generateCustomSpeechReply(userText, onMilestone, systemPrompt);
  }

  let activeEngine = await getWebLLMEngine({ onMilestone });
  onMilestone?.('thinking');
  let gen = loadGen;
  const wantThink = isThinkingEnabled() && getActiveModelId().startsWith('Qwen3');
  const lang = langFromSystemPrompt(systemPrompt);
  const mem = await recallForChat(userText);
  const recalled = applyRecall(systemPrompt, mem, lang);

  let raw: string;
  try {
    raw = await completeOnce(activeEngine, userText, recalled.system, recalled.history, wantThink);
  } catch (err: any) {
    const errStr = String(err?.message || err?.name || err);
    console.warn(`[WebLLM] 推理过程遇到异常 (${errStr})，自动重置 Worker 尝试恢复:`, err);
    unloadEngine();
    gen = loadGen;
    const currentModel = getActiveModelId();
    if (currentModel !== FALLBACK_LLM_MODEL) {
      console.warn(`[WebLLM] 当前模型 ${currentModel} 自动重置并降级至 fallback 模型 (${FALLBACK_LLM_MODEL})`);
      setActiveModelId(FALLBACK_LLM_MODEL);
    }
    try {
      activeEngine = await getWebLLMEngine({ onMilestone });
      raw = await completeOnce(activeEngine, userText, recalled.system, recalled.history, false, 80);
    } catch (retryErr) {
      console.error('[WebLLM] 重启 Worker 重新加载后重试依然失败，返回优雅角色兜底台词:', retryErr);
      raw = getFriendlyFallbackSpeech(lang);
    }
  }
  if (gen !== loadGen) {
    console.warn('[WebLLM] 模型已切换，放弃本次过期生成结果');
    return '';
  }
  let cleanSpeech = extractCleanSpeech(raw);

  if (!cleanSpeech.trim() && wantThink) {
    try {
      raw = await completeOnce(activeEngine, userText, recalled.system, recalled.history, false);
      if (gen !== loadGen) {
        console.warn('[WebLLM] 模型已切换，放弃本次过期生成结果');
        return '';
      }
      cleanSpeech = extractCleanSpeech(raw);
    } catch {
      cleanSpeech = extractCleanSpeech(getFriendlyFallbackSpeech(lang));
    }
  }

  console.log('[WebLLM Raw Output]:', raw);
  console.log('[WebLLM Clean Speech]:', cleanSpeech);

  return cleanSpeech;
}
