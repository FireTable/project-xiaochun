/**
 * webLLM.ts — 纯前端浏览器端大语言模型管理模块
 * 
 * 核心特性:
 * 1. 100% 运行于浏览器本地 WebGPU (基于 Qwen3 0.6B / Qwen2.5 0.5B q4f16_1 轻量量化模型)；
 * 2. 彻底抛弃 Python 后端与 MiniMax CLI 依赖，实现纯静态公网一键运行；
 * 3. 首次加载后自动持久化缓存至浏览器 IndexedDB，后续秒开冷启动；
 * 4. 运行在 Dedicated Web Worker 内部，推理期间主线程 3D 渲染画面绝不掉帧。
 */

import { CreateWebWorkerMLCEngine, type WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { XIAOCHUN_SYSTEM_PROMPT } from '@/llm/prompts';

export const DEFAULT_LLM_MODEL = 'Qwen3-0.6B-q4f16_1-MLC';
export const FALLBACK_LLM_MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

let engineInstance: WebWorkerMLCEngine | null = null;
let initPromise: Promise<WebWorkerMLCEngine> | null = null;
let activeModelId = DEFAULT_LLM_MODEL;


export function getActiveModelId(): string {
  return activeModelId;
}

export function setActiveModelId(modelId: string): void {
  if (modelId !== activeModelId) {
    activeModelId = modelId;
    engineInstance = null;
    initPromise = null;
  }
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

  initPromise = (async () => {
    onMilestone?.('loadingWebGpu');
    const worker = new Worker(new URL('./llmWorker.ts', import.meta.url), { type: 'module' });

    try {
      const engine = await CreateWebWorkerMLCEngine(worker, activeModelId, {
        initProgressCallback: (report) => {
          onProgressText?.(report.text);
        },
      });
      engineInstance = engine;
      return engine;
    } catch (err: any) {
      console.warn(`[WebLLM] 加载 ${activeModelId} 遇到异常，尝试备用模型 ${FALLBACK_LLM_MODEL}`, err);
      // 若 Qwen3 远程分片或权重出现网络波动，平滑自动降级到极稳的 Qwen2.5-0.5B
      activeModelId = FALLBACK_LLM_MODEL;
      const engine = await CreateWebWorkerMLCEngine(worker, activeModelId, {
        initProgressCallback: (report) => {
          onProgressText?.(report.text);
        },
      });
      engineInstance = engine;
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
  } catch {}

  // 4. 清理括号内的动作描述或心理描述（如“（微笑着说）”或“(点头)”）
  raw = raw.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  raw = raw.replace(/\*[^*]*\*/g, ''); // 过滤 *动作神态*
  raw = raw.replace(/^(?:小蠢|晓伊)[^：:，,\n]*[：:]\s*/, ''); // 过滤“小蠢微笑道：”等小说前缀

  // 5. 去除首尾多余引号和空白字符
  raw = raw.replace(/^["'“”]+|["'“”]+$/g, '').trim();

  return raw;
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

  const reply = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
    temperature: 0.7,
    max_tokens: 256,
  });

  const raw = reply.choices[0]?.message?.content || '';
  const cleanSpeech = extractCleanSpeech(raw);
  console.log('[WebLLM Raw Output]:', raw);
  console.log('[WebLLM Clean Speech]:', cleanSpeech);

  return cleanSpeech;
}
